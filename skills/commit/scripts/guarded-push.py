#!/usr/bin/env python3
"""Check a push destination, then push only the caller-approved commit SHA."""

import argparse
import json
import subprocess
import sys

from git_guard import (
    GuardError,
    branch_upstream,
    commit_log,
    emit,
    existing_head_source,
    git,
    local_state,
    push_destination,
    push_url,
    remote_fetch_refspecs,
    remote_refs,
    require_commit,
    run,
    validate_commit_check,
    validate_existing_push,
    validate_prepared_commit,
    validate_push_preparation,
)


def snapshot(remote, target=None, initial_main=False, set_upstream=False):
    return push_destination(local_state(), remote, target, initial_main, set_upstream)


def prepare(request, remote, target=None, initial_main=False, set_upstream=False):
    if not isinstance(request, dict):
        raise GuardError("invalid_push_preparation")
    checked = request.get("commitCheck")
    state = validate_commit_check(checked)
    planned = checked["snapshot"]["plannedBranch"]
    planned_state = {
        **state,
        "branch": planned,
        "upstream": branch_upstream(state["repository"], planned),
    }
    before = push_destination(planned_state, remote, target, initial_main, set_upstream)
    expected_upstream = {"remote": remote, "merge": "refs/heads/" + before["target"]}
    if set_upstream and before["upstream"] not in (
        {"remote": None, "merge": None},
        expected_upstream,
    ):
        raise GuardError("conflicting_upstream")
    base = before["remoteHead"] or before["defaultHead"]
    if base is not None:
        require_commit(state["repository"], base)
    commits = (
        commit_log(state["repository"], state["head"], base) if state["head"] else []
    )
    if (
        before
        != push_destination(planned_state, remote, target, initial_main, set_upstream)
        or branch_upstream(state["repository"], planned) != planned_state["upstream"]
        or validate_commit_check(checked) != state
    ):
        raise GuardError("state_changed_during_preparation")
    return {
        "kind": "push-preparation",
        "commitCheck": checked,
        "sourceUpstream": state["upstream"],
        "destination": before,
        "commits": commits,
    }


def prepare_existing(
    request, remote, target=None, initial_main=False, set_upstream=False, branch=None
):
    if request != {}:
        raise GuardError("invalid_push_preparation")
    source = existing_head_source(branch)
    state = {
        key: source[key]
        for key in ("repository", "gitDir", "branch", "head", "upstream")
    }
    planned_state = {
        **state,
        "branch": source["plannedBranch"],
        "upstream": source["plannedUpstream"],
    }
    destination = push_destination(
        planned_state, remote, target, initial_main, set_upstream
    )
    preparation = {
        "kind": "push-existing-head-preparation",
        "source": source,
        "destination": destination,
        "commits": commit_log(
            state["repository"],
            state["head"],
            destination["remoteHead"] or destination["defaultHead"],
        ),
        "fetchRefspecs": remote_fetch_refspecs(state["repository"], remote),
    }
    validate_existing_push(preparation, before_branch=True)
    return preparation


def observe_branch():
    try:
        return local_state()
    except (
        GuardError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ):
        return {"observationError": True}


def branch(request):
    if not isinstance(request, dict) or set(request) != {"preparation"}:
        raise GuardError("invalid_push_preparation")
    preparation = request["preparation"]
    state = validate_existing_push(preparation, before_branch=True)
    source = preparation["source"]
    if source["branch"] == state["branch"]:
        raise GuardError("no_planned_branch")
    try:
        git(state["repository"], "switch", "--no-track", "-c", state["branch"])
    except OSError, subprocess.SubprocessError:
        raise GuardError(
            "git_branch_failed", branchMayHaveChanged=True, observed=observe_branch()
        ) from None
    try:
        validate_existing_push(preparation)
    except (
        GuardError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ):
        raise GuardError(
            "branch_verification_failed",
            branchMayHaveChanged=True,
            observed=observe_branch(),
        ) from None
    return {
        "status": "branch_created",
        "branch": state["branch"],
        "commit": state["head"],
        "sourceBranch": source["branch"],
        "sourceHead": source["head"],
    }


def check(remote, target=None, initial_main=False, set_upstream=False):
    before = snapshot(remote, target, initial_main, set_upstream)
    base = before["remoteHead"] or before["defaultHead"]
    commits = commit_log(before["repository"], before["head"], base)
    if before != snapshot(remote, target, initial_main, set_upstream):
        raise GuardError("state_changed_during_check")
    return {
        "snapshot": before,
        "commits": commits,
        "alreadyPushed": before["remoteHead"] == before["head"],
    }


def check_prepared(request):
    if not isinstance(request, dict):
        raise GuardError("invalid_push_preparation")
    preparation = request.get("preparation")
    if (
        isinstance(preparation, dict)
        and preparation.get("kind") == "push-existing-head-preparation"
    ):
        if set(request) != {"preparation"}:
            raise GuardError("invalid_push_preparation")
        state = validate_existing_push(preparation)
        before = preparation["destination"]
        commits = commit_log(
            state["repository"],
            state["head"],
            before["remoteHead"] or before["defaultHead"],
        )
        validate_existing_push(preparation)
        return {
            "snapshot": before,
            "commits": commits,
            "alreadyPushed": before["remoteHead"] == state["head"],
            "existingHeadPreparation": preparation,
        }
    if (
        not isinstance(preparation, dict)
        or preparation.get("kind") != "push-preparation"
        or not isinstance(preparation.get("destination"), dict)
    ):
        raise GuardError("invalid_push_preparation")
    checked = preparation.get("commitCheck")
    result = request.get("commit")
    state = validate_prepared_commit(checked, result)
    validate_push_preparation(preparation, state)
    before = preparation["destination"]
    base = before["remoteHead"] or before["defaultHead"]
    commits = commit_log(state["repository"], state["head"], base)
    # Recheck the retained state after collecting execution material, never refresh it.
    validate_push_preparation(preparation, state)
    after = validate_prepared_commit(checked, result)
    if after != state:
        raise GuardError("push_preparation_changed")
    return {
        "snapshot": {**before, "head": state["head"]},
        "commits": commits,
        "alreadyPushed": before["remoteHead"] == state["head"],
    }


