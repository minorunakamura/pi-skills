import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

await test("commit-main-compatibility private capture example works in Bash and stops on Git failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commit-main-compatibility-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const temporary = join(directory, "tmp");
  const repo = join(directory, "repo");
  const outside = join(directory, "outside");
  for (const path of [temporary, repo, outside]) await mkdir(path);
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    TMPDIR: temporary,
  };
  await writeFile(join(repo, "README.md"), "# Example\n");
  for (const args of [
    ["init", "-b", "main"],
    ["add", "--", "README.md"],
  ]) {
    const result = spawnSync("git", args, { cwd: repo, env });
    assert.equal(result.status, 0);
  }
  const reference = await readFile(
    new URL(
      "../skills/commit/references/commit-main-compatibility.md",
      import.meta.url,
    ),
    "utf8",
  );
  const example = reference.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(example, "Expected the private capture example");
  const success = spawnSync(
    "/bin/bash",
    [
      "-c",
      `${example[1]}\ntest -n "$diff_file"\ntest -s "$diff_file"\ntest ! -s "$error_file"\ntest "$diff_digest" = "$(shasum -a 256 "$diff_file" | awk '{print $1}')"\nprintf 'capture-verified\\n'`,
    ],
    { cwd: repo, env, encoding: "utf8" },
  );
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout, "capture-verified\n");
  const failure = spawnSync(
    "/bin/bash",
    ["-c", `${example[1]}\nprintf 'must-not-continue\\n'`],
    { cwd: outside, env, encoding: "utf8" },
  );
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, "");
  assert.equal(failure.stderr, "", "Git diagnostics must remain private");
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
