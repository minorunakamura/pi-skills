import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { abortRequested, assistantRecord, stopGroup } from "./commit-rpc.ts";

await test("commit-rpc records tool-only timing without thinking or signatures", () => {
  const record = assistantRecord({
    content: [
      { type: "thinking", thinking: "not evidence", thinkingSignature: "omit" },
      { type: "toolCall", id: "one", name: "bash", arguments: {} },
    ],
    timestamp: 123,
    durationMs: 456,
    stopReason: "toolUse",
  });
  assert.equal(record.durationMs, 456);
  assert.equal(record.text, "");
  assert.deepEqual(record.toolCalls, [{ id: "one", name: "bash" }]);
  assert.equal(JSON.stringify(record).includes("not evidence"), false);
  assert.equal(JSON.stringify(record).includes("thinkingSignature"), false);
});
await test("commit-rpc accepts only an owned private regular abort marker", (t) => {
  const owned = realpathSync(mkdtempSync(join(tmpdir(), "rpc-check-")));
  t.after(() => rmSync(owned, { recursive: true, force: true }));
  const marker = join(owned, "abort");
  assert.equal(abortRequested(marker, owned), false);
  writeFileSync(marker, "abort\n", { mode: 0o600 });
  assert.equal(abortRequested(marker, owned), true);
  chmodSync(marker, 0o644);
  assert.throws(() => abortRequested(marker, owned));
  unlinkSync(marker);
  symlinkSync(join(owned, "absent"), marker);
  assert.throws(() => abortRequested(marker, owned));
});
await test("commit-rpc terminates and waits only for its owned child group", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    detached: true,
    stdio: "ignore",
  });
  await stopGroup(child);
  assert(child.exitCode !== null || child.signalCode !== null);
  assert.throws(() => process.kill(-(child.pid ?? 0), 0), { code: "ESRCH" });
});

await test("commit-rpc metrics keep approval boundaries and do not double count nested tools", async () => {
  const { summarize } = await import("./summarize-commit-rpc.ts");
  const result = summarize([
    { type: "user_received", receivedMonotonic: 1 },
    { type: "input", id: "answer" },
    { type: "user_received", receivedMonotonic: 5 },
    {
      type: "assistant",
      durationMs: 100,
      stopReason: "toolUse",
      receivedMonotonic: 6,
      toolCalls: [{ id: "outer", name: "codemode" }],
    },
    {
      type: "tool_execution_end",
      toolCallId: "outer/1",
      toolName: "bash",
      durationMs: 500,
    },
    {
      type: "tool_execution_end",
      toolCallId: "outer",
      toolName: "codemode",
      durationMs: 600,
    },
    {
      type: "assistant",
      durationMs: 200,
      stopReason: "stop",
      receivedMonotonic: 8,
      toolCalls: [],
    },
  ]);
  assert.equal(result.assistantRequests, 2);
  assert.equal(result.requestSeconds, 0.3);
  assert.equal(result.outerToolSeconds, 0.6);
  assert.equal(result.wallSeconds, 3);
  assert.equal(result.codemodeCalls, 1);
  assert.equal(result.intermediateAssistantRequests, 0);
});
