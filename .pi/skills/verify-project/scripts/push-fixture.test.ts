import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  observePushFixture,
  setupPushFixture,
  snapshotPushFixture,
} from "./push-fixture.ts";

for (const existing of [false, true]) {
  await test(`push-fixture ${existing ? "existing HEAD" : "pending diff"} uses local bare and logs real Git only`, (t) => {
    const owned = mkdtempSync(join(tmpdir(), "push-fixture-test-"));
    t.after(() => rmSync(owned, { recursive: true, force: true }));
    const git = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    const before = setupPushFixture(owned, git, process.execPath, existing);
    assert.equal(before.branch, existing ? "feature/ready" : "main");
    assert.equal(before.count, existing ? "2" : "1");
    assert.equal(before.ghCalled, false);
    const observed = spawnSync(join(owned, "bin/git"), ["rev-parse", "HEAD"], {
      cwd: join(owned, "repo"),
    });
    assert.equal(observed.status, 0);
    assert.equal(observed.stderr.toString(), "");
    assert.equal(observed.stdout.toString().trim(), before.head);
    assert.equal(
      readFileSync(join(owned, "git.jsonl"), "utf8"),
      '["rev-parse","HEAD"]\n',
    );
    assert.deepEqual(observePushFixture(owned, git), before);
    const staged = spawnSync(git, ["add", "README.md"], {
      cwd: join(owned, "repo"),
    });
    assert.equal(staged.status, 0);
    const index = readFileSync(join(owned, "repo/.git/index"));
    const snapshot = snapshotPushFixture(owned, git);
    assert.deepEqual(snapshotPushFixture(owned, git), snapshot);
    assert.deepEqual(readFileSync(join(owned, "repo/.git/index")), index);
    writeFileSync(join(owned, "repo/outside.txt"), "changed outside\n");
    assert.notDeepEqual(
      snapshotPushFixture(owned, git).worktree,
      snapshot.worktree,
    );
  });
}
