import assert from "node:assert/strict";
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { assistantRecord } from "./commit-rpc.ts";

// Explicit verification extension only; never loads provider payloads or changes tool results.
export function observeCommit(pi, record, abortAfterReference) {
  let aborted = false;
  let textStarted = false;
  pi.on("session_start", (event, ctx) =>
    record({
      type: event.type,
      reason: event.reason,
      mode: ctx.mode,
      tools: pi.getActiveTools(),
      previousResults: ctx.sessionManager
        .getBranch()
        .filter(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "toolResult" &&
            entry.message.toolName === "commit_inspect",
        )
        .map((entry) => ({
          toolCallId: entry.message.toolCallId,
          content: entry.message.content,
          details: entry.message.details,
          isError: entry.message.isError,
        })),
    }),
  );
  pi.on("turn_start", () => {
    textStarted = false;
    record({ type: "turn_start" });
  });
  pi.on("message_update", (event) => {
    if (!textStarted && event.assistantMessageEvent.type === "text_delta") {
      textStarted = true;
      record({ type: "assistant_text_start" });
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant")
      record(assistantRecord(event.message));
    else if (event.message.role === "user")
      record({ type: "user_received", timestamp: event.message.timestamp });
  });
  for (const type of [
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
  ]) {
    pi.on(type, (event, ctx) => {
      if (
        !["read", "bash", "commit_status_display", "commit_inspect"].includes(
          event.toolName,
        ) ||
        (type === "tool_execution_update" &&
          event.toolName !== "commit_inspect")
      )
        return;
      const observation = { ...event };
      if (event.result)
        observation.resultBytes = Buffer.byteLength(
          JSON.stringify(event.result),
        );
      if (event.toolName === "read") delete observation.result;
      record(observation);
      if (
        event.toolName === "commit_inspect" &&
        type === "tool_execution_update" &&
        abortAfterReference &&
        !aborted &&
        event.partialResult?.details?.result?.reference
      ) {
        aborted = true;
        record({ type: "abort_after_reference", toolCallId: event.toolCallId });
        ctx.abort();
      }
    });
  }
  pi.on("agent_settled", (event) => record(event));
}

export default function (pi) {
  const path = resolve(process.env.VERIFY_COMMIT_OBSERVATIONS ?? "");
  assert(
    process.env.VERIFY_COMMIT_OBSERVATIONS,
    "Explicit owned observation path required",
  );
  const parent = dirname(path);
  const info = lstatSync(parent);
  assert(
    realpathSync(parent) === parent &&
      info.isDirectory() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o700,
  );
  const abort = process.env.VERIFY_COMMIT_ABORT_AFTER_REFERENCE;
  assert(abort === undefined || abort === "1");
  observeCommit(
    pi,
    (event) => {
      const fd = openSync(
        path,
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      try {
        const file = fstatSync(fd);
        assert(
          file.isFile() &&
            file.uid === process.getuid() &&
            (file.mode & 0o777) === 0o600,
        );
        appendFileSync(
          fd,
          JSON.stringify({
            ...event,
            observedAt: Date.now(),
            receivedMonotonic: performance.now() / 1000,
          }) + "\n",
        );
      } finally {
        closeSync(fd);
      }
    },
    abort === "1",
  );
}
