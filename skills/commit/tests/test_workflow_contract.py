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


@pytest.mark.parametrize(
    "name,endpoint",
    [
        ("commit", "commit"),
        ("commit-main", "commit"),
        ("commit-push", "push"),
        ("commit-pr", "PR"),
    ],
)
def test_four_explicit_entries_pin_endpoint_and_branch_policy_and_load_shared_workflow(
    name, endpoint
):
    path = SKILL_DIR.parent / name / "SKILL.md"
    text = path.read_text()
    assert f"name: {name}\n" in text
    description = text.split("description: ", 1)[1].split("\n", 1)[0]
    assert description.isascii()
    assert "disable-model-invocation: true" in text
    assert f"到達点は **{endpoint}**" in text
    reference = (
        "local-bun.md"
        if name in ("commit", "commit-main")
        else "push-bun.md"
        if name == "commit-push"
        else "workflow.md"
    )
    relative = (
        f"references/{reference}"
        if name == "commit"
        else f"../commit/references/{reference}"
    )
    assert f"({relative})" in text and "全文" in text
    assert (path.parent / relative).resolve() == SKILL_DIR / "references" / reference
    assert (path.parent / relative).is_file()
    assert "矛盾" in text and "Git変更前" in text
    if name != "commit-main":
        assert "到達点とbranch方針を確定して共有手順へ引き継" in text
    else:
        assert "push用Bun手順やPR用旧Python workflow" in text
    for entry in ("commit", "commit-main", "commit-push", "commit-pr"):
        assert f"`/skill:{entry}`" in text
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


def test_commit_entry_pins_work_branch_policy_and_guides_direct_commit_to_commit_main():
    text = (SKILL_DIR / "SKILL.md").read_text()
    for contract in (
        "branch方針",
        "ローカルdefault相当",
        "未存在の作業branchを1件",
        "一括承認後のcommit時だけ",
        "明示新branch指定",
        "対象差分がなければbranch・commitを作らず",
        "直接commit指示でbranch作成を迂回しない",
        "直接ローカルcommitには`/skill:commit-main`を案内",
    ):
        assert contract in text


def test_commit_main_entry_pins_direct_default_commit_without_branch_switching():
    text = (SKILL_DIR.parent / "commit-main" / "SKILL.md").read_text()
    for contract in (
        "default相当と確認できた現在branch",
        "情報なしの場合だけmain／master",
        "branchは作成しない",
        "対象差分がなければbranch・commitを作らず",
        "新branch作成・別branchへの切替・push／PR",
        "Stageを含むGit変更前に停止",
        "defaultへ自動切替せず",
        "未commit変更を持ち運ばない",
        "branch条件・検査・疑義解消・停止条件は維持",
    ):
        assert contract in text
    assert "切断された場合は残りのtailも読む" in text
    assert "矛盾による終了を含む停止判断は全文read後" in text
    assert text.index("[Bun標準手順]") < text.index("作業branch上、")
    workflow = (SKILL_DIR / "references" / "local-bun.md").read_text()
    for contract in (
        "BUN_OPTIONS",
        "NODE_OPTIONS",
        "--env-file=/dev/null",
        "--no-install",
        "--config=",
        "commit-workflow.ts",
        "inspect",
        "materials",
        "plan",
        "execute",
        "execute",
        "参照",
        "途中LLM",
        "実際に質問",
        "Stage0",
        "Bun 1.3.0以上は必須",
        "Stageを含むGit変更前に停止",
        "fallbackはなく",
        "承認token",
    ):
        assert contract in workflow


@pytest.mark.parametrize("route", ["workflow.md", "compatibility.md"])
def test_default_uncertainty_requires_a_question_before_stage_even_without_confirmation(
    route,
):
    text = (SKILL_DIR / "references" / route).read_text()
    stage = text.split("## 1.", 1)[1].split("## 2.", 1)[0]
    assert "確定した作業branch上" in stage
    assert "default判定不能" in stage
    assert "明示質問を行" in stage and "回答を待" in stage
    policy = (
        text.split("## ローカルdefault判定", 1)[1].split("## 1.", 1)[0]
        if route == "workflow.md"
        else stage
    )
    for contract in (
        "候補／理由を表示",
        "ask_user_question",
        "通常テキストで候補の選択肢とbranch名の自由回答を求める",
        "`--no-confirm`でもこの質問は省略しない",
        "再実行案内だけで済ませ",
        "未回答・未解決",
        "回答後も作業branchと判定されればcommit-mainは拒否",
    ):
        assert contract in policy


