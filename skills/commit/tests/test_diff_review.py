"""Retained legacy product regression until #49; current Bun equivalence is in commit-workflow.test.ts."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]


def test_same_path_and_new_blob_are_not_reusable_when_old_blob_differs(
    tmp_path: Path, git_env: dict[str, str], git_executable: str
):
    (tmp_path / "bin/git").symlink_to(git_executable)
    repo = tmp_path / "repo"

    def git(*args):
        return subprocess.run(
            [git_executable, *args],
            cwd=repo,
            env=git_env,
            capture_output=True,
            check=True,
            timeout=10,
        ).stdout

    target = repo / "shared.txt"
    target.write_text("base\n")
    git("add", target.name)
    git("commit", "-m", "base")
    base = git("rev-parse", "HEAD").decode().strip()
    target.write_text("existing branch change\n")
    git("add", target.name)
    git("commit", "-m", "existing branch change")
    target.write_text("pending change\n")
    git("add", target.name)
    checked = subprocess.run(
        [
            sys.executable,
            "-E",
            "-S",
            "-B",
            str(SKILL_DIR / "scripts" / "staged-commit.py"),
            "check",
        ],
        cwd=repo,
        env=git_env,
        capture_output=True,
        check=True,
        timeout=10,
    )
    snapshot = json.loads(checked.stdout)["snapshot"]
    diff_args = (
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        "--no-color",
        "--no-renames",
        "--ignore-submodules=none",
    )
    staged_diff = git("diff", "--cached", *diff_args)
    whole_diff = git("diff", *diff_args, base, snapshot["tree"])
    assert hashlib.sha256(staged_diff).hexdigest() == snapshot["diffSha256"]
    assert hashlib.sha256(whole_diff).hexdigest() != snapshot["diffSha256"]
    raw_args = ("--raw", "-z", "--no-abbrev", "--no-renames")
    staged_header, staged_path, _ = git("diff", "--cached", *raw_args).split(b"\0")
    whole_header, whole_path, _ = git("diff", *raw_args, base, snapshot["tree"]).split(
        b"\0"
    )
    staged_fields, whole_fields = staged_header.split(), whole_header.split()
    assert staged_path == whole_path == b"shared.txt"
    assert staged_fields[:2] == whole_fields[:2] == [b":100644", b"100644"]
    assert (
        staged_fields[3] == whole_fields[3] == git("rev-parse", ":shared.txt").strip()
    )
    assert staged_fields[2] == git("rev-parse", "HEAD:shared.txt").strip()
    assert whole_fields[2] == git("rev-parse", f"{base}:shared.txt").strip()
    assert staged_fields[2] != whole_fields[2]
