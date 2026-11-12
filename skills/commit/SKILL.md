---
name: commit
description: Review and stage changes with bundled Bun TypeScript, then commit locally on the current work branch or a planned new branch after approval.
disable-model-invocation: true
compatibility: Requires Git, shell access, and Bun 1.3.0+. Missing, unsupported, or unverifiable Bun stops before any Git mutation, even with no-confirm. No fallback or automatic installation. Gitleaks is optional. No network operations.
---

# commit

## 開始時の全文read一式

開始時に次の全文readを**同じassistant turn**からまとめて呼ぶ。切断された文書は残りのtailも取得し、未読のまま操作・停止判断しない。読取順と規則の優先順位は別で、**PR > push > local**。push／PRにはlocal専用の無通信・default質問・空diff即終了・branch方針を適用しない。

- [local-bun.md](references/local-bun.md)

到達点は **commit** に固定する。branch方針は、ローカルdefault相当上では未存在の作業branchを1件計画し、一括承認後のcommit時だけ作成する。作業branch上では現在branchを使う。明示新branch指定は維持する。対象差分がなければbranch・commitを作らず終了する。remote準備はしない。

default相当への直接commit指示でbranch作成を迂回しない。矛盾する指示はStageを含むGit変更前に停止する。直接ローカルcommitには`/skill:commit-main`を案内する。自動切替・代替の直接commitはしない。

自由文の対象・文章・言語・明示タイトル・branch・宛先・Draft指定を保持するが、到達点は上書きしない。到達点と矛盾する明示指示は**Git変更前**に止め、対応する`/skill:commit`（作業branchでcommit）、`/skill:commit-main`（default相当で直接commit）、`/skill:commit-push`（pushまで）、`/skill:commit-pr`（PRまで）を案内する。同じ到達点の再指定は矛盾ではない。

この到達点とbranch方針を共有手順へ引き継ぐ。inspectに`mode:"commit"`を渡し、明示新branch名だけを`newBranch`へ渡す。default相当で名前未指定なら固定Staged材料の意味から未存在の作業branch名を作りplanへ渡す。branch作成はexecute内だけ。旧Python workflow・CLI・Codemode生成例を使わない。

無指定では全変更をStageする。キャンセル・失敗でもStageは残り得る。`--no-confirm`は通常承認のみ省略し、検査・疑義解消・停止条件は維持する。従来のcommit入口はPRまで進んだが、現在はcommitで停止する。到達点の異なる操作は別Skillを呼ぶ。
