import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupPrFixture, fixtureRepository } from "./pr-fixture.ts";
import { snapshotPushFixture } from "./push-fixture.ts";
await test("pr-fixture transports only its fake GitHub repository to real owned bare and reads exact PR bytes", (t) => {
  const owned = mkdtempSync(join(tmpdir(), "pr-fixture-test-"));
  t.after(() => rmSync(owned, { recursive: true, force: true }));
  const git = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  setupPrFixture(owned, git, process.execPath, true);
  const env = {
    ...process.env,
    PATH: join(owned, "bin") + ":" + process.env.PATH,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const run = (exe: string, args: string[], input?: string) =>
    spawnSync(exe, args, { cwd: join(owned, "repo"), env, input });
  const before = snapshotPushFixture(owned, git);
  assert.equal(run(git, ["push", "origin", "feature/ready"]).status, 0);
  assert.equal(
    run(join(owned, "bin/ssh"), [
      "git@github.example.invalid",
      "git-upload-pack 'other/repo.git'",
    ]).status,
    99,
  );
  const created = run(
    join(owned, "bin/gh"),
    [
      "pr",
      "create",
      "--repo",
      fixtureRepository,
      "--head",
      "feature/ready",
      "--base",
      "main",
      "--title",
      "exact $HOME",
      "--body-file",
      "-",
      "--draft",
    ],
    "exact `code` 日本語\n\n",
  );
  assert.equal(created.status, 0);
  const url = created.stdout.toString().trim();
  const viewed = run(join(owned, "bin/gh"), ["pr", "view", url]);
  assert.equal(viewed.status, 0);
  assert.deepEqual(
    JSON.parse(viewed.stdout.toString()).body,
    "exact `code` 日本語\n\n",
  );
  assert.equal(
    JSON.parse(viewed.stdout.toString()).headRefOid,
    before.head.trim(),
  );
  assert.match(readFileSync(join(owned, "gh.jsonl"), "utf8"), /create/);
});
