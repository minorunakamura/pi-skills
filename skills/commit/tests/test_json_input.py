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
handler = sys.argv[2]
# Echo the parsed request instead of performing any Git or remote operation.
module["main"].__globals__[handler] = lambda request, *args, **kwargs: request
sys.argv = [sys.argv[1], *sys.argv[3:]]
sys.exit(module["main"]())
"""


CLI_INPUTS = [
    ("staged-commit.py", ("commit",), "commit", ("check", "message")),
    ("guarded-push.py", ("push",), "push", ("check",)),
    ("github-pr.py", ("create",), "create", ("check", "title", "body")),
    (
        "guarded-push.py",
        ("prepare", "--remote", "origin", "--target", "fix/日本語", "--set-upstream"),
        "prepare",
        ("commitCheck",),
    ),
    (
        "guarded-push.py",
        ("check", "--prepared"),
        "check_prepared",
        ("preparation", "commit"),
    ),
    (
        "github-pr.py",
        ("prepare", "--remote", "origin", "--repo", "owner/repo", "--base", "main"),
        "prepare",
        ("commitCheck", "pushPreparation"),
    ),
    ("github-pr.py", ("verify",), "verify_prepared", ("preparation", "commit")),
    (
        "github-pr.py",
        ("check", "--prepared"),
        "verify_prepared",
        ("preparation", "commit"),
    ),
]


@pytest.mark.parametrize(("script", "arguments", "handler", "fields"), CLI_INPUTS)
@pytest.mark.parametrize("encoding", ["utf-8", "cp932:strict", "cp932:surrogateescape"])
def test_cli_reads_utf8_json_independently_of_stdin_encoding(
    tmp_path: Path,
    script: str,
    arguments: tuple,
    handler: str,
    fields: tuple,
    encoding: str,
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
    request.update(
        commitCheck=request["check"],
        pushPreparation={"kind": "push-preparation", "branch": "fix/日本語"},
        preparation={"branch": "fix/日本語"},
        commit={"branch": "fix/日本語", "messageSha256": "a" * 64},
    )
    request = {key: request[key] for key in fields}
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-c",
            BOOTSTRAP,
            str(SCRIPTS / script),
            handler,
            *arguments,
        ],
        input=json.dumps(request, ensure_ascii=False).encode("utf-8"),
        env=dict(os.environ, PYTHONIOENCODING=encoding),
        cwd=tmp_path,
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout) == request


@pytest.mark.parametrize(
    ("script", "arguments"),
    [(script, arguments) for script, arguments, _, _ in CLI_INPUTS],
)
@pytest.mark.parametrize("encoding", ["utf-8", "cp932:strict", "cp932:surrogateescape"])
@pytest.mark.parametrize(
    "payload", [b'{"message":"SECRET_INPUT\xff"}', b'{"SECRET_INPUT":']
)
def test_cli_rejects_invalid_utf8_or_json_without_traceback_or_secret_echo(
    tmp_path: Path, script: str, arguments: tuple, encoding: str, payload: bytes
):
    result = subprocess.run(
        [sys.executable, "-B", str(SCRIPTS / script), *arguments],
        env=dict(os.environ, PYTHONIOENCODING=encoding),
        cwd=tmp_path,
        input=payload,
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 1
    expected = (
        "invalid_input" if script == "staged-commit.py" else "invalid_input_or_response"
    )
    assert json.loads(result.stdout) == {"error": expected}
    assert b"Traceback" not in result.stdout + result.stderr
    assert b"SECRET_INPUT" not in result.stdout + result.stderr
