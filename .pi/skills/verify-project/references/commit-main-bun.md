# commit-main: Bun公開CLIとfresh Pi入口

対象はcommit-mainだけ。製品手順は[同梱Bun手順](../../../../skills/commit/references/commit-main-bun.md)。他3入口は未移行で[旧集約手順](execution-batching.md)／[既存公開Python接続](staged-push-pr.md)を維持する。旧3run／Codemode回数／性能閾値を今回へ流用しない。以下だけでfresh setupから再実行する。正式checks・独立Review・受入はRootの担当。

## 前提・fresh setup

macOS sandbox-exec、導入済みGit／Node24／Bun1.3.0+／Pi、正常なPi認証が必要。runtimeをinstallせず、shimでなく確認済み絶対実体を指定する。Bunなしcaseでも観測者は絶対Node実体で起動する。Piの導入版`docs/{rpc.md,rpc-commands.md,json.md,message-types.md,cli.md}`を読む。auth独自read／copy／log禁止。ambient Extensions／MCP／contextを読み込ませず、model／thinkingは通常解決に任せ、diagnosticや意図しないfallbackを成功扱いしない。

Bashでrepository rootから実行する。`SOURCE`は製品source、検証mutationは新しい`OWNED/repo`だけ。以下の絶対実体はその環境で確認して代入し、利用者設定を変更しない。

```bash
umask 077
SOURCE=$(pwd -P)
VERIFY_NODE=$(command -v node)
VERIFY_BUN=$(command -v bun)
VERIFY_PI=$(command -v pi)
GIT=$(command -v git)
AGENT_DIR="$HOME/.pi/agent"
"$VERIFY_NODE" --version
"$VERIFY_PI" --version
"$GIT" --version
# Bun probeは製品と同じtrusted cwd/config/env引数。未導入caseだけ省略。
(cd "$SOURCE/skills/commit/scripts" && env -u BUN_OPTIONS -u NODE_OPTIONS "$VERIFY_BUN" --config="$SOURCE/skills/commit/scripts/bunfig.toml" --env-file=/dev/null --no-install --version)
OWNED=$(mktemp -d /private/tmp/pi-commit-main.XXXXXXXX)
OWNED=$(cd "$OWNED" && pwd -P)
mkdir "$OWNED/home" "$OWNED/tmp" "$OWNED/bin" "$OWNED/repo"
VERIFY_SANDBOX="$OWNED/sandbox.sb"
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
/usr/bin/sandbox-exec -f "$VERIFY_SANDBOX" /bin/sh -c 'touch "$1/owned-probe" && ! touch "$2/.verify-commit-main-unique-probe"' sh "$OWNED" "$SOURCE"
test ! -e "$SOURCE/.verify-commit-main-unique-probe" || exit 1
for variable in $(compgen -e); do
  case "$variable" in
    GIT_*|GITLEAKS_*|GH_*|GITHUB_*|SSH_*|*_API_KEY|*_TOKEN|BUN_OPTIONS|NODE_OPTIONS) unset "$variable" ;;
  esac
done
export SOURCE OWNED VERIFY_NODE VERIFY_BUN VERIFY_PI VERIFY_SANDBOX GIT
export HOME="$OWNED/home" TMPDIR="$OWNED/tmp"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export PI_CODING_AGENT_DIR="$AGENT_DIR" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
export PATH="$(dirname "$VERIFY_BUN"):/usr/bin:/bin"
cd "$OWNED/repo" || exit 1
"$GIT" init -b main
"$GIT" config user.name 'Test User'
"$GIT" config user.email test@example.invalid
"$GIT" config commit.gpgsign false
printf '# Example\n' > README.md
"$GIT" add README.md
"$GIT" commit -m 'docs: add example'
printf '\nRun the example locally.\n' >> README.md
```

起動前にsource版／dirty（新規未追跡資材含む）と関連fileのSHA-256 manifest、runtime版、probe結果を無秘密のrun記録へ保存・固定する。manifestには入口／両製品reference／製品TS・設定と、使用する検証Skill／Map／専用手順／RPC・metric helper／使捨てsetup・driverを含める。終了後も同じdigestを照合し、run中はsource・手順・helper・起動済みsetup／driverを編集しない。修正が必要ならそのrunを終了・wait・cleanupして証拠を保持し、修正後に別fresh setupと新manifestで検証する。以前の版不明runを最終版の成功に流用しない。production変更前baselineが必要な変更ではclean HEADの`git archive`をowned read-onlyコピーへ保存しchmod -R a-w／uidを確認する。reset／stashは禁止。旧Pythonは既存実体だけ使い、新installしない。今回の比較は旧commitと新commit-mainの入口／branch差があることを明記する。

