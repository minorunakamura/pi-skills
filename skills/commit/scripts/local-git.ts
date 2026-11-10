import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export class WorkflowError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function requireThat(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) throw new WorkflowError(code);
}
export function command(
  cwd: string,
  executable: string,
  args: string[],
  input?: Buffer,
) {
  return spawnSync(executable, args, {
    cwd,
    input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
}
export function git(repo: string, args: string[], input?: Buffer): Buffer {
  const result = command(repo, "git", args, input);
  requireThat(!result.error && result.status === 0, "git_observation_failed");
  return result.stdout;
}
export function line(bytes: Buffer): string {
  return bytes.toString("utf8").replace(/\n$/, "");
}
export function repository(path: string): string {
  requireThat(
    isAbsolute(path) && existsSync(path),
    "absolute_repository_required",
  );
  const root = realpathSync(line(git(path, ["rev-parse", "--show-toplevel"])));
  requireThat(realpathSync(path) === root, "repository_root_required");
  return root;
}

export type DefaultEvidence = {
  remotes: { name: string; fetch: string[] }[];
  heads: { ref: string; target: string | null; oid: string | null }[];
  observationFailed: boolean;
};
export type DefaultClassification = {
  kind: "unique" | "absent" | "ambiguous";
  candidates: string[];
  reasons: string[];
  currentIsDefault: boolean;
};
export function localDefault(
  repo: string,
  branch: string | null,
): { evidence: DefaultEvidence; classification: DefaultClassification } {
  const remotes: DefaultEvidence["remotes"] = [];
  const heads: DefaultEvidence["heads"] = [];
  const reasons: string[] = [];
  const candidates = new Set<string>();
  let observationFailed = false;
  try {
    const remoteNames = line(git(repo, ["remote"]))
      .split("\n")
      .filter(Boolean);
    for (const name of remoteNames) {
      const fetch = command(repo, "git", [
        "config",
        "--null",
        "--get-all",
        `remote.${name}.fetch`,
      ]);
      requireThat(
        !fetch.error && (fetch.status === 0 || fetch.status === 1),
        "fetch_observation_failed",
      );
      remotes.push({
        name,
        fetch: fetch.stdout.toString().split("\0").filter(Boolean),
      });
    }
    const refs = command(repo, "git", [
      "for-each-ref",
      "--format=%(refname)",
      "refs/remotes/",
    ]);
    requireThat(!refs.error && refs.status === 0, "refs_observation_failed");
    const names = new Set(
      line(refs.stdout)
        .split("\n")
        .filter((name) => name.endsWith("/HEAD")),
    );
    // for-each-ref omits dangling symbolic refs; discover their names, not just resolved refs.
    const common = line(
      git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    );
    const walk = (directory: string, prefix: string) => {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory())
          walk(join(directory, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name === "HEAD") names.add(`${prefix}HEAD`);
      }
    };
    walk(join(common, "refs/remotes"), "refs/remotes/");
    for (const name of remoteNames) {
      const ref = `refs/remotes/${name}/HEAD`;
      const symbolic = command(repo, "git", ["symbolic-ref", "--quiet", ref]);
      requireThat(
        !symbolic.error && (symbolic.status === 0 || symbolic.status === 1),
        "remote_head_observation_failed",
      );
      if (symbolic.status === 0) names.add(ref);
    }
    for (const ref of [...names].sort()) {
      const symbolic = command(repo, "git", ["symbolic-ref", "--quiet", ref]);
      const resolved = command(repo, "git", [
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      ]);
      requireThat(
        !symbolic.error &&
          !resolved.error &&
          (symbolic.status === 0 || symbolic.status === 1) &&
          (resolved.status === 0 || resolved.status === 1),
        "remote_head_observation_failed",
      );
      const target = symbolic.status === 0 ? line(symbolic.stdout) : null;
      const oid = resolved.status === 0 ? line(resolved.stdout) : null;
      heads.push({ ref, target, oid });
      const remoteName = ref.slice("refs/remotes/".length, -"/HEAD".length);
      const remote = remotes.find((item) => item.name === remoteName);
      if (!target || !oid || !remote) {
        reasons.push(
          `${ref}: ${!target ? "non-symbolic" : !oid ? "broken" : "orphan"}`,
        );
        continue;
      }
      const mapped = new Set<string>();
      let invalid = false;
      const negative: string[] = [];
      for (const original of remote.fetch) {
        if (original.startsWith("^")) {
          negative.push(original.slice(1));
          continue;
        }
        const parts = original.replace(/^\+/, "").split(":");
        const [source, destination] = parts;
        if (
          parts.length !== 2 ||
          !source?.startsWith("refs/") ||
          !destination?.startsWith("refs/")
        ) {
          invalid = true;
          continue;
        }
        const match = reverseMapping(destination, source, target);
        if (match === undefined) {
          invalid = true;
          continue;
        }
        if (match !== null) mapped.add(match);
      }
      for (const source of mapped) {
        if (negative.some((pattern) => matchesRef(pattern, source)))
          mapped.delete(source);
      }
      if (
        invalid ||
        mapped.size !== 1 ||
        ![...mapped][0].startsWith("refs/heads/")
      ) {
        reasons.push(`${ref}: unknown mapping`);
      } else candidates.add([...mapped][0].slice("refs/heads/".length));
    }
    if (refs.stderr.length && !heads.some((head) => !head.oid))
      reasons.push("remote HEAD observation diagnostics");
  } catch {
    observationFailed = true;
    reasons.push("local default observation failed");
  }
  if (candidates.size > 1) reasons.push("conflicting local defaults");
  const kind = reasons.length
    ? "ambiguous"
    : candidates.size === 1
      ? "unique"
      : "absent";
  return {
    evidence: { remotes, heads, observationFailed },
    classification: {
      kind,
      candidates: [...candidates].sort(),
      reasons,
      currentIsDefault:
        kind === "unique"
          ? candidates.has(branch ?? "")
          : kind === "absent" && (branch === "main" || branch === "master"),
    },
  };
}
function reverseMapping(
  destination: string,
  source: string,
  target: string,
): string | null | undefined {
  const d = destination.split("*");
  const s = source.split("*");
  if (d.length !== s.length || d.length > 2) return undefined;
  if (d.length === 1) return destination === target ? source : null;
  if (
    !target.startsWith(d[0]) ||
    !target.endsWith(d[1]) ||
    target.length < d[0].length + d[1].length
  )
    return null;
  return s[0] + target.slice(d[0].length, target.length - d[1].length) + s[1];
}
function matchesRef(pattern: string, ref: string): boolean {
  const parts = pattern.split("*");
  requireThat(
    parts.length <= 2 && pattern.startsWith("refs/"),
    "unsupported_negative_fetch",
  );
  return parts.length === 1
    ? pattern === ref
    : ref.startsWith(parts[0]) && ref.endsWith(parts[1]);
}
