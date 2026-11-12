import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  configurePrFixture,
  fixtureRepository,
} from "../.pi/skills/verify-project/scripts/pr-fixture.ts";

const scripts = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../skills/commit/scripts",
);
const bun =
  process.env.VERIFY_BUN ??
  spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim();

function fixture(t: { after: (fn: () => void) => void }, unborn = false) {
  const owned = mkdtempSync(join(tmpdir(), "commit-workflow-test-"));
  t.after(() => rmSync(owned, { recursive: true, force: true }));
  const repo = join(owned, "repo");
  mkdirSync(repo);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: owned,
    TMPDIR: owned,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  delete env.BUN_OPTIONS;
  delete env.NODE_OPTIONS;
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, env });
    assert.equal(result.status, 0, `fixture git ${args[0]} failed`);
    return result.stdout.toString().trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Test User");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "example.txt"), "base\n");
  if (!unborn) {
    git("add", "example.txt");
    git("commit", "-m", "docs: add example");
  }
  const cli = (command: string, input: unknown = {}) => {
    const launchEnv = { ...env };
    delete launchEnv.BUN_OPTIONS;
    delete launchEnv.NODE_OPTIONS;
    const result = spawnSync(
      bun,
      [
        "--config=" + join(scripts, "bunfig.toml"),
        "--env-file=/dev/null",
        "--no-install",
        join(scripts, "commit-workflow.ts"),
        command,
        "--repository",
        repo,
      ],
      { cwd: scripts, env: launchEnv, input: JSON.stringify(input) },
    );
    assert.equal(result.stderr.toString(), "");
    return {
      exit: result.status,
      value: JSON.parse(result.stdout.toString()) as Record<string, unknown>,
    };
  };
  return { owned, repo, git, cli, env };
}

for (const [kind, payload] of [
  ["invalid UTF-8", Buffer.from('{"message":"SECRET_INPUT\xff"}', "binary")],
  ["invalid JSON", Buffer.from('{"SECRET_INPUT":')],
  ["nonobject JSON", Buffer.from('["SECRET_INPUT"]')],
] as const) {
  await test(`public stdin rejects ${kind} without echo or Git mutation`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const before = {
      head: f.git("rev-parse", "HEAD"),
      refs: f.git("show-ref"),
      index: readFileSync(join(f.repo, ".git/index")),
    };
    const result = spawnSync(
      bun,
      [
        "--config=" + join(scripts, "bunfig.toml"),
        "--env-file=/dev/null",
        "--no-install",
        join(scripts, "commit-workflow.ts"),
        "inspect",
        "--repository",
        f.repo,
      ],
      { cwd: scripts, env: f.env, input: payload },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr.toString(), "");
    const response = JSON.parse(result.stdout.toString());
    assert.equal(
      response.error,
      kind === "nonobject JSON" ? "invalid_input" : "workflow_failed",
    );
    assert.equal(response.commitSucceeded, false);
    assert.equal(response.pushAttempted, false);
    assert.equal(response.prAttempted, false);
    assert.doesNotMatch(
      result.stdout.toString(),
      /SECRET_INPUT|Traceback|SyntaxError/,
    );
    assert.equal(f.git("rev-parse", "HEAD"), before.head);
    assert.equal(f.git("show-ref"), before.refs);
    assert.deepEqual(readFileSync(join(f.repo, ".git/index")), before.index);
    assert.equal(
      readFileSync(join(f.repo, "example.txt"), "utf8"),
      "pending\n",
    );
  });
}

await test("inspect prioritizes the unique local remote default over main fallback", (t) => {
  const f = fixture(t);
  f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
  f.git("update-ref", "refs/remotes/origin/develop", "HEAD");
  f.git(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/develop",
  );
  const result = f.cli("inspect");
  assert.equal(result.exit, 0);
  assert.deepEqual(result.value.default, {
    kind: "unique",
    candidates: ["develop"],
    reasons: [],
    currentIsDefault: false,
  });
});

await test("plan retains the fixed message bytes before approval", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "base\nlocal example\n");
  const inspected = f.cli("inspect");
  const materials = f.cli("materials", {
    reference: inspected.value.reference,
  });
  assert.equal(materials.exit, 0);
  const message =
    "docs: preserve 'quotes' $(touch unwanted)\n\nKeep `code` and $HOME.\n\n";
  const planned = f.cli("plan", {
    reference: materials.value.reference,
    message,
  });
  assert.equal(planned.exit, 0);
  assert.equal(planned.value.message, message);
  const ref = planned.value.reference as {
    directory: string;
    files: Record<string, unknown>;
  };
  assert.equal(
    Object.keys(ref.files).some((name) => name.endsWith(".bin")),
    false,
  );
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
  const retained = Object.keys(ref.files)
    .map((name) => readFileSync(join(ref.directory, name), "utf8"))
    .join("\n");
  assert.equal(retained.includes(JSON.stringify(message)), true);
});

for (const mode of [
  "absent",
  "conflict",
  "broken",
  "orphan",
  "non-symbolic",
  "reverse-mapped",
  "excluded",
  "unmapped",
] as const) {
  await test(`inspect classifies ${mode} local default evidence without fallback misuse`, (t) => {
    const f = fixture(t);
    if (mode !== "absent") {
      if (mode !== "orphan")
        f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
      f.git("update-ref", "refs/remotes/origin/alias", "HEAD");
      if (mode === "reverse-mapped")
        f.git(
          "config",
          "remote.origin.fetch",
          "+refs/heads/main:refs/remotes/origin/alias",
        );
      if (mode === "unmapped")
        f.git(
          "config",
          "remote.origin.fetch",
          "+refs/heads/*:refs/elsewhere/*",
        );
      if (mode === "excluded")
        f.git("config", "--add", "remote.origin.fetch", "^refs/heads/alias");
      if (mode === "non-symbolic")
        f.git("update-ref", "refs/remotes/origin/HEAD", "HEAD");
      else
        f.git(
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          `refs/remotes/origin/${mode === "broken" ? "missing" : "alias"}`,
        );
      if (mode === "conflict") {
        f.git("remote", "add", "backup", "https://example.invalid/backup.git");
        f.git("update-ref", "refs/remotes/backup/develop", "HEAD");
        f.git(
          "symbolic-ref",
          "refs/remotes/backup/HEAD",
          "refs/remotes/backup/develop",
        );
      }
    }
    const result = f.cli("inspect");
    assert.equal(result.exit, 0);
    const classification = result.value.default as {
      kind: string;
      currentIsDefault: boolean;
      reasons: string[];
    };
    assert.equal(
      classification.kind,
      mode === "absent"
        ? "absent"
        : mode === "reverse-mapped"
          ? "unique"
          : "ambiguous",
    );
    assert.equal(
      classification.currentIsDefault,
      mode === "absent" || mode === "reverse-mapped",
    );
    if (classification.kind === "ambiguous") {
      const before = f.git("ls-files", "--stage");
      const stopped = f.cli("materials", { reference: result.value.reference });
      assert.equal(stopped.value.error, "default_answer_required");
      assert.equal(f.git("ls-files", "--stage"), before);
    }
  });
}

await test("default evidence drift after inspect stops before Stage", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  const inspected = f.cli("inspect");
  f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
  const stopped = f.cli("materials", { reference: inspected.value.reference });
  assert.equal(stopped.value.error, "repository_drift");
  assert.equal(f.git("diff", "--cached"), "");
});

function prepare(f: ReturnType<typeof fixture>, input: unknown = {}) {
  const inspected = f.cli("inspect", input);
  assert.equal(inspected.exit, 0);
  const materials = f.cli("materials", {
    reference: inspected.value.reference,
  });
  assert.equal(materials.exit, 0, JSON.stringify(materials.value));
  return materials;
}
function plan(
  f: ReturnType<typeof fixture>,
  message = "docs: local example\n",
  input: unknown = {},
) {
  const materials = prepare(f, input);
  const result = f.cli("plan", {
    reference: materials.value.reference,
    message,
  });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  return result;
}

await test("execute uses retained message with normal hooks and verifies the actual Git commit", (t) => {
  const f = fixture(t);
  const parent = f.git("rev-parse", "HEAD");
  const special = ":(glob)literal\n ' $ file.txt";
  writeFileSync(join(f.repo, special), "local\n");
  const message = "docs: preserve $HOME and 'quotes'\n\nFixed bytes.\n\n";
  const planned = plan(f, message);
  const hook = join(f.repo, ".git/hooks/pre-commit");
  writeFileSync(hook, "#!/bin/sh\nprintf called > hook-called\n");
  chmodSync(hook, 0o700);
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  assert.equal(result.value.phase, "committed");
  assert.equal(f.git("branch", "--show-current"), "main");
  assert.equal(f.git("rev-parse", "HEAD^"), parent);
  assert.equal(f.git("rev-parse", "HEAD^{tree}"), planned.value.tree);
  const raw = spawnSync("git", ["cat-file", "commit", "HEAD"], {
    cwd: f.repo,
    env: f.env,
  }).stdout;
  assert.equal(raw.subarray(raw.indexOf("\n\n") + 2).toString(), message);
  assert.equal(readFileSync(join(f.repo, "hook-called"), "utf8"), "called");
  assert.equal(f.git("show", `HEAD:${special}`), "local");
});

await test("all includes partial Stage remainder and keeps a pure staged deletion", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "delete.txt"), "delete\n");
  f.git("add", "delete.txt");
  f.git("commit", "-m", "docs: add deletion fixture");
  writeFileSync(join(f.repo, "example.txt"), "first\n");
  f.git("add", "example.txt");
  writeFileSync(join(f.repo, "example.txt"), "first\nremainder\n");
  f.git("rm", "delete.txt");
  const planned = plan(f);
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  assert.equal(f.git("show", "HEAD:example.txt"), "first\nremainder");
  assert.equal(f.git("ls-tree", "--name-only", "HEAD"), "example.txt");
});

await test("literal scope preserves other worktree changes and asks about existing outside Stage", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  writeFileSync(join(f.repo, "other.txt"), "other\n");
  f.git("add", "other.txt");
  const before = f.git("ls-files", "--stage");
  const inspected = f.cli("inspect", {
    scope: { kind: "paths", paths: ["example.txt"] },
  });
  assert.deepEqual(
    (inspected.value.questions as { outsideStaged: string[] }).outsideStaged,
    ["other.txt"],
  );
  const stopped = f.cli("materials", { reference: inspected.value.reference });
  assert.equal(stopped.value.error, "outside_staged_answer_required");
  assert.equal(f.git("ls-files", "--stage"), before);
  const fresh = f.cli("inspect", {
    scope: { kind: "paths", paths: ["example.txt"] },
  });
  const materials = f.cli("materials", {
    reference: fresh.value.reference,
    includeOutsideStaged: true,
  });
  assert.equal(materials.exit, 0);
  assert.match((materials.value.diff as { text: string }).text, /other.txt/);
});

await test("staged-only keeps unstaged remainder out of the commit", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "first\n");
  f.git("add", "example.txt");
  writeFileSync(join(f.repo, "example.txt"), "first\nremainder\n");
  const planned = plan(f, "docs: staged only", { scope: { kind: "staged" } });
  assert.equal(
    f.cli("execute", { reference: planned.value.reference }).exit,
    0,
  );
  assert.equal(f.git("show", "HEAD:example.txt"), "first");
  assert.match(f.git("diff"), /remainder/);
});

await test("plan revision invalidates the old reference and retains the revised bytes", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  const first = plan(f, "docs: first\n");
  const second = f.cli("plan", {
    reference: first.value.reference,
    message: "docs: revised\n\n",
  });
  assert.equal(second.exit, 0);
  assert.equal(second.value.message, "docs: revised\n\n");
  assert.equal(f.cli("execute", { reference: first.value.reference }).exit, 1);
  assert.equal(f.cli("execute", { reference: second.value.reference }).exit, 0);
});

