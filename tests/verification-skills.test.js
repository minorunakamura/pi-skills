import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

await test("migrated commit entries require Bun and remove only their dedicated compatibility routes", async () => {
  for (const name of ["commit", "commit-main", "commit-push", "commit-pr"]) {
    const source = await readFile(
      new URL(`../skills/${name}/SKILL.md`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /^compatibility: .*Bun 1\.3\.0\+.*before any Git mutation.*no-confirm.*No fallback/m,
    );
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
  ]) {
    const document = new URL(path, repository);
    const source = await readFile(document, "utf8");
    for (const [, target] of source.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/g)) {
      if (/^https?:/.test(target)) continue;
      // Only these skills' references and links to them are in scope.
      if (
        !skillDirectories.some(
          (directory) =>
            path.startsWith(directory) || target.startsWith(directory),
        )
      )
        continue;
      await access(new URL(target, document));
      checked += 1;
    }
  }
  assert.ok(checked > 0, "Expected relative references to verification assets");
});
