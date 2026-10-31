"""Black-box tests; all Git mutations are confined to temporary repositories."""

import hashlib
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
            input=(
                json.dumps(request, ensure_ascii=False).encode("utf-8")
                if request is not None
                else None
            ),
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

    def test_branch_and_tag_with_same_name_preserve_exact_branch_on_commit(self):
        parent = self.initial_commit()
        self.git("tag", "main")
        self.stage()
        assert self.script("git-status.py")["branch"] == "main"
        checked = self.check()
        assert checked["snapshot"]["branch"] == "main"
        assert checked["snapshot"]["plannedBranch"] == "main"
        result = self.commit(checked)
        assert result["branch"] == "main"
        assert result["parents"] == [parent]
        assert (
            result["commit"]
            == self.git("rev-parse", "refs/heads/main").strip().decode()
        )
        assert self.git("rev-parse", "refs/tags/main").strip().decode() == parent

    def test_unicode_line_separator_in_existing_ref_allows_commit(self):
        parent = self.initial_commit()
        self.git("tag", "x\u2028y")
        self.stage()
        checked = self.check()
        assert checked["snapshot"]["refs"]["refs/tags/x\u2028y"] == parent
        result = self.commit(checked)
        assert result["branch"] == "main"
        assert result["parents"] == [parent]
        assert self.git("rev-parse", "refs/tags/x\u2028y").strip().decode() == parent

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

    @pytest.mark.parametrize("has_parent", [False, True], ids=["initial", "normal"])
    @pytest.mark.parametrize("ending", ["", "\n", "\n\n"])
    def test_check_and_commit_bind_tree_parents_and_raw_message(
        self, has_parent, ending
    ):
        parent = self.initial_commit() if has_parent else None
        self.stage("planned tree", path="日本語\nfile.txt")
        checked = self.check()
        expected_tree = self.git("write-tree").strip().decode()
        assert checked["snapshot"]["tree"] == expected_tree
        assert checked["snapshot"]["head"] == parent
        assert checked["snapshot"]["plannedBranch"] == "main"
        message = "fix: 日本語  \n\nPreserve trailing spaces.  " + ending
        expected_message = message.encode("utf-8")
        result = self.commit(checked, message)
        assert result == {
            "commit": self.git("rev-parse", "HEAD").strip().decode(),
            "branch": "main",
            "parents": [parent] if parent else [],
            "tree": expected_tree,
            "messageSha256": hashlib.sha256(expected_message).hexdigest(),
            "gitleaks": "passed",
        }
        raw = self.git("cat-file", "commit", result["commit"])
        assert raw.split(b"\n\n", 1)[1] == expected_message

    @pytest.mark.parametrize("has_parent", [False, True], ids=["initial", "normal"])
    def test_only_planned_new_branch_is_created_without_inheriting_upstream(
        self, has_parent
    ):
        parent = self.initial_commit() if has_parent else None
        self.git("config", "branch.autoSetupMerge", "inherit")
        self.git("config", "branch.main.remote", "origin")
        self.git("config", "branch.main.merge", "refs/heads/main")
        self.stage()
        checked = self.script("staged-commit.py", "check", "--branch", "fix/日本語")
        assert checked["snapshot"]["branch"] == "main"
        assert checked["snapshot"]["plannedBranch"] == "fix/日本語"
        assert self.script("git-status.py")["branch"] == "main"
        assert self.git("for-each-ref", "--format=%(refname)", "refs/heads/fix/") == b""
        result = self.commit(checked)
        assert result["branch"] == "fix/日本語"
        assert self.script("git-status.py")["branch"] == "fix/日本語"
        assert (
            self.git("rev-parse", "refs/heads/fix/日本語").strip().decode()
            == result["commit"]
        )
        assert (
            self.git("for-each-ref", "--format=%(upstream)", "refs/heads/fix/日本語")
            == b"\n"
        )
        assert b"branch.fix/" not in self.git("config", "--local", "--list")
        if parent:
            assert self.git("rev-parse", "refs/heads/main").strip().decode() == parent

    @pytest.mark.parametrize(
        "branch", ["bad..name", "-option", "@{-1}", "line\nname", "", "main", "HEAD"]
    )
    def test_check_rejects_invalid_or_current_branch_without_mutation(self, branch):
        self.stage()
        result = self.script(
            "staged-commit.py", "check", "--branch=" + branch, success=False
        )
        assert result["error"] == (
            "branch_exists" if branch == "main" else "invalid_branch"
        )
        assert self.script("git-status.py")["branch"] == "main"
        assert self.script("git-status.py")["head"] is None
        assert not (self.root / "scan.count").exists()

    @pytest.mark.parametrize("when", ["before-check", "before-commit"])
    def test_existing_planned_branch_is_never_switched_or_overwritten(self, when):
        parent = self.initial_commit()
        self.stage()
        if when == "before-check":
            self.git("branch", "existing")
            result = self.script(
                "staged-commit.py", "check", "--branch", "existing", success=False
            )
        else:
            checked = self.script("staged-commit.py", "check", "--branch", "existing")
            self.git("branch", "existing")
            result = self.commit(checked, success=False)
        assert result["error"] in ("branch_exists", "state_changed_before_commit")
        assert self.script("git-status.py")["branch"] == "main"
        assert self.git("rev-parse", "existing").strip().decode() == parent
        assert self.git("rev-parse", "HEAD").strip().decode() == parent

    @pytest.mark.parametrize(
        ("existing", "planned"), [("topic", "topic/child"), ("topic/child", "topic")]
    )
    def test_planned_branch_ref_namespace_collision_is_rejected_before_scan(
        self, existing, planned
    ):
        self.initial_commit()
        self.git("branch", existing)
        self.stage()
        result = self.script(
            "staged-commit.py", "check", "--branch", planned, success=False
        )
        assert result["error"] == "branch_exists"
        assert not (self.root / "scan.count").exists()
        assert self.script("git-status.py")["branch"] == "main"

    def test_japanese_message_is_preserved_with_cp932_stdin(self):
        self.stage()
        self.env["PYTHONIOENCODING"] = "cp932:surrogateescape"
        message = "fix: 日本語のコミットメッセージ\n\n文字化けを防ぐ。\n"
        self.commit(self.check(), message)
        assert self.git("log", "-1", "--format=%B").decode("utf-8") == message + "\n"

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

    def test_non_utf8_message_is_rejected_before_planned_branch_creation(self):
        self.stage()
        checked = self.script("staged-commit.py", "check", "--branch", "planned")
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPTS / "staged-commit.py"), "commit"],
            cwd=self.repo,
            env=self.env,
            input=json.dumps({"check": checked, "message": "bad\ud800"}).encode(
                "ascii"
            ),
            capture_output=True,
            timeout=20,
        )
        assert result.returncode == 1
        assert json.loads(result.stdout)["error"] == "invalid_commit_request"
        assert self.script("git-status.py")["branch"] == "main"
        assert self.script("git-status.py")["head"] is None

    def test_non_repository_commands_fail_without_traceback(self):
        self.script("git-status.py", cwd=self.root, success=False)
        self.check(cwd=self.root, success=False)

    @pytest.mark.parametrize(
        "mutation", ["tree", "message", "extra-lf", "removed-lf", "spaces"]
    )
    def test_hook_tree_or_message_changes_report_observed_commit_and_stop(
        self, mutation
    ):
        self.initial_commit()
        self.stage("approved")
        checked = self.check()
        hook_name = "pre-commit" if mutation == "tree" else "commit-msg"
        if mutation == "tree":
            source = "import pathlib, subprocess\npathlib.Path('tracked.txt').write_text('HOOK_SECRET')\nsubprocess.run(['git', 'add', '--', 'tracked.txt'], check=True)\n"
        else:
            changes = {
                "message": "b'HOOK_SECRET\\n'",
                "extra-lf": "data + b'\\n'",
                "removed-lf": "data[:-1]",
                "spaces": "data.replace(b'keep  ', b'keep ')",
            }
            source = (
                "import pathlib, sys\np = pathlib.Path(sys.argv[1])\ndata = p.read_bytes()\np.write_bytes("
                + changes[mutation]
                + ")\n"
            )
        hook = self.repo / ".git" / "hooks" / hook_name
        hook.write_text(f"#!{sys.executable}\n" + source)
        hook.chmod(0o700)
        result = self.commit(checked, "fix: keep  \n", success=False)
        assert result["error"] == "commit_verification_failed"
        assert result["operationMayHaveSucceeded"] is True
        observed = result["observed"]
        assert observed["head"] == self.git("rev-parse", "HEAD").strip().decode()
        assert observed["branch"] == "main"
        assert observed["branchRef"] == observed["head"]
        assert observed["parents"] == [checked["snapshot"]["head"]]
        if mutation == "tree":
            assert observed["tree"] != checked["snapshot"]["tree"]
        else:
            assert (
                observed["messageSha256"]
                != hashlib.sha256(b"fix: keep  \n").hexdigest()
            )
        assert self.git("rev-list", "--count", "HEAD").strip() == b"2"
        assert "HOOK_SECRET" not in json.dumps(result)
        assert (self.root / "scan.count").read_text() == "scan\n"

    @pytest.mark.parametrize(
        "mutation", ["branch", "detached", "index", "parent-zero", "parent-two"]
    )
    def test_post_commit_branch_index_or_parent_changes_are_not_success(self, mutation):
        parent = self.initial_commit()
        self.stage("approved")
        checked = self.check()
        if mutation == "branch":
            source = "subprocess.run(['git', 'branch', 'other', 'HEAD'], check=True)\nsubprocess.run(['git', 'symbolic-ref', 'HEAD', 'refs/heads/other'], check=True)\n"
        elif mutation == "detached":
            source = "head = subprocess.check_output(['git', 'rev-parse', 'HEAD']).strip().decode()\nsubprocess.run(['git', 'update-ref', '--no-deref', 'HEAD', head], check=True)\n"
        elif mutation == "index":
            source = "pathlib.Path('tracked.txt').write_text('remaining staged change')\nsubprocess.run(['git', 'add', '--', 'tracked.txt'], check=True)\n"
        else:
            parents = [] if mutation == "parent-zero" else ["-p", parent, "-p", "HEAD"]
            source = f"sha = subprocess.check_output(['git', 'commit-tree', {checked['snapshot']['tree']!r}, *{parents!r}], input=b'docs: test\\n').strip()\nsubprocess.run(['git', 'update-ref', 'HEAD', sha], check=True)\n"
        hook = self.repo / ".git" / "hooks" / "post-commit"
        hook.write_text(f"#!{sys.executable}\nimport pathlib, subprocess\n" + source)
        hook.chmod(0o700)
        result = self.commit(checked, success=False)
        assert result["error"] == "commit_verification_failed"
        assert result["operationMayHaveSucceeded"] is True
        observed = result["observed"]
        assert observed["head"] == self.git("rev-parse", "HEAD").strip().decode()
        if mutation == "branch":
            assert observed["branch"] == "other"
            assert observed["branchRef"] == observed["head"]
        elif mutation == "detached":
            assert observed["branch"] is None
        elif mutation == "index":
            assert observed["indexTree"] != checked["snapshot"]["tree"]
            assert self.git("diff", "--cached", "--name-only").strip() == b"tracked.txt"
        else:
            assert observed["parents"] != [parent]
        assert self.git("reflog", "--format=%gs").count(b"commit: docs: test") == 1

    def test_commit_hook_cannot_change_other_refs(self):
        parent = self.initial_commit()
        self.stage()
        checked = self.script("staged-commit.py", "check", "--branch", "planned")
        hook = self.repo / ".git" / "hooks" / "post-commit"
        hook.write_text(
            f"#!{sys.executable}\nimport subprocess\nsubprocess.run(['git', 'update-ref', 'refs/heads/main', 'HEAD'], check=True)\n"
        )
        hook.chmod(0o700)
        result = self.commit(checked, success=False)
        assert result["error"] == "commit_verification_failed"
        assert result["observed"]["branch"] == "planned"
        assert result["observed"]["refs"]["refs/heads/main"] != parent
        assert self.git("rev-list", "--count", "HEAD").strip() == b"2"

    @pytest.mark.parametrize(
        "mutation", ["branch", "index", "ref", "unicode-ref", "failure"]
    )
    def test_branch_creation_hook_changes_stop_before_commit_without_rollback(
        self, mutation
    ):
        parent = self.initial_commit()
        self.stage("approved")
        checked = self.script("staged-commit.py", "check", "--branch", "planned")
        sources = {
            "branch": "subprocess.run(['git', 'symbolic-ref', 'HEAD', 'refs/heads/main'], check=True)\n",
            "index": "pathlib.Path('tracked.txt').write_text('changed')\nsubprocess.run(['git', 'add', '--', 'tracked.txt'], check=True)\n",
            "ref": "subprocess.run(['git', 'tag', 'unexpected', 'HEAD'], check=True)\n",
            "unicode-ref": "subprocess.run(['git', 'tag', 'x\\u2028y', 'HEAD'], check=True)\n",
            "failure": "sys.exit(1)\n",
        }
        hook = self.repo / ".git" / "hooks" / "post-checkout"
        hook.write_text(
            f"#!{sys.executable}\nimport pathlib, subprocess, sys\n" + sources[mutation]
        )
        hook.chmod(0o700)
        result = self.commit(checked, success=False)
        assert result["error"] in ("state_changed_before_commit", "git_branch_failed")
        assert result["branchMayHaveChanged"] is True
        assert result["observed"]["head"] == parent
        if mutation == "unicode-ref":
            assert result["error"] == "state_changed_before_commit"
            assert result["observed"]["branch"] == "planned"
            assert result["observed"]["refs"]["refs/tags/x\u2028y"] == parent
        assert self.git("rev-parse", "planned").strip().decode() == parent
        assert self.git("rev-list", "--count", "--all").strip() == b"1"
        assert (self.root / "scan.count").read_text() == "scan\n"

    def test_non_utf8_refs_after_branch_creation_report_observed_state_and_stop(self):
        parent = self.initial_commit()
        self.stage()
        checked = self.script("staged-commit.py", "check", "--branch", "planned")
        marker = self.root / "branch-created"
        hook = self.repo / ".git" / "hooks" / "post-checkout"
        hook.write_text(
            f"#!{sys.executable}\nimport pathlib\npathlib.Path({str(marker)!r}).touch()\n"
        )
        hook.chmod(0o700)
        git = self.bin / "git"
        git.unlink()
        git.write_text(
            f"#!{sys.executable}\nimport os, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            f"if args[:1] == ['for-each-ref'] and pathlib.Path({str(marker)!r}).exists():\n"
            "    sys.stdout.buffer.write(b'\\xff')\n    sys.exit(0)\n"
            f"os.execv({self.git_executable!r}, [{self.git_executable!r}, *args])\n"
        )
        git.chmod(0o700)
        result = self.commit(checked, success=False)
        assert result["error"] == "state_changed_before_commit"
        assert result["branchMayHaveChanged"] is True
        assert result["observed"]["branch"] == "planned"
        assert result["observed"]["head"] == parent
        assert result["observed"]["observationError"] == "UnicodeDecodeError"
        assert self.git("rev-parse", "refs/heads/planned").strip().decode() == parent
        assert self.git("rev-list", "--count", "--all").strip() == b"1"
        assert self.script("git-status.py")["changes"][0]["staged"]
        assert (self.root / "scan.count").read_text() == "scan\n"

    @pytest.mark.parametrize("branch", [None, "planned"])
    def test_failed_commit_hook_is_not_retried_or_rolled_back(self, branch):
        self.stage()
        checked = (
            self.check()
            if branch is None
            else self.script("staged-commit.py", "check", "--branch", branch)
        )
        hook = self.repo / ".git" / "hooks" / "pre-commit"
        hook.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(1)\n")
        hook.chmod(0o700)
        result = self.commit(checked, success=False)
        assert result["error"] == "git_commit_failed"
        assert result["exitCode"] == 1
        assert result["operationMayHaveSucceeded"] is True
        assert result["observed"]["head"] is None
        assert result["observed"]["branch"] == (branch or "main")
        state = self.script("git-status.py")
        assert state["head"] is None
        assert state["changes"][0]["staged"]

    @pytest.mark.parametrize("failure", ["commit-exit", "observation"])
    def test_partial_success_or_unknown_state_reports_observed_sha_without_retry(
        self, failure
    ):
        parent = self.initial_commit()
        self.stage()
        checked = self.check()
        git = self.bin / "git"
        git.unlink()
        git.write_text(
            f"#!{sys.executable}\nimport os, subprocess, sys\n"
            "args = sys.argv[1:]\n"
            + (
                "if args[:1] == ['commit']:\n"
                f"    subprocess.run([{self.git_executable!r}, *args], input=sys.stdin.buffer.read(), check=True)\n"
                "    print('HOOK_SECRET', file=sys.stderr)\n    sys.exit(42)\n"
                if failure == "commit-exit"
                else "if args[:1] == ['cat-file']:\n    print('HOOK_SECRET', file=sys.stderr)\n    sys.exit(42)\n"
            )
            + f"os.execv({self.git_executable!r}, [{self.git_executable!r}, *args])\n"
        )
        git.chmod(0o700)
        result = self.commit(checked, success=False)
        assert result["error"] == (
            "git_commit_failed"
            if failure == "commit-exit"
            else "commit_verification_failed"
        )
        assert result["operationMayHaveSucceeded"] is True
        assert (
            result["observed"]["head"] == self.git("rev-parse", "HEAD").strip().decode()
        )
        assert result["observed"]["head"] != parent
        if failure == "observation":
            assert result["observed"]["observationError"] == "CalledProcessError"
        assert self.git("rev-list", "--count", "HEAD").strip() == b"2"
        assert self.git("reflog", "--format=%gs").count(b"commit: docs: test") == 1
        assert "HOOK_SECRET" not in json.dumps(result)