await test("execute refuses message overrides and preserves Stage", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  const planned = plan(f);
  const stopped = f.cli("execute", {
    reference: planned.value.reference,
    message: "not approved",
  });
  assert.equal(stopped.value.error, "execute_accepts_reference_only");
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
  assert.match(f.git("diff", "--cached"), /changed/);
});

await test("default drift after plan is rejected without commit", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  const planned = plan(f);
  f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
  const stopped = f.cli("execute", { reference: planned.value.reference });
  assert.equal(stopped.value.error, "repository_drift");
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
});

await test("private files reject replacement and keep unknown sentinels on cleanup", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  const materials = prepare(f);
  const ref = materials.value.reference as {
    directory: string;
    files: Record<string, unknown>;
  };
  assert.equal(lstatSync(ref.directory).mode & 0o777, 0o700);
  for (const name of Object.keys(ref.files))
    assert.equal(lstatSync(join(ref.directory, name)).mode & 0o777, 0o600);
  const sentinel = join(ref.directory, "unknown");
  writeFileSync(sentinel, "keep\n");
  const result = f.cli("cleanup", { reference: ref });
  assert.equal(result.exit, 0);
  assert.equal((result.value.cleanup as { complete: boolean }).complete, false);
  assert.equal(readFileSync(sentinel, "utf8"), "keep\n");
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
});

await test("private bytes or symlink substitution is rejected without deleting the replacement", (t) => {
  const f = fixture(t);
  const inspected = f.cli("inspect");
  const ref = inspected.value.reference as {
    directory: string;
    files: Record<string, unknown>;
  };
  const file = join(ref.directory, Object.keys(ref.files)[0]);
  rmSync(file);
  const sentinel = join(f.owned, "sentinel");
  writeFileSync(sentinel, "keep\n");
  symlinkSync(sentinel, file);
  assert.equal(f.cli("materials", { reference: ref }).exit, 1);
  assert.equal(lstatSync(file).isSymbolicLink(), true);
  assert.equal(readFileSync(sentinel, "utf8"), "keep\n");
});

for (const mode of ["pass", "detect", "failure"] as const) {
  await test(`whole Staged scanner ${mode} never exposes child output`, (t) => {
    const f = fixture(t);
    const bin = join(f.owned, "bin");
    mkdirSync(bin);
    const scanner = join(bin, "gitleaks");
    writeFileSync(
      scanner,
      `#!/bin/sh\ncat > '${f.owned}/scanned'\nprintf 'DO-NOT-EXPOSE-SCANNER'\nexit ${mode === "pass" ? 0 : mode === "detect" ? 1 : 2}\n`,
    );
    chmodSync(scanner, 0o700);
    f.env.PATH = `${bin}:${f.env.PATH}`;
    writeFileSync(join(f.repo, "example.txt"), "scan everything\n");
    const inspected = f.cli("inspect");
    const materials = f.cli("materials", {
      reference: inspected.value.reference,
    });
    assert.equal(
      JSON.stringify(materials.value).includes("DO-NOT-EXPOSE-SCANNER"),
      false,
    );
    assert.match(
      readFileSync(join(f.owned, "scanned"), "utf8"),
      /scan everything/,
    );
    assert.equal(materials.exit, mode === "pass" ? 0 : 1);
    assert.equal(
      mode === "pass" ? materials.value.scanner : materials.value.error,
      mode === "pass" ? "passed" : "staged_secret_scan_failed",
    );
  });
}

for (const mode of ["fail", "rewrite"] as const) {
  await test(`normal commit hook ${mode} stops and distinguishes possible commit from verification failure`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.repo, "example.txt"), "changed\n");
    const planned = plan(f);
    const hook = join(
      f.repo,
      `.git/hooks/${mode === "fail" ? "pre-commit" : "commit-msg"}`,
    );
    writeFileSync(
      hook,
      mode === "fail"
        ? "#!/bin/sh\necho DO-NOT-EXPOSE-HOOK >&2\nexit 1\n"
        : "#!/bin/sh\nprintf 'changed by hook\\n' > \"$1\"\n",
    );
    chmodSync(hook, 0o700);
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 1);
    assert.equal(
      result.value.error,
      mode === "fail" ? "commit_failed" : "commit_verification_failed",
    );
    assert.equal(result.value.commitSucceeded, mode === "rewrite");
    assert.equal(result.value.operationMayHaveSucceeded, true);
    assert.equal(
      JSON.stringify(result.value).includes("DO-NOT-EXPOSE-HOOK"),
      false,
    );
    assert.equal(
      f.git("rev-list", "--count", "HEAD"),
      mode === "fail" ? "1" : "2",
    );
  });
}

await test("large materials disclose omission and allow several fixed ranges in one read", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.repo, "example.txt"),
    Array.from(
      { length: 1000 },
      (_, i) => `line ${i}: ${"x".repeat(64)}\n`,
    ).join(""),
  );
  const materials = prepare(f);
  assert.equal(materials.value.displayed, false);
  const read = f.cli("read", {
    reference: materials.value.reference,
    parts: [
      { name: "diff", offset: 0, length: 300 },
      { name: "diff", offset: 400, length: 300 },
    ],
  });
  assert.equal(read.exit, 0);
  assert.equal((read.value.parts as unknown[]).length, 2);
  const released = f.cli("release", { reference: materials.value.reference });
  assert.equal(released.value.payloadRemoved, true);
  const planned = f.cli("plan", {
    reference: released.value.reference,
    message: "docs: large example\n",
  });
  assert.equal(planned.exit, 0);
  const ref = planned.value.reference as { directory: string };
  assert.equal(existsSync(join(ref.directory, "diff.bin")), false);
});

for (const mode of ["commit", "commit-main"] as const) {
  await test(`${mode} preserves materials on display overflow and allows smaller reads before commit`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.repo, "example.txt"), '"\\\n'.repeat(20000));
    const materials = prepare(f, { mode });
    assert.equal(materials.value.displayed, false);
    const ref = materials.value.reference as {
      directory: string;
      files: Record<string, unknown>;
    };
    const files = Object.fromEntries(
      Object.keys(ref.files).map((name) => [
        name,
        readFileSync(join(ref.directory, name)),
      ]),
    );
    const head = f.git("rev-parse", "HEAD");
    const refs = f.git("show-ref");
    const index = readFileSync(join(f.repo, ".git/index"));
    for (const length of [24000, 33000]) {
      const stopped = f.cli("read", {
        reference: ref,
        parts: [{ name: "diff", offset: 0, length }],
      });
      assert.equal(stopped.exit, 1);
      assert.equal(stopped.value.error, "material_display_budget_exceeded");
      assert.equal(stopped.value.materialsPreserved, true);
      assert.deepEqual(stopped.value.reference, ref);
      assert.equal(stopped.value.cleanup, undefined);
      assert.equal(stopped.value.parts, undefined);
      assert.equal(stopped.value.commitSucceeded, false);
      assert.equal(stopped.value.branchCreated, false);
      for (const [name, bytes] of Object.entries(files))
        assert.deepEqual(readFileSync(join(ref.directory, name)), bytes);
      const read = f.cli("read", {
        reference: stopped.value.reference,
        parts: [{ name: "diff", offset: 0, length: 1000 }],
      });
      assert.equal(read.exit, 0);
      assert.equal(read.value.fixed, true);
      assert.ok(Buffer.byteLength(JSON.stringify(read.value)) <= 32 * 1024);
      assert.equal(f.git("rev-parse", "HEAD"), head);
      assert.equal(f.git("show-ref"), refs);
      assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
    }
    const planned = f.cli("plan", {
      reference: ref,
      message: "test: retain materials after oversized read\n",
      ...(mode === "commit" ? { newBranch: "test/material-read" } : {}),
    });
    assert.equal(planned.exit, 0, JSON.stringify(planned.value));
    const executed = f.cli("execute", { reference: planned.value.reference });
    assert.equal(executed.exit, 0, JSON.stringify(executed.value));
    assert.equal(executed.value.phase, "committed");
    assert.equal(f.git("rev-list", "--count", "HEAD"), "2");
    assert.equal(existsSync(ref.directory), false);
  });
}

await test("invalid material ranges still clean up preparations without committing", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const materials = prepare(f);
  const ref = materials.value.reference as { directory: string };
  const stopped = f.cli("read", {
    reference: ref,
    parts: [{ name: "diff", offset: 0, length: 100000 }],
  });
  assert.equal(stopped.exit, 1);
  assert.equal(stopped.value.error, "invalid_material_request");
  assert.equal(stopped.value.materialsPreserved, undefined);
  assert.equal(stopped.value.reference, undefined);
  assert.deepEqual(stopped.value.cleanup, { complete: true, remaining: [] });
  assert.equal(existsSync(ref.directory), false);
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
  assert.equal(f.git("show", ":example.txt"), "pending");
});

