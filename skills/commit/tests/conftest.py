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
def isolated_env(tmp_path: Path) -> dict[str, str]:
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
    return env


@pytest.fixture
def python_startup_marker(tmp_path: Path, git_env: dict[str, str]) -> Path:
    startup = tmp_path / "startup"
    startup.mkdir()
    marker = tmp_path / "git-status-startup"
    (startup / "sitecustomize.py").write_text(
        "import sys\nfrom pathlib import Path\n"
        "if Path(sys.argv[0]).name == 'git-status.py':\n"
        f"    Path({str(marker)!r}).touch()\n"
    )
    git_env["PYTHONPATH"] = str(startup)
    return marker


@pytest.fixture
def git_env(
    tmp_path: Path, git_executable: str, isolated_env: dict[str, str]
) -> dict[str, str]:
    repo = tmp_path / "repo"
    for args in (
        ("init", "-b", "main"),
        ("config", "user.name", "Test User"),
        ("config", "user.email", "test@example.invalid"),
        ("config", "commit.gpgsign", "false"),
    ):
        subprocess.run(
            [git_executable, *args],
            cwd=repo,
            env=isolated_env,
            capture_output=True,
            check=True,
        )
    return isolated_env