## 公開CLI: focused代表

`"$VERIFY_NODE" --test "$SOURCE/tests/commit-workflow.test.ts"`で実Git fixtureとBun公開JSONを通す。`VERIFY_BUN`を上でexportしておく。default一意／なし／競合／broken／orphan／non-symbolic／逆mapping／負除外、必要checkpoint drift、固定文章／旧参照／execute上書き拒否、scope／部分Stage／純Stage削除／特殊名、scanner／hooks／private／所有外保持を選ぶ。追加のfocused代表はliteral `.`の全ルート対象、scanner真不在／実在scannerのinterpreter欠落停止、MERGE_HEADのinspect／Stage前／plan後execute直前の拒否（HEAD／refs／index不変、Stage保持）を確認する。partial cloneはownedの`file://` bareにallowFilterを設定し、`clone --filter=blob:none --no-checkout`と`read-tree HEAD`で必要blob欠落を作る。ambient `GIT_NO_LAZY_FETCH=0`でも公開CLIは非0、trace2のfetch起動0、終了後blob不在を確認する。実remoteを使わない。testsは自分のfixtureだけを削除する。

手作業で公開CLIを独立確認する場合は[製品手順](../../../../skills/commit/references/commit-main-bun.md)の起動からinspect→materials→plan→executeへ進む。本文／設定はplan前だけ渡し、executeは参照だけ。実Gitの親／tree／全refs／branch／index／raw本文と照合する。内部handlerや成功mockで代用しない。

## fresh Pi: 通常承認とcancel

各caseで上記setupを新規に行う。標準はread,bashだけ、Codemode／追加extensionなし。共有RPC helperは接続・入力・観測だけで、Git操作や判断を代行しない。

```bash
"$VERIFY_NODE" --test "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.test.ts"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
  "$OWNED/repo" "$SOURCE/skills/commit-main/SKILL.md" "$OWNED/evidence" \
  --request '/skill:commit-main commit messageは正確に docs: explain local example と末尾LF。' \
  --answer-file "$OWNED/answer" > "$OWNED/driver.out" 2> "$OWNED/driver.err" &
DRIVER_PID=$!
```

`DRIVER_PID=$!`はNode観測者のPID。同じ親Bashを終了させず保持し、その親の`$$`と`DRIVER_PID`を起動直後に記録する。別tool invocationのshellから`wait`しても子でないため待てない。上の起動から下の`wait`までを同一の親shell（対話shell、または起動前に完成・digest固定した使捨てdriver）で実行する。driverならanswer-fileを別shellから作成し、driver自身が`wait "$DRIVER_PID"`のexitを保存する。起動済みdriverの編集・再利用は禁止。no-confirmはforeground実行でもよく、backgroundなら同じ親でPID記録・waitする。

別shellで`operations.jsonl`の`waiting_for_answer`と実際の完成文章／操作一式／一括承認質問を読む。get_commandsは明示Skill1つ、get_stateの正常provider/model/thinkingを確認する。比較時はbaselineとの一致を記録し、不一致なら無断変更しない。承認前HEAD／全refsは元mainだけ、commit数1、Stage後treeは予定tree、branch作成／切替／通信0を実Gitで確認する。owned/tmp内の今回private directoryには必要stateだけあり、diff.bin／history.binが質問前に削除済みで0700／0600であることを確認する。

想定した承認質問でなければ実行回答を送らない。同じsessionへ本当の回答を送る。

```bash
printf '提示内容で実行\n' > "$OWNED/answer" # cancel代表は「キャンセル」
wait "$DRIVER_PID"
```

正常はmainだけ前進し、新branch／切替／通信なし。親=元HEAD、tree=承認時index tree、index=実tree、raw本文=`docs: explain local example\n`を`git cat-file commit HEAD`からbytesで照合する（trim／整形log不可）。cancelはHEAD／refs不変でStage残存、reset／unstageなし。通常assistantの結果報告と実状態を照合し、script成功だけで承認を推定しない。RPC通常テキスト承認はask_user_questionのTUI通過実証ではない。

`--no-confirm`代表ではanswer-fileなし、requestに明示`--no-confirm`。通常承認だけ省略し、予定表示／plan保持／検査／直前照合は同じ。独立したfresh状態で行う。

## default疑義: 実質問・未回答Stage0

fresh setupのbase commit後、README追記前にfixtureを追加する。通信しない。

