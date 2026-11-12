---
name: commit-push
description: Review and stage repository changes, commit if needed, then push the current HEAD without creating a pull request.
disable-model-invocation: true
compatibility: Requires Git, shell access, and Bun 1.3.0+. Missing, unsupported, or unverifiable Bun stops before any Git mutation, even with no-confirm. No fallback or automatic installation. Gitleaks is optional. A configured push remote is required; gh is not required.
---

# commit-push

## 開始時の全文read一式

開始時に次の全文readを**同じassistant turn**からまとめて呼ぶ。切断された文書は残りのtailも取得し、未読のまま操作・停止判断しない。読取順と規則の優先順位は別で、**PR > push > local**。push／PRにはlocal専用の無通信・default質問・空diff即終了・branch方針を適用しない。

- [local-bun.md](../commit/references/local-bun.md)
- [push-bun.md](../commit/references/push-bun.md)

到達点は **push** に固定する。対象変更があればStageして新commitを作る。対象差分がなくても既存HEADで必要な残りの操作へ進む。HEADも対象差分もなければ送信なしで終了する。PR準備・作成はしない。

branch方針は通信したremote defaultとmainに基づくpush用の作業branch計画に従う。ローカルcommit入口のdefault判定・直接commit方針は適用しない。

自由文の対象・文章・言語・明示タイトル・branch・宛先・Draft指定を保持するが、到達点は上書きしない。到達点と矛盾する明示指示は**Git変更前**に止め、対応する`/skill:commit`（作業branchでcommit）、`/skill:commit-main`（default相当で直接commit）、`/skill:commit-push`（pushまで）、`/skill:commit-pr`（PRまで）を案内する。同じ到達点の再指定は矛盾ではない。

この到達点とbranch方針を共有手順へ引き継ぐ。起動は共有local手順のtool選択を使い、inspectのmodeは`"push"`を明示する。scriptsとreferencesの基準は信頼済み配布元の`skills/commit/`。本文を省略・独自実装しない。

無指定では全変更をStageする。キャンセル・失敗でもStageは残り得る。`--no-confirm`は通常承認のみ省略し、検査・疑義解消・停止条件は維持する。従来のcommit入口はPRまで進んだが、現在はcommitで停止する。到達点の異なる操作は別Skillを呼ぶ。
