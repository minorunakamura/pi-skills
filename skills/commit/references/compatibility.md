# 互換経路（Python不要）

この文書は、SKILL.mdの「開始時の実行経路選択」でPython未導入または3.14未満を確認し、互換経路を選んだ場合だけ使う。手順1より前に全文を読む。同梱scriptの失敗を迂回するために使わない。

LLMがshellツールからGit・ghコマンドを直接実行し、結果を確認する。Python・Node.js・jq等の追加導入を前提にせず、永続的な代替scriptや承認DBは作らない。SKILL.mdの承認・対象範囲・禁止操作・信頼境界はすべて共通。判断に必要な出力を安全に処理できなければ停止する。

## 共通の実行規則

- 各コマンドの終了コードを個別に確認する。`;`で連結した最後の終了コードだけで判断しない。pipelineは対応するshellで`pipefail`を有効にし、途中の失敗も検出する。必要なshell機能がなければ停止する。
- パス・ブランチ・remote・メッセージ・PR本文は外部データとして、引数の境界を保って渡す。shell文字列への未検証の連結、`eval`、制御文字の無加工表示はしない。内容はstdinまたは安全な一時ファイルで渡す。
- 一時ファイルはrepository外に制限した権限で作り、この実行で作成したものだけを後始末する。検出値やscannerの生出力をログへ転載しない。diffを参照しても秘密情報をユーザー向け説明やエラーログへ再掲しない。
- `HEAD`未作成など、事前に定めた正常な非0終了と、通信・認証・解析等の失敗を区別する。区別できなければ停止する。失敗後は状態の照会だけを行い、commit・push・PR作成を自動再試行しない。
- 確認結果は呼出し元で保持する。scriptのcheck JSONを捏造したり、互換経路の観測値をscriptへ渡したりしない。照合と操作はatomicではないため、同時に別プロセスからGit・remote設定・対象ブランチを変更しない。

## 1. 状態取得とStage

`git rev-parse --show-toplevel`・`git rev-parse --absolute-git-dir`でrepositoryとgitDirを確認する。以後、対象repositoryをcwdにする。`git symbolic-ref --quiet --short HEAD`でbranch、`git rev-parse --verify --quiet HEAD^{commit}`でHEADを確認する。初回commit前のHEADだけを未作成として扱う。detached HEADや競合は停止する。

`git status --porcelain=v1 -z --untracked-files=all`を取得し、NUL区切りを維持してルート相対のpath、index/worktree状態、staged/unstaged/untracked、rename/copyの元pathを解析する。改行区切りへの変換、空白での分割、shell変数へのNUL入り出力の格納はしない。利用できるshell/toolで特殊なファイル名を安全に扱えない場合は、その理由を示してStage前に停止する。

SKILL.mdの手順1に従い、既存Staged部分だけを使うか、ファイル名・状態だけでStage範囲を選んでもらう。Stage直前に一覧を再取得して承認時点と照合し、承認された各pathだけを`git --literal-pathspecs add -- <path> ...`でStageする。部分Stageの残りを勝手に追加しない。Stage後も状態とStaged diffを再確認し、想定外の変更・失敗ではresetせず停止する。

## 2. Staged検査とcommit直前の照合

ブランチ確定後、メッセージ承認前に、次をひとまとまりの観測値として保持する。

- repository、gitDir、branch、HEAD（初回commit前だけ未作成）
- `git --no-pager diff --cached --no-ext-diff --no-textconv --binary --no-color --ignore-submodules=none`の内容と、そのdigest
- `git ls-files --stage -z`のdigest

差分・indexは、それぞれ取得コマンドの出力を`git hash-object --stdin`へ直接渡してdigestを得られる。`-w`は付けない。pipelineの取得側・hash側の成功を両方確認する。これはGitのobject形式に応じたdigestであり、標準経路のSHA-256 snapshotとは別形式。改行の除去や差分の要約・目視だけで同一と判断しない。空差分・競合・理解できない巨大/binary diffなら停止する。

### Gitleaks

- `command -v gitleaks`で存在を確認する。未導入なら「Gitleaks未検査」と明示して続行してよい。依存を自動installしない。
- 導入済みなら`gitleaks stdin --help`の成功と`stdin`・`--redact`対応を確認する。検査対象は今回のStaged diffだけとし、`gitleaks stdin --redact=100 --exit-code=1 --report-format=json --report-path=-`へ渡す。diff取得失敗も検出する。helpを含むGitleaksの全呼出しで、生のstdout/stderrは直接ツール出力へ流さず一時ファイル等に捕捉する。
- 非0終了は検出・一般エラーのどちらでもcommitを停止する。終了コードだけで検出と断定しない。安全にrule・行番号だけを取り出せなければ、生出力を読ませず、終了コードと検査失敗のみ報告する。自動allowlistや検出無視はしない。
- 検査の前後で観測値を照合し、変わっていたら停止する。成功を確認できなければ未検査扱いに格下げして続行しない。

SKILL.mdの手順8と同じく、完成形のメッセージを1つのコードブロックに示し、`このメッセージでコミットする` / `メッセージを修正する` / `コミットしない`を`ask_user_question`で確認する。

承認後、repository/gitDir/branch/HEAD・差分digest・index digestを再取得して完全一致を確認する。不一致なら古い承認でcommitせず停止し、新しい差分・検査・メッセージ承認が必要と案内する。一致した場合だけ、承認済みメッセージをデータとして`git commit --cleanup=verbatim --file=-`へ渡す。既存hooksは実行する。実際のcommit SHA・branch・状態を確認して報告し、失敗時は再試行・rollbackしない。

