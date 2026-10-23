"""Shared checks for the push and PR commands; no persistent workflow state."""

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


def local_state():
    helper = Path(__file__).with_name("git-status.py")
    state = json.loads(run(sys.executable, str(helper)))
    if state["branch"] is None:
        raise GuardError("detached_head")
    if state["head"] is None:
        raise GuardError("unborn_head")
    if state["conflicts"]:
        raise GuardError("unmerged_index")
    root, branch = state["repository"], state["branch"]
    return {
        **{key: state[key] for key in ("repository", "gitDir", "branch", "head")},
        "upstream": {
            "remote": config(root, f"branch.{branch}.remote"),
            "merge": config(root, f"branch.{branch}.merge"),
        },
    }


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
