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
