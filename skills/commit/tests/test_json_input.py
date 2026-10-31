"""Exercise CLI JSON input without Git or POSIX-only test executables."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
BOOTSTRAP = """
import runpy, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).parent))
module = runpy.run_path(sys.argv[1])
operation = sys.argv[2]
# Echo the parsed request instead of performing any Git or remote operation.
module["main"].__globals__[operation] = lambda request: request
sys.argv = [sys.argv[1], operation]
sys.exit(module["main"]())
"""


@pytest.mark.parametrize(
    ("script", "operation"),
    [
        ("staged-commit.py", "commit"),
        ("guarded-push.py", "push"),
        ("github-pr.py", "create"),
    ],
)
@pytest.mark.parametrize("encoding", ["utf-8", "cp932:strict", "cp932:surrogateescape"])
def test_cli_reads_utf8_json_independently_of_stdin_encoding(
    tmp_path: Path, script: str, operation: str, encoding: str
):
    request = {
        "check": {
            "snapshot": {
                "branch": "main",
                "plannedBranch": "fix/日本語",
                "tree": "a" * 40,
                "head": None,
            },
            "gitleaks": "passed",
        },
        "message": "fix: 日本語のコミットメッセージ\n\n文字化けを防ぐ。\n",
        "title": "日本語のタイトル",
        "body": "## 理由\n\n承認された本文を保持する。\n",
    }
    result = subprocess.run(
        [sys.executable, "-B", "-c", BOOTSTRAP, str(SCRIPTS / script), operation],
        input=json.dumps(request, ensure_ascii=False).encode("utf-8"),
        env=dict(os.environ, PYTHONIOENCODING=encoding),
        cwd=tmp_path,
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout) == request


@pytest.mark.parametrize("payload", [b'{"message":"\xff"}', b'{"check":'])
def test_staged_commit_rejects_invalid_utf8_or_json_without_traceback(
    tmp_path: Path, payload: bytes
):
    result = subprocess.run(
        [sys.executable, "-B", str(SCRIPTS / "staged-commit.py"), "commit"],
        cwd=tmp_path,
        input=payload,
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 1
    assert json.loads(result.stdout) == {"error": "invalid_input"}
    assert b"Traceback" not in result.stderr
