"""Shared checks for the push and PR commands; no persistent workflow state."""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


class GuardError(Exception):
    def __init__(self, code, **details):
        self.result = {"error": code, **details}


def run(*args, cwd=None, input=None):
    env = dict(
        os.environ,
        GIT_TERMINAL_PROMPT="0",
        GIT_OPTIONAL_LOCKS="0",
        GIT_NO_REPLACE_OBJECTS="1",
        GIT_NO_LAZY_FETCH="1",
        GH_PROMPT_DISABLED="1",
        GH_PAGER="cat",
    )
    return subprocess.run(
        args,
        cwd=cwd,
        input=input,
        env=env,
        capture_output=True,
        check=True,
        timeout=60,
    ).stdout


def git(root, *args):
    return run("git", *args, cwd=root)


def required_text(value):
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise GuardError("invalid_input")
    return value


def branch_name(value):
    required_text(value)
    if value.startswith("-"):
        raise GuardError("invalid_branch")
    run("git", "check-ref-format", "refs/heads/" + value)
    return value


def config(root, key):
    result = subprocess.run(
        ["git", "config", "--get", key],
        cwd=root,
        capture_output=True,
        timeout=60,
    )
    if result.returncode == 1:
        return None
    result.check_returncode()
    return os.fsdecode(result.stdout.removesuffix(b"\n"))


def local_state(*, allow_unborn=False):
    helper = Path(__file__).with_name("git-status.py")
    state = json.loads(run(sys.executable, str(helper)))
    if state["branch"] is None:
        raise GuardError("detached_head")
    if state["head"] is None and not allow_unborn:
        raise GuardError("unborn_head")
    if state["conflicts"]:
        raise GuardError("unmerged_index")
    root, branch = state["repository"], state["branch"]
    return {
        **{key: state[key] for key in ("repository", "gitDir", "branch", "head")},
        "upstream": branch_upstream(root, branch),
    }


def branch_upstream(root, branch):
    return {
        "remote": config(root, f"branch.{branch}.remote"),
        "merge": config(root, f"branch.{branch}.merge"),
    }


def local_refs(root):
    return dict(
        line.split(" ", 1)
        for line in git(root, "for-each-ref", "--format=%(refname) %(objectname)")
        .decode()
        .splitlines()
    )


def checked_commit_snapshot(checked):
    if (
        not isinstance(checked, dict)
        or checked.get("gitleaks") not in ("passed", "unavailable")
        or not isinstance(checked.get("snapshot"), dict)
    ):
        raise GuardError("invalid_commit_check")
    expected = checked["snapshot"]
    if (
        set(expected)
        != {
            "repository",
            "gitDir",
            "branch",
            "head",
            "tree",
            "plannedBranch",
            "refs",
            "diffSha256",
            "indexSha256",
        }
        or any(
            not isinstance(expected[key], str)
            for key in (
                "repository",
                "gitDir",
                "branch",
                "tree",
                "plannedBranch",
                "diffSha256",
                "indexSha256",
            )
        )
        or expected["head"] is not None
        and not isinstance(expected["head"], str)
        or not isinstance(expected["refs"], dict)
        or not re.fullmatch(r"[0-9a-f]{64}", expected["diffSha256"])
        or not re.fullmatch(r"[0-9a-f]{64}", expected["indexSha256"])
    ):
        raise GuardError("invalid_commit_check")
    return expected


