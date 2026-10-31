# pi-skills

[Pi](https://pi.dev/) で使うスキル集です。設計の議論、技術文書の執筆・推敲、Git の変更確認・コミットを支援します。

## スキル一覧

| スキル | 説明 |
| --- | --- |
| [commit](skills/commit/SKILL.md) | 全変更をStageし、commitとPRの文章・実行設定を一括確認して、commit → push → 通常PRまで進めます。自由文で対象や進行範囲を指定できます。 |
| [design-discussion](skills/design-discussion/SKILL.md) | アイデアや課題を議論し、必要なコード調査・外部調査を交えて基本設計・概要設計にまとめます。実装計画や実装には進みません。 |
| [technical-writing](skills/technical-writing/SKILL.md) | 仕様書・設計書・Plan などの説明を組み立て、要件・条件・判断の状態を保ちながら、読みやすい日本語に整えます。 |

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

Pi を作業対象のプロジェクトで起動し、入力欄で `/skill:<スキル名>` を実行します。各スキルは自動選択を無効にしているため、明示的に呼び出してください。

### commit

```text
/skill:commit
```

**無指定ではrepository全体の全変更をStageし、commit → push → 通常PRまで進めます。** Untracked、既存Staged、部分Stageの残りも対象です（通常のignoreは維持）。外部操作までが既定です。Stageは最終確認より先に実行するため、**キャンセル・失敗でもStageが残り得ます**。勝手にreset／unstageしません。

引数は固定タイトルではなく、対象・進行範囲・branch／宛先・文章への要望などの自由文です。明確な指定を聞き直さず反映します。「このタイトルをそのまま使う」と明示すれば、その文章を維持します。

```text
/skill:commit commitのみ。READMEの説明を整理した変更として日本語で
/skill:commit pushまで。既存Stagedだけ
/skill:commit Draft PRを作成。skills/commitだけを対象に、Refs #13を記載
/skill:commit --no-confirm
```

- 通常は完成形commitメッセージ、ブランチ全体を対象にしたPR title/body、対象範囲、branch作成、remote／実push URL／target、送信する既存commit＋今回のcommit、upstream、base/head、通常／Draft、Closes/Refsを**一回の確認**で提示します。「提示内容で実行／commitのみ修正／PR・実行設定を修正／キャンセル」と自由入力を使い、片方だけの文章修正では他方を保持して最終一式を再確認します。
- `--no-confirm`は通常の内容確認・実行承認だけを省略します。予定内容・結果の報告、Gitleaks、照合、疑義の確認、異常時の停止は省略しません。scriptに承認省略フラグを渡すものではありません。
- pushを伴いmain／remote default上なら、新しい作業branchを1件計画して一括確認に含めます。`--no-confirm`ではその予定branchを自動作成します。不正名・衝突では停止し、既存branchへ勝手に切り替えません。初回main push例外には明示指示・PRなしの範囲・リモート全体が空・送信元／宛先mainが必要で、`--no-confirm`だけでは許可しません。
- 「commitのみ」はremote準備なし、「pushまで」はPR準備なし。PRまでの指定でgh・認証・remote／base等の準備に失敗したら**commit前に停止**し、無断で範囲を縮小しません。限定範囲外のStagedがあれば勝手にunstageせず停止・確認します。submodule内部の変更も親から自動commitせず停止します。
- Python 3.14以上がPiから使える場合は同梱scriptを優先し、開始時probeで未導入・3.13以下と分かった場合だけ[Python不要の互換経路](skills/commit/references/compatibility.md)を使います。両経路の範囲・一括確認・許容遷移・停止条件は同じですが、互換経路はLLMの手順遵守に依存し、scriptと同等の機械的ガードは保証しません。特殊名等を安全に処理できなければ停止します。
- 経路選択はGit変更前の開始時だけです。Python起動失敗・不正応答は停止し、script実行後の検査失敗・状態不一致・認証／通信エラー・timeout等から互換経路へ切り替えません。Pythonや別runtimeの自動install・PATH変更はしません。追加Python packageも不要です。
- 標準経路は`git-status.py`、`staged-commit.py`、`guarded-push.py`、`github-pr.py`を使います。Stage後にcheck、必要なpush／PR prepareをcommit前に取得し、最終確認後にcommit → PR verify → push check／push → PR check／createと照合します。準備JSONは実行用checkやユーザー承認ではなく、手書き更新・永続承認DBは使いません。
- diffは概要から必要箇所へ読み、commitと予定PRで全5フィールドが一致する変更単位の理解を再利用します。完全bytesのdigestは機械的に照合し、同じ本文を再読しません。一時diffはrepository外のprivate directory（`0700`）内に`0600`で保存し、不要になったら**どの質問よりも前に**削除成功を確認します。
- Gitleaksがあれば全Staged差分を検査し、未導入なら未検査と報告します。検査失敗やbranch／parent／tree／raw本文／indexの不一致ではpushせず停止します。秘密値・scannerの生出力は表示しません。
- PRはブランチ全体の差分・履歴・テンプレート・確認できたissueを根拠にし、実行したテスト結果だけを記載します。認証済み`gh`が必要で、同一repository内のみ対応します。SSH host aliasはOpenSSHで解決し、fork間PR・独自SSH commandは扱いません。既存PRはOPEN/CLOSED/MERGEDとも重複作成・自動編集しません。
- 必要objectがなければ自動fetchせず停止します。同時に他プロセスからGitを変更しないでください。照合と操作は非atomicで、hook副作用や通信断による部分成功・成否不明は残ります。失敗時は照会だけを行い、自動再試行・rollbackしません。
- reset、amend、force push、rebase、merge、release、deploy、PR自動mergeは行いません。

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

### technical-writing

文書の作成、推敲、レビューに使います。対象と、必要なら読み手や目的を指定してください。

```text
/skill:technical-writing docs/specs/jobs.md を、仕様の条件を変えずに読みやすくしてください。
```

```text
/skill:technical-writing 提供した要件をもとに、利用者向けの機能仕様書を作成してください。
```

- 理解できる説明を組み立ててから、意味を保って簡潔にします。仕様の不足は推測で埋めません。
- 条件・例外、必須／任意、事実／推測、決定／提案／未確認、識別子や数値を維持します。仕様の正しさや網羅性を保証するものではありません。
- 文書の形式、詳細度、保存先、承認・公開の手順は、依頼や呼び出し元の Skill に従います。相談・レビューだけではファイルを書き換えません。
- 他の Skill から使う場合は、文書作成・更新時に、利用可能な `technical-writing` の `SKILL.md` を明示的に読むよう指定します。この追加だけでは `design-discussion` や Taskflow に自動適用されません。
- 外部の推敲スキル、追加の runtime や package は不要です。[具体例と確認観点](skills/technical-writing/references/examples.md)で、意味を保つ推敲と仕様変更の違いを確認できます。

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