await test("trusted Bun launch and probe ignore repository, home and environment startup payloads", (t) => {
  const f = fixture(t);
  const marker = join(f.owned, "startup-marker");
  const preload = join(f.owned, "preload.js");
  writeFileSync(
    preload,
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`,
  );
  writeFileSync(
    join(f.repo, "bunfig.toml"),
    `preload = [${JSON.stringify(preload)}]\n`,
  );
  writeFileSync(
    join(f.owned, ".bunfig.toml"),
    `preload = [${JSON.stringify(preload)}]\n`,
  );
  writeFileSync(join(f.repo, ".env"), `BUN_OPTIONS=--preload=${preload}\n`);
  f.env.BUN_OPTIONS = `--preload=${preload}`;
  f.env.NODE_OPTIONS = `--import=${preload}`;
  assert.equal(f.cli("inspect").exit, 0);
  const safeEnv = { ...f.env };
  delete safeEnv.BUN_OPTIONS;
  delete safeEnv.NODE_OPTIONS;
  const probe = spawnSync(
    bun,
    [
      "--config=" + join(scripts, "bunfig.toml"),
      "--env-file=/dev/null",
      "--no-install",
      "--version",
    ],
    { cwd: scripts, env: safeEnv },
  );
  assert.equal(probe.status, 0);
  assert.equal(probe.stderr.toString(), "");
  assert.equal(existsSync(marker), false);
  const missing = spawnSync(
    bun,
    [
      "--config=" + join(scripts, "bunfig.toml"),
      "--env-file=/dev/null",
      "--no-install",
      join(scripts, "commit-workflow.ts"),
      "inspect",
    ],
    { cwd: scripts, env: safeEnv, input: "{}" },
  );
  assert.equal(missing.status, 1);
  assert.equal(
    JSON.parse(missing.stdout.toString()).error,
    "absolute_repository_required",
  );
});

await test("dirty nested submodule is rejected before parent Stage without committing inside it", (t) => {
  const f = fixture(t);
  const child = join(f.owned, "child");
  mkdirSync(child);
  const childGit = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: child, env: f.env });
    assert.equal(result.status, 0);
    return result.stdout.toString().trim();
  };
  childGit("init", "-b", "main");
  childGit("config", "user.name", "Test User");
  childGit("config", "user.email", "test@example.invalid");
  childGit("config", "commit.gpgsign", "false");
  writeFileSync(join(child, "child.txt"), "base\n");
  childGit("add", "child.txt");
  childGit("commit", "-m", "docs: child");
  f.git(
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    child,
    "nested",
  );
  f.git("commit", "-m", "docs: submodule");
  writeFileSync(join(f.repo, "nested/child.txt"), "dirty\n");
  writeFileSync(join(f.repo, "example.txt"), "pending parent\n");
  const inspected = f.cli("inspect");
  const stopped = f.cli("materials", { reference: inspected.value.reference });
  assert.equal(stopped.value.error, "dirty_submodule");
  assert.equal(f.git("diff", "--cached"), "");
  assert.equal(childGit("rev-list", "--count", "HEAD"), "1");
});

await test("ambiguous default answer cannot authorize a different current work branch", (t) => {
  const f = fixture(t);
  f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
  f.git(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/missing",
  );
  writeFileSync(join(f.repo, "example.txt"), "changed\n");
  const inspected = f.cli("inspect");
  const stopped = f.cli("materials", {
    reference: inspected.value.reference,
    defaultBranch: "develop",
  });
  assert.equal(stopped.value.error, "current_branch_is_not_default");
  assert.equal(f.git("diff", "--cached"), "");
});

await test("private references cannot cross repositories or survive content replacement", (t) => {
  const f = fixture(t);
  const other = fixture(t);
  const inspected = f.cli("inspect");
  const ref = inspected.value.reference as {
    directory: string;
    files: Record<string, unknown>;
  };
  assert.equal(
    other.cli("materials", { reference: ref }).value.error,
    "invalid_reference",
  );
  const file = join(ref.directory, Object.keys(ref.files)[0]);
  writeFileSync(file, "different bytes\n");
  assert.equal(
    f.cli("materials", { reference: ref }).value.error,
    "private_file_changed",
  );
  assert.equal(readFileSync(file, "utf8"), "different bytes\n");
});

await test("suspicious literal paths require an answer before Stage even with all selected", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, ".env.example"), "FIXTURE_PLACEHOLDER=value\n");
  const inspected = f.cli("inspect");
  assert.deepEqual(
    (inspected.value.questions as { suspicious: string[] }).suspicious,
    [".env.example"],
  );
  const stopped = f.cli("materials", { reference: inspected.value.reference });
  assert.equal(stopped.value.error, "suspicious_paths_answer_required");
  assert.equal(f.git("diff", "--cached"), "");
});

await test("a different run reference is refused without deleting the original run", (t) => {
  const f = fixture(t);
  const inspected = f.cli("inspect");
  const ref = inspected.value.reference as {
    run: string;
    directory: string;
    files: Record<string, unknown>;
  };
  const stopped = f.cli("cleanup", {
    reference: { ...ref, run: "different-run" },
  });
  assert.equal(stopped.value.error, "private_run_mismatch");
  assert.equal(
    existsSync(join(ref.directory, Object.keys(ref.files)[0])),
    true,
  );
  assert.equal(f.cli("cleanup", { reference: ref }).exit, 0);
});

await test("literal path commit leaves out-of-scope untracked work untouched", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "scoped change\n");
  writeFileSync(join(f.repo, "other.txt"), "keep outside\n");
  const planned = plan(f, "docs: scoped\n", {
    scope: { kind: "paths", paths: ["example.txt"] },
  });
  assert.equal(
    f.cli("execute", { reference: planned.value.reference }).exit,
    0,
  );
  assert.equal(f.git("ls-tree", "--name-only", "HEAD"), "example.txt");
  assert.equal(
    readFileSync(join(f.repo, "other.txt"), "utf8"),
    "keep outside\n",
  );
  assert.match(f.git("status", "--porcelain"), /\?\? other.txt/);
});

await test("pure staged rename does not re-add the missing original path", (t) => {
  const f = fixture(t);
  f.git("mv", "example.txt", "renamed.txt");
  const planned = plan(f);
  assert.equal(
    f.cli("execute", { reference: planned.value.reference }).exit,
    0,
  );
  assert.equal(f.git("ls-tree", "--name-only", "HEAD"), "renamed.txt");
});

await test("an initial commit has no parents and an empty change makes no commit", (t) => {
  const initial = fixture(t, true);
  const planned = plan(initial);
  const executed = initial.cli("execute", {
    reference: planned.value.reference,
  });
  assert.equal(executed.exit, 0, JSON.stringify(executed.value));
  assert.deepEqual(executed.value.parents, []);
  const empty = fixture(t);
  const material = prepare(empty);
  assert.equal(material.value.phase, "empty");
  assert.equal(empty.git("rev-list", "--count", "HEAD"), "1");
});

await test("failed local default observation is not absence and cannot be answered around", (t) => {
  const f = fixture(t);
  f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
  const realGit = spawnSync("which", ["git"], {
    encoding: "utf8",
  }).stdout.trim();
  const bin = join(f.owned, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$*" in *'symbolic-ref --quiet refs/remotes/origin/HEAD'*) exit 2;; esac\nexec '${realGit}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o700);
  f.env.PATH = `${bin}:${f.env.PATH}`;
  const inspected = f.cli("inspect");
  assert.equal((inspected.value.default as { kind: string }).kind, "ambiguous");
  assert.equal(
    (inspected.value.evidence as { observationFailed: boolean })
      .observationFailed,
    true,
  );
  const stopped = f.cli("materials", {
    reference: inspected.value.reference,
    defaultBranch: "main",
  });
  assert.equal(stopped.value.error, "default_observation_failed");
  assert.equal(f.git("diff", "--cached"), "");
});

await test("literal root scope includes tracked and untracked changes throughout the repository", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "example.txt"), "root change\n");
  mkdirSync(join(f.repo, "nested"));
  writeFileSync(join(f.repo, "nested/new.txt"), "nested change\n");
  const planned = plan(f, "docs: root scope\n", {
    scope: { kind: "paths", paths: ["."] },
  });
  assert.equal(
    f.cli("execute", { reference: planned.value.reference }).exit,
    0,
  );
  assert.equal(f.git("show", "HEAD:example.txt"), "root change");
  assert.equal(f.git("show", "HEAD:nested/new.txt"), "nested change");
  symlinkSync(f.owned, join(f.repo, "outside"));
  assert.equal(
    f.cli("inspect", { scope: { kind: "paths", paths: ["outside/file"] } })
      .value.error,
    "path_outside_repository",
  );
});

for (const checkpoint of ["inspect", "materials", "plan", "execute"] as const) {
  await test(`merge in progress at ${checkpoint} is refused without changing HEAD refs or index`, (t) => {
    const f = fixture(t);
    f.git("checkout", "-b", "side");
    writeFileSync(join(f.repo, "side.txt"), "side\n");
    f.git("add", "side.txt");
    f.git("commit", "-m", "docs: side fixture");
    f.git("checkout", "main");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    let mergeState: Buffer | undefined;
    if (checkpoint === "plan" || checkpoint === "execute") {
      f.git("merge", "--no-commit", "--no-ff", "side");
      mergeState = readFileSync(join(f.repo, ".git/MERGE_HEAD"));
      rmSync(join(f.repo, ".git/MERGE_HEAD"));
    }
    let reference: unknown;
    if (checkpoint !== "inspect") reference = f.cli("inspect").value.reference;
    if (checkpoint === "plan" || checkpoint === "execute") {
      const materials = f.cli("materials", { reference });
      assert.equal(materials.exit, 0);
      reference = materials.value.reference;
    }
    if (checkpoint === "execute") {
      const planned = f.cli("plan", { reference, message: "docs: pending\n" });
      assert.equal(planned.exit, 0);
      reference = planned.value.reference;
    }
    if (mergeState) writeFileSync(join(f.repo, ".git/MERGE_HEAD"), mergeState);
    else f.git("merge", "--no-commit", "--no-ff", "side");
    const head = f.git("rev-parse", "HEAD");
    const refs = f.git("for-each-ref", "--format=%(refname) %(objectname)");
    const index = readFileSync(join(f.repo, ".git/index"));
    const mergeHead = readFileSync(join(f.repo, ".git/MERGE_HEAD"));
    const stopped = f.cli(
      checkpoint,
      checkpoint === "inspect"
        ? {}
        : {
            reference,
            ...(checkpoint === "plan" ? { message: "docs: pending\n" } : {}),
          },
    );
    assert.equal(stopped.exit, 1);
    assert.equal(stopped.value.error, "merge_in_progress");
    assert.equal(stopped.value.operationMayHaveSucceeded, false);
    assert.equal(f.git("rev-parse", "HEAD"), head);
    assert.equal(
      f.git("for-each-ref", "--format=%(refname) %(objectname)"),
      refs,
    );
    assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
    assert.deepEqual(readFileSync(join(f.repo, ".git/MERGE_HEAD")), mergeHead);
    if (checkpoint === "inspect" || checkpoint === "materials")
      assert(!f.git("diff", "--cached").includes("pending"));
    else assert.match(f.git("diff", "--cached"), /pending/);
  });
}

for (const mode of ["absent", "missing-interpreter"] as const) {
  await test(`whole Staged scanner ${mode} distinguishes discovery from launch failure`, (t) => {
    const f = fixture(t);
    const bin = join(f.owned, "bin");
    mkdirSync(bin);
    const realGit = spawnSync("which", ["git"], {
      encoding: "utf8",
    }).stdout.trim();
    symlinkSync(realGit, join(bin, "git"));
    if (mode === "missing-interpreter") {
      writeFileSync(
        join(bin, "gitleaks"),
        `#!${f.owned}/missing-interpreter\n`,
      );
      chmodSync(join(bin, "gitleaks"), 0o700);
    }
    f.env.PATH = bin;
    writeFileSync(join(f.repo, "example.txt"), "scan everything\n");
    const inspected = f.cli("inspect");
    assert.equal(inspected.exit, 0);
    const head = f.git("rev-parse", "HEAD");
    const materials = f.cli("materials", {
      reference: inspected.value.reference,
    });
    assert.equal(materials.exit, mode === "absent" ? 0 : 1);
    assert.equal(
      mode === "absent" ? materials.value.scanner : materials.value.error,
      mode === "absent" ? "unavailable" : "staged_secret_scan_failed",
    );
    assert.equal(f.git("rev-parse", "HEAD"), head);
    assert.match(f.git("diff", "--cached"), /scan everything/);
  });
}

await test("missing promisor blob stops the public CLI without lazy fetch even with ambient override", (t) => {
  const f = fixture(t);
  const bare = join(f.owned, "remote.git");
  f.git("clone", "--bare", f.repo, bare);
  f.git("--git-dir=" + bare, "config", "uploadpack.allowFilter", "true");
  const blob = f.git("rev-parse", "HEAD:example.txt");
  rmSync(f.repo, { recursive: true });
  const cloned = spawnSync(
    "git",
    ["clone", "--filter=blob:none", "--no-checkout", `file://${bare}`, f.repo],
    { cwd: f.owned, env: f.env },
  );
  assert.equal(cloned.status, 0);
  f.git("read-tree", "HEAD");
  const hasBlob = () =>
    f
      .git("cat-file", "--batch-all-objects", "--batch-check=%(objectname)")
      .split("\n")
      .includes(blob);
  assert.equal(hasBlob(), false);
  writeFileSync(join(f.repo, "example.txt"), "local replacement\n");
  const trace = join(f.owned, "trace.jsonl");
  f.env.GIT_TRACE2_EVENT = trace;
  f.env.GIT_NO_LAZY_FETCH = "0";
  const inspected = f.cli("inspect");
  const stopped =
    inspected.exit === 0
      ? f.cli("materials", { reference: inspected.value.reference })
      : inspected;
  assert.equal(stopped.exit, 1);
  assert.equal(stopped.value.error, "git_observation_failed");
  assert.equal(hasBlob(), false);
  const events = readFileSync(trace, "utf8")
    .trim()
    .split("\n")
    .map((entry) => JSON.parse(entry) as { event: string; argv?: string[] });
  assert.equal(
    events.filter(
      (event) => event.event === "child_start" && event.argv?.includes("fetch"),
    ).length,
    0,
  );
});

