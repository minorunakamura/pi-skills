#!/usr/bin/env python3
"""Check staged changes, then commit only an unchanged caller-approved snapshot."""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from git_guard import GuardError, run


def refs(root):
    return dict(
        line.split(" ", 1)
        for line in run(
            "git", "for-each-ref", "--format=%(refname) %(objectname)", cwd=root
        )
        .decode()
        .split("\n")
        if line
    )


def snapshot():
    helper = Path(__file__).with_name("git-status.py")
    state = json.loads(run(sys.executable, str(helper)))
    if state["branch"] is None:
        raise GuardError("detached_head")
    if state["conflicts"]:
        raise GuardError("unmerged_index")
    diff = run(
        "git",
        "--no-pager",
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        "--no-color",
        "--ignore-submodules=none",
        cwd=state["repository"],
    )
    if not diff:
        raise GuardError("empty_staged_diff")
    index = run("git", "ls-files", "--stage", "-z", cwd=state["repository"])
    return {
        **{key: state[key] for key in ("repository", "gitDir", "branch", "head")},
        "tree": run("git", "write-tree", cwd=state["repository"]).decode().strip(),
        "plannedBranch": state["branch"],
        "refs": refs(state["repository"]),
        "diffSha256": hashlib.sha256(diff).hexdigest(),
        "indexSha256": hashlib.sha256(index).hexdigest(),
    }, diff


def scan(diff):
    executable = shutil.which("gitleaks")
    if executable is None:
        return "unavailable"
    help_result = subprocess.run([executable, "stdin", "--help"], capture_output=True)
    help_text = help_result.stdout + help_result.stderr
    if (
        help_result.returncode
        or b"stdin" not in help_text
        or b"--redact" not in help_text
    ):
        raise GuardError("gitleaks_unsupported")
    result = subprocess.run(
        [
            executable,
            "stdin",
            "--redact=100",
            "--exit-code=1",
            "--report-format=json",
            "--report-path=-",
        ],
        input=diff,
        capture_output=True,
    )
    if result.returncode:
        # Only allowlisted report fields may leave the scanner boundary.
        findings = []
        try:
            report = json.loads(result.stdout)
            if isinstance(report, list):
                for item in report:
                    if isinstance(item, dict):
                        findings.append(
                            {
                                "rule": item.get("RuleID"),
                                "diffLine": item.get("StartLine"),
                            }
                        )
        except ValueError, UnicodeError:
            pass
        raise GuardError(
            "gitleaks_failed", exitCode=result.returncode, findings=findings
        )
    return "passed"


def new_branch(root, branch):
    if (
        not isinstance(branch, str)
        or not branch
        or branch == "HEAD"
        or branch.startswith("-")
        or "\0" in branch
    ):
        raise GuardError("invalid_branch")
    try:
        run("git", "check-ref-format", "refs/heads/" + branch, cwd=root)
    except subprocess.CalledProcessError:
        raise GuardError("invalid_branch") from None
    target = "refs/heads/" + branch
    if any(
        ref == target or ref.startswith(target + "/") or target.startswith(ref + "/")
        for ref in refs(root)
    ):
        raise GuardError("branch_exists")


def check(branch=None):
    before, diff = snapshot()
    if branch is not None:
        if branch == before["branch"]:
            raise GuardError("branch_exists")
        new_branch(before["repository"], branch)
        before["plannedBranch"] = branch
    scanned = scan(diff)
    after, _ = snapshot()
    after["plannedBranch"] = before["plannedBranch"]
    if branch is not None:
        new_branch(after["repository"], branch)
    if before != after:
        raise GuardError("state_changed_during_check")
    return {"snapshot": before, "gitleaks": scanned}


def observe(root, branch):
    observed = {}
    body = None
    try:
        helper = Path(__file__).with_name("git-status.py")
        state = json.loads(run(sys.executable, str(helper), cwd=root))
        observed.update(
            {key: state[key] for key in ("repository", "gitDir", "branch", "head")}
        )
        observed["refs"] = refs(root)
        observed["branchRef"] = observed["refs"].get("refs/heads/" + branch)
        if state["head"] is not None:
            raw = run("git", "cat-file", "commit", state["head"], cwd=root)
            headers, body = raw.split(b"\n\n", 1)
            lines = headers.split(b"\n")
            observed["tree"] = next(
                line[5:].decode() for line in lines if line.startswith(b"tree ")
            )
            observed["parents"] = [
                line[7:].decode() for line in lines if line.startswith(b"parent ")
            ]
            observed["messageSha256"] = hashlib.sha256(body).hexdigest()
        observed["indexSha256"] = hashlib.sha256(
            run("git", "ls-files", "--stage", "-z", cwd=root)
        ).hexdigest()
        observed["indexTree"] = run("git", "write-tree", cwd=root).decode().strip()
    except (OSError, subprocess.SubprocessError, ValueError, StopIteration) as error:
        observed["observationError"] = type(error).__name__
    return observed, body


