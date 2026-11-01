# pi-skills

[Pi](https://pi.dev/) で使うスキル集です。設計の議論、技術文書の執筆・推敲、Git の変更確認・コミットを支援します。

## スキル一覧

| スキル | 説明 |
| --- | --- |
| [commit](skills/commit/SKILL.md) | 変更を確認し、ローカル commit まで行います。 |
| [commit-push](skills/commit-push/SKILL.md) | 必要なら commit し、push まで行います。 |
| [commit-pr](skills/commit-pr/SKILL.md) | 必要なら commit・push し、PR 作成まで行います。 |
| [design-discussion](skills/design-discussion/SKILL.md) | アイデアや課題を議論し、基本設計・概要設計にまとめます。実装には進みません。 |
| [technical-writing](skills/technical-writing/SKILL.md) | 仕様書・設計書・Plan などを、意味を保ちながら読みやすい日本語に整えます。 |

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

全5 Skill と表示 extension がまとめてインストールされます。導入後は Pi を起動し直すか、起動中のセッションで `/reload` を実行してください。

## 使い方

Pi を作業対象のプロジェクトで起動し、`/skill:<スキル名>` で呼び出します。各スキルは自動選択を無効にしているため、明示的に実行してください。

### 変更を commit・push・PR にする

```text
/skill:commit
/skill:commit-push
/skill:commit-pr
```

コマンド名で終了地点が決まります。`commit` はローカル commit、`commit-push` は push、`commit-pr` は PR 作成まで進みます。変更がなければ空 commit は作らず、必要な残りの操作だけを行います。

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
- Python 3.14 以上があれば同梱 script を使います。未導入・旧バージョンなら Python 不要の互換手順を使いますが、script と同等の機械的ガードは保証しません。
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

## 補足

- 選択・承認で `ask_user_question` が使えない場合は、通常のテキストで確認します。
- 設計の調査では、利用可能なら CodeGraph、`pi-ketch`、`pi-web-access`、`pi-subagents` も使います。これらは同梱していません。使えない場合は既存の別手段で確認できる範囲に絞ります。
- 詳しい手順・制約は各スキルの `SKILL.md` を参照してください。
- 開発環境、検証方法、commit の詳細仕様、表示 extension については [CONTRIBUTING.md](CONTRIBUTING.md) にまとめています。