def validate_commit_check(checked):
    """Revalidate retained staged check without rescanning Gitleaks or creating refs."""
    expected = checked_commit_snapshot(checked)
    state = local_state(allow_unborn=True)
    root = state["repository"]
    planned = branch_name(expected.get("plannedBranch"))
    refs = local_refs(root)
    if planned != state["branch"]:
        target = "refs/heads/" + planned
        if planned == "HEAD" or any(
            ref == target
            or ref.startswith(target + "/")
            or target.startswith(ref + "/")
            for ref in refs
        ):
            raise GuardError("branch_exists")
    diff = git(
        root,
        "--no-pager",
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        "--no-color",
        "--ignore-submodules=none",
    )
    current = {
        **{key: state[key] for key in ("repository", "gitDir", "branch", "head")},
        "plannedBranch": planned,
        "refs": refs,
        "tree": git(root, "write-tree").decode().strip(),
        "diffSha256": hashlib.sha256(diff).hexdigest(),
        "indexSha256": hashlib.sha256(
            git(root, "ls-files", "--stage", "-z")
        ).hexdigest(),
    }
    if not diff or current != expected:
        raise GuardError("commit_check_changed")
    return state


def remote_fetch_refspecs(root, remote):
    required_text(remote)
    result = subprocess.run(
        ["git", "config", "--get-all", "remote." + remote + ".fetch"],
        cwd=root,
        capture_output=True,
        timeout=60,
    )
    if result.returncode == 1:
        return []
    result.check_returncode()
    return result.stdout.decode().splitlines()


def mapped_tracking_refs(refspecs, target):
    """Git push updates the first positive match; validate even later refspecs."""
    if not isinstance(refspecs, list) or any(not isinstance(x, str) for x in refspecs):
        raise GuardError("invalid_fetch_refspecs")
    source = "refs/heads/" + branch_name(target)
    mapped = []
    for spec in refspecs:
        negative = spec.startswith("^")
        parts = (
            spec.removeprefix("^").split(":")
            if negative
            else spec.removeprefix("+").split(":")
        )
        if (
            len(parts) != (1 if negative else 2)
            or any(
                not part.startswith("refs/") or part.count("*") > 1 for part in parts
            )
            or not negative
            and parts[0].count("*") != parts[1].count("*")
        ):
            raise GuardError("unsupported_fetch_refspec")
        for part in parts:
            run("git", "check-ref-format", "--refspec-pattern", part)
        if negative or mapped:
            continue
        pattern, destination = parts
        if "*" in pattern:
            prefix, suffix = pattern.split("*")
            if (
                source.startswith(prefix)
                and source.endswith(suffix)
                and len(source) >= len(prefix) + len(suffix)
            ):
                middle = source[
                    len(prefix) : len(source) - len(suffix) if suffix else None
                ]
                mapped.append(destination.replace("*", middle))
        elif pattern == source:
            mapped.append(destination)
    return mapped


def validate_prepared_commit(checked, result, *, pushed_refs=()):
    """Verify the one planned commit against both the retained check and actual object."""
    expected = checked_commit_snapshot(checked)
    if not isinstance(result, dict) or not isinstance(expected.get("refs"), dict):
        raise GuardError("invalid_prepared_commit")
    state = local_state()
    root = state["repository"]
    raw = git(root, "cat-file", "commit", state["head"])
    headers, body = raw.split(b"\n\n", 1)
    lines = headers.split(b"\n")
    trees = [line[5:].decode() for line in lines if line.startswith(b"tree ")]
    parents = [line[7:].decode() for line in lines if line.startswith(b"parent ")]
    actual = {
        "commit": state["head"],
        "branch": state["branch"],
        "parents": parents,
        "tree": trees[0] if len(trees) == 1 else None,
        # Git may add a terminal LF; bind the raw object body, not log formatting.
        "messageSha256": hashlib.sha256(body).hexdigest(),
        "gitleaks": checked["gitleaks"],
    }
    expected_refs = {
        **expected["refs"],
        "refs/heads/" + branch_name(expected.get("plannedBranch")): state["head"],
        **{ref: state["head"] for ref in pushed_refs},
    }
    if (
        actual != result
        or any(state[key] != expected.get(key) for key in ("repository", "gitDir"))
        or state["branch"] != expected["plannedBranch"]
        or state["head"] == expected.get("head")
        or parents != ([expected["head"]] if expected.get("head") else [])
        or actual["tree"] != expected.get("tree")
        or git(root, "write-tree").decode().strip() != expected.get("tree")
        or hashlib.sha256(git(root, "ls-files", "--stage", "-z")).hexdigest()
        != expected.get("indexSha256")
        or local_refs(root) != expected_refs
    ):
        raise GuardError("prepared_commit_changed")
    return state


