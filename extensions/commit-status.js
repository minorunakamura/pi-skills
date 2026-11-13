import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";

const states = {
  M: ["Modified", "warning"],
  "?": ["Untracked", "mdLink"],
  A: ["Added", "success"],
  D: ["Deleted", "error"],
  R: ["Renamed", "accent"],
  C: ["Copied", "accent"],
  T: ["Type changed", "warning"],
  U: ["Unmerged", "error"],
  "!": ["Ignored", "muted"],
};
const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function parseStatus(json) {
  let status;
  try {
    status = JSON.parse(json);
  } catch {
    throw new Error("Invalid Git status metadata");
  }
  if (
    !status ||
    (status.branch !== null && typeof status.branch !== "string") ||
    !Array.isArray(status.changes) ||
    status.changes.some(
      (change) =>
        !change ||
        typeof change.path !== "string" ||
        typeof change.index !== "string" ||
        typeof change.worktree !== "string" ||
        !/^[ MADRCUT?!]$/.test(change.index) ||
        !/^[ MADRCUT?!]$/.test(change.worktree) ||
        change.index + change.worktree === "  " ||
        (/[?!]/.test(change.index + change.worktree) &&
          !["??", "!!"].includes(change.index + change.worktree)) ||
        (change.originalPath !== undefined &&
          typeof change.originalPath !== "string"),
    )
  ) {
    throw new Error("Invalid Git status metadata");
  }
  return status;
}

