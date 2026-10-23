"""Isolated Git environments shared by the script integration tests."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def git_executable() -> str:
    executable = shutil.which("git")
    if executable is None or os.name == "nt":
        pytest.skip("Requires Git and POSIX test executables")
    return executable


@pytest.fixture
def git_env(tmp_path: Path, git_executable: str) -> dict[str, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    (tmp_path / "bin").mkdir()
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("GIT_", "GITLEAKS_", "GH_", "GITHUB_", "SSH_"))
    }
    env.update(
        {
            "PATH": str(tmp_path / "bin"),
            "HOME": str(tmp_path),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        }
    )
    for args in (
        ("init", "-b", "main"),
        ("config", "user.name", "Test User"),
        ("config", "user.email", "test@example.invalid"),
        ("config", "commit.gpgsign", "false"),
    ):
        subprocess.run(
            [git_executable, *args], cwd=repo, env=env, capture_output=True, check=True
        )
    return env
