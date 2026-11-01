"""Real temporary Git remotes, with isolated gh/ssh fixtures and no network."""

import hashlib
import importlib.util
import json
import os
import shlex
import signal
import subprocess
import sys
from pathlib import Path
from typing import TypedDict

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class GitHubFixture(TypedDict):
    account: str
    prs: list[dict[str, object]]
    metadata: dict[str, object]


class RemoteTools:
    def setup_tools(self, tmp_path: Path, git_executable: str, env: dict[str, str]):
        self.root = tmp_path
        self.repo = tmp_path / "repo"
        self.remote = tmp_path / "remote.git"
        self.bin = tmp_path / "bin"
        self.git_executable = git_executable
        self.env = env
        self.env.update(
            {
                "REAL_GIT": git_executable,
                "GIT_PUSH_LOG": str(self.root / "push.log"),
                "REMOTE_PATH": str(self.remote),
                "GH_LOG": str(self.root / "gh.log"),
                "GH_STATE": str(self.root / "gh.json"),
                "GH_CONFIG_DIR": str(self.root / "gh-config"),
            }
        )
        source = (Path(__file__).parent / "fixtures" / "remote_tools.py").read_text()
        self.git_fallback = tmp_path / "python" / "git"
        self.git_fallback.parent.mkdir()
        for executable in (self.git_fallback, self.bin / "gh", self.bin / "ssh"):
            executable.write_text(f"#!{sys.executable}\n" + source)
            executable.chmod(0o700)
        wrapper = self.bin / "git"
        wrapper.write_text(
            "#!/bin/sh\n"
            "for arg do\n"
            '    case "$arg" in\n'
            "        push|git@github-work:owner/repo.git)\n"
            f'            exec {shlex.quote(sys.executable)} {shlex.quote(str(self.git_fallback))} "$@";;\n'
            "    esac\n"
            "done\n"
            'exec "$REAL_GIT" "$@"\n'
        )
        wrapper.chmod(0o700)
        self.gh_state: GitHubFixture = {
            "account": "tester",
            "prs": [],
            "metadata": {
                "nameWithOwner": "owner/repo",
                "url": "https://github.com/owner/repo",
                "defaultBranchRef": {"name": "main"},
                "viewerPermission": "WRITE",
                "pullRequestTemplates": [],
            },
        }
        self.save_gh()

    def git(self, *args):
        return subprocess.run(
            [self.git_executable, *args],
            cwd=self.repo,
            env=self.env,
            check=True,
            capture_output=True,
        ).stdout

    def remote_git(self, *args):
        return self.git("-C", str(self.remote), *args)

    def add_commit(self, path, content):
        (self.repo / path).write_text(content)
        self.git("add", "--", path)
        self.git("commit", "-m", content)

    def script(self, name, *args, request=None, success=True, cwd=None):
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPTS / name), *args],
            cwd=cwd or self.repo,
            env=self.env,
            capture_output=True,
            timeout=30,
            input=json.dumps(request).encode() if request is not None else None,
        )
        assert (result.returncode == 0) is success, result.stdout + result.stderr
        assert b"Traceback" not in result.stderr
        assert b"SECRET" not in result.stdout + result.stderr
        return json.loads(result.stdout)

    def push_check(self, *args, **kwargs):
        return self.script(
            "guarded-push.py", "check", "--remote", "origin", *args, **kwargs
        )

    def push(self, checked, **kwargs):
        return self.script(
            "guarded-push.py", "push", request={"check": checked}, **kwargs
        )

    def prepare_pr(self):
        self.git("remote", "set-url", "origin", str(self.remote))
        self.git("push", "origin", "feature")
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")

    def pr_check(self, *args, **kwargs):
        return self.script(
            "github-pr.py",
            "check",
            "--remote",
            "origin",
            "--repo",
            "owner/repo",
            *args,
            **kwargs,
        )

    def create(self, checked, **kwargs):
        request = {
            "check": checked,
            "title": "feat: 'quoted' $(touch unwanted)",
            "body": "## Why\n\nKeep `code`, $HOME and 'quotes'.\n\nCloses #1\n",
            "draft": False,
        }
        request.update(kwargs.pop("fields", {}))
        return self.script("github-pr.py", "create", request=request, **kwargs)

    def save_gh(self):
        Path(self.env["GH_STATE"]).write_text(json.dumps(self.gh_state))

    def gh_calls(self, operation):
        path = Path(self.env["GH_LOG"])
        calls = (
            [json.loads(line) for line in path.read_text().splitlines()]
            if path.exists()
            else []
        )
        return [args for args in calls if args[:2] == operation.split()]

    def commit_check(self, *args):
        (self.repo / "pending.txt").write_text("pending")
        self.git("add", "pending.txt")
        return self.script("staged-commit.py", "check", *args)

    def push_prepare(self, checked, *args, **kwargs):
        return self.script(
            "guarded-push.py",
            "prepare",
            "--remote",
            "origin",
            *args,
            request={"commitCheck": checked},
            **kwargs,
        )

    def commit_checked(self, checked):
        return self.script(
            "staged-commit.py",
            "commit",
            request={"check": checked, "message": "feat: pending"},
        )

    def prepared_push_check(self, preparation, commit, **kwargs):
        return self.script(
            "guarded-push.py",
            "check",
            "--prepared",
            request={"preparation": preparation, "commit": commit},
            **kwargs,
        )

    def push_calls(self):
        path = Path(self.env["GIT_PUSH_LOG"])
        return path.read_text().splitlines() if path.exists() else []

    def existing_push_prepare(self, *args, **kwargs):
        return self.script(
            "guarded-push.py",
            "prepare",
            "--existing-head",
            "--remote",
            "origin",
            *args,
            request={},
            **kwargs,
        )

    def existing_push_check(self, preparation, **kwargs):
        return self.script(
            "guarded-push.py",
            "check",
            "--prepared",
            request={"preparation": preparation},
            **kwargs,
        )

    def existing_pr_prepare(self, pushed, **kwargs):
        return self.script(
            "github-pr.py",
            "prepare",
            "--existing-head",
            "--remote",
            "origin",
            "--repo",
            "owner/repo",
            request={"pushPreparation": pushed},
            **kwargs,
        )

    def existing_pr_verify(self, preparation, *, after_push=False, **kwargs):
        args = ("check", "--prepared") if after_push else ("verify",)
        return self.script(
            "github-pr.py", *args, request={"preparation": preparation}, **kwargs
        )

    def future_pr(self, *branch_args, push_args=()):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check(*branch_args)
        pushed = self.push_prepare(checked, *push_args)
        preparation = self.pr_prepare(checked, pushed)
        return checked, pushed, preparation

    def pr_prepare(self, checked, pushed, *args, **kwargs):
        return self.script(
            "github-pr.py",
            "prepare",
            "--remote",
            "origin",
            "--repo",
            "owner/repo",
            *args,
            request={"commitCheck": checked, "pushPreparation": pushed},
            **kwargs,
        )

    def prepared_pr(self, operation, preparation, commit, **kwargs):
        args = ("check", "--prepared") if operation == "check" else (operation,)
        return self.script(
            "github-pr.py",
            *args,
            request={"preparation": preparation, "commit": commit},
            **kwargs,
        )


