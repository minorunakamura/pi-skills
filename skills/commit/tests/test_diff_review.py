"""Execute the shared documentation's shell examples, not the LLM's decisions."""

import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
EXAMPLES = re.findall(
    r"```sh\n(.*?)\n```",
    (SKILL_DIR / "references" / "diff-review.md").read_text(),
    re.DOTALL,
)


@pytest.fixture
def review_env(tmp_path: Path, git_env: dict[str, str], git_executable: str):
    (tmp_path / "bin" / "git").symlink_to(git_executable)
    (tmp_path / "bin" / "python3").symlink_to(sys.executable)
    for name in ("mktemp", "rm", "rmdir", "cmp"):
        executable = shutil.which(name)
        if executable is None:
            pytest.skip(f"Requires {name}")
        (tmp_path / "bin" / name).symlink_to(executable)
    return git_env


def run_example(index: int, root: Path, env: dict[str, str], *args: Path):
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("Requires a POSIX shell")
    return subprocess.run(
        [shell, "-c", "umask 000\n" + EXAMPLES[index], "diff-review", *map(str, args)],
        cwd=root / "repo",
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_capture_is_private_unique_and_matches_checked_staged_bytes(
    tmp_path: Path, review_env: dict[str, str], git_executable: str
):
    repo = tmp_path / "repo"
    parent = tmp_path / "temporary files"
    parent.mkdir()
    victim = tmp_path / "keep.txt"
    victim.write_text("do not overwrite")
    (parent / "staged.diff").symlink_to(victim)
    target = repo / "odd [name]\t.txt"
    target.write_bytes(b"STAGED_CONTENT\r\n" * 8000)
    subprocess.run(
        [git_executable, "--literal-pathspecs", "add", "--", target.name],
        cwd=repo,
        env=review_env,
        check=True,
        capture_output=True,
    )
    target.write_text("ONLY_UNSTAGED_CONTENT")
    checked = subprocess.run(
        [
            sys.executable,
            "-B",
            str(SKILL_DIR / "scripts" / "staged-commit.py"),
            "check",
        ],
        cwd=repo,
        env=review_env,
        capture_output=True,
        check=True,
        text=True,
        timeout=10,
    )
    check = json.loads(checked.stdout)
    expected_hash = check["snapshot"]["diffSha256"]
    directories = set()
    for _ in range(2):
        captured = run_example(0, tmp_path, review_env, parent)
        assert captured.returncode == 0, captured.stderr
        directory = Path(captured.stdout.strip())
        try:
            assert directory.parent == parent.resolve()
            assert directory not in directories
            directories.add(directory)
            assert stat.S_IMODE(directory.stat().st_mode) == 0o700
            diff = directory / "staged.diff"
            assert stat.S_IMODE(diff.stat().st_mode) == 0o600
            content = diff.read_bytes()
            assert len(content) > 50 * 1024
            assert b"ONLY_UNSTAGED_CONTENT" not in content
            assert hashlib.sha256(content).hexdigest() == expected_hash
            hashed = run_example(1, tmp_path, review_env, diff)
            assert hashed.returncode == 0, hashed.stderr
            assert hashed.stdout.strip() == expected_hash
            assert len(hashed.stdout) == 65
        finally:
            cleanup = run_example(3, tmp_path, review_env, directory)
            assert cleanup.returncode == 0, cleanup.stderr
            assert not directory.exists()
    assert victim.read_text() == "do not overwrite"
    assert (parent / "staged.diff").is_symlink()
    committed = subprocess.run(
        [
            sys.executable,
            "-B",
            str(SKILL_DIR / "scripts" / "staged-commit.py"),
            "commit",
        ],
        cwd=repo,
        env=review_env,
        input=json.dumps({"check": check, "message": "docs: review staged changes\n"}),
        capture_output=True,
        check=True,
        text=True,
        timeout=10,
    )
    result = json.loads(committed.stdout)
    assert result["branch"] == check["snapshot"]["plannedBranch"] == "main"
    assert result["tree"] == check["snapshot"]["tree"]
    assert result["parents"] == []
    assert (
        result["messageSha256"]
        == hashlib.sha256(b"docs: review staged changes\n").hexdigest()
    )
    assert target.read_text() == "ONLY_UNSTAGED_CONTENT"


def test_digest_does_not_load_repository_python_code(
    tmp_path: Path, review_env: dict[str, str]
):
    marker = tmp_path / "repository-module-loaded"
    malicious = (
        f"open({str(marker)!r}, 'w').close()\n"
        "raise RuntimeError('repository Python code must not run')\n"
    )
    for name in ("hashlib.py", "pathlib.py", "sitecustomize.py"):
        (tmp_path / "repo" / name).write_text(malicious)
    diff = tmp_path / "staged.diff"
    diff.write_bytes(b"canonical bytes\r\n")
    result = run_example(
        1, tmp_path, {**review_env, "PYTHONPATH": str(tmp_path / "repo")}, diff
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == hashlib.sha256(diff.read_bytes()).hexdigest()
    assert not marker.exists()


@pytest.mark.parametrize("git_failure", [False, True], ids=["empty", "git-failure"])
def test_capture_failure_leaves_no_artifact(
    tmp_path: Path,
    review_env: dict[str, str],
    git_executable: str,
    git_failure: bool,
):
    parent = tmp_path / "temporary files"
    parent.mkdir()
    if git_failure:
        git = tmp_path / "bin" / "git"
        git.unlink()
        git.write_text(
            f"#!{sys.executable}\nimport os, sys\n"
            "if 'diff' in sys.argv:\n"
            "    print('PARTIAL_DIFF_MUST_NOT_BE_RETURNED')\n    sys.exit(42)\n"
            f"os.execv({git_executable!r}, [{git_executable!r}, *sys.argv[1:]])\n"
        )
        git.chmod(0o700)
    result = run_example(0, tmp_path, review_env, parent)
    assert result.returncode != 0
    assert result.stdout == ""
    assert list(parent.iterdir()) == []


@pytest.mark.parametrize("location", ["root", "child", "symlink"])
def test_capture_refuses_temporary_parent_in_repository(
    tmp_path: Path, review_env: dict[str, str], location: str
):
    repo = tmp_path / "repo"
    parent = repo if location == "root" else repo / "temporary files"
    if parent != repo:
        parent.mkdir()
    before = set(parent.iterdir())
    if location == "symlink":
        link = tmp_path / "outside-looking-link"
        link.symlink_to(parent, target_is_directory=True)
        parent = link
    result = run_example(0, tmp_path, review_env, parent)
    assert result.returncode != 0
    assert "temporary parent is inside repository" in result.stderr
    assert set(parent.iterdir()) == before


@pytest.mark.parametrize(
    ("mode", "expected_code"), [("equal", 0), ("different-tail", 1), ("missing", 2)]
)
def test_comparison_uses_complete_bytes_and_distinguishes_errors(
    tmp_path: Path, review_env: dict[str, str], mode: str, expected_code: int
):
    left, right = tmp_path / "staged.diff", tmp_path / "pr.diff"
    content = b"same prefix\r\n" * 8000
    left.write_bytes(content + b"A")
    if mode != "missing":
        right.write_bytes(content + (b"B" if mode == "different-tail" else b"A"))
    result = run_example(2, tmp_path, review_env, left, right)
    assert result.returncode == expected_code
    assert result.stdout == ""


def test_cleanup_does_not_delete_unrecorded_files(
    tmp_path: Path, review_env: dict[str, str]
):
    directory = tmp_path / "private"
    directory.mkdir(mode=0o700)
    (directory / "staged.diff").touch(mode=0o600)
    (directory / "pr.diff").touch(mode=0o600)
    unknown = directory / "keep.txt"
    unknown.write_text("not ours")
    result = run_example(3, tmp_path, review_env, directory)
    assert result.returncode != 0
    assert unknown.read_text() == "not ours"
    assert not (directory / "staged.diff").exists()
    assert not (directory / "pr.diff").exists()


def test_both_routes_link_shared_review_and_bind_commit_to_checked_diff():
    skill = (SKILL_DIR / "SKILL.md").read_text()
    compatibility = (SKILL_DIR / "references" / "compatibility.md").read_text()
    assert "references/diff-review.md" in skill
    assert "diff-review.md" in compatibility
    commit_section = skill.split("## 8.", 1)[1].split("## 9.", 1)[0]
    assert "snapshot.diffSha256" in commit_section
    assert "一致した本文を改めて読み直す必要はない" in commit_section
    for section in (commit_section, compatibility):
        assert section.index("承認質問の前に一時diffの削除成功を確認") < section.index(
            "`ask_user_question`"
        )
    review = (SKILL_DIR / "references" / "diff-review.md").read_text()
    assert "どの質問よりも前に一時diffの削除成功を確認" in review
    assert "後始末失敗なら承認質問へ進まず停止" in review


def test_diff_review_prepares_both_scopes_and_reuses_only_exact_units():
    review = (SKILL_DIR / "references" / "diff-review.md").read_text()
    assert "並行準備" in review
    assert "全5フィールドが一致する単位" in review
    assert "異なる単位" in review
    assert "どの質問よりも前" in review
    assert "opt-in" not in review
    assert "既定の進行順序や承認手順は変更しない" not in review


def test_documented_raw_units_match_for_one_file_when_whole_pr_diff_differs(
    tmp_path: Path, review_env: dict[str, str], git_executable: str
):
    repo = tmp_path / "repo"

    def git(*args: str) -> bytes:
        return subprocess.run(
            [git_executable, *args],
            cwd=repo,
            env=review_env,
            capture_output=True,
            check=True,
        ).stdout

    (repo / "shared.txt").write_text("base\n")
    git("add", "shared.txt")
    git("commit", "-m", "base")
    base = git("rev-parse", "HEAD").decode().strip()
    (repo / "branch-only.txt").write_text("already committed\n")
    git("add", "branch-only.txt")
    git("commit", "-m", "existing branch change")
    parent = git("rev-parse", "HEAD").decode().strip()
    (repo / "shared.txt").write_text("pending\n")
    git("add", "shared.txt")
    tree = git("write-tree").decode().strip()
    assert git("diff", parent, tree) != git("diff", base, tree)
    review = (SKILL_DIR / "references" / "diff-review.md").read_text()
    match = re.search(r"```bash\n(.*?)\n```", review, re.DOTALL)
    assert match is not None, "Document the raw unit enumeration"
    shell = shutil.which("bash")
    assert shell is not None

    def units(start: str) -> dict[bytes, list[bytes]]:
        result = subprocess.run(
            [shell, "-c", match.group(1), "raw-units", start, tree],
            cwd=repo,
            env=review_env,
            capture_output=True,
            check=True,
        )
        records = result.stdout.split(b"\0")[:-1]
        return {
            records[i + 1]: records[i].split()[:4] for i in range(0, len(records), 2)
        }

    staged, whole = units(parent), units(base)
    assert set(staged) == {b"shared.txt"}
    assert set(whole) == {b"shared.txt", b"branch-only.txt"}
    assert staged[b"shared.txt"] == whole[b"shared.txt"]
    assert staged[b"shared.txt"] == [
        b":100644",
        b"100644",
        git("rev-parse", "HEAD:shared.txt").strip(),
        git("rev-parse", ":shared.txt").strip(),
    ]


def test_same_path_and_new_blob_are_not_reusable_when_old_blob_differs(
    tmp_path: Path, review_env: dict[str, str], git_executable: str
):
    repo = tmp_path / "repo"

    def git(*args):
        return subprocess.run(
            [git_executable, *args],
            cwd=repo,
            env=review_env,
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
            "-B",
            str(SKILL_DIR / "scripts" / "staged-commit.py"),
            "check",
        ],
        cwd=repo,
        env=review_env,
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