def push_url(root, remote):
    required_text(remote)
    names = git(root, "remote").decode().splitlines()
    if remote not in names:
        raise GuardError("unknown_remote")
    urls = (
        git(root, "remote", "get-url", "--push", "--all", remote).decode().splitlines()
    )
    if len(urls) != 1:
        raise GuardError("multiple_push_urls")
    url = required_text(urls[0])
    if url.startswith("-") or url.startswith("ext::"):
        raise GuardError("unsupported_push_url")
    parsed = urlsplit(url)
    if (
        parsed.password is not None
        or parsed.scheme in ("http", "https")
        and parsed.username is not None
    ):
        raise GuardError("credentials_in_remote_url")
    if "://" in url and (parsed.query or parsed.fragment):
        raise GuardError("unsupported_push_url")
    return url


def remote_refs(root, url):
    data = git(root, "ls-remote", "--symref", "--", url).decode()
    refs = {}
    default = None
    for line in data.splitlines():
        value, ref = line.split("\t")
        if value.startswith("ref: "):
            if ref == "HEAD" and value.startswith("ref: refs/heads/"):
                default = value.removeprefix("ref: refs/heads/")
        else:
            if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value) or ref in refs:
                raise GuardError("invalid_remote_refs")
            refs[ref] = value
    if refs and (default is None or "refs/heads/" + default not in refs):
        raise GuardError("unknown_remote_default_branch")
    return {"refs": refs, "defaultBranch": default, "empty": not data}


def require_commit(root, sha):
    try:
        git(root, "cat-file", "-e", sha + "^{commit}")
    except subprocess.CalledProcessError:
        raise GuardError("missing_local_commit", commit=sha) from None


def commit_log(root, head, base=None):
    if base is not None:
        require_commit(root, base)
    data = git(
        root,
        "--no-pager",
        "log",
        "--reverse",
        "--no-color",
        "--no-show-signature",
        "--no-notes",
        "--format=%H%x00%B",
        "-z",
        f"{base}..{head}" if base else head,
        "--",
    )
    if len(data) > 2 * 1024 * 1024:
        raise GuardError("commit_log_too_large")
    parts = data.decode().split("\0")
    return [
        {"sha": parts[i], "message": parts[i + 1]} for i in range(0, len(parts) - 1, 2)
    ]


def push_destination(
    state, remote, target=None, initial_main=False, set_upstream=False
):
    root = state["repository"]
    target = branch_name(target if target is not None else state["branch"])
    url = push_url(root, remote)
    observed = remote_refs(root, url)
    default = observed["defaultBranch"]
    refs = observed["refs"]
    if initial_main:
        if not (observed["empty"] and state["branch"] == target == "main"):
            raise GuardError("initial_main_requires_empty_remote")
    elif target == "main" or target == default:
        raise GuardError("protected_push_target")
    remote_head = refs.get("refs/heads/" + target)
    if remote_head and remote_head != state["head"]:
        if state["head"] is None:
            raise GuardError("non_fast_forward")
        require_commit(root, remote_head)
        try:
            git(root, "merge-base", "--is-ancestor", remote_head, state["head"])
        except subprocess.CalledProcessError as error:
            if error.returncode == 1:
                raise GuardError("non_fast_forward") from None
            raise
    return {
        **state,
        "remote": remote,
        "pushUrl": url,
        "target": target,
        "remoteHead": remote_head,
        "defaultBranch": default,
        "defaultHead": refs.get("refs/heads/" + default) if default else None,
        "emptyRemote": observed["empty"],
        "initialMain": initial_main,
        "setUpstream": set_upstream,
    }


