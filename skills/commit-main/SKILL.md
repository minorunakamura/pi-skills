---
name: commit-main
description: Review and stage changes, hold the complete message for approval, then commit directly on the current local default-equivalent branch using bundled Bun TypeScript.
disable-model-invocation: true
compatibility: Requires commit_inspect and commit_workflow tools, Git, shell access, and Bun 1.3.0+. Missing, unsupported, or unverifiable Bun stops before any Git mutation, even with no-confirm. No fallback or automatic installation. Gitleaks is optional. No network operations.
---

# commit-main

両tool `commit_inspect`・`commit_workflow` が必須。未導入／非公開ならStage前に停止し、pi-skills extensionの導入・有効化と新sessionまたは `/reload` を案内する。手書きCLI fallbackは使わない。後続は固定toolのみ、起動コマンドを生成しない。

## 開始時の全文read一式

開始時に次の全文readを**同じassistant turn**からまとめて呼ぶ。切断された文書は残りのtailも取得し、未読のまま操作・停止判断しない。読取順と規則の優先順位は別で、**PR > push > local**。push／PRにはlocal専用の無通信・default質問・空diff即終了・branch方針を適用しない。

- [local-bun.md](../commit/references/local-bun.md)

到達点は **commit**。default相当と確認できた現在branchへの直接ローカルcommitだけを行う。一意なlocal remote HEADのdefaultを優先し、真に情報なしの場合だけmain／masterを許可する。branchは作成しない。branch作成・切替・通信・push・PRはしない。対象差分がなければbranch・commitを作らず終了する。

自由文の対象・文章・言語・明示タイトルを尊重するが、到達点とbranch方針は上書きしない。これは両ローカル入口の共有経路。inspectに`mode:"commit-main"`を渡す。push用Bun手順やPR用Bun手順・CLI・Codemode生成例を使わない。

作業branch上、または新branch作成・別branchへの切替・push／PRなどの矛盾指示は、Stageを含むGit変更前に停止する。defaultへ自動切替せず、未commit変更を持ち運ばない。`/skill:commit`（作業branchでcommit）、`/skill:commit-main`（default相当で直接commit）、`/skill:commit-push`（pushまで）、`/skill:commit-pr`（PRまで）を案内する。

無指定はUntracked・部分Stageの残り・既存Stagedを含む全変更。限定literal paths・既存Stagedだけも扱う。キャンセル・失敗でもStageは残り得る。reset／unstageしない。`--no-confirm`は通常承認のみ省略し、branch条件・検査・疑義解消・停止条件は維持する。
