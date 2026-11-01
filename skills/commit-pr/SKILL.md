---
name: commit-pr
description: Review and stage repository changes, commit and push if needed, then create a normal GitHub pull request or report an existing one.
disable-model-invocation: true
compatibility: Requires Git and shell access. Python 3.14+ enables shared commit scripts; without it, use the documented Python-free route. Gitleaks is optional. Requires a push remote and authenticated gh for same-repository PRs.
---

# commit-pr

到達点は **PR** に固定する。対象変更があればStageして新commitを作る。対象差分がなくても既存HEADで必要な残りの操作へ進む。HEADも対象差分もなければ送信なしで終了する。通常PRが既定。明示Draftを優先し、既存PRは報告だけにする。

自由文の対象・文章・言語・明示タイトル・branch・宛先・Draft指定を保持するが、到達点は上書きしない。到達点と矛盾する明示指示は**Git変更前**に止め、対応する`/skill:commit`（commitのみ）、`/skill:commit-push`（pushまで）、`/skill:commit-pr`（PRまで）を案内する。同じ到達点の再指定は矛盾ではない。

この到達点を確定してから[共有手順](../commit/references/workflow.md)を**全文**読み、開始時のruntime選択から順に実行する。scriptsとreferencesの基準は共有資材を持つ`skills/commit/`であり、対象repositoryをcwdのまま使う。本文を省略・独自実装しない。

無指定では全変更をStageする。キャンセル・失敗でもStageは残り得る。`--no-confirm`は通常承認のみ省略し、検査・疑義解消・停止条件は維持する。従来のcommit入口はPRまで進んだが、現在はcommitで停止する。到達点の異なる操作は別Skillを呼ぶ。
