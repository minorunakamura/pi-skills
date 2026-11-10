import { command, git, line, requireThat } from "./local-git.ts";
import { digest, object } from "./private-files.ts";
import { snapshot, type Snapshot } from "./commit-state.ts";

export type PushOptions = {
  remote: string;
  target: string | null;
  initialMain: boolean;
  setUpstream: boolean;
};
export type PushContext = ReturnType<typeof pushContext>;
export type RemoteState = ReturnType<typeof remoteState>;
export type Destination = PushContext &
  PushOptions & {
    target: string;
    branch: string;
    observed: RemoteState;
    tracking: string | null;
  };
function text(value: unknown): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      !Array.from(value).some(
        (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
      ) &&
      !value.startsWith("-") &&
      Buffer.from(value).toString() === value,
    "invalid_push_input",
  );
}
export function pushOptions(value: unknown): PushOptions {
  const input = object(value);
  requireThat(
    Object.keys(input).every((key) =>
      ["remote", "target", "initialMain", "setUpstream"].includes(key),
    ),
    "invalid_push_input",
  );
  text(input.remote);
  if (input.target !== undefined) text(input.target);
  for (const key of ["initialMain", "setUpstream"])
    requireThat(
      input[key] === undefined || typeof input[key] === "boolean",
      "invalid_push_input",
    );
  return {
    remote: input.remote,
    target: (input.target as string | undefined) ?? null,
    initialMain: input.initialMain === true,
    setUpstream: input.setUpstream === true,
  };
}
function config(repo: string, pattern: string): Buffer {
  const result = command(repo, "git", [
    "config",
    "--null",
    "--get-regexp",
    pattern,
  ]);
  requireThat(
    !result.error && (result.status === 0 || result.status === 1),
    "push_config_observation_failed",
  );
  return result.stdout;
}
export function pushContext(repo: string, remote: string) {
  requireThat(
    line(git(repo, ["remote"]))
      .split("\n")
      .includes(remote),
    "unknown_remote",
  );
  const urls = line(
    git(repo, ["remote", "get-url", "--push", "--all", remote]),
  ).split("\n");
  requireThat(urls.length === 1, "multiple_push_urls");
  const url = urls[0];
  requireThat(
    url.length > 0 &&
      !Array.from(url).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) &&
      !url.startsWith("-") &&
      !url.startsWith("ext::"),
    "unsupported_push_url",
  );
  let sshHost: string | null = null;
  let sshOptions: string[] = [];
  if (url.includes("://")) {
    const parsed = new URL(url);
    requireThat(
      !parsed.password &&
        (!(parsed.protocol === "https:" || parsed.protocol === "http:") ||
          !parsed.username),
      "credentials_in_remote_url",
    );
    requireThat(
      !parsed.search &&
        !parsed.hash &&
        ["https:", "http:", "ssh:", "file:"].includes(parsed.protocol),
      "unsupported_push_url",
    );
    if (parsed.protocol === "ssh:") {
      sshHost = parsed.hostname;
      sshOptions = [
        ...(parsed.username ? ["-l", decodeURIComponent(parsed.username)] : []),
        ...(parsed.port ? ["-p", parsed.port] : []),
      ];
    }
  } else {
    const match = /^(?:([^/@:]+)@)?([^/:]+):(.+)$/.exec(url);
    if (match) {
      sshHost = match[2];
      sshOptions = match[1] ? ["-l", match[1]] : [];
    }
  }
  let ssh: string | null = null;
  if (sshHost !== null) {
    requireThat(
      !process.env.GIT_SSH_COMMAND &&
        !process.env.GIT_SSH &&
        config(repo, "^core\\.sshcommand$").length === 0,
      "custom_ssh_command_unsupported",
    );
    text(sshHost);
    const result = command(repo, "ssh", ["-G", ...sshOptions, "--", sshHost]);
    requireThat(!result.error && result.status === 0, "ssh_host_unresolved");
    const hosts = result.stdout
      .toString()
      .split("\n")
      .filter((row) => row.startsWith("hostname "));
    requireThat(
      hosts.length === 1 && hosts[0].slice(9).length > 0,
      "ssh_host_unresolved",
    );
    ssh = digest(result.stdout);
  }
  const fetchResult = command(repo, "git", [
    "config",
    "--null",
    "--get-all",
    `remote.${remote}.fetch`,
  ]);
  requireThat(
    !fetchResult.error &&
      (fetchResult.status === 0 || fetchResult.status === 1),
    "push_config_observation_failed",
  );
  return {
    url,
    configDigest: digest(
      config(repo, "^(remote\\.|url\\.|core\\.sshcommand$)"),
    ),
    fetch: fetchResult.stdout.toString().split("\0").filter(Boolean),
    ssh,
  };
}
export function remoteState(repo: string, url: string) {
  const result = command(repo, "git", ["ls-remote", "--symref", "--", url]);
  requireThat(
    !result.error && result.status === 0,
    "remote_observation_failed",
  );
  const refs: Record<string, string> = {};
  let defaultBranch: string | null = null;
  const rows = new TextDecoder("utf-8", { fatal: true })
    .decode(result.stdout)
    .split("\n")
    .filter(Boolean);
  for (const row of rows) {
    const parts = row.split("\t");
    requireThat(parts.length === 2, "invalid_remote_refs");
    const [value, ref] = parts;
    if (value.startsWith("ref: ")) {
      requireThat(
        ref === "HEAD" &&
          value.startsWith("ref: refs/heads/") &&
          defaultBranch === null,
        "invalid_remote_refs",
      );
      defaultBranch = value.slice("ref: refs/heads/".length);
    } else {
      requireThat(
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) &&
          !Object.hasOwn(refs, ref),
        "invalid_remote_refs",
      );
      refs[ref] = value;
    }
  }
  requireThat(
    !Object.keys(refs).length ||
      (defaultBranch !== null && refs[`refs/heads/${defaultBranch}`]),
    "unknown_remote_default_branch",
  );
  return { refs, defaultBranch, empty: rows.length === 0 };
}
export function sameContext(
  repo: string,
  remote: string,
  expected: PushContext,
) {
  requireThat(
    JSON.stringify(pushContext(repo, remote)) ===
      JSON.stringify({
        url: expected.url,
        configDigest: expected.configDigest,
        fetch: expected.fetch,
        ssh: expected.ssh,
      }),
    "push_destination_drift",
  );
}
function remoteBoundary(state: RemoteState, target: string | null) {
  return {
    defaultBranch: state.defaultBranch,
    defaultHead: state.defaultBranch
      ? state.refs[`refs/heads/${state.defaultBranch}`]
      : null,
    empty: state.empty,
    targetHead: target ? (state.refs[`refs/heads/${target}`] ?? null) : null,
  };
}
export function sameRemote(
  repo: string,
  context: PushContext,
  expected: RemoteState,
  target: string | null,
) {
  requireThat(
    JSON.stringify(remoteBoundary(remoteState(repo, context.url), target)) ===
      JSON.stringify(remoteBoundary(expected, target)),
    "remote_drift",
  );
}
function outgoingBase(
  repo: string,
  state: Snapshot,
  remote: RemoteState,
  target: string | null,
) {
  const targetHead = target ? remote.refs[`refs/heads/${target}`] : undefined;
  const base =
    targetHead ??
    (remote.defaultBranch
      ? remote.refs[`refs/heads/${remote.defaultBranch}`]
      : undefined);
  if (base) git(repo, ["cat-file", "-e", `${base}^{commit}`]);
  if (targetHead && targetHead !== state.head) {
    requireThat(state.head, "non_fast_forward");
    const ancestor = command(repo, "git", [
      "merge-base",
      "--is-ancestor",
      targetHead,
      state.head,
    ]);
    requireThat(!ancestor.error && ancestor.status === 0, "non_fast_forward");
  }
  return base;
}
export function pushHistory(
  repo: string,
  state: Snapshot,
  remote: RemoteState,
  target: string | null,
) {
  const base = outgoingBase(repo, state, remote, target);
  return state.head
    ? git(repo, [
        "--no-pager",
        "log",
        "--no-show-signature",
        "--no-notes",
        "--format=%H%n%B%n---",
        base ? `${base}..${state.head}` : state.head,
        "--",
      ])
    : Buffer.alloc(0);
}
function trackingRef(
  repo: string,
  specs: string[],
  target: string,
): string | null {
  let mapped: string | null = null;
  const ref = `refs/heads/${target}`;
  for (const original of specs) {
    const negative = original.startsWith("^");
    const parts = original.replace(/^[+^]/, "").split(":");
    requireThat(
      parts.length === (negative ? 1 : 2) &&
        parts.every(
          (part) => part.startsWith("refs/") && part.split("*").length <= 2,
        ) &&
        (negative || parts[0].split("*").length === parts[1].split("*").length),
      "unsupported_fetch_refspec",
    );
    for (const part of parts)
      git(repo, ["check-ref-format", "--refspec-pattern", part]);
    // Only the first positive match can be updated; Git may leave it unchanged.
    if (negative || mapped !== null) continue;
    const [source, destination] = parts;
    const [prefix, suffix] = source.split("*");
    if (suffix === undefined) {
      if (source === ref) mapped = destination;
    } else if (
      ref.startsWith(prefix) &&
      ref.endsWith(suffix) &&
      ref.length >= prefix.length + suffix.length
    ) {
      mapped = destination.replace(
        "*",
        ref.slice(prefix.length, ref.length - suffix.length),
      );
    }
  }
  return mapped;
}
export function assertSafeTrackingRef(repo: string, tracking: string | null) {
  if (tracking === null) return;
  requireThat(
    !tracking.startsWith("refs/heads/") && !tracking.startsWith("refs/tags/"),
    "unsafe_push_tracking_ref",
  );
  // Even a dangling symref can redirect Git's push-side update to another ref.
  const symbolic = command(repo, "git", [
    "symbolic-ref",
    "--quiet",
    "--no-recurse",
    tracking,
  ]);
  requireThat(symbolic.status !== 0, "unsafe_push_tracking_ref");
  requireThat(
    !symbolic.error && symbolic.status === 1,
    "push_tracking_observation_failed",
  );
}
export function destination(
  repo: string,
  options: PushOptions,
  context: PushContext,
  observed: RemoteState,
  state: Snapshot,
  branch: string,
): Destination {
  const target = options.target ?? branch;
  git(repo, ["check-ref-format", `refs/heads/${target}`]);
  if (options.initialMain)
    requireThat(
      observed.empty &&
        state.branch === "main" &&
        branch === "main" &&
        target === "main",
      "initial_main_requires_empty_remote",
    );
  else
    requireThat(
      target !== "main" && target !== observed.defaultBranch,
      "protected_push_target",
    );
  outgoingBase(repo, state, observed, target);
  if (options.setUpstream) {
    const entries = Buffer.from(state.branchConfig, "base64")
      .toString()
      .split("\0");
    const values = (key: string) =>
      entries
        .filter((row) => row.startsWith(`${key}\n`))
        .map((row) => row.slice(key.length + 1));
    const remote = values(`branch.${branch}.remote`);
    const merge = values(`branch.${branch}.merge`);
    requireThat(
      (remote.length === 0 && merge.length === 0) ||
        (remote.length === 1 &&
          remote[0] === options.remote &&
          merge.length === 1 &&
          merge[0] === `refs/heads/${target}`),
      "conflicting_upstream",
    );
  }
  const tracking = trackingRef(repo, context.fetch, target);
  assertSafeTrackingRef(repo, tracking);
  return {
    ...context,
    ...options,
    target,
    branch,
    observed,
    tracking,
  };
}
export function upstreamMatches(state: Snapshot, planned: Destination) {
  const entries = Buffer.from(state.branchConfig, "base64")
    .toString()
    .split("\0");
  return (
    entries.includes(`branch.${planned.branch}.remote\n${planned.remote}`) &&
    entries.includes(
      `branch.${planned.branch}.merge\nrefs/heads/${planned.target}`,
    )
  );
}
export function verifyPushedLocal(
  repo: string,
  before: Snapshot,
  planned: Destination,
  sha: string,
  upstream: boolean,
) {
  const after = snapshot(repo);
  const expected = structuredClone(before);
  // Git can leave tracking unchanged, including with a negative fetch refspec.
  if (planned.tracking && after.refs !== before.refs) {
    const refs = expected.refs
      .split("\n")
      .filter(Boolean)
      .filter((row) => !row.startsWith(`${planned.tracking} `));
    refs.push(`${planned.tracking} ${sha} `);
    expected.refs =
      refs
        .map((row) => {
          const [ref, oid, symref] = row.split(" ");
          return `${ref} ${symref === planned.tracking ? sha : oid} ${symref}`;
        })
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .join("\n") + "\n";
    for (const head of expected.default.evidence.heads)
      if (head.target === planned.tracking) head.oid = sha;
  }
  if (upstream) {
    const keys = [
      `branch.${planned.branch}.remote`,
      `branch.${planned.branch}.merge`,
    ];
    const remaining = (value: string) =>
      Buffer.from(value, "base64")
        .toString()
        .split("\0")
        .filter((row) => row && !keys.includes(row.split("\n")[0]))
        .sort();
    requireThat(
      upstreamMatches(after, planned) &&
        JSON.stringify(remaining(before.branchConfig)) ===
          JSON.stringify(remaining(after.branchConfig)),
      "post_push_upstream_verification_failed",
    );
    expected.branchConfig = after.branchConfig;
  }
  requireThat(
    JSON.stringify(after) === JSON.stringify(expected),
    "post_push_local_verification_failed",
  );
}
