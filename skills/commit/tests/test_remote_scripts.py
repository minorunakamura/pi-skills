"""Real temporary Git remotes, with isolated gh/ssh fixtures and no network."""

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

    def test_push_failure_does_not_retry_or_recover(self):
        hook = self.remote / "hooks" / "pre-receive"
        log = self.root / "push-count"
        hook.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\nimport sys\n"
            f"with Path({str(log)!r}).open('a') as f: f.write('attempt\\n')\n"
            "print('SECRET_HOOK_ERROR', file=sys.stderr)\nsys.exit(1)\n"
        )
        hook.chmod(0o700)
        result = self.push(self.push_check(), success=False)
        assert result["error"] == "push_failed"
        assert result["observedHead"] is None
        assert log.read_text() == "attempt\n"

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
