import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { command, git, line, localDefault, requireThat } from "./local-git.ts";
import { digest, object } from "./private-files.ts";

export type Change = {
  path: string;
  pathBytes: string;
  index: string;
  worktree: string;
  originalPath?: string;
  originalBytes?: string;
};
export type Scope =
  | { kind: "all" | "staged" }
  | { kind: "paths"; paths: string[] };
export type Snapshot = ReturnType<typeof snapshot>;
export function splitNull(bytes: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  for (let at = 0; at < bytes.length; at++)
    if (bytes[at] === 0) {
      parts.push(bytes.subarray(start, at));
      start = at + 1;
    }
  requireThat(start === bytes.length, "invalid_git_paths");
  return parts;
}
function display(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return `[path bytes: ${bytes.toString("hex")}]`;
  }
}
export function changes(repo: string): Change[] {
  const fields = splitNull(
    git(repo, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]),
  );
  const result: Change[] = [];
  for (let at = 0; at < fields.length; at++) {
    const field = fields[at];
    const path = field.subarray(3);
    const change: Change = {
      path: display(path),
      pathBytes: path.toString("base64"),
      index: String.fromCharCode(field[0]),
      worktree: String.fromCharCode(field[1]),
    };
    if (
      change.index === "R" ||
      change.index === "C" ||
      change.worktree === "R" ||
      change.worktree === "C"
    ) {
      const original = fields[++at];
      requireThat(original, "invalid_git_paths");
      change.originalPath = display(original);
      change.originalBytes = original.toString("base64");
    }
    result.push(change);
  }
  return result;
}
export function snapshot(repo: string) {
  requireThat(
    !existsSync(
      line(
        git(repo, [
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "MERGE_HEAD",
        ]),
      ),
    ),
    "merge_in_progress",
  );
  const branchResult = command(repo, "git", [
    "symbolic-ref",
    "--quiet",
    "HEAD",
  ]);
  requireThat(
    !branchResult.error &&
      (branchResult.status === 0 || branchResult.status === 1),
    "branch_observation_failed",
  );
  const branchRef =
    branchResult.status === 0 ? line(branchResult.stdout) : null;
  const branch = branchRef?.replace(/^refs\/heads\//, "") ?? null;
  const headResult = command(repo, "git", [
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD^{commit}",
  ]);
  if (headResult.status !== 0) {
    requireThat(
      !headResult.error &&
        headResult.status === 1 &&
        branchRef &&
        command(repo, "git", ["show-ref", "--verify", "--quiet", branchRef])
          .status === 1,
      "head_observation_failed",
    );
  }
  const gitDir = realpathSync(
    line(git(repo, ["rev-parse", "--absolute-git-dir"])),
  );
  const indexPath = line(
    git(repo, ["rev-parse", "--path-format=absolute", "--git-path", "index"]),
  );
  const refsResult = command(repo, "git", [
    "for-each-ref",
    "--format=%(refname) %(objectname) %(symref)",
  ]);
  requireThat(
    !refsResult.error && refsResult.status === 0,
    "refs_observation_failed",
  );
  const branchConfig = command(repo, "git", [
    "config",
    "--null",
    "--get-regexp",
    "^branch\\.",
  ]);
  requireThat(
    !branchConfig.error &&
      (branchConfig.status === 0 || branchConfig.status === 1),
    "config_observation_failed",
  );
  return {
    repository: repo,
    gitDir,
    branch,
    branchRef,
    head: headResult.status === 0 ? line(headResult.stdout) : null,
    changes: changes(repo),
    index: existsSync(indexPath) ? digest(readFileSync(indexPath)) : null,
    refs: refsResult.stdout.toString(),
    refsDiagnostics: digest(refsResult.stderr),
    branchConfig: branchConfig.stdout.toString("base64"),
    default: localDefault(repo, branch),
  };
}
export function sameSnapshot(repo: string, expected: Snapshot): void {
  requireThat(
    JSON.stringify(snapshot(repo)) === JSON.stringify(expected),
    "repository_drift",
  );
}
export function scope(value: unknown, repo: string): Scope {
  if (value === undefined) return { kind: "all" };
  const input = object(value);
  if (input.kind === "all" || input.kind === "staged")
    return { kind: input.kind };
  requireThat(
    input.kind === "paths" &&
      Array.isArray(input.paths) &&
      input.paths.length > 0,
    "invalid_scope",
  );
  const paths = input.paths.map((path: unknown) => {
    requireThat(
      typeof path === "string" &&
        path.length > 0 &&
        !path.includes("\0") &&
        !isAbsolute(path),
      "invalid_literal_path",
    );
    const normalized = normalize(path).replace(/\/$/, "");
    requireThat(
      normalized !== ".." && !normalized.startsWith("../"),
      "path_outside_repository",
    );
    let parent = normalized === "." ? repo : dirname(join(repo, normalized));
    while (!existsSync(parent)) parent = dirname(parent);
    const actual = relative(repo, realpathSync(parent));
    requireThat(
      actual !== ".." && !actual.startsWith("../"),
      "path_outside_repository",
    );
    return normalized;
  });
  return { kind: "paths", paths: [...new Set(paths)] };
}
export function inScope(path: Buffer, selected: Scope): boolean {
  if (selected.kind !== "paths") return true;
  return selected.paths.some((item) => {
    if (item === ".") return true;
    const prefix = Buffer.from(item);
    return (
      path.equals(prefix) ||
      (path.subarray(0, prefix.length).equals(prefix) &&
        path[prefix.length] === 47)
    );
  });
}
export function isStaged(change: Change): boolean {
  return ![" ", "?", "!"].includes(change.index);
}
export function questions(state: Snapshot, selected: Scope) {
  const relevant = state.changes.filter(
    (change) =>
      isStaged(change) ||
      (selected.kind !== "staged" &&
        inScope(Buffer.from(change.pathBytes, "base64"), selected)),
  );
  return {
    default: state.default.classification.kind === "ambiguous",
    outsideStaged: state.changes
      .filter(
        (change) =>
          isStaged(change) &&
          (!inScope(Buffer.from(change.pathBytes, "base64"), selected) ||
            (change.originalBytes &&
              !inScope(Buffer.from(change.originalBytes, "base64"), selected))),
      )
      .map((change) => change.path),
    suspicious: relevant
      .filter((change) =>
        /(^|\/)(\.env(?:\..*)?|.*(?:secret|credential).*|id_rsa|.*\.(?:pem|p12|key)|node_modules|dist)(\/|$)/i.test(
          change.path,
        ),
      )
      .map((change) => change.path),
  };
}
export function cleanSubmodules(repo: string): void {
  for (const entry of splitNull(git(repo, ["ls-files", "--stage", "-z"]))) {
    if (!entry.subarray(0, 7).equals(Buffer.from("160000 "))) continue;
    const path = entry.subarray(entry.indexOf(9) + 1);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(path);
    const nested = join(repo, name);
    if (!existsSync(join(nested, ".git"))) continue;
    requireThat(
      realpathSync(line(git(nested, ["rev-parse", "--show-toplevel"]))) ===
        realpathSync(nested),
      "submodule_observation_failed",
    );
    requireThat(
      git(nested, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]).length === 0,
      "dirty_submodule",
    );
    cleanSubmodules(nested);
  }
}
export const diffArgs = [
  "--no-pager",
  "diff",
  "--cached",
  "--no-ext-diff",
  "--no-textconv",
  "--binary",
  "--no-color",
  "--no-renames",
  "--ignore-submodules=none",
];
export function stagedDiff(repo: string): Buffer {
  return git(repo, diffArgs);
}
export function indexEntries(repo: string): string {
  return digest(git(repo, ["ls-files", "--stage", "-z"]));
}
