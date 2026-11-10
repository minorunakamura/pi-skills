import { displayPath, splitNull } from "./commit-state.ts";
import { command, git, line, requireThat } from "./local-git.ts";
import { digest, object } from "./private-files.ts";
import { remoteState, type PushContext, type RemoteState } from "./push-git.ts";

export type PrOptions = {
  repository: string;
  host: string;
  slug: string;
  base: string | null;
  draft: boolean;
};
export type PrPreparation = ReturnType<typeof preparePr>;
export type ExistingPr = { number: number; url: string; state: string };
export type PrText = { title: string; body: string };
function text(value: unknown): asserts value is string {
  requireThat(
    typeof value === "string" &&
      !value.includes("\0") &&
      Buffer.from(value).toString() === value,
    "invalid_pr_input",
  );
}
export function prOptions(value: unknown): PrOptions {
  const input = object(value);
  requireThat(
    Object.keys(input).every((key) =>
      ["repository", "base", "draft"].includes(key),
    ),
    "invalid_pr_input",
  );
  text(input.repository);
  const parts = input.repository.split("/");
  if (parts.length === 2) parts.unshift("github.com");
  requireThat(
    parts.length === 3 &&
      /^[a-zA-Z0-9.-]+$/.test(parts[0]) &&
      parts
        .slice(1)
        .every(
          (part) =>
            /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..",
        ),
    "invalid_pr_repository",
  );
  if (input.base !== undefined) {
    text(input.base);
    requireThat(
      input.base.length > 0 && !input.base.startsWith("-"),
      "invalid_pr_base",
    );
  }
  requireThat(
    input.draft === undefined || typeof input.draft === "boolean",
    "invalid_pr_input",
  );
  return {
    repository: parts.join("/"),
    host: parts[0],
    slug: parts.slice(1).join("/"),
    base: (input.base as string) ?? null,
    draft: input.draft === true,
  };
}
function gh(repo: string, args: string[]) {
  const result = command(repo, "gh", args);
  requireThat(!result.error && result.status === 0, "pr_preparation_failed");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
  ) as unknown;
}
function sameRepository(
  repo: string,
  context: PushContext,
  options: PrOptions,
) {
  const url = context.url;
  let host: string;
  let path: string;
  if (url.includes("://")) {
    const parsed = new URL(url);
    requireThat(
      ["https:", "ssh:"].includes(parsed.protocol),
      "github_remote_mismatch",
    );
    host = parsed.hostname;
    path = parsed.pathname.slice(1);
    if (parsed.protocol === "ssh:") {
      const result = command(repo, "ssh", [
        "-G",
        ...(parsed.username ? ["-l", decodeURIComponent(parsed.username)] : []),
        ...(parsed.port ? ["-p", parsed.port] : []),
        "--",
        host,
      ]);
      requireThat(!result.error && result.status === 0, "ssh_host_unresolved");
      const rows = result.stdout
        .toString()
        .split("\n")
        .filter((row) => row.startsWith("hostname "));
      requireThat(rows.length === 1, "ssh_host_unresolved");
      host = rows[0].slice(9);
    }
  } else {
    const match = /^(?:([^/@:]+)@)?([^/:]+):(.+)$/.exec(url);
    requireThat(match, "github_remote_mismatch");
    const result = command(repo, "ssh", [
      "-G",
      ...(match[1] ? ["-l", match[1]] : []),
      "--",
      match[2],
    ]);
    requireThat(!result.error && result.status === 0, "ssh_host_unresolved");
    const rows = result.stdout
      .toString()
      .split("\n")
      .filter((row) => row.startsWith("hostname "));
    requireThat(rows.length === 1, "ssh_host_unresolved");
    host = rows[0].slice(9);
    path = match[3];
  }
  requireThat(
    host.toLowerCase() === options.host.toLowerCase() &&
      path.replace(/\.git$/, "").toLowerCase() === options.slug.toLowerCase(),
    "github_remote_mismatch",
  );
}
export function preparePr(
  repo: string,
  context: PushContext,
  remote: RemoteState,
  options: PrOptions,
) {
  sameRepository(repo, context, options);
  const auth = command(repo, "gh", [
    "auth",
    "status",
    "--hostname",
    options.host,
  ]);
  requireThat(!auth.error && auth.status === 0, "pr_authentication_failed");
  const account = object(
    gh(repo, ["api", "--hostname", options.host, "user"]),
  ).login;
  text(account);
  requireThat(account.length > 0, "invalid_pr_response");
  const metadata = object(
    gh(repo, [
      "repo",
      "view",
      options.repository,
      "--json",
      "nameWithOwner,url,defaultBranchRef,viewerPermission,pullRequestTemplates",
    ]),
  );
  requireThat(
    typeof metadata.nameWithOwner === "string" &&
      metadata.nameWithOwner.toLowerCase() === options.slug.toLowerCase() &&
      typeof metadata.url === "string" &&
      metadata.url.toLowerCase() ===
        `https://${options.repository}`.toLowerCase(),
    "github_repository_mismatch",
  );
  requireThat(
    ["WRITE", "MAINTAIN", "ADMIN"].includes(String(metadata.viewerPermission)),
    "insufficient_repository_permission",
  );
  const defaultBranch = object(metadata.defaultBranchRef).name;
  requireThat(
    typeof defaultBranch === "string" && defaultBranch === remote.defaultBranch,
    "default_branch_mismatch",
  );
  const base = options.base ?? defaultBranch;
  git(repo, ["check-ref-format", `refs/heads/${base}`]);
  const baseHead = remote.refs[`refs/heads/${base}`];
  requireThat(baseHead, "missing_base_branch");
  requireThat(
    Object.hasOwn(metadata, "pullRequestTemplates"),
    "invalid_template_response",
  );
  const rawTemplates = metadata.pullRequestTemplates ?? [];
  requireThat(Array.isArray(rawTemplates), "invalid_template_response");
  const templates = rawTemplates.map((item: unknown) => {
    const entry = object(item);
    text(entry.filename);
    text(entry.body);
    return { filename: entry.filename, body: entry.body };
  });
  return {
    options,
    account,
    permission: metadata.viewerPermission as string,
    defaultBranch,
    base,
    baseHead,
    templates,
  };
}
export function samePrPreparation(
  repo: string,
  context: PushContext,
  prepared: PrPreparation,
) {
  const now = preparePr(
    repo,
    context,
    remoteState(repo, context.url),
    prepared.options,
  );
  requireThat(
    JSON.stringify(now) === JSON.stringify(prepared),
    "pr_preparation_drift",
  );
}
export function prMaterials(
  repo: string,
  prepared: PrPreparation,
  parent: string | null,
  tree: string,
) {
  requireThat(parent, "missing_pr_parent");
  const bases = line(
    git(repo, ["merge-base", "--all", prepared.baseHead, parent]),
  ).split("\n");
  requireThat(bases.length === 1 && bases[0], "ambiguous_merge_base");
  const args = [
    "--no-pager",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-renames",
    "--ignore-submodules=none",
  ];
  const diff = git(repo, [...args, "--binary", bases[0], tree, "--"]);
  const units = (bytes: Buffer) => {
    const fields = splitNull(bytes);
    const rows: { identity: string; pathBytes: string }[] = [];
    for (let at = 0; at < fields.length; at += 2) {
      requireThat(fields[at + 1], "invalid_git_paths");
      rows.push({
        identity: Buffer.concat([
          fields[at],
          Buffer.from([0]),
          fields[at + 1],
        ]).toString("base64"),
        pathBytes: fields[at + 1].toString("base64"),
      });
    }
    return rows;
  };
  const staged = units(
    git(repo, [...args, "--cached", "--raw", "-z", "--no-abbrev", "--"]),
  );
  const whole = units(
    git(repo, [...args, "--raw", "-z", "--no-abbrev", bases[0], tree, "--"]),
  );
  const reusablePaths = whole
    .filter((unit) => staged.some((other) => other.identity === unit.identity))
    .map((unit) => unit.pathBytes);
  const history = git(repo, [
    "--no-pager",
    "log",
    "--format=%H%n%s%n%b%n---",
    `${prepared.baseHead}..${parent}`,
    "--",
  ]);
  return {
    diff,
    history,
    reusablePaths,
    files: whole.map((unit) => ({
      pathBytes: unit.pathBytes,
      path: displayPath(Buffer.from(unit.pathBytes, "base64")),
      reusedStaged: reusablePaths.includes(unit.pathBytes),
    })),
    mergeBase: bases[0],
  };
}
export function prUrl(value: unknown, prepared: PrPreparation): string {
  text(value);
  requireThat(
    new RegExp(
      `^https://${prepared.options.host.replaceAll(".", "\\.")}/${prepared.options.slug.replaceAll(".", "\\.")}/pull/[1-9][0-9]*$`,
      "i",
    ).test(value),
    "unexpected_pr_url",
  );
  return value;
}
export function existingPrs(
  repo: string,
  prepared: PrPreparation,
  head: string,
): ExistingPr[] {
  requireThat(head !== prepared.base, "same_head_and_base");
  const items = gh(repo, [
    "pr",
    "list",
    "--repo",
    prepared.options.repository,
    "--state",
    "all",
    "--head",
    head,
    "--base",
    prepared.base,
    "--limit",
    "100",
    "--json",
    "number,url,state,isCrossRepository",
  ]);
  requireThat(Array.isArray(items), "invalid_pr_list_response");
  // shortcut: refuse a saturated query; paginate if a branch accumulates 100 PRs.
  requireThat(items.length < 100, "pr_list_limit_reached");
  return items.flatMap((item: unknown) => {
    const entry = object(item);
    requireThat(
      typeof entry.isCrossRepository === "boolean",
      "invalid_pr_list_response",
    );
    if (entry.isCrossRepository) return [];
    const url = prUrl(entry.url, prepared);
    requireThat(
      Number.isSafeInteger(entry.number) &&
        Number(entry.number) > 0 &&
        String(entry.number) === url.split("/").at(-1) &&
        ["OPEN", "CLOSED", "MERGED"].includes(String(entry.state)),
      "invalid_pr_list_response",
    );
    return [{ number: Number(entry.number), url, state: String(entry.state) }];
  });
}
export function prText(value: unknown, previous: PrText | null): PrText {
  const input = value === undefined ? {} : object(value);
  requireThat(
    Object.keys(input).every((key) => key === "title" || key === "body"),
    "invalid_pr_text",
  );
  const title = input.title ?? previous?.title;
  const body = input.body ?? previous?.body;
  text(title);
  text(body);
  requireThat(
    title.trim().length > 0 && !/[\r\n]/.test(title),
    "invalid_pr_text",
  );
  return { title, body };
}
export function createPr(
  repo: string,
  prepared: PrPreparation,
  head: string,
  sha: string,
  text: PrText,
  attempted: () => void,
) {
  attempted();
  const result = command(
    repo,
    "gh",
    [
      "pr",
      "create",
      "--repo",
      prepared.options.repository,
      "--base",
      prepared.base,
      "--head",
      head,
      "--title",
      text.title,
      "--body-file",
      "-",
      ...(prepared.options.draft ? ["--draft"] : []),
    ],
    Buffer.from(text.body),
  );
  requireThat(
    !result.error && result.status === 0,
    "pr_creation_result_unknown",
  );
  const url = prUrl(line(result.stdout), prepared);
  const actual = object(
    gh(repo, [
      "pr",
      "view",
      url,
      "--repo",
      prepared.options.repository,
      "--json",
      "number,url,title,body,isDraft,isCrossRepository,headRefName,baseRefName,headRefOid,baseRefOid",
    ]),
  );
  requireThat(
    actual.url === url &&
      Number.isSafeInteger(actual.number) &&
      String(actual.number) === url.split("/").at(-1) &&
      actual.title === text.title &&
      actual.body === text.body &&
      actual.isDraft === prepared.options.draft &&
      actual.isCrossRepository === false &&
      actual.headRefName === head &&
      actual.baseRefName === prepared.base &&
      actual.headRefOid === sha &&
      actual.baseRefOid === prepared.baseHead,
    "pr_verification_failed",
  );
  return {
    url,
    number: actual.number,
    titleDigest: digest(Buffer.from(text.title)),
    bodyDigest: digest(Buffer.from(text.body)),
  };
}
