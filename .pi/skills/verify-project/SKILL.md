---
name: verify-project
description: Verify pi-skills post-approval Codemode batching, stopping and partial success through fresh Pi, or local branch policy and public scripts in disposable Git and fixture PR environments.
---

# pi-skills の対象機能を直接確認する

今回関係する機能を[Feature Map](references/feature-map.md)から選ぶ。新commit承認後のCodemode集約と停止・部分成功は[専用手順](references/execution-batching.md)を使い、fresh Piの実入口・通常承認・request timingと実Git/local bare/fixture PRを照合する。Issue #28・#29の`/skill:commit`と`/skill:commit-main`のAgent branch判断と、Issue #31の公開scriptによるstaged → local bare push → fixture PRを別の入口として扱う。Issue #34のPython起動保護はMapの限定確認を選び、公開script接続とfresh Piの作業branch代表を照合する。script単体テスト・文言assert・Pi起動成功をAgentの判断成功としない。全runtime／refspec／OSの網羅は対象外。製品修正・本repositoryのcommit・独自runner・installはしない。正式チェックとRootの受入判断を代替しない。

## 公開scriptの接続を選んだ場合

[staged → push → fixture PRの手順](references/staged-push-pr.md)だけを使う。正確なrunコマンド、既存fixtureによるfresh setup、公開CLI、時点ごとの期待と観測、証拠、成功失敗時のowned環境/PIDのcleanupと参照readbackを含む。Pi起動・認証・sandbox/RPC helperと以下のbranch判断専用setupは不要。実GitHubやAgentの判断成功は保証しない。証拠は既存ignore対象の`docs/verification/<issue-number>/<run>/`へ無秘密の最小記録を保存する。通常の変更では対象だけ更新・再実行し、全MapやMaintainを要求しない。

Piで利用する場合はrepositoryをcwdにproject trustを確認し、新セッションまたは`/reload`後、`/skill:verify-project 公開scriptのstagedからfixture PRまで`、またはこの実ファイルの明示読み込みで選ぶ。自動選択自体は保証しない。実行分担・対象テストは[CONTRIBUTING](../../../CONTRIBUTING.md)に従う。

## Agent branch判断: 前提と分離

- repositoryルートをcwdにし、Git、Python 3.14、導入済みPiを確認する。Pi 1.4.0の公開RPCを使う。現在のhelperはmacOSの`/usr/bin/sandbox-exec`が必要。他OSやsandbox不成立なら無制限実行へ逃げず不足を報告する。
- `skills/commit/tests/conftest.py`、`CONTRIBUTING.md`、変更後の`skills/commit/SKILL.md`・`skills/commit-main/SKILL.md`と共有手順を読む。既存fixtureと同様、専用一時repository・HOME・Git設定・架空identityを使う。read/bashはcwdやHOMEだけでは隔離されない。
- Pi認証は利用者が許可した既存の正常な認証経路だけで利用する。authの独自読取・表示・複製・証拠保存は禁止。ambient extensions／MCP／context／自動installを無効化する。既存設定を変更しない。通常のOAuth refreshと設定読取のための一時lock以外のagentDir書込は許可しない。所有不明lockを削除しない。
- helperのread/bashはPiと同じ権限で、正常認証用authにアクセスできる限界がある。自作の安全なfixtureだけを使い、source・既存設定の書込禁止とowned領域への書込をOS sandboxで確認する。秘密値・利用者の実データ・実remoteをfixtureに使わない。

## 隔離環境の準備

以下はBash。`SOURCE`はこのcheckout、`VERIFY_PI`は導入済みPi実体、`PYTHON`は確認したPython 3.14実体、`AGENT_DIR`は通常認証を利用する既存Pi agentDirの実パスを明示する。会話履歴や前回の一時パスを使わない。作成前にそのsource版・dirty状態とPi/Git/Python版をrun記録に残す。

```bash
umask 077
SOURCE=$(pwd -P)
VERIFY_PI=$(command -v pi)
PYTHON=$(command -v python3)
GIT=$(command -v git)
AGENT_DIR="$HOME/.pi/agent"
"$VERIFY_PI" --version
"$PYTHON" -E -S -c 'import sys; print(sys.executable, sys.version); assert sys.version_info[:2] >= (3, 14)'
"$GIT" --version
OWNED=$(mktemp -d /private/tmp/pi-commit-verify.XXXXXXXX)
OWNED=$(cd "$OWNED" && pwd -P)
mkdir "$OWNED/home" "$OWNED/tmp" "$OWNED/bin"
export VERIFY_PI
export VERIFY_SANDBOX="$OWNED/sandbox.sb"
cat > "$VERIFY_SANDBOX" <<EOF
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "$OWNED") (literal "/dev/null")
 (literal "$AGENT_DIR/auth.json") (subpath "$AGENT_DIR/auth.json.lock")
 (subpath "$AGENT_DIR/settings.json.lock"))
(deny file-read* (subpath "$HOME/.ssh") (subpath "$HOME/.aws")
 (subpath "$HOME/.gnupg") (subpath "$HOME/.config"))
EOF
for variable in $(compgen -e); do
  case "$variable" in
    GIT_*|GITLEAKS_*|GH_*|GITHUB_*|SSH_*|*_API_KEY|*_TOKEN) unset "$variable" ;;
  esac
done
export PATH="$(dirname "$PYTHON"):$(dirname "$GIT"):/usr/bin:/bin"
export HOME="$OWNED/home" TMPDIR="$OWNED/tmp"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export PI_CODING_AGENT_DIR="$AGENT_DIR" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
```

