"""Installed as git/gh/ssh in the isolated test PATH; never contact GitHub."""

import json
import os
import subprocess
import sys
from pathlib import Path

args = sys.argv[1:]
tool = Path(sys.argv[0]).name
real_git = os.environ["REAL_GIT"]
remote = os.environ["REMOTE_PATH"]

if tool == "git":
    args = [remote if x == "git@github-work:owner/repo.git" else x for x in args]
    sys.exit(subprocess.run([real_git, *args]).returncode)
if tool == "ssh":
    assert args == ["-G", "-l", "git", "--", "github-work"], args
    print("hostname github.com")
    sys.exit(0)

assert tool == "gh"
with open(os.environ["GH_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
state_path = Path(os.environ["GH_STATE"])
state = json.loads(state_path.read_text())
mode = os.environ.get("GH_MODE", "")


def fail():
    print("SECRET_TRANSPORT_ERROR", file=sys.stderr)
    sys.exit(1)


def flag(name):
    return args[args.index(name) + 1]


def sha(branch):
    return (
        subprocess.check_output(
            [real_git, "-C", remote, "rev-parse", "refs/heads/" + branch]
        )
        .decode()
        .strip()
    )


if args[:2] == ["auth", "status"]:
    assert args == ["auth", "status", "--hostname", "github.com"]
    if mode == "auth-fail":
        fail()
    print("Authenticated (SECRET_MUST_NOT_BE_PRINTED)")
elif args[0] == "api":
    assert args == ["api", "--hostname", "github.com", "user"]
    if mode == "bad-json":
        print("not json")
    else:
        print(json.dumps({"login": state["account"]}))
elif args[:2] == ["repo", "view"]:
    assert args[2] == "github.com/owner/repo"
    print(json.dumps(state["metadata"]))
elif args[:2] == ["pr", "list"]:
    assert flag("--repo") == "github.com/owner/repo"
    assert flag("--state") == "all"
    if mode == "list-fail":
        fail()
    print(
        json.dumps(
            [
                {k: pr[k] for k in ("number", "url", "state", "isCrossRepository")}
                for pr in state["prs"]
                if pr["headRefName"] == flag("--head")
                and pr["baseRefName"] == flag("--base")
            ]
        )
    )
elif args[:2] == ["pr", "create"]:
    assert flag("--repo") == "github.com/owner/repo"
    assert flag("--body-file") == "-"
    if mode == "create-fail":
        fail()
    number = len(state["prs"]) + 1
    pr = {
        "number": number,
        "url": f"https://github.com/owner/repo/pull/{number}",
        "state": "OPEN",
        "isDraft": "--draft" in args,
        "title": flag("--title"),
        "body": sys.stdin.read(),
        "baseRefName": flag("--base"),
        "headRefName": flag("--head"),
        "baseRefOid": sha(flag("--base")),
        "headRefOid": sha(flag("--head")),
        "isCrossRepository": False,
    }
    state["prs"].append(pr)
    state_path.write_text(json.dumps(state))
    if mode == "create-error-after-write":
        fail()
    print(pr["url"])
elif args[:2] == ["pr", "view"]:
    assert flag("--repo") == "github.com/owner/repo"
    if mode == "view-fail":
        fail()
    pr = next(pr for pr in state["prs"] if pr["number"] == int(args[2]))
    if mode == "view-mismatch":
        pr["body"] = "changed"
    print(json.dumps(pr))
else:
    raise AssertionError(args)
