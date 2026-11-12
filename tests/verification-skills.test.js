import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

await test("migrated commit entries require Bun and remove only their dedicated compatibility routes", async () => {
  for (const [name, endpoint, reference] of [
    ["commit", "commit", "local-bun.md"],
    ["commit-main", "commit", "local-bun.md"],
    ["commit-push", "push", "push-bun.md"],
    ["commit-pr", "PR", "pr-bun.md"],
  ]) {
    const source = await readFile(
      new URL(`../skills/${name}/SKILL.md`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /^compatibility: .*Bun 1\.3\.0\+.*before any Git mutation.*no-confirm.*No fallback/m,
    );
    assert.ok(source.includes(`到達点は **${endpoint}**`));
    assert.ok(source.includes(reference) && source.includes("全文"));
    assert.match(source, /disable-model-invocation: true/);
    assert.match(source, /^description: [\x20-\x7e]+$/m);
    assert.match(source, /矛盾[\s\S]*Git変更前/);
    for (const entry of ["commit", "commit-main", "commit-push", "commit-pr"])
      assert.ok(source.includes(`/skill:${entry}`));
  }
  for (const route of ["local", "push", "pr"]) {
    const source = await readFile(
      new URL(`../skills/commit/references/${route}-bun.md`, import.meta.url),
      "utf8",
    );
    assert.match(source, /Stageを含むGit変更前に停止/);
    assert.match(source, /確認不能/);
    assert.match(source, /旧Python/);
    assert.doesNotMatch(source, /(?:local|push)-compatibility\.md/);
    await assert.rejects(
      access(
        new URL(
          `../skills/commit/references/${route}-compatibility.md`,
          import.meta.url,
        ),
      ),
      { code: "ENOENT" },
    );
  }
  await assert.rejects(
    access(
      new URL("../skills/commit/references/compatibility.md", import.meta.url),
    ),
    { code: "ENOENT" },
  );
});

await test("commit entries declare the same-turn full read set and rule precedence", async () => {
  for (const [name, references] of Object.entries({
    commit: ["local-bun"],
    "commit-main": ["local-bun"],
    "commit-push": ["local-bun", "push-bun"],
    "commit-pr": ["local-bun", "push-bun", "pr-bun", "diff-review"],
  })) {
    const source = await readFile(
      new URL(`../skills/${name}/SKILL.md`, import.meta.url),
      "utf8",
    );
    const readSet = source
      .split("## 開始時の全文read一式")[1]
      .split("到達点は")[0];
    assert.match(readSet, /同じassistant turn/);
    assert.match(readSet, /tail/);
    assert.match(readSet, /未読.*操作・停止判断しない/);
    assert.match(readSet, /PR > push > local/);
    assert.deepEqual(
      [...readSet.matchAll(/\[([^\]]+)\.md\]/g)].map((match) => match[1]),
      references,
    );
  }
});

await test("shared startup and release contracts distinguish direct plan, questions and terminal cleanup", async () => {
  const local = await readFile(
    new URL("../skills/commit/references/local-bun.md", import.meta.url),
    "utf8",
  );
  for (const contract of [
    "commit_inspect",
    "直接1回",
    "{bun,result}",
    "無改変",
    "開始時からtool未導入",
    "旧表示toolは使わない",
    "独立releaseを省く",
    "payloadRemoved=true",
    "返された新reference",
    "cleanup.complete",
    "所有検証不能",
    "Stageをreset／unstageしない",
  ])
    assert.ok(local.includes(contract), contract);
  assert.doesNotMatch(local, /commit_status_display.*直接.*呼ぶ/);
  for (const name of [
    "push-bun",
    "pr-bun",
    "diff-review",
    "execution-batching",
  ]) {
    const source = await readFile(
      new URL(`../skills/commit/references/${name}.md`, import.meta.url),
      "utf8",
    );
    assert.match(source, /独立releaseを省[くき]/, name);
    assert.ok(source.includes("payloadRemoved=true"), name);
    assert.match(source, /release成功/);
    assert.match(source, /停止/);
  }
  const pr = await readFile(
    new URL("../skills/commit/references/pr-bun.md", import.meta.url),
    "utf8",
  );
  assert.match(pr, /phase=materials, executable=false/);
  assert.match(pr, /承認提示用の完成planではなくexecute不可/);
  assert.match(pr, /次のplanへ現参照と不足する/);
});

