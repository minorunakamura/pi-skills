"""Real temporary Git remotes, with isolated gh/ssh fixtures and no network."""

import hashlib
import importlib.util
import json
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


class TestRemoteScripts:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path, git_executable: str, git_env: dict[str, str]):
        self.root = tmp_path
        self.repo = tmp_path / "repo"
        self.remote = tmp_path / "remote.git"
        self.bin = tmp_path / "bin"
        self.git_executable = git_executable
        self.env = git_env
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
        for name in ("git", "gh", "ssh"):
            executable = self.bin / name
            executable.write_text(f"#!{sys.executable}\n" + source)
            executable.chmod(0o700)
        self.add_commit("base.txt", "base")
        self.base = self.git("rev-parse", "HEAD").decode().strip()
        self.git("init", "--bare", "-b", "main", str(self.remote))
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "origin", "main")
        self.git("switch", "-c", "feature")
        self.add_commit("first.txt", "first")
        self.add_commit("second.txt", "second")
        self.head = self.git("rev-parse", "HEAD").decode().strip()
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

    def test_push_prepare_collects_destination_and_history_without_mutation(self):
        checked = self.commit_check("--branch", "planned")
        refs = self.git("show-ref")
        preparation = self.push_prepare(
            checked, "--target", "published", "--set-upstream"
        )
        assert preparation["kind"] == "push-preparation"
        assert preparation["commitCheck"] == checked
        assert preparation["destination"]["target"] == "published"
        assert preparation["destination"]["branch"] == "planned"
        assert preparation["destination"]["defaultHead"] == self.base
        assert preparation["destination"]["setUpstream"] is True
        assert [x["message"].strip() for x in preparation["commits"]] == [
            "first",
            "second",
        ]
        assert "snapshot" not in preparation
        assert self.git("show-ref") == refs
        assert self.git("branch", "--show-current").strip() == b"feature"
        assert self.push_calls() == []

    def test_prepared_push_check_accepts_verified_commit_without_json_rewriting(self):
        checked = self.commit_check("--branch", "planned")
        preparation = self.push_prepare(
            checked, "--target", "published", "--set-upstream"
        )
        commit = self.commit_checked(checked)
        executable = self.prepared_push_check(preparation, commit)
        assert executable["snapshot"]["head"] == commit["commit"]
        assert [x["message"].strip() for x in executable["commits"]] == [
            "first",
            "second",
            "feat: pending",
        ]
        assert self.push_calls() == []
        result = self.push(executable)
        assert result["status"] == "pushed"
        assert result["branch"] == "planned"
        assert result["target"] == "published"
        assert (
            self.remote_git("rev-parse", "published").decode().strip()
            == commit["commit"]
        )
        assert (
            self.git("rev-parse", "--abbrev-ref", "@{upstream}").strip()
            == b"origin/published"
        )
        assert len(self.push_calls()) == 1

    @pytest.mark.parametrize("change", ["head", "branch", "index", "mode", "refs"])
    def test_push_prepare_rejects_stale_commit_check_without_push(self, change):
        checked = self.commit_check()
        self.change_prepared_local_state(change)
        self.push_prepare(checked, success=False)
        assert self.push_calls() == []

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

    @pytest.mark.parametrize(
        "change",
        [
            "head",
            "branch",
            "index",
            "mode",
            "refs",
            "url",
            "target",
            "default",
            "upstream",
        ],
    )
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
            ("commit", "0" * 40),
            ("branch", "other"),
            ("parents", []),
            ("tree", "0" * 40),
            ("messageSha256", "0" * 64),
            ("gitleaks", "passed"),
        ],
    )
    def test_prepared_push_check_binds_every_commit_result_field(self, field, value):
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

    def test_push_preparation_cannot_be_used_as_execution_check(self):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        assert self.push(preparation, success=False)["error"] == "invalid_push_request"
        assert self.push_calls() == []

    def test_push_prepare_revalidates_commit_check_after_remote_material_collection(
        self,
    ):
        checked = self.commit_check()
        wrapper = self.bin / "git"
        source = wrapper.read_text()
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
        self.push_prepare(checked, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("parents", [[], ["base"], ["head"], ["head", "base"]])
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

    @pytest.mark.parametrize("planned", [False, True])
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

    @pytest.mark.parametrize("planned", [False, True])
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

    def test_push_prepare_preserves_non_fast_forward_and_protected_target_guards(self):
        self.git("switch", "-c", "divergent", self.base)
        self.add_commit("divergent.txt", "divergent")
        self.git("push", "origin", "divergent:feature")
        self.git("switch", "feature")
        checked = self.commit_check()
        assert self.push_prepare(checked, success=False)["error"] == "non_fast_forward"
        assert (
            self.push_prepare(checked, "--target", "main", success=False)["error"]
            == "protected_push_target"
        )
        assert (
            self.push_prepare(checked, "--initial-main", success=False)["error"]
            == "initial_main_requires_empty_remote"
        )
        assert self.push_calls() == []

    def test_push_prepare_initial_main_rejects_tag_only_remote(self):
        self.git("switch", "main")
        self.remote_git("update-ref", "refs/tags/existing", self.base)
        self.remote_git("update-ref", "-d", "refs/heads/main")
        checked = self.commit_check()
        self.push_prepare(checked, "--initial-main", success=False)
        assert self.push_calls() == []

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

    def test_prepared_push_check_rejects_missing_retained_diff_digest(self):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        del preparation["commitCheck"]["snapshot"]["diffSha256"]
        self.prepared_push_check(preparation, commit, success=False)
        assert self.push_calls() == []

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

    @pytest.mark.parametrize(
        "field", ["kind", "commitCheck", "destination", "sourceUpstream", "commits"]
    )
    def test_prepared_push_check_rejects_malformed_preparation(self, field):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        preparation[field] = None
        self.prepared_push_check(preparation, commit, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("result", [None, [], {}, {"commit": "SECRET"}])
    def test_prepared_push_check_rejects_malformed_commit_result(self, result):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        self.commit_checked(checked)
        self.prepared_push_check(preparation, result, success=False)
        assert self.push_calls() == []

    def test_prepared_push_check_revalidates_source_upstream_after_material_collection(
        self,
    ):
        checked = self.commit_check("--branch", "planned")
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        wrapper = self.bin / "git"
        counter = self.root / "ls-remote-count"
        wrapper.write_text(
            wrapper.read_text().replace(
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
        self.prepared_push_check(preparation, commit, success=False)
        assert self.push_calls() == []

    @pytest.mark.parametrize("field", ["repository", "gitDir"])
    def test_prepared_push_check_rejects_different_repository_identity(self, field):
        checked = self.commit_check()
        preparation = self.push_prepare(checked)
        commit = self.commit_checked(checked)
        preparation["commitCheck"]["snapshot"][field] = str(self.root / "different")
        assert (
            self.prepared_push_check(preparation, commit, success=False)["error"]
            == "prepared_commit_changed"
        )
        assert self.push_calls() == []

    def test_push_exact_sha_and_optional_upstream(self):
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

    @pytest.mark.parametrize("change", ["head", "branch", "url", "upstream"])
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

    def test_initial_main_requires_explicit_flag_and_totally_empty_remote(self):
        self.git("switch", "main")
        self.remote_git("update-ref", "-d", "refs/heads/main")
        assert self.push_check(success=False)["error"] == "protected_push_target"
        checked = self.push_check("--initial-main")
        assert checked["snapshot"]["emptyRemote"]
        assert self.push(checked)["status"] == "pushed"
        assert (
            self.push_check("--initial-main", success=False)["error"]
            == "initial_main_requires_empty_remote"
        )

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

    @pytest.mark.parametrize("prepared", [False, True])
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

    def test_pr_prepare_collects_future_whole_branch_without_mutation(self):
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

    @pytest.mark.parametrize("mapping", ["standard", "custom", "negative"])
    def test_pr_prepared_check_accepts_only_planned_push_and_git_mapped_refs(
        self, mapping
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
    def test_pr_pipeline_updates_only_first_matching_positive_fetch_mapping(
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
        checked, pushed, preparation = self.future_pr("--branch", "planned")
        commit = self.commit_checked(checked)
        self.prepared_pr("verify", preparation, commit)
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
        executable = self.prepared_pr("check", preparation, commit)
        assert self.create(executable)["status"] == "created"
        assert len(self.push_calls()) == 1
        assert len(self.gh_calls("pr create")) == 1

    @pytest.mark.parametrize("state", ["OPEN", "CLOSED", "MERGED"])
    def test_pr_future_duplicate_omits_new_text_but_verifies_and_never_creates(
        self, state
    ):
        self.gh_state["prs"] = [
            {
                "number": 1,
                "url": "https://github.com/owner/repo/pull/1",
                "state": state,
                "isCrossRepository": False,
                "headRefName": "feature",
                "baseRefName": "main",
            }
        ]
        self.save_gh()
        checked, pushed, preparation = self.future_pr()
        assert preparation["diff"] is None
        assert preparation["commits"] == []
        assert preparation["templates"] == []
        assert preparation["diffSha256"]
        commit = self.commit_checked(checked)
        self.prepared_pr("verify", preparation, commit)
        self.push(self.prepared_push_check(pushed, commit))
        executable = self.prepared_pr("check", preparation, commit)
        assert executable["diff"] is None
        assert executable["commits"] == []
        assert self.create(executable)["status"] == "existing"
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        "change",
        [
            "head",
            "branch",
            "index",
            "mode",
            "refs",
            "url",
            "target",
            "upstream",
            "base",
            "default",
            "account",
            "permission",
            "template",
            "fetch",
            "parent",
            "message",
        ],
    )
    def test_pr_verify_rejects_drift_before_any_push(self, change):
        checked, _, preparation = self.future_pr()
        commit = self.commit_checked(checked)
        self.change_pr_prepared_state(change, preparation, commit)
        self.prepared_pr("verify", preparation, commit, success=False)
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    def change_pr_prepared_state(self, change, preparation, commit):
        if change in ("head", "branch", "index", "mode", "refs"):
            self.change_prepared_local_state(change)
        elif change == "url":
            self.git("remote", "set-url", "--push", "origin", str(self.remote))
        elif change == "target":
            preparation["pushPreparation"]["destination"]["target"] = "other"
        elif change == "upstream":
            self.git("config", "branch.feature.remote", "elsewhere")
        elif change == "base":
            self.remote_git("fetch", str(self.repo), "feature:main")
        elif change == "default":
            self.remote_git("update-ref", "refs/heads/default", self.base)
            self.remote_git("symbolic-ref", "HEAD", "refs/heads/default")
            self.gh_state["metadata"]["defaultBranchRef"] = {"name": "default"}
            self.save_gh()
        elif change == "account":
            self.gh_state["account"] = "other"
            self.save_gh()
        elif change == "permission":
            self.gh_state["metadata"]["viewerPermission"] = "ADMIN"
            self.save_gh()
        elif change == "template":
            self.gh_state["metadata"]["pullRequestTemplates"] = [
                {"filename": "pr.md", "body": "changed"}
            ]
            self.save_gh()
        elif change == "fetch":
            self.git("config", "remote.origin.fetch", "+refs/heads/*:refs/other/*")
        elif change == "parent":
            wrong = (
                self.git(
                    "commit-tree",
                    commit["tree"],
                    "-p",
                    self.base,
                    "-m",
                    "feat: pending",
                )
                .decode()
                .strip()
            )
            self.git("update-ref", "refs/heads/feature", wrong)
            commit.update(commit=wrong, parents=[self.base])
        elif change == "message":
            commit["messageSha256"] = "0" * 64
        elif change == "mapped-sha":
            self.git("update-ref", "refs/remotes/origin/feature", self.base)
        elif change == "unmapped-ref":
            self.git("update-ref", "refs/custom/unapproved", commit["commit"])
        elif change == "remote-target":
            self.remote_git("update-ref", "refs/heads/feature", self.base)

    @pytest.mark.parametrize(
        "change",
        [
            "refs",
            "mapped-sha",
            "unmapped-ref",
            "remote-target",
            "upstream",
            "fetch",
            "base",
            "account",
            "template",
            "index",
            "mode",
        ],
    )
    def test_pr_prepared_check_rejects_unapproved_postpush_transitions(self, change):
        checked, pushed, preparation = self.future_pr()
        commit = self.commit_checked(checked)
        self.push(self.prepared_push_check(pushed, commit))
        self.change_pr_prepared_state(change, preparation, commit)
        self.prepared_pr("check", preparation, commit, success=False)
        assert len(self.push_calls()) == 1
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        "change",
        [
            "target",
            "remote",
            "url",
            "commit-check",
            "branch",
            "mode",
            "account-response",
            "auth",
            "permission",
            "base",
        ],
    )
    def test_pr_prepare_rejects_invalid_early_materials_without_mutation(self, change):
        self.git("remote", "set-url", "origin", "git@github-work:owner/repo.git")
        checked = self.commit_check("--branch", "planned")
        pushed = self.push_prepare(
            checked, *(("--target", "other") if change == "target" else ())
        )
        args = ()
        if change == "remote":
            pushed["destination"]["remote"] = "other"
        elif change == "url":
            pushed["destination"]["pushUrl"] = "https://github.com/owner/repo.git"
        elif change == "commit-check":
            checked = json.loads(json.dumps(checked))
            checked["snapshot"]["tree"] = (
                self.git("rev-parse", "HEAD^{tree}").decode().strip()
            )
        elif change in ("branch", "mode"):
            self.change_prepared_local_state(change)
        elif change == "account-response":
            self.env["GH_MODE"] = "bad-json"
        elif change == "auth":
            self.env["GH_MODE"] = "auth-fail"
        elif change == "permission":
            self.gh_state["metadata"]["viewerPermission"] = "READ"
            self.save_gh()
        elif change == "base":
            args = ("--base", "missing")
        self.pr_prepare(checked, pushed, *args, success=False)
        assert self.push_calls() == []
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("mapping", ["custom", "negative", "exact"])
    def test_pr_prepared_check_rejects_wrong_mapped_sha_for_frozen_mapping(
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
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize(
        "spec",
        [
            "refs/heads/*",
            "refs/heads/*:refs/custom/exact",
            "^refs/heads/*:refs/custom/*",
            "+refs/heads/**:refs/custom/**",
            "HEAD:refs/custom/head",
        ],
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
        self.push(self.prepared_push_check(pushed, commit))
        assert (
            self.create(self.prepared_pr("check", preparation, commit))["status"]
            == "existing"
        )
        assert self.gh_calls("pr create") == []

    @pytest.mark.parametrize("planned", [False, True])
    def test_pr_pipeline_preserves_unrelated_upstream_without_set_upstream(
        self, planned
    ):
        branch = "planned" if planned else "feature"
        self.git("push", "origin", "HEAD~1:refs/heads/" + branch)
        self.git("config", "branch." + branch + ".remote", "origin")
        self.git("config", "branch." + branch + ".merge", "refs/heads/main")
        checked, pushed, preparation = self.future_pr(
            *(("--branch", branch) if planned else ())
        )
        assert pushed["destination"]["remoteHead"] != self.head
        commit = self.commit_checked(checked)
        self.prepared_pr("verify", preparation, commit)
        self.push(self.prepared_push_check(pushed, commit))
        executable = self.prepared_pr("check", preparation, commit)
        assert executable["snapshot"]["upstream"] == {
            "remote": "origin",
            "merge": "refs/heads/main",
        }
        assert self.create(executable)["status"] == "created"

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

    @pytest.mark.parametrize("operation", ["verify", "check"])
    def test_pr_prepared_commands_bind_exact_result_and_preparation(self, operation):
        checked, pushed, preparation = self.future_pr()
        commit = self.commit_checked(checked)
        if operation == "check":
            self.push(self.prepared_push_check(pushed, commit))
        for field, value in [
            ("commit", self.head),
            ("branch", "other"),
            ("tree", self.base),
            ("parents", []),
            ("messageSha256", "0" * 64),
            ("gitleaks", "failed"),
        ]:
            self.prepared_pr(
                operation, preparation, {**commit, field: value}, success=False
            )
        for field in (
            "kind",
            "commitCheck",
            "pushPreparation",
            "destination",
            "diffSha256",
            "mergeBase",
            "units",
            "commitsSha256",
            "fetchRefspecs",
        ):
            malformed = {**preparation, field: None}
            self.prepared_pr(operation, malformed, commit, success=False)
        for malformed in (None, [], {}, {"commit": "SECRET"}):
            self.prepared_pr(operation, preparation, malformed, success=False)
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

    @pytest.mark.parametrize("object_name", ["base", "blob"])
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

    def test_pr_context_uses_full_branch_and_missing_templates_are_normal(self):
        self.prepare_pr()
        checked = self.pr_check()
        assert len(checked["commits"]) == 2
        assert "first.txt" in checked["diff"]
        assert "second.txt" in checked["diff"]
        assert checked["templates"] == []
        assert checked["snapshot"]["account"] == "tester"
        assert checked["snapshot"]["githubRepository"] == "github.com/owner/repo"
        assert self.gh_calls("pr create") == []

    def test_pr_create_roundtrips_exact_text_and_draft(self):
        self.prepare_pr()
        self.gh_state["metadata"]["pullRequestTemplates"] = [
            {"filename": "pr.md", "body": "## Why"}
        ]
        self.save_gh()
        checked = self.pr_check()
        assert checked["templates"] == self.gh_state["metadata"]["pullRequestTemplates"]
        result = self.create(checked, fields={"draft": True})
        assert result["status"] == "created"
        state = json.loads(Path(self.env["GH_STATE"]).read_text())
        assert state["prs"][0]["title"] == "feat: 'quoted' $(touch unwanted)"
        assert state["prs"][0]["isDraft"]
        assert state["prs"][0]["body"].endswith("Closes #1\n")
        assert not (self.repo / "unwanted").exists()
        assert len(self.gh_calls("pr create")) == 1

    @pytest.mark.parametrize("state", ["OPEN", "CLOSED", "MERGED"])
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
        checked = self.pr_check()
        if mode == "read-only":
            self.gh_state["metadata"]["viewerPermission"] = "READ"
            self.save_gh()
            assert (
                self.pr_check(success=False)["error"]
                == "insufficient_repository_permission"
            )
        else:
            self.env["GH_MODE"] = mode
            self.create(checked, success=False)
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
        assert not self.remote_git("for-each-ref", "refs/heads/feature")

    @pytest.mark.parametrize(
        "fields",
        [{"draft": "false"}, {"title": "bad\nline"}, {"body": "bad\0text"}],
        ids=["draft", "title", "body"],
    )
    def test_invalid_pr_content_does_not_create_pr(self, fields):
        self.prepare_pr()
        checked = self.pr_check()
        self.create(checked, fields=fields, success=False)
        assert self.gh_calls("pr create") == []

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
