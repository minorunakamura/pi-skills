import { destinations } from "./destinations.ts";
import { materialPage, view, displayBudget } from "./material-page.ts";
import {
  prOptions,
  preparePr,
  samePrPreparation,
  prMaterials,
  existingPrs,
  prText,
  createPr,
  type PrOptions,
  type PrPreparation,
  type ExistingPr,
  type PrText,
} from "./pull-request.ts";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import {
  cleanSubmodules,
  hasDestinationContent,
  indexEntries,
  inScope,
  isStaged,
  questions,
  sameSnapshot,
  scope,
  snapshot,
  splitNull,
  stagedDiff,
  type Scope,
  type Snapshot,
} from "./commit-state.ts";
import { command, git, line, requireThat, WorkflowError } from "./local-git.ts";
import {
  cleanup,
  createPrivate,
  digest,
  object,
  readJson,
  readOwned,
  reference,
  removeOwned,
  save,
  saveJson,
  type Reference,
} from "./private-files.ts";
import { repository } from "./local-git.ts";

import {
  assertSafeTrackingRef,
  destination,
  pushContext,
  pushHistory,
  pushOptions,
  remoteState,
  sameContext,
  sameRemote,
  upstreamMatches,
  verifyPushedLocal,
  type Destination,
  type PushContext,
  type PushOptions,
  type RemoteState,
} from "./push-git.ts";

type BranchPolicy = {
  mode: "commit" | "commit-main" | "push" | "pr";
  pr: PrOptions | null;
  push: PushOptions | null;
  context: PushContext | null;
  requestedBranch: string | null;
};
type Inspection = BranchPolicy & {
  phase: "inspect";
  state: Snapshot;
  scope: Scope;
};
type Materials = BranchPolicy & {
  phase: "materials";
  prepared?: {
    newBranch: string | null;
    destination: Destination | null;
    existingPrs: ExistingPr[];
    message: string | null;
    prText: PrText | null;
  };
  state: Snapshot;
  scope: Scope;
  commitNeeded: boolean;
  pushRemote: RemoteState | null;
  prPreparation: PrPreparation | null;
  prDiffDigest: string | null;
  prReusablePaths: string[];
  prFiles: { pathBytes: string; path: string; reusedStaged: boolean }[];
  prMergeBase: string | null;
  tree: string;
  entries: string;
  diffDigest: string;
  scanner: "passed" | "unavailable";
  defaultAnswer: string | null;
  createBranch: boolean;
};
type Plan = Omit<Materials, "phase"> & {
  phase: "plan";
  message: string | null;
  prText: PrText | null;
  existingPrs: ExistingPr[];
  destination: Destination | null;
  newBranch: string | null;
};
type HeldState = Inspection | Materials | Plan;
let owned: Reference | undefined;
let operationMayHaveSucceeded = false;
let commitSucceeded = false;
let commitVerified = false;
let pushAttempted = false;
let pushSucceeded = false;
let pushVerified = false;
let upstreamConfigured = false;
let prAttempted = false;
let prVerified = false;
let remoteObserved: string | null | undefined;
const execution: { destination: Destination | null; verifiedCommit?: string } =
  { destination: null };
let branchMayHaveChanged = false;
let branchCreated = false;
let observed: { branch: string | null; head: string | null } | undefined;
let activeRepository: string | undefined;
function unchangedPolicy(before: Snapshot, after: Snapshot) {
  requireThat(
    before.repository === after.repository &&
      before.gitDir === after.gitDir &&
      before.branchRef === after.branchRef &&
      before.head === after.head &&
      before.refs === after.refs &&
      before.refsDiagnostics === after.refsDiagnostics &&
      before.branchConfig === after.branchConfig &&
      JSON.stringify(before.default) === JSON.stringify(after.default),
    "repository_drift",
  );
}

function validateNewBranch(
  repo: string,
  state: Snapshot,
  value: unknown,
  protectedBranches?: (string | null)[],
): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      value !== "HEAD" &&
      !value.startsWith("-") &&
      !value.includes("\0") &&
      Buffer.from(value).toString() === value,
    "invalid_branch",
  );
  const checked = command(repo, "git", [
    "check-ref-format",
    `refs/heads/${value}`,
  ]);
  requireThat(!checked.error && checked.status === 0, "invalid_branch");
  const target = `refs/heads/${value}`;
  const refs = state.refs
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.split(" ")[0]);
  // for-each-ref omits dangling symbolic refs, which switch -c can follow.
  const common = line(
    git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const walk = (directory: string, prefix: string) => {
    if (!lstatSync(directory, { throwIfNoEntry: false })) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const ref = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(directory, entry.name), `${ref}/`);
      else refs.push(ref);
    }
  };
  walk(join(common, "refs/heads"), "refs/heads/");
  requireThat(
    state.branchRef !== target &&
      !refs.some(
        (ref) =>
          ref === target ||
          ref.startsWith(`${target}/`) ||
          target.startsWith(`${ref}/`),
      ),
    "branch_exists",
  );
  const classification = state.default.classification;
  requireThat(
    !(protectedBranches
      ? protectedBranches.includes(value)
      : classification.kind === "unique"
        ? classification.candidates.includes(value)
        : classification.kind === "absent" &&
          ["main", "master"].includes(value)),
    "new_branch_is_default_use_commit_main",
  );
  const config = Buffer.from(state.branchConfig, "base64")
    .toString()
    .split("\0");
  const values = (key: string) =>
    config
      .filter((entry) => entry.startsWith(`${key}\n`))
      .map((entry) => entry.slice(key.length + 1));
  const remote = values(`branch.${value}.remote`).at(-1);
  const merges = values(`branch.${value}.merge`);
  const fetch =
    state.default.evidence.remotes.find((item) => item.name === remote)
      ?.fetch ?? [];
  // --no-track does not remove pre-existing upstream settings for a ref-less branch.
  const hasUpstream = merges.some(
    (merge) =>
      merge.length > 0 &&
      (remote === "." ||
        fetch.some((spec) => {
          if (spec.startsWith("^")) return false;
          const [source, destination] = spec.replace(/^\+/, "").split(":");
          if (!source || !destination) return false;
          const [prefix, suffix] = source.split("*");
          return suffix === undefined
            ? source === merge
            : merge.startsWith(prefix) &&
                merge.endsWith(suffix) &&
                merge.length >= prefix.length + suffix.length;
        })),
  );
  requireThat(!hasUpstream, "branch_upstream_exists");
}
function branchSnapshot(state: Snapshot, name: string): Snapshot {
  const ref = `refs/heads/${name}`;
  return {
    ...state,
    branch: name,
    branchRef: ref,
    refs:
      [
        ...state.refs.split("\n").filter(Boolean),
        ...(state.head ? [`${ref} ${state.head} `] : []),
      ]
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .join("\n") + (state.head || state.refs ? "\n" : ""),
    default: {
      ...state.default,
      classification: {
        ...state.default.classification,
        currentIsDefault: false,
      },
    },
  };
}