function quoted(value) {
  return JSON.stringify(value).replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0).toString(16)}}`,
  );
}

function statusText(status, fg) {
  const badge = (code, scope = "") => {
    const [label, color] = states[code];
    return `${fg(color, "●")} ${label}${scope}`;
  };
  const lines = [
    `Branch: ${status.branch === null ? "(detached HEAD)" : quoted(status.branch)} — ${status.changes.length} files`,
  ];
  for (const change of status.changes) {
    const pair = change.index + change.worktree;
    let label;
    if (pair === "??" || pair === "!!") {
      label = badge(change.index);
    } else if (conflicts.has(pair)) {
      label = badge("U");
    } else {
      label = [
        change.index !== " " && badge(change.index, " [Staged]"),
        change.worktree !== " " && badge(change.worktree, " [Unstaged]"),
      ]
        .filter(Boolean)
        .join(" / ");
    }
    const path =
      change.originalPath === undefined
        ? quoted(change.path)
        : `${quoted(change.originalPath)} → ${quoted(change.path)}`;
    lines.push(`${label}  ${path}`);
  }
  if (status.changes.length === 0) lines.push("No changes.");
  return lines.join("\n");
}

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const nullableString = (value) => value === null || typeof value === "string";
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

function inspectResult(json, repository, mode) {
  const result = parseStatus(json);
  const ref = result.reference;
  const policy = result.branchPolicy;
  const classification = result.default;
  const evidence = result.evidence;
  const questions = result.questions;
  const base64 = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.from(value, "base64").toString("base64") === value;
  if (
    !object(result) ||
    Object.hasOwn(result, "error") ||
    !object(ref) ||
    !isAbsolute(ref.directory ?? "") ||
    ref.repository !== repository ||
    typeof ref.run !== "string" ||
    !ref.run ||
    !integer(ref.dev) ||
    !integer(ref.ino) ||
    !object(ref.files) ||
    Object.keys(ref.files).length === 0 ||
    Object.entries(ref.files).some(
      ([name, identity]) =>
        !/^state-[\da-f-]+\.json$/.test(name) ||
        !object(identity) ||
        !integer(identity.dev) ||
        !integer(identity.ino) ||
        !integer(identity.bytes) ||
        typeof identity.digest !== "string" ||
        !/^[\da-f]{64}$/.test(identity.digest),
    ) ||
    !object(policy) ||
    policy.mode !== mode ||
    !nullableString(policy.requestedBranch) ||
    (policy.push !== null &&
      (!object(policy.push) ||
        typeof policy.push.remote !== "string" ||
        !nullableString(policy.push.target) ||
        typeof policy.push.initialMain !== "boolean" ||
        (policy.push.setUpstream !== null &&
          typeof policy.push.setUpstream !== "boolean"))) ||
    (policy.pr !== null &&
      (!object(policy.pr) ||
        typeof policy.pr.repository !== "string" ||
        typeof policy.pr.host !== "string" ||
        typeof policy.pr.slug !== "string" ||
        !nullableString(policy.pr.base) ||
        typeof policy.pr.draft !== "boolean")) ||
    (policy.context !== null &&
      (!object(policy.context) ||
        typeof policy.context.url !== "string" ||
        typeof policy.context.configDigest !== "string" ||
        !strings(policy.context.fetch) ||
        !nullableString(policy.context.ssh))) ||
    !nullableString(result.head) ||
    !object(classification) ||
    !["unique", "absent", "ambiguous"].includes(classification.kind) ||
    !strings(classification.candidates) ||
    !strings(classification.reasons) ||
    typeof classification.currentIsDefault !== "boolean" ||
    !object(evidence) ||
    typeof evidence.observationFailed !== "boolean" ||
    !Array.isArray(evidence.remotes) ||
    evidence.remotes.some(
      (remote) =>
        !object(remote) ||
        typeof remote.name !== "string" ||
        !strings(remote.fetch),
    ) ||
    !Array.isArray(evidence.heads) ||
    evidence.heads.some(
      (head) =>
        !object(head) ||
        typeof head.ref !== "string" ||
        !nullableString(head.target) ||
        !nullableString(head.oid),
    ) ||
    !object(questions) ||
    typeof questions.default !== "boolean" ||
    !strings(questions.outsideStaged) ||
    !strings(questions.suspicious) ||
    result.localInformationMayBeStale !== true ||
    result.changes.some(
      (change) =>
        !base64(change.pathBytes) ||
        (change.originalPath !== undefined && !base64(change.originalBytes)),
    )
  )
    throw new Error("Invalid inspect result");
  return result;
}

function discoverBun() {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(directory || ".", "bun");
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    const bun = realpathSync(candidate);
    if (!statSync(bun).isFile()) continue;
    const fd = openSync(bun, "r");
    const header = Buffer.alloc(4);
    try {
      readSync(fd, header, 0, 4, 0);
    } finally {
      closeSync(fd);
    }
    // A script shim is not the runtime; do not execute it or skip to another Bun.
    if (
      ![
        "7f454c46",
        "cffaedfe",
        "cefaedfe",
        "feedfacf",
        "feedface",
        "cafebabe",
        "bebafeca",
      ].includes(header.toString("hex")) &&
      header.subarray(0, 2).toString() !== "MZ"
    )
      throw new Error("Bun executable required");
    return bun;
  }
  throw new Error("Bun executable required");
}

// Fixed Bun invocations only. Never expose raw child output on failures.
function runBun(bun, scripts, args, input, signal, timeout, limit) {
  return new Promise((done) => {
    if (signal?.aborted) {
      done({ failure: "cancelled", exited: true, code: null, stdout: "" });
      return;
    }
    const env = { ...process.env };
    delete env.BUN_OPTIONS;
    delete env.NODE_OPTIONS;
    let child;
    try {
      child = spawn(
        bun,
        [
          `--config=${join(scripts, "bunfig.toml")}`,
          "--env-file=/dev/null",
          "--no-install",
          ...args,
        ],
        {
          cwd: scripts,
          env,
          detached: true,
          // --version can exit before an empty stdin write reaches its pipe.
          stdio: [input.length === 0 ? "ignore" : "pipe", "pipe", "pipe"],
        },
      );
    } catch {
      done({ failure: "launch_failed", exited: true, code: null, stdout: "" });
      return;
    }
    let failure;
    let size = 0;
    const chunks = [];
    let settled = false;
    let killTimer;
    let deadline;
    const alive = () => {
      if (!child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return error.code !== "ESRCH";
      }
    };
    const kill = (signal) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* Confirm below. */
        }
      }
    };
    const finish = (code, exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      child.stdin?.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (!exited) child.unref();
      let stdout = "";
      try {
        stdout = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks),
        );
      } catch {
        failure ??= "invalid_output_encoding";
      }
      done({ failure, exited, code, stdout });
    };
    const stop = (reason) => {
      if (settled || failure) return;
      failure = reason;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 500);
      deadline = setTimeout(() => finish(null, false), 2500);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", () => stop("launch_failed"));
    child.stdin?.on("error", () => stop("stdin_failed"));
    for (const [stream, retain] of [
      [child.stdout, true],
      [child.stderr, false],
    ]) {
      stream.on("data", (bytes) => {
        size += bytes.length;
        if (size > limit) stop("output_limit");
        else if (retain) chunks.push(bytes);
      });
      stream.on("error", () => stop("output_failed"));
    }
    child.on("close", (code) => {
      if (settled) return;
      if (!alive()) {
        finish(code, true);
        return;
      }
      stop("child_exit_unconfirmed");
      kill("SIGKILL");
      const until = Date.now() + 2000;
      const confirm = () => {
        if (settled) return;
        if (!alive()) finish(code, true);
        else if (Date.now() >= until) finish(code, false);
        else setTimeout(confirm, 20);
      };
      confirm();
    });
    child.stdin?.end(input);
  });
}

function inspectFailure(error, extra = {}) {
  const details = {
    error,
    privatePreparation:
      "Unconfirmed; private preparation may remain. Do not search or delete unknown directories.",
    ...extra,
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

export default function (pi) {
  pi.registerTool({
    name: "commit_inspect",
    label: "Git inspect",
    exposure: "model-only",
    renderShell: "self",
    description:
      "Discover and verify Bun 1.3.0+, run the bundled inspect CLI and display Git status. Creates private preparation, but does not Stage or commit. Supply the real absolute repository root and existing inspect JSON with explicit mode (commit, commit-main, push, pr). With HEAD or selected changes, push/pr require push.remote and pr also requires pr.repository ([HOST/]OWNER/REPO). Resolve destinations from explicit instructions/local config before calling; ask if ambiguous. Preserve the complete result/reference and Bun path for subsequent CLI calls. Do not repeat the TUI list; approval remains separate. No fallback or automatic install after failure.",
    parameters: Type.Object(
      { repository: Type.String(), input: Type.String() },
      { additionalProperties: false },
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      let bun;
      let result;
      let scripts;
      let processExitConfirmed = true;
      let stage = "invalid_input";
      try {
        const { repository, input } = params;
        const parsed = JSON.parse(input);
        if (
          Object.keys(params).some(
            (key) => !["repository", "input"].includes(key),
          ) ||
          !object(parsed) ||
          !["commit", "commit-main", "push", "pr"].includes(parsed.mode) ||
          Object.keys(parsed).some(
            (key) =>
              !["scope", "mode", "newBranch", "push", "pr"].includes(key),
          ) ||
          !isAbsolute(repository) ||
          realpathSync(repository) !== repository
        )
          return inspectFailure("invalid_input", { processExitConfirmed });
        stage =
          "Bun 1.3.0+ executable required; discovery or protected probe failed";
        scripts = realpathSync(
          join(
            dirname(realpathSync(fileURLToPath(import.meta.url))),
            "../skills/commit/scripts",
          ),
        );
        bun = discoverBun();
        const probe = await runBun(
          bun,
          scripts,
          ["--version"],
          "",
          signal,
          5000,
          4096,
        );
        processExitConfirmed = probe.exited;
        if (probe.failure || probe.code !== 0 || !probe.exited)
          return inspectFailure(
            probe.failure === "cancelled" ? "cancelled" : stage,
            {
              bun,
              probeFailure: probe.failure,
              processExitConfirmed,
            },
          );
        const version = /^(\d+)\.(\d+)\.(\d+)\r?\n?$/.exec(probe.stdout);
        if (
          !version ||
          Number(version[1]) < 1 ||
          (Number(version[1]) === 1 && Number(version[2]) < 3)
        )
          return inspectFailure(stage, { bun, processExitConfirmed });
        stage = "inspect_failed";
        const inspected = await runBun(
          bun,
          scripts,
          [
            join(scripts, "commit-workflow.ts"),
            "inspect",
            "--repository",
            repository,
          ],
          input,
          signal,
          60_000,
          16 * 1024 * 1024,
        );
        processExitConfirmed = inspected.exited;
        if (inspected.code === 0 && inspected.exited) {
          stage = "invalid_inspect_result";
          result = inspectResult(inspected.stdout, repository, parsed.mode);
        }
        if (!result) {
          let cause;
          if (
            inspected.code === 1 &&
            inspected.exited &&
            !inspected.failure &&
            !signal?.aborted
          ) {
            try {
              const value = JSON.parse(inspected.stdout);
              // Only fixed input error codes may cross the subprocess boundary.
              if (
                object(value) &&
                [
                  "invalid_input",
                  "invalid_push_input",
                  "invalid_pr_input",
                  "invalid_pr_repository",
                  "invalid_pr_base",
                ].includes(value.error)
              )
                cause = value.error;
            } catch {
              /* Invalid output remains unconfirmed. */
            }
          }
          return inspectFailure(inspected.failure ?? stage, {
            bun,
            processExitConfirmed,
            ...(cause ? { cause } : {}),
          });
        }
        const success = {
          content: [
            {
              type: "text",
              text:
                ctx.mode === "tui"
                  ? "Git状態一覧はtool rendererに表示します。同じ一覧を重複表示しないでください。承認は別途必要です。"
                  : statusText(result, (_color, text) => text),
            },
            { type: "text", text: JSON.stringify({ bun, result }) },
          ],
          details: { bun, result },
        };
        stage = "result_update_failed";
        if (!signal?.aborted && !inspected.failure) onUpdate?.(success);
        if (!signal?.aborted && !inspected.failure) return success;
        stage = inspected.failure ?? "cancelled";
      } catch {
        // Do not echo runtime, Git, hook, input or callback errors.
      }
      let cleanup;
      if (result && processExitConfirmed) {
        const cleaned = await runBun(
          bun,
          scripts,
          [
            join(scripts, "commit-workflow.ts"),
            "cleanup",
            "--repository",
            result.reference.repository,
          ],
          JSON.stringify({ reference: result.reference }),
          undefined,
          15_000,
          64 * 1024,
        );
        let value;
        try {
          value = JSON.parse(cleaned.stdout);
        } catch {
          /* Unconfirmed. */
        }
        cleanup = {
          confirmed:
            !cleaned.failure &&
            cleaned.exited &&
            cleaned.code === 0 &&
            object(value) &&
            !Object.hasOwn(value, "error") &&
            value.phase === "cancelled" &&
            object(value.cleanup) &&
            typeof value.cleanup.complete === "boolean" &&
            strings(value.cleanup.remaining),
          processExitConfirmed: cleaned.exited,
        };
        if (cleanup.confirmed) cleanup.result = value;
      }
      return inspectFailure(signal?.aborted ? "cancelled" : stage, {
        bun,
        result,
        processExitConfirmed,
        cleanup,
        ...(cleanup?.confirmed
          ? {
              privatePreparation: cleanup.result.cleanup.complete
                ? "Owned preparation removed by CLI cleanup."
                : "CLI cleanup incomplete; remaining entries retained in cleanup result.",
            }
          : {}),
      });
    },
    renderCall(_args, _theme, context) {
      return new Text("Git inspect", context.outputPad, 0);
    },
    renderResult(result, _options, theme, context) {
      if (context.isError || !result.details?.result)
        return new Text(
          result.content?.[0]?.text ?? "Git inspect unavailable.",
          context.outputPad,
          0,
        );
      let colorFailed = false;
      const text = statusText(result.details.result, (color, dot) => {
        try {
          return theme.fg(color, dot);
        } catch {
          colorFailed = true;
          return dot;
        }
      });
      return new Text(
        colorFailed
          ? statusText(result.details.result, (_color, dot) => dot)
          : text,
        context.outputPad,
        0,
      );
    },
  });
  pi.registerTool({
    name: "commit_status_display",
    label: "Git status",
    exposure: "model-only",
    renderShell: "self",
    description:
      "Display Git status metadata with themed text dots, without running Git or changing files. Pass the inspect branch/changes metadata as a JSON string. Approval and checks remain separate.",
    parameters: Type.Object({ status: Type.String() }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_id, { status: json }, _signal, _onUpdate, ctx) {
      const status = parseStatus(json);
      return {
        content: [
          {
            type: "text",
            text:
              ctx.mode === "tui"
                ? `Git状態一覧を表示しました（${status.changes.length}件）。同じ一覧のMarkdown表は不要です。承認は別途必要です。`
                : statusText(status, (_color, text) => text),
          },
        ],
        details: status,
      };
    },
    renderCall(_args, _theme, context) {
      return new Text("Git status", context.outputPad, 0);
    },
    renderResult(result, _options, theme, context) {
      if (!result.details) {
        return new Text(
          "Git status could not be displayed.",
          context.outputPad,
          0,
        );
      }
      return new Text(
        statusText(result.details, (color, text) => theme.fg(color, text)),
        context.outputPad,
        0,
      );
    },
  });
}
