"""Execute the documented default Stage procedure against real Git repositories."""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


def stage_example() -> str:
    section = SKILL.read_text().split("### Stage実行", 1)[1].split("## 2.", 1)[0]
    match = re.search(r"```bash\n(.*?)\n```", section, re.DOTALL)
    assert match is not None, "Default Stage must have an executable documented example"
    return match.group(1)


def test_default_stage_includes_pending_paths_and_preserves_staged_only_changes(
    tmp_path: Path, git_env: dict[str, str], git_executable: str
):
    repo = tmp_path / "repo"
    env = {**git_env, "PATH": git_env["PATH"] + os.pathsep + os.defpath}

    def git(*args: str) -> bytes:
        return subprocess.run(
            [git_executable, *args], cwd=repo, env=env, capture_output=True, check=True
        ).stdout

    initial = ["partial", "deleted", "staged-delete", "old-staged", "old-unstaged"]
    for name in initial:
        (repo / name).write_text("base\n")
    (repo / ".gitignore").write_text("ignored*\n")
    git("add", "--", *initial, ".gitignore")
    git("commit", "-m", "base")
    (repo / "partial").write_text("staged part\n")
    git("add", "--", "partial")
    (repo / "partial").write_text("staged part and remainder\n")
    (repo / "deleted").unlink()
    git("rm", "--", "staged-delete")
    git("mv", "--", "old-staged", "new-staged")
    (repo / "old-unstaged").rename(repo / "new-unstaged")
    special = ["space name", "line\nbreak", "tab\tname", "*", ":(glob)literal", "-dash"]
    for name in special + ["ignored-secret"]:
        (repo / name).write_text("new\n")
    child = repo / "child"
    child.mkdir()
    (child / "added").write_text("nested\n")
    parent = tmp_path / "temporary files"
    parent.mkdir()
    shell = shutil.which("bash")
    assert shell is not None
    result = subprocess.run(
        [shell, "-c", stage_example(), "stage", str(parent)],
        cwd=child,
        env=env,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert list(parent.iterdir()) == []
    assert git("diff", "--name-only", "-z") == b""
    assert git("show", ":partial") == b"staged part and remainder\n"
    names = set(git("ls-files", "-z").decode().split("\0")) - {""}
    assert names == {
        ".gitignore",
        "partial",
        "new-staged",
        "new-unstaged",
        "child/added",
        *special,
    }
    assert git("ls-files", "--others", "--exclude-standard", "-z") == b""
    assert (repo / "ignored-secret").exists()


@pytest.mark.parametrize("nested_change", ["tracked", "untracked"])
def test_default_stage_stops_before_parent_mutation_for_nested_submodule_dirt(
    tmp_path: Path,
    git_env: dict[str, str],
    git_executable: str,
    nested_change: str,
):
    repo = tmp_path / "repo"
    env = {**git_env, "PATH": git_env["PATH"] + os.pathsep + os.defpath}

    def git(cwd: Path, *args: str) -> bytes:
        return subprocess.run(
            [git_executable, *args], cwd=cwd, env=env, capture_output=True, check=True
        ).stdout

    source = tmp_path / "submodule-source"
    source.mkdir()
    git(source, "init", "-b", "main")
    git(source, "config", "user.name", "Test User")
    git(source, "config", "user.email", "test@example.invalid")
    (source / "tracked").write_text("base\n")
    git(source, "add", "tracked")
    git(source, "commit", "-m", "base")
    git(
        repo,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        str(source),
        "module",
    )
    git(repo, "commit", "-m", "add submodule")
    (repo / "module" / nested_change).write_text("nested change\n")
    (repo / "parent-new").write_text("must not be staged\n")
    before = git(repo, "ls-files", "--stage", "-z")
    parent = tmp_path / "temporary files"
    parent.mkdir()
    shell = shutil.which("bash")
    assert shell is not None
    result = subprocess.run(
        [shell, "-c", stage_example(), "stage", str(parent)],
        cwd=repo,
        env=env,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert git(repo, "ls-files", "--stage", "-z") == before
    assert list(parent.iterdir()) == []
