import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

function renderWorkflow(details, options = {}, isError = false) {
  const result = {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
  const before = JSON.stringify(result);
  const rendered = tools
    .get("commit_workflow")
    .renderResult(result, options, {}, { outputPad: 2, isError });
  assert.equal(JSON.stringify(result), before);
  assert.equal(rendered.paddingX, 2);
  return rendered.text;
}

await test("workflow renderer hides call references and collapses large results without changing their data", () => {
  const workflow = tools.get("commit_workflow");
  assert.equal(
    workflow.renderCall(
      { operation: "read", input: { reference: "PRIVATE_REFERENCE" } },
      {},
      { outputPad: 2 },
    ).text,
    "Git workflow · read",
  );
  assert.equal(
    workflow.renderCall({ operation: "SECRET_INVALID" }, {}, { outputPad: 2 })
      .text,
    "Git workflow",
  );
  const page = {
    fixed: true,
    parts: [{ name: "diff", text: "LARGE_PAYLOAD".repeat(2000) }],
    next: { binding: "PRIVATE_CURSOR" },
    done: false,
    unread: ["diff"],
  };
  const collapsed = renderWorkflow(page);
  assert.match(collapsed, /read/);
  assert.match(collapsed, /1 part.*more to read/);
  assert.doesNotMatch(collapsed, /LARGE_PAYLOAD|PRIVATE_CURSOR/);
  assert.ok(collapsed.length < 200);
  assert.equal(renderWorkflow(page, { expanded: true }), JSON.stringify(page));
  assert.match(renderWorkflow({ ...page, done: true }), /read complete/);
  assert.match(renderWorkflow(page, { isPartial: true }), /Running/);
});

await test("workflow renderer keeps incomplete cleanup, partial success and uncertainty visible while collapsed", () => {
  const partial = {
    error: "cancelled",
    processExitConfirmed: false,
    result: {
      commitSucceeded: true,
      commitVerified: true,
      pushAttempted: true,
      pushVerified: false,
      cleanup: { complete: false, remaining: ["PRIVATE_REMAINDER"] },
    },
  };
  const collapsed = renderWorkflow(partial, {}, true);
  assert.match(collapsed, /Failed.*cancelled/);
  assert.match(collapsed, /commitSucceeded.*commitVerified.*pushAttempted/);
  assert.match(collapsed, /Cleanup incomplete.*1 remaining/);
  assert.match(collapsed, /Child exit unconfirmed/);
  assert.doesNotMatch(collapsed, /PRIVATE_REMAINDER|pushVerified/);
  const completedBeforeCancel = renderWorkflow(
    {
      error: "cancelled",
      result: {
        phase: "committed",
        cleanup: { complete: true, remaining: [] },
      },
    },
    {},
    true,
  );
  assert.match(completedBeforeCancel, /Failed.*cancelled/);
  assert.match(completedBeforeCancel, /Reported result.*committed/);
  assert.match(
    renderWorkflow({ error: "workflow_result_unknown" }, {}, true),
    /Cleanup unconfirmed/,
  );
  assert.match(
    renderWorkflow({
      phase: "cancelled",
      cleanup: { complete: true, remaining: [] },
    }),
    /Cleanup complete/,
  );
  assert.match(
    renderWorkflow({ phase: "plan", payloadRemoved: true }),
    /separate approval/,
  );
  assert.match(
    renderWorkflow({ phase: "materials", executable: false }),
    /Not executable/,
  );
  assert.match(
    renderWorkflow({
      mode: "pr",
      needed: true,
      remotes: [{}, {}],
      reasons: ["multiple_remotes"],
    }),
    /2 candidates.*unresolved/,
  );
  assert.match(
    renderWorkflow({ phase: "materials", files: [{}, {}], displayed: false }),
    /2 files.*omitted/,
  );
  const unknown = tools
    .get("commit_workflow")
    .renderResult(
      { content: [] },
      {},
      {},
      { outputPad: 2, isError: true },
    ).text;
  assert.match(unknown, /Failed.*unavailable/);
  const control = renderWorkflow({ error: "bad\n\u001b[31m\u202e" }, {}, true);
  assert.equal(control.includes("\u001b"), false);
  assert.equal(control.includes("\u202e"), false);
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
  writeFileSync(
    join(dirname(extension), "commit-workflow-validation.js"),
    readFileSync(
      new URL("../extensions/commit-workflow-validation.js", import.meta.url),
    ),
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

await test("commit_workflow rejects extra execute input before launch and preserves preparation", async (t) => {
  const f = inspectFixture(t);
  const inspected = await inspectTool.execute(
    "inspect",
    {
      repository: f.repo,
      input: '{"mode":"commit"}',
    },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  assert.notEqual(inspected.isError, true);
  const reference = inspected.details.result.reference;
  const stateName = Object.keys(reference.files)[0];
  const before = readFileSync(join(reference.directory, stateName));
  const index = readFileSync(join(f.repo, ".git/index"));
  const workflow = tools.get("commit_workflow");
  const result = await workflow.execute(
    "invalid",
    {
      repository: f.repo,
      operation: "execute",
      input: { reference, message: "not allowed" },
    },
    undefined,
    undefined,
    {
      sessionManager: {
        getBranch() {
          assert.fail("input rejection must precede Bun lookup");
        },
      },
    },
  );
  assert.equal(result.isError, true);
  assert.equal(result.details.error, "input_rejected");
  assert.equal(result.details.childStarted, false);
  assert.equal(result.details.inputCorrectionAllowed, true);
  assert.deepEqual(readFileSync(join(reference.directory, stateName)), before);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  f.cli("cleanup", reference);
});

await test("commit_workflow uses only final successful inspect evidence on the current branch, not PATH", async (t) => {
  const f = inspectFixture(t);
  const inspected = await inspectTool.execute(
    "inspect",
    {
      repository: f.repo,
      input: '{"mode":"commit"}',
    },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  assert.notEqual(inspected.isError, true);
  const reference = inspected.details.result.reference;
  const entry = {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "commit_inspect",
      isError: false,
      details: inspected.details,
    },
  };
  unlinkSync(join(f.bin, "bun"));
  writeFileSync(
    join(f.bin, "bun"),
    `#!/bin/sh\necho forbidden > '${join(f.owned, "lookup-marker")}'\n`,
    { mode: 0o700 },
  );
  const workflow = tools.get("commit_workflow");
  const call = (branch) =>
    workflow.execute(
      "cleanup",
      { repository: f.repo, operation: "cleanup", input: { reference } },
      undefined,
      undefined,
      { sessionManager: { getBranch: () => branch } },
    );
  for (const entries of [
    [],
    [{ ...entry, type: "update" }],
    [{ type: "message", message: { ...entry.message, role: "assistant" } }],
    [{ type: "message", message: { ...entry.message, isError: true } }],
  ]) {
    const denied = await call(entries);
    assert.equal(denied.isError, true);
    assert.equal(denied.details.inputCorrectionAllowed, undefined);
    assert.equal(existsSync(reference.directory), true);
  }
  const result = await call([entry]);
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(result.details.phase, "cancelled");
  assert.equal(result.details.cleanup.complete, true);
  assert.equal(existsSync(reference.directory), false);
  assert.equal(existsSync(join(f.owned, "lookup-marker")), false);
});

async function workflowFixture(
  t,
  mode = "commit-main",
  content = "new content\n",
  options = {},
) {
  const f = inspectFixture(t);
  f.git("config", "user.name", "Test User");
  f.git("config", "user.email", "test@example.invalid");
  f.git("config", "commit.gpgsign", "false");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  writeFileSync(join(f.repo, "new.txt"), content);
  const input = { mode, ...options };
  if (["push", "pr"].includes(mode)) {
    const remote = join(f.owned, "remote.git");
    assert.equal(
      spawnSync("/usr/bin/git", ["init", "--bare", "-b", "main", remote])
        .status,
      0,
    );
    f.git("remote", "add", "origin", remote);
    f.git("push", "origin", "main");
    input.push = { remote: "origin" };
    if (mode === "pr") {
      const { configurePrFixture, fixtureRepository } = await import(
        "../.pi/skills/verify-project/scripts/pr-fixture.ts"
      );
      configurePrFixture(f.owned, "/usr/bin/git", process.execPath);
      input.pr = { repository: fixtureRepository };
    }
  }
  const inspected = await inspectTool.execute(
    "inspect",
    { repository: f.repo, input: JSON.stringify(input) },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  assert.notEqual(inspected.isError, true, JSON.stringify(inspected));
  const entry = {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "commit_inspect",
      isError: false,
      details: inspected.details,
    },
  };
  const ctx = { mode: "rpc", sessionManager: { getBranch: () => [entry] } };
  const call = (
    operation,
    input,
    signal,
    selectedTool = tools.get("commit_workflow"),
  ) =>
    selectedTool.execute(
      "workflow",
      { repository: f.repo, operation, input },
      signal,
      () => {
        assert.fail("mutation results must not publish a success update");
      },
      ctx,
    );
  const ok = async (operation, input) => {
    const result = await call(operation, input);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    return result.details;
  };
  return {
    ...f,
    entry,
    ctx,
    call,
    ok,
    reference: inspected.details.result.reference,
  };
}

for (const mode of ["commit", "commit-main", "push", "pr"]) {
  await test(`commit_workflow ${mode} connects real materials, fixed read, plan and reference-only execute`, async (t) => {
    const f = await workflowFixture(t, mode);
    const base = f.git("rev-parse", "HEAD").toString().trim();
    const materials = await f.ok("materials", { reference: f.reference });
    assert.equal(materials.phase, "materials");
    const read = await f.ok("read", {
      reference: materials.reference,
      parts: [{ name: "diff", offset: 0, length: materials.diffBytes }],
      fileOffset: 0,
      fileCount: 10,
    });
    assert.deepEqual(read.parts[0].text, materials.diff.text);
    let plan = await f.ok("plan", {
      reference: materials.reference,
      message: "docs: exact example\n",
      ...(mode === "commit-main" ? {} : { newBranch: "docs/example" }),
    });
    if (mode === "pr") {
      assert.equal(plan.phase, "materials");
      assert.equal(plan.executable, false);
      assert.equal(plan.payloadRemoved, true);
      plan = await f.ok("plan", {
        reference: plan.reference,
        pr: { title: "exact $HOME", body: "日本語 `code`\n\n" },
      });
      assert.equal(plan.pr.body, "日本語 `code`\n\n");
    }
    assert.equal(plan.phase, "plan");
    assert.equal(plan.payloadRemoved, true);
    assert.equal(f.git("rev-parse", "HEAD").toString().trim(), base);
    const rejected = await f.call("execute", {
      reference: plan.reference,
      extra: true,
    });
    assert.equal(rejected.details.inputCorrectionAllowed, true);
    const result = await f.ok("execute", { reference: plan.reference });
    assert.equal(
      result.phase,
      mode === "pr" ? "pr_created" : mode === "push" ? "pushed" : "committed",
    );
    assert.equal(result.cleanup.complete, true);
    assert.equal(f.git("rev-list", "--count", "HEAD").toString().trim(), "2");
    assert.equal(existsSync(plan.reference.directory), false);
    const raw = f.git("cat-file", "commit", "HEAD").toString();
    assert.equal(raw.slice(raw.indexOf("\n\n") + 2), "docs: exact example\n");
    if (mode !== "commit-main")
      assert.equal(f.git("rev-parse", "main").toString().trim(), base);
  });
}

await test("commit_workflow release, preserved read budget and incomplete cleanup retain their distinct results", async (t) => {
  const f = await workflowFixture(t);
  writeFileSync(join(f.repo, "new.txt"), "x".repeat(40000));
  // Inspect this fresh state; do not update an old reference after drift.
  f.cli("cleanup", f.reference);
  const inspected = await inspectTool.execute(
    "inspect",
    { repository: f.repo, input: '{"mode":"commit-main"}' },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  f.entry.message.details = inspected.details;
  const materials = await f.ok("materials", {
    reference: inspected.details.result.reference,
  });
  assert.equal(materials.displayed, false);
  const budget = await f.call("read", {
    reference: materials.reference,
    parts: [{ name: "diff", offset: 0, length: materials.diffBytes }],
  });
  assert.equal(budget.isError, true);
  assert.equal(budget.details.error, "material_display_budget_exceeded");
  assert.equal(budget.details.materialsPreserved, true);
  const small = await f.ok("read", {
    reference: budget.details.reference,
    parts: [{ name: "diff", offset: 0, length: 100 }],
  });
  assert.equal(small.parts[0].length, 100);
  const released = await f.ok("release", {
    reference: budget.details.reference,
  });
  assert.equal(released.payloadRemoved, true);
  assert.equal(
    existsSync(join(released.reference.directory, "diff.bin")),
    false,
  );
  writeFileSync(join(released.reference.directory, "unknown"), "keep");
  const cleaned = await f.ok("cleanup", { reference: released.reference });
  assert.equal(cleaned.cleanup.complete, false);
  assert.equal(
    readFileSync(join(released.reference.directory, "unknown"), "utf8"),
    "keep",
  );
});

await test("commit_workflow retains commit success and observed SHA on post-commit verification failure without retry", async (t) => {
  const f = await workflowFixture(t);
  const materials = await f.ok("materials", { reference: f.reference });
  const plan = await f.ok("plan", {
    reference: materials.reference,
    message: "docs: hook boundary\n",
  });
  writeFileSync(
    join(f.repo, ".git/hooks/post-commit"),
    "#!/bin/sh\n/usr/bin/git update-ref refs/heads/unplanned HEAD\necho SECRET_HOOK >&2\n",
    { mode: 0o700 },
  );
  const result = await f.call("execute", { reference: plan.reference });
  assert.equal(result.isError, true);
  assert.equal(result.details.error, "commit_verification_failed");
  assert.equal(result.details.commitSucceeded, true);
  assert.equal(result.details.commitVerified, false);
  assert.equal(
    result.details.observed.head,
    f.git("rev-parse", "HEAD").toString().trim(),
  );
  assert.equal(result.details.cleanup.complete, true);
  assert.equal(result.details.inputCorrectionAllowed, undefined);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_HOOK/);
  const { workflow } = await faultWorkflow(
    f,
    `import { readFileSync } from "node:fs"; readFileSync(0); console.log(${JSON.stringify(JSON.stringify({ ...result.details, error: "SECRET_CHILD", stderr: "SECRET_STDERR" }))}); process.exitCode = 1;`,
  );
  const safeFailure = await f.call(
    "execute",
    { reference: plan.reference },
    AbortSignal.timeout(10_000),
    workflow,
  );
  assert.equal(safeFailure.isError, true);
  assert.equal(safeFailure.details.error, "workflow_failed");
  assert.equal(safeFailure.details.commitSucceeded, true);
  assert.equal(safeFailure.details.observed.head, result.details.observed.head);
  assert.equal(safeFailure.details.cleanup.complete, true);
  assert.doesNotMatch(JSON.stringify(safeFailure), /SECRET/);
  assert.equal(f.git("rev-list", "--count", "HEAD").toString().trim(), "2");
});

await test("commit_workflow denies conflicting, incomplete or non-final Bun evidence before any child", async (t) => {
  const f = await workflowFixture(t);
  const before = readFileSync(
    join(f.reference.directory, Object.keys(f.reference.files)[0]),
  );
  const valid = structuredClone(f.entry);
  const variants = [];
  for (const key of ["repository", "directory", "dev", "ino"]) {
    const entry = structuredClone(valid);
    entry.message.details.result.reference[key] =
      typeof f.reference[key] === "number" ? f.reference[key] + 1 : "/other";
    variants.push([entry]);
  }
  const missing = structuredClone(valid);
  delete missing.message.details.result.evidence;
  const unknown = structuredClone(valid);
  unknown.message.details.result.secret = "SECRET_OUTPUT";
  const noFinal = structuredClone(valid);
  delete noFinal.message.isError;
  variants.push([missing], [unknown], [noFinal], [valid, valid]);
  for (const entries of variants) {
    const result = await tools.get("commit_workflow").execute(
      "denied",
      {
        repository: f.repo,
        operation: "cleanup",
        input: { reference: f.reference },
      },
      undefined,
      undefined,
      { sessionManager: { getBranch: () => entries } },
    );
    assert.equal(result.isError, true);
    assert.equal(result.details.childStarted, false);
    assert.equal(result.details.inputCorrectionAllowed, undefined);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_OUTPUT/);
    assert.deepEqual(
      readFileSync(
        join(f.reference.directory, Object.keys(f.reference.files)[0]),
      ),
      before,
    );
  }
  const cancelled = new AbortController();
  cancelled.abort();
  const result = await f.call(
    "execute",
    { reference: f.reference, extra: true },
    cancelled.signal,
  );
  assert.equal(result.details.error, "cancelled");
  assert.equal(result.details.inputCorrectionAllowed, undefined);
  await f.ok("cleanup", { reference: f.reference });
});

async function faultWorkflow(f, script) {
  const distribution = join(f.owned, "distribution");
  const extension = join(distribution, "extensions/commit-status.js");
  const fixedScripts = join(distribution, "skills/commit/scripts");
  mkdirSync(dirname(extension), { recursive: true });
  mkdirSync(fixedScripts, { recursive: true });
  for (const name of ["commit-status.js", "commit-workflow-validation.js"])
    writeFileSync(
      join(dirname(extension), name),
      readFileSync(new URL(`../extensions/${name}`, import.meta.url)),
    );
  writeFileSync(join(fixedScripts, "bunfig.toml"), "");
  writeFileSync(join(fixedScripts, "commit-workflow.ts"), script);
  const { default: registerFault } = await import(extension);
  let workflow;
  registerFault({
    registerTool(value) {
      if (value.name === "commit_workflow") workflow = value;
    },
  });
  return { workflow, fixedScripts };
}

await test("commit_workflow rejects unknown and incomplete responses without echoing child output or deleting preparation", async (t) => {
  const f = await workflowFixture(t);
  const materials = await f.ok("materials", { reference: f.reference });
  const plan = await f.ok("plan", {
    reference: materials.reference,
    message: "docs: exact\n",
  });
  const { workflow, fixedScripts } = await faultWorkflow(f, "");
  for (const data of [
    { ...plan, unknown: "SECRET_OUTPUT" },
    { ...plan, message: undefined },
    { ...plan, cleanup: { complete: true, remaining: [] } },
    { ...plan, pr: { repository: "owner/repo" } },
    {
      phase: "committed",
      commit: "a".repeat(40),
      cleanup: { complete: true, remaining: [] },
    },
    {
      phase: "cancelled",
      stagedChangesPreserved: true,
      cleanup: { complete: true, remaining: ["SECRET_OUTPUT"] },
    },
  ]) {
    writeFileSync(
      join(fixedScripts, "commit-workflow.ts"),
      `import { readFileSync } from "node:fs"; readFileSync(0); console.log(${JSON.stringify(JSON.stringify(data))}); console.error("SECRET_STDERR");`,
    );
    const result = await f.call(
      data.phase === "plan"
        ? "plan"
        : data.phase === "cancelled"
          ? "cleanup"
          : "execute",
      { reference: plan.reference },
      // Fault children must not wait for the production mutation deadline.
      AbortSignal.timeout(10_000),
      workflow,
    );
    assert.equal(result.isError, true);
    assert.equal(result.details.error, "workflow_result_unknown");
    assert.equal(result.details.processExitConfirmed, true);
    assert.equal(result.details.inputCorrectionAllowed, undefined);
    assert.equal(existsSync(plan.reference.directory), true);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  await f.ok("cleanup", { reference: plan.reference });
});

await test("commit_workflow loses a real transition response without searching, retrying or cleaning an obsolete reference", async (t) => {
  const f = await workflowFixture(t);
  const oldNames = Object.keys(f.reference.files);
  const { workflow } = await faultWorkflow(
    f,
    `console.log = () => process.stdout.write('{"cut":'); await import(${JSON.stringify(join(scripts, "commit-workflow.ts"))});`,
  );
  const result = await f.call(
    "materials",
    { reference: f.reference },
    AbortSignal.timeout(10_000),
    workflow,
  );
  assert.equal(result.details.error, "workflow_result_unknown");
  assert.equal(result.details.processExitConfirmed, true);
  assert.match(result.details.privatePreparation, /Unconfirmed/);
  assert.equal(existsSync(f.reference.directory), true);
  assert.equal(existsSync(join(f.reference.directory, oldNames[0])), false);
  assert.equal(existsSync(join(f.reference.directory, "diff.bin")), true);
  assert.equal(f.git("rev-list", "--count", "HEAD").toString().trim(), "1");
  assert.notEqual(f.git("diff", "--cached", "--name-only").length, 0);
});

await test("commit_workflow running execute cancellation confirms child exit and never retries or rolls back Stage", async (t) => {
  const f = await workflowFixture(t);
  const materials = await f.ok("materials", { reference: f.reference });
  const plan = await f.ok("plan", {
    reference: materials.reference,
    message: "docs: cancelled\n",
  });
  writeFileSync(
    join(f.repo, ".git/hooks/pre-commit"),
    '#!/bin/sh\n/bin/echo "$$" > "$HOME/hook-pid.tmp"\n/bin/mv "$HOME/hook-pid.tmp" "$HOME/hook-pid"\nexec /bin/sleep 30\n',
    { mode: 0o700 },
  );
  const controller = new AbortController();
  const pending = f.call(
    "execute",
    { reference: plan.reference },
    controller.signal,
  );
  for (let i = 0; i < 500 && !existsSync(join(f.owned, "hook-pid")); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(existsSync(join(f.owned, "hook-pid")), true);
  controller.abort();
  const result = await pending;
  assert.equal(result.isError, true);
  assert.equal(result.details.error, "cancelled");
  assert.equal(result.details.processExitConfirmed, true);
  const pid = Number(readFileSync(join(f.owned, "hook-pid"), "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(f.git("rev-list", "--count", "HEAD").toString().trim(), "1");
  assert.notEqual(f.git("diff", "--cached", "--name-only").length, 0);
  assert.equal(existsSync(plan.reference.directory), true);
  await f.ok("cleanup", { reference: plan.reference });
});

await test("commit_workflow recognizes empty materials and already-pushed or existing-PR terminal plans", async (t) => {
  const f = await workflowFixture(t, "pr");
  const materials = await f.ok("materials", { reference: f.reference });
  const plan = await f.ok("plan", {
    reference: materials.reference,
    newBranch: "docs/terminal",
    message: "docs: terminal\n",
    pr: { title: "terminal", body: "body\n" },
  });
  await f.ok("execute", { reference: plan.reference });
  for (const mode of ["pr", "push", "commit"]) {
    const inspected = await inspectTool.execute(
      "inspect",
      {
        repository: f.repo,
        input: JSON.stringify({
          mode,
          ...(mode === "commit" ? {} : { push: { remote: "origin" } }),
          ...(mode === "pr"
            ? { pr: { repository: "github.example.invalid/example/project" } }
            : {}),
        }),
      },
      undefined,
      undefined,
      { mode: "rpc" },
    );
    assert.notEqual(inspected.isError, true, JSON.stringify(inspected));
    f.entry.message.details = inspected.details;
    const material = await f.ok("materials", {
      reference: inspected.details.result.reference,
    });
    if (mode === "commit") assert.equal(material.phase, "empty");
    else {
      const terminal = await f.ok("plan", { reference: material.reference });
      assert.equal(
        terminal.phase,
        mode === "pr" ? "existing_pr" : "already_pushed",
      );
      assert.equal(terminal.cleanup.complete, true);
      assert.equal(terminal.commitCreated, false);
    }
  }
});

await test("commit_workflow preserves validated responses after cancellation or abnormal exit without treating exit-schema mismatches as success", async (t) => {
  const f = await workflowFixture(t);
  const materials = await f.ok("materials", { reference: f.reference });
  const plan = await f.ok("plan", {
    reference: materials.reference,
    message: "docs: response boundary\n",
  });
  // These child responses exercise validation, not actual commit success.
  const failure = {
    error: "commit_verification_failed",
    commitVerified: false,
    prAttempted: false,
    prVerified: false,
    pushAttempted: false,
    pushSucceeded: false,
    pushVerified: false,
    upstreamConfigured: false,
    remoteMayHaveChanged: false,
    operationMayHaveSucceeded: true,
    commitSucceeded: true,
    branchMayHaveChanged: false,
    branchCreated: false,
    stagedChangesPreserved: true,
    observed: { branch: "main", head: "a".repeat(40) },
    cleanup: { complete: false, remaining: [plan.reference.directory] },
  };
  const success = {
    phase: "committed",
    commit: "a".repeat(40),
    branch: "main",
    branchCreated: false,
    tree: plan.tree,
    parents: [plan.parent],
    messageDigest: "b".repeat(64),
    scanner: plan.scanner,
    cleanup: { complete: true, remaining: [] },
  };
  const before = {
    head: f.git("rev-parse", "HEAD"),
    index: readFileSync(join(f.repo, ".git/index")),
    state: readFileSync(
      join(plan.reference.directory, Object.keys(plan.reference.files)[0]),
    ),
  };
  const { workflow, fixedScripts } = await faultWorkflow(f, "");
  for (const { name, output, exitCode, retained } of [
    {
      name: "cancel failure",
      output: JSON.stringify({ ...failure, stderr: "SECRET_CHILD_OUTPUT" }),
      exitCode: null,
      retained: failure,
    },
    {
      name: "cancel success",
      output: JSON.stringify(success),
      exitCode: null,
      retained: success,
    },
    {
      name: "cancel invalid failure",
      output: JSON.stringify({
        ...failure,
        commitSucceeded: "SECRET_BAD_TYPE",
      }),
      exitCode: null,
      retained: undefined,
    },
    {
      name: "cancel broken JSON",
      output: '{"error":"SECRET_BROKEN"',
      exitCode: null,
      retained: undefined,
    },
    {
      name: "abnormal failure",
      output: JSON.stringify(failure),
      exitCode: 2,
      retained: failure,
    },
    {
      name: "exit zero failure",
      output: JSON.stringify(failure),
      exitCode: 0,
      retained: undefined,
    },
    {
      name: "exit one success",
      output: JSON.stringify(success),
      exitCode: 1,
      retained: undefined,
    },
  ]) {
    const marker = join(f.owned, `${name}-written`);
    writeFileSync(
      join(fixedScripts, "commit-workflow.ts"),
      `
      import { readFileSync, writeFileSync, renameSync } from "node:fs";
      readFileSync(0);
      process.stdout.write(${JSON.stringify(output)}, () => {
        writeFileSync(${JSON.stringify(marker + ".tmp")}, String(process.pid));
        renameSync(${JSON.stringify(marker + ".tmp")}, ${JSON.stringify(marker)});
        ${exitCode === null ? "setInterval(() => {}, 1000);" : `process.exitCode = ${exitCode};`}
      });
    `,
    );
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000);
    let result;
    try {
      const pending = f.call(
        "execute",
        { reference: plan.reference },
        controller.signal,
        workflow,
      );
      if (exitCode === null) {
        for (let i = 0; i < 500 && !existsSync(marker); i++)
          await new Promise((r) => setTimeout(r, 10));
        controller.abort();
      }
      result = await pending;
    } finally {
      clearTimeout(deadline);
    }
    assert.equal(existsSync(marker), true, name);
    const pid = Number(readFileSync(marker, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0, name);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, name);
    assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" }, name);
    assert.equal(result.isError, true, name);
    assert.equal(
      result.details.error,
      exitCode === null ? "cancelled" : "workflow_result_unknown",
      name,
    );
    assert.equal(result.details.processExitConfirmed, true, name);
    assert.equal(result.details.inputCorrectionAllowed, undefined, name);
    assert.deepEqual(result.details.result, retained, name);
    assert.deepEqual(JSON.parse(result.content[0].text), result.details, name);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    assert.deepEqual(f.git("rev-parse", "HEAD"), before.head, name);
    assert.deepEqual(
      readFileSync(join(f.repo, ".git/index")),
      before.index,
      name,
    );
    assert.deepEqual(
      readFileSync(
        join(plan.reference.directory, Object.keys(plan.reference.files)[0]),
      ),
      before.state,
      name,
    );
  }
  await f.ok("cleanup", { reference: plan.reference });
});

await test("commit_workflow automatic read returns the bounded JSON once and follows cursors", async (t) => {
  const f = await workflowFixture(
    t,
    "commit-main",
    '日本語😀"\\\n'.repeat(6000),
  );
  const materials = await f.ok("materials", { reference: f.reference });
  const ref = materials.reference;
  const expected = readFileSync(join(ref.directory, "diff.bin"));
  const chunks = [];
  let cursor;
  do {
    const response = await f.call("read", {
      reference: ref,
      ...(cursor ? { cursor } : { materials: ["diff", "files"] }),
    });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.equal(response.content.length, 1);
    assert.deepEqual(JSON.parse(response.content[0].text), response.details);
    assert.ok(Buffer.byteLength(response.content[0].text) <= 32768);
    const beforeRender = JSON.stringify(response);
    const workflow = tools.get("commit_workflow");
    const collapsed = workflow.renderResult(response, {}, {}, { outputPad: 1 });
    assert.ok(collapsed.text.length < 200);
    assert.equal(
      workflow.renderResult(response, { expanded: true }, {}, { outputPad: 1 })
        .text,
      response.content[0].text,
    );
    assert.equal(JSON.stringify(response), beforeRender);
    for (const part of response.details.parts)
      if (part.name === "diff")
        chunks.push(Buffer.from(part.text, part.encoding));
    cursor = response.details.next;
  } while (cursor);
  assert.deepEqual(Buffer.concat(chunks), expected);
  await f.ok("cleanup", { reference: ref });
});

await test("commit_workflow rejects mixed automatic input before child start and malformed page responses", async (t) => {
  const f = await workflowFixture(t, "commit-main", "日本語😀\n".repeat(6000));
  const materials = await f.ok("materials", { reference: f.reference });
  const reference = materials.reference;
  const rejected = await f.call("read", {
    reference,
    materials: ["diff"],
    parts: [],
  });
  assert.equal(rejected.details.childStarted, false);
  assert.equal(rejected.details.inputCorrectionAllowed, true);
  assert.equal(existsSync(join(reference.directory, "diff.bin")), true);
  const page = await f.ok("read", { reference, materials: ["diff"] });
  const { workflow, fixedScripts } = await faultWorkflow(f, "");
  for (const data of [
    { ...page, done: true },
    { ...page, unread: [] },
    { ...page, next: { ...page.next, offset: page.next.offset + 1 } },
    { ...page, parts: [] },
    { ...page, reference },
  ]) {
    writeFileSync(
      join(fixedScripts, "commit-workflow.ts"),
      `console.log(${JSON.stringify(JSON.stringify(data))});`,
    );
    const result = await f.call(
      "read",
      { reference, materials: ["diff"] },
      undefined,
      workflow,
    );
    assert.equal(result.isError, true);
    assert.equal(result.details.error, "workflow_result_unknown");
    assert.equal(existsSync(reference.directory), true);
  }
  const continuation = await f.ok("read", { reference, cursor: page.next });
  writeFileSync(
    join(fixedScripts, "commit-workflow.ts"),
    `console.log(${JSON.stringify(JSON.stringify(continuation))});`,
  );
  const mismatched = await f.call(
    "read",
    { reference, cursor: { ...page.next, binding: "0".repeat(64) } },
    undefined,
    workflow,
  );
  assert.equal(mismatched.isError, true);
  assert.equal(mismatched.details.error, "workflow_result_unknown");
  await f.ok("cleanup", { reference });
});

await test("commit_workflow explicitly reports unfit initial metadata with owned cleanup, not read recovery", async (t) => {
  const f = await workflowFixture(t, "commit", "pending\n", {
    newBranch: "x".repeat(34000),
  });
  const result = await f.call("materials", { reference: f.reference });
  assert.equal(result.isError, true);
  assert.equal(result.details.error, "material_metadata_budget_exceeded");
  assert.deepEqual(result.details.cleanup, { complete: true, remaining: [] });
  assert.equal(result.details.materialsPreserved, undefined);
  assert.equal(existsSync(f.reference.directory), false);
  assert.equal(f.git("rev-list", "--count", "HEAD").toString().trim(), "1");
});

await test("commit_workflow destinations starts with discovery without inspect history and never prepares private state", async (t) => {
  const f = inspectFixture(t);
  f.git("remote", "add", "backup", "https://example.invalid/owner/repo.git");
  const index = readFileSync(join(f.repo, ".git/index"));
  const config = readFileSync(join(f.repo, ".git/config"));
  process.env.BUN_OPTIONS = "--preload=SECRET_STARTUP";
  process.env.NODE_OPTIONS = "--require=SECRET_STARTUP";
  const workflow = tools.get("commit_workflow");
  const call = (input, operation = "destinations") =>
    workflow.execute(
      "destinations",
      { repository: f.repo, operation, input },
      undefined,
      undefined,
      {
        mode: "rpc",
        sessionManager: {
          getBranch() {
            assert.fail("destinations must not consult inspect history");
          },
        },
      },
    );
  const result = await call({ mode: "pr", scope: { kind: "staged" } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.content[0].text), result.details);
  assert.equal(result.details.needed, true);
  assert.deepEqual(result.details.basis, {
    source: "singleRemote",
    remote: "backup",
  });
  assert.equal(
    result.details.remotes[0].repository,
    "example.invalid/owner/repo",
  );
  assert.equal(result.details.reference, undefined);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
  assert.equal(
    readdirSync(f.owned).some((name) => name.startsWith("pi-commit-")),
    false,
  );
  for (const input of [
    {},
    { mode: "commit" },
    { mode: "push", reference: {} },
    { mode: "push", scope: { kind: "all", raw: "SECRET" } },
  ]) {
    const denied = await call(input);
    assert.equal(denied.details.error, "input_rejected");
    assert.equal(denied.details.childStarted, false);
  }
  const mutation = await call({ reference: {} }, "execute");
  assert.equal(mutation.details.error, "input_rejected");
});
await test("destinations result validator rejects raw fields and credential URLs at the public boundary", async (t) => {
  const f = inspectFixture(t);
  f.git("remote", "add", "backup", "https://example.invalid/owner/repo.git");
  const result = await tools.get("commit_workflow").execute(
    "destinations",
    {
      repository: f.repo,
      operation: "destinations",
      input: { mode: "push" },
    },
    undefined,
    undefined,
    { mode: "rpc" },
  );
  assert.notEqual(result.isError, true);
  const { workflowResult } = await import(
    "../extensions/commit-workflow-validation.js"
  );
  for (const mutate of [
    (v) => {
      v.rawConfig = "SECRET";
    },
    (v) => {
      v.remotes[0].rawSsh = "SECRET";
    },
    (v) => {
      v.remotes[0].url = "https://SECRET@example.invalid/owner/repo";
    },
    (v) => {
      v.remotes[0].url = "ssh://git:SECRET@example.invalid/owner/repo";
    },
    (v) => {
      v.config.branchRemote.values = [{ kind: "invalid", raw: "SECRET" }];
    },
    (v) => {
      v.config.branchPushRemote = {
        state: "single",
        values: [
          { kind: "value", value: "https://TOKEN@example.invalid/owner/repo" },
        ],
      };
    },
    (v) => {
      v.reasons = ["SECRET"];
    },
  ]) {
    const value = structuredClone(result.details);
    mutate(value);
    assert.throws(
      () =>
        workflowResult(value, "destinations", undefined, 0, { mode: "push" }),
      /Invalid workflow result/,
    );
  }
});

await test("commit_workflow destinations sanitizes unmatched config while preserving observed Unicode remote evidence", async (t) => {
  const f = inspectFixture(t);
  f.git("remote", "add", "共有@work", "/owned/local.git");
  const call = () =>
    tools.get("commit_workflow").execute(
      "destinations",
      {
        repository: f.repo,
        operation: "destinations",
        input: { mode: "push" },
      },
      undefined,
      undefined,
      { mode: "rpc" },
    );
  f.git(
    "config",
    "branch.main.pushRemote",
    "https://TOKEN@example.invalid/owner/repo",
  );
  const denied = await call();
  assert.notEqual(denied.isError, true, JSON.stringify(denied));
  assert.deepEqual(denied.details.config.branchPushRemote.values, [
    { kind: "missingRemote" },
  ]);
  assert.doesNotMatch(JSON.stringify(denied), /TOKEN|https:/);
  f.git("config", "branch.main.pushRemote", "共有@work");
  const control = await call();
  assert.notEqual(control.isError, true, JSON.stringify(control));
  assert.deepEqual(control.details.basis, {
    source: "branchPushRemote",
    remote: "共有@work",
  });
});
