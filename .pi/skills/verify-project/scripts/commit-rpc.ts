import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

type RecordValue = Record<string, unknown>;
export function assistantRecord(
  message: RecordValue,
): RecordValue & { text: string; toolCalls: { id: unknown; name: unknown }[] } {
  const content = message.content as RecordValue[];
  return {
    type: "assistant",
    ...Object.fromEntries(
      [
        "timestamp",
        "durationMs",
        "provider",
        "model",
        "thinkingLevel",
        "stopReason",
        "usage",
      ].map((key) => [key, message[key] ?? null]),
    ),
    text: content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
    toolCalls: content
      .filter((part) => part.type === "toolCall")
      .map((part) => ({ id: part.id, name: part.name })),
  };
}
export function abortRequested(path: string, owned: string): boolean {
  assert.equal(dirname(path), owned);
  const parent = lstatSync(owned);
  assert(
    parent.isDirectory() &&
      parent.uid === process.getuid?.() &&
      (parent.mode & 0o777) === 0o700,
  );
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  try {
    const info = fstatSync(fd);
    assert(
      info.isFile() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o777) === 0o600 &&
        info.size === 6,
    );
    assert(readFileSync(fd).equals(Buffer.from("abort\n")));
    return true;
  } finally {
    closeSync(fd);
  }
}
function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
async function waitForExit(
  child: ChildProcess,
  milliseconds: number,
): Promise<void> {
  const until = Date.now() + milliseconds;
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    Date.now() < until
  )
    await delay(25);
  assert(
    child.exitCode !== null || child.signalCode !== null,
    "Owned child did not exit; retain environment",
  );
}
export async function stopGroup(child: ChildProcess): Promise<void> {
  assert(child.pid);
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    if (!groupExists(child.pid)) break;
    process.kill(-child.pid, signal);
    const until = Date.now() + 5_000;
    while (groupExists(child.pid) && Date.now() < until) await delay(25);
  }
  await waitForExit(child, 15_000);
  assert(
    !groupExists(child.pid),
    "Owned process group remains; do not remove environment",
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      request: { type: "string", default: "/skill:commit-main" },
      extension: { type: "string", multiple: true },
      tools: { type: "string", default: "read,bash" },
      answer: { type: "string" },
      "answer-file": { type: "string" },
      "follow-up-file": { type: "string", multiple: true },
      "abort-file": { type: "string" },
      "fixture-remote": { type: "boolean", default: false },
      timeout: { type: "string" },
    },
  });
  assert.equal(
    positionals.length,
    3,
    "Usage: node commit-rpc.ts REPO SKILL EVIDENCE [options]",
  );
  assert(!(values.answer && values["answer-file"]));
  let answer = values.answer;
  const followUpFiles = (values["follow-up-file"] ?? []).map((path) =>
    resolve(path),
  );
  assert(
    !followUpFiles.length || values["answer-file"],
    "Follow-ups require an initial answer file",
  );
  let answerFile = values["answer-file"]
    ? resolve(values["answer-file"])
    : undefined;
  assert(
    new Set([answerFile, ...followUpFiles].filter(Boolean)).size ===
      [answerFile, ...followUpFiles].filter(Boolean).length,
    "Each follow-up needs its own file",
  );
  const [repo, skill, evidence] = positionals.map((path) => resolve(path));
  const selectedSkill = realpathSync(skill);
  const extensions = (values.extension ?? []).map((path) => realpathSync(path));
  assert(
    /^[a-z_]+(?:,[a-z_]+)*$/.test(values.tools),
    "Plain tool allowlist required",
  );
  const owned = realpathSync(dirname(evidence));
  process.umask(0o077);
  mkdirSync(evidence, { mode: 0o700 });
  const abortFile = values["abort-file"]
    ? resolve(values["abort-file"])
    : undefined;
  if (abortFile)
    assert(
      !abortRequested(abortFile, owned),
      "Abort marker must not pre-exist",
    );
  assert(
    process.env.VERIFY_PI && process.env.VERIFY_SANDBOX,
    "Explicit installed Pi and sandbox required",
  );
  const remotePolicy = values["fixture-remote"]
    ? "Only the owned local bare Git remote and gh/ssh fixtures in PATH are allowed. Never contact external GitHub or any real Git remote. "
    : "Do not perform remote Git/network operations. ";
  const systemPrompt = resolve(evidence, "empty-system.md");
  writeFileSync(systemPrompt, "", { flag: "wx", mode: 0o600 });
  const child = spawn(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      process.env.VERIFY_SANDBOX,
      process.env.VERIFY_PI,
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      ...extensions.flatMap((path) => ["--extension", path]),
      "--no-mcp",
      "--no-skills",
      "--skill",
      selectedSkill,
      "--no-prompt-templates",
      "--no-context-files",
      "--no-themes",
      "--offline",
      "--no-approve",
      "--tools",
      values.tools,
      "--system-prompt",
      systemPrompt,
      "--append-system-prompt",
      "This is a disposable commit verification. Operate only in the target cwd repository and owned HOME/TMPDIR. Read the supplied Skill and its references/scripts, but do not modify them. Do not access credentials, user files, or settings through tools. Do not install anything. " +
        remotePolicy +
        "Follow the Skill; do not substitute a hand-written workflow. If blocked, report and stop.",
    ],
    { cwd: repo, detached: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const logPath = resolve(evidence, "operations.jsonl");
  writeFileSync(logPath, "", { flag: "wx", mode: 0o600 });
  const record = (value: RecordValue) =>
    appendFileSync(
      logPath,
      JSON.stringify({
        ...value,
        receivedMonotonic: performance.now() / 1000,
      }) + "\n",
    );
  const send = (value: RecordValue) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const prompt = (id: string, text: string) => {
    record({ type: "input", id, text });
    send({ id, type: "prompt", message: text });
  };
  let waiting = false;
  let abortSent = false;
  let abortAcknowledged = false;
  let settled = false;
  let sentInitial = false;
  let resolvedModel: { provider: unknown; id: unknown } | undefined;
  const ready = new Set<string>();
  const started = performance.now();
  let pending = Buffer.alloc(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await new Promise<void>((done, fail) => {
      child.once("error", () => fail(new Error("Pi launch failed")));
      child.once("exit", () => {
        if (!settled || (abortSent && !abortAcknowledged))
          fail(new Error("Pi exited before settled"));
      });
      child.stderr.on("data", () =>
        fail(new Error("Pi diagnostics received; raw diagnostics not saved")),
      );
      const maybeDone = () => {
        if (settled && (!abortSent || abortAcknowledged)) done();
      };
      timer = setInterval(() => {
        try {
          if (values.timeout !== undefined) {
            const timeout = Number(values.timeout);
            assert(Number.isFinite(timeout) && timeout > 0);
            assert(
              performance.now() - started < timeout * 1000,
              "Observer deadline expired; operation may have succeeded",
            );
          }
          if (!abortSent && abortFile && abortRequested(abortFile, owned)) {
            abortSent = true;
            record({ type: "abort_sent", id: "observer-abort" });
            send({ id: "observer-abort", type: "abort" });
          }
          if (waiting && answerFile) {
            let text: string | undefined;
            try {
              text = readFileSync(answerFile, "utf8");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            if (text !== undefined) {
              assert(text.trim());
              waiting = false;
              answerFile = followUpFiles.shift();
              prompt("answer", text);
            }
          }
        } catch (error) {
          fail(error);
        }
      }, 100);
      child.stdout.on("data", (bytes: Buffer) => {
        pending = Buffer.concat([pending, bytes]);
        let newline: number;
        while ((newline = pending.indexOf(10)) >= 0) {
          const line = pending
            .subarray(0, newline)
            .toString("utf8")
            .replace(/\r$/, "");
          pending = pending.subarray(newline + 1);
          try {
            const event = JSON.parse(line) as RecordValue;
            const type = event.type;
            if (type === "response") {
              assert(event.success, "RPC command failed");
              const data = event.data as RecordValue;
              if (event.id === "observer-abort") {
                record(event);
                abortAcknowledged = true;
                maybeDone();
              } else if (event.id === "commands") {
                const names = (data.commands as RecordValue[]).map(
                  (command) => command.name,
                );
                assert.deepEqual(names, [
                  `skill:${basename(dirname(selectedSkill))}`,
                ]);
                record({ type: "commands", names });
                ready.add("commands");
              } else if (event.id === "state") {
                const model = data.model as RecordValue;
                assert(
                  model.provider && model.id && data.thinkingLevel,
                  "Normal Pi model resolution missing",
                );
                resolvedModel = { provider: model.provider, id: model.id };
                record({
                  type: "model",
                  provider: model.provider,
                  id: model.id,
                  thinkingLevel: data.thinkingLevel,
                });
                ready.add("state");
              }
              if (ready.size === 2 && !sentInitial) {
                sentInitial = true;
                prompt("initial", values.request);
              }
            } else if (
              type === "tool_execution_start" ||
              type === "tool_execution_end" ||
              (type === "tool_execution_update" &&
                event.toolName === "commit_inspect")
            ) {
              if (event.result)
                event.resultBytes = Buffer.byteLength(
                  JSON.stringify(event.result),
                );
              if (event.toolName === "read") delete event.result;
              record(event);
            } else if (type === "message_end") {
              const message = event.message as RecordValue;
              if (message.role === "assistant") {
                record(assistantRecord(message));
                assert(
                  !Array.isArray(message.diagnostics) ||
                    message.diagnostics.length === 0,
                  "Pi assistant diagnostics received; raw details not saved",
                );
                assert(
                  resolvedModel &&
                    message.provider === resolvedModel.provider &&
                    message.model === resolvedModel.id,
                  "Pi model changed unexpectedly; do not treat run as success",
                );
                assert(
                  abortSent ||
                    (message.stopReason !== "error" &&
                      message.stopReason !== "aborted"),
                  "Pi assistant failed/aborted",
                );
              } else if (message.role === "user")
                record({ type: "user_received", timestamp: message.timestamp });
              else if (message.role === "toolResult" && message.nestedCalls)
                record({
                  type: "nested_calls",
                  toolCallId: message.toolCallId,
                  nestedCalls: message.nestedCalls,
                });
            } else if (type === "agent_settled") {
              record(event);
              if (abortSent) settled = true;
              else {
                assert(!event.aborted, "Pi run aborted");
                if (answer !== undefined) {
                  prompt("answer", answer);
                  answer = undefined;
                } else if (answerFile && !waiting) {
                  waiting = true;
                  record({ type: "waiting_for_answer" });
                } else settled = true;
              }
              maybeDone();
            }
          } catch (error) {
            fail(error);
          }
        }
      });
      send({ id: "commands", type: "get_commands" });
      send({ id: "state", type: "get_state" });
    });
    child.stdin.end();
    await waitForExit(child, 15_000);
    assert.equal(child.exitCode, 0);
    assert(!abortSent, "Observer aborted run; inspect partial results");
  } finally {
    if (timer) clearInterval(timer);
    child.stdin.end();
    try {
      await waitForExit(child, 15_000);
    } catch {
      /* Only the owned group is terminated below. */
    }
    await stopGroup(child);
    writeFileSync(
      resolve(evidence, "cleanup.json"),
      JSON.stringify({
        pid: child.pid,
        processExit: child.exitCode,
        signal: child.signalCode,
        groupGone: true,
        waited: true,
      }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  console.log(logPath);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "RPC observation failed",
    );
    process.exitCode = 1;
  }
}