def validate_push_preparation(preparation, state):
    """Check the retained destination and outgoing history once at a caller's boundary."""
    if (
        not isinstance(preparation, dict)
        or preparation.get("kind") != "push-preparation"
        or not isinstance(preparation.get("destination"), dict)
    ):
        raise GuardError("invalid_push_preparation")
    before = preparation["destination"]
    if not isinstance(before.get("initialMain"), bool) or not isinstance(
        before.get("setUpstream"), bool
    ):
        raise GuardError("invalid_push_preparation")
    original = checked_commit_snapshot(preparation.get("commitCheck"))
    root, planned = state["repository"], original["plannedBranch"]
    planned_state = {
        **state,
        "head": original["head"],
        "branch": planned,
        "upstream": (
            state["upstream"]
            if state["branch"] == planned
            else branch_upstream(root, planned)
        ),
    }
    current = push_destination(
        planned_state,
        before.get("remote"),
        before.get("target"),
        before["initialMain"],
        before["setUpstream"],
    )
    expected_upstream = {
        "remote": before["remote"],
        "merge": "refs/heads/" + before["target"],
    }
    if before["setUpstream"] and current["upstream"] not in (
        {"remote": None, "merge": None},
        expected_upstream,
    ):
        raise GuardError("conflicting_upstream")
    base = before.get("remoteHead") or before.get("defaultHead")
    if base is not None and original["head"] is None:
        require_commit(root, base)
    commits = commit_log(root, original["head"], base) if original["head"] else []
    if (
        current != before
        or branch_upstream(root, original["branch"])
        != preparation.get("sourceUpstream")
        or commits != preparation.get("commits")
    ):
        raise GuardError("push_preparation_changed")
    return planned_state


def github_location(root, url):
    """Resolve ordinary HTTPS/SSH remotes, including OpenSSH Host aliases."""
    if "://" in url:
        parsed = urlsplit(url)
        if parsed.scheme not in ("https", "ssh") or parsed.query or parsed.fragment:
            raise GuardError("unsupported_github_remote")
        host, path = parsed.hostname, parsed.path.lstrip("/")
        user = unquote(parsed.username) if parsed.username is not None else None
        port = parsed.port
        ssh = parsed.scheme == "ssh"
    else:
        match = re.fullmatch(r"(?:([^/@:]+)@)?([^/:]+):(.+)", url)
        if not match:
            raise GuardError("unsupported_github_remote")
        user, host, path = match.groups()
        port = None
        ssh = True
    required_text(host)
    if ssh:
        if (
            os.environ.get("GIT_SSH_COMMAND")
            or os.environ.get("GIT_SSH")
            or config(root, "core.sshCommand")
        ):
            raise GuardError("custom_ssh_command_unsupported")
        options = ["-l", user] if user is not None else []
        if port is not None:
            options += ["-p", str(port)]
        resolved = run("ssh", "-G", *options, "--", host).decode().splitlines()
        hosts = [
            line.split(None, 1)[1] for line in resolved if line.startswith("hostname ")
        ]
        if len(hosts) != 1:
            raise GuardError("ssh_host_unresolved")
        host = hosts[0]
    return host.lower(), path.rstrip("/").removesuffix(".git")


def emit(action):
    try:
        result = action()
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except GuardError as error:
        result = error.result
    except subprocess.TimeoutExpired:
        result = {"error": "command_timeout"}
    except ValueError, UnicodeError, KeyError, TypeError:
        result = {"error": "invalid_input_or_response"}
    except (OSError, subprocess.CalledProcessError) as error:
        # Never echo command arguments, transport errors, tokens, or hook output.
        result = {"error": "command_failed", "message": type(error).__name__}
    print(json.dumps(result, ensure_ascii=True))
    return 1
