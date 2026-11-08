---
name: commit-main
description: Review and stage repository changes, then create a local commit directly on the current default-equivalent branch without switching branches or remote operations.
disable-model-invocation: true
compatibility: Requires Git and shell access. Python 3.14+ enables shared commit scripts; without it, use the documented Python-free route. Gitleaks is optional. No remote or gh preparation.
---

# commit-main

到達点は **commit** に固定する。branch方針は、共有のローカルdefault判定でdefault相当と確認できた現在branchへの直接ローカルcommitのみ。mainという固定名ではなく、判別済みdefault（master・develop等）を優先し、情報なしの場合だけmain／masterを許可する。branchは作成しない。実行可能なbranchで対象差分がなければbranch・commitを作らず終了する。remote準備・通信・push・PRはしない。

自由文の対象・文章・言語・明示タイトルを保持するが、到達点とbranch方針は上書きしない。この到達点とbranch方針を確定して共有手順へ引き継いでから[共有手順](../commit/references/workflow.md)を**全文**読む。読取結果が切断された場合は残りのtailも読む。**矛盾による終了を含む停止判断は全文read後に行う**。その後、開始時のruntime選択から共有手順を順に実行する。scriptsとreferencesの基準は共有資材を持つ`skills/commit/`であり、対象repositoryをcwdのまま使う。本文を省略・独自実装しない。

作業branch上、または新branch作成・別branchへの切替・push／PRなど方針と矛盾する明示指示では、Stageを含むGit変更前に停止する。defaultへ自動切替せず、未commit変更を持ち運ばない。対応する`/skill:commit`（作業branchでcommit）、`/skill:commit-main`（default相当で直接commit）、`/skill:commit-push`（pushまで）、`/skill:commit-pr`（PRまで）を案内する。同じ到達点の再指定は矛盾ではない。

無指定では全変更をStageする。限定対象・既存Stagedだけの指定も共有手順に従う。キャンセル・失敗でもStageは残り得る。`--no-confirm`は通常承認のみ省略し、branch条件・検査・疑義解消・停止条件は維持する。
