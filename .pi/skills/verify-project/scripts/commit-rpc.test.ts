import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { abortRequested, assistantRecord, stopGroup } from "./commit-rpc.ts";
import { observeCommit } from "./commit-observer.js";

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

await test("commit-rpc CLI rejects malformed follow-ups before spawning and preserves valid multi-follow-up cleanup", (t) => {
  const owned = realpathSync(mkdtempSync(join(tmpdir(), "rpc-cli-check-")));
  t.after(() => rmSync(owned, { recursive: true, force: true }));
  const marker = join(owned, "spawn.jsonl");
  const preload = join(owned, "preload.mjs");
  const rpcChild = join(owned, "rpc-child.mjs");
  // Observe the OS launch boundary; invalid inputs must never reach a real child.
  writeFileSync(
    preload,
    `import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const spawn = childProcess.spawn;
childProcess.spawn = (exe, args, options) => {
  appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ exe, args }) + "\\n");
  if (!process.env.RPC_FIXTURE_CHILD) throw new Error("Unexpected child launch");
  return spawn(process.execPath, [${JSON.stringify(rpcChild)}], options);
};
syncBuiltinESMExports();
`,
  );
  writeFileSync(
    rpcChild,
    `import { createInterface } from "node:readline";
const send = (event) => console.log(JSON.stringify(event));
createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_commands")
    send({ type: "response", id: command.id, success: true, data: { commands: [{ name: "skill:commit" }] } });
  else if (command.type === "get_state")
    send({ type: "response", id: command.id, success: true, data: { model: { provider: "fixture", id: "fixture" }, thinkingLevel: "high" } });
  else if (command.type === "prompt") send({ type: "agent_settled" });
  else process.exit(99);
});
`,
  );
  const cli = fileURLToPath(new URL("./commit-rpc.ts", import.meta.url));
  const skill = fileURLToPath(
    new URL("../../../../skills/commit/SKILL.md", import.meta.url),
  );
  const answer = join(owned, "answer");
  const followUps = [join(owned, "follow-up1"), join(owned, "follow-up2")];
  const env = {
    ...process.env,
    NODE_OPTIONS: "",
    VERIFY_PI: "unused-installed-pi",
    VERIFY_SANDBOX: "unused-sandbox",
  };
  const run = (name: string, args: string[], valid = false) =>
    spawnSync(
      process.execPath,
      ["--import", preload, cli, owned, skill, join(owned, name), ...args],
      {
        cwd: owned,
        env: { ...env, RPC_FIXTURE_CHILD: valid ? "1" : "" },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
  for (const [name, args, error] of [
    [
      "missing-answer",
      ["--follow-up-file", answer],
      "Follow-ups require an initial answer file",
    ],
    [
      "duplicate",
      ["--answer-file", answer, "--follow-up-file", "./answer"],
      "Each follow-up needs its own file",
    ],
  ] as const) {
    const result = run(name, [...args]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert(result.stderr.includes(error), result.stderr);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(owned, name)), false);
  }
  [answer, ...followUps].forEach((path, i) =>
    writeFileSync(path, `reply${i}\n`),
  );
  const result = run(
    "valid",
    [
      "--extension",
      skill,
      "--tools",
      "read,bash,commit_inspect",
      "--answer-file",
      answer,
      ...followUps.flatMap((path) => ["--follow-up-file", path]),
      "--request",
      "initial request",
      "--timeout",
      "3",
    ],
    true,
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(readFileSync(marker, "utf8").trim().split("\n").length, 1);
  const launch = JSON.parse(readFileSync(marker, "utf8")) as { args: string[] };
  assert(launch.args.includes("--no-extensions"));
  assert.equal(
    readFileSync(
      launch.args[launch.args.indexOf("--system-prompt") + 1],
      "utf8",
    ),
    "",
  );
  assert(launch.args.includes("--append-system-prompt"));
  assert.equal(
    launch.args[launch.args.indexOf("--extension") + 1],
    realpathSync(skill),
  );
  assert.equal(
    launch.args[launch.args.indexOf("--tools") + 1],
    "read,bash,commit_inspect",
  );
  const operations = readFileSync(join(owned, "valid/operations.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(
    operations
      .filter((record) => record.type === "input")
      .map((record) => record.text),
    ["initial request", "reply0\n", "reply1\n", "reply2\n"],
  );
  const defaultRun = run("default", ["--timeout", "3"], true);
  assert.equal(defaultRun.status, 0, defaultRun.stderr);
  const defaultLaunch = JSON.parse(
    readFileSync(marker, "utf8").trim().split("\n")[1],
  ) as { args: string[] };
  assert.equal(defaultLaunch.args.includes("--extension"), false);
  assert.equal(
    defaultLaunch.args[defaultLaunch.args.indexOf("--tools") + 1],
    "read,bash",
  );
  const cleanup = JSON.parse(
    readFileSync(join(owned, "valid/cleanup.json"), "utf8"),
  ) as {
    pid: number;
    processExit: number;
    groupGone: boolean;
    waited: boolean;
  };
  assert.equal(cleanup.processExit, 0);
  assert.equal(cleanup.groupGone, true);
  assert.equal(cleanup.waited, true);
  assert.throws(() => process.kill(-cleanup.pid, 0), { code: "ESRCH" });
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
  assert.deepEqual(result.turns[0].tools, [
    {
      id: "outer",
      name: "codemode",
      argumentsBytes: "unknown",
      resultBytes: "unknown",
      read: null,
    },
  ]);
  assert.equal(result.transcribedPayloadBytes, "unknown");
  assert.equal(result.tuiRenderedAt, "unknown");
  const readBatch = summarize([
    { type: "user_received", receivedMonotonic: 1 },
    {
      type: "assistant",
      durationMs: 1,
      receivedMonotonic: 2,
      toolCalls: [
        { id: "read1", name: "read" },
        { id: "read2", name: "read" },
      ],
    },
    {
      type: "tool_execution_start",
      toolCallId: "read1",
      args: { path: "local-bun.md" },
    },
    {
      type: "tool_execution_start",
      toolCallId: "read2",
      args: { path: "push-bun.md", offset: 10 },
    },
    {
      type: "tool_execution_end",
      toolCallId: "read1",
      durationMs: 1,
      resultBytes: 123,
    },
    {
      type: "tool_execution_end",
      toolCallId: "read2",
      durationMs: 2,
      resultBytes: 456,
    },
  ]);
  assert.equal(readBatch.turns.length, 1);
  assert.deepEqual(
    readBatch.turns[0].tools.map((tool) => tool.read),
    [{ path: "local-bun.md" }, { path: "push-bun.md", offset: 10 }],
  );
  assert.equal(readBatch.turns[0].tools[0].argumentsBytes, 23);
  assert.equal(readBatch.turns[0].tools[1].resultBytes, 456);
});

await test("commit-observer records the public reference update before ordinary abort without replacing results", () => {
  type Handler = (event: Record<string, unknown>, ctx?: unknown) => unknown;
  const handlers = new Map<string, Handler>();
  const records: Record<string, unknown>[] = [];
  observeCommit(
    { on: (name: string, handler: Handler) => handlers.set(name, handler) },
    (event: Record<string, unknown>) => records.push(event),
    true,
  );
  const update = {
    toolName: "commit_inspect",
    partialResult: { details: { result: { reference: { run: "fixture" } } } },
  };
  const original = JSON.stringify(update);
  let aborts = 0;
  const ctx = {
    abort: () => {
      assert.equal(records.at(-1)?.type, "abort_after_reference");
      aborts++;
    },
  };
  handlers.get("tool_execution_update")?.({ toolName: "read" }, ctx);
  handlers.get("tool_execution_update")?.({ toolName: "commit_inspect" }, ctx);
  assert.equal(aborts, 0);
  handlers.get("tool_execution_update")?.(update, ctx);
  handlers.get("tool_execution_update")?.(update, ctx);
  assert.equal(aborts, 1);
  assert.equal(JSON.stringify(update), original);
});

await test("commit-observer records Skill read sets and old/new outer tool payload metrics without mutating events", () => {
  type Handler = (event: Record<string, unknown>) => unknown;
  const handlers = new Map<string, Handler>();
  const records: Record<string, unknown>[] = [];
  observeCommit(
    { on: (name: string, handler: Handler) => handlers.set(name, handler) },
    (event: Record<string, unknown>) => records.push(event),
    false,
  );
  for (const toolName of [
    "read",
    "bash",
    "commit_status_display",
    "commit_inspect",
  ]) {
    const args =
      toolName === "read"
        ? { path: "local-bun.md", offset: 1 }
        : { fixture: true };
    const result = {
      content: [{ type: "text", text: "fixture result" }],
      details: {},
    };
    const start = {
      type: "tool_execution_start",
      toolName,
      toolCallId: toolName,
      args,
    };
    const end = {
      type: "tool_execution_end",
      toolName,
      toolCallId: toolName,
      result,
      durationMs: 1,
    };
    const original = JSON.stringify(end);
    handlers.get("tool_execution_start")?.(start);
    handlers.get("tool_execution_end")?.(end);
    assert.deepEqual(records.at(-2), start);
    assert.equal(
      records.at(-1)?.resultBytes,
      Buffer.byteLength(JSON.stringify(result)),
    );
    assert.deepEqual(
      records.at(-1)?.result,
      toolName === "read" ? undefined : result,
    );
    assert.equal(JSON.stringify(end), original);
  }
  const count = records.length;
  handlers.get("tool_execution_update")?.({
    toolName: "bash",
    partialResult: { content: "omit" },
  });
  handlers.get("tool_execution_start")?.({ toolName: "unrelated" });
  assert.equal(records.length, count);
  handlers.get("message_end")?.({ message: { role: "user", timestamp: 123 } });
  assert.deepEqual(records.at(-1), { type: "user_received", timestamp: 123 });
});
