"""Current entry documentation; legacy product tests remain until #49."""

from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    "name,endpoint,reference",
    [
        ("commit", "commit", "local-bun.md"),
        ("commit-main", "commit", "local-bun.md"),
        ("commit-push", "push", "push-bun.md"),
        ("commit-pr", "PR", "pr-bun.md"),
    ],
)
def test_four_entries_require_bun_and_load_their_workflow(name, endpoint, reference):
    path = SKILL_DIR.parent / name / "SKILL.md"
    text = path.read_text()
    assert f"到達点は **{endpoint}**" in text
    assert "Bun 1.3.0+" in text
    assert "before any Git mutation" in text
    assert "No fallback" in text
    assert reference in text and "全文" in text
    assert "矛盾" in text and "Git変更前" in text
    assert "disable-model-invocation: true" in text
    assert text.split("description: ", 1)[1].split("\n", 1)[0].isascii()
    for entry in ("commit", "commit-main", "commit-push", "commit-pr"):
        assert f"`/skill:{entry}`" in text


def test_pr_contract_preserves_guards_and_reference_only_execution():
    text = (SKILL_DIR / "references/pr-bun.md").read_text()
    for contract in (
        "OPEN/CLOSED/MERGED",
        "同一repository",
        "片側",
        "bytes",
        "旧参照",
        "executable=false",
        "新commit前",
        "全Staged",
        "readback",
        "先行成功",
        "Other",
        "通常assistant",
        "PR-only",
        "Stageを含むGit変更前に停止",
        "参照だけ",
        "キャンセル",
    ):
        assert contract in text
    assert "compatibility.md" not in text
