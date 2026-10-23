"""Black-box tests; all Git mutations are confined to temporary repositories."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class TestCommitScripts:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path, git_executable: str, git_env: dict[str, str]):
        self.root = tmp_path
        self.repo = tmp_path / "repo"
        self.bin = tmp_path / "bin"
        self.git_executable = git_executable
        self.env = git_env
        (self.bin / "git").symlink_to(git_executable)
        self.env.update(
            {
                "SCAN_LOG": str(self.root / "scan.diff"),
                "SCAN_COUNT": str(self.root / "scan.count"),
                "TEST_REPO": str(self.repo),
            }
        )
        self.scanner()

    def git(self, *args):
        return subprocess.run(
            [self.git_executable, *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            check=True,
        ).stdout

    def script(self, name, *args, request=None, cwd=None, success=True):
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPTS / name), *args],
            cwd=cwd or self.repo,
            env=self.env,
            capture_output=True,
            input=json.dumps(request).encode() if request is not None else None,
            timeout=20,
        )
        assert (result.returncode == 0) is success, result.stdout + result.stderr
        assert b"Traceback" not in result.stderr
        return json.loads(result.stdout)

    def scanner(self):
        source = (
            f"#!{sys.executable}\n"
            + """import json, os, pathlib, subprocess, sys
mode = os.environ.get("SCAN_MODE", "passed")
if sys.argv[1:] == ["stdin", "--help"]:
    print("stdin --redact" if mode != "unsupported" else "old scanner")
    sys.exit(0)
data = sys.stdin.buffer.read()
pathlib.Path(os.environ["SCAN_LOG"]).write_bytes(data)
with open(os.environ["SCAN_COUNT"], "a") as f:
    f.write("scan\\n")
if mode == "changed":
    target = pathlib.Path(os.environ["TEST_REPO"]) / "tracked.txt"
    target.write_text("changed during scan")
    subprocess.run(["git", "add", "--", "tracked.txt"], check=True)
if mode in ("findings", "error"):
    print("RAW_SECRET_MUST_NOT_LEAVE_SCANNER", file=sys.stderr)
    if mode == "findings":
        print(json.dumps([{"RuleID": "test-rule", "StartLine": 8,
            "Secret": "RAW_SECRET_MUST_NOT_LEAVE_SCANNER",
            "Match": "RAW_SECRET_MUST_NOT_LEAVE_SCANNER"}]))
    sys.exit(1 if mode == "findings" else 2)
