"""Small assert self-check for RPC metadata filtering and owned-group shutdown."""

import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "commit_rpc", Path(__file__).with_name("commit-rpc.py")
)
assert spec is not None and spec.loader is not None
rpc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rpc)
record = rpc.assistant_record(
    {
        "content": [
            {"type": "thinking", "thinking": "not evidence"},
            {"type": "toolCall", "id": "one", "name": "codemode", "arguments": {}},
        ],
        "timestamp": 123,
        "durationMs": 456,
        "stopReason": "toolUse",
    }
)
assert record["durationMs"] == 456 and record["timestamp"] == 123
assert record["text"] == "" and record["toolCalls"] == [
    {"id": "one", "name": "codemode"}
]
assert "not evidence" not in str(record) and "thinkingSignature" not in record
with tempfile.TemporaryDirectory() as directory:
    owned = Path(directory).resolve()
    marker = owned / "abort"
    assert not rpc.abort_requested(marker, owned)
    marker.write_bytes(b"abort\n")
    marker.chmod(0o600)
    assert rpc.abort_requested(marker, owned)
    marker.chmod(0o644)
    try:
        rpc.abort_requested(marker, owned)
    except AssertionError:
        pass
    else:
        raise AssertionError("Nonprivate marker accepted")
    marker.unlink()
    marker.symlink_to(owned / "absent")
    try:
        rpc.abort_requested(marker, owned)
    except OSError:
        pass
    else:
        raise AssertionError("Symlink marker accepted")
    marker.unlink()
    os.mkfifo(marker, 0o600)
    try:
        rpc.abort_requested(marker, owned)
    except AssertionError:
        pass
    else:
        raise AssertionError("Nonregular marker accepted")
process = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True
)
rpc.stop_group(process)
assert process.poll() is not None
print(
    "tool-only timing, filtering, private abort marker, owned group termination/wait: passed"
)
