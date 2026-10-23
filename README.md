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

Git の変更状態を確認し、必要な選択・承認を求めながらコミットまで進めます。すでに Stage 済みの変更があれば、その部分だけを対象にします。Python 3.14以上がPiから利用できる場合は同梱scriptを優先します。Python未導入・3.13以下なら、開始時にLLMがGit・ghコマンドを直接実行する互換経路へ切り替えます。Pythonはスキル全体の必須要件ではなく、どちらの経路も追加のPython packageは不要です。

コミットタイトルを指定する場合は、コマンドの後に続けて入力します。指定したタイトルは、そのまま使われます。

```text
/skill:commit docs: READMEにスキルの説明と使い方を追加
```

- Stage、ブランチ作成・切り替え、commit、push、PR 作成には、それぞれ承認が必要です。
- Gitを変更する前にshellでPythonの存在・バージョンを確認し、実行経路を選びます。標準経路ではGit状態の取得に `git-status.py`、Staged diffの検査・照合・commitに `staged-commit.py`、pushに `guarded-push.py`、GitHub PR作成に `github-pr.py` を使います。
- 互換経路では[専用手順](skills/commit/references/compatibility.md)に従ってLLMがGit・ghコマンドを実行します。承認、部分Stageの保護、Gitleaks検査、commit/push/PR直前の状態照合は省略しません。ただしscriptと同等の機械的ガードは保証できず、特殊なファイル名等を安全に扱えない場合は停止します。
- 経路選択は開始時だけです。Pythonの起動失敗・不正応答は停止し、script実行後の検査失敗・状態不一致・認証/通信エラー・timeout等から互換経路へ切り替えて再実行しません。Pythonの自動installやPATH変更もしません。
- diffはファイル一覧・変更量から必要箇所へ段階的に確認します。確認済みの完全なdiffとの同一性はdigestや`cmp`で判定し、再読を避けます。一時diffはrepository外のランダムなprivate directory（`0700`）内へ`0600`で保存し、不要になったら承認質問の前に削除します。digestと確認済みの要点は保持し、この実行のファイルだけを後始末します。
- Gitleaks が利用可能なら、コミット予定の Staged diff を検査します。未導入の場合は未検査であることを報告します。検査後に差分・index・ブランチ・HEADが変わっていればcommitせず停止します。
- scriptはユーザー承認を代行しません。承認はPi側で行い、検査結果は呼出し元で保持します。永続的な承認DBは作りません。同時に別プロセスからGitを変更しないでください。
- push と PR 作成は希望した場合だけ行います。各経路で保持した確認結果を承認後に再照合し、pushは承認時のSHAだけを送信、PRはpush済みのhead/baseと認証アカウントを確認して作成します。既存PRは重複作成しません。通信エラーでは成否を照会し、自動再試行しません。
- PR本文はブランチ全体のdiff・commit履歴とGitHubのテンプレートを根拠にします。両経路ともPRの自動作成には認証済みの `gh` が必要です。同一repository内のPRのみ対応し、SSH host aliasの解決にはOpenSSHを使います。fork間PRや独自SSH commandは自動処理しません。
- 必要なcommit objectがローカルにない場合は、自動fetchせず停止します。照合とリモート操作は完全にatomicではありません。失敗してもリモート変更が完了している場合があるため、結果確認前に再実行しないでください。
- reset、amend、force push、rebase、merge、release、deploy は行いません。

#### 状態一覧の色付き表示

同梱の`extensions/commit-status.js`は、取得済みの状態JSONを表示するだけの`commit_status_display` toolを追加します。Git操作や`git-status.py`のJSONは変更しません。Pi packageとして導入した場合は自動検出され、`/reload`後に使えます。Pi 1.3.0を対象としています。

絵文字ではないテキストの`●`だけを色付けし、状態名・ファイル名は通常色で表示します。このtoolは標準の色付き背景枠を使わず、通常背景に一覧を表示します。theme設定や他のtoolの表示は変更しません。

| 状態 | themeの色指定 | 標準darkでの色 |
| --- | --- | --- |
| Modified | `warning` | 黄色 |
| Untracked | `mdLink` | 青色 |
| Added | `success` | 緑色 |
| Deleted | `error` | 赤色 |

部分StageはStaged/Unstagedを分け、rename/copyは元パスも表示します。色は有効なthemeに従います。toolがない環境やTUI以外では通常のテキスト表示を使います。承認・検査の手順は変わりません。

スキルだけをsymlinkで導入している場合は、cloneしたリポジトリのルートから表示extensionもリンクできます。既存ファイルは上書きしません。

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/commit-status.js" ~/.pi/agent/extensions/commit-status.js
```

その後Piで`/reload`を実行してください。

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

## 開発時の検証

開発にはmiseとGitを使います。Python 3.14系・uv・Node.js・pnpm・Ruff・tyのバージョンは`mise.toml`で固定します。pytest 9系は開発用依存として`pyproject.toml`と`uv.lock`で管理し、uvが`.venv`に導入します。miseを有効化したshellで次を実行してください。

```bash
mise install
pnpm install --frozen-lockfile
mise exec -- uv sync --locked --python python
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
```

`pnpm lint`はPythonにRuff、表示extensionとそのテストにBiomeを使います。`pnpm typecheck`はPythonをtyで検査し、`pnpm format:check`はBiomeとRuff、`pnpm test`はNode.js標準のtest runnerとpytestを実行します。`pnpm lint:fix`でRuffの自動修正、`pnpm format`で整形を適用します。BiomeはJSON・JavaScript等のformatに使います。Ruffの`target-version`とtyの`python-version`も3.14に合わせています。型検査はscript・テスト・fixtureを含み、診断の一括無効化やテスト除外はしません。これらは開発用です。同梱scriptはPython標準ライブラリだけを使い、互換経路はPythonを必要としません。

pytestでは`tmp_path`・共通fixture・`parametrize`・`monkeypatch`を使い、一時Gitリポジトリとbare remoteでstatus解析、部分Stage、Gitleaks検査、状態変化時のcommit/push拒否、main保護と初回登録の例外、PRの本文・Draft・重複防止、認証・通信エラーとtimeout時の再試行禁止などを検証します。Gitleaks・gh・SSHはテスト用の実行ファイルで再現するため、実行時には不要です。実remoteやGitHubには接続しません。回帰テストはGitとPOSIX環境を対象とします。表示extensionのNode.jsテストはPi提供moduleの境界だけをstubにし、色の割当て、部分Stage・rename・競合、制御文字のescape、不正JSONの拒否、TUI以外の表示を確認します。Pi本体の追加installや外部接続は不要です。Pi提供moduleはoptionalなpeer dependencyとして宣言し、`pnpm-workspace.yaml`でpeerの自動installを無効化して、開発時にもSDKを二重導入しません。

## CI

`.github/workflows/ci.yml`で、PRの作成・更新とmainへのpush時にUbuntu上で同じlint・型検査・format確認・pytestを実行します。依存は`pnpm install --frozen-lockfile`と`uv sync --locked`で固定し、Pythonはmiseで選ばれた実行ファイルを使います。Actionはcommit SHA、mise本体もバージョンを固定しています。

権限は`contents: read`のみで、checkoutの認証情報は永続化しません。実GitHubへのpush・PR作成や個人の認証情報は不要です。CI成功をmerge条件にする場合は、workflowとは別にGitHubのRuleset等で必須チェックを設定してください。
