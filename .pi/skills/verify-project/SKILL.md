---
name: verify-project
description: Verify pi-skills local commit Bun branch planning, approval, default ambiguity and required-Bun stops through fresh Pi, push via Bun and local bare, or PR via Bun with same-repository fixtures in disposable environments.
---

# pi-skills の対象機能を直接確認する

今回関係する機能を[Feature Map](references/feature-map.md)から選ぶ。**commit／commit-mainの現行Bun入口・branch方針・通常承認／cancel／no-confirm・default実質問の未回答Stage0・Bun不足のGit変更前停止は[共有local手順](references/local-bun.md)**を使う。起動前に関連source／手順／helperと使捨てdriverのdigestを固定し、run中は編集しない。観測者のPIDを同じ親shellで記録しwaitする。実Gitの元ref／予定branch／親／tree／raw本文／index／upstream、全tool操作・Git子processの通信0、小diff一括、質問前の不要payload削除を照合する。script単体・文言assert・Pi起動成功だけでAgent判断を保証しない。RPCの通常テキスト承認はTUI実証でない。

**commit-pushは[push専用Bun／runtime停止手順](references/push-bun.md)**を使う。新commit／既存HEAD、remote／実URL／target／予定upstreamの一括確認、固定SHA送信・PR API0、先行成功と後続停止を実Gitで照合する。

**commit-prは[PR用Bun／修正／部分成功／runtime停止手順](references/pr-bun.md)**を使う。新commit／既存HEAD／PR-only／全state既存PR、固定文章と片側修正・設定再準備、commit後／送信後driftを同一repositoryの架空GitHub URL→owned local bare／TS gh+ssh fixtureで照合する。廃止したPython専用手順は使わず、共有保証は公開Bun suiteと各専用手順で確認する。

## 分離・証拠・再利用

各専用手順のfresh setupを使う。macOS sandbox-exec／専用HOME/PATH/TMPDIR/Git設定／架空identity／導入済みNode24・Bun・Pi／正常な既存Pi認証が必要。source書込拒否／owned成功を確認し、ambient Extensions/MCP/context、自動install、実repository／実remote mutationは禁止。authの独自read／copy／logを行わず、通常認証のrefresh／lockだけを許可する。権限・必須component不足は安全条件を迂回せず不足／未確認を報告する。

証拠は既存ignore対象のdocs/verification/<issue-number>/<一意run>/。source版／dirty／起動前digest／環境、操作とcommand exit、期待／実観測／成否／未確認、必要最小限のfixture logとmetric、cleanupを保存する。秘密・auth・不要raw logは残さず、Mapにrun履歴を混ぜない。run中source／手順／helper／driverを編集しない。失敗試行も隠さず、以前の版の成功を変更後へ流用しない。

共有RPCの接続・入力・観測は既存commit-rpc.ts、集計はsummarize-commit-rpc.tsを使う。通常assistantの実際の完成表示／質問を読んで同sessionへ本当の回答を送る。tool-onlyを含む全assistant request、承認前／待機／承認後／全体、固定CLI／文章payloadと生成code、usage／unknownを分けnested tool二重計上なし。通常テキスト承認はTUI通過実証でない。

所有する観測者のPIDを同じ親shellで記録・waitする。RPCはstdin close／Pi wait／所有process group不存在をcleanup.jsonへ記録する。別groupの所有hook等も終了確認後に自分のOWNEDだけcleanupし、unknown lock／他run／利用者物は消さない。cleanup後にもrun記録と全証拠参照を実readする。

全Map／Maintain・全OS／全refspec／実GitHub／任意中断必達は対象外。製品修正・本repositoryのcommit・独自runner・installを行わず、正式checks／独立Review／Root受入を代替しない。Piを本repositoryで起動してproject trust確認、追加更新後は新sessionか/reload、`/skill:verify-project commit-pr Bun`等の明示呼出しまたはこの実ファイルreadで選ぶ。自動選択自体は保証しない。通常変更では関連Map／手順だけ更新・再実行する。