function workPlan(
  f: ReturnType<typeof fixture>,
  branch?: string,
  explicit = false,
) {
  const materials = prepare(f, {
    mode: "commit",
    ...(explicit ? { newBranch: branch } : {}),
  });
  assert.equal(materials.value.phase, "materials");
  const planned = f.cli("plan", {
    reference: materials.value.reference,
    message: "docs: local example\n\nFixed 'bytes' $HOME.\n\n",
    ...(!explicit && branch !== undefined ? { newBranch: branch } : {}),
  });
  assert.equal(planned.exit, 0, JSON.stringify(planned.value));
  return planned;
}

for (const unborn of [false, true]) {
  await test(`commit plans a branch from materials and creates it only at execute (${unborn ? "unborn" : "parent"})`, (t) => {
    const f = fixture(t, unborn);
    const parent = unborn ? null : f.git("rev-parse", "HEAD");
    f.git("config", "branch.autoSetupMerge", "inherit");
    f.git("config", "branch.main.remote", "origin");
    f.git("config", "branch.main.merge", "refs/heads/main");
    const config = f.git("config", "--get-regexp", "^branch\\.");
    writeFileSync(join(f.repo, "example.txt"), "approved\n");
    writeFileSync(join(f.repo, "outside.txt"), "keep outside\n");
    const materials = prepare(f, {
      mode: "commit",
      scope: { kind: "paths", paths: ["example.txt"] },
    });
    assert.deepEqual(materials.value.branchPolicy, {
      mode: "commit",
      createBranch: true,
      newBranch: null,
    });
    assert.equal(materials.value.displayed, true);
    assert.match((materials.value.diff as { text: string }).text, /approved/);
    const planned = f.cli("plan", {
      reference: materials.value.reference,
      newBranch: "docs/日本語",
      message: "docs: exact 'bytes' $HOME\n\n",
    });
    assert.equal(planned.exit, 0, JSON.stringify(planned.value));
    assert.equal(planned.value.branch, "docs/日本語");
    assert.equal(f.git("branch", "--show-current"), "main");
    assert.equal(
      f.git("for-each-ref", "--format=%(refname)", "refs/heads/docs/"),
      "",
    );
    const revised = f.cli("plan", {
      reference: planned.value.reference,
      message: "docs: revised 'bytes' $HOME\n\n",
    });
    assert.equal(revised.exit, 0);
    assert.equal(revised.value.branch, "docs/日本語");
    const result = f.cli("execute", { reference: revised.value.reference });
    assert.equal(result.exit, 0, JSON.stringify(result.value));
    assert.equal(result.value.branchCreated, true);
    assert.equal(result.value.branch, "docs/日本語");
    assert.deepEqual(result.value.parents, parent ? [parent] : []);
    assert.equal(f.git("rev-parse", "HEAD^{tree}"), planned.value.tree);
    assert.equal(f.git("write-tree"), planned.value.tree);
    assert.equal(f.git("config", "--get-regexp", "^branch\\."), config);
    assert.equal(
      f.git("for-each-ref", "--format=%(upstream)", "refs/heads/docs/日本語"),
      "",
    );
    const raw = spawnSync("git", ["cat-file", "commit", "HEAD"], {
      cwd: f.repo,
      env: f.env,
    }).stdout;
    assert.equal(
      raw.subarray(raw.indexOf("\n\n") + 2).toString(),
      revised.value.message,
    );
    if (parent) assert.equal(f.git("rev-parse", "main"), parent);
    else
      assert.equal(
        f.git("for-each-ref", "--format=%(refname)", "refs/heads/main"),
        "",
      );
    assert.equal(
      readFileSync(join(f.repo, "outside.txt"), "utf8"),
      "keep outside\n",
    );
    assert.equal(f.git("ls-tree", "--name-only", "HEAD"), "example.txt");
  });
}

for (const explicit of [false, true]) {
  await test(`commit on a work branch ${explicit ? "honors an explicit new branch" : "keeps the current branch even when named main"}`, (t) => {
    const f = fixture(t);
    f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
    f.git("update-ref", "refs/remotes/origin/develop", "HEAD");
    f.git(
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/develop",
    );
    const parent = f.git("rev-parse", "HEAD");
    writeFileSync(join(f.repo, "example.txt"), "work\n");
    const planned = workPlan(
      f,
      explicit ? "docs/explicit" : undefined,
      explicit,
    );
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 0, JSON.stringify(result.value));
    assert.equal(result.value.branch, explicit ? "docs/explicit" : "main");
    assert.equal(result.value.branchCreated, explicit);
    if (explicit) assert.equal(f.git("rev-parse", "main"), parent);
    assert.equal(f.git("rev-parse", "refs/remotes/origin/develop"), parent);
  });
}

for (const branch of [
  "bad..name",
  "-option",
  "@{-1}",
  "line\nname",
  "",
  "HEAD",
  "main",
  "topic",
  "topic/child",
]) {
  await test(`commit rejects explicit invalid or colliding branch ${JSON.stringify(branch)} before Stage`, (t) => {
    const f = fixture(t);
    f.git("branch", branch === "topic" ? "topic/child" : "topic");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const before = f.git("for-each-ref", "--format=%(refname) %(objectname)");
    const result = f.cli("inspect", { mode: "commit", newBranch: branch });
    assert.equal(result.exit, 1);
    assert.equal(f.git("branch", "--show-current"), "main");
    assert.equal(f.git("diff", "--cached"), "");
    assert.equal(
      f.git("for-each-ref", "--format=%(refname) %(objectname)"),
      before,
    );
  });
}

for (const [existing, planned] of [
  ["planned", "planned"],
  ["planned", "planned/child"],
  ["planned/child", "planned"],
]) {
  for (const boundary of ["inspect", "plan"]) {
    await test(`commit rejects dangling ${existing} collision with ${planned} at ${boundary}`, (t) => {
      const f = fixture(t);
      const parent = f.git("rev-parse", "HEAD");
      f.git("symbolic-ref", `refs/heads/${existing}`, "refs/heads/missing");
      writeFileSync(join(f.repo, "example.txt"), "pending\n");
      const materials =
        boundary === "plan" ? prepare(f, { mode: "commit" }) : null;
      const index = readFileSync(join(f.repo, ".git/index"));
      const config = readFileSync(join(f.repo, ".git/config"));
      const raw = readFileSync(join(f.repo, ".git/refs/heads", existing));
      const result = f.cli(
        boundary,
        materials
          ? {
              reference: materials.value.reference,
              newBranch: planned,
              message: "docs: fixed\n",
            }
          : { mode: "commit", newBranch: planned },
      );
      assert.equal(result.exit, 1);
      assert.equal(result.value.error, "branch_exists");
      assert.equal(f.git("symbolic-ref", "HEAD"), "refs/heads/main");
      assert.equal(f.git("rev-parse", "HEAD"), parent);
      assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
      assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
      assert.deepEqual(
        readFileSync(join(f.repo, ".git/refs/heads", existing)),
        raw,
      );
      assert.equal(existsSync(join(f.repo, ".git/refs/heads/missing")), false);
      assert.equal(
        f.git("for-each-ref", "--format=%(refname)"),
        "refs/heads/main",
      );
    });
  }
}

await test("commit rejects a dangling branch introduced after plan before execute mutation", (t) => {
  const f = fixture(t);
  const parent = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const planned = workPlan(f, "planned");
  f.git("symbolic-ref", "refs/heads/planned", "refs/heads/missing");
  const index = readFileSync(join(f.repo, ".git/index"));
  const config = readFileSync(join(f.repo, ".git/config"));
  const raw = readFileSync(join(f.repo, ".git/refs/heads/planned"));
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 1);
  assert.equal(result.value.error, "branch_exists");
  assert.equal(result.value.branchMayHaveChanged, false);
  assert.equal(result.value.operationMayHaveSucceeded, false);
  assert.equal(result.value.commitSucceeded, false);
  assert.equal(f.git("symbolic-ref", "HEAD"), "refs/heads/main");
  assert.equal(f.git("rev-parse", "HEAD"), parent);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
  assert.deepEqual(readFileSync(join(f.repo, ".git/refs/heads/planned")), raw);
  assert.equal(existsSync(join(f.repo, ".git/refs/heads/missing")), false);
  assert.equal(f.git("for-each-ref", "--format=%(refname)"), "refs/heads/main");
});

await test("commit new branch preserves unstaged remainder with staged-only scope", (t) => {
  const f = fixture(t);
  const parent = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.repo, "example.txt"), "staged\n");
  f.git("add", "example.txt");
  writeFileSync(join(f.repo, "example.txt"), "unstaged\n");
  const materials = prepare(f, { mode: "commit", scope: { kind: "staged" } });
  const stagedPlan = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "planned",
    message: "docs: staged only\n",
  });
  assert.equal(stagedPlan.exit, 0);
  const result = f.cli("execute", { reference: stagedPlan.value.reference });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  assert.equal(result.value.branchCreated, true);
  assert.equal(f.git("rev-parse", "main"), parent);
  assert.equal(f.git("branch", "--show-current"), "planned");
  assert.equal(f.git("show", "HEAD:example.txt"), "staged");
  assert.equal(readFileSync(join(f.repo, "example.txt"), "utf8"), "unstaged\n");
  assert.equal(f.git("diff", "--cached"), "");
});

await test("commit rejects a generated branch collision at plan and branch/config drift before execute", (t) => {
  const f = fixture(t);
  f.git("branch", "existing");
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const materials = prepare(f, { mode: "commit" });
  const stopped = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "existing",
    message: "docs: fixed\n",
  });
  assert.equal(stopped.value.error, "branch_exists");
  for (const drift of ["branch", "config"]) {
    const planned = workPlan(f, "planned");
    if (drift === "branch") f.git("branch", "planned");
    else f.git("config", "branch.planned.remote", "origin");
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.value.error, "repository_drift");
    assert.equal(result.value.branchMayHaveChanged, false);
    assert.equal(f.git("branch", "--show-current"), "main");
    assert.equal(f.git("rev-list", "--count", "--all"), "1");
    if (drift === "branch") f.git("branch", "-d", "planned");
  }
});

await test("commit empty diff never requires a branch plan and cleanup cancels without branch creation", (t) => {
  const f = fixture(t);
  const empty = prepare(f, { mode: "commit" });
  assert.equal(empty.value.phase, "empty");
  assert.equal(empty.value.commitCreated, false);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const planned = workPlan(f, "planned");
  const result = f.cli("cleanup", { reference: planned.value.reference });
  assert.equal(result.value.phase, "cancelled");
  assert.equal(f.git("branch", "--show-current"), "main");
  assert.equal(
    f.git("for-each-ref", "--format=%(refname)", "refs/heads/planned"),
    "",
  );
  assert.match(f.git("diff", "--cached"), /pending/);
});

for (const mutation of ["branch", "index", "ref", "failure"]) {
  await test(`post-checkout hook ${mutation} stops before commit without rollback`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.repo, "example.txt"), "approved\n");
    const parent = f.git("rev-parse", "HEAD");
    const planned = workPlan(f, "planned");
    const hook = join(f.repo, ".git/hooks/post-checkout");
    const action =
      mutation === "branch"
        ? "git symbolic-ref HEAD refs/heads/main"
        : mutation === "index"
          ? "printf changed > example.txt\ngit add example.txt"
          : mutation === "ref"
            ? "git tag 'x\u2028y' HEAD"
            : "echo DO-NOT-EXPOSE-HOOK >&2\nexit 1";
    writeFileSync(hook, `#!/bin/sh\n${action}\n`);
    chmodSync(hook, 0o700);
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 1);
    assert.equal(
      result.value.error,
      mutation === "failure" ? "branch_creation_failed" : "repository_drift",
    );
    assert.equal(result.value.branchMayHaveChanged, true);
    assert.equal(result.value.branchCreated, mutation !== "failure");
    assert.equal(result.value.commitSucceeded, false);
    assert.equal(f.git("rev-parse", "planned"), parent);
    assert.equal(f.git("rev-list", "--count", "--all"), "1");
    assert.equal(
      JSON.stringify(result.value).includes("DO-NOT-EXPOSE-HOOK"),
      false,
    );
  });
}