def test_local_default_policy_is_shared_and_rechecked_outside_script_snapshot():
    workflow = (SKILL_DIR / "references" / "workflow.md").read_text()
    policy = workflow.split("## ローカルdefault判定", 1)[1].split("## 1.", 1)[0]
    for contract in (
        "標準・互換経路ともこの判定",
        "宛先側から送信元側へ逆解決",
        "複数remoteが同じbranch名",
        "情報が存在しない場合だけ",
        "main／master",
        "壊れたsymbolic ref",
        "originという名前だけで選ばず",
        "init.defaultBranch",
        "Stage前と操作直前",
        "最新のremote defaultは保証しない",
        "scriptの新しい機械的ガードではない",
    ):
        assert contract in policy
    stage = workflow.split("## 1.", 1)[1].split("## 2.", 1)[0]
    assert "ローカルdefault判定" in stage
    review = workflow.split("## 8.", 1)[1].split("## 9.", 1)[0]
    assert "ローカルdefault判定の根拠" in review
    operation = workflow.split("## 9.", 1)[1].split("## 10.", 1)[0]
    assert "ローカルdefault判定の根拠を再取得・照合" in operation
    compatibility = (SKILL_DIR / "references" / "compatibility.md").read_text()
    assert "(workflow.md#ローカルdefault判定)" in compatibility
    for text in (workflow, compatibility):
        assert "作業branch上なら現在branchを使" in text
        assert "branch方針未確定なら停止" in text
        assert "新branch作成・別branchへの切替・push／PR" in text
        assert "Stageを含むGit変更前に停止" in text
        assert "対象diffが空ならbranch" in text
        assert "現在は未導入" not in text
    check = workflow.split("## 3.", 1)[1].split("## 4.", 1)[0]
    assert "commit入口の場合" in check
    assert "commit-mainはStage前に確認済み" in check
    assert "`staged-commit.py check`（`--branch`なし）" in check
    assert "policy引数は追加しない" in check
    for text in (workflow, compatibility):
        assert "初回main" in text
        assert "送信元・宛先ともmain" in text or "送信元／宛先ともmain" in text
        assert "commitのみならmain" not in text


def test_new_commit_execution_batches_after_approval_without_changing_other_routes():
    workflow = (SKILL_DIR / "references" / "workflow.md").read_text()
    execution = workflow.split("## 9.", 1)[1]
    assert "(execution-batching.md)" in execution and "全文" in execution
    for contract in (
        "新commitあり・標準経路・Codemode利用可能",
        "1回のCodemode",
        "集約開始前から利用不可",
        "開始後の失敗・timeout・中断・不正応答ではfallbackせず停止",
        "対象差分なし・既存HEAD・push済みからPRだけ・Python-freeは従来経路",
        "途中生成してcreateせず",
    ):
        assert contract in execution
    batching = (SKILL_DIR / "references" / "execution-batching.md").read_text()
    for contract in (
        "生成＋最終報告のassistant 2回",
        "中継LLM requestは0回",
        "別途完全再取得・比較",
        "commitを呼ばない",
        "通信なし",
        "PR prepare／verify／check／create APIなし",
        "commit → PR verify → push check／push → PR check",
        "CLI exit 0だけでは続行しない",
        "file側で解析/検証",
        "0700",
        "0600",
        "umask 077",
        "symlink",
        "全量`store()`",
        "diff: null",
        "非空",
        "operationMayHaveSucceeded",
        "自動再試行・rollback・準備値更新",
        "timeout_ms",
        "記録済み所有fileだけ",
        "必達を保証しない",
    ):
        assert contract in batching
