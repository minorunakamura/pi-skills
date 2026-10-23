#!/usr/bin/env python3
"""Check staged changes, then commit only an unchanged caller-approved snapshot."""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


class GuardError(Exception):
    def __init__(self, code, **details):
        self.result = {"error": code, **details}


def run(*args, input=None, cwd=None):
    return subprocess.run(args, input=input, cwd=cwd, capture_output=True, check=True)


def snapshot():
    helper = Path(__file__).with_name("git-status.py")
    state = json.loads(run(sys.executable, str(helper)).stdout)
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
    ).stdout
    if not diff:
        raise GuardError("empty_staged_diff")
    index = run("git", "ls-files", "--stage", "-z", cwd=state["repository"]).stdout
    return {
        **{key: state[key] for key in ("repository", "gitDir", "branch", "head")},
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


def check():
    before, diff = snapshot()
    scanned = scan(diff)
    after, _ = snapshot()
    if before != after:
        raise GuardError("state_changed_during_check")
    return {"snapshot": before, "gitleaks": scanned}


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
    current, _ = snapshot()
    if current != checked["snapshot"]:
        raise GuardError("state_changed_before_commit")
    # shortcut: verification is not atomic; coordinate writers if concurrent Git operations are required.
    result = subprocess.run(
        ["git", "commit", "--cleanup=verbatim", "--file=-"],
        cwd=current["repository"],
        input=message.encode("utf-8"),
        capture_output=True,
    )
    if result.returncode:
        raise GuardError("git_commit_failed", exitCode=result.returncode)
    head = (
        run("git", "rev-parse", "--verify", "HEAD", cwd=current["repository"])
        .stdout.decode()
        .strip()
    )
    return {
        "commit": head,
        "branch": current["branch"],
        "gitleaks": checked["gitleaks"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("check", "commit"))
    args = parser.parse_args()
    try:
        result = check() if args.operation == "check" else commit(json.load(sys.stdin))
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except GuardError as error:
        result = error.result
    except ValueError, UnicodeError:
        result = {"error": "invalid_input"}
    except (OSError, subprocess.CalledProcessError) as error:
        result = {"error": "command_failed", "message": type(error).__name__}
    print(json.dumps(result, ensure_ascii=True))
    return 1


if __name__ == "__main__":
    sys.exit(main())