for (const settings of ["remote", "merge", "empty-merge", "upstream"]) {
  await test(`ref-less new branch with ${settings} settings ${settings === "upstream" ? "is rejected without changing config or Stage" : "is allowed without upstream"}`, (t) => {
    const f = fixture(t);
    f.git("remote", "add", "origin", "https://example.invalid/fixture.git");
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    if (settings !== "merge")
      f.git(
        "config",
        "branch.planned.remote",
        settings === "empty-merge" ? "." : "origin",
      );
    if (settings !== "remote")
      f.git(
        "config",
        "branch.planned.merge",
        settings === "empty-merge" ? "" : "refs/heads/main",
      );
    const config = f.git("config", "--get-regexp", "^branch\\.");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    if (settings === "upstream") {
      const result = f.cli("inspect", { mode: "commit", newBranch: "planned" });
      assert.equal(result.value.error, "branch_upstream_exists");
      assert.equal(f.git("diff", "--cached"), "");
      const materials = prepare(f, { mode: "commit" });
      const rejected = f.cli("plan", {
        reference: materials.value.reference,
        newBranch: "planned",
        message: "docs: fixed\n",
      });
      assert.equal(rejected.value.error, "branch_upstream_exists");
    } else {
      const planned = workPlan(f, "planned", true);
      const result = f.cli("execute", { reference: planned.value.reference });
      assert.equal(result.exit, 0, JSON.stringify(result.value));
      assert.equal(
        f.git("for-each-ref", "--format=%(upstream)", "refs/heads/planned"),
        "",
      );
    }
    assert.equal(f.git("config", "--get-regexp", "^branch\\."), config);
  });
}

function pushFixture(t: { after: (fn: () => void) => void }, empty = false) {
  const f = fixture(t);
  const bare = join(f.owned, "remote.git");
  f.git("init", "--bare", "-b", "main", bare);
  f.git("remote", "add", "origin", bare);
  if (!empty) f.git("push", "origin", "main");
  const bareGit = (...args: string[]) => f.git(`--git-dir=${bare}`, ...args);
  return { ...f, bare, bareGit };
}
function pushPlan(
  f: ReturnType<typeof pushFixture>,
  options: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const materials = prepare(f, {
    mode: "push",
    push: { remote: "origin", setUpstream: true, ...options },
    ...extra,
  });
  const planned = f.cli("plan", {
    reference: materials.value.reference,
    ...(materials.value.commitNeeded
      ? { message: "docs: exact 'bytes' $HOME\n\n" }
      : {}),
    ...((materials.value.branchPolicy as { createBranch: boolean }).createBranch
      ? { newBranch: "docs/pushed" }
      : {}),
  });
  assert.equal(planned.exit, 0, JSON.stringify(planned.value));
  return planned;
}
for (const existing of [false, true]) {
  await test(`push public CLI ${existing ? "existing HEAD without message or commit" : "new commit"} from main retains source ref and scoped work`, (t) => {
    const f = pushFixture(t);
    if (existing) {
      writeFileSync(join(f.repo, "example.txt"), "already committed\n");
      f.git("add", "example.txt");
      f.git("commit", "-m", "docs: existing history");
    } else writeFileSync(join(f.repo, "example.txt"), "new commit\n");
    writeFileSync(join(f.repo, "outside.txt"), "preserve\n");
    const parent = f.git("rev-parse", "HEAD");
    const main = f.bareGit("rev-parse", "main");
    f.git("config", "push.followTags", "true");
    f.git("config", "remote.origin.mirror", "true");
    f.git("config", "push.recurseSubmodules", "on-demand");
    f.git("config", "push.autoSetupRemote", "true");
    f.git("tag", "-a", "unsent", "-m", "do not send");
    const planned = pushPlan(
      f,
      {},
      { scope: { kind: "paths", paths: ["example.txt"] } },
    );
    assert.equal(
      planned.value.message,
      existing ? null : "docs: exact 'bytes' $HOME\n\n",
    );
    assert.equal(planned.value.commitNeeded, !existing);
    assert.equal(f.git("branch", "--show-current"), "main");
    assert.equal(
      f.bareGit("for-each-ref", "--format=%(refname)"),
      "refs/heads/main",
    );
    writeFileSync(
      join(f.repo, ".git/hooks/pre-push"),
      `#!/bin/sh\ncat > '${f.owned}/push-input'\nprintf called > '${f.owned}/push-hook'\n`,
    );
    chmodSync(join(f.repo, ".git/hooks/pre-push"), 0o700);
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 0, JSON.stringify(result.value));
    const sha = f.git("rev-parse", "HEAD");
    assert.equal(result.value.phase, "pushed");
    assert.equal(result.value.commitCreated, !existing);
    assert.equal(f.git("rev-parse", "main"), parent);
    assert.equal(f.bareGit("rev-parse", "main"), main);
    assert.equal(f.bareGit("rev-parse", "docs/pushed"), sha);
    assert.equal(
      f.bareGit("for-each-ref", "--format=%(refname)"),
      "refs/heads/docs/pushed\nrefs/heads/main",
    );
    assert.equal(f.git("rev-parse", "refs/remotes/origin/docs/pushed"), sha);
    assert.equal(
      f.git("rev-parse", "--abbrev-ref", "@{upstream}"),
      "origin/docs/pushed",
    );
    assert.match(
      readFileSync(join(f.owned, "push-input"), "utf8"),
      new RegExp(`${sha} refs/heads/docs/pushed`),
    );
    assert.equal(readFileSync(join(f.owned, "push-hook"), "utf8"), "called");
    assert.equal(
      readFileSync(join(f.repo, "outside.txt"), "utf8"),
      "preserve\n",
    );
    assert.equal(f.git("ls-tree", "--name-only", "HEAD"), "example.txt");
    assert.equal(existing ? sha : f.git("rev-parse", "HEAD^"), parent);
    rmSync(join(f.owned, "push-hook"));
    const again = pushPlan(
      f,
      {},
      { scope: { kind: "paths", paths: ["example.txt"] } },
    );
    assert.equal(again.value.phase, "already_pushed");
    assert.equal(again.value.pushSent, false);
    assert.equal(existsSync(join(f.owned, "push-hook")), false);
    assert.equal(f.git("rev-parse", "HEAD"), sha);
  });
}
for (const initial of [
  "new",
  "existing",
  "tags",
  "populated",
  "wrong-source",
  "wrong-target",
] as const) {
  await test(`explicit initial main push ${initial}`, (t) => {
    const f = pushFixture(t, initial !== "populated");
    if (initial === "tags") f.git("push", "origin", "HEAD:refs/tags/nonempty");
    if (initial === "wrong-source") f.git("switch", "-c", "feature");
    if (initial === "new")
      writeFileSync(join(f.repo, "example.txt"), "initial remote commit\n");
    const count = f.git("rev-list", "--count", "HEAD");
    const inspected = f.cli("inspect", {
      mode: "push",
      push: {
        remote: "origin",
        initialMain: true,
        ...(initial === "wrong-target" ? { target: "other" } : {}),
      },
    });
    const materials = f.cli("materials", {
      reference: inspected.value.reference,
    });
    if (initial !== "new" && initial !== "existing") {
      assert.equal(materials.exit, 1);
      assert.equal(f.git("rev-list", "--count", "HEAD"), count);
      return;
    }
    assert.equal(materials.exit, 0, JSON.stringify(materials.value));
    const planned = f.cli("plan", {
      reference: materials.value.reference,
      ...(initial === "new" ? { message: "docs: first remote\n" } : {}),
    });
    assert.equal(planned.exit, 0, JSON.stringify(planned.value));
    const pushed = f.cli("execute", { reference: planned.value.reference });
    assert.equal(pushed.exit, 0, JSON.stringify(pushed.value));
    assert.equal(pushed.value.branchCreated, false);
    assert.equal(f.bareGit("rev-parse", "main"), f.git("rev-parse", "HEAD"));
  });
}
for (const target of ["main", "develop"]) {
  await test(`normal push rejects protected destination ${target} before commit`, (t) => {
    const f = pushFixture(t);
    if (target === "develop") {
      f.git("push", "origin", "HEAD:refs/heads/develop");
      f.bareGit("symbolic-ref", "HEAD", "refs/heads/develop");
    }
    f.git("switch", "-c", "feature");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const inspected = f.cli("inspect", {
      mode: "push",
      push: { remote: "origin", target },
    });
    const stopped = f.cli("materials", {
      reference: inspected.value.reference,
    });
    assert.equal(stopped.value.error, "protected_push_target");
    assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
  });
}
await test("push without HEAD or selected changes performs no remote preparation", (t) => {
  const f = fixture(t, true);
  const inspected = f.cli("inspect", {
    mode: "push",
    scope: { kind: "staged" },
  });
  assert.equal(inspected.exit, 0);
  const result = f.cli("materials", { reference: inspected.value.reference });
  assert.equal(result.value.phase, "empty");
});
for (const boundary of [
  "before-execute",
  "after-commit",
  "push-hook",
  "post-push",
] as const) {
  await test(`push ${boundary} failure stops mutations and reports prior success`, (t) => {
    const f = pushFixture(t);
    f.git("switch", "-c", "feature");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const planned = pushPlan(f);
    if (boundary === "before-execute")
      f.git(
        "remote",
        "set-url",
        "--push",
        "origin",
        join(f.owned, "other.git"),
      );
    if (boundary === "after-commit") {
      writeFileSync(
        join(f.repo, ".git/hooks/post-commit"),
        "#!/bin/sh\ngit remote set-url --push origin /nonexistent\n",
      );
      chmodSync(join(f.repo, ".git/hooks/post-commit"), 0o700);
    }
    if (boundary === "push-hook" || boundary === "post-push") {
      writeFileSync(
        join(f.repo, ".git/hooks/pre-push"),
        boundary === "push-hook"
          ? "#!/bin/sh\necho DO-NOT-EXPOSE-HOOK >&2\nexit 1\n"
          : "#!/bin/sh\ngit tag drift HEAD\n",
      );
      chmodSync(join(f.repo, ".git/hooks/pre-push"), 0o700);
    }
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 1);
    assert.equal(result.value.commitSucceeded, boundary !== "before-execute");
    assert.equal(result.value.commitVerified, boundary !== "before-execute");
    assert.equal(
      result.value.pushAttempted,
      boundary === "push-hook" || boundary === "post-push",
    );
    assert.equal(result.value.pushVerified, boundary === "post-push");
    assert.equal(
      result.value.error,
      boundary === "push-hook"
        ? "push_failed"
        : boundary === "post-push"
          ? "post_push_local_verification_failed"
          : "push_destination_drift",
    );
    assert.equal(result.value.upstreamConfigured, false);
    assert.equal(
      JSON.stringify(result.value).includes("DO-NOT-EXPOSE-HOOK"),
      false,
    );
    assert.equal(
      f.git("for-each-ref", "--format=%(upstream)", "refs/heads/feature"),
      "",
    );
    assert.equal(
      f.bareGit("for-each-ref", "--format=%(refname)"),
      boundary === "post-push"
        ? "refs/heads/feature\nrefs/heads/main"
        : "refs/heads/main",
    );
  });
}
await test("push observes remote drift before branch creation and commit", (t) => {
  const f = pushFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const planned = pushPlan(f);
  f.bareGit("symbolic-ref", "HEAD", "refs/heads/changed");
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 1);
  assert.equal(result.value.branchCreated, false);
  assert.equal(result.value.commitSucceeded, false);
  assert.equal(f.git("branch", "--show-current"), "main");
});
await test("push tracking follows first positive mapping rather than negative fetch exclusion", (t) => {
  const f = pushFixture(t);
  f.git("switch", "-c", "feature");
  f.git("config", "--unset-all", "remote.origin.fetch");
  f.git(
    "config",
    "--add",
    "remote.origin.fetch",
    "+refs/heads/*:refs/remotes/first/*",
  );
  f.git(
    "config",
    "--add",
    "remote.origin.fetch",
    "+refs/heads/*:refs/remotes/second/*",
  );
  f.git("config", "--add", "remote.origin.fetch", "^refs/heads/feature");
  const planned = pushPlan(f, { setUpstream: false });
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  assert.equal(
    f.git("rev-parse", "refs/remotes/first/feature"),
    f.git("rev-parse", "HEAD"),
  );
  assert.equal(
    f.git("for-each-ref", "--format=%(refname)", "refs/remotes/second"),
    "",
  );
});