function held(ref: Reference): { name: string; data: HeldState } {
  const names = Object.keys(ref.files).filter((name) =>
    name.startsWith("state-"),
  );
  requireThat(names.length === 1, "invalid_reference");
  return { name: names[0], data: readJson<HeldState>(ref, names[0]) };
}
function transition(ref: Reference, previous: string, data: HeldState) {
  const name = `state-${randomUUID()}.json`;
  saveJson(ref, name, data);
  removeOwned(ref, previous);
}
function release(ref: Reference) {
  for (const name of [
    "diff.bin",
    "history.bin",
    "recent-history.bin",
    "pr-diff.bin",
    "pr-history.bin",
    "pr-templates.bin",
  ])
    if (ref.files[name]) removeOwned(ref, name);
}
function scan(repo: string, diff: Buffer): "passed" | "unavailable" {
  const scanner = (process.env.PATH ?? "/usr/bin:/bin")
    .split(delimiter)
    .map((directory) => resolve(repo, directory, "gitleaks"))
    .find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
  if (!scanner) return "unavailable";
  const result = command(
    repo,
    scanner,
    [
      "stdin",
      "--redact=100",
      "--exit-code=1",
      "--report-format=json",
      "--report-path=-",
    ],
    diff,
  );
  requireThat(
    !result.error && result.status === 0,
    "staged_secret_scan_failed",
  );
  return "passed";
}
function materialView(ref: Reference, data: Materials) {
  const files = data.state.changes
    .filter(isStaged)
    .map(({ path, index, originalPath }) => ({
      path,
      index,
      ...(originalPath ? { originalPath } : {}),
    }));
  const diff = readOwned(ref, "diff.bin");
  const history = readOwned(ref, "history.bin");
  const base = {
    reference: ref,
    phase: "materials",
    branch: data.state.branch,
    head: data.state.head,
    branchPolicy: {
      mode: data.mode,
      createBranch: data.createBranch,
      newBranch: data.requestedBranch,
    },
    tree: data.tree,
    scanner: data.scanner,
    commitNeeded: data.commitNeeded,
    push:
      data.pushRemote && data.context
        ? {
            remote: data.push?.remote,
            url: data.context.url,
            defaultBranch: data.pushRemote.defaultBranch,
            emptyRemote: data.pushRemote.empty,
          }
        : null,
    pr: data.prPreparation
      ? {
          repository: data.prPreparation.options.repository,
          base: data.prPreparation.base,
          baseHead: data.prPreparation.baseHead,
          draft: data.prPreparation.options.draft,
          diffDigest: data.prDiffDigest,
          mergeBase: data.prMergeBase,
          stagedDiffIdentical: data.prDiffDigest === data.diffDigest,
          reusableStagedPathBytes: [...data.prReusablePaths],
          files: [...data.prFiles],
          filesOmitted: 0,
          reusablePathsOmitted: 0,
        }
      : null,
    diffDigest: data.diffDigest,
    diffBytes: diff.length,
    historyBytes: history.length,
    ...(data.push
      ? { recentHistoryBytes: readOwned(ref, "recent-history.bin").length }
      : {}),
    ...(data.prPreparation
      ? {
          prDiffBytes: readOwned(ref, "pr-diff.bin").length,
          prHistoryBytes: readOwned(ref, "pr-history.bin").length,
          prTemplatesBytes: readOwned(ref, "pr-templates.bin").length,
        }
      : {}),
    files,
    filesOmitted: 0,
    displayed: false,
  };
  const small = {
    ...base,
    displayed: true,
    diff: view(diff),
    history: view(history),
    ...(data.push
      ? { recentHistory: view(readOwned(ref, "recent-history.bin")) }
      : {}),
    ...(data.prPreparation
      ? {
          prDiff: view(readOwned(ref, "pr-diff.bin")),
          prHistory: view(readOwned(ref, "pr-history.bin")),
          prTemplates: view(readOwned(ref, "pr-templates.bin")),
        }
      : {}),
  };
  if (Buffer.byteLength(JSON.stringify(small)) <= 32 * 1024) return small;
  while (
    Buffer.byteLength(JSON.stringify(base)) > 24 * 1024 &&
    base.files.length
  ) {
    base.files.pop();
    base.filesOmitted++;
  }
  if (base.pr) {
    while (
      Buffer.byteLength(JSON.stringify(base)) > 28 * 1024 &&
      base.pr.files.length
    ) {
      base.pr.files.pop();
      base.pr.filesOmitted++;
    }
    while (
      Buffer.byteLength(JSON.stringify(base)) > 28 * 1024 &&
      base.pr.reusableStagedPathBytes.length
    ) {
      base.pr.reusableStagedPathBytes.pop();
      base.pr.reusablePathsOmitted++;
    }
  }
  const result = {
    ...base,
    note: "Fixed materials omitted; read by materials names, then returned cursor before planning. Omitted files/prFiles are page reachable; PR reusable paths are also marked by prFiles.reusedStaged.",
  };
  requireThat(
    Buffer.byteLength(JSON.stringify(result)) <= displayBudget,
    "material_metadata_budget_exceeded",
  );
  return result;
}
function main() {
  const [operation, flag, path, ...extra] = process.argv.slice(2);
  requireThat(
    flag === "--repository" && path && extra.length === 0,
    "absolute_repository_required",
  );
  const repo = repository(path);
  activeRepository = repo;
  const bytes = readFileSync(0);
  const input = object(
    bytes.length
      ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      : {},
  );
  if (operation === "destinations") {
    requireThat(
      Object.keys(input).every((key) => ["mode", "scope"].includes(key)),
      "invalid_input",
    );
    requireThat(input.mode === "push" || input.mode === "pr", "invalid_mode");
    return destinations(repo, input.mode, scope(input.scope, repo));
  }
  if (operation === "inspect") {
    requireThat(
      Object.keys(input).every((key) =>
        ["scope", "mode", "newBranch", "push", "pr"].includes(key),
      ),
      "invalid_input",
    );
    const selected = scope(input.scope, repo);
    const state = snapshot(repo);
    const mode = input.mode ?? "commit-main";
    requireThat(
      mode === "commit" ||
        mode === "commit-main" ||
        mode === "push" ||
        mode === "pr",
      "invalid_mode",
    );
    requireThat(
      mode === "push" || mode === "pr" || input.push === undefined,
      "invalid_input",
    );
    requireThat(mode === "pr" || input.pr === undefined, "invalid_input");
    const hasContent = hasDestinationContent(state, selected);
    const push =
      (mode === "push" || mode === "pr") && hasContent
        ? pushOptions(input.push)
        : null;
    const pr = mode === "pr" && hasContent ? prOptions(input.pr) : null;
    requireThat(!pr || !push?.initialMain, "initial_main_push_only");
    const context = push ? pushContext(repo, push.remote) : null;
    requireThat(
      mode !== "commit-main" || input.newBranch === undefined,
      "branch_policy_conflict",
    );
    if (input.newBranch !== undefined)
      validateNewBranch(
        repo,
        state,
        input.newBranch,
        mode === "push" || mode === "pr" ? ["main"] : undefined,
      );
    const policy: BranchPolicy = {
      mode,
      pr,
      push,
      context,
      requestedBranch: (input.newBranch as string | undefined) ?? null,
    };
    owned = createPrivate(repo);
    saveJson(owned, `state-${randomUUID()}.json`, {
      phase: "inspect",
      ...policy,
      state,
      scope: selected,
    } satisfies Inspection);
    return {
      reference: owned,
      branch: state.branch,
      branchPolicy: policy,
      head: state.head,
      changes: state.changes,
      default: state.default.classification,
      evidence: state.default.evidence,
      questions: {
        ...questions(state, selected),
        default:
          mode !== "push" &&
          mode !== "pr" &&
          state.default.classification.kind === "ambiguous",
      },
      localInformationMayBeStale: true,
    };
  }
  const ref = reference(input.reference, repo);
  const current = held(ref);
  owned = ref;
  if (operation === "cleanup") {
    requireThat(Object.keys(input).length === 1, "invalid_input");
    return {
      phase: "cancelled",
      stagedChangesPreserved: true,
      cleanup: cleanup(ref),
    };
  }
  const data = current.data;
  if (operation === "release") {
    requireThat(Object.keys(input).length === 1, "invalid_input");
    release(ref);
    return { reference: ref, payloadRemoved: true };
  }
  if (operation === "read") {
    requireThat(data.phase === "materials", "invalid_material_request");
    if (input.materials !== undefined || input.cursor !== undefined)
      return materialPage(ref, input, (name) => {
        if (name === "files") return data.state.changes.filter(isStaged);
        if (name === "prFiles") {
          requireThat(data.prPreparation !== null, "invalid_material_request");
          return data.prFiles;
        }
        requireThat(
          Object.hasOwn(ref.files, `${name}.bin`),
          "invalid_material_request",
        );
        return readOwned(ref, `${name}.bin`);
      });
    requireThat(Array.isArray(input.parts), "invalid_material_request");
    const parts = input.parts.map((value: unknown) => {
      const part = object(value);
      requireThat(
        [
          "diff",
          "history",
          "recent-history",
          "pr-diff",
          "pr-history",
          "pr-templates",
        ].includes(String(part.name)) &&
          Number.isSafeInteger(part.offset) &&
          Number.isSafeInteger(part.length) &&
          Number(part.offset) >= 0 &&
          Number(part.length) > 0,
        "invalid_material_request",
      );
      const payload = readOwned(ref, `${String(part.name)}.bin`);
      const end = Number(part.offset) + Number(part.length);
      requireThat(end <= payload.length, "invalid_material_request");
      return {
        name: part.name,
        offset: part.offset,
        length: part.length,
        totalBytes: payload.length,
        ...view(payload.subarray(Number(part.offset), end)),
      };
    });
    const result = {
      parts,
      fixed: true,
      prFiles: data.prFiles.slice(
        Number(input.fileOffset ?? 0),
        Number(input.fileOffset ?? 0) + Number(input.fileCount ?? 0),
      ),
      files: data.state.changes
        .filter(isStaged)
        .slice(
          Number(input.fileOffset ?? 0),
          Number(input.fileOffset ?? 0) + Number(input.fileCount ?? 0),
        ),
    };
    requireThat(
      Buffer.byteLength(JSON.stringify(result)) <= 32 * 1024,
      "material_display_budget_exceeded",
    );
    return result;
  }
  if (operation === "materials") {
    requireThat(data.phase === "inspect", "invalid_phase");
    sameSnapshot(repo, data.state);
    requireThat(
      data.state.branch &&
        !data.state.changes.some((change) =>
          ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
            change.index + change.worktree,
          ),
        ),
      "detached_or_conflicted",
    );
    const classification = data.state.default.classification;
    let defaultAnswer: string | null = null;
    if (
      data.mode !== "push" &&
      data.mode !== "pr" &&
      classification.kind === "ambiguous"
    ) {
      requireThat(
        typeof input.defaultBranch === "string" &&
          input.defaultBranch.length > 0 &&
          !input.defaultBranch.includes("\n") &&
          !input.defaultBranch.startsWith("-"),
        "default_answer_required",
      );
      git(repo, ["check-ref-format", `refs/heads/${input.defaultBranch}`]);
      defaultAnswer = input.defaultBranch;
      requireThat(
        !data.state.default.evidence.observationFailed,
        "default_observation_failed",
      );
    }
    const currentIsDefault =
      defaultAnswer !== null
        ? defaultAnswer === data.state.branch
        : classification.currentIsDefault;
    requireThat(
      data.mode !== "commit-main" || currentIsDefault,
      "current_branch_is_not_default",
    );
    if (data.requestedBranch !== null) {
      validateNewBranch(
        repo,
        data.state,
        data.requestedBranch,
        data.mode === "push" || data.mode === "pr" ? ["main"] : undefined,
      );
      requireThat(
        data.requestedBranch !== defaultAnswer,
        "new_branch_is_default_use_commit_main",
      );
    }
    const pending = questions(data.state, data.scope);
    requireThat(
      !pending.outsideStaged.length || input.includeOutsideStaged === true,
      "outside_staged_answer_required",
    );
    requireThat(
      !pending.suspicious.length ||
        (Array.isArray(input.reviewedPaths) &&
          pending.suspicious.every(
            (path) =>
              input.reviewedPaths instanceof Array &&
              input.reviewedPaths.includes(path),
          )),
      "suspicious_paths_answer_required",
    );
    cleanSubmodules(repo);
    sameSnapshot(repo, data.state);
    if (data.scope.kind !== "staged") {
      const pendingPaths = [
        ...splitNull(
          git(repo, [
            "diff",
            "--name-only",
            "-z",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=none",
          ]),
        ),
        ...splitNull(
          git(repo, ["ls-files", "--others", "--exclude-standard", "-z"]),
        ),
      ].filter((path) => inScope(path, data.scope));
      if (pendingPaths.length)
        git(
          repo,
          [
            "--literal-pathspecs",
            "add",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ],
          Buffer.concat(
            pendingPaths.flatMap((path) => [path, Buffer.from([0])]),
          ),
        );
    }
    const diff = stagedDiff(repo);
    if (
      !diff.length &&
      ((data.mode !== "push" && data.mode !== "pr") || !data.state.head)
    )
      return { phase: "empty", commitCreated: false, cleanup: cleanup(ref) };
    const tree = line(git(repo, ["write-tree"]));
    const after = snapshot(repo);
    unchangedPolicy(data.state, after);
    const scanner = diff.length ? scan(repo, diff) : "unavailable";
    sameSnapshot(repo, after);
    requireThat(digest(stagedDiff(repo)) === digest(diff), "repository_drift");
    let pushRemote: RemoteState | null = null;
    if (data.push && data.context) {
      sameContext(repo, data.push.remote, data.context);
      pushRemote = remoteState(repo, data.context.url);
      if (data.push.initialMain)
        requireThat(
          pushRemote.empty &&
            after.branch === "main" &&
            (data.push.target === null || data.push.target === "main") &&
            data.requestedBranch === null,
          "initial_main_requires_empty_remote",
        );
    }
    const createBranch =
      data.mode === "push" || data.mode === "pr"
        ? !data.push?.initialMain &&
          (after.branch === "main" ||
            after.branch === pushRemote?.defaultBranch ||
            data.requestedBranch !== null)
        : data.mode === "commit" &&
          (currentIsDefault || data.requestedBranch !== null);
    const preliminaryTarget =
      data.push?.target ??
      data.requestedBranch ??
      (createBranch ? null : after.branch);
    if (pushRemote && data.push && !data.push.initialMain && preliminaryTarget)
      requireThat(
        preliminaryTarget !== "main" &&
          preliminaryTarget !== pushRemote.defaultBranch,
        "protected_push_target",
      );
    if (pushRemote)
      git(repo, [
        "rev-list",
        "--objects",
        "--missing=error",
        tree,
        ...(after.head ? [after.head] : []),
        "--",
      ]);
    const recentHistory = after.head
      ? git(repo, [
          "--no-pager",
          "log",
          "-5",
          "--no-show-signature",
          "--no-notes",
          "--format=%s%n%b%n---",
          after.head,
          "--",
        ])
      : Buffer.alloc(0);
    const history = pushRemote
      ? pushHistory(repo, after, pushRemote, preliminaryTarget)
      : recentHistory;
    if (pushRemote) save(ref, "recent-history.bin", recentHistory);
    const prPreparation =
      data.pr && data.context && pushRemote
        ? preparePr(repo, data.context, pushRemote, data.pr)
        : null;
    const prMaterial = prPreparation
      ? prMaterials(repo, prPreparation, after.head, tree)
      : null;
    if (prMaterial) {
      save(ref, "pr-diff.bin", prMaterial.diff);
      save(ref, "pr-history.bin", prMaterial.history);
      save(
        ref,
        "pr-templates.bin",
        Buffer.from(JSON.stringify(prPreparation?.templates)),
      );
    }
    sameSnapshot(repo, after);
    const materials: Materials = {
      phase: "materials",
      mode: data.mode,
      pr: data.pr,
      prPreparation,
      prDiffDigest: prMaterial ? digest(prMaterial.diff) : null,
      prReusablePaths: prMaterial?.reusablePaths ?? [],
      prFiles: prMaterial?.files ?? [],
      prMergeBase: prMaterial?.mergeBase ?? null,
      push: data.push,
      context: data.context,
      requestedBranch: data.requestedBranch,
      createBranch,
      commitNeeded: diff.length > 0,
      pushRemote,
      state: after,
      scope: data.scope,
      tree,
      entries: indexEntries(repo),
      diffDigest: digest(diff),
      scanner,
      defaultAnswer,
    };
    save(ref, "diff.bin", diff);
    save(ref, "history.bin", history);
    transition(ref, current.name, materials);
    return materialView(ref, materials);
  }
  if (operation === "plan") {
    requireThat(
      (data.phase === "materials" || data.phase === "plan") &&
        Object.keys(input).every(
          (key) =>
            key === "reference" ||
            key === "message" ||
            key === "newBranch" ||
            key === "pr",
        ),
      "invalid_plan_input",
    );
    const message =
      input.message ??
      (data.phase === "plan" ? data.message : (data.prepared?.message ?? null));
    requireThat(
      !data.commitNeeded
        ? input.message === undefined
        : (data.mode === "pr" && message === null) ||
            (typeof message === "string" &&
              message.trim().length > 0 &&
              !message.includes("\0") &&
              Buffer.from(message).toString() === message),
      "invalid_message",
    );
    sameSnapshot(repo, data.state);
    requireThat(
      digest(stagedDiff(repo)) === data.diffDigest &&
        indexEntries(repo) === data.entries,
      "repository_drift",
    );
    const newBranch =
      input.newBranch ??
      (data.phase === "plan"
        ? data.newBranch
        : (data.prepared?.newBranch ?? data.requestedBranch));
    if (data.createBranch) {
      requireThat(
        newBranch !== null && newBranch !== undefined,
        "new_branch_required",
      );
      validateNewBranch(
        repo,
        data.state,
        newBranch,
        data.mode === "push" || data.mode === "pr"
          ? ["main", data.pushRemote?.defaultBranch ?? null]
          : undefined,
      );
      requireThat(
        newBranch !== data.defaultAnswer,
        "new_branch_is_default_use_commit_main",
      );
      requireThat(
        data.requestedBranch === null || data.requestedBranch === newBranch,
        "branch_policy_conflict",
      );
      requireThat(
        data.phase !== "plan" || newBranch === data.newBranch,
        "branch_policy_conflict",
      );
    } else requireThat(newBranch === null, "branch_policy_conflict");
    if (data.phase === "materials" && data.prepared)
      requireThat(
        newBranch === data.prepared.newBranch,
        "branch_policy_conflict",
      );
    const preparedDestination =
      data.phase === "materials" && data.prepared
        ? data.prepared.destination
        : data.push && data.context && data.pushRemote
          ? destination(
              repo,
              data.push,
              data.context,
              data.pushRemote,
              data.state,
              (newBranch as string) ?? data.state.branch ?? "",
            )
          : null;
    if (preparedDestination) {
      sameContext(repo, preparedDestination.remote, preparedDestination);
      sameRemote(
        repo,
        preparedDestination,
        preparedDestination.observed,
        preparedDestination.target,
      );
      sameSnapshot(repo, data.state);
      if (
        data.mode !== "pr" &&
        !data.commitNeeded &&
        newBranch === null &&
        preparedDestination.observed.refs[
          `refs/heads/${preparedDestination.target}`
        ] === data.state.head &&
        (!preparedDestination.setUpstream ||
          upstreamMatches(data.state, preparedDestination))
      )
        return {
          phase: "already_pushed",
          commit: data.state.head,
          commitCreated: false,
          pushSent: false,
          cleanup: cleanup(ref),
        };
    }
    let prs: ExistingPr[] = [];
    let retainedPrText: PrText | null = null;
    if (data.prPreparation && data.context && preparedDestination) {
      requireThat(
        preparedDestination.target === (newBranch ?? data.state.branch),
        "pr_push_destination_mismatch",
      );
      samePrPreparation(repo, data.context, data.prPreparation);
      prs = existingPrs(repo, data.prPreparation, preparedDestination.target);
      const previousPrs =
        data.phase === "plan"
          ? data.existingPrs
          : (data.prepared?.existingPrs ?? []);
      if (previousPrs.length)
        requireThat(
          previousPrs.every((old) => prs.some((now) => now.url === old.url)),
          "prepared_pr_disappeared",
        );
      if (!prs.length) {
        requireThat(
          data.prDiffDigest !== digest(Buffer.alloc(0)),
          "empty_pr_diff",
        );
        const previousText =
          data.phase === "plan" ? data.prText : (data.prepared?.prText ?? null);
        retainedPrText =
          input.pr !== undefined || previousText !== null
            ? prText(input.pr, previousText)
            : null;
      } else requireThat(input.pr === undefined, "existing_pr_needs_no_text");
    } else requireThat(input.pr === undefined, "invalid_plan_input");
    sameSnapshot(repo, data.state);
    if (
      data.prPreparation &&
      preparedDestination &&
      prs.length &&
      !data.commitNeeded &&
      newBranch === null &&
      preparedDestination.observed.refs[
        `refs/heads/${preparedDestination.target}`
      ] === data.state.head &&
      (!preparedDestination.setUpstream ||
        upstreamMatches(data.state, preparedDestination))
    )
      return {
        phase: "existing_pr",
        existingPullRequests: prs,
        commitCreated: false,
        pushSent: false,
        cleanup: cleanup(ref),
      };
    release(ref);
    if (
      data.mode === "pr" &&
      ((data.commitNeeded && message === null) ||
        (!prs.length && retainedPrText === null))
    ) {
      const pending: Materials = {
        ...data,
        phase: "materials",
        prepared: {
          newBranch: newBranch as string | null,
          destination: preparedDestination,
          existingPrs: prs,
          message: message as string | null,
          prText: retainedPrText,
        },
      };
      transition(ref, current.name, pending);
      return {
        reference: ref,
        phase: "materials",
        executable: false,
        requiredInputs: [
          ...(data.commitNeeded && message === null ? ["message"] : []),
          ...(!prs.length && retainedPrText === null
            ? ["pr.title", "pr.body"]
            : []),
        ],
        branch: newBranch ?? data.state.branch,
        message,
        pr: {
          repository: data.prPreparation?.options.repository,
          head: preparedDestination?.target,
          base: data.prPreparation?.base,
          draft: data.prPreparation?.options.draft,
          existingPullRequests: prs,
        },
        payloadRemoved: true,
      };
    }
    const plan: Plan = {
      ...data,
      phase: "plan",
      message: message as string | null,
      prText: retainedPrText,
      existingPrs: prs,
      destination: preparedDestination,
      newBranch: newBranch as string | null,
    };
    transition(ref, current.name, plan);
    return {
      reference: ref,
      phase: "plan",
      message: plan.message,
      pr: plan.prPreparation
        ? {
            repository: plan.prPreparation.options.repository,
            head: preparedDestination?.target,
            base: plan.prPreparation.base,
            baseHead: plan.prPreparation.baseHead,
            draft: plan.prPreparation.options.draft,
            ...plan.prText,
            existingPullRequests: plan.existingPrs,
          }
        : null,
      branch: plan.newBranch ?? plan.state.branch,
      sourceBranch: plan.state.branch,
      newBranch: plan.newBranch,
      parent: plan.state.head,
      tree: plan.tree,
      scope: plan.scope,
      scanner: plan.scanner,
      default: plan.state.default.classification,
      defaultAnswer: plan.defaultAnswer,
      commitNeeded: plan.commitNeeded,
      push: plan.destination
        ? {
            remote: plan.destination.remote,
            url: plan.destination.url,
            target: plan.destination.target,
            sourceBranch: plan.destination.branch,
            defaultBranch: plan.destination.observed.defaultBranch,
            remoteHead:
              plan.destination.observed.refs[
                `refs/heads/${plan.destination.target}`
              ] ?? null,
            initialMain: plan.destination.initialMain,
            setUpstream: plan.destination.setUpstream,
            upstream: plan.destination.setUpstream
              ? {
                  remote: plan.destination.remote,
                  merge: `refs/heads/${plan.destination.target}`,
                }
              : "preserve existing settings",
          }
        : null,
      operations: [
        ...(plan.newBranch
          ? [
              "create planned branch without tracking",
              ...(plan.commitNeeded ? ["commit on planned branch"] : []),
            ]
          : plan.commitNeeded
            ? ["commit directly on current branch"]
            : []),
        ...(plan.commitNeeded ? ["verify commit"] : []),
        ...(plan.destination
          ? [
              "push fixed SHA if needed",
              "verify remote SHA",
              ...(plan.destination.setUpstream
                ? ["configure planned upstream"]
                : []),
            ]
          : []),
        ...(plan.prPreparation
          ? [
              plan.existingPrs.length
                ? "report existing PR without editing"
                : "create PR and verify title/body/draft/head/base/SHA",
            ]
          : []),
        "cleanup",
      ],
      payloadRemoved: true,
      approval: "not inferred from this reference",
    };
  }
  if (operation === "execute") {
    requireThat(
      data.phase === "plan" && Object.keys(input).length === 1,
      "execute_accepts_reference_only",
    );
    sameSnapshot(repo, data.state);
    cleanSubmodules(repo);
    requireThat(
      digest(stagedDiff(repo)) === data.diffDigest &&
        indexEntries(repo) === data.entries &&
        line(git(repo, ["write-tree"])) === data.tree,
      "repository_drift",
    );
    sameSnapshot(repo, data.state);
    execution.destination = data.destination;
    const checkPr = () => {
      if (data.prPreparation && data.context) {
        samePrPreparation(repo, data.context, data.prPreparation);
        const prs = existingPrs(
          repo,
          data.prPreparation,
          data.destination?.target ?? "",
        );
        if (data.existingPrs.length)
          requireThat(
            data.existingPrs.every((old) =>
              prs.some((now) => now.url === old.url),
            ),
            "prepared_pr_disappeared",
          );
        return prs;
      }
      return [];
    };
    const checkDestination = () => {
      if (data.destination) {
        sameContext(repo, data.destination.remote, data.destination);
        assertSafeTrackingRef(repo, data.destination.tracking);
        sameRemote(
          repo,
          data.destination,
          data.destination.observed,
          data.destination.target,
        );
      }
    };
    checkDestination();
    checkPr();
    sameSnapshot(repo, data.state);
    let expectedState = data.state;
    if (data.newBranch !== null) {
      validateNewBranch(
        repo,
        data.state,
        data.newBranch,
        data.mode === "push" || data.mode === "pr"
          ? ["main", data.pushRemote?.defaultBranch ?? null]
          : undefined,
      );
      branchMayHaveChanged = true;
      operationMayHaveSucceeded = true;
      const switched = command(repo, "git", [
        "switch",
        "--no-track",
        "-c",
        data.newBranch,
      ]);
      requireThat(
        !switched.error && switched.status === 0,
        "branch_creation_failed",
      );
      branchCreated = true;
      expectedState = branchSnapshot(data.state, data.newBranch);
      sameSnapshot(repo, expectedState);
      cleanSubmodules(repo);
      requireThat(
        digest(stagedDiff(repo)) === data.diffDigest &&
          indexEntries(repo) === data.entries &&
          line(git(repo, ["write-tree"])) === data.tree,
        "repository_drift",
      );
      sameSnapshot(repo, expectedState);
    }
    let committed: Record<string, unknown> = {};
    if (data.commitNeeded) {
      checkDestination();
      checkPr();
      sameSnapshot(repo, expectedState);
      operationMayHaveSucceeded = true;
      const result = command(
        repo,
        "git",
        ["commit", "--cleanup=verbatim", "--file=-"],
        Buffer.from(data.message ?? ""),
      );
      requireThat(!result.error && result.status === 0, "commit_failed");
      commitSucceeded = true;
      const after = snapshot(repo);
      observed = { branch: after.branch, head: after.head };
      requireThat(after.head, "commit_verification_failed");
      const raw = git(repo, ["cat-file", "commit", after.head]);
      const separator = raw.indexOf("\n\n");
      requireThat(separator >= 0, "commit_verification_failed");
      const headers = raw.subarray(0, separator).toString().split("\n");
      const parents = headers
        .filter((header) => header.startsWith("parent "))
        .map((header) => header.slice(7));
      const tree = headers
        .find((header) => header.startsWith("tree "))
        ?.slice(5);
      const message = raw.subarray(separator + 2);
      const expected = Buffer.from(data.message ?? "");
      const messageMatches =
        message.equals(expected) ||
        (!data.message?.endsWith("\n") &&
          message.equals(Buffer.concat([expected, Buffer.from("\n")])));
      const otherRefs = (state: Snapshot) =>
        state.refs
          .split("\n")
          .filter((ref) => ref && !ref.startsWith(`${state.branchRef} `))
          .join("\n");
      requireThat(
        after.branchRef === expectedState.branchRef &&
          after.gitDir === data.state.gitDir &&
          after.branchConfig === expectedState.branchConfig &&
          otherRefs(after) === otherRefs(expectedState) &&
          after.refsDiagnostics === data.state.refsDiagnostics &&
          JSON.stringify(after.default) ===
            JSON.stringify(expectedState.default) &&
          line(git(repo, ["rev-parse", "--verify", after.branchRef ?? ""])) ===
            after.head &&
          tree === data.tree &&
          JSON.stringify(parents) ===
            JSON.stringify(data.state.head ? [data.state.head] : []) &&
          messageMatches &&
          indexEntries(repo) === data.entries &&
          line(git(repo, ["write-tree"])) === data.tree,
        "commit_verification_failed",
      );
      commitVerified = true;
      execution.verifiedCommit = after.head;
      expectedState = after;
      committed = {
        phase: "committed",
        commit: after.head,
        branch: after.branch,
        tree,
        parents,
        messageDigest: digest(message),
        scanner: data.scanner,
        branchCreated,
      };
    }
    if (data.destination) {
      checkDestination();
      checkPr();
      sameSnapshot(repo, expectedState);
      const planned = data.destination;
      const sha = expectedState.head;
      requireThat(sha, "missing_push_head");
      const alreadyPushed =
        planned.observed.refs[`refs/heads/${planned.target}`] === sha;
      if (!alreadyPushed) {
        operationMayHaveSucceeded = true;
        pushAttempted = true;
        const pushed = command(repo, "git", [
          "-c",
          "push.followTags=false",
          "-c",
          "push.autoSetupRemote=false",
          "-c",
          `remote.${planned.remote}.mirror=false`,
          "push",
          "--porcelain",
          "--recurse-submodules=no",
          "--",
          planned.remote,
          `${sha}:refs/heads/${planned.target}`,
        ]);
        requireThat(
          !pushed.error && pushed.status === 0,
          pushed.error ? "push_result_unknown" : "push_failed",
        );
        pushSucceeded = true;
      }
      remoteObserved =
        remoteState(repo, planned.url).refs[`refs/heads/${planned.target}`] ??
        null;
      requireThat(remoteObserved === sha, "push_verification_failed");
      pushVerified = true;
      sameContext(repo, planned.remote, planned);
      if (alreadyPushed) sameSnapshot(repo, expectedState);
      else verifyPushedLocal(repo, expectedState, planned, sha, false);
      if (planned.setUpstream && !upstreamMatches(expectedState, planned)) {
        const prefix = `branch.${planned.branch}`;
        for (const [key, value] of [
          ["remote", planned.remote],
          ["merge", `refs/heads/${planned.target}`],
        ]) {
          const configured = command(repo, "git", [
            "config",
            "--local",
            "--replace-all",
            `${prefix}.${key}`,
            value,
          ]);
          requireThat(
            !configured.error && configured.status === 0,
            "post_push_upstream_update_failed",
          );
        }
        upstreamConfigured = true;
        verifyPushedLocal(
          repo,
          expectedState,
          { ...planned, tracking: alreadyPushed ? null : planned.tracking },
          sha,
          true,
        );
      }
      let prResult: Record<string, unknown> = {};
      if (data.prPreparation) {
        // The push/upstream transition is verified above; pin its local result for the PR boundary.
        const postPush = snapshot(repo);
        const prs = checkPr();
        sameContext(repo, planned.remote, planned);
        requireThat(
          remoteState(repo, planned.url).refs[
            `refs/heads/${planned.target}`
          ] === sha,
          "push_verification_failed",
        );
        sameSnapshot(repo, postPush);
        if (prs.length)
          prResult = { phase: "existing_pr", existingPullRequests: prs };
        else {
          requireThat(data.prText, "unconfirmed_pr_text");
          const created = createPr(
            repo,
            data.prPreparation,
            planned.target,
            sha,
            data.prText,
            () => {
              prAttempted = true;
              operationMayHaveSucceeded = true;
            },
          );
          prVerified = true;
          sameSnapshot(repo, postPush);
          sameContext(repo, planned.remote, planned);
          samePrPreparation(repo, planned, data.prPreparation);
          requireThat(
            remoteState(repo, planned.url).refs[
              `refs/heads/${planned.target}`
            ] === sha,
            "push_verification_failed",
          );
          prResult = { phase: "pr_created", ...created };
        }
      }
      return {
        ...committed,
        phase: alreadyPushed ? "already_pushed" : "pushed",
        commit: sha,
        branch: expectedState.branch,
        commitCreated: data.commitNeeded,
        pushSent: pushAttempted,
        pushSucceeded,
        pushVerified,
        upstreamConfigured,
        branchCreated,
        ...prResult,
        prAttempted,
        prVerified,
        cleanup: cleanup(ref),
      };
    }
    return { ...committed, cleanup: cleanup(ref) };
  }
  throw new WorkflowError("unknown_operation");
}
try {
  console.log(JSON.stringify(main()));
} catch (error) {
  if (operationMayHaveSucceeded && activeRepository) {
    try {
      const state = snapshot(activeRepository);
      observed = { branch: state.branch, head: state.head };
    } catch {
      /* Observation failure is not proof that the commit was not created. */
    }
  }
  if (
    pushAttempted &&
    execution.destination &&
    activeRepository &&
    remoteObserved === undefined
  ) {
    try {
      remoteObserved =
        remoteState(activeRepository, execution.destination.url).refs[
          `refs/heads/${execution.destination.target}`
        ] ?? null;
    } catch {
      /* A failed readback does not prove no push occurred. */
    }
  }
  const code = error instanceof WorkflowError ? error.code : "workflow_failed";
  const result = {
    error:
      commitSucceeded && !commitVerified ? "commit_verification_failed" : code,
    commitVerified,
    ...(execution.verifiedCommit
      ? { verifiedCommit: execution.verifiedCommit }
      : {}),
    prAttempted,
    prVerified,
    pushAttempted,
    pushSucceeded,
    pushVerified,
    upstreamConfigured,
    remoteMayHaveChanged: pushAttempted,
    ...(remoteObserved !== undefined ? { remoteObserved } : {}),
    operationMayHaveSucceeded,
    commitSucceeded,
    branchMayHaveChanged,
    branchCreated,
    ...(observed ? { observed } : {}),
    stagedChangesPreserved: true,
    ...(owned
      ? code === "material_display_budget_exceeded"
        ? { materialsPreserved: true, reference: owned }
        : { cleanup: cleanup(owned) }
      : {}),
  };
  console.log(JSON.stringify(result));
  process.exitCode = 1;
}
