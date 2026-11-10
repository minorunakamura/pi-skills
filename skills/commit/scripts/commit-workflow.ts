import { randomUUID } from "node:crypto";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import {
  cleanSubmodules,
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

type Inspection = { phase: "inspect"; state: Snapshot; scope: Scope };
type Materials = {
  phase: "materials";
  state: Snapshot;
  scope: Scope;
  tree: string;
  entries: string;
  diffDigest: string;
  scanner: "passed" | "unavailable";
  defaultAnswer: string | null;
};
type Plan = Omit<Materials, "phase"> & { phase: "plan"; message: string };
type HeldState = Inspection | Materials | Plan;
let owned: Reference | undefined;
let operationMayHaveSucceeded = false;
let commitSucceeded = false;
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
  for (const name of ["diff.bin", "history.bin"])
    if (ref.files[name]) removeOwned(ref, name);
}
function view(bytes: Buffer) {
  try {
    return {
      encoding: "utf8",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { encoding: "base64", text: bytes.toString("base64") };
  }
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
    tree: data.tree,
    scanner: data.scanner,
    diffDigest: data.diffDigest,
    diffBytes: diff.length,
    historyBytes: history.length,
    files,
    filesOmitted: 0,
    displayed: false,
  };
  const small = {
    ...base,
    displayed: true,
    diff: view(diff),
    history: view(history),
  };
  if (Buffer.byteLength(JSON.stringify(small)) <= 32 * 1024) return small;
  while (
    Buffer.byteLength(JSON.stringify(base)) > 24 * 1024 &&
    base.files.length
  ) {
    base.files.pop();
    base.filesOmitted++;
  }
  return {
    ...base,
    note: "Full fixed diff/history not displayed; read required ranges together before planning.",
  };
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
  if (operation === "inspect") {
    requireThat(
      Object.keys(input).every((key) => key === "scope"),
      "invalid_input",
    );
    const selected = scope(input.scope, repo);
    const state = snapshot(repo);
    owned = createPrivate(repo);
    saveJson(owned, `state-${randomUUID()}.json`, {
      phase: "inspect",
      state,
      scope: selected,
    } satisfies Inspection);
    return {
      reference: owned,
      branch: state.branch,
      head: state.head,
      changes: state.changes,
      default: state.default.classification,
      evidence: state.default.evidence,
      questions: questions(state, selected),
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
    requireThat(
      data.phase === "materials" && Array.isArray(input.parts),
      "invalid_material_request",
    );
    const parts = input.parts.map((value: unknown) => {
      const part = object(value);
      requireThat(
        (part.name === "diff" || part.name === "history") &&
          Number.isSafeInteger(part.offset) &&
          Number.isSafeInteger(part.length) &&
          Number(part.offset) >= 0 &&
          Number(part.length) > 0,
        "invalid_material_request",
      );
      const payload = readOwned(ref, `${part.name}.bin`);
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
    if (classification.kind === "ambiguous") {
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
        defaultAnswer === data.state.branch,
        "current_branch_is_not_default",
      );
      requireThat(
        !data.state.default.evidence.observationFailed,
        "default_observation_failed",
      );
    } else
      requireThat(
        classification.currentIsDefault,
        "current_branch_is_not_default",
      );
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
    if (!diff.length)
      return { phase: "empty", commitCreated: false, cleanup: cleanup(ref) };
    const tree = line(git(repo, ["write-tree"]));
    const after = snapshot(repo);
    unchangedPolicy(data.state, after);
    const scanner = scan(repo, diff);
    sameSnapshot(repo, after);
    requireThat(digest(stagedDiff(repo)) === digest(diff), "repository_drift");
    const history = after.head
      ? git(repo, ["--no-pager", "log", "-20", "--format=%s%n%b%n---"])
      : Buffer.alloc(0);
    const materials: Materials = {
      phase: "materials",
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
          (key) => key === "reference" || key === "message",
        ),
      "invalid_plan_input",
    );
    requireThat(
      typeof input.message === "string" &&
        input.message.trim().length > 0 &&
        !input.message.includes("\0") &&
        Buffer.from(input.message).toString() === input.message,
      "invalid_message",
    );
    sameSnapshot(repo, data.state);
    requireThat(
      digest(stagedDiff(repo)) === data.diffDigest &&
        indexEntries(repo) === data.entries,
      "repository_drift",
    );
    release(ref);
    const plan: Plan = { ...data, phase: "plan", message: input.message };
    transition(ref, current.name, plan);
    return {
      reference: ref,
      phase: "plan",
      message: plan.message,
      branch: plan.state.branch,
      parent: plan.state.head,
      tree: plan.tree,
      scope: plan.scope,
      scanner: plan.scanner,
      default: plan.state.default.classification,
      defaultAnswer: plan.defaultAnswer,
      operations: [
        "commit directly on current branch",
        "verify commit",
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
    operationMayHaveSucceeded = true;
    const result = command(
      repo,
      "git",
      ["commit", "--cleanup=verbatim", "--file=-"],
      Buffer.from(data.message),
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
    const tree = headers.find((header) => header.startsWith("tree "))?.slice(5);
    const message = raw.subarray(separator + 2);
    const expected = Buffer.from(data.message);
    const messageMatches =
      message.equals(expected) ||
      (!data.message.endsWith("\n") &&
        message.equals(Buffer.concat([expected, Buffer.from("\n")])));
    const otherRefs = (state: Snapshot) =>
      state.refs
        .split("\n")
        .filter((ref) => ref && !ref.startsWith(`${state.branchRef} `))
        .join("\n");
    requireThat(
      after.branchRef === data.state.branchRef &&
        after.gitDir === data.state.gitDir &&
        after.branchConfig === data.state.branchConfig &&
        otherRefs(after) === otherRefs(data.state) &&
        after.refsDiagnostics === data.state.refsDiagnostics &&
        JSON.stringify(after.default) === JSON.stringify(data.state.default) &&
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
    return {
      phase: "committed",
      commit: after.head,
      branch: after.branch,
      tree,
      parents,
      messageDigest: digest(message),
      scanner: data.scanner,
      cleanup: cleanup(ref),
    };
  }
  throw new WorkflowError("unknown_operation");
}
try {
  console.log(JSON.stringify(main()));
} catch (error) {
  if (operationMayHaveSucceeded && activeRepository && !observed) {
    try {
      const state = snapshot(activeRepository);
      observed = { branch: state.branch, head: state.head };
    } catch {
      /* Observation failure is not proof that the commit was not created. */
    }
  }
  const code = error instanceof WorkflowError ? error.code : "workflow_failed";
  const result = {
    error: commitSucceeded ? "commit_verification_failed" : code,
    operationMayHaveSucceeded,
    commitSucceeded,
    ...(observed ? { observed } : {}),
    stagedChangesPreserved: true,
    ...(owned ? { cleanup: cleanup(owned) } : {}),
  };
  console.log(JSON.stringify(result));
  process.exitCode = 1;
}