function pushRefState(f: ReturnType<typeof pushFixture>) {
  return {
    head: f.git("rev-parse", "HEAD"),
    branch: f.git("symbolic-ref", "HEAD"),
    refs: f.git("for-each-ref", "--format=%(refname) %(objectname) %(symref)"),
    config: readFileSync(join(f.repo, ".git/config")),
    staged: f.git("diff", "--cached", "--binary"),
    worktree: readFileSync(join(f.repo, "example.txt")),
    index: readFileSync(join(f.repo, ".git/index")),
    remote: f.bareGit("for-each-ref", "--format=%(refname) %(objectname)"),
  };
}
for (const mapped of [
  "refs/heads/main",
  "refs/heads/other",
  "refs/tags/kept",
]) {
  await test(`push rejects fetch mapping to ${mapped} before branch creation or commit`, (t) => {
    const f = pushFixture(t);
    f.git("update-ref", mapped, "HEAD");
    f.git(
      "config",
      "--replace-all",
      "remote.origin.fetch",
      `+refs/heads/published:${mapped}`,
    );
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const materials = prepare(f, {
      mode: "push",
      push: { remote: "origin", target: "published" },
    });
    const before = pushRefState(f);
    const result = f.cli("plan", {
      reference: materials.value.reference,
      message: "docs: pending\n",
      newBranch: "docs/pushed",
    });
    assert.equal(result.exit, 1);
    assert.equal(result.value.error, "unsafe_push_tracking_ref");
    assert.deepEqual(pushRefState(f), before);
  });
}
for (const afterPlan of [false, true]) {
  for (const dangling of [false, true]) {
    await test(`push rejects ${dangling ? "dangling" : "resolved"} symbolic tracking ref ${afterPlan ? "after plan" : "during preparation"} without mutation`, (t) => {
      const f = pushFixture(t);
      const tracking = "refs/remotes/origin/published";
      const target = dangling ? "refs/heads/missing" : "refs/heads/main";
      f.git(
        "config",
        "--replace-all",
        "remote.origin.fetch",
        `+refs/heads/published:${tracking}`,
      );
      if (!afterPlan) f.git("symbolic-ref", tracking, target);
      writeFileSync(join(f.repo, "example.txt"), "pending\n");
      const materials = prepare(f, {
        mode: "push",
        push: { remote: "origin", target: "published" },
      });
      const input = {
        reference: materials.value.reference,
        message: "docs: pending\n",
        newBranch: "docs/pushed",
      };
      let reference = materials.value.reference;
      if (afterPlan) {
        const planned = f.cli("plan", input);
        assert.equal(planned.exit, 0, JSON.stringify(planned.value));
        reference = planned.value.reference;
        f.git("symbolic-ref", tracking, target);
      }
      const before = pushRefState(f);
      const result = afterPlan
        ? f.cli("execute", { reference })
        : f.cli("plan", input);
      assert.equal(result.exit, 1);
      assert.equal(
        result.value.error,
        afterPlan && !dangling
          ? "repository_drift"
          : "unsafe_push_tracking_ref",
      );
      assert.deepEqual(pushRefState(f), before);
      assert.equal(f.git("symbolic-ref", tracking), target);
      if (afterPlan) {
        assert.equal(result.value.branchCreated, false);
        assert.equal(result.value.commitSucceeded, false);
        assert.equal(result.value.pushAttempted, false);
      }
    });
  }
}
await test("push rechecks symbolic tracking after commit and stops before transmission", (t) => {
  const f = pushFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const planned = pushPlan(f, { setUpstream: false });
  const parent = f.git("rev-parse", "main");
  const remote = f.bareGit("for-each-ref", "--format=%(refname) %(objectname)");
  writeFileSync(
    join(f.repo, ".git/hooks/post-commit"),
    "#!/bin/sh\ngit symbolic-ref refs/remotes/origin/docs/pushed refs/heads/missing\n",
  );
  chmodSync(join(f.repo, ".git/hooks/post-commit"), 0o700);
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 1);
  assert.equal(result.value.error, "unsafe_push_tracking_ref");
  assert.equal(result.value.commitVerified, true);
  assert.equal(result.value.pushAttempted, false);
  assert.equal(f.git("rev-parse", "main"), parent);
  assert.equal(
    f.git("for-each-ref", "--format=%(refname)", "refs/heads/missing"),
    "",
  );
  assert.equal(
    f.bareGit("for-each-ref", "--format=%(refname) %(objectname)"),
    remote,
  );
});
for (const mapping of ["custom", "none"]) {
  await test(`push accepts safe ${mapping} fetch mapping without changing unrelated refs`, (t) => {
    const f = pushFixture(t);
    const tracking = "refs/custom/published";
    f.git("config", "--unset-all", "remote.origin.fetch");
    if (mapping === "custom") {
      f.git(
        "config",
        "--add",
        "remote.origin.fetch",
        `+refs/heads/published:${tracking}`,
      );
      // Only the first positive match is updated by push, not this later mapping.
      f.git(
        "config",
        "--add",
        "remote.origin.fetch",
        "+refs/heads/published:refs/heads/main",
      );
    }
    const parent = f.git("rev-parse", "main");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const planned = pushPlan(f, { target: "published", setUpstream: false });
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 0, JSON.stringify(result.value));
    assert.equal(result.value.pushVerified, true);
    const sha = f.git("rev-parse", "HEAD");
    assert.equal(f.bareGit("rev-parse", "published"), sha);
    assert.equal(f.git("rev-parse", "main"), parent);
    assert.equal(
      f.git("for-each-ref", "--format=%(objectname)", tracking),
      mapping === "custom" ? sha : "",
    );
    assert.equal(
      f.git("for-each-ref", "--format=%(refname)", "refs/remotes"),
      "refs/remotes/origin/main",
    );
  });
}

for (const laterHead of [false, true]) {
  await test(`push accepts unchanged tracking with exact negative refspec${laterHead ? " and later local-head mapping" : ""} and verifies upstream`, (t) => {
    const f = pushFixture(t);
    const tracking = "refs/custom/published";
    const parent = f.git("rev-parse", "main");
    f.git("update-ref", tracking, parent);
    f.git(
      "config",
      "--replace-all",
      "remote.origin.fetch",
      `+refs/heads/published:${tracking}`,
    );
    if (laterHead)
      f.git(
        "config",
        "--add",
        "remote.origin.fetch",
        "+refs/heads/published:refs/heads/main",
      );
    f.git("config", "--add", "remote.origin.fetch", "^refs/heads/published");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const planned = pushPlan(f, { target: "published" });
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 0, JSON.stringify(result.value));
    assert.equal(result.value.pushVerified, true);
    assert.equal(result.value.upstreamConfigured, true);
    assert.equal(
      f.bareGit("rev-parse", "published"),
      f.git("rev-parse", "HEAD"),
    );
    assert.equal(f.git("rev-parse", tracking), parent);
    assert.equal(f.git("rev-parse", "main"), parent);
    assert.equal(f.git("config", "branch.docs/pushed.remote"), "origin");
    assert.equal(
      f.git("config", "branch.docs/pushed.merge"),
      "refs/heads/published",
    );
  });
}
for (const changed of ["refs/custom/published", "refs/heads/foreign"]) {
  await test(`push rejects unplanned ${changed} change even when tracking may remain unchanged`, (t) => {
    const f = pushFixture(t);
    const parent = f.git("rev-parse", "main");
    const unrelated = f.git(
      "commit-tree",
      "HEAD^{tree}",
      "-m",
      "unrelated object",
    );
    f.git("update-ref", "refs/custom/published", parent);
    f.git(
      "config",
      "--replace-all",
      "remote.origin.fetch",
      "+refs/heads/published:refs/custom/published",
    );
    f.git("config", "--add", "remote.origin.fetch", "^refs/heads/published");
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const planned = pushPlan(f, { target: "published" });
    const config = readFileSync(join(f.repo, ".git/config"));
    writeFileSync(
      join(f.repo, ".git/hooks/pre-push"),
      `#!/bin/sh\ngit update-ref ${changed} ${unrelated}\n`,
    );
    chmodSync(join(f.repo, ".git/hooks/pre-push"), 0o700);
    const result = f.cli("execute", { reference: planned.value.reference });
    assert.equal(result.exit, 1);
    assert.equal(result.value.error, "post_push_local_verification_failed");
    assert.equal(result.value.pushVerified, true);
    assert.equal(result.value.upstreamConfigured, false);
    assert.equal(
      f.bareGit("rev-parse", "published"),
      f.git("rev-parse", "HEAD"),
    );
    assert.equal(f.git("rev-parse", changed), unrelated);
    assert.equal(f.git("rev-parse", "main"), parent);
    assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
  });
}

