import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repository = new URL("../", import.meta.url);
const skillNames = ["create-verification-skill", "maintain-verification-skill"];
const skillDirectories = skillNames.map((name) => `skills/${name}/`);

for (const name of skillNames) {
  test(`${name} frontmatter declares its explicit MIT skill`, async () => {
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

test("verification skills Markdown relative references resolve", async () => {
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