print("[]")
"""
        )
        executable = self.bin / "gitleaks"
        executable.write_text(source)
        executable.chmod(0o700)

    def stage(self, text="staged content", path="tracked.txt"):
        (self.repo / path).write_text(text)
        self.git("add", "--", path)

    def initial_commit(self):
        self.stage("base")
        self.git("commit", "-m", "initial")
        return self.git("rev-parse", "HEAD").strip().decode()

    def check(self, **kwargs):
        return self.script("staged-commit.py", "check", **kwargs)

    def commit(self, checked, message="docs: test\n", **kwargs):
        return self.script(
            "staged-commit.py",
            "commit",
            request={"check": checked, "message": message},
            **kwargs,
        )

    def test_status_unborn_special_paths_without_contents(self):
        names = ["space name.txt", "line\nname.txt", "日本語.txt", "-dash", ":(glob)*"]
        for name in names:
            (self.repo / name).write_text("DO_NOT_PRINT_WORKTREE_CONTENT")
        result = self.script("git-status.py")
        assert result["branch"] == "main"
        assert result["head"] is None
        assert {x["path"] for x in result["changes"]} == set(names)
        assert all(x["untracked"] for x in result["changes"])
        assert "DO_NOT_PRINT" not in json.dumps(result)

    def test_partial_stage_and_staged_rename(self):
        self.initial_commit()
        self.stage("staged")
        (self.repo / "tracked.txt").write_text("unstaged")
        result = self.script("git-status.py")
        item = result["changes"][0]
        assert item["staged"]
        assert item["unstaged"]
        assert (item["index"], item["worktree"]) == ("M", "M")
        self.stage("base")
        self.git("mv", "--", "tracked.txt", "renamed\n日本語.txt")
        result = self.script("git-status.py")
        renamed = next(x for x in result["changes"] if x["index"] == "R")
        assert renamed["path"] == "renamed\n日本語.txt"
        assert renamed["originalPath"] == "tracked.txt"

    def test_status_and_snapshot_are_root_relative_from_subdirectory(self):
        self.stage()
        nested = self.repo / "nested"
        nested.mkdir()
        result = self.script("git-status.py", cwd=nested)
        assert result["changes"][0]["path"] == "tracked.txt"
        root = self.check()
        subdir = self.check(cwd=nested)
        assert root == subdir
        self.commit(subdir, cwd=nested)

    def test_scan_only_staged_diff_and_preserve_partial_stage_on_commit(self):
        self.initial_commit()
        self.stage("ONLY_STAGED_CONTENT")
        (self.repo / "tracked.txt").write_text("ONLY_UNSTAGED_CONTENT")
        (self.repo / "untracked.txt").write_text("ONLY_UNTRACKED_CONTENT")
        checked = self.check()
        scanned = (self.root / "scan.diff").read_bytes()
        assert b"ONLY_STAGED_CONTENT" in scanned
        assert b"ONLY_UNSTAGED_CONTENT" not in scanned
        assert b"ONLY_UNTRACKED_CONTENT" not in scanned
        message = "docs: preserve $(touch should-not-exist) and 'quotes'\n\nReason.\n"
        result = self.commit(checked, message)
        assert self.git("show", "HEAD:tracked.txt") == b"ONLY_STAGED_CONTENT"
        assert (self.repo / "tracked.txt").read_text() == "ONLY_UNSTAGED_CONTENT"
        assert not (self.repo / "should-not-exist").exists()
        assert self.git("log", "-1", "--format=%B").decode() == message + "\n"
        assert result["commit"] == self.git("rev-parse", "HEAD").strip().decode()
        assert (self.root / "scan.count").read_text() == "scan\n"

    def test_unborn_commit_and_missing_gitleaks(self):
        (self.bin / "gitleaks").unlink()
        self.stage()
        checked = self.check()
        assert checked["gitleaks"] == "unavailable"
        assert checked["snapshot"]["head"] is None
        self.commit(checked)
        assert self.git("rev-list", "--count", "HEAD").strip() == b"1"

    @pytest.mark.parametrize("mode", ["findings", "error", "unsupported"])
    def test_scanner_failure_is_redacted_and_blocks_commit(self, mode):
        self.stage()
        self.env["SCAN_MODE"] = mode
        result = self.check(success=False)
        assert result["error"] in ("gitleaks_failed", "gitleaks_unsupported")
        assert "RAW_SECRET" not in json.dumps(result)
        if mode == "findings":
            assert result["findings"] == [{"rule": "test-rule", "diffLine": 8}]
        assert self.script("git-status.py")["head"] is None

    def test_index_change_during_scan_blocks_check(self):
        self.stage()
        self.env["SCAN_MODE"] = "changed"
        assert self.check(success=False)["error"] == "state_changed_during_check"

    @pytest.mark.parametrize(
        "data", [b"changed content", b"\0binary\xff"], ids=["text", "binary"]
    )
    def test_changed_staged_text_or_binary_blocks_commit(self, data):
        self.initial_commit()
        self.stage("approved")
        checked = self.check()
        (self.repo / "tracked.txt").write_bytes(data)
        self.git("add", "--", "tracked.txt")
        result = self.commit(checked, success=False)
        assert result["error"] == "state_changed_before_commit"
        assert self.git("log", "-1", "--format=%s").strip() == b"initial"

    def test_staged_deletion_is_committed(self):
        self.initial_commit()
        self.git("rm", "--", "tracked.txt")
        state = self.script("git-status.py")
        assert state["changes"][0]["index"] == "D"
        self.commit(self.check())
        assert self.git("ls-tree", "--name-only", "HEAD") == b""

    def test_changed_mode_blocks_commit(self):
        self.initial_commit()
        self.stage()
        checked = self.check()
        self.git("update-index", "--chmod=+x", "tracked.txt")
        assert (
            self.commit(checked, success=False)["error"]
            == "state_changed_before_commit"
        )

    def test_changed_branch_blocks_commit(self):
        self.initial_commit()
        self.git("branch", "other")
        self.stage()
        checked = self.check()
        self.git("switch", "other")
        assert (
            self.commit(checked, success=False)["error"]
            == "state_changed_before_commit"
        )

    def test_changed_head_with_same_tree_blocks_commit(self):
        original = self.initial_commit()
        self.git("commit", "--allow-empty", "-m", "second")
        self.stage()
        checked = self.check()
        self.git("update-ref", "HEAD", original)
        assert (
            self.commit(checked, success=False)["error"]
            == "state_changed_before_commit"
        )

    def test_snapshot_from_another_repository_is_rejected(self):
        self.stage()
        checked = self.check()
        other = self.root / "other"
        other.mkdir()
        subprocess.run(
            [self.git_executable, "init", "-b", "main"],
            cwd=other,
            env=self.env,
            check=True,
            capture_output=True,
        )
        (other / "tracked.txt").write_text("staged content")
        subprocess.run(
            [self.git_executable, "add", "--", "tracked.txt"],
            cwd=other,
            env=self.env,
            check=True,
        )
        assert (
            self.commit(checked, cwd=other, success=False)["error"]
            == "state_changed_before_commit"
        )

    def test_detached_head_and_empty_index_are_rejected(self):
        assert self.check(success=False)["error"] == "empty_staged_diff"
        self.initial_commit()
        self.git("switch", "--detach")
        self.stage()
        assert self.script("git-status.py")["branch"] is None
        assert self.check(success=False)["error"] == "detached_head"

    def test_conflicts_are_rejected(self):
        self.initial_commit()
        self.git("switch", "-c", "other")
        self.stage("other")
        self.git("commit", "-m", "other")
        self.git("switch", "main")
        self.stage("main")
        self.git("commit", "-m", "main")
        merged = subprocess.run(
            [self.git_executable, "merge", "other"],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        assert merged.returncode != 0
        assert self.script("git-status.py")["conflicts"]
        assert self.check(success=False)["error"] == "unmerged_index"

    @pytest.mark.parametrize(
        "case",
        range(5),
        ids=["empty-map", "list", "missing-check", "empty-message", "nul-message"],
    )
    def test_invalid_request_and_non_repository_fail_without_traceback(self, case):
        self.stage()
        checked = self.check()
        request = [
            {},
            [],
            {"check": {}, "message": "test"},
            {"check": checked, "message": ""},
            {"check": checked, "message": "bad\0message"},
        ][case]
        result = self.script(
            "staged-commit.py", "commit", request=request, success=False
        )
        assert result["error"] == "invalid_commit_request"

    def test_non_repository_commands_fail_without_traceback(self):
        self.script("git-status.py", cwd=self.root, success=False)
        self.check(cwd=self.root, success=False)

    def test_failed_commit_hook_is_not_retried_or_rolled_back(self):
        self.stage()
        checked = self.check()
        hook = self.repo / ".git" / "hooks" / "pre-commit"
        hook.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(1)\n")
        hook.chmod(0o700)
        assert self.commit(checked, success=False)["error"] == "git_commit_failed"
        state = self.script("git-status.py")
        assert state["head"] is None
        assert state["changes"][0]["staged"]