await test("push does not ask a local default question and may target a different work branch", (t) => {
  const f = pushFixture(t);
  f.git("switch", "-c", "feature");
  f.git(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/missing",
  );
  const inspected = f.cli("inspect", {
    mode: "push",
    push: { remote: "origin", target: "published", setUpstream: false },
  });
  assert.equal(
    (inspected.value.questions as { default: boolean }).default,
    false,
  );
  const materials = f.cli("materials", {
    reference: inspected.value.reference,
  });
  assert.equal(materials.exit, 0, JSON.stringify(materials.value));
  const planned = f.cli("plan", { reference: materials.value.reference });
  assert.equal(planned.exit, 0, JSON.stringify(planned.value));
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  assert.equal(f.bareGit("rev-parse", "published"), f.git("rev-parse", "HEAD"));
  assert.equal(f.git("branch", "--show-current"), "feature");
});
for (const kind of ["credentials", "multiple", "custom-ssh"] as const) {
  await test(`push rejects ${kind} destination without exposing raw URL or starting a commit`, (t) => {
    const f = pushFixture(t);
    if (kind === "credentials")
      f.git(
        "remote",
        "set-url",
        "origin",
        "https://SECRET-TOKEN@example.invalid/x",
      );
    if (kind === "multiple")
      f.git("config", "--add", "remote.origin.pushurl", f.bare);
    if (kind === "multiple")
      f.git(
        "config",
        "--add",
        "remote.origin.pushurl",
        join(f.owned, "second.git"),
      );
    if (kind === "custom-ssh") {
      f.git("remote", "set-url", "origin", "git@alias.invalid:x/repo.git");
      f.git("config", "core.sshCommand", "untrusted ssh");
    }
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    const result = f.cli("inspect", {
      mode: "push",
      push: { remote: "origin" },
    });
    assert.equal(result.exit, 1);
    assert.equal(JSON.stringify(result.value).includes("SECRET-TOKEN"), false);
    assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
    assert.equal(f.git("diff", "--cached"), "");
  });
}
await test("push fixed SHA remains fixed even when a normal pre-push hook moves HEAD", (t) => {
  const f = pushFixture(t);
  f.git("switch", "-c", "feature");
  const sha = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.repo, "example.txt"), "second\n");
  f.git("add", "example.txt");
  f.git("commit", "-m", "docs: second");
  const later = f.git("rev-parse", "HEAD");
  f.git("update-ref", "refs/heads/feature", sha);
  f.git("read-tree", "-u", "--reset", "HEAD"); // Fixture setup only, never a product operation.
  const planned = pushPlan(f);
  writeFileSync(
    join(f.repo, ".git/hooks/pre-push"),
    `#!/bin/sh\ngit update-ref refs/heads/feature ${later}\n`,
  );
  chmodSync(join(f.repo, ".git/hooks/pre-push"), 0o700);
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.value.error, "post_push_local_verification_failed");
  assert.equal(result.value.pushVerified, true);
  assert.equal(result.value.upstreamConfigured, false);
  assert.equal(f.bareGit("rev-parse", "feature"), sha);
  assert.equal(f.git("rev-parse", "HEAD"), later);
});
await test("push upstream update failure preserves verified transmission and reports its own stage", (t) => {
  const f = pushFixture(t);
  f.git("switch", "-c", "feature");
  const planned = pushPlan(f);
  const realGit = spawnSync("which", ["git"], {
    encoding: "utf8",
  }).stdout.trim();
  const bin = join(f.owned, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$*" in 'config --local --replace-all branch.feature.remote origin') exit 1;; esac\nexec '${realGit}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o700);
  f.env.PATH = `${bin}:${f.env.PATH}`;
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.exit, 1);
  assert.equal(result.value.error, "post_push_upstream_update_failed");
  assert.equal(result.value.pushSucceeded, true);
  assert.equal(result.value.pushVerified, true);
  assert.equal(result.value.upstreamConfigured, false);
  assert.equal(f.bareGit("rev-parse", "feature"), f.git("rev-parse", "HEAD"));
});
await test("push rejects missing remote target object before commit without fetching", (t) => {
  const f = pushFixture(t);
  f.git("switch", "-c", "feature");
  const other = join(f.owned, "other");
  f.git("clone", f.bare, other);
  for (const args of [
    ["user.name", "Test User"],
    ["user.email", "test@example.invalid"],
    ["commit.gpgsign", "false"],
  ])
    f.git("-C", other, "config", ...args);
  writeFileSync(join(other, "remote-only.txt"), "not fetched\n");
  f.git("-C", other, "add", "remote-only.txt");
  f.git("-C", other, "commit", "-m", "docs: remote-only");
  f.git("-C", other, "push", "origin", "HEAD:refs/heads/feature");
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const inspected = f.cli("inspect", {
    mode: "push",
    push: { remote: "origin" },
  });
  const result = f.cli("materials", { reference: inspected.value.reference });
  assert.equal(result.exit, 1);
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
  const missing = f.bareGit("rev-parse", "feature");
  assert.equal(
    spawnSync("git", ["cat-file", "-e", missing], { cwd: f.repo, env: f.env })
      .status,
    1,
  );
});

await test("push failure reports the verified commit separately from a hook-moved observed HEAD", (t) => {
  const f = pushFixture(t);
  f.git("switch", "-c", "feature");
  const parent = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.repo, "example.txt"), "approved new commit\n");
  const planned = pushPlan(f);
  writeFileSync(
    join(f.repo, ".git/hooks/pre-push"),
    `#!/bin/sh\ngit update-ref refs/heads/feature ${parent}\n`,
  );
  chmodSync(join(f.repo, ".git/hooks/pre-push"), 0o700);
  const result = f.cli("execute", { reference: planned.value.reference });
  assert.equal(result.value.error, "post_push_local_verification_failed");
  assert.equal(result.value.commitVerified, true);
  assert.equal(result.value.pushVerified, true);
  assert.equal(result.value.verifiedCommit, f.bareGit("rev-parse", "feature"));
  assert.notEqual(result.value.verifiedCommit, parent);
  assert.equal((result.value.observed as { head: string }).head, parent);
  assert.equal(result.value.upstreamConfigured, false);
});

