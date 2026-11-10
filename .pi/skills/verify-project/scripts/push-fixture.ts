import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

function gitAt(
  owned: string,
  executable: string,
  directory: string,
  args: string[],
) {
  const result = spawnSync(executable, args, {
    cwd: directory,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: join(owned, "home"),
      TMPDIR: join(owned, "tmp"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  assert.equal(result.status, 0, `fixture Git ${args[0]} failed`);
  return result.stdout;
}
export function setupPushFixture(
  owned: string,
  git: string,
  node: string,
  existing: boolean,
) {
  for (const name of ["home", "tmp", "bin", "repo"])
    mkdirSync(join(owned, name), { recursive: true, mode: 0o700 });
  const repo = join(owned, "repo");
  const bare = join(owned, "remote.git");
  assert(!existsSync(join(repo, ".git")) && !existsSync(bare));
  const g = (...args: string[]) => gitAt(owned, git, repo, args);
  g("init", "-b", "main");
  g("config", "user.name", "Test User");
  g("config", "user.email", "test@example.invalid");
  g("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# Example\n");
  g("add", "README.md");
  g("commit", "-m", "docs: add example");
  g("init", "--bare", "-b", "main", bare);
  g("remote", "add", "origin", bare);
  g("push", "origin", "main");
  if (existing) g("switch", "-c", "feature/ready");
  writeFileSync(
    join(repo, "README.md"),
    "# Example\n\nRun the example locally.\n",
  );
  if (existing) {
    g("add", "README.md");
    g("commit", "-m", "docs: explain local example");
  }
  writeFileSync(join(repo, "outside.txt"), "keep outside\n");
  const wrapper = join(owned, "bin/git");
  // Observation only: every Git operation still runs the installed real Git.
  writeFileSync(
    wrapper,
    `#!${node}\nimport {appendFileSync} from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nappendFileSync(${JSON.stringify(join(owned, "git.jsonl"))}, JSON.stringify(process.argv.slice(2))+'\\n');\nconst result=spawnSync(${JSON.stringify(git)},process.argv.slice(2),{stdio:'inherit'});\nprocess.exit(result.status ?? 1);\n`,
    { mode: 0o700, flag: "wx" },
  );
  chmodSync(wrapper, 0o700);
  writeFileSync(
    join(owned, "bin/gh"),
    `#!/bin/sh\nprintf called >> '${owned}/gh-called'\nexit 99\n`,
    { mode: 0o700, flag: "wx" },
  );
  return observePushFixture(owned, git);
}
// Runtime-stop observation must not populate the index cache with write-tree.
export function snapshotPushFixture(owned: string, git: string) {
  const repo = join(owned, "repo");
  const g = (...args: string[]) => gitAt(owned, git, repo, args).toString();
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const paths = [
    ...new Set(
      g("ls-files", "-z", "--cached", "--others", "--exclude-standard")
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  return {
    head: g("rev-parse", "HEAD"),
    branch: g("symbolic-ref", "HEAD"),
    refs: g("for-each-ref", "--format=%(refname) %(objectname) %(symref)"),
    config: g("config", "--local", "--null", "--list"),
    indexDigest: hash(readFileSync(join(repo, ".git/index"))),
    worktree: paths.map((path) => {
      const file = join(repo, path);
      const info = lstatSync(file, { throwIfNoEntry: false });
      return {
        path,
        mode: info?.mode ?? null,
        digest: info
          ? hash(
              info.isSymbolicLink()
                ? Buffer.from(readlinkSync(file))
                : readFileSync(file),
            )
          : null,
      };
    }),
    bareRefs: g(
      `--git-dir=${join(owned, "remote.git")}`,
      "for-each-ref",
      "--format=%(refname) %(objectname) %(symref)",
    ),
    ghCalled: existsSync(join(owned, "gh-called")),
  };
}
export function observePushFixture(owned: string, git: string) {
  const g = (...args: string[]) =>
    gitAt(owned, git, join(owned, "repo"), args).toString().trimEnd();
  const b = (...args: string[]) =>
    g(`--git-dir=${join(owned, "remote.git")}`, ...args);
  const raw = gitAt(owned, git, join(owned, "repo"), [
    "cat-file",
    "commit",
    "HEAD",
  ]);
  return {
    branch: g("branch", "--show-current"),
    head: g("rev-parse", "HEAD"),
    refs: g("for-each-ref", "--format=%(refname) %(objectname) %(symref)"),
    count: g("rev-list", "--count", "HEAD"),
    tree: g("write-tree"),
    indexDigest: createHash("sha256")
      .update(readFileSync(join(owned, "repo/.git/index")))
      .digest("hex"),
    upstream: g(
      "for-each-ref",
      "--format=%(upstream)",
      "refs/heads/" + g("branch", "--show-current"),
    ),
    bareRefs: b("for-each-ref", "--format=%(refname) %(objectname)"),
    parents: g("rev-list", "--parents", "-1", "HEAD").split(" ").slice(1),
    message: raw.subarray(raw.indexOf("\n\n") + 2).toString(),
    outside: readFileSync(join(owned, "repo/outside.txt"), "utf8"),
    ghCalled: existsSync(join(owned, "gh-called")),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [operation, owned, git, mode, node] = process.argv.slice(2);
  assert(owned?.startsWith("/") && git?.startsWith("/"));
  if (operation === "setup") {
    assert((mode === "new" || mode === "existing") && node?.startsWith("/"));
    console.log(
      JSON.stringify(setupPushFixture(owned, git, node, mode === "existing")),
    );
  } else if (operation === "snapshot") {
    console.log(JSON.stringify(snapshotPushFixture(owned, git)));
  } else {
    assert.equal(operation, "observe");
    console.log(JSON.stringify(observePushFixture(owned, git)));
  }
}