def observe(snapshot):
    try:
        return remote_refs(snapshot["repository"], snapshot["pushUrl"])["refs"].get(
            "refs/heads/" + snapshot["target"]
        )
    except GuardError, OSError, ValueError, subprocess.SubprocessError:
        return None


def push(request):
    if not isinstance(request, dict) or not isinstance(request.get("check"), dict):
        raise GuardError("invalid_push_request")
    checked = request["check"].get("snapshot")
    if (
        not isinstance(checked, dict)
        or not isinstance(checked.get("initialMain"), bool)
        or not isinstance(checked.get("setUpstream"), bool)
    ):
        raise GuardError("invalid_push_request")
    preparation = request["check"].get("existingHeadPreparation")
    if preparation is not None:
        executable = check_prepared({"preparation": preparation})
        if executable != request["check"]:
            raise GuardError("invalid_push_request")
    current = snapshot(
        checked.get("remote"),
        checked.get("target"),
        checked["initialMain"],
        checked["setUpstream"],
    )
    if current != checked:
        raise GuardError("state_changed_before_push")
    root = current["repository"]
    already_pushed = current["remoteHead"] == current["head"]
    if not already_pushed:
        try:
            # Freeze the source SHA; disable implicit tag and submodule pushes, not hooks.
            run(
                "git",
                "-c",
                "push.followTags=false",
                "-c",
                "remote." + current["remote"] + ".mirror=false",
                "push",
                "--porcelain",
                "--recurse-submodules=no",
                "--",
                current["remote"],
                current["head"] + ":refs/heads/" + current["target"],
                cwd=root,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise GuardError(
                "push_result_unknown"
                if isinstance(error, subprocess.TimeoutExpired)
                else "push_failed",
                remoteMayHaveChanged=True,
                expectedHead=current["head"],
                observedHead=observe(current),
            ) from None
    observed = observe(current)
    if observed != current["head"]:
        raise GuardError(
            "push_verification_failed",
            remoteMayHaveChanged=True,
            expectedHead=current["head"],
            observedHead=observed,
        )
    try:
        if local_state() != {
            k: current[k]
            for k in ("repository", "gitDir", "branch", "head", "upstream")
        }:
            raise GuardError("local_state_changed_after_push")
        if push_url(root, current["remote"]) != current["pushUrl"]:
            raise GuardError("destination_changed_after_push")
        if preparation is not None:
            validate_existing_push(preparation, after_push=True, before_upstream=True)
        if current["setUpstream"]:
            # A SHA refspec cannot use push -u; configure the approved local branch only.
            key = "branch." + current["branch"]
            git(root, "config", "--local", key + ".remote", current["remote"])
            git(
                root,
                "config",
                "--local",
                key + ".merge",
                "refs/heads/" + current["target"],
            )
    except GuardError, OSError, subprocess.SubprocessError:
        raise GuardError(
            "post_push_local_update_failed",
            remoteMayHaveChanged=True,
            observedHead=observed,
        ) from None
    if preparation is not None:
        try:
            validate_existing_push(preparation, after_push=True)
        except (
            GuardError,
            OSError,
            ValueError,
            KeyError,
            TypeError,
            subprocess.SubprocessError,
        ):
            raise GuardError(
                "post_push_verification_failed",
                remoteMayHaveChanged=True,
                observedHead=observed,
            ) from None
    return {
        "status": "already_pushed" if already_pushed else "pushed",
        "commit": current["head"],
        "branch": current["branch"],
        "remote": current["remote"],
        "target": current["target"],
        "upstreamConfigured": current["setUpstream"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    for operation in ("prepare", "check"):
        checking = sub.add_parser(operation)
        checking.add_argument("--remote", required=operation == "prepare")
        checking.add_argument("--target")
        checking.add_argument("--initial-main", action="store_true")
        checking.add_argument("--set-upstream", action="store_true")
        if operation == "prepare":
            checking.add_argument("--existing-head", action="store_true")
            checking.add_argument("--branch")
        if operation == "check":
            checking.add_argument("--prepared", action="store_true")
    sub.add_parser("push")
    sub.add_parser("branch")
    args = parser.parse_args()

    def action():
        if args.operation == "branch":
            return branch(json.load(sys.stdin.buffer))
        if args.operation == "push":
            return push(json.load(sys.stdin.buffer))
        if args.operation == "check" and args.prepared:
            if (
                args.remote is not None
                or args.target is not None
                or args.initial_main
                or args.set_upstream
            ):
                raise GuardError("invalid_input")
            return check_prepared(json.load(sys.stdin.buffer))
        if args.remote is None:
            raise GuardError("invalid_input")
        if args.operation == "prepare":
            if args.existing_head:
                return prepare_existing(
                    json.load(sys.stdin.buffer),
                    args.remote,
                    args.target,
                    args.initial_main,
                    args.set_upstream,
                    args.branch,
                )
            if args.branch is not None:
                raise GuardError("invalid_input")
            return prepare(
                json.load(sys.stdin.buffer),
                args.remote,
                args.target,
                args.initial_main,
                args.set_upstream,
            )
        return check(args.remote, args.target, args.initial_main, args.set_upstream)

    return emit(action)


if __name__ == "__main__":
    sys.exit(main())
