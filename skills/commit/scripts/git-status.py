#!/usr/bin/env python3
"""Describe Git state without printing worktree contents or diffs."""

import json
import os
import subprocess
import sys
from typing import TypedDict


class _ChangeFields(TypedDict):
    path: str
    index: str
    worktree: str
    staged: bool
    unstaged: bool
    untracked: bool


class GitChange(_ChangeFields, total=False):
    originalPath: str


CONFLICTS = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}


def git(*args, cwd=None):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    result = subprocess.run(
        ["git", *args], cwd=cwd, env=env, capture_output=True, check=True
    )
    return result.stdout


def line(data):
    return os.fsdecode(data.removesuffix(b"\n"))


def status():
    root = line(git("rev-parse", "--show-toplevel"))
    git_dir = line(git("rev-parse", "--absolute-git-dir", cwd=root))
    branch = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "HEAD"],
        cwd=root,
        capture_output=True,
    )
    if branch.returncode not in (0, 1):
        branch.check_returncode()
    head = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        cwd=root,
        capture_output=True,
    )
    if head.returncode not in (0, 1):
        head.check_returncode()

    entries = git(
        "status", "--porcelain=v1", "-z", "--untracked-files=all", cwd=root
    ).split(b"\0")
    changes: list[GitChange] = []
    i = 0
    while i < len(entries) and entries[i]:
        entry = entries[i]
        i += 1
        xy = entry[:2].decode("ascii")
        item: GitChange = {
            "path": os.fsdecode(entry[3:]),
            "index": xy[0],
            "worktree": xy[1],
            "staged": xy[0] not in " ?!",
            "unstaged": xy[1] not in " ?!",
            "untracked": xy == "??",
        }
        if "R" in xy or "C" in xy:
            item["originalPath"] = os.fsdecode(entries[i])
            i += 1
        changes.append(item)

    return {
        "repository": root,
        "gitDir": git_dir,
        "branch": (
            line(branch.stdout).removeprefix("refs/heads/")
            if branch.returncode == 0
            else None
        ),
        "head": line(head.stdout) if head.returncode == 0 else None,
        "conflicts": any(c["index"] + c["worktree"] in CONFLICTS for c in changes),
        "changes": changes,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(status(), ensure_ascii=True))
    except (OSError, subprocess.CalledProcessError) as error:
        print(
            json.dumps(
                {"error": "git_status_failed", "message": str(type(error).__name__)}
            )
        )
        sys.exit(1)
