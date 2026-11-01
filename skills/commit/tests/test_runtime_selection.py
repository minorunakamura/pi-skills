"""Check the documented startup probe, not the LLM's execution of the workflow."""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parents[1] / "references" / "workflow.md"


def startup_probe() -> str:
    match = re.search(r"```sh\n(.*?)\n```", SKILL.read_text(), re.DOTALL)
    assert match is not None
    return match.group(1)


@pytest.mark.parametrize(
    ("version", "broken", "expected_code"),
    [
        (None, False, 4),
        ((3, 13, 11), False, 3),
        ((3, 14, 0), False, 0),
        ((3, 15, 0), False, 0),
        ((3, 14, 0), True, 42),
    ],
    ids=["missing", "older", "supported", "newer", "startup-failure"],
)
def test_documented_python_probe_does_not_touch_git(
    tmp_path: Path,
    version: tuple[int, int, int] | None,
    broken: bool,
    expected_code: int,
):
    shell = shutil.which("sh")
    if shell is None or os.name == "nt":
        pytest.skip("Requires a POSIX shell")
    bin_path = tmp_path / "bin"
    bin_path.mkdir()
    python = bin_path / "python3"
    if version is not None:
        body = (
            "import sys\nsys.exit(42)\n"
            if broken
            else (
                f"import sys\nsys.version_info = {version!r}\n"
                "sys.executable = sys.argv[0]\nexec(sys.argv[sys.argv.index('-c') + 1])\n"
            )
        )
        python.write_text(f"#!{sys.executable}\n" + body)
        python.chmod(0o700)
    marker = tmp_path / "git-was-called"
    git = bin_path / "git"
    git.write_text(
        f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(marker)!r}).touch()\n"
    )
    git.chmod(0o700)
    result = subprocess.run(
        [shell, "-c", startup_probe()],
        cwd=tmp_path,
        env={"PATH": str(bin_path), "HOME": str(tmp_path)},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == expected_code, result.stdout + result.stderr
    assert not marker.exists()
    if version is None:
        assert result.stdout == "python3=missing\n"
    elif broken:
        assert result.stdout == ""
    else:
        assert result.stdout.splitlines() == [
            "python-version=" + ".".join(map(str, version)),
            "python-executable=" + repr(str(python)),
        ]


def test_probe_does_not_load_python_startup_code(tmp_path: Path):
    shell = shutil.which("sh")
    if shell is None or os.name == "nt":
        pytest.skip("Requires a POSIX shell")
    (tmp_path / "python3").symlink_to(sys.executable)
    marker = tmp_path / "startup-was-loaded"
    (tmp_path / "sitecustomize.py").write_text(
        f"from pathlib import Path\nPath({str(marker)!r}).touch()\n"
    )
    result = subprocess.run(
        [shell, "-c", startup_probe()],
        cwd=tmp_path,
        env={"PATH": str(tmp_path), "PYTHONPATH": str(tmp_path), "HOME": str(tmp_path)},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "python-version=" in result.stdout
    assert not marker.exists()


def test_skill_selects_route_before_scripts_and_links_compatibility_instructions():
    text = SKILL.read_text()
    assert "Python 3.14以上" in text
    assert (
        text.index("## 0. 開始時の実行経路選択")
        < text.index("## 同梱script")
        < text.index("## 1. 入力・Git状態とStage")
    )
    assert "compatibility.md" in text
    assert (SKILL.parent / "compatibility.md").is_file()
    assert "実行途中の失敗では切替禁止" in text
    assert text.index("## 0.") < text.index("### Stage実行")
    assert "選択した経路はこの実行中に変更しない" in text
