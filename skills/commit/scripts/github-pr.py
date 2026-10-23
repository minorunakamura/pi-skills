#!/usr/bin/env python3
"""Inspect a pushed branch, then create a PR for an unchanged approved snapshot."""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from urllib.parse import urlsplit

from git_guard import (
    GuardError,
    branch_name,
    commit_log,
    emit,
    git,
    github_location,
    local_state,
    push_url,
    remote_refs,
    require_commit,
    required_text,
    run,
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
    host, slug = repo_identifier(repo)
    local = local_state()
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
    if head_sha != local["head"]:
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
    checking = sub.add_parser("check")
    checking.add_argument("--remote", required=True)
    checking.add_argument(
        "--repo", required=True, help="[HOST/]OWNER/REPO; same-repository PRs only"
    )
    checking.add_argument("--base")
    sub.add_parser("create")
    args = parser.parse_args()
    return emit(
        lambda: (
            check(args.remote, args.repo, args.base)
            if args.operation == "check"
            else create(json.load(sys.stdin.buffer))
        )
    )


if __name__ == "__main__":
    sys.exit(main())
