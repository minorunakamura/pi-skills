import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setupPushFixture } from "./push-fixture.ts";

export const fixtureRepository = "github.example.invalid/example/project";
export function setupPrFixture(
  owned: string,
  git: string,
  node: string,
  existing = false,
) {
  setupPushFixture(owned, git, node, existing);
  configurePrFixture(owned, git, node);
}
export function configurePrFixture(owned: string, git: string, node: string) {
  mkdirSync(join(owned, "bin"), { recursive: true, mode: 0o700 });
  const repo = join(owned, "repo");
  const run = (...args: string[]) => {
    const result = spawnSync(git, args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    assert.equal(result.status, 0);
  };
  run(
    "remote",
    "set-url",
    "origin",
    "git@github.example.invalid:example/project.git",
  );
  writeFileSync(
    join(owned, "pr-state.json"),
    JSON.stringify({ prs: [], fault: null }),
  );
  for (const name of ["gh", "ssh"]) {
    writeFileSync(
      join(owned, "bin", name),
      `#!${node}\nimport { runPrFixture } from ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};\nrunPrFixture(${JSON.stringify(name)},${JSON.stringify(owned)},${JSON.stringify(git)},process.argv.slice(2));\n`,
      { mode: 0o700 },
    );
  }
}
type PullRequest = {
  number: number;
  url: string;
  state: string;
  isCrossRepository: boolean;
  title: string;
  body: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  baseRefOid: string;
};
export function runPrFixture(
  kind: string,
  owned: string,
  git: string,
  args: string[],
) {
  const bare = join(owned, "remote.git");
  appendFileSync(join(owned, `${kind}.jsonl`), JSON.stringify(args) + "\n");
  if (kind === "ssh") {
    if (args[0] === "-G") {
      console.log("hostname github.example.invalid\nuser git");
      return;
    }
    const request = args.at(-1);
    const match =
      /^(git-upload-pack|git-receive-pack) 'example\/project\.git'$/.exec(
        request ?? "",
      );
    if (!match) process.exit(99);
    const result = spawnSync(git, [match[1].replace("git-", ""), bare], {
      stdio: "inherit",
    });
    process.exit(result.status ?? 99);
  }
  assert.equal(kind, "gh");
  const path = join(owned, "pr-state.json");
  const state = JSON.parse(readFileSync(path, "utf8")) as {
    prs: PullRequest[];
    fault: string | null;
  };
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const oid = (branch: string) => {
    const result = spawnSync(git, [
      `--git-dir=${bare}`,
      "rev-parse",
      `refs/heads/${branch}`,
    ]);
    assert.equal(result.status, 0);
    return result.stdout.toString().trim();
  };
  let result: unknown;
  if (args[0] === "auth" && args[1] === "status") return;
  if (args[0] === "api" && args.at(-1) === "user")
    result = { login: "fixture-user" };
  else if (args[0] === "repo" && args[1] === "view") {
    const metadata: Record<string, unknown> = {
      nameWithOwner: "example/project",
      url: `https://${fixtureRepository}`,
      defaultBranchRef: { name: "main" },
      viewerPermission: "WRITE",
      pullRequestTemplates: [
        {
          filename: "pull_request_template.md",
          body: "## Summary\n\n## Tests\n",
        },
      ],
    };
    if (state.fault === "templates-missing")
      delete metadata.pullRequestTemplates;
    else if (state.fault === "templates-empty")
      metadata.pullRequestTemplates = [];
    else if (state.fault === "templates-null")
      metadata.pullRequestTemplates = null;
    result = metadata;
  } else if (args[0] === "pr" && args[1] === "list")
    result = state.prs.filter(
      (pr) =>
        pr.headRefName === value("--head") &&
        pr.baseRefName === value("--base"),
    );
  else if (args[0] === "pr" && args[1] === "create") {
    const pr: PullRequest = {
      number: state.prs.length + 1,
      url: `https://${fixtureRepository}/pull/${state.prs.length + 1}`,
      state: "OPEN",
      isCrossRepository: false,
      title: value("--title"),
      body: readFileSync(0, "utf8"),
      isDraft: args.includes("--draft"),
      headRefName: value("--head"),
      baseRefName: value("--base"),
      headRefOid: oid(value("--head")),
      baseRefOid: oid(value("--base")),
    };
    state.prs.push(pr);
    writeFileSync(path, JSON.stringify(state));
    if (state.fault === "create-response") {
      console.log("invalid response");
      return;
    }
    console.log(pr.url);
    return;
  } else if (args[0] === "pr" && args[1] === "view") {
    result = state.prs.find((pr) => pr.url === args[2]);
    if (state.fault === "readback")
      result = { ...(result as PullRequest), title: "changed" };
  } else process.exit(99);
  console.log(JSON.stringify(result));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [operation, owned, git, mode, node] = process.argv.slice(2);
  assert.equal(operation, "setup");
  assert(
    owned?.startsWith("/") && git?.startsWith("/") && node?.startsWith("/"),
  );
  assert(mode === "new" || mode === "existing");
  setupPrFixture(owned, git, node, mode === "existing");
}
