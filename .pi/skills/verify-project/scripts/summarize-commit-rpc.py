"""Summarize observed approval-to-final timing; never infer functional success."""

import json
import sys
from pathlib import Path


def summarize(records):
    answer = next(
        i
        for i, r in enumerate(records)
        if r["type"] == "input" and r.get("id") == "answer"
    )
    received = next(r for r in records[answer:] if r["type"] == "user_received")
    requests = [r for r in records[answer:] if r["type"] == "assistant"]
    assert requests and all(type(r.get("durationMs")) is int for r in requests)
    # nestedCalls is bounded and can be incomplete; assistant IDs identify outer tools.
    outer_ids = {call["id"] for r in requests for call in r["toolCalls"]}
    tools = [
        r
        for r in records[answer:]
        if r["type"] == "tool_execution_end" and r["toolCallId"] in outer_ids
    ]
    assert all(type(r.get("durationMs")) is int for r in tools)
    first_received = next(r for r in records if r["type"] == "user_received")
    final = requests[-1]
    return {
        "assistantRequests": len(requests),
        "requestSeconds": sum(r["durationMs"] for r in requests) / 1000,
        "outerToolSeconds": sum(r["durationMs"] for r in tools) / 1000,
        "wallSeconds": final["receivedMonotonic"] - received["receivedMonotonic"],
        "wholeWallIncludingApprovalWaitSeconds": final["receivedMonotonic"]
        - first_received["receivedMonotonic"],
        "codemodeCalls": sum(r["toolName"] == "codemode" for r in tools),
        "intermediateAssistantRequests": max(0, len(requests) - 2),
        "requestDurationsMs": [r["durationMs"] for r in requests],
        "requestStopReasons": [r["stopReason"] for r in requests],
        "outerToolDurationsMs": [r["durationMs"] for r in tools],
    }


def self_check():
    records = [
        {"type": "user_received", "receivedMonotonic": 1},
        {"type": "input", "id": "answer"},
        {"type": "user_received", "receivedMonotonic": 5},
        {
            "type": "assistant",
            "durationMs": 100,
            "stopReason": "toolUse",
            "receivedMonotonic": 6,
            "toolCalls": [{"id": "outer", "name": "codemode"}],
        },
        {
            "type": "tool_execution_end",
            "toolCallId": "outer/1",
            "toolName": "bash",
            "durationMs": 500,
        },
        {
            "type": "tool_execution_end",
            "toolCallId": "outer",
            "toolName": "codemode",
            "durationMs": 600,
        },
        {"type": "nested_calls", "nestedCalls": {"calls": [], "complete": False}},
        {
            "type": "assistant",
            "durationMs": 200,
            "stopReason": "stop",
            "receivedMonotonic": 8,
            "toolCalls": [],
        },
    ]
    result = summarize(records)
    assert result["assistantRequests"] == 2 and result["requestSeconds"] == 0.3
    assert result["outerToolSeconds"] == 0.6 and result["wallSeconds"] == 3
    assert result["codemodeCalls"] == 1 and result["intermediateAssistantRequests"] == 0
    print("tool-only requests, approval boundary, no nested double-count: passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-check"]:
        self_check()
    else:
        path = Path(sys.argv[1])
        print(
            json.dumps(
                summarize([json.loads(line) for line in path.read_text().splitlines()]),
                indent=2,
            )
        )
