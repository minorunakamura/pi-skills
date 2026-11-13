import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Pi supplies these modules; only the host boundary is stubbed in Node tests.
const hostModules = {
  "@earendil-works/pi-ai":
    "export const Type = { Object: properties => ({type: 'object', properties}), String: () => ({type: 'string'}) };",
  "@earendil-works/pi-tui":
    "export class Text { constructor(text, paddingX, paddingY) { Object.assign(this, {text, paddingX, paddingY}); } }",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "node:child_process" &&
      context.parentURL?.endsWith("/distribution/extensions/commit-status.js")
    ) {
      // Keep real children, but let --version exit before the parent can send stdin.
      const source = `
        import { spawn as realSpawn } from "node:child_process";
        export function spawn(...args) {
          const child = realSpawn(...args);
          if (args[1].includes("--version"))
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
          return child;
        }
      `;
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }
    if (Object.hasOwn(hostModules, specifier)) {
      return {
        url: `data:text/javascript,${encodeURIComponent(hostModules[specifier])}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { default: register } = await import("../extensions/commit-status.js");
const tools = new Map();
register({
  registerTool(value) {
    tools.set(value.name, value);
  },
});
const tool = tools.get("commit_status_display");
const inspectTool = tools.get("commit_inspect");

function state(changes = []) {
  return { repository: "/repo", branch: "feature", changes };
}
function change(index, worktree, path = "file.txt", extra = {}) {
  return { index, worktree, path, ...extra };
}
function execute(status, mode = "tui") {
  return tool.execute(
    "display",
    { status: JSON.stringify(status) },
    undefined,
    undefined,
    { mode },
  );
}
function render(result, prefix = "") {
  return tool.renderResult(
    result,
    {},
    {
      fg(color, text) {
        assert.equal(text, "●", "Only the text dot may receive a color");
        return `<${prefix}${color}>${text}</${prefix}${color}>`;
      },
    },
    { outputPad: 1 },
  ).text;
}

await test("colors only dots and preserves original status metadata", async () => {
  const input = state([
    change(" ", "M"),
    change("?", "?"),
    change("A", " "),
    change(" ", "D"),
  ]);
  const original = JSON.stringify(input);
  const result = await execute(input);
  assert.deepEqual(result.details, input);
  assert.equal(JSON.stringify(input), original);
  assert.match(result.content[0].text, /4件/);
  assert.doesNotMatch(result.content[0].text, /file.txt/);
  const text = render(result);
  for (const [color, label] of [
    ["warning", "Modified"],
    ["mdLink", "Untracked"],
    ["success", "Added"],
    ["error", "Deleted"],
  ]) {
    assert.ok(text.includes(`<${color}>●</${color}> ${label}`));
  }
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.renderCall({}, {}, { outputPad: 1 }).text, "Git status");
});

await test("shows partial stages, renames, copies, and conflicts accurately", async () => {
  const result = await execute(
    state([
      change("M", "M"),
      change("R", "M", "new.txt", { originalPath: "old.txt" }),
      change("C", " ", "copy.txt", { originalPath: "original.txt" }),
      change(" ", "T"),
      change("A", "A"),
      change("U", "U"),
    ]),
  );
  const text = render(result);
  assert.match(text, /Modified \[Staged\].*Modified \[Unstaged\]/);
  assert.match(
    text,
    /Renamed \[Staged\].*Modified \[Unstaged\].*"old.txt" → "new.txt"/,
  );
  assert.match(text, /Copied \[Staged\].*"original.txt" → "copy.txt"/);
  assert.match(text, /Type changed \[Unstaged\]/);
  assert.equal((text.match(/Unmerged/g) ?? []).length, 2);
});

await test("escapes terminal controls and preserves special path boundaries", async () => {
  const path = "space | [name]\n\t\u001b[31m\u009b31m\u202efile.txt";
  const result = await execute({
    branch: "topic\u202e",
    changes: [change("?", "?", path)],
  });
  const text = render(result);
  for (const control of ["\u001b", "\u009b", "\u202e"]) {
    assert.equal(text.includes(control), false);
  }
  assert.match(text, /space \| \[name\]\\n\\t\\u001b/);
  assert.ok(text.includes("\\u{9b}"));
  assert.ok(text.includes("\\u{202e}"));
  assert.equal(result.details.changes[0].path, path);
});

for (const mode of ["rpc", "json", "print"]) {
  await test(`${mode} mode receives a plain-text list without ANSI`, async () => {
    const result = await execute(state([change("?", "?")]), mode);
    assert.match(result.content[0].text, /● Untracked.*"file.txt"/);
    assert.equal(result.content[0].text.includes("\u001b"), false);
  });
}

await test("handles clean and detached states and uses the current renderer theme", async () => {
  const clean = await execute({ branch: null, changes: [] });
  assert.match(render(clean), /detached HEAD.*0 files\nNo changes/);
  const result = await execute(state([change("?", "?")]));
  assert.match(render(result, "first-"), /<first-mdLink>/);
  assert.match(render(result, "second-"), /<second-mdLink>/);
  assert.equal(
    tool.renderResult({ content: [] }, {}, {}, { outputPad: 1 }).text,
    "Git status could not be displayed.",
  );
});

await test("disables only this tool's colored shell and preserves output padding", async () => {
  assert.equal(tool.renderShell, "self");
  assert.equal(tool.renderCall({}, {}, { outputPad: 2 }).paddingX, 2);
  const result = await execute(state([change("?", "?")]));
  const rendered = tool.renderResult(
    result,
    {},
    { fg: (_color, text) => text },
    { outputPad: 2 },
  );
  assert.equal(rendered.paddingX, 2);
  assert.equal(rendered.paddingY, 0);
});

await test("rejects malformed metadata without echoing invalid JSON", async () => {
  for (const input of [
    null,
    {},
    { branch: 42, changes: [] },
    { branch: "main", changes: null },
    state([null]),
    state([change(" ", " ")]),
    state([change("?", "M")]),
    state([change(["M"], " ")]),
    state([change("X", " ")]),
    state([change("A", " ", 42)]),
    state([change("R", " ", "new.txt", { originalPath: 42 })]),
  ]) {
    await assert.rejects(execute(input), /Invalid Git status metadata/);
  }
  await assert.rejects(
    tool.execute("display", { status: "SECRET_INVALID_JSON" }, null, null, {}),
    { message: "Invalid Git status metadata" },
  );
});

const scripts = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../skills/commit/scripts",
);
const bun = realpathSync(
  spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim(),
);

function inspectFixture(t) {
  const owned = realpathSync(
    mkdtempSync(join(tmpdir(), "commit-inspect-test-")),
  );
  const repo = join(owned, "repo");
  const bin = join(owned, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  symlinkSync(bun, join(bin, "bun"));
  symlinkSync("/usr/bin/git", join(bin, "git"));
  const previous = { ...process.env };
  Object.assign(process.env, {
    HOME: owned,
    TMPDIR: owned,
    PATH: bin,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
    rmSync(owned, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync("/usr/bin/git", args, { cwd: repo });
    assert.equal(result.status, 0);
    return result.stdout;
  };
  git("init", "-b", "main");
  writeFileSync(join(repo, "partial.txt"), "staged\n");
  git("add", "partial.txt");
  writeFileSync(join(repo, "partial.txt"), "unstaged\n");
  writeFileSync(join(repo, "new.txt"), "new\n");
  const cli = (operation, reference) => {
    const env = { ...process.env };
    delete env.BUN_OPTIONS;
    delete env.NODE_OPTIONS;
    const result = spawnSync(
      bun,
      [
        `--config=${join(scripts, "bunfig.toml")}`,
        "--env-file=/dev/null",
        "--no-install",
        join(scripts, "commit-workflow.ts"),
        operation,
        "--repository",
        repo,
      ],
      { cwd: scripts, env, input: JSON.stringify({ reference }) },
    );
    assert.equal(result.status, 0);
    return JSON.parse(result.stdout.toString());
  };
  return { owned, repo, bin, git, cli };
}

await test("commit_inspect preserves complete real inspect data and uses protected Bun", async (t) => {
  const f = inspectFixture(t);
  // Repository startup files and ambient runtime options must never run.
  writeFileSync(join(f.repo, "bunfig.toml"), 'preload = ["./hostile.ts"]\n');
  writeFileSync(
    join(f.repo, "hostile.ts"),
    'throw new Error("SECRET_STARTUP");',
  );
  process.env.BUN_OPTIONS = "--preload=SECRET_STARTUP";
  process.env.NODE_OPTIONS = "--require=SECRET_STARTUP";
  const index = readFileSync(join(f.repo, ".git/index"));
  assert.equal(inspectTool.exposure, "model-only");
  assert.notEqual(inspectTool.annotations.readOnlyHint, true);
  assert.notEqual(inspectTool.annotations.idempotentHint, true);
  for (const mode of ["tui", "rpc", "json", "print"]) {
    const result = await inspectTool.execute(
      "inspect",
      {
        repository: f.repo,
        input: '{"mode":"commit","scope":{"kind":"staged"}}',
      },
      undefined,
      undefined,
      { mode },
    );
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const retained = JSON.parse(result.content.at(-1).text);
    assert.deepEqual(retained, result.details);
    assert.equal(retained.bun, bun);
    const data = retained.result;
    assert.equal(data.branch, "main");
    assert.equal(data.head, null);
    assert.equal(data.branchPolicy.mode, "commit");
    assert.equal(data.default.kind, "absent");
    assert.deepEqual(data.evidence, {
      remotes: [],
      heads: [],
      observationFailed: false,
    });
    assert.deepEqual(data.questions, {
      default: false,
      outsideStaged: [],
      suspicious: [],
    });
    assert.equal(data.localInformationMayBeStale, true);
    assert.equal(data.reference.repository, f.repo);
    assert.match(data.reference.run, /^[\da-f-]{36}$/);
    const identities = Object.values(data.reference.files);
    assert.equal(identities.length, 1);
    assert.match(identities[0].digest, /^[\da-f]{64}$/);
    assert.ok(identities[0].bytes > 0);
    assert.deepEqual(
      data.changes.find((change) => change.path === "partial.txt"),
      {
        path: "partial.txt",
        pathBytes: "cGFydGlhbC50eHQ=",
        index: "A",
        worktree: "M",
      },
    );
    assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
    const text = result.content[0].text;
    if (mode === "tui") {
      assert.doesNotMatch(text, /●|Branch:/);
      assert.match(text, /重複/);
    } else {
      assert.match(text, /Branch: "main"/);
      assert.match(
        text,
        /Added \[Staged\].*Modified \[Unstaged\].*"partial.txt"/,
      );
      assert.equal(text.includes("\u001b"), false);
    }
    const rendered = inspectTool.renderResult(
      result,
      {},
      { fg: (_color, text) => text },
      { outputPad: 2 },
    );
    assert.match(rendered.text, /Untracked.*"new.txt"/);
    assert.equal(rendered.paddingX, 2);
    assert.equal(f.cli("cleanup", data.reference).cleanup.complete, true);
    assert.equal(existsSync(data.reference.directory), false);
  }
});

for (const mode of ["push", "pr"]) {
  for (const setUpstream of [undefined, false, true]) {
    await test(`commit_inspect ${mode} retains upstream ${setUpstream ?? "auto"} without schema rejection`, async (t) => {
      const f = inspectFixture(t);
      f.git("remote", "add", "origin", join(f.owned, "remote.git"));
      const result = await inspectTool.execute(
        "inspect",
        {
          repository: f.repo,
          input: JSON.stringify({
            mode,
            push: {
              remote: "origin",
              ...(setUpstream === undefined ? {} : { setUpstream }),
            },
            ...(mode === "pr"
              ? { pr: { repository: "github.com/example/repo" } }
              : {}),
          }),
        },
        undefined,
        undefined,
        { mode: "rpc" },
      );
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const data = result.details.result;
      assert.equal(data.branchPolicy.push.setUpstream, setUpstream ?? null);
      assert.deepEqual(JSON.parse(result.content.at(-1).text), result.details);
      assert.equal(f.cli("cleanup", data.reference).cleanup.complete, true);
    });
  }
}

await test("commit_inspect reports missing push/PR options without changing Git", async (t) => {
  const f = inspectFixture(t);
  const index = readFileSync(join(f.repo, ".git/index"));
  const refs = f.git("for-each-ref");
  const status = f.git("status", "--porcelain=v1");
  let updates = 0;
  for (const input of [
    { mode: "push" },
    { mode: "pr" },
    { mode: "pr", push: { remote: "origin" } },
  ]) {
    const result = await inspectTool.execute(
      "inspect",
      { repository: f.repo, input: JSON.stringify(input) },
      undefined,
      () => updates++,
      { mode: "rpc" },
    );
    assert.equal(result.isError, true);
    assert.equal(result.details.error, "inspect_failed");
    assert.equal(result.details.cause, "invalid_input");
    assert.equal(result.details.processExitConfirmed, true);
    assert.equal(result.details.result, undefined);
    assert.match(result.details.privatePreparation, /Unconfirmed/);
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    assert.match(
      inspectTool.renderResult(result, {}, {}, { outputPad: 1 }).text,
      /"cause":"invalid_input"/,
    );
  }
  assert.equal(updates, 0);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  assert.deepEqual(f.git("for-each-ref"), refs);
  assert.deepEqual(f.git("status", "--porcelain=v1"), status);
});

await test("commit_inspect falls back only from renderer color failure using retained data", async (t) => {
  const f = inspectFixture(t);
  const result = await inspectTool.execute(
    "inspect",
    { repository: f.repo, input: '{"mode":"commit"}' },
    undefined,
    undefined,
    { mode: "tui" },
  );
  assert.notEqual(result.isError, true);
  try {
    const before = JSON.stringify(result);
    const rendered = inspectTool.renderResult(
      result,
      {},
      {
        fg() {
          throw new Error("SECRET_THEME");
        },
      },
      { outputPad: 1 },
    );
    assert.match(rendered.text, /Branch: "main"/);
    assert.match(rendered.text, /Untracked.*"new.txt"/);
    assert.doesNotMatch(rendered.text, /SECRET_THEME/);
    assert.equal(rendered.text.includes("\u001b"), false);
    assert.equal(JSON.stringify(result), before);
    // Rendering remains possible with no runtime available; it must not re-inspect.
    process.env.PATH = "";
    assert.equal(
      inspectTool.renderResult(
        result,
        {},
        {
          fg() {
            throw new Error();
          },
        },
        { outputPad: 1 },
      ).text,
      rendered.text,
    );
  } finally {
    assert.equal(
      f.cli("cleanup", result.details.result.reference).cleanup.complete,
      true,
    );
  }
});

await test("commit_inspect stops at its fixed input and protected runtime boundaries", async (t) => {
  const f = inspectFixture(t);
  const before = {
    index: readFileSync(join(f.repo, ".git/index")),
    refs: f.git("for-each-ref"),
    branch: f.git("symbolic-ref", "HEAD"),
    worktree: readFileSync(join(f.repo, "partial.txt")),
  };
  const params = { repository: f.repo, input: '{"mode":"commit"}' };
  const rejected = await inspectTool.execute(
    "inspect",
    { ...params, command: "SECRET_COMMAND" },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  try {
    assert.equal(rejected.isError, true);
  } finally {
    if (rejected.details.result)
      f.cli("cleanup", rejected.details.result.reference);
  }
  const missingMode = await inspectTool.execute(
    "inspect",
    { ...params, input: "{}" },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  assert.equal(missingMode.details.error, "invalid_input");
  for (const boundary of ["missing", "script shim", "invalid native probe"]) {
    unlinkSync(join(f.bin, "bun"));
    if (boundary === "script shim") {
      writeFileSync(
        join(f.bin, "bun"),
        '#!/bin/sh\n/bin/echo SECRET_SHIM\n: > "$HOME/SHIM_RAN"\n',
      );
      chmodSync(join(f.bin, "bun"), 0o700);
    } else if (boundary === "invalid native probe") {
      symlinkSync("/usr/bin/true", join(f.bin, "bun"));
    }
    const result = await inspectTool.execute(
      "inspect",
      params,
      undefined,
      undefined,
      { mode: "rpc" },
    );
    assert.equal(result.isError, true, boundary);
    assert.match(result.details.error, /Bun 1\.3\.0\+/);
    assert.equal(result.details.processExitConfirmed, true);
    assert.equal(result.details.result, undefined);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_SHIM|SECRET_COMMAND/);
    assert.equal(existsSync(join(f.owned, "SHIM_RAN")), false);
    if (boundary === "missing") symlinkSync(bun, join(f.bin, "bun"));
  }
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), before.index);
  assert.deepEqual(f.git("for-each-ref"), before.refs);
  assert.deepEqual(f.git("symbolic-ref", "HEAD"), before.branch);
  assert.deepEqual(readFileSync(join(f.repo, "partial.txt")), before.worktree);
});

await test("commit_inspect cancels a running child before reference without claiming cleanup", async (t) => {
  const f = inspectFixture(t);
  unlinkSync(join(f.bin, "git"));
  // Publish readiness only after the PID is written, never an empty marker.
  writeFileSync(
    join(f.bin, "git"),
    '#!/bin/sh\nif [ "$1" = status ]; then\n  /bin/echo "$$" > "$HOME/paused-git.tmp"\n  /bin/mv "$HOME/paused-git.tmp" "$HOME/paused-git"\n  exec /bin/sleep 30\nfi\nexec /usr/bin/git "$@"\n',
  );
  chmodSync(join(f.bin, "git"), 0o700);
  const controller = new AbortController();
  let updates = 0;
  const pending = inspectTool.execute(
    "inspect",
    { repository: f.repo, input: '{"mode":"commit"}' },
    controller.signal,
    () => {
      updates++;
    },
    { mode: "tui" },
  );
  const until = Date.now() + 5000;
  try {
    while (!existsSync(join(f.owned, "paused-git")) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      existsSync(join(f.owned, "paused-git")),
      true,
      "real inspect reached Git observation",
    );
  } finally {
    controller.abort();
  }
  const result = await pending;
  assert.equal(result.isError, true);
  assert.equal(result.details.error, "cancelled");
  assert.equal(result.details.processExitConfirmed, true);
  assert.equal(result.details.result, undefined);
  assert.equal(result.details.cleanup, undefined);
  assert.equal(result.details.cause, undefined);
  assert.match(result.details.privatePreparation, /Unconfirmed.*may remain/);
  assert.equal(updates, 0);
  const pid = Number(readFileSync(join(f.owned, "paused-git"), "utf8").trim());
  assert.ok(
    Number.isSafeInteger(pid) && pid > 0,
    "fixture must publish a complete child PID",
  );
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

await test("commit_inspect returns final cancellation and owned cleanup after a retained reference update", async (t) => {
  const f = inspectFixture(t);
  const index = readFileSync(join(f.repo, ".git/index"));
  const controller = new AbortController();
  let update;
  const result = await inspectTool.execute(
    "inspect",
    { repository: f.repo, input: '{"mode":"commit"}' },
    controller.signal,
    (value) => {
      update = value;
      controller.abort();
    },
    { mode: "tui" },
  );
  assert.ok(update.details.result.reference);
  assert.equal(result.isError, true);
  assert.equal(result.details.error, "cancelled");
  assert.deepEqual(result.details.result, update.details.result);
  assert.equal(result.details.bun, bun);
  assert.equal(result.details.cleanup.confirmed, true);
  assert.equal(result.details.cleanup.processExitConfirmed, true);
  assert.equal(result.details.cleanup.result.cleanup.complete, true);
  assert.equal(existsSync(result.details.result.reference.directory), false);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  assert.deepEqual(JSON.parse(result.content[0].text), result.details);
  assert.doesNotMatch(
    inspectTool.renderResult(
      { content: result.content, details: result.details },
      {},
      {},
      { outputPad: 1, isError: result.isError },
    ).text,
    /Branch:/,
  );
  const failedUpdate = await inspectTool.execute(
    "inspect",
    { repository: f.repo, input: '{"mode":"commit"}' },
    undefined,
    () => {
      throw new Error("SECRET_CALLBACK");
    },
    { mode: "tui" },
  );
  assert.equal(failedUpdate.isError, true);
  assert.equal(failedUpdate.details.error, "result_update_failed");
  assert.equal(failedUpdate.details.cleanup.result.cleanup.complete, true);
  assert.doesNotMatch(JSON.stringify(failedUpdate), /SECRET_CALLBACK/);
});

await test("commit_inspect only exposes allowlisted failure codes and rejects corrupt or oversized output", async (t) => {
  const f = inspectFixture(t);
  const normal = await inspectTool.execute(
    "inspect",
    { repository: f.repo, input: '{"mode":"commit"}' },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  assert.notEqual(normal.isError, true);
  const distribution = join(f.owned, "distribution");
  const extension = join(distribution, "extensions/commit-status.js");
  const fixedScripts = join(distribution, "skills/commit/scripts");
  mkdirSync(dirname(extension), { recursive: true });
  mkdirSync(fixedScripts, { recursive: true });
  writeFileSync(
    extension,
    readFileSync(new URL("../extensions/commit-status.js", import.meta.url)),
  );
  writeFileSync(
    join(fixedScripts, "bunfig.toml"),
    readFileSync(join(scripts, "bunfig.toml")),
  );
  const { default: registerFaultDistribution } = await import(extension);
  let faultTool;
  registerFaultDistribution({
    registerTool(value) {
      if (value.name === "commit_inspect") faultTool = value;
    },
  });
  const missing = structuredClone(normal.details.result);
  delete missing.changes[0].pathBytes;
  const invalidPolicy = structuredClone(normal.details.result);
  invalidPolicy.branchPolicy.push = {};
  const invalidDigest = structuredClone(normal.details.result);
  Object.values(invalidDigest.reference.files)[0].digest = ["a".repeat(64)];
  const validBytes = Buffer.from(JSON.stringify(normal.details.result));
  const corrupt = Buffer.concat([
    Buffer.from('{"branch":"SECRET_INVALID'),
    Buffer.from([0xff]),
    Buffer.from('",'),
    validBytes.subarray(1),
  ]);
  const faults = [
    Buffer.from('SECRET_FRAGMENT {"branch":'),
    Buffer.from(JSON.stringify(missing)),
    Buffer.from(JSON.stringify(invalidPolicy)),
    Buffer.from(JSON.stringify(invalidDigest)),
    corrupt,
  ].map((bytes) => ({
    script: `process.stdout.write(Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64"));`,
    error: "invalid_inspect_result",
  }));
  for (const cause of [
    "invalid_input",
    "invalid_push_input",
    "invalid_pr_input",
    "invalid_pr_repository",
    "invalid_pr_base",
  ]) {
    faults.push({
      script: `console.log(JSON.stringify({error: ${JSON.stringify(cause)}, message: "SECRET_DIAGNOSTIC", cleanup: {complete: true}, reference: "SECRET_REFERENCE"})); console.error("SECRET_STDERR"); process.exitCode = 1;`,
      error: "inspect_failed",
      cause,
    });
  }
  for (const output of [
    '{"error":"SECRET_UNKNOWN"}',
    '{"error":"invalid_input", "message":"SECRET_FRAGMENT',
    "null",
    '[{"error":"invalid_input"}]',
    '{"error":["invalid_input"]}',
  ]) {
    faults.push({
      script: `process.stdout.write(${JSON.stringify(output)}); process.exitCode = 1;`,
      error: "inspect_failed",
    });
  }
  faults.push(
    {
      script:
        'console.log(\'{"error":"invalid_input"}\'); process.exitCode = 2;',
      error: "inspect_failed",
    },
    {
      script:
        'console.log(\'{"error":"invalid_input"}\'); process.kill(process.pid, "SIGTERM");',
      error: "inspect_failed",
    },
    {
      script:
        'process.stdout.write(Buffer.concat([Buffer.from(\'{"error":"invalid_input","message":"\'), Buffer.from([0xff]), Buffer.from(\'"}\')])); process.exitCode = 1;',
      error: "invalid_output_encoding",
    },
  );
  faults.push({
    // Stay alive until the output guard terminates Bun, not an OS-dependent yes utility.
    script:
      "process.stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1)); setInterval(() => {}, 1000);",
    error: "output_limit",
  });
  // Actual Bun and protected arguments, but deliberately faulty subprocess responses.
  try {
    for (const { script, error, cause } of faults) {
      writeFileSync(join(fixedScripts, "commit-workflow.ts"), script);
      const result = await faultTool.execute(
        "inspect",
        { repository: f.repo, input: '{"mode":"commit"}' },
        undefined,
        undefined,
        { mode: "rpc" },
      );
      assert.equal(result.isError, true);
      assert.equal(result.details.result, undefined);
      assert.equal(result.details.error, error, JSON.stringify(result.details));
      assert.equal(result.details.cause, cause);
      assert.equal(result.details.cleanup, undefined);
      assert.equal(result.content[0].text, JSON.stringify(result.details));
      assert.equal(result.details.processExitConfirmed, true);
      assert.match(result.details.privatePreparation, /Unconfirmed/);
      assert.doesNotMatch(JSON.stringify(result), /SECRET_/);
      assert.doesNotMatch(
        faultTool.renderResult(result, {}, {}, { outputPad: 1 }).text,
        /Branch:/,
      );
    }
  } finally {
    assert.equal(
      f.cli("cleanup", normal.details.result.reference).cleanup.complete,
      true,
    );
  }
});