上の実行ファイルがmise等のshimなら、先に導入済みの実体を指定する。ambient変数に別のcredentialがある場合も引き継がず、値を表示・記録しない。標準経路のPATHは確認したPython・Gitと必要なOS utilityに限定し、miseや利用者shell初期化を呼ばない。

互換caseだけはPi起動前に次も実行する。既存OS utilityをsymlinkするだけでinstallしない。`tee`はraw本文照合にも必要なので省かない。途中の失敗でPATH／経路を切り替えない。

```bash
ln -s "$GIT" "$OWNED/bin/git"
for utility in bash sh dirname basename uname sed awk grep cut tr sort find ls cat wc od cmp tail head mktemp mkdir rmdir rm test printf env date perl chmod readlink xargs which tee dd diff cp mv stat touch du xxd shasum openssl; do
  executable=$(PATH=/usr/bin:/bin /usr/bin/which "$utility") || continue
  ln -s "$executable" "$OWNED/bin/$utility"
done
export PATH="$OWNED/bin"
if command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'Python must be absent for this case' >&2
  exit 1
fi
```

sandbox内でownedへの書込成功とsource／既存設定への書込拒否を確認する。拒否probeは既存ファイルを開いて書かず、source内の未存在の一意名に対する作成を試し、失敗と未作成を照合する。既存設定の拒否は同じprofileのルールを確認する。Piの`get_commands`で明示Skillだけ、`get_state`で通常の既存provider/model解決を確認する。lock拒否等のdiagnosticsを無視して別modelへ落ちた状態で検証しない。

## 操作・観測・証拠

Mapのsetupで新しいrepoを作る。Git identityは`Test User <test@example.invalid>`、署名なしとし、実remote通信はしない。証拠は既存ignore対象の`docs/verification/<issue-number>/<一意なrun>/<case>/`（今回は`29/`）を使う。sandboxはsource書込禁止なのでhelperの出力先は一時owned内、終了後に呼出し元が必要最小限を証拠先へコピーする。helperは標準RPCの接続・観測のみで、branch判断やGit操作を代行しない。

```bash
"$PYTHON" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.py" \
  "$OWNED/repo" "$SOURCE/skills/commit-main/SKILL.md" "$OWNED/evidence" \
  --request '/skill:commit-main --no-confirm'
```

commitの確認ではSkillパスとrequestの両方をcommitへ変える。通常承認では`--request '/skill:commit-main' --answer '提示内容で実行'`、cancelでは`--answer 'キャンセル'`を使う。初回settledの実際の提示・承認待ちを記録で確認する。helperは`ask_user_question`を偽装しない。read/bash/codemodeだけのPiなので質問専用toolはなく、Skillの通常テキストによる確認と、同じRPC sessionへの実follow-up回答を使う。Codemodeはbuilt-inだけを明示有効にし、ambient Extensions/MCPは使わない。候補競合・壊れたHEADでは`--no-confirm`でも候補／理由の表示後に実際の質問と選択肢・自由回答の要求があることを確認し、回答を与えず待機／停止状態を観測する。「確認が必要」という報告や再実行案内だけなら確認対話は不成立とする。矛盾指示も共有workflow全文read（切断時のtailを含む）の後に停止判断したことをread操作と照合する。`--answer`は疑義への承認ではないので、想定外の質問ならそのrunを成功にしない。

helperは`get_commands`で指定Skillの名前を検出、prompt応答成功、assistantのerror／abortなし、settled、process終了0をself-checkする。ただしこれだけでは機能成功ではない。Mapの期待結果を実Gitで別途照合する。必要なら新しいcaseでやり直し、失敗runを成功として置き換えない。

before／afterに現在branch、HEAD（unbornはなし）、全refsとsymbolic target、index bytes digest／tree、実commitの親／tree、元branch ref、upstreamを取得する。操作記録のtool引数／結果と照合し、branch作成が承認後のcommit時だけ、commitでは元default ref不変・upstream非継承、commit-mainでは新branchなし・現在branch refだけ前進、対象tree一致、remote通信追加なしを確認する。diff本文や利用者情報の不要なraw logは残さない。失敗・未確認・部分成功を分ける。

## 後始末と再利用

所有するPi processはhelperが公開RPCのstdin close／終了待ちし、失敗時は自分が作ったprocess groupだけをterminate/kill・waitしてgroup不存在を確認する。中断caseで別groupのCLI/hook/adapterを使った場合は、その所有PID/group/handleの終了も別途確認し、残存している環境を削除しない。自分が作った`OWNED`だけをcleanupする。証拠は削除しない。通常認証lockの残存有無を確認し、残ったら勝手に削らず報告する。run記録にsource版・dirty状態、前提、入口、操作、期待と観測、成功／失敗／未確認、証拠への相対参照、cleanup結果を残す。Mapにrun履歴を混ぜない。cleanup後にも記録と全証拠参照が読めることを確認する。ignoreは秘密保護の境界ではない。

Piをこのrepositoryで起動しproject trustを確認する。追加・更新後は新セッションか`/reload`を使い、`/skill:verify-project commitとcommit-mainのbranch判断`、またはこの実ファイルの明示読み込みで再利用する。自動選択自体は保証しない。通常変更では関連するMapと手順だけ更新・再実行し、無関係な全MapやMaintainを要求しない。
