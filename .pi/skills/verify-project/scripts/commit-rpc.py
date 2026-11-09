"""Connect to installed Pi RPC; observe disposable commit verification, never drive Git."""

import argparse
import json
import os
import selectors
import signal
import stat
import subprocess
import time
from pathlib import Path


def assistant_record(message):
    """Include tool-only requests, but never thinking or provider signatures."""
    return {
        "type": "assistant",
        **{
            key: message.get(key)
            for key in (
                "timestamp",
                "durationMs",
                "provider",
                "model",
                "thinkingLevel",
                "stopReason",
            )
        },
        "text": "\n".join(c["text"] for c in message["content"] if c["type"] == "text"),
        "toolCalls": [
            {"id": c["id"], "name": c["name"]}
            for c in message["content"]
            if c["type"] == "toolCall"
        ],
    }


def abort_requested(path, owned):
    """Accept only the caller's private marker beside this run's evidence directory."""
    assert path.parent == owned and not path.parent.is_symlink()
    parent = owned.stat()
    assert parent.st_uid == os.getuid() and stat.S_IMODE(parent.st_mode) == 0o700
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    with os.fdopen(fd, "rb") as marker:
        info = os.fstat(marker.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
        assert stat.S_IMODE(info.st_mode) == 0o600 and info.st_size == 6
        assert marker.read(7) == b"abort\n", "Invalid abort marker"
    return True


def stop_group(process):
    """Only the session/group created by this helper; wait before caller removes owned files."""

    def exists():
        try:
            os.killpg(process.pid, 0)
            return True
        except ProcessLookupError:
            return False

    for sig in (signal.SIGTERM, signal.SIGKILL):
        if not exists():
            break
        os.killpg(process.pid, sig)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            pass
        until = time.monotonic() + 5
        while exists() and time.monotonic() < until:
            time.sleep(0.05)
    process.wait(timeout=15)
    assert not exists(), "Owned process group remains; do not remove its environment"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("skill", type=Path)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--request", default="/skill:commit --no-confirm")
    answers = parser.add_mutually_exclusive_group()
    answers.add_argument(
        "--answer", help="One real follow-up after the first settled turn"
    )
    answers.add_argument(
        "--answer-file",
        type=Path,
        help="Wait for caller's owned UTF-8 answer file after first settled turn",
    )
    parser.add_argument(
        "--fixture-remote",
        action="store_true",
        help="Allow only the caller's local bare/gh fixture, never real GitHub",
    )
    parser.add_argument(
        "--abort-file",
        type=Path,
        help="Send public RPC abort once when caller creates a private 'abort\\n' marker",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        help="Optional observer deadline in seconds, including approval wait",
    )
    args = parser.parse_args()
    remote_policy = (
        "Only the owned local bare Git remote and gh/ssh fixtures in PATH are allowed. "
        "Never contact external GitHub or any real Git remote. "
        if args.fixture_remote
        else "Do not perform remote Git/network operations. "
    )
    command = [
        "/usr/bin/sandbox-exec",
        "-f",
        os.environ["VERIFY_SANDBOX"],
        os.environ["VERIFY_PI"],
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "-e",
        "builtin:codemode",
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
        "read,bash,codemode",
        "--append-system-prompt",
        "This is a disposable commit verification. Operate only in the target cwd repository "
        "and owned HOME/TMPDIR. Read the supplied Skill and its references/scripts, but do not "
        "modify them. Do not access credentials, user files, or settings through tools. "
        "Do not install anything. "
        + remote_policy
        + "Follow the Skill; do not substitute a hand-written workflow. If blocked, report and stop.",
    ]
    os.umask(0o077)
    args.evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
    if args.abort_file is not None:
        args.abort_file = args.abort_file.absolute()
        assert not abort_requested(args.abort_file, args.evidence.parent.resolve()), (
            "Abort marker must not pre-exist the run"
        )
    process = subprocess.Popen(
        command,
        cwd=args.repo,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    assert process.stdin and process.stdout and process.stderr
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    selector.register(process.stderr, selectors.EVENT_READ)
    started = time.monotonic()
    settled = False
    pending = b""
    answer = args.answer
    waiting = False
    ready = set()
    abort_sent = False
    abort_acknowledged = False

    def send(record):
        assert process.stdin is not None
        process.stdin.write(json.dumps(record, ensure_ascii=False).encode() + b"\n")
        process.stdin.flush()

    try:
        with (args.evidence / "operations.jsonl").open("w") as log:

            def record(value):
                value["receivedMonotonic"] = time.monotonic()
                log.write(json.dumps(value, ensure_ascii=False) + "\n")
                log.flush()

            def prompt(identifier, text):
                record({"type": "input", "id": identifier, "text": text})
                send({"id": identifier, "type": "prompt", "message": text})

            send({"id": "commands", "type": "get_commands"})
            send({"id": "state", "type": "get_state"})
            while not settled or (abort_sent and not abort_acknowledged):
                if (
                    args.timeout is not None
                    and time.monotonic() - started > args.timeout
                ):
                    raise TimeoutError(
                        "Observer deadline expired; operation may have succeeded"
                    )
                if (
                    not abort_sent
                    and args.abort_file is not None
                    and abort_requested(args.abort_file, args.evidence.parent.resolve())
                ):
                    record({"type": "abort_sent", "id": "observer-abort"})
                    send({"id": "observer-abort", "type": "abort"})
                    abort_sent = True
                if waiting and args.answer_file and args.answer_file.exists():
                    answer = args.answer_file.read_text()
                    assert answer.strip(), "Empty answer is not approval"
                    waiting = False
                    prompt("answer", answer)
                    answer = None
                    args.answer_file = None
                for key, _ in selector.select(timeout=0.2):
                    data = os.read(key.fd, 65536)
                    if not data:
                        raise RuntimeError("Pi exited before agent_settled")
                    if key.fileobj is process.stderr:
                        raise RuntimeError(
                            "Pi diagnostics received; run failed (raw diagnostics not saved)"
                        )
                    pending += data
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        event = json.loads(line)
                        kind = event.get("type")
                        if kind == "response":
                            assert event["success"], "RPC command failed"
                            identifier = event.get("id")
                            if identifier == "observer-abort":
                                record(event)
                                abort_acknowledged = True
                            if identifier == "commands":
                                names = [c["name"] for c in event["data"]["commands"]]
                                assert names == [
                                    f"skill:{args.skill.resolve().parent.name}"
                                ], names
                                record({"type": "commands", "names": names})
                                ready.add(identifier)
                            elif identifier == "state":
                                state = event["data"]
                                model = state["model"]
                                record(
                                    {
                                        "type": "model",
                                        "provider": model["provider"],
                                        "id": model["id"],
                                        "thinkingLevel": state["thinkingLevel"],
                                    }
                                )
                                assert (
                                    model["provider"],
                                    model["id"],
                                    state["thinkingLevel"],
                                ) == ("openai", "gpt-6.1-sol", "high"), (
                                    "Unexpected model/thinking"
                                )
                                ready.add(identifier)
                            if ready == {"commands", "state"}:
                                prompt("initial", args.request)
                                ready.clear()
                        elif kind in ("tool_execution_start", "tool_execution_end"):
                            if event.get("toolName") == "read":
                                event.pop("result", None)
                            record(event)
                        elif kind == "message_end":
                            message = event["message"]
                            if message["role"] == "assistant":
                                record(assistant_record(message))
                                if (
                                    message.get("stopReason") in ("error", "aborted")
                                    and not abort_sent
                                ):
                                    raise RuntimeError(
                                        "Pi assistant failed/aborted; inspect saved observations"
                                    )
                            elif message["role"] == "user":
                                record(
                                    {
                                        "type": "user_received",
                                        "timestamp": message["timestamp"],
                                    }
                                )
                            elif (
                                message["role"] == "toolResult"
                                and "nestedCalls" in message
                            ):
                                record(
                                    {
                                        "type": "nested_calls",
                                        "toolCallId": message["toolCallId"],
                                        "nestedCalls": message["nestedCalls"],
                                    }
                                )
                        elif kind == "agent_settled":
                            record(event)
                            if abort_sent:
                                settled = True
                                continue
                            assert not event.get("aborted"), "Pi run aborted"
                            if answer is not None:
                                prompt("answer", answer)
                                answer = None
                            elif args.answer_file is not None and not waiting:
                                waiting = True
                                args.answer_file = args.answer_file.resolve()
                            else:
                                settled = True
                            # Only one answer is supported.
                            if waiting:
                                record({"type": "waiting_for_answer"})
        process.stdin.close()
        assert process.wait(timeout=15) == 0
        if abort_sent:
            raise RuntimeError(
                "Observer explicitly aborted run; inspect partial results"
            )
    finally:
        selector.close()
        # Public stdin shutdown disposes active tools before the group fallback.
        if not process.stdin.closed:
            process.stdin.close()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            pass
        stop_group(process)
        (args.evidence / "cleanup.json").write_text(
            json.dumps(
                {
                    "pid": process.pid,
                    "processExit": process.returncode,
                    "groupGone": True,
                    "waited": True,
                }
            )
            + "\n"
        )
    print(args.evidence / "operations.jsonl")


if __name__ == "__main__":
    main()
