import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repository = new URL("../", import.meta.url);
const skillDirectory = "skills/create-verification-skill/";

test("create-verification-skill frontmatter declares its explicit MIT skill", async () => {
  const source = await readFile(
    new URL(`${skillDirectory}SKILL.md`, repository),
    "utf8",
  );
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "SKILL.md must start with frontmatter");
  assert.match(frontmatter[1], /^name: create-verification-skill$/m);
  assert.match(frontmatter[1], /^description: [A-Za-z][^\n]+$/m);
  assert.match(frontmatter[1], /^disable-model-invocation: true$/m);
  assert.match(frontmatter[1], /^license: MIT$/m);
});

test("create-verification-skill Markdown relative references resolve", async () => {
  let checked = 0;
  for (const path of [
    `${skillDirectory}SKILL.md`,
    `${skillDirectory}references/pstack.md`,
    "README.md",
    "CONTRIBUTING.md",
  ]) {
    const document = new URL(path, repository);
    const source = await readFile(document, "utf8");
    for (const [, target] of source.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/g)) {
      if (/^https?:/.test(target)) continue;
      // Only the new skill's references and new links to it are in scope.
      if (
        !path.startsWith(skillDirectory) &&
        !target.startsWith(skillDirectory)
      )
        continue;
      await access(new URL(target, document));
      checked += 1;
    }
  }
  assert.ok(
    checked > 0,
    "Expected relative references to the new skill assets",
  );
});
