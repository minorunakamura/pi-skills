import {
  hasDestinationContent,
  snapshot,
  splitNull,
  type Scope,
} from "./commit-state.ts";
import { command, line, WorkflowError } from "./local-git.ts";
import { prOptions, repositoryFromUrl } from "./pull-request.ts";
import { pushContext } from "./push-git.ts";

const safeName = (value: string) =>
  value.length > 0 &&
  !value.startsWith("-") &&
  Buffer.from(value).toString() === value &&
  !Array.from(value).some(
    (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
  );
type ConfigValue =
  | { kind: "valueless" | "empty" | "invalid" | "missingRemote" }
  | { kind: "value"; value: string };
type ConfigEvidence = {
  state: "absent" | "single" | "multiple" | "unknown";
  values: ConfigValue[];
};
function configEvidence(
  repo: string,
  key: string,
  remoteNames: string[] | null,
  merge = false,
): ConfigEvidence {
  // --get-all loses the distinction between a valueless entry and an empty value.
  const result = command(repo, "git", [
    "config",
    "--null",
    "--get-regexp",
    `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  ]);
  if (result.error || ![0, 1].includes(result.status ?? -1))
    return { state: "unknown", values: [] };
  try {
    const rows = splitNull(result.stdout);
    const values: ConfigValue[] = rows.map((bytes) => {
      const row = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (row === key) return { kind: "valueless" };
      if (!row.startsWith(`${key}\n`)) throw new Error();
      const value = row.slice(key.length + 1);
      if (!value) return { kind: "empty" };
      if (merge) {
        const ref = command(repo, "git", ["check-ref-format", value]);
        if (ref.error) throw new Error();
        if (!value.startsWith("refs/heads/") || ref.status !== 0)
          return { kind: "invalid" };
      } else {
        if (!safeName(value)) return { kind: "invalid" };
        if (remoteNames === null) throw new Error();
        if (!remoteNames.includes(value)) return { kind: "missingRemote" };
      }
      return { kind: "value", value };
    });
    return {
      state:
        values.length === 0
          ? "absent"
          : values.length === 1
            ? "single"
            : "multiple",
      values,
    };
  } catch {
    return { state: "unknown", values: [] };
  }
}
const remoteReasons = new Set([
  "unknown_remote",
  "multiple_push_urls",
  "unsupported_push_url",
  "credentials_in_remote_url",
  "custom_ssh_command_unsupported",
  "ssh_host_unresolved",
  "push_config_observation_failed",
  "git_observation_failed",
]);
export function destinations(
  repo: string,
  mode: "push" | "pr",
  selected: Scope,
) {
  const state = snapshot(repo);
  const needed = hasDestinationContent(state, selected);
  if (!needed)
    return {
      mode,
      needed,
      branch: state.branch,
      head: state.head,
      config: Object.fromEntries(
        [
          "branchPushRemote",
          "remotePushDefault",
          "branchRemote",
          "branchMerge",
        ].map((key) => [key, { state: "unknown", values: [] }]),
      ),
      remotes: [],
      basis: { source: null, remote: null },
      reasons: [],
      localInformationMayBeStale: true,
      sshEvaluationMayHaveSideEffects: true,
    };
  const reasons: string[] = [];
  const listed = command(repo, "git", ["remote"]);
  const observed = !listed.error && listed.status === 0;
  const remoteNames = observed
    ? line(listed.stdout).split("\n").filter(Boolean)
    : null;
  if (!observed) reasons.push("remote_observation_failed");
  const config = {
    branchPushRemote:
      state.branch === null
        ? ({ state: "absent", values: [] } as ConfigEvidence)
        : configEvidence(
            repo,
            `branch.${state.branch}.pushremote`,
            remoteNames,
          ),
    remotePushDefault: configEvidence(repo, "remote.pushdefault", remoteNames),
    branchRemote:
      state.branch === null
        ? ({ state: "absent", values: [] } as ConfigEvidence)
        : configEvidence(repo, `branch.${state.branch}.remote`, remoteNames),
    branchMerge:
      state.branch === null
        ? ({ state: "absent", values: [] } as ConfigEvidence)
        : configEvidence(
            repo,
            `branch.${state.branch}.merge`,
            remoteNames,
            true,
          ),
  };
  const remotes =
    remoteNames !== null
      ? remoteNames.map((name) => {
          let url: string | null = null;
          let repository: string | null = null;
          const reasons: string[] = [];
          if (!safeName(name))
            return {
              name: null,
              url,
              repository,
              reasons: ["unsupported_remote_name"],
            };
          try {
            const context = pushContext(repo, name);
            // file URLs with userinfo are not useful candidates and must not expose it.
            if (
              context.url.includes("://") &&
              new URL(context.url).protocol === "file:" &&
              new URL(context.url).username
            )
              throw new WorkflowError("credentials_in_remote_url");
            url = context.url;
            if (mode === "pr") {
              try {
                const candidate = repositoryFromUrl(repo, url);
                repository = prOptions({
                  repository: `${candidate.host}/${candidate.slug}`,
                }).repository;
              } catch (error) {
                reasons.push(
                  error instanceof WorkflowError &&
                    error.code === "ssh_host_unresolved"
                    ? error.code
                    : "unsupported_pr_repository",
                );
              }
            }
          } catch (error) {
            reasons.push(
              error instanceof WorkflowError && remoteReasons.has(error.code)
                ? error.code
                : "unsupported_push_url",
            );
          }
          return { name, url, repository, reasons };
        })
      : [];
  let source: string | null = null;
  let remote: string | null = null;
  for (const key of [
    "branchPushRemote",
    "remotePushDefault",
    "branchRemote",
  ] as const) {
    const evidence = config[key];
    if (evidence.state === "absent") continue;
    source = key;
    if (
      evidence.state === "single" &&
      evidence.values[0].kind === "missingRemote"
    )
      reasons.push("configured_remote_missing");
    else if (evidence.state !== "single" || evidence.values[0].kind !== "value")
      reasons.push("invalid_destination_config");
    else {
      const value = evidence.values[0].value;
      if (!remotes.some((item) => item.name === value))
        reasons.push("configured_remote_missing");
      else remote = value;
    }
    break;
  }
  if (source === null && observed) {
    if (remotes.length === 1) {
      source = "singleRemote";
      remote = remotes[0].name;
    } else reasons.push(remotes.length ? "multiple_remotes" : "no_remotes");
  }
  if (remotes.some((item) => item.reasons.length > 0))
    reasons.push("unsupported_candidates");
  return {
    mode,
    needed,
    branch: state.branch,
    head: state.head,
    config,
    remotes,
    basis: { source, remote },
    reasons,
    localInformationMayBeStale: true,
    sshEvaluationMayHaveSideEffects: true,
  };
}
