"""Minimal document contracts; these do not execute or simulate an Agent."""

from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    "path",
    [
        SKILL_DIR / "references" / "workflow.md",
        SKILL_DIR / "references" / "compatibility.md",
    ],
    ids=["standard", "python-free"],
)
def test_routes_document_default_scope_and_one_combined_review(path: Path):
    text = path.read_text()
    for contract in (
        "commit → push → 通常PR",
        "自由文",
        "既存Stagedだけ",
        "部分Stageの残り",
        "提示内容で実行",
        "commitのみ修正",
        "PR／実行設定を修正",
        "キャンセル",
        "Other",
        "--no-confirm",
        "commit前に停止",
        "OPEN/CLOSED/MERGED",
    ):
        assert contract in text, f"{path.name}: missing {contract}"
    assert "既存のStaged部分のみ" not in text
    assert "コミット後の次の操作" not in text
    assert "opt-in" not in text


@pytest.mark.parametrize(
    ("path", "review_heading", "next_heading"),
    [
        (SKILL_DIR / "references" / "workflow.md", "## 8.", "## 9."),
        (SKILL_DIR / "references" / "compatibility.md", "## 4.", "## 5."),
    ],
    ids=["standard", "python-free"],
)
def test_review_displays_messages_outside_choices_and_tool_results(
    path: Path, review_heading: str, next_heading: str
):
    text = path.read_text()
    review = text.split(review_heading, 1)[1].split(next_heading, 1)[0]
    for contract in (
        "`ask_user_question`より前に",
        "通常のassistantメッセージ／Markdown",
        "緑色の成功枠を含むtool結果には表示しない",
        "完成形commitメッセージ",
        "完成形title/body",
        "question／label／description／previewには全文を入れず",
        "短い質問・操作名・説明だけ",
        "表示済みの文章を参照",
        "同じ表示規則で質問前に最終一式を再提示",
        "`--no-confirm`でも同じ表示規則で予定内容を報告",
    ):
        assert contract in review, f"{path.name}: missing {contract}"
    assert "通常テキストより先に" not in text
    for contract in (
        "bash等のstdout",
        "`commit_status_display`を文章表示に転用しない",
    ):
        assert contract in text, f"{path.name}: missing {contract}"


def test_standard_route_prepares_before_review_and_uses_verified_execution_order():
    text = (SKILL_DIR / "references" / "workflow.md").read_text()
    preparation = text.split("## 4.", 1)[1].split("## 5.", 1)[0]
    assert "guarded-push.py prepare" in preparation
    assert "github-pr.py prepare" in preparation
    assert "commit前に停止" in preparation
    review = text.split("## 8.", 1)[1].split("## 9.", 1)[0]
    assert "一回" in review
    assert "片方" in review
    assert "他方" in review
    assert "最終一式" in review
    execution = text.split("## 9.", 1)[1]
    assert (
        execution.index("staged-commit.py commit")
        < execution.index("github-pr.py verify")
        < execution.index("guarded-push.py check --prepared")
        < execution.index("guarded-push.py push")
        < execution.index("github-pr.py check --prepared")
        < execution.index("github-pr.py create")
    )


def test_readme_warns_about_default_mutations_and_has_scoped_examples():
    text = (SKILL_DIR.parents[1] / "README.md").read_text()
    for contract in (
        "全変更をStage",
        "commit → push → 通常PR",
        "キャンセル",
        "Stageが残",
        "/skill:commit-push",
        "/skill:commit-pr Draft",
        "/skill:commit --no-confirm",
        "自由文",
    ):
        assert contract in text
    assert "push と PR 作成は希望した場合だけ" not in text


@pytest.mark.parametrize(
    "name,endpoint",
    [("commit", "commit"), ("commit-push", "push"), ("commit-pr", "PR")],
)
def test_three_explicit_entries_pin_endpoint_and_load_shared_workflow(name, endpoint):
    path = SKILL_DIR.parent / name / "SKILL.md"
    text = path.read_text()
    assert f"name: {name}\n" in text
    assert "disable-model-invocation: true" in text
    assert f"到達点は **{endpoint}**" in text
    relative = (
        "references/workflow.md"
        if name == "commit"
        else "../commit/references/workflow.md"
    )
    assert f"({relative})" in text and "全文" in text
    assert (
        path.parent / relative
    ).resolve() == SKILL_DIR / "references" / "workflow.md"
    assert (path.parent / relative).is_file()
    assert "矛盾" in text and "Git変更前" in text
    assert "### Stage実行" not in text


def test_shared_workflow_documents_existing_head_without_reusing_prior_approval():
    text = (SKILL_DIR / "references" / "workflow.md").read_text()
    for contract in (
        "到達点未指定",
        "既存HEAD",
        "空commit",
        "HEADも対象差分もない",
        "呼出し間",
        "承認",
        "prepare --existing-head",
        "guarded-push.py branch",
        "push-existing-head-preparation",
        "pr-existing-head-preparation",
        "index tree",
        "元main",
        "既存履歴全体",
        "存在しない項目の修正選択肢",
        "existingHeadPreparation",
        "commit-push/scripts",
        "commitディレクトリ",
    ):
        assert contract in text
    assert "(references/diff-review.md)" not in text
    assert "(diff-review.md)" in text
