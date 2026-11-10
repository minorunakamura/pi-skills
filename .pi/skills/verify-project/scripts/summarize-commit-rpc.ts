import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Observation = Record<string, unknown>;
export function summarize(records: Observation[]) {
  const answer = records.findIndex(
    (record) => record.type === "input" && record.id === "answer",
  );
  const selected = answer < 0 ? records : records.slice(answer);
  const received = selected.find((record) => record.type === "user_received");
  const first = records.find((record) => record.type === "user_received");
  const requests = selected.filter((record) => record.type === "assistant");
  const allRequests = records.filter((record) => record.type === "assistant");
  assert(
    first &&
      received &&
      requests.length &&
      requests.every((record) => Number.isInteger(record.durationMs)),
  );
  const outerIds = new Set(
    requests.flatMap((record) =>
      (record.toolCalls as Observation[]).map((call) => call.id),
    ),
  );
  const tools = selected.filter(
    (record) =>
      record.type === "tool_execution_end" && outerIds.has(record.toolCallId),
  );
  assert(tools.every((record) => Number.isInteger(record.durationMs)));
  const final = requests.at(-1);
  assert(final);
  const waiting = records.find(
    (record) => record.type === "waiting_for_answer",
  );
  const answerRecord = records.find(
    (record) => record.type === "input" && record.id === "answer",
  );
  return {
    assistantRequests: requests.length,
    requestSeconds:
      requests.reduce((sum, record) => sum + Number(record.durationMs), 0) /
      1000,
    outerToolSeconds:
      tools.reduce((sum, record) => sum + Number(record.durationMs), 0) / 1000,
    wallSeconds:
      Number(final.receivedMonotonic) - Number(received.receivedMonotonic),
    wholeWallIncludingApprovalWaitSeconds:
      Number(final.receivedMonotonic) - Number(first.receivedMonotonic),
    codemodeCalls: tools.filter((record) => record.toolName === "codemode")
      .length,
    intermediateAssistantRequests: Math.max(0, requests.length - 2),
    requestDurationsMs: requests.map((record) => record.durationMs),
    requestStopReasons: requests.map((record) => record.stopReason),
    outerToolDurationsMs: tools.map((record) => record.durationMs),
    wholeAssistantRequests: allRequests.length,
    preApprovalSeconds: waiting
      ? Number(waiting.receivedMonotonic) - Number(first.receivedMonotonic)
      : null,
    userWaitSeconds:
      waiting && answerRecord
        ? Number(answerRecord.receivedMonotonic) -
          Number(waiting.receivedMonotonic)
        : null,
    usage: allRequests.every((record) => record.usage)
      ? allRequests.map((record) => record.usage)
      : "unknown",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const path = process.argv[2];
  assert(path, "Usage: node summarize-commit-rpc.ts operations.jsonl");
  console.log(
    JSON.stringify(
      summarize(
        readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Observation),
      ),
      null,
      2,
    ),
  );
}
