"""Connect to the installed Pi RPC CLI; record only commit verification observations."""

import argparse
import json
import os
import selectors
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("repo", type=Path)
parser.add_argument("skill", type=Path)
parser.add_argument("evidence", type=Path)
parser.add_argument("--request", default="/skill:commit --no-confirm")
parser.add_argument(
    "--answer", help="One real follow-up answer after the first settled turn"
)
args = parser.parse_args()
# The caller supplies an owned sandbox profile, isolated HOME/Git environment, and Pi binary.
command = [
    "/usr/bin/sandbox-exec",
    "-f",
    os.environ["VERIFY_SANDBOX"],
    os.environ["VERIFY_PI"],
    "--mode",
    "rpc",
    "--no-session",
    "--no-extensions",
    "--no-mcp",
    "--no-skills",
    "--skill",
    str(args.skill.resolve()),
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    "--offline",
    "--no-approve",
    "--tools",
    "read,bash",
    "--append-system-prompt",
    "This is a disposable commit verification. Operate only in the target cwd repository "
    "and owned HOME/TMPDIR. Read the supplied Skill and its references/scripts, but do not "
    "modify them. Do not access credentials, user files, or settings through tools. "
    "Do not install anything or perform remote Git/network operations. Follow the Skill; "
    "do not substitute a hand-written workflow. If blocked, report and stop.",
]
args.evidence.mkdir(parents=True, exist_ok=False)
os.chmod(args.evidence, 0o700)
process = subprocess.Popen(
    command,
    cwd=args.repo,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
assert (
    process.stdin is not None
    and process.stdout is not None
    and process.stderr is not None
)
selector = selectors.DefaultSelector()
selector.register(process.stdout, selectors.EVENT_READ)
selector.register(process.stderr, selectors.EVENT_READ)


def send(record):
    process.stdin.write(json.dumps(record, ensure_ascii=False).encode() + b"\n")
    process.stdin.flush()


pending = b""
answer = args.answer
deadline = time.monotonic() + 900
settled = False
try:
    with (args.evidence / "operations.jsonl").open("w") as log:
        send({"id": "commands", "type": "get_commands"})
        send({"id": "state", "type": "get_state"})
        log.write(
            json.dumps({"type": "input", "text": args.request}, ensure_ascii=False)
            + "\n"
        )
        send({"id": "initial", "type": "prompt", "message": args.request})
        while not settled:
            if time.monotonic() > deadline:
                raise TimeoutError("Pi RPC did not settle within 900 seconds")
            for key, _ in selector.select(timeout=1):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    raise RuntimeError("Pi RPC exited before agent_settled")
                if key.fileobj is process.stderr:
                    raise RuntimeError(
                        "Pi diagnostics: " + data.decode(errors="replace")
                    )
                pending += data
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    event = json.loads(line)
                    kind = event.get("type")
                    record = None
                    if kind == "response":
                        assert event["success"], event
                        if event.get("id") == "commands":
                            assert any(
                                c["name"] == "skill:commit"
                                for c in event["data"]["commands"]
                            )
                            record = event
                        elif event.get("id") == "state":
                            model = event["data"]["model"]
                            record = {
                                "type": "model",
                                "provider": model["provider"],
                                "id": model["id"],
                            }
                    elif kind in ("tool_execution_start", "tool_execution_end"):
                        record = event.copy()
                        if record.get("toolName") == "read":
                            record.pop("result", None)
                    elif (
                        kind == "message_end"
                        and event["message"]["role"] == "assistant"
                    ):
                        message = event["message"]
                        if message.get("stopReason") in ("error", "aborted"):
                            raise RuntimeError(
                                "Pi assistant failed: "
                                + str(message.get("errorMessage"))
                            )
                        text = "\n".join(
                            c["text"] for c in message["content"] if c["type"] == "text"
                        )
                        if text:
                            record = {"type": "assistant", "text": text}
                    elif kind == "agent_settled":
                        if answer is not None:
                            log.write(
                                json.dumps(
                                    {"type": "input", "text": answer},
                                    ensure_ascii=False,
                                )
                                + "\n"
                            )
                            send({"id": "answer", "type": "prompt", "message": answer})
                            answer = None
                        else:
                            settled = True
                    if record is not None:
                        log.write(json.dumps(record, ensure_ascii=False) + "\n")
                        log.flush()
    process.stdin.close()
    assert process.wait(timeout=15) == 0
finally:
    selector.close()
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=15)
print(args.evidence / "operations.jsonl")