```bash
"$GIT" remote add origin https://example.invalid/fixture.git
"$GIT" update-ref refs/remotes/origin/master HEAD
"$GIT" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
"$GIT" remote add backup https://example.invalid/backup.git
"$GIT" update-ref refs/remotes/backup/develop HEAD
"$GIT" symbolic-ref refs/remotes/backup/HEAD refs/remotes/backup/develop
# broken代表ならbackupを作らずorigin HEAD targetを未存在refs/remotes/origin/missingへ。
```

request=`/skill:commit-main --no-confirm`、answer-fileなしで起動する。候補／理由、実際のdefault質問、選択肢＋自由回答要求を通常assistantで観測する。回答は与えない。HEAD／全refs／index bytesがbeforeと同じ、Stage0と通信0を確認する。「確認が必要」や再実行案内だけの報告なら不成立。既知作業branchは疑義質問で押し通さず拒否し、回答後の作業branch拒否は公開CLIで別途確認する。

## Bunなしlocal互換

fresh setup後、Pi起動前からPATHをowned/binだけにする。導入済みGitと既存OS utilityをsymlinkし、Node観測者は絶対実体で起動する。Bun／Pythonを導入・偽装・起動しない。

```bash
ln -s "$GIT" "$OWNED/bin/git"
for utility in bash sh dirname basename uname sed awk grep cut tr sort find ls cat wc od cmp tail head mktemp mkdir rmdir rm test printf env date perl chmod readlink xargs which tee dd diff cp mv stat touch du xxd shasum openssl realpath; do
  executable=$(PATH=/usr/bin:/bin /usr/bin/which "$utility") || continue
  ln -s "$executable" "$OWNED/bin/$utility"
done
export PATH="$OWNED/bin"
! command -v bun && ! command -v python3 || exit 1
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
  "$OWNED/repo" "$SOURCE/skills/commit-main/SKILL.md" "$OWNED/evidence" \
  --request '/skill:commit-main --no-confirm commit messageは正確に docs: explain local example と末尾LF。'
```

起動・親PID・wait・manifest固定は通常承認と同じ。互換referenceの直接`mktemp`代入／捕捉／実体照合の短例は`"$VERIFY_NODE" --test "$SOURCE/tests/verification-skills.test.js"`でもBashと実Gitを使ってself-checkする。Bash 3.2を使う場合は版も記録し、成功だけでなく捕捉コマンド非0で後続停止することも確認する。

開始時Bun不在の観測→別互換ref全文read→現在mainへの直接commitをtool操作と実Gitで確認する。同梱TS／旧Pythonの製品CLI未試行、通常承認だけ省略、安全照合／raw本文／親／tree／ref／index保持と通信0を確認する。最初のGit観測前の`GIT_NO_LAZY_FETCH=1`設定、Stage前／commit直前のMERGE_HEAD不在確認もtool操作で照合する。同じ機械的ガード／速度の実証とは呼ばない。

## 証拠・cleanup・readback

保存先は`docs/verification/45/<一意run>/<case>/`。source版／dirty／関連digest、環境／操作／command exit／期待／観測／pass-fail／未確認、承認前後の最小Git snapshot、必要RPC操作とmetric、cleanupを無秘密の最小記録にする。Mapに履歴を書かない。fixture由来と確認したものだけを保存し、auth／秘密／不要raw logは記録しない。

`operations.jsonl`は全assistant request（tool-only含む）のtimestamp／duration／取得可能usageを含む。承認前／利用者待機／承認後／全体時間、assistant request数、生成code bytes／行（固定CLI呼出し・文章／設定payloadと区別）、未取得unknownを記録する。nested toolは外側toolCall IDで二重加算しない。旧入口との条件差を明記し、単発観測を安定した高速化の証明にしない。

helperはstdin closeでorderly shutdownし、自分のPi process groupだけをterminate／wait／不存在確認してcleanup.jsonへ記録する。所有するDRIVER_PIDもwaitし、別groupのhook／adapter等があればその所有PID／handleの終了と不存在も確認する。groupGoneでない場合は環境を削除しない。unknown lockは削除せず残存を報告する。

必要証拠をowned外のrunへ保存後、所有確認した今回OWNEDだけを削除する。read-only baseline sourceはRootの保存確認後、全必要run終了・uid確認後に所有者がcleanupする。製品cleanupの未知file保持と、検証者の使捨て環境全体cleanupは別。cleanup後にも短いrun READMEから**全証拠参照を実read**する。

再利用はproject trustを確認し新セッション／reload後、`/skill:verify-project commit-main Bun`、または実ファイルの明示read。Rootは別fresh状態でこの手順だけから公開CLI／実入口を選び独立確認する。全Map反復・旧3入口full-pipelineを今回成功扱いにしない。
