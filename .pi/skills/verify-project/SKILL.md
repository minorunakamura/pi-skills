---
name: verify-project
description: Verify pi-skills local commit Bun branch planning, approval, default ambiguity and compatibility through fresh Pi, or legacy Python push and PR procedures in disposable environments.
---

# pi-skills の対象機能を直接確認する

今回関係する機能を[Feature Map](references/feature-map.md)から選ぶ。**commit／commit-mainの現行Bun入口・branch方針・通常承認／cancel／no-confirm・default実質問の未回答Stage0・Bunなしlocal互換は[共有local手順](references/local-bun.md)**を使う。起動前に関連source／手順／helperと使捨てdriverのdigestを固定し、run中は編集しない。観測者のPIDを同じ親shellで記録しwaitする。実Gitの元ref／予定branch／親／tree／raw本文／index／upstream、全tool操作・Git子processの通信0、小diff一括、質問前の不要payload削除を照合する。script単体・文言assert・Pi起動成功だけでAgent判断を保証しない。RPCの通常テキスト承認はTUI実証でない。

以下のPython／Codemode setupは**未移行push／PR入口と変更前baselineだけ**に使う。現行ローカル入口へ旧Python判定／生成例を適用しない。新commitのcommit-pr通常承認・停止／部分成功は[旧集約手順](references/execution-batching.md)、公開Python接続は[staged → push → fixture PR](references/staged-push-pr.md)。全runtime／refspec／OS・実GitHub・任意中断保証は対象外。製品修正・本repositoryのcommit・独自runner・installはしない。正式チェック・独立Review・Root受入は代替しない。

## 公開scriptの接続を選んだ場合

[staged → push → fixture PRの手順](references/staged-push-pr.md)だけを使う。正確なrunコマンド、既存fixtureによるfresh setup、公開CLI、時点ごとの期待と観測、証拠、成功失敗時のowned環境/PIDのcleanupと参照readbackを含む。Pi起動・認証・sandbox/RPC helperと以下のbranch判断専用setupは不要。実GitHubやAgentの判断成功は保証しない。証拠は既存ignore対象の`docs/verification/<issue-number>/<run>/`へ無秘密の最小記録を保存する。通常の変更では対象だけ更新・再実行し、全MapやMaintainを要求しない。

Piで利用する場合はrepositoryをcwdにproject trustを確認し、新セッションまたは`/reload`後、`/skill:verify-project 公開scriptのstagedからfixture PRまで`、またはこの実ファイルの明示読み込みで選ぶ。自動選択自体は保証しない。実行分担・対象テストは[CONTRIBUTING](../../../CONTRIBUTING.md)に従う。

## 旧push／PR・baseline: 前提と分離

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
VERIFY_NODE=$(command -v node) # shimでなく導入済みNode24実体を確認
export VERIFY_NODE
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
"$VERIFY_NODE" --version
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

sandbox内でownedへの書込成功とsource／既存設定への書込拒否を確認する。拒否probeは既存ファイルを開いて書かず、source内の未存在の一意名に対する作成を試し、失敗と未作成を照合する。既存設定の拒否は同じprofileのルールを確認する。Piの`get_commands`で明示Skillだけ、`get_state`で通常の既存provider/model/thinking解決を確認する。helperはmodelを変更しない。比較runではbaselineとの一致を観測し、不一致／diagnostic／意図しないfallbackなら成功にしない。lock拒否等のdiagnosticsを無視して別modelへ落ちた状態で検証しない。

## 操作・観測・証拠

Mapのsetupで新しいrepoを作る。Git identityは`Test User <test@example.invalid>`、署名なしとし、実remote通信はしない。証拠は既存ignore対象の`docs/verification/<issue-number>/<一意なrun>/<case>/`（今回は`29/`）を使う。sandboxはsource書込禁止なのでhelperの出力先は一時owned内、終了後に呼出し元が必要最小限を証拠先へコピーする。helperは標準RPCの接続・観測のみで、branch判断やGit操作を代行しない。

```bash
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
  "$OWNED/repo" "$SOURCE/skills/commit-pr/SKILL.md" "$OWNED/evidence" \
  --legacy-codemode --fixture-remote --request '/skill:commit-pr --no-confirm'
```

この例はowned local bareとgh/ssh fixtureを[旧集約手順](references/execution-batching.md)で準備した後だけ実行する。通常承認はanswer-fileを使い、実際の提示・承認質問を読んでから同じsessionへ回答する。想定外の疑義へ実行回答を送らない。helperはask_user_questionを偽装せず、built-in Codemode以外のambient Extensions／MCPを使わない。ローカル2入口／default疑義／Bunなしは[共有local手順](references/local-bun.md)だけを使う。

helperは`get_commands`で指定Skillの名前を検出、prompt応答成功、assistantのerror／abortなし、settled、process終了0をself-checkする。ただしこれだけでは機能成功ではない。Mapの期待結果を実Gitで別途照合する。必要なら新しいcaseでやり直し、失敗runを成功として置き換えない。

before／afterに現在branch、HEAD（unbornはなし）、全refsとsymbolic target、index bytes digest／tree、実commitの親／tree、元branch ref、upstreamを取得する。操作記録のtool引数／結果と照合し、branch作成が承認後のcommit時だけ、commitでは元default ref不変・upstream非継承、commit-mainでは新branchなし・現在branch refだけ前進、対象tree一致、remote通信追加なしを確認する。diff本文や利用者情報の不要なraw logは残さない。失敗・未確認・部分成功を分ける。

## 後始末と再利用

所有するPi processはhelperが公開RPCのstdin close／終了待ちし、失敗時は自分が作ったprocess groupだけをterminate/kill・waitしてgroup不存在を確認する。中断caseで別groupのCLI/hook/adapterを使った場合は、その所有PID/group/handleの終了も別途確認し、残存している環境を削除しない。自分が作った`OWNED`だけをcleanupする。証拠は削除しない。通常認証lockの残存有無を確認し、残ったら勝手に削らず報告する。run記録にsource版・dirty状態、前提、入口、操作、期待と観測、成功／失敗／未確認、証拠への相対参照、cleanup結果を残す。Mapにrun履歴を混ぜない。cleanup後にも記録と全証拠参照が読めることを確認する。ignoreは秘密保護の境界ではない。

Piをこのrepositoryで起動しproject trustを確認する。追加・更新後は新セッションか`/reload`を使い、`/skill:verify-project commitとcommit-mainのbranch判断`、またはこの実ファイルの明示読み込みで再利用する。自動選択自体は保証しない。通常変更では関連するMapと手順だけ更新・再実行し、無関係な全MapやMaintainを要求しない。
