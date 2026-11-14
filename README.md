# pi-skills

[Pi](https://pi.dev/) で使うスキル集です。設計の議論、技術文書の執筆・推敲、再利用できる実動作確認手順の作成・保守、Git の変更確認・コミットを支援します。

## スキル一覧

| スキル | 説明 |
| --- | --- |
| [commit](skills/commit/SKILL.md) | 変更を確認し、作業 branch でローカル commit します。default 相当上なら新しい作業 branch を作ります。 |
| [commit-main](skills/commit-main/SKILL.md) | default 相当の現在 branch に直接ローカル commit します。branch 作成・切替はしません。 |
| [commit-push](skills/commit-push/SKILL.md) | 必要なら commit し、push まで行います。 |
| [commit-pr](skills/commit-pr/SKILL.md) | 必要なら commit・push し、PR 作成まで行います。 |
| [design-discussion](skills/design-discussion/SKILL.md) | アイデアや課題を議論し、基本設計・概要設計にまとめます。実装には進みません。 |
| [technical-writing](skills/technical-writing/SKILL.md) | 仕様書・設計書・Plan などを、意味を保ちながら読みやすい日本語に整えます。 |
| [create-verification-skill](skills/create-verification-skill/SKILL.md) | プロジェクト専用の検証 Skill と Feature Map を作り、少なくとも一機能を実操作して確かめます。 |
| [maintain-verification-skill](skills/maintain-verification-skill/SKILL.md) | 既存の検証 Skill の全 Map を source と実操作で点検し、検証資産を保守します。製品不具合・前提不足は区別して報告します。 |

## インストール

Pi と Git がインストールされている環境で実行します。

```bash
pi install git:github.com/minorunakamura/pi-skills
```

特定のプロジェクトだけで使う場合は、そのプロジェクトのディレクトリで実行します。

```bash
pi install git:github.com/minorunakamura/pi-skills --local
```

ローカルに clone したリポジトリも使えます。

```bash
git clone https://github.com/minorunakamura/pi-skills.git
pi install ./pi-skills
```

全8 Skill と 固定Git workflow／状態表示の extension（`commit_inspect`、`commit_workflow`、既存 `commit_status_display`）がまとめてインストールされます。導入後は Pi を起動し直すか、起動中のセッションで `/reload` を実行してください。

## 使い方

Pi を作業対象のプロジェクトで起動し、`/skill:<スキル名>` で呼び出します。各スキルは自動選択を無効にしているため、明示的に実行してください。

### 変更を commit・push・PR にする

```text
/skill:commit
/skill:commit-main
/skill:commit-push
/skill:commit-pr
```

コマンド名で終了地点が決まります。`commit` と `commit-main` はローカル commit、`commit-push` は push、`commit-pr` は PR 作成まで進みます。変更がなければ空 commit は作らず、必要な残りの操作だけを行います。

`commit`はローカルdefault相当上なら、diffの主目的から未存在の作業branchを1件計画し、一括承認後のcommit時に作成します。作業branch上ならそのままcommitします。local remote HEADとremote／fetch設定から判別できたdefault（master・develop等も含む）を優先し、情報なしの場合だけmain／masterをdefault相当として扱います。判定の通信・設定補修はせず、ローカル情報は古い可能性があります。候補競合・壊れたref・不明mappingはGit変更前に確認し、未解決なら停止します。詳細は[ローカルdefaultとbranch方針](CONTRIBUTING.md#ローカル2入口のbun標準経路)を参照してください。

defaultへの直接commitは`/skill:commit-main`を選びます。同じ共通判定でmain／master／その他のdefault相当と確認できた現在branchだけにcommitし、作業branch上や新branch作成・切替・push／PRの矛盾指示ではStageを含むGit変更前に停止します。defaultへ自動切替せず、未commit変更も持ち運びません。両ローカル入口ともremote準備・通信は追加せず、対象差分がなければbranch・commitを作りません。`--no-confirm`でもbranch条件は維持します。

`commit`・`commit-main`・`commit-push`・`commit-pr`は`commit_inspect`と`commit_workflow`の両toolが必須です。toolが同梱TypeScriptをBun 1.3.0以上で固定起動し、assistantは起動コマンドを生成しません。未導入／非公開ならStage前に停止するため、packageのextensionを有効化して新sessionまたは`/reload`で両toolを公開してください。手書きCLI fallbackはありません。開始時は`commit_inspect`、後続は完全参照を渡す`commit_workflow`を使います。push／PRで宛先が未指定なら、先にreference不要の`commit_workflow destinations`でlocal候補・設定根拠を取得し、曖昧ならStage前に実質問します。完全な明示先を優先し、origin等を推測しません。詳細は[宛先候補取得](CONTRIBUTING.md#pushprのlocal宛先候補)を参照してください。完成文章を承認前にprivate保持し、承認後は参照だけで必要なcommit・push・事後確認・cleanupまで進みます。Codemodeは不要です。PR-onlyも同じBun経路です。Bun不在・非対応・確認不能はStageを含むGit変更前に停止し、no-confirmでも省略しません。起動・停止条件と詳細は[詳細仕様](CONTRIBUTING.md#ローカル2入口のbun標準経路)を参照してください。

TUIの `commit_workflow` は呼出し・結果を短く表示します。詳細は tool 出力の展開（標準 `Ctrl+O`）で確認できます。model に渡す完全な結果は省略しません。

大きな固定差分は材料名を選び、続きは返されたcursorだけで読みます。assistantによるoffset／length計算は不要で、read JSON全体は1回32KiB以内です。詳細は[自動page契約](CONTRIBUTING.md#固定材料の自動page-json)を参照してください。

対象や文章への要望も指定できます。

```text
/skill:commit READMEの説明を整理した変更として日本語で
/skill:commit-push 既存Stagedだけ
/skill:commit-pr Draft。skills/commitだけを対象に、Refs #17を記載
```

**注意点**

- 無指定ではリポジトリ全体の全変更を Stage します。対象を絞りたい場合は明示してください。
- Stage は最終確認より先に実行するため、キャンセルや失敗でも Stage が残ることがあります。勝手に reset／unstage はしません。
- 通常は実行内容をまとめて確認します。`--no-confirm` は通常の確認だけを省略し、安全検査や異常時の停止は省略しません。
- PR 作成には認証済みの `gh` が必要です。同一リポジトリ内の PR に対応します。
- 4入口すべてBun 1.3.0以上必須で、手書きBash／旧Pythonへのfallbackはありません。PRには同一repositoryのpush remoteと認証済みghが必要です。開始後の失敗で切り替えず、自動installしません。
- Gitleaks があれば秘密情報を検査し、未導入なら未検査と報告します。
- reset、amend、force push、rebase、PR の自動 merge は行いません。

従来の `commit` は PR 作成まで進みましたが、現在はローカル commit で止まります。PR まで進めたい場合は `commit-pr` を使ってください。

### 設計を相談する

```text
/skill:design-discussion バッチ処理の待ち時間を減らしたい。非同期化の方針を相談したい。
```

目的・制約を整理し、案の利点や負担を比較します。必要に応じて既存コードや外部資料を調べ、議論の区切りで設計書にまとめます。最初から要件をすべて決めておく必要はありません。

production code の変更、実装計画の承認、チケットの公開、実装は行いません。

### 文書を作成・推敲する

```text
/skill:technical-writing docs/specs/jobs.md を、仕様の条件を変えずに読みやすくしてください。
```

```text
/skill:technical-writing 提供した要件をもとに、利用者向けの機能仕様書を作成してください。
```

読み手が理解できる説明を組み立て、条件・例外・判断の状態を保ちながら簡潔にします。仕様の不足は推測で埋めません。相談やレビューだけではファイルを書き換えません。

### 再利用できる検証 Skill を作る・保守する

作業対象の repository で、対象機能や範囲を自由文で指定します。

```text
/skill:create-verification-skill CLIの設定保存と読み込みを、隔離したデータで確認したい
```

既存の規約・適切な検証資産・起動方法・harness を優先し、不足分だけを作ります。既定の生成先は次のとおりです。helper は手順だけでは不足する場合に限ります。

```text
.pi/skills/verify-project/
  SKILL.md
  references/feature-map.md
  scripts/                  # 必要な場合のみ
```

Feature Map は初期対象・対象外と再利用する手順・期待結果を保持し、run ごとの観測結果・成否とは分けます。Create は文書生成だけで完了せず、生成手順で起動・使用可能状態と対象 instance の確認・少なくとも一機能の実操作・証拠取得・cleanup・後始末後の証拠参照確認まで実行します。全 Map 実行は初回の成立条件ではありません。実施範囲、未実行の入口、不足・失敗を区別して報告します。

生成した Skill は Pi 標準の project Skill 探索で利用できます。project trust を確認し、追加・更新後は新セッションを起動するか `/reload` を実行してください。生成 Skill は自動選択を禁止しませんが、自動選択されること自体は保証しません。明示呼び出し、または生成した `SKILL.md` の実ファイルの明示読み込みでも使えます。

```text
/skill:verify-project 今回変更した設定保存だけを確認
```

通常の関連変更では、今回関係する機能を選び、変わった手順・helper・Map の関連部分だけ更新して再実行します。無関係な全 Map の実行や Maintain の呼び出しは不要です。

既存資産の全 Map を点検する場合は、ユーザーが Maintain を明示実行します。Taskflow から自動実行しません。

```text
/skill:maintain-verification-skill .pi/skills/verify-project/SKILL.md を点検して
```

明示された既存 Skill を優先し、複数候補で対象不明なら確認します。資産がなければ Create を案内して停止します。Maintain は全 Map の対応 source と利用者の入口からの実操作を確認しますが、全 repository・全条件・全入口の網羅には広げません。劣化した手順や不足する harness は検証資産だけを修正して再実行し、製品不具合は製品を直したり期待値を緩めたりせず報告します。機能ごとに成功・失敗・未確認、試した経路と理由を区別します。

証拠の保存先は対象プロジェクトの既存ルールを優先し、なければ `.pi/verification-evidence/<run>/` を使います。証拠は既定で Git 管理対象外とし、必要なら証拠ディレクトリだけを最小限 ignore に追加します。既に tracked の証拠や方針の衝突は確認し、勝手に削除・untrack・公開しません。取得前に必要情報と機密性を確認し、秘密・未加工の個人情報・不要な raw log は保存しません。ignore は秘密保護の境界ではありません。後始末は自分が作った隔離 instance と状態だけに限定し、証拠は削除しません。

Taskflow は利用者です。Planning は既存資産の確認と必要な Create の範囲決定、Implementation は Approved Plan 内での Create の利用と直接確認を担当します。他の Skill は Create を明示的に読み込んで利用できますが、通常のテスト・正式チェック・承認・Review・Root の最終受入判断は置き換えません。Create / Maintain は製品修正や commit・PR を自動的に開始しません。

共通 Create / Maintain 自身は pstack の原則を Pi 向けに改変した MIT の Skill で、出典と MIT 全文を同梱します。生成先へ通知や生成元の MIT License を一律に持ち込まず、対象プロジェクトの規約に従います。必要な通知と既存通知の保護は [Create の生成方針](skills/create-verification-skill/SKILL.md)を参照してください。repository 全体の ISC 表記は変更しません。

## 補足

- 選択・承認で `ask_user_question` が使えない場合は、通常のテキストで確認します。
- 設計の調査では、利用可能なら CodeGraph、`pi-ketch`、`pi-web-access`、`pi-subagents` も使います。これらは同梱していません。使えない場合は既存の別手段で確認できる範囲に絞ります。
- 詳しい手順・制約は各スキルの `SKILL.md` を参照してください。
- 開発環境、検証方法、commit の詳細仕様、表示 extension については [CONTRIBUTING.md](CONTRIBUTING.md) にまとめています。
