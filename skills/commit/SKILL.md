---
name: commit
description: Review and stage repository changes, then create a local commit without remote operations.
disable-model-invocation: true
compatibility: Requires Git and shell access. Python 3.14+ enables shared commit scripts; without it, use the documented Python-free route. Gitleaks is optional. No remote or gh preparation.
---

# commit

到達点は **commit** に固定する。branch方針は、ローカルdefault相当上では未存在の作業branchを1件計画し、一括承認後のcommit時だけ作成する。作業branch上では現在branchを使う。明示新branch指定は維持する。対象差分がなければbranch・commitを作らず終了する。remote準備はしない。

default相当への直接commit指示でbranch作成を迂回しない。矛盾する指示はStageを含むGit変更前に停止する。直接ローカルcommit用の`/skill:commit-main`は後続Work Itemで提供予定で、現在は未導入。自動切替・代替の直接commitはしない。

自由文の対象・文章・言語・明示タイトル・branch・宛先・Draft指定を保持するが、到達点は上書きしない。到達点と矛盾する明示指示は**Git変更前**に止め、対応する`/skill:commit`（commitのみ）、`/skill:commit-push`（pushまで）、`/skill:commit-pr`（PRまで）を案内する。同じ到達点の再指定は矛盾ではない。

この到達点を確定してから[共有手順](references/workflow.md)を**全文**読み、開始時のruntime選択から順に実行する。scriptsとreferencesの基準は共有資材を持つ`skills/commit/`であり、対象repositoryをcwdのまま使う。本文を省略・独自実装しない。

無指定では全変更をStageする。キャンセル・失敗でもStageは残り得る。`--no-confirm`は通常承認のみ省略し、検査・疑義解消・停止条件は維持する。従来のcommit入口はPRまで進んだが、現在はcommitで停止する。到達点の異なる操作は別Skillを呼ぶ。