await test("PR reference retains preparation, fixed text, approval and readback contracts", async () => {
  const source = await readFile(
    new URL("../skills/commit/references/pr-bun.md", import.meta.url),
    "utf8",
  );
  for (const contract of [
    "OPEN/CLOSED/MERGED",
    "同一repository",
    "片側",
    "bytes",
    "旧参照",
    "executable=false",
    "新commit前",
    "全Staged",
    "readback",
    "先行成功",
    "Other",
    "通常assistant",
    "PR-only",
    "参照だけ",
    "キャンセル",
    "gh issue view",
    "Closes #123",
    "Refs #123",
    "owner/repo#123",
    "完了条件",
    "default branchへのmerge時",
    "別base",
    "直接closeしない",
    "無断で書き換えず",
  ])
    assert.ok(source.includes(contract), contract);
  assert.doesNotMatch(source, /compatibility\.md/);
});

await test("push reference defaults to missing-upstream setup and preserves existing settings", async () => {
  const source = await readFile(
    new URL("../skills/commit/references/push-bun.md", import.meta.url),
    "utf8",
  );
  for (const contract of [
    "`setUpstream`省略時",
    "両方未設定",
    "自動設定",
    "片側だけ／空値／値なしも含む",
    "既存設定を保持",
    "setUpstream:false",
    "最終一括確認",
    "再pushしない",
  ])
    assert.ok(source.includes(contract), contract);
  assert.doesNotMatch(source, /setUpstream:true.*利用者と確定した場合だけ/);
});

const repository = new URL("../", import.meta.url);
const skillNames = ["create-verification-skill", "maintain-verification-skill"];
const skillDirectories = skillNames.map((name) => `skills/${name}/`);

for (const name of skillNames) {
  await test(`${name} frontmatter declares its explicit MIT skill`, async () => {
    const source = await readFile(
      new URL(`skills/${name}/SKILL.md`, repository),
      "utf8",
    );
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "SKILL.md must start with frontmatter");
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, "m"));
    assert.match(frontmatter[1], /^description: [A-Za-z][^\n]+$/m);
    assert.match(frontmatter[1], /^disable-model-invocation: true$/m);
    assert.match(frontmatter[1], /^license: MIT$/m);
  });
}

await test("verification skills Markdown relative references resolve", async () => {
  let checked = 0;
  for (const path of [
    ...skillDirectories.map((directory) => `${directory}SKILL.md`),
    "skills/create-verification-skill/references/pstack.md",
    "README.md",
    "CONTRIBUTING.md",
    ...["commit", "commit-main", "commit-push", "commit-pr"].map(
      (name) => `skills/${name}/SKILL.md`,
    ),
    ...[
      "local-bun",
      "push-bun",
      "pr-bun",
      "workflow",
      "execution-batching",
      "diff-review",
    ].map((name) => `skills/commit/references/${name}.md`),
    ".pi/skills/verify-project/SKILL.md",
    ...["feature-map", "local-bun", "push-bun", "pr-bun", "commit-inspect"].map(
      (name) => `.pi/skills/verify-project/references/${name}.md`,
    ),
  ]) {
    const document = new URL(path, repository);
    const source = await readFile(document, "utf8");
    for (const [, target] of source.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/g)) {
      if (/^https?:/.test(target)) continue;
      await access(new URL(target, document));
      checked += 1;
    }
  }
  assert.ok(checked > 0, "Expected relative references to verification assets");
});
