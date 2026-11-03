---
name: maintain-verification-skill
disable-model-invocation: true
description: Maintain an existing project-local Pi verification skill by checking every mapped feature against source and real user-facing behavior. Repair verification assets, rerun changed procedures, preserve evidence through cleanup, and distinguish product failures from unverified prerequisites. Use only when explicitly invoked by the user; never run automatically from Taskflow.
license: MIT
---

# Maintain Verification Skill

既存の検証 Skill・helper・Feature Map を、source と実動作に照らして点検・更新する。
source を読んだだけ、コンパイル成功、自己申告、古い screenshot だけで動作を認定しない。Map の全機能を利用者の入口から実際に操作し、期待結果と観測結果を照合する。

## 呼び出しと責務

```text
/skill:maintain-verification-skill <既存の検証 Skill のパスなどの自由文>
```

- **ユーザーの明示実行に限定し、Taskflow から自動実行しない。** 通常の関連変更では、関係する機能の手順・helper・Map だけ更新して再実行すればよく、Maintain や無関係な全 Map 実行は不要。
- 作業対象の repository を cwd とする。自由文の対象・明示パスと既存規約を優先し、固定引数 parser や wrapper は作らない。対象が曖昧な場合だけ確認する。
- 対象は既存 Map の全機能であり、全 repository の機能追加や全条件・全入口の網羅には拡大しない。Map にない機能や実行しなかった入口を検証済みと扱わない。
- 通常の自動テスト、正式チェック、承認・Review・Root の最終受入判断を代行しない。既存テストを検証資産へ移したり、必要なチェックを省いたりしない。
- 製品修正、公開 API・テスト専用 API の追加、CI・独自 runner・registry・復旧 workflow の追加、commit・push・PR 作成は行わない。subagent や追加 package を必須にしない。
- 同梱参照はこの Skill の配置から相対解決する。[pstack の出典・改変方針と MIT 通知](../create-verification-skill/references/pstack.md)を読む。既存資産の通知を削除しない。

## 1. 対象の検証資産を特定する

明示された既存 Skill を優先し、指定がなければ repository の規約・既存の検証 Skill を対象を絞って調べる。既定配置は `.pi/skills/verify-project/SKILL.md` だが、既存規約を置き換えない。

- 複数候補があり対象が不明なら、ユーザーに確認する。
- 検証資産がなければ [Create Verification Skill](../create-verification-skill/SKILL.md) の `/skill:create-verification-skill` を案内して停止する。Maintain で別資産を重複作成しない。
- Skill、参照先の Feature Map、helper、対応する source を読む。全機能の入口、前提、起動・使用可能状態と対象 instance の確認、操作、期待結果、観測・証拠取得、cleanup の手順を点検する。
- Map の初期対象・対象外、制約、未対応の入口を確認する。Map は再利用する手順と期待結果を保持し、今回の観測結果・成否は別の実行記録に置く。

調査で分かることは質問せず、仕様・権限など決められない点だけ確認する。既存資産を無断で置換・破棄しない。

## 2. 分離と証拠の準備をする

- repository の既存の起動方法と適切な harness を優先する。安全に分離できる検証用 instance・port・profile・データを使い、自分が起動・作成したものを特定できるようにする。利用者の既存環境や共有 instance を無断操作しない。
- dry-run / test mode も名前だけで無副作用と判断せず、何を変更・送信するか確認する。必要な前提・権限・harness が不足する場合は危険な代替や無断 install で進めず、不足を記録する。
- source の版と未コミット変更の有無を記録する。Git がなければ対象を識別できる情報を残す。古い成功を変更後の成功として流用しない。
- 証拠の保存先は対象プロジェクトの既存ルールを優先し、なければ `.pi/verification-evidence/<run>/` を使う。run ごとに衝突しないディレクトリを選ぶだけとし、registry や自動管理機構は作らない。
- 証拠は既定で Git 管理対象外にする。既存の ignore 方針と追跡状態を確認し、ルールがなければ対象 repository の `.gitignore` に証拠ディレクトリだけの最小設定を追加する（既定配置なら `/.pi/verification-evidence/`）。既に追跡されている証拠や方針の衝突では、勝手に削除・untrack・公開せず確認する。
- 取得前に必要な情報と機密性を確認し、秘密値・未加工の個人情報・不要な raw log を保存しない。Git ignore を秘密保護の境界とはみなさない。必要最小限だけ保存し、外部送信・commit・PR・証拠の自動削除・保持期限管理は行わない。

## 3. 全 Map の source と実動作を点検する

Map の各機能について、対応する source と手順を照合し、次を実行する。短命な CLI では隔離した状態から各操作を起動する。前セッションの会話、一時絶対パス、生存 process に依存しない。

1. 前提状態を用意し、repository の既存手段で起動する。使用可能状態と、これから操作する対象 instance を確認する。process の存在や health 応答だけで usable とせず、surface に応じて版・build、所有する port・profile・認証などを確認する。
2. 利用者の入口から実際に操作する。内部 setter やテスト専用入口だけで経路を代用せず、期待結果と観測結果、必要なファイル・データなどの副作用を照合する。異常時は対象 instance と使用可能状態を再確認する。
3. 対象機能・入口、前提、試した経路・操作、期待結果と観測結果、成否・未確認範囲と理由、必要なログ等への参照を実行記録に残す。source の版・dirty 状態と結び付け、保存先から参照を解決できるようにする。
4. 次の区別に従って対処し、変更した検証方法は再実行する。失敗した試行でも後始末する。

| 点検結果 | 対処 |
| --- | --- |
| 手順の劣化・harness の不足 | 依頼範囲内の Skill・helper・Map など検証資産だけを最小限修正し、変えた方法で実操作・観測を再実行する。helper は本文に示す引数・runtime・実行方法で動かし、直接実行する場合は実行権限も確認する。未成立の command や selector を成立済みとしない。 |
| 製品不具合 | 失敗した操作・期待と観測・証拠を報告する。製品を修正せず、期待値を緩めたり検証資産の変更で不具合を隠したりしない。 |
| 到達不能・前提不足 | 実際に試した経路と到達できない理由、不足する前提・権限・harness、未確認範囲を記録する。危険な代替で続行せず、機能成功とは区別する。 |

各機能の結果を **成功・失敗・未確認** に分ける。失敗した実操作と、前提不足などで実操作を確認できなかった場合を混同しない。代替環境を使った場合は差分と実対象の未確認範囲を明示する。一部未確認を全件成功に置き換えない。

## 4. 後始末と証拠参照を確認する

成功・失敗のいずれでも、自分が起動・作成した process と一時状態だけを後始末する。所有する PID・handle 等で特定し、process 名で一括終了しない。cleanup 失敗や残存状態は隠さず報告する。

証拠は削除せず、一時環境と一緒に消える配置にしない。後始末後に実行記録とすべての証拠リンク先が読めることを実際に確認する。証拠を移動する場合は移動後にも参照を解決して読む。

## 5. 全件の確認状況を報告する

- 対象の Skill・Feature Map・helper、source の版と dirty 状態。
- Map の全機能それぞれの成功・失敗・未確認、実際に試した入口・経路、期待と観測、未確認の理由・不足。
- 検証資産の修正箇所と再実行結果。製品不具合と手順の劣化・前提不足の区別。
- 実行記録・証拠の参照先、cleanup 結果・残存状態、後始末後のリンク実読結果。
- 未実行の入口、Map 外の機能など保証対象外。

未実行・起動失敗・実操作の失敗・cleanup 失敗を成功扱いにしない。この報告は全 repository の保証や Root の最終受入れではなく、製品修正や commit・PR を自動的に開始するものでもない。
