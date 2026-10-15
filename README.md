# pi-skills

[Pi](https://pi.dev/) で使うスキル集です。設計の議論や、Git の変更確認・コミットを支援します。

## スキル一覧

| スキル | 説明 |
| --- | --- |
| [commit](skills/commit/SKILL.md) | 変更を確認し、Stage 対象の選択、ブランチの提案、コミットメッセージの作成、コミットを支援します。希望した場合は push と GitHub PR 作成まで進めます。 |
| [design-discussion](skills/design-discussion/SKILL.md) | アイデアや課題を議論し、必要なコード調査・外部調査を交えて基本設計・概要設計にまとめます。実装計画や実装には進みません。 |

## 導入方法

Pi と Git がインストールされている環境で実行します。

```bash
pi install git:github.com/minorunakamura/pi-skills
```

特定のプロジェクトだけで使う場合は、そのプロジェクトのディレクトリで `--local` を付けて実行します。

```bash
pi install git:github.com/minorunakamura/pi-skills --local
```

ローカルに clone したリポジトリを使うこともできます。

```bash
git clone https://github.com/minorunakamura/pi-skills.git
pi install ./pi-skills
```

導入後は Pi を起動し直すか、起動中のセッションで `/reload` を実行してください。

## 使い方

Pi を作業対象のプロジェクトで起動し、入力欄で `/skill:<スキル名>` を実行します。どちらのスキルも自動選択を無効にしているため、明示的に呼び出してください。

### commit

```text
/skill:commit
```

Git の変更状態を確認し、必要な選択・承認を求めながらコミットまで進めます。すでに Stage 済みの変更があれば、その部分だけを対象にします。

コミットタイトルを指定する場合は、コマンドの後に続けて入力します。指定したタイトルは、そのまま使われます。

```text
/skill:commit docs: READMEにスキルの説明と使い方を追加
```

- Stage、ブランチ作成・切り替え、commit、push、PR 作成には、それぞれ承認が必要です。
- Gitleaks が利用可能なら、コミット予定の Staged diff を検査します。未導入の場合は未検査であることを報告します。
- push と PR 作成は希望した場合だけ行います。GitHub PR の自動作成には、認証済みの GitHub CLI `gh` が必要です。
- reset、amend、force push、rebase、merge、release、deploy は行いません。

### design-discussion

コマンドの後に、相談したいアイデアや課題を入力します。

```text
/skill:design-discussion バッチ処理の待ち時間を減らしたい。非同期化の方針を相談したい。
```

目的・制約を整理し、案の利点や負担を比較しながら設計を育てます。最初から要件をすべて決めておく必要はありません。

- 必要な範囲で既存コードや外部資料を調べ、確認済みの事実と仮定を区別します。
- 会話内の整理と設計書の保存を使い分けます。文書化が役立つ区切りや依頼に合わせて、決定事項と理由、未決事項、リスクを反映します。保存は仕様全体の確定や議論の終了を意味しません。
- 設計書の保存先はプロジェクトの規約に従い、規約がなければ `docs/designs/<slug>.md` を使います。
- production code の変更、実装計画の承認、チケットの分割・公開、実装は行いません。

## ツールについて

`commit` の選択・承認には `ask_user_question` を使い、利用できない場合は通常のテキストで確認します。`design-discussion` は通常の対話を基本とし、その場で選んでもらうことが議論を助ける場合に使います。

`design-discussion` の調査では、必要に応じて CodeGraph、`pi-ketch`、`pi-web-access`、`pi-subagents` を使います。これらはこのリポジトリには同梱されていません。利用できない場合は制約を伝え、既存の別手段で確認できる範囲に絞ります。

詳しい手順と制約は、各スキルの `SKILL.md` を参照してください。
