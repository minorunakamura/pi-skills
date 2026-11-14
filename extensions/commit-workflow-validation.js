import { isAbsolute } from "node:path";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string";
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const strings = (v) => Array.isArray(v) && v.every(text);
const keys = (v, required, optional = []) =>
  object(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const digest = (v) => text(v) && /^[a-f\d]{64}$/.test(v);
const names = [
  "diff",
  "history",
  "recent-history",
  "pr-diff",
  "pr-history",
  "pr-templates",
];
export const workflowOperations = [
  "materials",
  "read",
  "release",
  "plan",
  "execute",
  "cleanup",
];

export function validReference(v) {
  return (
    keys(v, ["repository", "directory", "run", "dev", "ino", "files"]) &&
    text(v.repository) &&
    isAbsolute(v.repository) &&
    text(v.directory) &&
    isAbsolute(v.directory) &&
    text(v.run) &&
    /^[a-f\d-]{36}$/.test(v.run) &&
    integer(v.dev) &&
    integer(v.ino) &&
    object(v.files) &&
    Object.keys(v.files).length > 0 &&
    Object.entries(v.files).every(
      ([name, id]) =>
        (/^state-[a-f\d-]+\.json$/.test(name) ||
          names.some((n) => name === `${n}.bin`)) &&
        keys(id, ["dev", "ino", "bytes", "digest"]) &&
        integer(id.dev) &&
        integer(id.ino) &&
        integer(id.bytes) &&
        digest(id.digest),
    )
  );
}

export function validWorkflowInput(params) {
  if (
    !keys(params, ["repository", "operation", "input"]) ||
    !text(params.repository) ||
    !isAbsolute(params.repository) ||
    !workflowOperations.includes(params.operation)
  )
    return false;
  const v = params.input;
  const allowed = {
    materials: ["defaultBranch", "includeOutsideStaged", "reviewedPaths"],
    read: ["parts", "fileOffset", "fileCount"],
    release: [],
    plan: ["message", "newBranch", "pr"],
    execute: [],
    cleanup: [],
  }[params.operation];
  if (!keys(v, ["reference"], allowed) || !validReference(v.reference))
    return false;
  if (params.operation === "materials")
    return (
      (v.defaultBranch === undefined ||
        (text(v.defaultBranch) && v.defaultBranch.length > 0)) &&
      (v.includeOutsideStaged === undefined ||
        typeof v.includeOutsideStaged === "boolean") &&
      (v.reviewedPaths === undefined || strings(v.reviewedPaths))
    );
  if (params.operation === "read")
    return (
      Array.isArray(v.parts) &&
      v.parts.every(
        (p) =>
          keys(p, ["name", "offset", "length"]) &&
          names.includes(p.name) &&
          integer(p.offset) &&
          integer(p.length) &&
          p.length > 0 &&
          Number.isSafeInteger(p.offset + p.length),
      ) &&
      (v.fileOffset === undefined || integer(v.fileOffset)) &&
      (v.fileCount === undefined || integer(v.fileCount))
    );
  if (params.operation === "plan")
    return (
      (v.message === undefined ||
        (text(v.message) &&
          v.message.trim().length > 0 &&
          !v.message.includes("\u0000") &&
          Buffer.from(v.message).toString() === v.message)) &&
      (v.newBranch === undefined ||
        (text(v.newBranch) && v.newBranch.length > 0)) &&
      (v.pr === undefined ||
        (keys(v.pr, [], ["title", "body"]) &&
          Object.keys(v.pr).length > 0 &&
          Object.values(v.pr).every(text)))
    );
  return true;
}

function validCleanup(v) {
  return (
    keys(v, ["complete", "remaining"]) &&
    typeof v.complete === "boolean" &&
    strings(v.remaining) &&
    v.complete === (v.remaining.length === 0)
  );
}

const nullableText = (v) => v === null || text(v);
const bool = (v) => typeof v === "boolean";
const sha = (v) => text(v) && /^(?:[a-f\d]{40}|[a-f\d]{64})$/.test(v);
const nullableSha = (v) => v === null || sha(v);
const scanner = (v) => ["passed", "unavailable"].includes(v);
const base64 = (v) =>
  text(v) && Buffer.from(v, "base64").toString("base64") === v;
const sameRun = (v, ref) =>
  validReference(v) &&
  ["run", "repository", "directory", "dev", "ino"].every(
    (k) => v[k] === ref[k],
  );
const classification = (v) =>
  keys(v, ["kind", "candidates", "reasons", "currentIsDefault"]) &&
  ["unique", "absent", "ambiguous"].includes(v.kind) &&
  strings(v.candidates) &&
  strings(v.reasons) &&
  bool(v.currentIsDefault);
const scope = (v) =>
  (keys(v, ["kind"]) && ["all", "staged"].includes(v.kind)) ||
  (keys(v, ["kind", "paths"]) &&
    v.kind === "paths" &&
    strings(v.paths) &&
    v.paths.length > 0);
const prs = (v) =>
  Array.isArray(v) &&
  v.every(
    (p) =>
      keys(p, ["number", "url", "state"]) &&
      integer(p.number) &&
      p.number > 0 &&
      text(p.url) &&
      ["OPEN", "CLOSED", "MERGED"].includes(p.state),
  );
const encoded = (v) =>
  object(v) &&
  text(v.text) &&
  ((v.encoding === "utf8" && Buffer.from(v.text).toString() === v.text) ||
    (v.encoding === "base64" && base64(v.text)));
const byteLength = (v) =>
  Buffer.byteLength(v.text, v.encoding === "base64" ? "base64" : "utf8");
const view = (v) => keys(v, ["encoding", "text"]) && encoded(v);
const file = (v) =>
  keys(v, ["path", "index"], ["originalPath"]) &&
  text(v.path) &&
  text(v.index) &&
  /^[ MADRCUT]$/.test(v.index) &&
  (v.originalPath === undefined || text(v.originalPath));
const change = (v) =>
  keys(
    v,
    ["path", "pathBytes", "index", "worktree"],
    ["originalPath", "originalBytes"],
  ) &&
  file({
    path: v.path,
    index: v.index,
    ...(v.originalPath === undefined ? {} : { originalPath: v.originalPath }),
  }) &&
  base64(v.pathBytes) &&
  text(v.worktree) &&
  /^[ MADRCUT?!]$/.test(v.worktree) &&
  (v.originalPath === undefined
    ? v.originalBytes === undefined
    : base64(v.originalBytes));
const prFile = (v) =>
  keys(v, ["pathBytes", "path", "reusedStaged"]) &&
  base64(v.pathBytes) &&
  text(v.path) &&
  bool(v.reusedStaged);

function materialResult(v, ref) {
  if (
    !keys(
      v,
      [
        "reference",
        "phase",
        "branch",
        "head",
        "branchPolicy",
        "tree",
        "scanner",
        "commitNeeded",
        "push",
        "pr",
        "diffDigest",
        "diffBytes",
        "historyBytes",
        "files",
        "filesOmitted",
        "displayed",
      ],
      [
        "recentHistoryBytes",
        "prDiffBytes",
        "prHistoryBytes",
        "prTemplatesBytes",
        "diff",
        "history",
        "recentHistory",
        "prDiff",
        "prHistory",
        "prTemplates",
        "note",
      ],
    ) ||
    v.phase !== "materials" ||
    !sameRun(v.reference, ref) ||
    !text(v.branch) ||
    !nullableSha(v.head) ||
    !sha(v.tree) ||
    !scanner(v.scanner) ||
    !bool(v.commitNeeded) ||
    !digest(v.diffDigest) ||
    !integer(v.filesOmitted) ||
    !bool(v.displayed) ||
    !Array.isArray(v.files) ||
    !v.files.every(file)
  )
    return false;
  const policy = v.branchPolicy;
  if (
    !keys(policy, ["mode", "createBranch", "newBranch"]) ||
    !["commit", "commit-main", "push", "pr"].includes(policy.mode) ||
    !bool(policy.createBranch) ||
    !nullableText(policy.newBranch)
  )
    return false;
  if (
    v.push !== null &&
    !(
      keys(v.push, ["remote", "url", "defaultBranch", "emptyRemote"]) &&
      text(v.push.remote) &&
      text(v.push.url) &&
      nullableText(v.push.defaultBranch) &&
      bool(v.push.emptyRemote)
    )
  )
    return false;
  if (
    ["push", "pr"].includes(policy.mode) !== (v.push !== null) ||
    (policy.mode === "pr") !== (v.pr !== null)
  )
    return false;
  if (v.pr !== null) {
    const p = v.pr;
    if (
      !keys(p, [
        "repository",
        "base",
        "baseHead",
        "draft",
        "diffDigest",
        "mergeBase",
        "stagedDiffIdentical",
        "reusableStagedPathBytes",
        "files",
        "filesOmitted",
        "reusablePathsOmitted",
      ]) ||
      !text(p.repository) ||
      !text(p.base) ||
      !sha(p.baseHead) ||
      !bool(p.draft) ||
      !digest(p.diffDigest) ||
      !sha(p.mergeBase) ||
      !bool(p.stagedDiffIdentical) ||
      !Array.isArray(p.reusableStagedPathBytes) ||
      !p.reusableStagedPathBytes.every(base64) ||
      !Array.isArray(p.files) ||
      !p.files.every(prFile) ||
      !integer(p.filesOmitted) ||
      !integer(p.reusablePathsOmitted)
    )
      return false;
  }
  for (const name of [
    "diff",
    "history",
    "recentHistory",
    "prDiff",
    "prHistory",
    "prTemplates",
  ]) {
    const needed =
      ["diff", "history"].includes(name) ||
      (name === "recentHistory" ? v.push !== null : v.pr !== null);
    if (needed ? !integer(v[`${name}Bytes`]) : v[`${name}Bytes`] !== undefined)
      return false;
    if (
      needed && v.displayed
        ? !view(v[name]) || byteLength(v[name]) !== v[`${name}Bytes`]
        : v[name] !== undefined
    )
      return false;
  }
  return v.displayed
    ? v.note === undefined
    : v.note ===
        "Full fixed diff/history not displayed; read required ranges together before planning.";
}

function prPlan(v, pending) {
  if (
    !keys(
      v,
      ["repository", "head", "base", "draft", "existingPullRequests"],
      pending ? [] : ["baseHead", "title", "body"],
    ) ||
    !text(v.repository) ||
    !text(v.head) ||
    !text(v.base) ||
    !bool(v.draft) ||
    !prs(v.existingPullRequests)
  )
    return false;
  if (pending) return true;
  return (
    sha(v.baseHead) &&
    (v.existingPullRequests.length
      ? v.title === undefined && v.body === undefined
      : text(v.title) && text(v.body))
  );
}

function planResult(v, ref) {
  if (v.phase === "materials")
    return (
      keys(v, [
        "reference",
        "phase",
        "executable",
        "requiredInputs",
        "branch",
        "message",
        "pr",
        "payloadRemoved",
      ]) &&
      sameRun(v.reference, ref) &&
      v.executable === false &&
      strings(v.requiredInputs) &&
      v.requiredInputs.length > 0 &&
      v.requiredInputs.every((s) =>
        ["message", "pr.title", "pr.body"].includes(s),
      ) &&
      text(v.branch) &&
      nullableText(v.message) &&
      prPlan(v.pr, true) &&
      v.payloadRemoved === true
    );
  if (
    !keys(v, [
      "reference",
      "phase",
      "message",
      "pr",
      "branch",
      "sourceBranch",
      "newBranch",
      "parent",
      "tree",
      "scope",
      "scanner",
      "default",
      "defaultAnswer",
      "commitNeeded",
      "push",
      "operations",
      "payloadRemoved",
      "approval",
    ]) ||
    v.phase !== "plan" ||
    !sameRun(v.reference, ref) ||
    !nullableText(v.message) ||
    !text(v.branch) ||
    !text(v.sourceBranch) ||
    !nullableText(v.newBranch) ||
    !nullableSha(v.parent) ||
    !sha(v.tree) ||
    !scope(v.scope) ||
    !scanner(v.scanner) ||
    !classification(v.default) ||
    !nullableText(v.defaultAnswer) ||
    !bool(v.commitNeeded) ||
    (v.commitNeeded ? !text(v.message) : v.message !== null) ||
    !strings(v.operations) ||
    v.operations.length === 0 ||
    v.payloadRemoved !== true ||
    v.approval !== "not inferred from this reference"
  )
    return false;
  if (v.pr !== null && !prPlan(v.pr, false)) return false;
  if (v.push !== null) {
    const p = v.push;
    if (
      !keys(p, [
        "remote",
        "url",
        "target",
        "sourceBranch",
        "defaultBranch",
        "remoteHead",
        "initialMain",
        "setUpstream",
        "upstream",
      ]) ||
      ![p.remote, p.url, p.target, p.sourceBranch].every(text) ||
      !nullableText(p.defaultBranch) ||
      !nullableSha(p.remoteHead) ||
      !bool(p.initialMain) ||
      !bool(p.setUpstream) ||
      (p.setUpstream
        ? !(
            keys(p.upstream, ["remote", "merge"]) &&
            p.upstream.remote === p.remote &&
            p.upstream.merge === `refs/heads/${p.target}`
          )
        : p.upstream !== "preserve existing settings")
    )
      return false;
  }
  return v.pr === null || v.push !== null;
}

function terminalPlan(v) {
  const pr = v.phase === "existing_pr";
  return (
    keys(v, [
      "phase",
      "commitCreated",
      "pushSent",
      "cleanup",
      pr ? "existingPullRequests" : "commit",
    ]) &&
    ["existing_pr", "already_pushed"].includes(v.phase) &&
    v.commitCreated === false &&
    v.pushSent === false &&
    validCleanup(v.cleanup) &&
    (pr
      ? prs(v.existingPullRequests) && v.existingPullRequests.length > 0
      : sha(v.commit))
  );
}

const commitFields = ["tree", "parents", "messageDigest", "scanner"];
function committed(v) {
  return (
    sha(v.tree) &&
    Array.isArray(v.parents) &&
    v.parents.every(sha) &&
    digest(v.messageDigest) &&
    scanner(v.scanner)
  );
}
function executeResult(v) {
  if (v.phase === "committed")
    return (
      keys(v, [
        "phase",
        "commit",
        "branch",
        "branchCreated",
        "cleanup",
        ...commitFields,
      ]) &&
      sha(v.commit) &&
      text(v.branch) &&
      bool(v.branchCreated) &&
      committed(v) &&
      validCleanup(v.cleanup)
    );
  if (
    !keys(
      v,
      [
        "phase",
        "commit",
        "branch",
        "commitCreated",
        "pushSent",
        "pushSucceeded",
        "pushVerified",
        "upstreamConfigured",
        "branchCreated",
        "prAttempted",
        "prVerified",
        "cleanup",
      ],
      [
        ...commitFields,
        "existingPullRequests",
        "url",
        "number",
        "titleDigest",
        "bodyDigest",
      ],
    ) ||
    !["pushed", "already_pushed", "existing_pr", "pr_created"].includes(
      v.phase,
    ) ||
    !sha(v.commit) ||
    !text(v.branch) ||
    ![
      v.commitCreated,
      v.pushSent,
      v.pushSucceeded,
      v.upstreamConfigured,
      v.branchCreated,
      v.prAttempted,
      v.prVerified,
    ].every(bool) ||
    v.pushVerified !== true ||
    !validCleanup(v.cleanup) ||
    v.pushSent !== v.pushSucceeded
  )
    return false;
  if (
    v.commitCreated
      ? !committed(v)
      : commitFields.some((k) => v[k] !== undefined)
  )
    return false;
  if (
    (v.phase === "pushed" && !v.pushSent) ||
    (v.phase === "already_pushed" && v.pushSent)
  )
    return false;
  if (v.phase === "pr_created")
    return (
      v.prAttempted === true &&
      v.prVerified === true &&
      text(v.url) &&
      integer(v.number) &&
      v.number > 0 &&
      digest(v.titleDigest) &&
      digest(v.bodyDigest) &&
      v.existingPullRequests === undefined
    );
  return (
    v.prAttempted === false &&
    v.prVerified === false &&
    ["url", "number", "titleDigest", "bodyDigest"].every(
      (k) => v[k] === undefined,
    ) &&
    (v.phase === "existing_pr"
      ? prs(v.existingPullRequests) && v.existingPullRequests.length > 0
      : v.existingPullRequests === undefined)
  );
}

const failureCodes = new Set([
  "absolute_repository_required",
  "ambiguous_merge_base",
  "branch_creation_failed",
  "branch_exists",
  "branch_observation_failed",
  "branch_policy_conflict",
  "branch_upstream_exists",
  "commit_failed",
  "commit_verification_failed",
  "config_observation_failed",
  "conflicting_upstream",
  "credentials_in_remote_url",
  "current_branch_is_not_default",
  "custom_ssh_command_unsupported",
  "default_answer_required",
  "default_branch_mismatch",
  "default_observation_failed",
  "detached_or_conflicted",
  "dirty_submodule",
  "empty_pr_diff",
  "execute_accepts_reference_only",
  "existing_pr_needs_no_text",
  "fetch_observation_failed",
  "git_observation_failed",
  "github_remote_mismatch",
  "github_repository_mismatch",
  "head_observation_failed",
  "initial_main_push_only",
  "initial_main_requires_empty_remote",
  "insufficient_repository_permission",
  "invalid_branch",
  "invalid_git_paths",
  "invalid_input",
  "invalid_literal_path",
  "invalid_material_request",
  "invalid_message",
  "invalid_mode",
  "invalid_phase",
  "invalid_plan_input",
  "invalid_pr_base",
  "invalid_pr_input",
  "invalid_pr_list_response",
  "invalid_pr_repository",
  "invalid_pr_response",
  "invalid_pr_text",
  "invalid_private_name",
  "invalid_push_input",
  "invalid_reference",
  "invalid_remote_refs",
  "invalid_scope",
  "invalid_template_response",
  "material_display_budget_exceeded",
  "merge_in_progress",
  "missing_base_branch",
  "missing_pr_parent",
  "missing_push_head",
  "multiple_push_urls",
  "new_branch_is_default_use_commit_main",
  "new_branch_required",
  "non_fast_forward",
  "outside_staged_answer_required",
  "path_outside_repository",
  "post_push_local_verification_failed",
  "post_push_upstream_update_failed",
  "post_push_upstream_verification_failed",
  "pr_authentication_failed",
  "pr_creation_result_unknown",
  "pr_list_limit_reached",
  "pr_preparation_drift",
  "pr_preparation_failed",
  "pr_push_destination_mismatch",
  "pr_verification_failed",
  "prepared_pr_disappeared",
  "private_directory_changed",
  "private_directory_in_repository",
  "private_file_changed",
  "private_permissions_failed",
  "private_run_mismatch",
  "protected_push_target",
  "push_config_observation_failed",
  "push_destination_drift",
  "push_failed",
  "push_result_unknown",
  "push_tracking_observation_failed",
  "push_verification_failed",
  "refs_observation_failed",
  "remote_drift",
  "remote_head_observation_failed",
  "remote_observation_failed",
  "repository_drift",
  "repository_root_required",
  "same_head_and_base",
  "ssh_host_unresolved",
  "staged_secret_scan_failed",
  "submodule_observation_failed",
  "suspicious_paths_answer_required",
  "unconfirmed_pr_text",
  "unexpected_pr_url",
  "unknown_operation",
  "unknown_private_file",
  "unknown_remote",
  "unknown_remote_default_branch",
  "unsafe_push_tracking_ref",
  "unsupported_fetch_refspec",
  "unsupported_negative_fetch",
  "unsupported_push_url",
  "workflow_failed",
]);
const failureFlags = [
  "commitVerified",
  "prAttempted",
  "prVerified",
  "pushAttempted",
  "pushSucceeded",
  "pushVerified",
  "upstreamConfigured",
  "remoteMayHaveChanged",
  "operationMayHaveSucceeded",
  "commitSucceeded",
  "branchMayHaveChanged",
  "branchCreated",
  "stagedChangesPreserved",
];
function failureResult(v, operation, ref) {
  if (
    !keys(
      v,
      ["error", ...failureFlags],
      [
        "verifiedCommit",
        "remoteObserved",
        "observed",
        "cleanup",
        "materialsPreserved",
        "reference",
      ],
    ) ||
    !failureCodes.has(v.error) ||
    !failureFlags.every((k) => bool(v[k])) ||
    v.stagedChangesPreserved !== true ||
    (v.verifiedCommit !== undefined && !sha(v.verifiedCommit)) ||
    (v.remoteObserved !== undefined && !nullableSha(v.remoteObserved)) ||
    (v.observed !== undefined &&
      !(
        keys(v.observed, ["branch", "head"]) &&
        nullableText(v.observed.branch) &&
        nullableSha(v.observed.head)
      )) ||
    (v.cleanup !== undefined && !validCleanup(v.cleanup))
  )
    return false;
  if (
    (v.commitVerified && (!v.commitSucceeded || !sha(v.verifiedCommit))) ||
    (v.prVerified && !v.prAttempted)
  )
    return false;
  if (v.error === "material_display_budget_exceeded")
    return (
      operation === "read" &&
      v.materialsPreserved === true &&
      sameRun(v.reference, ref) &&
      v.cleanup === undefined
    );
  return v.materialsPreserved === undefined && v.reference === undefined;
}

export function workflowResult(v, operation, reference, exitCode, input) {
  let valid = false;
  if (object(v)) {
    if (exitCode === 1) {
      // Only fixed error codes and typed success evidence cross this boundary.
      v = Object.fromEntries(
        Object.entries(v).filter(([key]) =>
          [
            "error",
            ...failureFlags,
            "verifiedCommit",
            "remoteObserved",
            "observed",
            "cleanup",
            "materialsPreserved",
            "reference",
          ].includes(key),
        ),
      );
      if (text(v.error) && !failureCodes.has(v.error))
        v.error = "workflow_failed";
      valid = failureResult(v, operation, reference);
    } else if (exitCode === 0) {
      switch (operation) {
        case "cleanup":
          valid =
            keys(v, ["phase", "stagedChangesPreserved", "cleanup"]) &&
            v.phase === "cancelled" &&
            v.stagedChangesPreserved === true &&
            validCleanup(v.cleanup);
          break;
        case "release":
          valid =
            keys(v, ["reference", "payloadRemoved"]) &&
            sameRun(v.reference, reference) &&
            v.payloadRemoved === true;
          break;
        case "materials":
          valid =
            v.phase === "empty"
              ? keys(v, ["phase", "commitCreated", "cleanup"]) &&
                v.commitCreated === false &&
                validCleanup(v.cleanup)
              : materialResult(v, reference);
          break;
        case "plan":
          valid = ["already_pushed", "existing_pr"].includes(v.phase)
            ? terminalPlan(v)
            : planResult(v, reference);
          break;
        case "execute":
          valid = executeResult(v);
          break;
        case "read":
          valid =
            keys(v, ["parts", "fixed", "prFiles", "files"]) &&
            v.fixed === true &&
            Array.isArray(v.parts) &&
            v.parts.length === input.parts.length &&
            v.parts.every(
              (p, i) =>
                keys(p, [
                  "name",
                  "offset",
                  "length",
                  "totalBytes",
                  "encoding",
                  "text",
                ]) &&
                names.includes(p.name) &&
                integer(p.offset) &&
                integer(p.length) &&
                p.length > 0 &&
                integer(p.totalBytes) &&
                p.offset + p.length <= p.totalBytes &&
                encoded(p) &&
                byteLength(p) === p.length &&
                ["name", "offset", "length"].every(
                  (k) => p[k] === input.parts[i][k],
                ),
            ) &&
            Array.isArray(v.prFiles) &&
            v.prFiles.every(prFile) &&
            Array.isArray(v.files) &&
            v.files.every(change) &&
            v.files.length <= (input.fileCount ?? 0) &&
            v.prFiles.length <= (input.fileCount ?? 0) &&
            Buffer.byteLength(JSON.stringify(v)) <= 32 * 1024;
          break;
      }
    }
  }
  if (!valid) throw new Error("Invalid workflow result");
  return v;
}

export function inspectFields(v) {
  const p = v.branchPolicy;
  return (
    keys(v, [
      "reference",
      "branch",
      "branchPolicy",
      "head",
      "changes",
      "default",
      "evidence",
      "questions",
      "localInformationMayBeStale",
    ]) &&
    validReference(v.reference) &&
    keys(p, ["mode", "pr", "push", "context", "requestedBranch"]) &&
    ["commit", "commit-main", "push", "pr"].includes(p.mode) &&
    (p.push === null ||
      keys(p.push, ["remote", "target", "initialMain", "setUpstream"])) &&
    (p.pr === null ||
      keys(p.pr, ["repository", "host", "slug", "base", "draft"])) &&
    (p.context === null ||
      keys(p.context, ["url", "configDigest", "fetch", "ssh"])) &&
    keys(v.default, ["kind", "candidates", "reasons", "currentIsDefault"]) &&
    keys(v.evidence, ["observationFailed", "remotes", "heads"]) &&
    v.evidence.remotes.every((r) => keys(r, ["name", "fetch"])) &&
    v.evidence.heads.every((h) => keys(h, ["ref", "target", "oid"])) &&
    keys(v.questions, ["default", "outsideStaged", "suspicious"]) &&
    v.changes.every(
      (c) =>
        keys(
          c,
          ["path", "pathBytes", "index", "worktree"],
          ["originalPath", "originalBytes"],
        ) && (c.originalPath === undefined) === (c.originalBytes === undefined),
    )
  );
}