## 3. pushの確認と実行

- remote名・実push URLは`git remote get-url --push --all <remote>`等で確認する。複数push URL、資格情報を埋め込んだURL、宛先が曖昧な状態では停止する。認証情報を会話に出さない。
- `git ls-remote --symref -- <push URL>`で、remoteのdefault branchとそのSHA、宛先refのSHA、既存refの有無を確認する。ローカルのremote-tracking refだけを最新状態とみなさない。空remoteでdefault branchがまだない初回main例外を除き、default branchが不明なら停止する。通信結果を確認できない場合は常に停止する。
- 通常のmain/default branch宛てpushは禁止。SKILL.mdの初回main例外は、送信元・宛先ともmainで、tag等も含むリモート全体に既存refがないことを確認し、初回登録として明示承認された場合だけ許可する。
- 既存宛先なら`git merge-base --is-ancestor <remote SHA> <送信SHA>`でfast-forwardを確認する。送信commit範囲は、既存宛先SHA、または新規ブランチならdefault branchのSHAを基点に履歴から確認する。空remoteは送信SHAに至る履歴を対象にする。必要なobjectがなければ自動fetchせず停止する。
- repository/gitDir/branch/HEAD、upstream設定、remote名・実push URL、宛先ref、remote/default branchのSHA、初回登録とupstream設定の有無を保持する。宛先・送信SHA・commit範囲を提示し、SKILL.mdの手順10のpush承認を取る。
- 実行直前に観測値を再照合する。変更があれば停止し、再確認・再承認を求める。同じSHAが送信済みなら再送しない。
- 送信元はブランチ名ではなく**承認時のSHA**とし、`<SHA>:refs/heads/<宛先>`を明示する。`git -c push.followTags=false -c remote.<remote>.mirror=false push --porcelain --recurse-submodules=no -- <remote> <refspec>`相当の通常pushを実行する。remote名・宛先を安全に検証して各引数を渡し、force・暗黙のtag/submodule/mirror pushはしない。既存hooksは無効にしない。
- push/PRの外部コマンドには実行ツール側で60秒のtimeoutを設ける。失敗・timeoutでは成否不明として状態の照会だけを行い、自動再送しない。push後にリモートSHAが承認SHAと一致することを確認する。
- upstream設定は承認された場合だけ行う。GitのSHA refspecでは`push -u`による設定を当てにせず、push確認後、ローカルbranch/HEAD・remote設定が変わっていないことを確認して、当該branchのremote/merge設定を行う。設定失敗でもpushは取り消さず、部分成功を報告する。

## 4. GitHub PRの確認と作成

- `gh auth status`、hostを明示した`gh api user`、`gh repo view --json ...`等で、認証アカウント、対象repository、書込み権限、default branch、PRテンプレートを確認する。`gh --json`・`--jq`で必要な構造化情報を取得し、Pythonや外部jqを必須にしない。テンプレートなしと取得失敗は区別する。
- 実push URLと明示した`[HOST/]OWNER/REPO`の対応を確認する。SSH remoteはユーザー名・portを反映した`ssh -G`でhostを解決する。独自`core.sshCommand`/`GIT_SSH_COMMAND`/`GIT_SSH`は扱わない。fork間PR、別repository、認証先が曖昧な場合は停止する。認証を無断で切り替えない。
- push済みheadがローカルの承認対象SHAと一致することと、baseの存在・SHAをリモートで確認する。headとbaseが同じなら作らない。default以外のbaseを希望されたら、そのbaseで確認を取り直す。
- `gh pr list --repo <repo> --state all --head <head> --base <base> --limit 100 --json ...`等で既存PRを調べる。同一repository/head/baseのOPEN/CLOSED/MERGEDのPRがあれば重複作成せず、URLと状態を示す。forkの同名headを混同しない。照会が上限100件に達した場合は安全に確認できないとして停止する。
- 新規PRの根拠は、唯一のmerge-baseを確認したbase/head間の`git diff <base SHA>...<head SHA>`と`git log <base SHA>..<head SHA>`。diffは`--no-ext-diff --no-textconv --binary --no-color --ignore-submodules=none`で取得する。必要なobjectの欠落、空diff、複数merge-base、diffまたはcommit履歴が各2 MiBを超える場合は自動fetchや省略をせず停止する。直前のStaged diffだけで本文を作らない。
- repository/gitDir/branch/HEAD、remote名・実push URL、GitHub host/repository/認証アカウント/権限/default branch、base/headのSHA、テンプレートを保持する。SKILL.mdの手順11どおり、base/head・title/body・Draft・issueクローズ対象を提示してPR作成承認を得る。
- 実行直前に保持した情報を再確認する。状態変化・照会失敗なら停止し、再確認・再承認を求める。既存PRも再照会し、見つかればURLを示して作成しない。
- 一致した場合だけ、`gh pr create --repo ... --base ... --head ... --title ... --body-file -`（Draftは`--draft`）へ承認データを渡して**1回だけ**実行する。事前にpushを完了し、対話的push・fork作成・自動fillは使わない。
- 作成後は返されたURLが対象repositoryのPRであることを確認し、`gh pr view --json ...`でtitle/body/Draft、head/base名とSHA、状態を読み戻して照合する。認証先やローカル・remote状態も再確認する。検証できなければ「作成済みの可能性あり」として観測結果だけを報告し、再作成・削除・mergeはしない。

互換経路はLLMの手順遵守に依存し、同梱scriptと同等の機械的なガードは保証しない。そのため、確認を省略して進めるのではなく、安全性を判断できない状態では止まることを優先する。