class TestRemoteScripts(RemoteTools):
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path, git_executable: str, git_env: dict[str, str]):
        self.setup_tools(tmp_path, git_executable, git_env)
        self.add_commit("base.txt", "base")
        self.base = self.git("rev-parse", "HEAD").decode().strip()
        self.git("init", "--bare", "-b", "main", str(self.remote))
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "origin", "main")
        self.git("switch", "-c", "feature")
        self.add_commit("first.txt", "first")
        self.head = self.git("rev-parse", "HEAD").decode().strip()

    @pytest.fixture
    def full_history(self, setup):
        self.add_commit("second.txt", "second")
        self.head = self.git("rev-parse", "HEAD").decode().strip()

    def change_existing_state(self, change):
        if change == "index":
            (self.repo / "first.txt").write_text("unexpected")
            self.git("add", "first.txt")
        elif change == "mode":
            self.git("update-index", "--chmod=+x", "first.txt")
        elif change == "upstream":
            self.git("config", "branch.feature.remote", "other")
        elif change == "url":
            self.git("config", "remote.origin.pushurl", str(self.remote) + "/")
        elif change == "target":
            self.remote_git("update-ref", "refs/heads/feature", self.base)
        elif change == "default":
            self.remote_git("fetch", str(self.repo), "feature:main")
        elif change == "fetch":
            self.git("config", "remote.origin.fetch", "+refs/heads/*:refs/custom/*")
        else:
            self.change_prepared_local_state(change)

    def change_prepared_local_state(self, change):
        if change == "head":
            self.git("commit", "--allow-empty", "-m", "unexpected")
        elif change == "branch":
            self.git("switch", "-c", "unexpected")
        elif change == "index":
            (self.repo / "pending.txt").write_text("changed")
            self.git("add", "pending.txt")
        elif change == "mode":
            self.git("update-index", "--chmod=+x", "pending.txt")
        elif change == "refs":
            self.git("tag", "unexpected")

    def test_git_wrapper_alias_and_origin_push_update_bare_remote_and_record_once(self):
        wrapper = str(self.bin / "git")
        alias = "git@github-work:owner/repo.git"
        self.git("remote", "set-url", "origin", alias)
        result = subprocess.run(
            [wrapper, "ls-remote", alias, "refs/heads/main"],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            check=True,
        )
        assert result.stdout == f"{self.base}\trefs/heads/main\n".encode()
        assert self.push_calls() == []
        for destination, target in (
            (alias, "alias-pushed"),
            ("origin", "origin-pushed"),
        ):
            args = ["push", destination, f"{self.head}:refs/heads/{target}"]
            subprocess.run(
                [wrapper, *args],
                cwd=self.repo,
                env=self.env,
                capture_output=True,
                check=True,
            )
            assert self.remote_git("rev-parse", target).decode().strip() == self.head
            assert json.loads(self.push_calls()[-1]) == args
        before = self.remote_git("show-ref")
        args = ["push", "origin", "missing-source:refs/heads/rejected"]
        result = subprocess.run(
            [wrapper, *args], cwd=self.repo, env=self.env, capture_output=True
        )
        assert result.returncode != 0 and result.stderr
        assert self.remote_git("show-ref") == before
        assert [json.loads(line) for line in self.push_calls()] == [
            ["push", alias, f"{self.head}:refs/heads/alias-pushed"],
            ["push", "origin", f"{self.head}:refs/heads/origin-pushed"],
            args,
        ]

    def test_existing_head_main_branch_verify_push_pr_and_repeated_invocation(
        self, full_history
    ):
        self.git("branch", "-f", "main", self.head)
        self.git("switch", "main")
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        refs = self.git("show-ref")
        pushed = self.existing_push_prepare("--branch", "planned", "--set-upstream")
        prepared = self.existing_pr_prepare(pushed)
        assert prepared["kind"] == "pr-existing-head-preparation"
        assert "snapshot" not in prepared
        assert "first.txt" in prepared["diff"] and "second.txt" in prepared["diff"]
        assert self.git("show-ref") == refs
        assert self.push_calls() == [] and self.gh_calls("pr create") == []
        result = self.script(
            "guarded-push.py", "branch", request={"preparation": pushed}
        )
        assert result["sourceBranch"] == "main" and result["sourceHead"] == self.head
        assert self.git("rev-parse", "main").decode().strip() == self.head
        assert self.git("branch", "--show-current").strip() == b"planned"
        self.existing_pr_verify(prepared)
        self.push(self.existing_push_check(pushed))
        executable = self.existing_pr_verify(prepared, after_push=True)
        assert self.create(executable)["status"] == "created"
        assert self.git("rev-list", "--count", "HEAD").strip() == b"3"
        # A later call uses fresh ordinary pushed-HEAD checks, never an old approval.
        assert self.push(self.push_check())["status"] == "already_pushed"
        assert self.create(self.pr_check())["status"] == "existing"
        assert len(self.push_calls()) == 1 and len(self.gh_calls("pr create")) == 1

    @pytest.mark.parametrize("change", ["index", "mode"])
    def test_existing_head_push_check_rejects_preparation_drift(
        self, full_history, change
    ):
        prepared = self.existing_push_prepare()
        self.change_existing_state(change)
        self.existing_push_check(prepared, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("change", ["refs"])
    def test_existing_head_push_rechecks_between_check_and_mutation(self, change):
        checked = self.existing_push_check(self.existing_push_prepare())
        self.change_existing_state(change)
        self.push(checked, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("change", ["upstream"])
    def test_existing_head_branch_hook_drift_reports_partial_success_without_push(
        self, change
    ):
        prepared = self.existing_push_prepare("--branch", "planned")
        commands = {
            "index": "git update-index --chmod=+x first.txt",
            "refs": "git tag unexpected",
            "head": "git commit --allow-empty -m unexpected",
            "branch": "git symbolic-ref HEAD refs/heads/feature",
            "upstream": "git config branch.feature.remote unexpected",
        }
        hook = self.repo / ".git" / "hooks" / "post-checkout"
        hook.write_text("#!/bin/sh\n" + commands[change] + "\n")
        hook.chmod(0o700)
        result = self.script(
            "guarded-push.py",
            "branch",
            request={"preparation": prepared},
            success=False,
        )
        assert result["branchMayHaveChanged"] is True
        assert result["observed"]["head"]
        self.existing_push_check(prepared, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("change,after_push", [("template", False)])
    def test_existing_head_pr_verification_rejects_drift_without_later_mutation(
        self, change, after_push
    ):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        if change == "base":
            self.remote_git("update-ref", "refs/heads/release", self.base)
        pushed = self.existing_push_prepare()
        args = ["--base", "release"] if change == "base" else []
        prepared = self.script(
            "github-pr.py",
            "prepare",
            "--existing-head",
            "--remote",
            "origin",
            "--repo",
            "owner/repo",
            *args,
            request={"pushPreparation": pushed},
        )
        if after_push:
            self.push(self.existing_push_check(pushed))
        calls = self.push_calls()
        if change == "base":
            self.remote_git("fetch", str(self.repo), "feature:release")
        elif change == "account":
            self.gh_state["account"] = "other"
            self.save_gh()
        elif change == "permission":
            self.gh_state["metadata"]["viewerPermission"] = "READ"
            self.save_gh()
        elif change == "template":
            self.gh_state["metadata"]["pullRequestTemplates"] = [
                {"filename": "new.md", "body": "unexpected"}
            ]
            self.save_gh()
        else:
            self.change_existing_state(change)
        self.existing_pr_verify(prepared, after_push=after_push, success=False)
        assert self.push_calls() == calls and self.gh_calls("pr create") == []

    @pytest.mark.parametrize("change", ["refs"])
    def test_existing_head_create_rechecks_index_and_observes_postcreate_ref_drift(
        self, change
    ):
        self.prepare_pr()
        prepared = self.existing_pr_prepare(self.existing_push_prepare())
        checked = self.existing_pr_verify(prepared, after_push=True)
        self.change_existing_state("index")
        self.create(checked, success=False)
        assert self.gh_calls("pr create") == []
        self.git("read-tree", "HEAD")
        source = prepared["pushPreparation"]["source"]
        assert self.git("write-tree").decode().strip() == source["tree"]
        assert (
            hashlib.sha256(self.git("ls-files", "--stage", "-z")).hexdigest()
            == source["indexSha256"]
        )
        self.env["GH_MODE"] = "create-change-" + change
        result = self.create(checked, success=False)
        assert result["error"] == "pr_verification_failed"
        assert result["operationMayHaveSucceeded"] is True
        assert result["url"] == "https://github.com/owner/repo/pull/1"
        assert result["observedPullRequests"] == [
            {"number": 1, "url": result["url"], "state": "OPEN"}
        ]
        assert len(self.gh_calls("pr create")) == 1

    @pytest.mark.parametrize("change", ["head"])
    def test_existing_head_push_hook_change_stops_before_pr(self, change):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        pushed = self.existing_push_prepare()
        prepared = self.existing_pr_prepare(pushed)
        hook = self.repo / ".git" / "hooks" / "pre-push"
        command = {
            "index": "git update-index --chmod=+x first.txt",
            "refs": "git tag unexpected",
            "head": "git commit --allow-empty -m unexpected",
        }[change]
        hook.write_text("#!/bin/sh\n" + command + "\n")
        hook.chmod(0o700)
        result = self.push(self.existing_push_check(pushed), success=False)
        assert result["remoteMayHaveChanged"] is True
        self.existing_pr_verify(prepared, after_push=True, success=False)
        assert len(self.push_calls()) == 1 and self.gh_calls("pr create") == []
        assert self.remote_git("rev-parse", "feature").decode().strip() == self.head

    def test_existing_head_push_hook_drift_stops_before_upstream_update(self):
        prepared = self.existing_push_prepare("--set-upstream")
        hook = self.repo / ".git" / "hooks" / "pre-push"
        hook.write_text("#!/bin/sh\ngit update-index --chmod=+x first.txt\n")
        hook.chmod(0o700)
        result = self.push(self.existing_push_check(prepared), success=False)
        assert result["remoteMayHaveChanged"] is True
        upstream = subprocess.run(
            [self.git_executable, "config", "--get-regexp", r"^branch\.feature\."],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        assert upstream.returncode == 1 and upstream.stdout == b""

    def test_existing_head_branch_collision_and_failure_never_push(self):
        prepared = self.existing_push_prepare("--branch", "planned")
        self.git("branch", "planned")
        self.script(
            "guarded-push.py",
            "branch",
            request={"preparation": prepared},
            success=False,
        )
        assert self.git("branch", "--show-current").strip() == b"feature"
        self.git("branch", "-D", "planned")
        hook = self.repo / ".git" / "hooks" / "post-checkout"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o700)
        result = self.script(
            "guarded-push.py",
            "branch",
            request={"preparation": prepared},
            success=False,
        )
        assert (
            result["branchMayHaveChanged"] is True
            and result["observed"]["head"] == self.head
        )
        assert self.push_calls() == []

    def test_existing_head_prepare_requires_head_and_clean_index(self):
        (self.repo / "first.txt").write_text("unstaged stays out of transmission")
        prepared = self.existing_push_prepare()
        assert prepared["source"]["head"] == self.head
        self.git("add", "first.txt")
        self.existing_push_prepare(success=False)
        self.repo = self.root / "unborn"
        self.repo.mkdir()
        self.git("init", "-b", "feature")
        assert self.existing_push_prepare(success=False)["error"] == "unborn_head"
        assert self.push_calls() == []

    def test_existing_head_pr_requires_planned_branch_target_head_alignment(self):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        pushed = self.existing_push_prepare("--target", "published")
        assert (
            self.existing_pr_prepare(pushed, success=False)["error"]
            == "pr_push_destination_mismatch"
        )
        assert self.push_calls() == [] and self.gh_calls("pr create") == []

    @pytest.mark.parametrize("change", ["mode"])
    def test_push_prepare_rejects_stale_commit_check_without_push(self, change):
        checked = self.commit_check()
        self.change_prepared_local_state(change)
        self.push_prepare(checked, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("change", ["index"])
    def test_prepared_push_check_rejects_state_drift_without_push(self, change):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        if change == "url":
            self.git("config", "remote.origin.pushurl", str(self.remote) + "/")
        elif change == "target":
            self.remote_git("update-ref", "refs/heads/feature", self.base)
        elif change == "default":
            self.remote_git("fetch", str(self.repo), "feature:main")
        elif change == "upstream":
            self.git("config", "branch.feature.remote", "other")
        else:
            self.change_prepared_local_state(change)
        self.prepared_push_check(preparation, commit, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize(
        "field,value",
        [
            ("tree", "0000000000000000000000000000000000000000"),
            (
                "messageSha256",
                "0000000000000000000000000000000000000000000000000000000000000000",
            ),
        ],
    )
    def test_prepared_push_check_binds_result_to_real_tree_and_message(
        self, field, value
    ):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        if field == "gitleaks":
            value = "unavailable" if commit[field] == "passed" else "passed"
        commit[field] = value
        assert (
            self.prepared_push_check(preparation, commit, success=False)["error"]
            == "prepared_commit_changed"
        )
        assert self.push_calls() == []

    def test_push_prepare_revalidates_commit_check_after_remote_material_collection(
        self,
    ):
        checked = self.commit_check()
        wrapper = self.bin / "git"
        wrapper.write_text(self.git_fallback.read_text())
        source = wrapper.read_text()
        assert source.count('if tool == "git":') == 1
        assert self.git("ls-files", "--stage", "pending.txt").startswith(b"100644 ")
        counter = self.root / "ls-remote-count"
        wrapper.write_text(
            source.replace(
                'if tool == "git":',
                'if tool == "git":\n'
                '    if "ls-remote" in args:\n'
                f"        counter = Path({str(counter)!r})\n"
                "        count = int(counter.read_text()) + 1 if counter.exists() else 1\n"
                "        counter.write_text(str(count))\n"
                "        if count == 2:\n"
                '            subprocess.run([real_git, "update-index", "--chmod=+x", "pending.txt"], check=True)\n',
            )
        )
        assert (
            self.push_prepare(checked, success=False)["error"] == "commit_check_changed"
        )
        assert counter.read_text() == "2"
        assert self.git("ls-files", "--stage", "pending.txt").startswith(b"100755 ")
        assert self.push_calls() == []

    @pytest.mark.parametrize("parents", [["base"]])
    def test_prepared_push_check_rejects_wrong_actual_parent_even_with_matching_result(
        self, parents
    ):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        actual_parents = [
            self.base if parent == "base" else commit["commit"] for parent in parents
        ]
        args = ["commit-tree", commit["tree"], "-m", "forged"]
        for parent in actual_parents:
            args.extend(["-p", parent])
        forged = self.git(*args).decode().strip()
        self.git("update-ref", "refs/heads/feature", forged)
        commit.update(
            commit=forged,
            parents=actual_parents,
            messageSha256=hashlib.sha256(b"forged\n").hexdigest(),
        )
        assert (
            self.prepared_push_check(preparation, commit, success=False)["error"]
            == "prepared_commit_changed"
        )
        assert self.push_calls() == []

    def test_push_prepare_and_check_preserve_gitleaks_link_without_rescanning(self):
        scanner = self.bin / "gitleaks"
        log = self.root / "gitleaks.log"
        scanner.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\nimport sys\n"
            f"with Path({str(log)!r}).open('a') as log: log.write('call\\n')\n"
            "print('stdin --redact' if '--help' in sys.argv else '[]')\n"
        )
        scanner.chmod(0o700)
        checked = self.commit_check()
        assert checked["gitleaks"] == "passed"
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        self.prepared_push_check(preparation, commit)
        assert log.read_text() == "call\ncall\n"
        assert self.push_calls() == []

    @pytest.mark.parametrize("planned", [True])
    def test_push_prepare_retains_effective_upstream_and_rejects_conflicts(
        self, planned
    ):
        branch = "planned" if planned else "feature"
        self.git("config", f"branch.{branch}.remote", "other")
        self.git("config", f"branch.{branch}.merge", "refs/heads/other")
        checked = self.commit_check(*(["--branch", branch] if planned else []))
        assert (
            self.push_prepare(checked, "--set-upstream", success=False)["error"]
            == "conflicting_upstream"
        )
        self.git("config", f"branch.{branch}.remote", "origin")
        self.git("config", f"branch.{branch}.merge", "refs/heads/feature")
        preparation = self.push_prepare(
            checked, "--target", "feature", "--set-upstream"
        )
        assert preparation["destination"]["upstream"] == {
            "remote": "origin",
            "merge": "refs/heads/feature",
        }
        commit = self.commit_checked(checked)
        self.prepared_push_check(preparation, commit)
        assert self.push_calls() == []

    @pytest.mark.parametrize("planned", [True])
    def test_prepared_push_preserves_different_upstream_when_not_setting_it(
        self, planned
    ):
        branch = "planned" if planned else "feature"
        self.git("config", f"branch.{branch}.remote", "other")
        self.git("config", f"branch.{branch}.merge", "refs/heads/other")
        checked = self.commit_check(*(["--branch", branch] if planned else []))
        preparation = self.push_prepare(checked, "--target", "published")
        assert preparation["destination"]["setUpstream"] is False
        commit = self.commit_checked(checked)
        executable = self.prepared_push_check(preparation, commit)
        result = self.push(executable)
        assert result["status"] == "pushed"
        assert result["upstreamConfigured"] is False
        assert self.git("config", f"branch.{branch}.remote").strip() == b"other"
        assert (
            self.git("config", f"branch.{branch}.merge").strip() == b"refs/heads/other"
        )
        assert (
            self.remote_git("rev-parse", "published").decode().strip()
            == commit["commit"]
        )
        assert len(self.push_calls()) == 1

    def test_prepared_push_rejects_original_branch_upstream_drift(self):
        checked = self.commit_check("--branch", "planned")
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        self.git("config", "branch.feature.remote", "unexpected")
        assert (
            self.prepared_push_check(preparation, commit, success=False)["error"]
            == "push_preparation_changed"
        )
        assert self.push_calls() == []

    def test_prepared_push_supports_initial_local_main_commit_only_on_empty_remote(
        self,
    ):
        self.repo = self.root / "unborn"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("remote", "add", "origin", str(self.remote))
        checked = self.commit_check()
        assert checked["snapshot"]["head"] is None
        assert (
            self.push_prepare(checked, "--target", "feature", success=False)["error"]
            == "missing_local_commit"
        )
        self.remote_git("update-ref", "-d", "refs/heads/main")
        assert (
            self.push_prepare(checked, success=False)["error"]
            == "protected_push_target"
        )
        preparation = self.push_prepare(checked, "--initial-main")
        assert preparation["commits"] == []
        assert preparation["destination"]["emptyRemote"] is True
        commit = self.commit_checked(checked)
        assert commit["parents"] == []
        executable = self.prepared_push_check(preparation, commit)
        assert self.push_calls() == []
        assert self.push(executable)["status"] == "pushed"
        assert self.remote_git("rev-parse", "main").decode().strip() == commit["commit"]

    @pytest.mark.parametrize("mapping", ["standard", "custom", "negative"])
    def test_prepared_push_updates_only_git_mapped_tracking_refs(self, mapping):
        if mapping == "custom":
            self.git(
                "config", "remote.origin.fetch", "+refs/heads/*:refs/custom/origin/*"
            )
        elif mapping == "negative":
            self.git("config", "--add", "remote.origin.fetch", "^refs/heads/feature")
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        self.push(self.prepared_push_check(preparation, commit))
        tracking = (
            "refs/custom/origin/feature"
            if mapping == "custom"
            else "refs/remotes/origin/feature"
        )
        # Git push updates tracking refs even when a negative fetch mapping excludes it.
        assert self.git("rev-parse", tracking).decode().strip() == commit["commit"]
        assert (
            self.git("rev-parse", "refs/remotes/origin/main").decode().strip()
            == self.base
        )
        assert len(self.push_calls()) == 1

    def test_prepared_push_check_revalidates_source_upstream_after_material_collection(
        self,
    ):
        checked = self.commit_check("--branch", "planned")
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        wrapper = self.bin / "git"
        wrapper.write_text(self.git_fallback.read_text())
        source = wrapper.read_text()
        assert source.count('if tool == "git":') == 1
        assert b"branch.feature.remote=" not in self.git("config", "--list")
        counter = self.root / "ls-remote-count"
        wrapper.write_text(
            source.replace(
                'if tool == "git":',
                'if tool == "git":\n'
                '    if "ls-remote" in args:\n'
                f"        counter = Path({str(counter)!r})\n"
                "        count = int(counter.read_text()) + 1 if counter.exists() else 1\n"
                "        counter.write_text(str(count))\n"
                "        if count == 2:\n"
                '            subprocess.run([real_git, "config", "branch.feature.remote", "other"], check=True)\n',
            )
        )
        assert (
            self.prepared_push_check(preparation, commit, success=False)["error"]
            == "push_preparation_changed"
        )
        assert counter.read_text() == "2"
        assert self.git("config", "branch.feature.remote").strip() == b"other"
        assert self.push_calls() == []

    def test_push_exact_sha_and_optional_upstream(self, full_history):
        checked = self.push_check("--set-upstream")
        assert [x["message"].strip() for x in checked["commits"]] == ["first", "second"]
        result = self.push(checked)
        assert result["status"] == "pushed"
        assert self.remote_git("rev-parse", "feature").decode().strip() == self.head
        assert (
            self.git("rev-parse", "--abbrev-ref", "@{upstream}").strip()
            == b"origin/feature"
        )
        assert self.git("rev-parse", "@{upstream}").decode().strip() == self.head

    def test_already_pushed_is_noop_and_does_not_set_upstream_by_default(self):
        self.git("push", "origin", "feature")
        checked = self.push_check()
        assert checked["alreadyPushed"]
        assert self.push(checked)["status"] == "already_pushed"
        assert checked["snapshot"]["upstream"]["remote"] is None

    @pytest.mark.parametrize("change", ["branch"])
    def test_push_rejects_changed_head_branch_url_and_upstream(self, change):
        checked = self.push_check()
        changes = {
            "head": lambda: self.git("commit", "--allow-empty", "-m", "extra"),
            "branch": lambda: self.git("switch", "-c", "other"),
            "url": lambda: self.git(
                "config", "remote.origin.pushurl", str(self.remote) + "/"
            ),
            "upstream": lambda: self.git("config", "branch.feature.remote", "other"),
        }
        changes[change]()
        assert self.push(checked, success=False)["error"] == "state_changed_before_push"
        assert not self.remote_git("for-each-ref", "refs/heads/feature")

    def test_push_rejects_changed_remote_target_and_default(self):
        checked = self.push_check()
        self.remote_git("update-ref", "refs/heads/feature", self.base)
        assert self.push(checked, success=False)["error"] == "state_changed_before_push"
        self.remote_git("symbolic-ref", "HEAD", "refs/heads/feature")
        assert self.push(checked, success=False)["error"] == "protected_push_target"

    def test_main_default_and_multiple_push_destinations_are_rejected(self):
        assert (
            self.push_check("--target", "main", success=False)["error"]
            == "protected_push_target"
        )
        self.remote_git("symbolic-ref", "HEAD", "refs/heads/main")
        self.git("config", "--add", "remote.origin.pushurl", str(self.remote))
        self.git(
            "config", "--add", "remote.origin.pushurl", str(self.root / "second.git")
        )
        assert self.push_check(success=False)["error"] == "multiple_push_urls"

    def test_initial_main_rejects_tag_only_remote_and_unknown_default(self):
        self.git("switch", "main")
        self.remote_git("update-ref", "refs/tags/existing", self.base)
        self.remote_git("update-ref", "-d", "refs/heads/main")
        self.push_check("--initial-main", success=False)
        self.push_check(success=False)

    def test_push_rejects_non_fast_forward(self):
        self.git("switch", "-c", "divergent", self.base)
        self.add_commit("divergent.txt", "divergent")
        self.git("push", "origin", "divergent:feature")
        self.git("switch", "feature")
        assert self.push_check(success=False)["error"] == "non_fast_forward"

    def test_push_does_not_follow_tags_or_mirror_other_refs(self):
        self.git("tag", "-a", "-m", "unapproved", "unapproved")
        self.git("branch", "unapproved")
        self.git("config", "push.followTags", "true")
        self.git("config", "remote.origin.mirror", "true")
        self.git("config", "remote.origin.push", "+refs/heads/*:refs/heads/*")
        self.push(self.push_check())
        assert not self.remote_git("for-each-ref", "refs/tags", "refs/heads/unapproved")
        assert self.remote_git("rev-parse", "main").decode().strip() == self.base

    @pytest.mark.parametrize("prepared", [False])
    def test_push_failure_does_not_retry_or_recover(self, prepared):
        hook = self.remote / "hooks" / "pre-receive"
        log = self.root / "push-count"
        hook.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\nimport sys\n"
            f"with Path({str(log)!r}).open('a') as f: f.write('attempt\\n')\n"
            "print('SECRET_HOOK_ERROR', file=sys.stderr)\nsys.exit(1)\n"
        )
        hook.chmod(0o700)
        if prepared:
            checked = self.commit_check()
            preparation = self.push_prepare(checked)
            executable = self.prepared_push_check(
                preparation, self.commit_checked(checked)
            )
        else:
            executable = self.push_check()
        result = self.push(executable, success=False)
        assert len(self.push_calls()) == 1
        assert result["error"] == "push_failed"
        assert result["observedHead"] is None
        assert log.read_text() == "attempt\n"

    def test_pr_prepare_collects_future_whole_branch_without_mutation(
        self, full_history
    ):
        refs = self.git("show-ref")
        checked, pushed, preparation = self.future_pr("--branch", "planned")
        assert preparation["kind"] == "pr-preparation"
        assert "snapshot" not in preparation
        assert preparation["commitCheck"] == checked
        assert preparation["pushPreparation"] == pushed
        assert preparation["destination"]["branch"] == "planned"
        assert preparation["destination"]["head"] == self.head
        assert preparation["mergeBase"] == self.base
        assert [x["message"].strip() for x in preparation["commits"]] == [
            "first",
            "second",
        ]
        assert "first.txt" in preparation["diff"]
        assert "second.txt" in preparation["diff"]
        assert "pending.txt" in preparation["diff"]
        assert (
            preparation["diffSha256"]
            == hashlib.sha256(preparation["diff"].encode()).hexdigest()
        )
        assert [x["path"] for x in preparation["units"]] == [
            "first.txt",
            "pending.txt",
            "second.txt",
        ]
        assert preparation["diffSha256"] != checked["snapshot"]["diffSha256"]
        assert preparation["diff"].encode() == self.git(
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--no-color",
            "--no-renames",
            "--ignore-submodules=none",
            preparation["mergeBase"],
            checked["snapshot"]["tree"],
        )
        unit = preparation["units"][1]
        assert (
            self.git("diff", "--cached", "--raw", "-z", "--no-abbrev", "--no-renames")
            == (
                f":{unit['oldMode']} {unit['newMode']} {unit['oldOid']} {unit['newOid']} A\0"
                f"{unit['path']}\0"
            ).encode()
        )
        assert unit == {
            "path": "pending.txt",
            "oldMode": "000000",
            "newMode": "100644",
            "oldOid": "0" * len(self.head),
            "newOid": self.git("rev-parse", ":pending.txt").decode().strip(),
        }
        assert self.git("show-ref") == refs
        assert self.git("branch", "--show-current").strip() == b"feature"
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    def test_pr_verify_accepts_actual_commit_before_push_but_is_not_create_check(self):
        checked, _, preparation = self.future_pr("--branch", "planned")
        commit = self.commit_checked(checked)
        verified = self.prepared_pr("verify", preparation, commit)
        assert verified["kind"] == "pr-verification"
        assert verified["commit"] == commit["commit"]
        assert verified["diffSha256"] == preparation["diffSha256"]
        assert "snapshot" not in verified
        assert self.create(verified, success=False)["error"] == "invalid_pr_request"
        assert self.create(preparation, success=False)["error"] == "invalid_pr_request"
        assert self.push(preparation, success=False)["error"] == "invalid_push_request"
        assert self.push(verified, success=False)["error"] == "invalid_push_request"
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("mapping", ["standard"])
    def test_pr_prepared_check_accepts_only_planned_push_and_git_mapped_refs(
        self, full_history, mapping
    ):
        if mapping == "custom":
            self.git(
                "config", "remote.origin.fetch", "+refs/heads/*:refs/custom/origin/*"
            )
        elif mapping == "negative":
            self.git("config", "--add", "remote.origin.fetch", "^refs/heads/planned")
        checked, pushed, preparation = self.future_pr(
            "--branch", "planned", push_args=("--set-upstream",)
        )
        commit = self.commit_checked(checked)
        self.prepared_pr("check", preparation, commit, success=False)
        self.prepared_pr("verify", preparation, commit)
        self.push(self.prepared_push_check(pushed, commit))
        executable = self.prepared_pr("check", preparation, commit)
        assert executable["snapshot"]["head"] == commit["commit"]
        assert executable["snapshot"]["branch"] == "planned"
        assert "first.txt" in executable["diff"]
        assert len(executable["commits"]) == 3
        result = self.create(executable, fields={"draft": True})
        assert result["status"] == "created"
        assert result["draft"] is True
        assert len(self.push_calls()) == 1
        assert len(self.gh_calls("pr create")) == 1

    @pytest.mark.parametrize("exact_first", [False, True])
    def test_prepared_push_updates_only_first_matching_positive_fetch_mapping(
        self, exact_first
    ):
        mappings = [
            ("+refs/heads/*:refs/remotes/origin/*", "refs/remotes/origin/planned"),
            ("refs/heads/planned:refs/custom/exact", "refs/custom/exact"),
        ]
        if exact_first:
            mappings.reverse()
        self.git("config", "--unset-all", "remote.origin.fetch")
        for spec, ref in mappings:
            self.git("config", "--add", "remote.origin.fetch", spec)
            self.git("update-ref", ref, self.base)
        self.git("tag", "unrelated", self.base)
        checked = self.commit_check("--branch", "planned")
        pushed = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        self.push(self.prepared_push_check(pushed, commit))
        refs = dict(
            line.split(" ", 1)
            for line in self.git("for-each-ref", "--format=%(refname) %(objectname)")
            .decode()
            .splitlines()
        )
        assert refs == {
            **checked["snapshot"]["refs"],
            "refs/heads/planned": commit["commit"],
            mappings[0][1]: commit["commit"],
        }
        assert refs[mappings[1][1]] == self.base
        assert len(self.push_calls()) == 1
        assert self.gh_calls("pr create") == []

    def test_pr_verify_rejects_account_drift_before_any_push(self):
        checked, _, preparation = self.future_pr()
        commit = self.commit_checked(checked)
        self.gh_state["account"] = "other"
        self.save_gh()
        self.prepared_pr("verify", preparation, commit, success=False)
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("branch", ["feature", "planned"])
    def test_pr_prepared_check_rejects_source_and_planned_upstream_drift_after_push(
        self, branch
    ):
        checked, pushed, preparation = self.future_pr(
            "--branch", "planned", push_args=("--set-upstream",)
        )
        assert checked["snapshot"]["branch"] == "feature"
        commit = self.commit_checked(checked)
        assert self.push(self.prepared_push_check(pushed, commit))["status"] == "pushed"
        executable = self.prepared_pr("check", preparation, commit)
        assert executable["snapshot"]["branch"] == "planned"
        assert executable["snapshot"]["upstream"] == {
            "remote": "origin",
            "merge": "refs/heads/planned",
        }
        calls = self.push_calls()
        assert len(calls) == 1
        self.git("config", f"branch.{branch}.remote", "elsewhere")
        assert self.git("config", f"branch.{branch}.remote").strip() == b"elsewhere"
        assert (
            self.prepared_pr("check", preparation, commit, success=False)["error"]
            == "push_preparation_changed"
        )
        assert self.push_calls() == calls
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("operation", ["verify", "check"])
    def test_pr_prepared_commands_bind_retained_material_and_history(self, operation):
        checked, pushed, preparation = self.future_pr()
        commit = self.commit_checked(checked)
        if operation == "check":
            self.push(self.prepared_push_check(pushed, commit))
        self.prepared_pr(operation, preparation, commit)
        calls = self.push_calls()
        for field in ("diffSha256", "commitsSha256"):
            malformed = {**preparation, field: "0" * 64}
            assert (
                self.prepared_pr(operation, malformed, commit, success=False)["error"]
                == "pr_preparation_changed"
            )
        assert self.push_calls() == calls
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("mapping", ["custom"])
    def test_pr_prepared_check_rejects_wrong_mapped_sha_and_remote_base_drift(
        self, mapping
    ):
        if mapping == "custom":
            spec, ref = (
                "+refs/heads/*:refs/custom/origin/*",
                "refs/custom/origin/feature",
            )
        elif mapping == "exact":
            spec, ref = "refs/heads/feature:refs/custom/exact", "refs/custom/exact"
        else:
            spec, ref = (
                "+refs/heads/*:refs/remotes/origin/*",
                "refs/remotes/origin/feature",
            )
        self.git("config", "remote.origin.fetch", spec)
        if mapping == "negative":
            self.git("config", "--add", "remote.origin.fetch", "^refs/heads/feature")
        checked, pushed, preparation = self.future_pr()
        commit = self.commit_checked(checked)
        self.push(self.prepared_push_check(pushed, commit))
        self.prepared_pr("check", preparation, commit)
        self.git("update-ref", ref, self.base)
        self.prepared_pr("check", preparation, commit, success=False)
        assert len(self.push_calls()) == 1 and self.gh_calls("pr create") == []
        self.git("update-ref", ref, commit["commit"])
        assert self.git("rev-parse", ref).decode().strip() == commit["commit"]
        self.remote_git("update-ref", "refs/heads/main", commit["commit"])
        self.prepared_pr("check", preparation, commit, success=False)
        assert len(self.push_calls()) == 1 and self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        "spec",
        ["refs/heads/*:refs/custom/exact", "refs/heads/*:refs/custom/bad..ref/*"],
    )
    def test_pr_prepare_rejects_unsupported_fetch_mapping(self, spec):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check()
        pushed = self.push_prepare(checked)
        self.git("config", "--add", "remote.origin.fetch", spec)
        self.pr_prepare(checked, pushed, success=False)
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    def test_pr_future_existing_merged_duplicate_allows_empty_planned_diff(self):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        self.git("read-tree", self.base)
        checked = self.script("staged-commit.py", "check")
        pushed = self.push_prepare(checked)
        self.gh_state["prs"] = [
            {
                "number": 1,
                "url": "https://github.com/owner/repo/pull/1",
                "state": "MERGED",
                "isCrossRepository": False,
                "headRefName": "feature",
                "baseRefName": "main",
            }
        ]
        self.save_gh()
        preparation = self.pr_prepare(checked, pushed)
        assert preparation["diff"] is None
        assert preparation["diffSha256"] == hashlib.sha256(b"").hexdigest()
        assert preparation["units"] == []
        commit = self.commit_checked(checked)
        self.prepared_pr("verify", preparation, commit)
        assert self.gh_calls("pr create") == []

    def test_pr_prepare_rejects_complete_branch_diff_over_two_mib(self):
        (self.repo / "large.txt").write_text("x" * (2 * 1024 * 1024))
        self.git("add", "large.txt")
        self.git("commit", "-m", "large diff")
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check()
        pushed = self.push_prepare(checked)
        assert (
            self.pr_prepare(checked, pushed, success=False)["error"]
            == "pr_diff_too_large"
        )
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    def test_pr_prepare_rejects_history_over_two_mib_even_when_push_history_is_short(
        self,
    ):
        tree = self.git("rev-parse", "HEAD^{tree}").decode().strip()
        large = (
            subprocess.run(
                [self.git_executable, "commit-tree", tree, "-p", self.head],
                cwd=self.repo,
                env=self.env,
                input=b"x" * (2 * 1024 * 1024),
                capture_output=True,
                check=True,
            )
            .stdout.decode()
            .strip()
        )
        self.git("update-ref", "refs/heads/feature", large)
        self.git("push", "origin", "feature")
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check()
        pushed = self.push_prepare(checked)
        assert pushed["commits"] == []
        assert (
            self.pr_prepare(checked, pushed, success=False)["error"]
            == "commit_log_too_large"
        )
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    def test_pr_prepare_rejects_multiple_merge_bases_without_fetch(self):
        tree = self.git("rev-parse", "HEAD^{tree}").decode().strip()
        base_tree = self.git("rev-parse", self.base + "^{tree}").decode().strip()
        left = (
            self.git("commit-tree", base_tree, "-p", self.base, "-m", "left")
            .decode()
            .strip()
        )
        right = (
            self.git("commit-tree", base_tree, "-p", self.base, "-m", "right")
            .decode()
            .strip()
        )
        parent = (
            self.git("commit-tree", tree, "-p", left, "-p", right, "-m", "parent")
            .decode()
            .strip()
        )
        base = (
            self.git("commit-tree", base_tree, "-p", right, "-p", left, "-m", "base")
            .decode()
            .strip()
        )
        self.git("update-ref", "refs/heads/feature", parent)
        self.remote_git("fetch", str(self.repo), base + ":refs/heads/main")
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check()
        pushed = self.push_prepare(checked)
        assert (
            self.pr_prepare(checked, pushed, success=False)["error"]
            == "ambiguous_merge_base"
        )
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("object_name", ["blob"])
    def test_pr_prepare_rejects_missing_material_objects_without_fetch(
        self, object_name
    ):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check()
        pushed = self.push_prepare(checked)
        oid = (
            self.base
            if object_name == "base"
            else self.git("rev-parse", "HEAD:first.txt").decode().strip()
        )
        (self.repo / ".git" / "objects" / oid[:2] / oid[2:]).unlink()
        self.pr_prepare(checked, pushed, success=False)
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    def test_pr_create_roundtrips_exact_text_and_draft(self):
        self.prepare_pr()
        self.gh_state["metadata"]["pullRequestTemplates"] = [
            {"filename": "pr.md", "body": "## Why"}
        ]
        self.save_gh()
        checked = self.pr_check()
        assert checked["templates"] == self.gh_state["metadata"]["pullRequestTemplates"]
        fields = {
            "title": "feat: 日本語 'quoted' $(touch unwanted)",
            "body": "## 理由\n\nKeep `code`, $HOME and 'quotes'.\n\nCloses #1\n",
            "draft": True,
        }
        result = self.create(checked, fields=fields)
        assert result["status"] == "created"
        state = json.loads(Path(self.env["GH_STATE"]).read_text())
        assert state["prs"][0]["title"] == fields["title"]
        assert state["prs"][0]["isDraft"]
        assert state["prs"][0]["body"] == fields["body"]
        assert not (self.repo / "unwanted").exists()
        assert len(self.gh_calls("pr create")) == 1

    @pytest.mark.parametrize("state", ["CLOSED"])
    def test_pr_existing_open_closed_and_merged_are_not_duplicated(self, state):
        self.prepare_pr()
        checked = self.pr_check()
        self.create(checked)
        self.gh_state = json.loads(Path(self.env["GH_STATE"]).read_text())
        self.gh_state["prs"][0]["state"] = state
        self.save_gh()
        assert self.create(checked)["status"] == "existing"
        assert len(self.gh_calls("pr create")) == 1

    def test_pr_does_not_confuse_fork_with_same_head_name(self):
        self.prepare_pr()
        checked = self.pr_check()
        self.create(checked)
        self.gh_state = json.loads(Path(self.env["GH_STATE"]).read_text())
        self.gh_state["prs"][0]["isCrossRepository"] = True
        self.save_gh()
        assert self.create(checked)["status"] == "created"
        assert len(self.gh_calls("pr create")) == 2

    def test_pr_rejects_changed_local_head_remote_head_base_url_and_account(self):
        self.prepare_pr()
        checked = self.pr_check()
        self.add_commit("third.txt", "third")
        assert self.create(checked, success=False)["error"] == "head_not_pushed"
        self.git("update-ref", "refs/heads/feature", self.head)
        self.remote_git("update-ref", "refs/heads/feature", self.base)
        self.create(checked, success=False)
        self.remote_git("update-ref", "refs/heads/feature", self.head)
        self.remote_git("update-ref", "refs/heads/main", self.head)
        assert self.create(checked, success=False)["error"] == "state_changed_before_pr"
        self.remote_git("update-ref", "refs/heads/main", self.base)
        self.gh_state["account"] = "other-account"
        self.save_gh()
        assert self.create(checked, success=False)["error"] == "state_changed_before_pr"
        self.gh_state["account"] = "tester"
        self.save_gh()
        self.git("remote", "set-url", "origin", "https://github.com/other/repo.git")
        assert self.create(checked, success=False)["error"] == "github_remote_mismatch"
        assert self.gh_calls("pr create") == []

    def test_pr_rejects_template_change_after_approval(self):
        self.prepare_pr()
        checked = self.pr_check()
        self.gh_state["metadata"]["pullRequestTemplates"] = [
            {"filename": "pr.md", "body": "changed"}
        ]
        self.save_gh()
        assert self.create(checked, success=False)["error"] == "state_changed_before_pr"
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        "mode", ["auth-fail", "bad-json", "list-fail", "read-only"]
    )
    def test_pr_rejects_bad_auth_json_permission_and_duplicate_query_failure(
        self, mode
    ):
        self.prepare_pr()
        if mode == "read-only":
            self.gh_state["metadata"]["viewerPermission"] = "READ"
            self.save_gh()
            assert (
                self.pr_check(success=False)["error"]
                == "insufficient_repository_permission"
            )
        else:
            self.env["GH_MODE"] = mode
            self.pr_check(success=False)
        assert self.gh_calls("pr create") == []

    def test_pr_requires_pushed_head_distinct_base_and_matching_repo(self):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        assert self.pr_check(success=False)["error"] == "head_not_pushed"
        self.prepare_pr()
        assert (
            self.pr_check("--base", "feature", success=False)["error"]
            == "same_head_and_base"
        )
        self.git("remote", "set-url", "origin", "https://github.com/fork/repo.git")
        assert self.pr_check(success=False)["error"] == "github_remote_mismatch"

    def test_pr_create_failure_observes_but_never_retries(self):
        self.prepare_pr()
        checked = self.pr_check()
        self.env["GH_MODE"] = "create-error-after-write"
        result = self.create(checked, success=False)
        assert result["operationMayHaveSucceeded"]
        assert len(result["observedPullRequests"]) == 1
        assert len(self.gh_calls("pr create")) == 1

    def test_pr_failed_create_without_remote_mutation_and_failed_verification(self):
        self.prepare_pr()
        checked = self.pr_check()
        self.env["GH_MODE"] = "create-fail"
        result = self.create(checked, success=False)
        assert result["observedPullRequests"] == []
        self.env["GH_MODE"] = "view-mismatch"
        result = self.create(checked, success=False)
        assert result["error"] == "pr_verification_failed"
        assert len(result["observedPullRequests"]) == 1
        assert len(self.gh_calls("pr create")) == 2

    def test_credentials_in_remote_url_are_rejected(self):
        self.git(
            "remote",
            "set-url",
            "origin",
            "https://user:SECRET@github.com/owner/repo.git",
        )
        assert self.push_check(success=False)["error"] == "credentials_in_remote_url"
        assert self.gh_calls("pr create") == []

    def test_scripts_work_from_subdirectory_without_reading_worktree(self):
        nested = self.repo / "nested"
        nested.mkdir()
        (nested / "secret.txt").write_text("SECRET_WORKTREE_CONTENT")
        checked = self.push_check(cwd=nested)
        self.push(checked, cwd=nested)
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.pr_check(cwd=nested)
        assert "SECRET" not in json.dumps(checked)
        self.create(checked, cwd=nested)

    def test_missing_local_base_commit_stops_without_fetch(self):
        other = self.root / "other"
        self.git("clone", str(self.remote), str(other))
        self.git("-C", str(other), "config", "user.name", "Other")
        self.git("-C", str(other), "config", "user.email", "other@example.invalid")
        self.git("-C", str(other), "config", "commit.gpgsign", "false")
        self.git("-C", str(other), "commit", "--allow-empty", "-m", "new base")
        self.git("-C", str(other), "push", "origin", "main")
        assert self.push_check(success=False)["error"] == "missing_local_commit"
        self.prepare_pr()
        assert self.pr_check(success=False)["error"] == "missing_local_commit"

    def test_push_freezes_source_even_if_pre_push_hook_advances_branch(self):
        hook = self.repo / ".git" / "hooks" / "pre-push"
        hook.write_text(
            f"#!{sys.executable}\nimport os, subprocess\n"
            "env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}\n"
            "env['GIT_CONFIG_NOSYSTEM'] = '1'\n"
            "env['GIT_CONFIG_GLOBAL'] = os.devnull\n"
            f"subprocess.run([{self.git_executable!r}, '-C', {str(self.repo)!r}, 'commit', "
            "'--allow-empty', '-m', 'concurrent'], env=env, check=True)\n"
        )
        hook.chmod(0o700)
        checked = self.push_check()
        result = self.push(checked, success=False)
        assert result["error"] == "post_push_local_update_failed"
        assert self.remote_git("rev-parse", "feature").decode().strip() == self.head
        assert self.git("rev-parse", "HEAD").decode().strip() != self.head

    def test_existing_merged_pr_is_returned_even_when_diff_is_empty(self):
        self.prepare_pr()
        self.create(self.pr_check())
        self.gh_state = json.loads(Path(self.env["GH_STATE"]).read_text())
        self.gh_state["prs"][0]["state"] = "MERGED"
        self.save_gh()
        self.remote_git("update-ref", "refs/heads/main", self.head)
        checked = self.pr_check()
        assert checked["diff"] is None
        assert checked["existingPullRequests"][0]["state"] == "MERGED"
        assert self.create(checked)["status"] == "existing"
        assert len(self.gh_calls("pr create")) == 1

    def test_malformed_github_metadata_and_pr_list_stop_without_tracebacks(self):
        self.prepare_pr()
        self.gh_state["metadata"]["nameWithOwner"] = 123
        self.save_gh()
        assert self.pr_check(success=False)["error"] == "invalid_repository_response"
        self.gh_state["metadata"]["nameWithOwner"] = "owner/repo"
        self.gh_state["metadata"]["pullRequestTemplates"] = [{"filename": "pr.md"}]
        self.save_gh()
        assert self.pr_check(success=False)["error"] == "invalid_template_response"
        assert self.gh_calls("pr create") == []

    def test_snapshot_from_another_checkout_is_rejected(self):
        checked = self.push_check()
        other = self.root / "other"
        self.git("clone", str(self.repo), str(other))
        self.git("-C", str(other), "remote", "set-url", "origin", str(self.remote))
        result = self.push(checked, cwd=other, success=False)
        assert result["error"] == "state_changed_before_push"
        self.prepare_pr()
        checked = self.pr_check()
        self.git(
            "-C",
            str(other),
            "remote",
            "set-url",
            "origin",
            "git@github-work:owner/repo.git",
        )
        assert (
            self.create(checked, cwd=other, success=False)["error"]
            == "state_changed_before_pr"
        )
        assert self.gh_calls("pr create") == []

    def test_detached_head_and_missing_gh_stop_before_remote_writes(self):
        self.git("switch", "--detach")
        assert self.push_check(success=False)["error"] == "detached_head"
        assert self.pr_check(success=False)["error"] == "detached_head"
        self.git("switch", "feature")
        self.prepare_pr()
        (self.bin / "gh").unlink()
        assert self.pr_check(success=False)["error"] == "command_failed"

    def test_existing_head_already_pushed_preserves_absent_tracking_ref(self):
        self.prepare_pr()
        self.git("update-ref", "-d", "refs/remotes/origin/feature")
        refs = self.git("show-ref")
        prepared = self.existing_push_prepare()
        assert (
            self.push(self.existing_push_check(prepared))["status"] == "already_pushed"
        )
        assert self.git("show-ref") == refs and self.push_calls() == []

    def test_existing_head_main_protection_and_explicit_initial_main(self):
        self.git("switch", "main")
        assert (
            self.existing_push_prepare(success=False)["error"]
            == "protected_push_target"
        )
        self.remote_git("update-ref", "-d", "refs/heads/main")
        prepared = self.existing_push_prepare("--initial-main", "--set-upstream")
        assert self.push(self.existing_push_check(prepared))["status"] == "pushed"
        assert self.git("rev-parse", "HEAD").decode().strip() == self.base
        self.existing_push_prepare("--initial-main", success=False)
        assert len(self.push_calls()) == 1

    def test_pr_prepare_rejects_target_mismatch_without_mutation(self):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check("--branch", "planned")
        pushed = self.push_prepare(checked, "--target", "other")
        assert (
            self.pr_prepare(checked, pushed, success=False)["error"]
            == "pr_push_destination_mismatch"
        )
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []


class TestGitWrapperProcesses(RemoteTools):
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path, git_executable: str, git_env: dict[str, str]):
        self.setup_tools(tmp_path, git_executable, git_env)

    def test_git_wrapper_preserves_normal_signal_exit(self):
        args = ["-c", "alias.interrupted=!kill -TERM $PPID", "interrupted"]
        direct = subprocess.run(
            [self.git_executable, *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        wrapped = subprocess.run(
            [str(self.bin / "git"), *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        assert direct.returncode < 0
        assert (wrapped.returncode, wrapped.stdout, wrapped.stderr) == (
            direct.returncode,
            direct.stdout,
            direct.stderr,
        )

    def test_git_wrapper_normal_path_preserves_argv_and_binary_streams_without_fallback(
        self,
    ):
        self.git_fallback.unlink()
        wrapper = str(self.bin / "git")
        value = "empty follows:  \n日本語 'quotes' \" $HOME * ? [abc]"
        args = [
            "-C",
            str(self.repo),
            "-c",
            "test.value=" + value,
            "config",
            "--get",
            "test.value",
        ]
        result = subprocess.run(
            [wrapper, *args], cwd=self.root, env=self.env, capture_output=True
        )
        assert (result.returncode, result.stdout, result.stderr) == (
            0,
            (value + "\n").encode(),
            b"",
        )
        filename = "- space\n日本語'\"$*?"
        (self.repo / filename).write_bytes(b"content")
        subprocess.run(
            [wrapper, "-C", str(self.repo), "add", "--", filename],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            check=True,
        )
        assert filename.encode() + b"\0" in self.git("ls-files", "-z")
        payload = bytes(range(256)) + b"\0\xff\n"
        written = subprocess.run(
            [wrapper, "hash-object", "-w", "--stdin"],
            cwd=self.repo,
            env=self.env,
            input=payload,
            capture_output=True,
            check=True,
        )
        read = subprocess.run(
            [wrapper, "cat-file", "blob", written.stdout.decode().strip()],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            check=True,
        )
        assert read.stdout == payload
        assert written.stderr == read.stderr == b""
        for args in (
            ["-c", "test.value=", "config", "--get", "test.value"],
            ["rev-parse", "--verify", ""],
        ):
            direct = subprocess.run(
                [self.git_executable, *args],
                cwd=self.repo,
                env=self.env,
                capture_output=True,
            )
            wrapped = subprocess.run(
                [wrapper, *args], cwd=self.repo, env=self.env, capture_output=True
            )
            assert (wrapped.returncode, wrapped.stdout, wrapped.stderr) == (
                direct.returncode,
                direct.stdout,
                direct.stderr,
            )
        assert direct.returncode != 0 and direct.stderr
        assert self.push_calls() == []

    @pytest.mark.parametrize("failure", ["nonzero", "signal", "exec"])
    def test_git_wrapper_special_failures_match_python_fallback(self, failure):
        args = (
            [
                "-c",
                "alias.interrupted=!f() { kill -TERM $PPID; }; f",
                "interrupted",
                "push",
            ]
            if failure == "signal"
            else ["push", "origin", "missing-source"]
        )
        if failure == "exec":
            self.env["REAL_GIT"] = str(self.root / "missing-git")
        direct = subprocess.run(
            [sys.executable, str(self.git_fallback), *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        wrapped = subprocess.run(
            [str(self.bin / "git"), *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        assert direct.returncode != 0
        if failure == "signal":
            assert direct.returncode == 256 - signal.SIGTERM
        assert (wrapped.returncode, wrapped.stdout, wrapped.stderr) == (
            direct.returncode,
            direct.stdout,
            direct.stderr,
        )


class TestRemoteNoGit(RemoteTools):
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path, isolated_env: dict[str, str], monkeypatch):
        unexpected = tmp_path / "unexpected-git"
        executable = tmp_path / "reject-git"
        executable.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\n"
            f"Path({str(unexpected)!r}).touch()\nraise SystemExit(99)\n"
        )
        executable.chmod(0o700)
        self.setup_tools(tmp_path, str(executable), isolated_env)
        for key in os.environ.keys() - self.env.keys():
            monkeypatch.delenv(key)
        for key, value in self.env.items():
            monkeypatch.setenv(key, value)
        monkeypatch.chdir(self.repo)
        self.head = "1" * 40
        yield
        assert not unexpected.exists(), "Git is not needed by this test"
        assert not (self.repo / ".git").exists()

    def test_no_git_environment_rejects_in_process_git(self):
        assert Path.cwd() == self.repo
        result = subprocess.run(["git", "--version"], capture_output=True)
        assert (result.returncode, result.stdout, result.stderr) == (99, b"", b"")
        unexpected = self.root / "unexpected-git"
        assert unexpected.exists()
        unexpected.unlink()

    @pytest.mark.parametrize(
        "args,special",
        [
            (["push"], True),
            (["-C", "directory", "--", "push", ""], True),
            (["config", "test.value", "push"], True),
            (["ls-remote", "git@github-work:owner/repo.git"], True),
            (["--", "git@github-work:owner/repo.git", "push"], True),
            (["pushes", "--push", "prepush"], False),
            (["ls-remote", "git@github-work:owner/repo.git/"], False),
            (["ls-remote", "git@github-work:other/repo.git"], False),
            (["-c", "key=git@github-work:owner/repo.git", "status"], False),
            (["", "a b", "line\nbreak", "日本語", "'\"$*?"], False),
        ],
    )
    def test_git_wrapper_routes_only_exact_special_arguments(self, args, special):
        recorder = self.root / "record-git"
        recorder.write_text(
            f"#!{sys.executable}\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n"
        )
        recorder.chmod(0o700)
        self.env["REAL_GIT"] = str(recorder)
        if not special:
            self.git_fallback.unlink()
        result = subprocess.run(
            [str(self.bin / "git"), *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            check=True,
        )
        expected = [
            str(self.remote) if arg == "git@github-work:owner/repo.git" else arg
            for arg in args
        ]
        if "push" in args:
            expected = [
                "-c",
                f"url.{self.remote}.insteadOf=git@github-work:owner/repo.git",
                *expected,
            ]
        assert json.loads(result.stdout) == expected
        assert result.stderr == b""
        assert [json.loads(line) for line in self.push_calls()] == (
            [args] if "push" in args else []
        )

    def test_git_wrapper_normal_exec_failure_is_not_success(self):
        self.env["REAL_GIT"] = str(self.root / "missing-git")
        with pytest.raises(FileNotFoundError):
            subprocess.run(
                [self.env["REAL_GIT"], "status"], cwd=self.repo, env=self.env
            )
        result = subprocess.run(
            [str(self.bin / "git"), "status"],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
        )
        assert result.returncode != 0 and result.stderr
        assert result.stdout == b""

    @pytest.mark.parametrize("operation", ["prepare", "check"])
    def test_push_prepared_commands_reject_malformed_stdin_without_leaks(
        self, operation
    ):
        args = ["--remote", "origin"] if operation == "prepare" else ["--prepared"]
        for payload in (b"", b"{", b"\xff", b"null", b"[]", b'{"SECRET": true}'):
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(SCRIPTS / "guarded-push.py"),
                    operation,
                    *args,
                ],
                cwd=self.repo,
                env=self.env,
                input=payload,
                capture_output=True,
                timeout=30,
            )
            assert result.returncode == 1
            assert "error" in json.loads(result.stdout)
            assert b"SECRET" not in result.stdout + result.stderr
            assert b"Traceback" not in result.stderr
        assert self.push_calls() == []

    @pytest.mark.parametrize("operation", ["prepare", "verify", "check"])
    def test_pr_prepared_commands_reject_malformed_json_without_leaks(self, operation):
        args = (
            ("prepare", "--remote", "origin", "--repo", "owner/repo")
            if operation == "prepare"
            else (("check", "--prepared") if operation == "check" else ("verify",))
        )
        for data in (b"{", b"\xff", b"null", b"[]"):
            result = subprocess.run(
                [sys.executable, "-B", str(SCRIPTS / "github-pr.py"), *args],
                cwd=self.repo,
                env=self.env,
                input=data,
                capture_output=True,
            )
            assert result.returncode == 1
            assert "error" in json.loads(result.stdout)
            assert b"Traceback" not in result.stderr
            assert b"SECRET" not in result.stdout + result.stderr
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        ("name", "operation"), [("guarded-push.py", "push"), ("github-pr.py", "create")]
    )
    @pytest.mark.parametrize(
        "payload",
        [{}, [], {"check": {}}, {"check": {"snapshot": {}}}],
        ids=["empty", "list", "no-snapshot", "empty-snapshot"],
    )
    def test_invalid_requests_and_credentials_do_not_mutate_remote(
        self, name, operation, payload
    ):
        self.script(name, operation, request=payload, success=False)
        assert self.gh_calls("pr create") == []
        assert self.push_calls() == []

    @pytest.mark.parametrize(
        ("filename", "operation", "error_code"),
        [
            ("guarded-push.py", "push", "push_result_unknown"),
            ("github-pr.py", "create", "pr_create_result_unknown"),
        ],
    )
    def test_timeouts_observe_without_retrying_mutation(
        self, monkeypatch, filename, operation, error_code
    ):
        monkeypatch.syspath_prepend(str(SCRIPTS))
        spec = importlib.util.spec_from_file_location(operation, SCRIPTS / filename)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if operation == "push":
            snapshot = {
                "repository": str(self.repo),
                "remote": "origin",
                "target": "feature",
                "head": self.head,
                "remoteHead": None,
                "pushUrl": str(self.remote),
                "initialMain": False,
                "setUpstream": False,
            }
            request = {"check": {"snapshot": snapshot}}
            monkeypatch.setattr(module, "snapshot", lambda *args: snapshot)
        else:
            snapshot = {
                "repository": str(self.repo),
                "remote": "origin",
                "githubRepository": "owner/repo",
                "base": "main",
                "branch": "feature",
            }
            request = {
                "check": {"snapshot": snapshot},
                "title": "title",
                "body": "body",
                "draft": False,
            }
            monkeypatch.setattr(module, "facts", lambda *args: (snapshot, []))
            monkeypatch.setattr(module, "existing_prs", lambda *args: [])
        mutations, observations = [], []

        def mutate(*args, **kwargs):
            mutations.append(args)
            raise subprocess.TimeoutExpired("command", 60)

        def observe(snapshot):
            observations.append(snapshot)
            return None

        monkeypatch.setattr(module, "run", mutate)
        monkeypatch.setattr(module, "observe", observe)
        with pytest.raises(module.GuardError) as raised:
            getattr(module, operation)(request)
        assert raised.value.result["error"] == error_code
        assert len(mutations) == 1
        assert len(observations) == 1

    @pytest.mark.parametrize(
        "fields",
        [{"draft": "false"}, {"title": "bad\nline"}, {"body": "bad\0text"}],
        ids=["draft", "title", "body"],
    )
    def test_invalid_pr_content_does_not_create_pr(self, fields):
        checked = {"snapshot": {}}
        self.create(checked, fields=fields, success=False)
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        "field,value",
        [
            ("commit", "0" * 40),
            ("branch", "other"),
            ("parents", []),
            ("tree", "0" * 40),
            ("messageSha256", "0" * 64),
            ("gitleaks", "passed"),
        ],
    )
    def test_prepared_push_check_binds_result_to_observed_commit_without_git(
        self, monkeypatch, field, value
    ):
        monkeypatch.syspath_prepend(str(SCRIPTS))
        spec = importlib.util.spec_from_file_location(
            "focused_push", SCRIPTS / "guarded-push.py"
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        parent, head, tree = "a" * 40, "b" * 40, "c" * 40
        snapshot = {
            "repository": str(self.repo),
            "gitDir": str(self.repo / ".git"),
            "branch": "feature",
            "head": parent,
            "tree": tree,
            "plannedBranch": "feature",
            "refs": {"refs/heads/feature": parent},
            "diffSha256": "d" * 64,
            "indexSha256": "e" * 64,
        }
        result = {
            "commit": head,
            "branch": "feature",
            "parents": [parent],
            "tree": tree,
            "messageSha256": hashlib.sha256(b"feat: pending\n").hexdigest(),
            "gitleaks": "unavailable",
        }
        result[field] = value

        def observed(args, **kwargs):
            if args == (sys.executable, str(SCRIPTS / "git-status.py")):
                output = json.dumps(
                    {
                        "repository": str(self.repo),
                        "gitDir": str(self.repo / ".git"),
                        "branch": "feature",
                        "head": head,
                        "conflicts": [],
                    }
                ).encode()
            elif args[:3] == ["git", "config", "--get"]:
                assert args[3] in ("branch.feature.remote", "branch.feature.merge")
                return subprocess.CompletedProcess(args, 1, b"", b"")
            elif args == ("git", "cat-file", "commit", head):
                output = f"tree {tree}\nparent {parent}\n\nfeat: pending\n".encode()
            elif args == ("git", "check-ref-format", "refs/heads/feature"):
                output = b""
            else:
                raise AssertionError(f"unexpected subprocess: {args}")
            return subprocess.CompletedProcess(args, 0, output, b"")

        monkeypatch.setattr(subprocess, "run", observed)
        with pytest.raises(module.GuardError) as raised:
            module.check_prepared(
                {
                    "preparation": {
                        "kind": "push-preparation",
                        "destination": {},
                        "commitCheck": {
                            "snapshot": snapshot,
                            "gitleaks": "unavailable",
                        },
                    },
                    "commit": result,
                }
            )
        assert raised.value.result == {"error": "prepared_commit_changed"}

    @pytest.mark.parametrize(
        "filename,args,payload,error",
        [
            (
                "guarded-push.py",
                ("prepare", "--existing-head", "--remote", "origin"),
                {"commitCheck": {}},
                "invalid_push_preparation",
            ),
            (
                "guarded-push.py",
                ("branch",),
                {"preparation": {}, "extra": {}},
                "invalid_push_preparation",
            ),
            (
                "guarded-push.py",
                ("check", "--prepared"),
                {
                    "preparation": {
                        "kind": "push-existing-head-preparation",
                        "source": {},
                    }
                },
                "invalid_push_preparation",
            ),
            (
                "guarded-push.py",
                ("check", "--prepared"),
                {
                    "preparation": {
                        "kind": "push-preparation",
                        "destination": {},
                        "commitCheck": {"snapshot": {}, "gitleaks": "unavailable"},
                    }
                },
                "invalid_commit_check",
            ),
            (
                "github-pr.py",
                (
                    "prepare",
                    "--existing-head",
                    "--remote",
                    "origin",
                    "--repo",
                    "owner/repo",
                ),
                {"pushPreparation": {}, "commitCheck": {}},
                "invalid_pr_preparation",
            ),
            (
                "github-pr.py",
                ("verify",),
                {"preparation": {"kind": "pr-existing-head-preparation"}, "commit": {}},
                "invalid_pr_preparation",
            ),
            (
                "github-pr.py",
                ("verify",),
                {"preparation": {"kind": "pr-preparation", "destination": {}}},
                "invalid_pr_preparation",
            ),
        ],
        ids=[
            "mixed-existing-push",
            "branch-extra",
            "existing-source-shape",
            "staged-snapshot-shape",
            "mixed-existing-pr",
            "mixed-existing-verification",
            "retained-push-shape",
        ],
    )
    def test_public_commands_reject_request_shapes_before_git(
        self, filename, args, payload, error
    ):
        assert self.script(filename, *args, request=payload, success=False) == {
            "error": error
        }
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []
