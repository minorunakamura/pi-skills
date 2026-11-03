---
name: create-verification-skill
disable-model-invocation: true
description: Create a reusable project-local Pi verification skill grounded in the repository's existing tools. Run its instructions through a real user-facing feature, preserve evidence through cleanup, and report verified and unverified scope. Use explicitly or when another skill explicitly requests creation; do not replace tests or acceptance decisions.
license: MIT
---

# Create Verification Skill

実動作確認の手順を、別セッションでも会話履歴なしで使えるプロジェクト専用の Pi Skill にする。
文書や helper の生成だけでは完了しない。生成した手順で実物を操作し、期待結果と観測結果を照合する。

## 呼び出しと責務

```text
/skill:create-verification-skill <対象機能・検証範囲などの自由文>
```

- 作業対象の repository を cwd とする。自由文の対象・明示パスと既存規約を優先し、固定引数 parser は作らない。対象が曖昧な場合だけ確認する。
- 他の Skill からは、このファイルを明示的に読み込んで利用できる。Taskflow の Planning は既存資産の確認と必要な Create の範囲決定、Implementation は Approved Plan 内での Create の利用と直接確認を担当する。
- 通常の自動テスト、正式チェック、承認・Review・Root の最終受入判断を代行しない。既存テストを検証資産へ移したり、必要なチェックを省いたりしない。
- 製品修正、公開 API・テスト専用 API の追加、CI・独自 runner・registry・復旧 workflow の追加、commit・push・PR 作成は行わない。subagent や追加 package を必須にしない。
- 同梱参照はこの Skill の配置から相対解決する。[pstack の出典・改変方針と MIT 通知](references/pstack.md)を読み、生成物にも同じ通知を自己完結して同梱する。

## 1. repository を調べて初期対象を定める

規約、README、source、既存の検証 Skill・手順・テスト・harness を対象を絞って読む。調査で分かることは質問せず、仕様・権限など決められない点だけ確認する。

- **利用者の入口**: CLI、TUI、browser、API など、今回の対象機能に利用者がどう到達するか。複数の入口があれば、初期対象と対象外を明示する。固定の機能数や全 repository 網羅は求めない。
- **起動と前提**: repository の既存コマンド、runtime、build、設定、認証、port、初期データ。空の検証用状態から使用可能になるまでの手順を調べる。
- **操作と観測**: 適切な既存 harness を優先する。実際のコマンド・selector・route と、操作による結果・副作用を観測する方法を確認する。内部 setter やテスト専用入口だけで利用者の経路を代用しない。
- **分離と後始末**: 検証用 instance、port、profile、データを安全に分離し、自分が起動・作成したものを特定して後始末できるか確認する。
- **既存資産**: 適切な検証資産・配置規約があれば再利用する。無断で置換・破棄したり、別の検証 Skill を重複生成したりしない。依頼範囲内の不足部分だけ補う。

起動不能、前提・権限・harness の不足があれば、危険な代替や無断 install、製品修正で進めず、試した方法と不足を報告する。未成立の command や selector を、成立済みの手順として残さない。

## 2. 再実行できる最小の資産を作る

既存規約がなければ次の配置を使う。生成物は対象 repository に置く。

```text
.pi/skills/verify-project/
  SKILL.md
  references/feature-map.md
  references/pstack.md
  scripts/                  # 手順だけでは不足する場合のみ
```

### 生成する SKILL.md

- frontmatter に `name` と、対象プロジェクト・surface・利用場面が分かる `description` を書く。既定名は `verify-project`。共通 Create と異なり、生成 Skill には `disable-model-invocation: true` を付けず、自動選択を禁止しない。
- 今回の依頼に関係する機能だけを Feature Map から選ぶこと、保証対象と対象外を記す。Map にない機能や実行しなかった入口を検証済みと扱わず、全 Map 実行や製品変更を自動的に許可しない。
- 前提、repository の既存手段による正確な起動方法、使用可能状態と対象 instance の確認方法を書く。process の存在や health 応答だけで usable としない。対象の版・build、所有する port・profile・認証などを、surface に応じて確認できるようにする。短命な CLI では隔離した状態から各操作を起動する方法を記す。
- 実際の利用者の入口からの操作、期待結果、観測方法を具体化する。表示だけでなく、必要なファイル・データなどの副作用も確認する。異常時には対象 instance と使用可能状態を再確認してから操作する。
- 証拠取得・保存と、自分が作った環境の後始末を記す。次節の証拠・安全性の規則を、後続セッションにも適用できるよう本文に含める。
- helper は既存手段と手順だけでは不足する場合に限る。必要な引数・runtime と実行コマンドを本文に示し、その方法で実際に動かす。直接実行する helper には実行権限を付ける。試行錯誤の全ファイルや共通テンプレート基盤は保存しない。
- Feature Map と通知へ、生成 Skill からの相対参照を置く。この共通 Skill の `references/pstack.md` を通知全文ごと生成先の `references/pstack.md` に同梱する。既存の通知は消さない。配布元の絶対パスや隣接 checkout を要求しない。
- cwd 基準の起動と Skill 配置基準の同梱参照を区別する。前セッションの会話、一時絶対パス、稼働 process に依存せず、新しい隔離状態で再実行できる内容にする。

### Feature Map

既定は単一の Markdown `references/feature-map.md`。冒頭に初期対象と対象外を示し、機能ごとの節から次を辿れるようにする。固定の節名や件数は要求しない。

| 内容 | 記載すること |
| --- | --- |
| 機能と到達方法 | 利用者向けの機能、入口、そこまでの経路 |
| 前提と実操作 | 必要な状態、具体的な操作・手順、必要なら Skill・helper への相対参照 |
| 期待と観測 | 成功を示す期待結果、それを実物で観測する方法 |
| 証拠 | 何を取得するか、取得方法、run ごとの保存先を決める規則 |
| 注意 | 制約、未対応の入口、必要な権限・外部状態など |

Map は再利用する手順と期待結果を保持する。今回の観測結果・成否は別の実行記録に置き、Map を成功履歴として使わない。前提不足を成功に置き換えたり、製品不具合を隠すため期待値を緩めたりしない。

### 証拠・安全性（生成 Skill にも保持する）

- 保存先は対象プロジェクトの既存ルールを優先し、なければ `.pi/verification-evidence/<run>/` を使う。run ごとに衝突しないディレクトリを選ぶだけとし、registry や自動管理機構は作らない。
- 証拠は既定で Git 管理対象外にする。既存ルールがなければ対象 repository の `.gitignore` に証拠ディレクトリだけの最小設定を追加する（既定配置なら `/.pi/verification-evidence/`）。既存 ignore 方針は変えない。既に追跡されている証拠や既存方針との衝突では、勝手に削除・untrack・公開せず確認する。
- 取得前に必要な情報と機密性を確認する。秘密値、未加工の個人情報、不要な raw log を保存しない。Git ignore を秘密保護の境界とはみなさない。必要最小限の証拠だけ保存し、外部送信・commit・PR・自動削除・保持期限管理は行わない。
- 短い実行記録から、対象機能と入口、source の版と未コミット変更の有無、前提、実行した操作、期待結果と観測結果、成否・未確認範囲、必要なログ等を辿れるようにする。Git がなければ対象を識別できる情報を記す。記録内の参照は保存先から解決できるようにする。古い成功を変更後の成功として流用しない。
- 安全に分離できる検証用 instance とデータを使う。利用者の既存環境や共有 instance を無断操作しない。dry-run / test mode も、名前だけで無副作用と判断せず、実際に何を変更・送信するか確認する。
- 後始末は自分が起動・作成した process と一時状態だけに限定する。所有する PID・handle 等で特定し、process 名で一括終了しない。成功・失敗のいずれでも後始末し、証拠は削除しない。cleanup 失敗や残存状態は報告する。
- 必要な前提・権限・harness が不足する場合は、危険な代替や無断 install で進めず不足を報告する。製品不具合を検証資産の変更で隠したり製品を修正したりしない。通常のテスト・正式チェック・Root の受入判断を代替しない。

### 発見と通常の再利用

生成 Skill 本文と完了報告に、次の利用方法を残す。

- Pi を対象 repository で起動する。標準の project Skill 探索で `.pi/skills/` を利用し、project trust を確認する。追加・更新後は新セッション起動または `/reload` を行う。
- `/skill:verify-project <今回の対象機能など>`（別名ならその名前）で明示呼び出しするか、生成した `SKILL.md` の実ファイルを明示的に読み込む。自動選択されること自体は保証しない。
- 通常の関連変更では、今回関係する機能を選んで検証し、変わった手順・helper・Map の関連部分だけ更新して再実行する。そのために無関係な全 Map 実行や Maintain を要求しない。
- 全 Map の点検を担う [Maintain Verification Skill](../maintain-verification-skill/SKILL.md) は別用途で、ユーザーの明示実行に限定し、Taskflow から自動実行しない。`/skill:maintain-verification-skill <既存の検証 Skill のパスなど>` で利用できるが、今回の Create や通常の再実行に必要としない。

## 3. 生成した手順を実行して確かめる

生成した Skill 自身の手順を使い、少なくとも初期対象の一機能で次を実行する。全 Map 実行は Create の成立条件にしない。

1. 前提と証拠の機密性・保存方針を確認し、source の版と dirty 状態を記録する。新しい検証用状態から repository の既存手段で起動する。
2. 使用可能状態と、これから操作する対象 instance を確認する。
3. 利用者の入口から実操作し、期待結果と実際の結果・必要な副作用を照合する。コンパイル成功、自己申告、古い screenshot だけを動作の証拠にしない。
4. 操作と結果を結び付ける必要最小限の証拠・実行記録を保存する。手順・helper に問題があれば依頼範囲内の検証資産を直し、変えた方法を実行し直す。失敗した試行でも後始末する。
5. 自分が作った instance と一時状態を後始末する。後始末後に実行記録とすべての証拠参照が読めることを実際に確認する。証拠が一時環境と一緒に消える配置にはしない。

未実行、起動失敗、実操作の失敗、cleanup 失敗を完了扱いにしない。実環境の代わりに代替環境を使った場合は差分と、実対象では未確認の前提・手順を明示する。実行できない場合は不足と未確認範囲を報告し、文書生成だけを成功としない。

## 4. 実施範囲と参照先を報告する

- 再利用・作成・更新した Skill、Feature Map、必要な helper、通知のパス。
- 実際に起動・操作・観測した機能と入口、期待との照合結果。
- 実行しなかった機能・入口、保証対象外、不足・失敗・未確認範囲。
- source の版・dirty 状態と、実行記録・証拠の参照先。
- cleanup 結果、残存状態、後始末後の参照確認結果。
- project trust、新セッションまたは `/reload`、明示呼び出し・実ファイル読み込みによる再利用方法。

これらは今回の実施報告であり、Root の最終受入れや全機能の保証を宣言しない。