def commit(request):
    if not isinstance(request, dict):
        raise GuardError("invalid_commit_request")
    checked = request.get("check")
    message = request.get("message")
    if (
        not isinstance(checked, dict)
        or checked.get("gitleaks") not in ("passed", "unavailable")
        or not isinstance(checked.get("snapshot"), dict)
        or not isinstance(message, str)
        or not message.strip()
        or "\0" in message
    ):
        raise GuardError("invalid_commit_request")
    try:
        message_bytes = message.encode("utf-8")
    except UnicodeError:
        raise GuardError("invalid_commit_request") from None
    current, _ = snapshot()
    current["plannedBranch"] = checked["snapshot"].get("plannedBranch")
    if current != checked["snapshot"]:
        raise GuardError("state_changed_before_commit")
    if current["plannedBranch"] != current["branch"]:
        new_branch(current["repository"], current["plannedBranch"])
        try:
            run(
                "git",
                "switch",
                "--no-track",
                "-c",
                current["plannedBranch"],
                cwd=current["repository"],
            )
        except (OSError, subprocess.SubprocessError) as error:
            observed, _ = observe(current["repository"], current["plannedBranch"])
            raise GuardError(
                "git_branch_failed",
                branchMayHaveChanged=True,
                observed=observed,
                message=type(error).__name__,
            ) from None
        expected_refs = dict(current["refs"])
        if current["head"] is not None:
            expected_refs["refs/heads/" + current["plannedBranch"]] = current["head"]
        try:
            after, _ = snapshot()
        except GuardError, OSError, ValueError, subprocess.SubprocessError:
            after = None
        if after != {
            **current,
            "branch": current["plannedBranch"],
            "refs": expected_refs,
        }:
            observed, _ = observe(current["repository"], current["plannedBranch"])
            raise GuardError(
                "state_changed_before_commit",
                branchMayHaveChanged=True,
                observed=observed,
            )
    # shortcut: verification is not atomic; coordinate writers if concurrent Git operations are required.
    try:
        run(
            "git",
            "commit",
            "--cleanup=verbatim",
            "--file=-",
            cwd=current["repository"],
            input=message_bytes,
        )
    except (OSError, subprocess.SubprocessError) as error:
        observed, _ = observe(current["repository"], current["plannedBranch"])
        details = (
            {"exitCode": error.returncode}
            if isinstance(error, subprocess.CalledProcessError)
            else {"message": type(error).__name__}
        )
        raise GuardError(
            "git_commit_failed",
            operationMayHaveSucceeded=True,
            observed=observed,
            **details,
        ) from None
    observed, body = observe(current["repository"], current["plannedBranch"])
    expected_refs = {
        **current["refs"],
        "refs/heads/" + current["plannedBranch"]: observed.get("head"),
    }
    message_matches = body == message_bytes or (
        not message_bytes.endswith(b"\n") and body == message_bytes + b"\n"
    )
    if (
        observed.get("observationError")
        or any(
            observed.get(key) != current[key]
            for key in ("repository", "gitDir", "indexSha256")
        )
        or observed.get("branch") != current["plannedBranch"]
        or observed.get("branchRef") != observed.get("head")
        or observed.get("refs") != expected_refs
        or observed.get("head") == current["head"]
        or observed.get("indexTree") != current["tree"]
        or observed.get("tree") != current["tree"]
        or observed.get("parents") != ([current["head"]] if current["head"] else [])
        or not message_matches
    ):
        raise GuardError(
            "commit_verification_failed",
            operationMayHaveSucceeded=True,
            observed=observed,
        )
    return {
        "commit": observed["head"],
        "branch": observed["branch"],
        **{key: observed[key] for key in ("parents", "tree", "messageSha256")},
        "gitleaks": checked["gitleaks"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("check", "commit"))
    parser.add_argument("--branch")
    args = parser.parse_args()
    try:
        if args.operation == "commit" and args.branch is not None:
            raise GuardError("invalid_input")
        result = (
            check(args.branch)
            if args.operation == "check"
            else commit(json.load(sys.stdin.buffer))
        )
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except GuardError as error:
        result = error.result
    except ValueError, UnicodeError:
        result = {"error": "invalid_input"}
    except (OSError, subprocess.SubprocessError) as error:
        result = {"error": "command_failed", "message": type(error).__name__}
    print(json.dumps(result, ensure_ascii=True))
    return 1


if __name__ == "__main__":
    sys.exit(main())