function prFixture(t: { after: (fn: () => void) => void }) {
  const f = pushFixture(t);
  configurePrFixture(
    f.owned,
    "" + spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim(),
    process.execPath,
  );
  f.env.PATH = join(f.owned, "bin") + ":" + f.env.PATH;
  return f;
}
await test("PR plan retains fixed title/body bytes when only the commit message changes", (t) => {
  const f = prFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "base\nPR change\n");
  const materials = prepare(f, {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: fixtureRepository, draft: true },
  });
  const title = "docs: exact 'title' $HOME `code`";
  const body = "## Summary\n\nKeep $(touch unwanted), `code` and 日本語.\n\n";
  const first = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "docs/pr",
    message: "docs: original\n\n",
    pr: { title, body },
  });
  assert.equal(first.exit, 0, JSON.stringify(first.value));
  const changed = f.cli("plan", {
    reference: first.value.reference,
    message: "docs: revised\n",
  });
  assert.equal(changed.exit, 0, JSON.stringify(changed.value));
  assert.deepEqual(changed.value.pr, first.value.pr);
  assert.equal((changed.value.pr as { title: string }).title, title);
  assert.equal((changed.value.pr as { body: string }).body, body);
});
await test("PR plan text revision preserves fixed commit and the other PR field and invalidates old references", (t) => {
  const f = prFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "branch history\n");
  const materials = prepare(f, {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: fixtureRepository },
  });
  const first = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "docs/pr",
    message: "docs: fixed commit\n\n",
    pr: { title: "docs: fixed title", body: "original\n\n" },
  });
  assert.equal(first.exit, 0, JSON.stringify(first.value));
  const changed = f.cli("plan", {
    reference: first.value.reference,
    pr: { body: "revised $HOME\n\n" },
  });
  assert.equal(changed.exit, 0, JSON.stringify(changed.value));
  assert.equal(changed.value.message, "docs: fixed commit\n\n");
  assert.equal(
    (changed.value.pr as { title: string }).title,
    "docs: fixed title",
  );
  assert.equal(
    (changed.value.pr as { body: string }).body,
    "revised $HOME\n\n",
  );
  assert.equal(f.cli("execute", { reference: first.value.reference }).exit, 1);
  const result = f.cli("execute", { reference: changed.value.reference });
  assert.equal(result.exit, 0, JSON.stringify(result.value));
  assert.equal(result.value.phase, "pr_created");
});
function preparePrPlan(
  f: ReturnType<typeof prFixture>,
  pr: Record<string, unknown> = {},
) {
  const materials = prepare(f, {
    mode: "pr",
    scope: { kind: "paths", paths: ["example.txt"] },
    push: { remote: "origin", setUpstream: true },
    pr: { repository: fixtureRepository, ...pr },
  });
  const pending = f.cli("plan", {
    reference: materials.value.reference,
    ...(materials.value.commitNeeded ? { message: "docs: fixed\n\n" } : {}),
    ...((materials.value.branchPolicy as { createBranch: boolean }).createBranch
      ? { newBranch: "docs/pr" }
      : {}),
  });
  assert.equal(pending.exit, 0, JSON.stringify(pending.value));
  if (pending.value.phase !== "materials") return pending;
  return f.cli("plan", {
    reference: pending.value.reference,
    pr: {
      title: "docs: fixed title $HOME",
      body: "## Summary\n\nExact 'bytes' `code` 日本語\n\n",
    },
  });
}
function fixturePr(f: ReturnType<typeof prFixture>, state = "OPEN") {
  return {
    number: 1,
    url: `https://${fixtureRepository}/pull/1`,
    state,
    isCrossRepository: false,
    headRefName: "docs/pr",
    baseRefName: "main",
  };
}
function setPrState(
  f: ReturnType<typeof prFixture>,
  value: Record<string, unknown>,
) {
  writeFileSync(join(f.owned, "pr-state.json"), JSON.stringify(value));
}
for (const kind of ["new", "existing-head", "pr-only"] as const) {
  await test(`PR public CLI ${kind} preserves branch history, exact text, outside scope and only necessary mutations`, (t) => {
    const f = prFixture(t);
    const main = f.git("rev-parse", "HEAD");
    f.git("switch", "-c", "docs/pr");
    writeFileSync(join(f.repo, "prior.txt"), "earlier branch purpose\n");
    f.git("add", "prior.txt");
    f.git("commit", "-m", "docs: earlier branch change");
    writeFileSync(join(f.repo, "example.txt"), "new example\n");
    if (kind !== "new") {
      f.git("add", "example.txt");
      f.git("commit", "-m", "docs: existing head");
    }
    if (kind === "pr-only") f.git("push", "origin", "docs/pr");
    writeFileSync(join(f.repo, "outside.txt"), "keep outside\n");
    const before = f.git("rev-parse", "HEAD");
    const materials = prepare(f, {
      mode: "pr",
      scope: { kind: "paths", paths: ["example.txt"] },
      push: { remote: "origin" },
      pr: { repository: fixtureRepository, draft: true },
    });
    assert.equal(materials.exit, 0, JSON.stringify(materials.value));
    assert.match(
      (materials.value.prHistory as { text: string }).text,
      /earlier branch change/,
    );
    assert.match(
      (materials.value.prDiff as { text: string }).text,
      /earlier branch purpose/,
    );
    assert.deepEqual(
      (materials.value.pr as { reusableStagedPathBytes: string[] })
        .reusableStagedPathBytes,
      kind === "new" ? [Buffer.from("example.txt").toString("base64")] : [],
    );
    const pending = f.cli("plan", {
      reference: materials.value.reference,
      ...(kind === "new" ? { message: "docs: fixed\n\n" } : {}),
    });
    assert.equal(pending.exit, 0, JSON.stringify(pending.value));
    assert.equal(pending.value.executable, false);
    assert.deepEqual(pending.value.requiredInputs, ["pr.title", "pr.body"]);
    const pendingRef = pending.value.reference as {
      directory: string;
      files: Record<string, unknown>;
    };
    assert.equal(
      Object.keys(pendingRef.files).some((name) => name.endsWith(".bin")),
      false,
    );
    const planned = f.cli("plan", {
      reference: pendingRef,
      pr: { title: "docs: fixed 'title'", body: "$HOME `code` 日本語\n\n" },
    });
    assert.equal(planned.exit, 0, JSON.stringify(planned.value));
    assert.equal(f.git("rev-parse", "HEAD"), before);
    const executed = f.cli("execute", { reference: planned.value.reference });
    assert.equal(executed.exit, 0, JSON.stringify(executed.value));
    assert.equal(executed.value.phase, "pr_created");
    assert.equal(executed.value.commitCreated, kind === "new");
    assert.equal(executed.value.pushSent, kind !== "pr-only");
    assert.equal(executed.value.prVerified, true);
    assert.equal(f.git("rev-parse", "main"), main);
    assert.equal(f.bareGit("rev-parse", "docs/pr"), f.git("rev-parse", "HEAD"));
    assert.equal(
      readFileSync(join(f.repo, "outside.txt"), "utf8"),
      "keep outside\n",
    );
    const state = JSON.parse(
      readFileSync(join(f.owned, "pr-state.json"), "utf8"),
    ) as { prs: { title: string; body: string; isDraft: boolean }[] };
    assert.equal(state.prs.length, 1);
    assert.deepEqual(
      [state.prs[0].title, state.prs[0].body, state.prs[0].isDraft],
      ["docs: fixed 'title'", "$HOME `code` 日本語\n\n", true],
    );
  });
}
await test("PR pending plan cannot execute, retains branch/message without resending and rejects stale reference", (t) => {
  const f = prFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const materials = prepare(f, {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: fixtureRepository },
  });
  const pending = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "docs/pr",
    message: "docs: retain\n",
  });
  assert.equal(pending.exit, 0, JSON.stringify(pending.value));
  assert.equal(
    f.cli("execute", { reference: materials.value.reference }).exit,
    1,
  );
  // A rejected execute cleans up its own pending plan; it cannot create an unconfirmed PR.
  const rejected = f.cli("execute", { reference: pending.value.reference });
  assert.equal(rejected.exit, 1);
  assert.equal(rejected.value.error, "execute_accepts_reference_only");
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
});
for (const state of ["OPEN", "CLOSED", "MERGED"]) {
  await test(`PR ${state} existing report needs no PR text, commit or re-push`, (t) => {
    const f = prFixture(t);
    f.git("switch", "-c", "docs/pr");
    writeFileSync(join(f.repo, "example.txt"), "history\n");
    f.git("add", "example.txt");
    f.git("commit", "-m", "docs: history");
    f.git("push", "-u", "origin", "docs/pr");
    setPrState(f, { prs: [fixturePr(f, state)], fault: null });
    const before = readFileSync(join(f.owned, "pr-state.json"));
    const planned = preparePrPlan(f);
    assert.equal(planned.exit, 0, JSON.stringify(planned.value));
    assert.equal(planned.value.phase, "existing_pr");
    assert.equal(planned.value.commitCreated, false);
    assert.equal(planned.value.pushSent, false);
    assert.deepEqual(readFileSync(join(f.owned, "pr-state.json")), before);
  });
}
for (const fault of [
  "disappeared",
  "conflict",
  "commit-drift",
  "push-drift",
  "create-response",
  "readback",
] as const) {
  await test(`PR ${fault} stops subsequent mutations and retains preceding success`, (t) => {
    const f = prFixture(t);
    writeFileSync(join(f.repo, "example.txt"), "pending\n");
    if (fault === "disappeared")
      setPrState(f, { prs: [fixturePr(f)], fault: null });
    const planned = preparePrPlan(f);
    assert.equal(planned.exit, 0, JSON.stringify(planned.value));
    if (fault === "disappeared") setPrState(f, { prs: [], fault: null });
    if (fault === "conflict")
      setPrState(f, { prs: [fixturePr(f)], fault: null });
    if (fault === "create-response" || fault === "readback")
      setPrState(f, { prs: [], fault });
    if (fault === "commit-drift") {
      writeFileSync(
        join(f.repo, ".git/hooks/post-commit"),
        "#!/bin/sh\ngit remote set-url origin https://other.example.invalid/wrong/repo.git\n",
      );
      chmodSync(join(f.repo, ".git/hooks/post-commit"), 0o700);
    }
    if (fault === "push-drift") {
      writeFileSync(
        join(f.repo, ".git/hooks/pre-push"),
        "#!/bin/sh\ngit update-ref refs/heads/unplanned HEAD\n",
      );
      chmodSync(join(f.repo, ".git/hooks/pre-push"), 0o700);
    }
    const executed = f.cli("execute", { reference: planned.value.reference });
    assert.equal(
      executed.exit,
      fault === "conflict" ? 0 : 1,
      JSON.stringify(executed.value),
    );
    const calls = readFileSync(join(f.owned, "gh.jsonl"), "utf8");
    const creates = calls
      .split("\n")
      .filter((row) => row.startsWith('["pr","create"')).length;
    assert.equal(
      creates,
      ["create-response", "readback"].includes(fault) ? 1 : 0,
    );
    if (fault === "disappeared") {
      assert.equal(executed.value.error, "prepared_pr_disappeared");
      assert.equal(executed.value.commitSucceeded, false);
    }
    if (fault === "commit-drift") {
      assert.equal(executed.value.commitVerified, true);
      assert.equal(executed.value.pushAttempted, false);
    }
    if (fault === "push-drift") {
      assert.equal(executed.value.commitVerified, true);
      assert.equal(executed.value.pushSucceeded, true);
      assert.equal(executed.value.prAttempted, false);
    }
    if (["create-response", "readback"].includes(fault)) {
      assert.equal(executed.value.pushVerified, true);
      assert.equal(executed.value.prAttempted, true);
      assert.equal(executed.value.prVerified, false);
    }
  });
}
await test("PR base setting change requires explicit cleanup and fresh preparations without committing", (t) => {
  const f = prFixture(t);
  f.git("push", "origin", "HEAD:refs/heads/release");
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const first = preparePrPlan(f);
  assert.equal(first.exit, 0, JSON.stringify(first.value));
  assert.equal(f.cli("cleanup", { reference: first.value.reference }).exit, 0);
  const second = preparePrPlan(f, { base: "release", draft: true });
  assert.equal(second.exit, 0, JSON.stringify(second.value));
  assert.equal((second.value.pr as { base: string }).base, "release");
  assert.equal((second.value.pr as { draft: boolean }).draft, true);
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
});
await test("PR large fixed materials support batched reads and never reuse same path with different old blob", (t) => {
  const f = prFixture(t);
  f.git("switch", "-c", "docs/pr");
  writeFileSync(join(f.repo, "example.txt"), "existing branch change\n");
  f.git("add", "example.txt");
  f.git("commit", "-m", "docs: branch history");
  writeFileSync(join(f.repo, "example.txt"), "pending\n".repeat(6000));
  const materials = prepare(f, {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: fixtureRepository },
  });
  assert.equal(materials.exit, 0, JSON.stringify(materials.value));
  assert.equal(materials.value.displayed, false);
  assert.deepEqual(
    (materials.value.pr as { reusableStagedPathBytes: string[] })
      .reusableStagedPathBytes,
    [],
  );
  const stopped = f.cli("read", {
    reference: materials.value.reference,
    parts: [{ name: "pr-diff", offset: 0, length: 33000 }],
  });
  assert.equal(stopped.exit, 1);
  assert.equal(stopped.value.error, "material_display_budget_exceeded");
  assert.equal(stopped.value.materialsPreserved, true);
  assert.deepEqual(stopped.value.reference, materials.value.reference);
  assert.equal(stopped.value.cleanup, undefined);
  const read = f.cli("read", {
    reference: stopped.value.reference,
    parts: [
      { name: "pr-diff", offset: 0, length: 1500 },
      {
        name: "pr-history",
        offset: 0,
        length: Number(materials.value.prHistoryBytes),
      },
    ],
  });
  assert.equal(read.exit, 0, JSON.stringify(read.value));
  assert.equal(read.value.fixed, true);
  assert.equal((read.value.parts as unknown[]).length, 2);
  const cleaned = f.cli("cleanup", { reference: stopped.value.reference });
  assert.equal(cleaned.exit, 0);
  assert.deepEqual(cleaned.value.cleanup, { complete: true, remaining: [] });
});
for (const response of ["missing", "empty", "null"] as const) {
  await test(`PR template field ${response} response ${response === "missing" ? "stops" : "allows"} public materials with Stage retained and no commit/push/PR`, (t) => {
    const f = prFixture(t);
    writeFileSync(join(f.repo, "example.txt"), "pending template check\n");
    setPrState(f, { prs: [], fault: `templates-${response}` });
    const refs = f.git("show-ref");
    const bareRefs = f.bareGit("show-ref");
    const inspected = f.cli("inspect", {
      mode: "pr",
      push: { remote: "origin" },
      pr: { repository: fixtureRepository },
    });
    assert.equal(inspected.exit, 0, JSON.stringify(inspected.value));
    const materials = f.cli("materials", {
      reference: inspected.value.reference,
    });
    assert.equal(materials.exit, response === "missing" ? 1 : 0);
    if (response === "missing")
      assert.equal(materials.value.error, "invalid_template_response");
    else {
      assert.equal(materials.value.phase, "materials");
      assert.deepEqual(materials.value.prTemplates, {
        encoding: "utf8",
        text: "[]",
      });
      assert.equal(
        f.cli("cleanup", { reference: materials.value.reference }).exit,
        0,
      );
    }
    assert.equal(f.git("show", ":example.txt"), "pending template check");
    assert.equal(f.git("diff"), "");
    assert.equal(f.git("show-ref"), refs);
    assert.equal(f.git("symbolic-ref", "HEAD"), "refs/heads/main");
    assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
    assert.equal(f.bareGit("show-ref"), bareRefs);
    assert.deepEqual(
      JSON.parse(readFileSync(join(f.owned, "pr-state.json"), "utf8")).prs,
      [],
    );
    const ghCalls = readFileSync(join(f.owned, "gh.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row) as string[]);
    assert.equal(
      ghCalls.some((args) => args[0] === "pr"),
      false,
    );
    const sshCalls = readFileSync(join(f.owned, "ssh.jsonl"), "utf8");
    assert.equal(sshCalls.includes("git-receive-pack"), false);
  });
}
await test("PR mismatched repository fails preparation before commit without disclosing child output", (t) => {
  const f = prFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const inspected = f.cli("inspect", {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: "github.example.invalid/other/repo" },
  });
  assert.equal(inspected.exit, 0, JSON.stringify(inspected.value));
  const materials = f.cli("materials", {
    reference: inspected.value.reference,
  });
  assert.equal(materials.exit, 1);
  assert.equal(materials.value.error, "github_remote_mismatch");
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
});
await test("PR disappearance from intermediate preparation stops before generating missing commit text", (t) => {
  const f = prFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  setPrState(f, { prs: [fixturePr(f)], fault: null });
  const materials = prepare(f, {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: fixtureRepository },
  });
  const pending = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "docs/pr",
  });
  assert.equal(pending.exit, 0, JSON.stringify(pending.value));
  assert.deepEqual(pending.value.requiredInputs, ["message"]);
  setPrState(f, { prs: [], fault: null });
  const planned = f.cli("plan", {
    reference: pending.value.reference,
    message: "docs: supplied\n",
  });
  assert.equal(planned.exit, 1);
  assert.equal(planned.value.error, "prepared_pr_disappeared");
  assert.equal(f.git("rev-list", "--count", "HEAD"), "1");
});
await test("PR materials preserve non-UTF8 path bytes and use shared escaped display", (t) => {
  const f = prFixture(t);
  const name = Buffer.from([0xff]);
  const blob = f.git("hash-object", "-w", "example.txt");
  const staged = spawnSync("git", ["update-index", "-z", "--index-info"], {
    cwd: f.repo,
    env: f.env,
    input: Buffer.concat([
      Buffer.from(`100644 ${blob}\t`),
      name,
      Buffer.from([0]),
    ]),
  });
  assert.equal(staged.status, 0);
  const materials = prepare(f, {
    mode: "pr",
    scope: { kind: "staged" },
    push: { remote: "origin" },
    pr: { repository: fixtureRepository },
  });
  assert.equal(materials.exit, 0, JSON.stringify(materials.value));
  const files = (
    materials.value.pr as { files: { path: string; pathBytes: string }[] }
  ).files;
  assert.deepEqual(
    files.map(({ path, pathBytes }) => ({ path, pathBytes })),
    [{ path: "[path bytes: ff]", pathBytes: "/w==" }],
  );
});
await test("PR pending preparation retains supplied PR bytes when only missing commit text is supplied", (t) => {
  const f = prFixture(t);
  writeFileSync(join(f.repo, "example.txt"), "pending\n");
  const materials = prepare(f, {
    mode: "pr",
    push: { remote: "origin" },
    pr: { repository: fixtureRepository },
  });
  const body = "Keep $HOME `code` 日本語\n\n";
  const pending = f.cli("plan", {
    reference: materials.value.reference,
    newBranch: "docs/pr",
    pr: { title: "docs: exact title", body },
  });
  assert.equal(pending.exit, 0, JSON.stringify(pending.value));
  assert.deepEqual(pending.value.requiredInputs, ["message"]);
  const complete = f.cli("plan", {
    reference: pending.value.reference,
    message: "docs: supplied later\n",
  });
  assert.equal(complete.exit, 0, JSON.stringify(complete.value));
  assert.equal(complete.value.phase, "plan");
  assert.equal((complete.value.pr as { body: string }).body, body);
});
