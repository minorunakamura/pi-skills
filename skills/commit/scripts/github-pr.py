#!/usr/bin/env python3
"""Inspect a pushed branch, then create a PR for an unchanged approved snapshot."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

from git_guard import (
    GuardError,
    branch_name,
    branch_upstream,
    checked_commit_snapshot,
    commit_log,
    emit,
    git,
    github_location,
    local_state,
    mapped_tracking_refs,
    push_url,
    remote_fetch_refspecs,
    remote_refs,
    require_commit,
    required_text,
    run,
    validate_commit_check,
    validate_existing_push,
    validate_prepared_commit,
    validate_push_preparation,
)

PR_FIELDS = "number,url,state,isDraft,title,body,baseRefName,headRefName,baseRefOid,headRefOid,isCrossRepository"


def repo_identifier(value):
    required_text(value)
    parts = value.split("/")
    if len(parts) == 2:
        parts.insert(0, "github.com")
    if (
        len(parts) != 3
        or any(not re.fullmatch(r"[A-Za-z0-9_.-]+", x) for x in parts)
        or any(x in (".", "..") or x.startswith("-") for x in parts)
    ):
        raise GuardError("invalid_github_repository")
    return parts[0].lower(), "/".join(parts[1:])


def gh_json(*args, cwd=None):
    return json.loads(run("gh", *args, cwd=cwd))


def facts(remote, repo, base=None):
    return metadata(local_state(), remote, repo, base, require_pushed=True)


def metadata(local, remote, repo, base=None, *, require_pushed=False):
    host, slug = repo_identifier(repo)
    root = local["repository"]
    url = push_url(root, remote)
    remote_host, remote_slug = github_location(root, url)
    if remote_host != host or remote_slug.lower() != slug.lower():
        raise GuardError("github_remote_mismatch")
    run("gh", "auth", "status", "--hostname", host, cwd=root)
    account = required_text(
        gh_json("api", "--hostname", host, "user", cwd=root)["login"]
    )
    metadata = gh_json(
        "repo",
        "view",
        host + "/" + slug,
        "--json",
        "nameWithOwner,url,defaultBranchRef,viewerPermission,pullRequestTemplates",
        cwd=root,
    )
    if (
        not isinstance(metadata, dict)
        or not isinstance(metadata.get("nameWithOwner"), str)
        or not isinstance(metadata.get("url"), str)
    ):
        raise GuardError("invalid_repository_response")
    if (
        metadata["nameWithOwner"].lower() != slug.lower()
        or metadata["url"].lower().rstrip("/")
        != ("https://" + host + "/" + slug).lower()
    ):
        raise GuardError("github_repository_mismatch")
    if metadata["viewerPermission"] not in ("WRITE", "MAINTAIN", "ADMIN"):
        raise GuardError("insufficient_repository_permission")
    repo = host + "/" + metadata["nameWithOwner"]
    observed = remote_refs(root, url)
    default = metadata["defaultBranchRef"]["name"]
    if observed["defaultBranch"] != default:
        raise GuardError("default_branch_mismatch")
    base = branch_name(base if base is not None else default)
    if local["branch"] == base:
        raise GuardError("same_head_and_base")
    base_sha = observed["refs"].get("refs/heads/" + base)
    head_sha = observed["refs"].get("refs/heads/" + local["branch"])
    if not base_sha:
        raise GuardError("missing_base_branch")
    if require_pushed and head_sha != local["head"]:
        raise GuardError("head_not_pushed")
    templates = metadata["pullRequestTemplates"] or []
    if not isinstance(templates, list) or any(
        not isinstance(t, dict)
        or not isinstance(t.get("filename"), str)
        or not isinstance(t.get("body"), str)
        for t in templates
    ):
        raise GuardError("invalid_template_response")
    templates = [{"filename": t["filename"], "body": t["body"]} for t in templates]
    snapshot = {
        **local,
        "remote": remote,
        "pushUrl": url,
        "githubRepository": repo,
        "account": account,
        "permission": metadata["viewerPermission"],
        "defaultBranch": default,
        "base": base,
        "baseHead": base_sha,
        "templatesSha256": hashlib.sha256(
            json.dumps(templates, sort_keys=True).encode()
        ).hexdigest(),
    }
    return snapshot, templates


def existing_prs(snapshot):
    items = gh_json(
        "pr",
        "list",
        "--repo",
        snapshot["githubRepository"],
        "--state",
        "all",
        "--head",
        snapshot["branch"],
        "--base",
        snapshot["base"],
        "--limit",
        "100",
        "--json",
        "number,url,state,isCrossRepository",
        cwd=snapshot["repository"],
    )
    if not isinstance(items, list):
        raise GuardError("invalid_pr_list_response")
    # shortcut: stop at the query limit; add pagination if a branch accumulates 100 PRs.
    if len(items) >= 100:
        raise GuardError("pr_list_limit_reached")
    result = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(
            item.get("isCrossRepository"), bool
        ):
            raise GuardError("invalid_pr_list_response")
        if not item["isCrossRepository"]:
            number = pr_number(item["url"], snapshot)
            if (
                type(item["number"]) is not int
                or item["number"] != int(number)
                or item["state"] not in ("OPEN", "CLOSED", "MERGED")
            ):
                raise GuardError("invalid_pr_list_response")
            result.append({key: item[key] for key in ("number", "url", "state")})
    return result


def pr_number(url, snapshot):
    parsed = urlsplit(required_text(url))
    host, slug = repo_identifier(snapshot["githubRepository"])
    match = re.fullmatch(
        "/" + re.escape(slug) + r"/pull/([1-9][0-9]*)", parsed.path, re.IGNORECASE
    )
    if (
        parsed.scheme != "https"
        or parsed.netloc.lower() != host
        or not match
        or parsed.query
        or parsed.fragment
    ):
        raise GuardError("unexpected_pr_url")
    return match.group(1)


def check(remote, repo, base=None):
    before, templates = facts(remote, repo, base)
    root, head, base_sha = before["repository"], before["head"], before["baseHead"]
    existing = existing_prs(before)
    diff, commits = None, []
    if not existing:
        require_commit(root, base_sha)
        bases = git(root, "merge-base", "--all", base_sha, head).decode().splitlines()
        if len(bases) != 1:
            raise GuardError("ambiguous_merge_base")
        raw_diff = git(
            root,
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--binary",
            "--ignore-submodules=none",
            base_sha + "..." + head,
            "--",
        )
        if not raw_diff:
            raise GuardError("empty_pr_diff")
        if len(raw_diff) > 2 * 1024 * 1024:
            raise GuardError("pr_diff_too_large")
        diff = raw_diff.decode()
        commits = commit_log(root, head, base_sha)
    after, _ = facts(remote, repo, before["base"])
    if before != after:
        raise GuardError("state_changed_during_check")
    return {
        "snapshot": before,
        "diff": diff,
        "commits": commits,
        "templates": templates,
        "existingPullRequests": existing,
    }


def retained_push(request):
    if not isinstance(request, dict):
        raise GuardError("invalid_pr_preparation")
    pushed = request.get("pushPreparation")
    checked = request.get("commitCheck")
    if (
        not isinstance(pushed, dict)
        or pushed.get("kind") != "push-preparation"
        or pushed.get("commitCheck") != checked
        or not isinstance(pushed.get("destination"), dict)
    ):
        raise GuardError("invalid_pr_preparation")
    before = pushed["destination"]
    if not isinstance(before.get("initialMain"), bool) or not isinstance(
        before.get("setUpstream"), bool
    ):
        raise GuardError("invalid_pr_preparation")
    return checked, pushed, before


def planned_materials(root, base, parent, tree):
    require_commit(root, base)
    require_commit(root, parent)
    bases = git(root, "merge-base", "--all", base, parent).decode().splitlines()
    if len(bases) != 1:
        raise GuardError("ambiguous_merge_base")
    args = (
        "--no-pager",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-renames",
        "--ignore-submodules=none",
    )
    diff = git(root, *args, "--binary", bases[0], tree, "--")
    if len(diff) > 2 * 1024 * 1024:
        raise GuardError("pr_diff_too_large")
    raw = git(root, *args, "--raw", "-z", "--no-abbrev", bases[0], tree, "--")
    parts = raw.split(b"\0")
    units = []
    for i in range(0, len(parts) - 1, 2):
        old_mode, new_mode, old_oid, new_oid, _ = parts[i].decode().lstrip(":").split()
        units.append(
            {
                "path": os.fsdecode(parts[i + 1]),
                "oldMode": old_mode,
                "newMode": new_mode,
                "oldOid": old_oid,
                "newOid": new_oid,
            }
        )
    return {
        "mergeBase": bases[0],
        "diffSha256": hashlib.sha256(diff).hexdigest(),
        "units": units,
    }, diff.decode()


def prepare(request, remote, repo, base=None):
    checked, pushed, before = retained_push(request)
    state = validate_commit_check(checked)
    planned = checked["snapshot"]["plannedBranch"]
    if (
        before.get("remote") != remote
        or before.get("branch") != planned
        or before.get("target") != planned
    ):
        raise GuardError("pr_push_destination_mismatch")
    planned_state = validate_push_preparation(pushed, state)
    destination, templates = metadata(planned_state, remote, repo, base)
    if destination["pushUrl"] != before.get("pushUrl"):
        raise GuardError("pr_push_destination_mismatch")
    existing = existing_prs(destination)
    materials, diff = planned_materials(
        state["repository"],
        destination["baseHead"],
        state["head"],
        checked["snapshot"]["tree"],
    )
    if not diff and not existing:
        raise GuardError("empty_pr_diff")
    commits = commit_log(state["repository"], state["head"], destination["baseHead"])
    fetch_specs = remote_fetch_refspecs(state["repository"], remote)
    mapped_tracking_refs(fetch_specs, planned)
    after, _ = metadata(planned_state, remote, repo, destination["base"])
    validate_push_preparation(pushed, state)
    if (
        after != destination
        or validate_commit_check(checked) != state
        or remote_fetch_refspecs(state["repository"], remote) != fetch_specs
    ):
        raise GuardError("state_changed_during_preparation")
    return {
        "kind": "pr-preparation",
        "commitCheck": checked,
        "pushPreparation": pushed,
        "destination": destination,
        **materials,
        "fetchRefspecs": fetch_specs,
        "commitsSha256": history_digest(commits),
        "diff": None if existing else diff,
        "commits": [] if existing else commits,
        "templates": [] if existing else templates,
        "existingPullRequests": existing,
    }


def prepare_existing(request, remote, repo, base=None):
    if not isinstance(request, dict) or set(request) != {"pushPreparation"}:
        raise GuardError("invalid_pr_preparation")
    pushed = request["pushPreparation"]
    state = validate_existing_push(pushed, before_branch=True)
    before = pushed["destination"]
    if (
        before["remote"] != remote
        or before["target"] != state["branch"]
        or before["initialMain"]
    ):
        raise GuardError("pr_push_destination_mismatch")
    destination, templates = metadata(state, remote, repo, base)
    existing = existing_prs(destination)
    materials, diff = planned_materials(
        state["repository"],
        destination["baseHead"],
        state["head"],
        pushed["source"]["tree"],
    )
    if not diff and not existing:
        raise GuardError("empty_pr_diff")
    commits = commit_log(state["repository"], state["head"], destination["baseHead"])
    after, _ = metadata(state, remote, repo, destination["base"])
    if (
        after != destination
        or validate_existing_push(pushed, before_branch=True) != state
    ):
        raise GuardError("state_changed_during_preparation")
    return {
        "kind": "pr-existing-head-preparation",
        "pushPreparation": pushed,
        "destination": destination,
        **materials,
        "commitsSha256": history_digest(commits),
        "diff": None if existing else diff,
        "commits": [] if existing else commits,
        "templates": [] if existing else templates,
        "existingPullRequests": existing,
    }


def verify_existing(request, *, after_push=False):
    if set(request) != {"preparation"}:
        raise GuardError("invalid_pr_preparation")
    preparation = request["preparation"]
    if set(preparation) != {
        "kind",
        "pushPreparation",
        "destination",
        "mergeBase",
        "diffSha256",
        "units",
        "commitsSha256",
        "diff",
        "commits",
        "templates",
        "existingPullRequests",
    } or not isinstance(preparation.get("destination"), dict):
        raise GuardError("invalid_pr_preparation")
    pushed = preparation["pushPreparation"]
    state = validate_existing_push(pushed, after_push=after_push)
    before, destination = pushed["destination"], preparation["destination"]
    if (
        before["target"] != state["branch"]
        or before["initialMain"]
        or any(
            destination.get(key) != before.get(key)
            for key in (
                "repository",
                "gitDir",
                "branch",
                "head",
                "upstream",
                "remote",
                "pushUrl",
                "defaultBranch",
            )
        )
    ):
        raise GuardError("pr_push_destination_mismatch")
    current, _ = metadata(
        state,
        destination.get("remote"),
        destination.get("githubRepository"),
        destination.get("base"),
        require_pushed=after_push,
    )
    materials, _ = planned_materials(
        state["repository"],
        current["baseHead"],
        state["head"],
        pushed["source"]["tree"],
    )
    commits = commit_log(state["repository"], state["head"], current["baseHead"])
    if (
        current != {**destination, "upstream": state["upstream"]}
        or any(preparation.get(key) != value for key, value in materials.items())
        or history_digest(commits) != preparation.get("commitsSha256")
    ):
        raise GuardError("pr_preparation_changed")
    after, _ = metadata(
        state,
        current["remote"],
        current["githubRepository"],
        current["base"],
        require_pushed=after_push,
    )
    if (
        after != current
        or validate_existing_push(pushed, after_push=after_push) != state
    ):
        raise GuardError("pr_preparation_changed")
    if after_push:
        executable = check(
            current["remote"], current["githubRepository"], current["base"]
        )
        if (
            executable["snapshot"] != current
            or validate_existing_push(pushed, after_push=True) != state
        ):
            raise GuardError("pr_preparation_changed")
        return {**executable, "existingHeadPreparation": preparation}
    return {
        "kind": "pr-verification",
        "commit": state["head"],
        "branch": state["branch"],
        "diffSha256": materials["diffSha256"],
    }


def history_digest(commits):
    return hashlib.sha256(json.dumps(commits, sort_keys=True).encode()).hexdigest()


def prepared_state(preparation, result, *, after_push):
    checked, pushed, before = retained_push(preparation)
    original = checked_commit_snapshot(checked)
    destination = preparation["destination"]
    root, planned = original["repository"], original["plannedBranch"]
    if (
        before.get("branch") != planned
        or before.get("target") != planned
        or before.get("head") != original["head"]
        or before.get("repository") != root
        or before.get("gitDir") != original["gitDir"]
        or before.get("initialMain") is not False
        or planned in ("main", before.get("defaultBranch"))
        or any(
            destination.get(key) != before.get(key)
            for key in (
                "repository",
                "gitDir",
                "branch",
                "head",
                "upstream",
                "remote",
                "pushUrl",
                "defaultBranch",
            )
        )
    ):
        raise GuardError("pr_push_destination_mismatch")
    remote = before["remote"]
    specs = remote_fetch_refspecs(root, remote)
    if specs != preparation.get("fetchRefspecs"):
        raise GuardError("pr_preparation_changed")
    mapped = mapped_tracking_refs(specs, planned)
    if not after_push:
        validate_push_preparation(
            pushed,
            {
                key: before[key]
                for key in ("repository", "gitDir", "branch", "head", "upstream")
            },
        )
    state = validate_prepared_commit(
        checked, result, pushed_refs=mapped if after_push else ()
    )
    if not after_push:
        return state
    observed = remote_refs(root, push_url(root, remote))
    upstream = before.get("upstream")
    approved_upstream = {"remote": remote, "merge": "refs/heads/" + planned}
    if before["setUpstream"]:
        if upstream not in ({"remote": None, "merge": None}, approved_upstream):
            raise GuardError("conflicting_upstream")
        upstream = approved_upstream
    source_upstream = (
        upstream if original["branch"] == planned else pushed.get("sourceUpstream")
    )
    base = before.get("remoteHead") or before.get("defaultHead")
    existing_commits = commit_log(root, original["head"], base)
    if (
        state["upstream"] != upstream
        or branch_upstream(root, original["branch"]) != source_upstream
        or push_url(root, remote) != before["pushUrl"]
        or observed["refs"].get("refs/heads/" + planned) != state["head"]
        or observed["defaultBranch"] != before.get("defaultBranch")
        or observed["refs"].get("refs/heads/" + before["defaultBranch"])
        != before.get("defaultHead")
        or before.get("emptyRemote") is not False
        or existing_commits != pushed.get("commits")
    ):
        raise GuardError("push_preparation_changed")
    return state


def verify_prepared(request, *, after_push=False):
    if not isinstance(request, dict) or not isinstance(
        request.get("preparation"), dict
    ):
        raise GuardError("invalid_pr_preparation")
    preparation = request["preparation"]
    if preparation.get("kind") == "pr-existing-head-preparation":
        return verify_existing(request, after_push=after_push)
    if preparation.get("kind") != "pr-preparation" or not isinstance(
        preparation.get("destination"), dict
    ):
        raise GuardError("invalid_pr_preparation")
    checked = preparation.get("commitCheck")
    result = request.get("commit")
    state = prepared_state(preparation, result, after_push=after_push)
    destination = preparation["destination"]
    original = checked["snapshot"]
    current, _ = metadata(
        state,
        destination.get("remote"),
        destination.get("githubRepository"),
        destination.get("base"),
    )
    materials, _ = planned_materials(
        state["repository"], current["baseHead"], state["head"], state["head"]
    )
    commits = commit_log(state["repository"], original["head"], current["baseHead"])
    if (
        current != {**destination, "head": state["head"], "upstream": state["upstream"]}
        or not after_push
        and state["upstream"] != destination.get("upstream")
        or any(preparation.get(key) != value for key, value in materials.items())
        or history_digest(commits) != preparation.get("commitsSha256")
    ):
        raise GuardError("pr_preparation_changed")
    after, _ = metadata(
        state, current["remote"], current["githubRepository"], current["base"]
    )
    if (
        after != current
        or prepared_state(preparation, result, after_push=after_push) != state
    ):
        raise GuardError("pr_preparation_changed")
    if after_push:
        executable = check(
            current["remote"], current["githubRepository"], current["base"]
        )
        if (
            executable["snapshot"] != current
            or prepared_state(preparation, result, after_push=True) != state
        ):
            raise GuardError("pr_preparation_changed")
        return executable
    return {
        "kind": "pr-verification",
        "commit": state["head"],
        "branch": state["branch"],
        "diffSha256": materials["diffSha256"],
    }


def observe(snapshot):
    try:
        return existing_prs(snapshot)
    except (
        GuardError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ):
        return None


def create(request):
    if not isinstance(request, dict) or not isinstance(request.get("check"), dict):
        raise GuardError("invalid_pr_request")
    checked = request["check"].get("snapshot")
    title, body, draft = request.get("title"), request.get("body"), request.get("draft")
    if (
        not isinstance(checked, dict)
        or not isinstance(title, str)
        or not title.strip()
        or any(c in title for c in "\0\r\n")
        or not isinstance(body, str)
        or "\0" in body
        or not isinstance(draft, bool)
    ):
        raise GuardError("invalid_pr_request")
    preparation = request["check"].get("existingHeadPreparation")
    if preparation is not None:
        executable = verify_prepared({"preparation": preparation}, after_push=True)
        if executable["snapshot"] != checked:
            raise GuardError("invalid_pr_request")
    current, _ = facts(
        checked.get("remote"), checked.get("githubRepository"), checked.get("base")
    )
    if current != checked:
        raise GuardError("state_changed_before_pr")
    existing = existing_prs(current)
    if existing:
        return {"status": "existing", "pullRequests": existing}
    args = [
        "gh",
        "pr",
        "create",
        "--repo",
        current["githubRepository"],
        "--base",
        current["base"],
        "--head",
        current["branch"],
        "--title",
        title,
        "--body-file",
        "-",
    ]
    if draft:
        args.append("--draft")
    try:
        response = run(*args, input=body.encode("utf-8"), cwd=current["repository"])
    except (OSError, subprocess.SubprocessError) as error:
        raise GuardError(
            "pr_create_result_unknown"
            if isinstance(error, subprocess.TimeoutExpired)
            else "pr_create_failed",
            operationMayHaveSucceeded=True,
            observedPullRequests=observe(current),
        ) from None
    verified_url = None
    try:
        url = response.decode().strip()
        number = pr_number(url, current)
        verified_url = url
        actual = gh_json(
            "pr",
            "view",
            number,
            "--repo",
            current["githubRepository"],
            "--json",
            PR_FIELDS,
            cwd=current["repository"],
        )
        expected = {
            "url": url,
            "state": "OPEN",
            "isDraft": draft,
            "title": title,
            "body": body,
            "baseRefName": current["base"],
            "headRefName": current["branch"],
            "baseRefOid": current["baseHead"],
            "headRefOid": current["head"],
            "isCrossRepository": False,
        }
        if not isinstance(actual, dict) or any(
            actual.get(key) != value for key, value in expected.items()
        ):
            raise GuardError("pr_content_mismatch")
        after, _ = facts(
            current["remote"], current["githubRepository"], current["base"]
        )
        if after != current:
            raise GuardError("state_changed_after_pr")
        if preparation is not None:
            validate_existing_push(preparation["pushPreparation"], after_push=True)
    except (
        GuardError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ):
        raise GuardError(
            "pr_verification_failed",
            operationMayHaveSucceeded=True,
            url=verified_url,
            observedPullRequests=observe(current),
        ) from None
    return {
        "status": "created",
        "url": url,
        "number": int(number),
        "head": current["head"],
        "base": current["base"],
        "draft": draft,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    for operation in ("prepare", "check"):
        checking = sub.add_parser(operation)
        checking.add_argument("--remote", required=operation == "prepare")
        checking.add_argument(
            "--repo",
            required=operation == "prepare",
            help="[HOST/]OWNER/REPO; same-repository PRs only",
        )
        checking.add_argument("--base")
        if operation == "prepare":
            checking.add_argument("--existing-head", action="store_true")
        if operation == "check":
            checking.add_argument("--prepared", action="store_true")
    sub.add_parser("verify")
    sub.add_parser("create")
    args = parser.parse_args()

    def action():
        if args.operation == "create":
            return create(json.load(sys.stdin.buffer))
        if args.operation == "verify":
            return verify_prepared(json.load(sys.stdin.buffer))
        if args.operation == "check" and args.prepared:
            if any(value is not None for value in (args.remote, args.repo, args.base)):
                raise GuardError("invalid_input")
            return verify_prepared(json.load(sys.stdin.buffer), after_push=True)
        if args.remote is None or args.repo is None:
            raise GuardError("invalid_input")
        if args.operation == "prepare":
            if args.existing_head:
                return prepare_existing(
                    json.load(sys.stdin.buffer), args.remote, args.repo, args.base
                )
            return prepare(
                json.load(sys.stdin.buffer), args.remote, args.repo, args.base
            )
        return check(args.remote, args.repo, args.base)

    return emit(action)


if __name__ == "__main__":
    sys.exit(main())
