# commit / commit-main: Bun公開CLIとfresh Pi入口

専用toolの明示extension／allowlist、実TUI即時表示・nonTUI・cancel／reloadは[commit_inspect手順](commit-inspect.md)を選ぶ。通常Skill操作は以下の明示extension／allowlistで行い、tool未導入対照だけ両optionを外してread,bashの既定を使う。開始後失敗を対照へ切り替えない。

対象は両ローカル入口。製品手順は[同梱Bun手順](../../../../skills/commit/references/local-bun.md)。pushは[専用Bun手順](push-bun.md)、PRは[専用Bun手順](pr-bun.md)を使う。旧3run／Codemode回数／性能閾値を今回へ流用しない。以下だけでfresh setupから再実行する。正式checks・独立Review・受入はRootの担当。

## 前提・fresh setup

macOS sandbox-exec、導入済みGit／Node24／Bun1.3.0+／Pi、正常なPi認証が必要。runtimeをinstallせず、shimでなく確認済み絶対実体を指定する。Bunなしcaseでも観測者は絶対Node実体で起動する。Piの導入版`docs/{rpc.md,rpc-commands.md,json.md,message-types.md,cli.md}`を読む。auth独自read／copy／log禁止。ambient Extensions／MCP／contextを読み込ませず（`--no-context-files`だけではglobal SYSTEM／APPEND_SYSTEMを防がないため、既存RPCはowned空regular fileの`--system-prompt`と固定isolation文の`--append-system-prompt`を明示）、model／thinkingは通常解決に任せ、diagnosticや意図しないfallbackを成功扱いしない。

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

起動前にsource版／dirty（新規未追跡資材含む）と関連fileのSHA-256 manifest、runtime版、probe結果を無秘密のrun記録へ保存・固定する。manifestには入口／両製品reference／製品TS・設定と、使用する検証Skill／Map／専用手順／RPC・metric helper／使捨てsetup・driverを含める。終了後も同じdigestを照合し、run中はsource・手順・helper・起動済みsetup／driverを編集しない。修正が必要ならそのrunを終了・wait・cleanupして証拠を保持し、修正後に別fresh setupと新manifestで検証する。以前の版不明runを最終版の成功に流用しない。production変更前baselineが必要な変更では未コミット／未追跡を含む変更直前sourceをowned read-onlyコピーへ保存しchmod -R a-w／uidを確認する。reset／stashは禁止。旧Pythonは既存実体だけ使い、新installしない。比較は変更前sourceと変更後sourceの同じ小diff／履歴／明示文章／通常承認を1組。両fixtureの初回commit前に同じ`GIT_AUTHOR_DATE`／`GIT_COMMITTER_DATE`（例`2026-01-01T00:00:00Z`）をexportし、元HEAD／diff digest／historyを照合する。変更前sourceがすでにBun版ならPython→Bunの速度効果とは呼ばない。baselineのruntime／呼出しは実際の変更前sourceに従い、既存Pythonが必要な旧版でも後続installしない。provider／model／thinkingの通常解決を照合し、条件差・失敗は隠さない。

## 公開CLI: focused代表

`"$VERIFY_NODE" --test "$SOURCE/tests/commit-workflow.test.ts"`で実Git fixtureとBun公開JSONを通す。`VERIFY_BUN`を上でexportしておく。default一意／なし／競合／broken／orphan／non-symbolic／逆mapping／負除外、必要checkpoint drift、固定文章／旧参照／execute上書き拒否、scope／部分Stage／純Stage削除／特殊名、scanner／hooks／private／所有外保持を選ぶ。追加のfocused代表はliteral `.`の全ルート対象、scanner真不在／実在scannerのinterpreter欠落停止、MERGE_HEADのinspect／Stage前／plan後execute直前の拒否（HEAD／refs／index不変、Stage保持）を確認する。partial cloneはownedの`file://` bareにallowFilterを設定し、`clone --filter=blob:none --no-checkout`と`read-tree HEAD`で必要blob欠落を作る。ambient `GIT_NO_LAZY_FETCH=0`でも公開CLIは非0、trace2のfetch起動0、終了後blob不在を確認する。実remoteを使わない。testsは自分のfixtureだけを削除する。

commitの追加代表は、inspect(mode=commit)→materials→plan(newBranch)→execute(参照のみ)。default／unbornからの新branch作成、作業branch維持（local default=developならmainも作業branch）／明示新branch、元ref保持・upstream非継承、形式／namespace衝突のStage前拒否、planの生成名衝突、直前branch/config drift、空diff・cancel、post-checkout hookのbranch／index／他ref変更／非0でcommitへ進まないことを公開JSONと実Gitで照合する。dangling symbolic branchは`git symbolic-ref refs/heads/planned refs/heads/missing`で作り、同名と親子namespaceを明示時Stage0／生成時planで拒否する。plan後に同名danglingを追加する代表もexecuteがbranch作成前に拒否し、HEAD／branch／index bytes／既存raw symref／config不変・不要referent missing未存在を照合する。通常作成とstaged-onlyの部分Stage残り保持を正常対照にする。残存remote＋merge設定からupstreamが付く名は明示時Stage前／生成時planで拒否し、設定は保持する。片方だけの無関係な設定は正常対照とする。

手作業で公開CLIを独立確認する場合は[製品手順](../../../../skills/commit/references/local-bun.md)の起動からinspect→materials→plan→executeへ進む。本文／設定はplan前だけ渡し、executeは参照だけ。実Gitの親／tree／全refs／branch／index／raw本文と照合する。内部handlerや成功mockで代用しない。

## W2: 通常Skill接続・read／release分岐の照合

以下の通常例は製品extension有効、同じhelperから両optionを外したread,bashだけのfresh runは開始時toolなし対照とする。対照では保護Bun確認→CLI inspect→通常テキスト一覧、旧表示tool0を期待する。tool開始後の失敗から対照へ切り替えない。

- `operations.jsonl`のassistant.toolCallsとread引数を突き合わせ、入口の全文read一式が同じassistant turnから発行されたことを確認する。commit／commit-mainはlocal、pushはlocal＋push、PRはlocal＋push＋PR＋diff-review。切断のtail取得を後続操作より前に確認する。PR > push > localで、local無通信／default質問がpush／PRへ漏れない。
- 通常起動は実repository・明示modeの`commit_inspect`1回。手動probe／CLI inspect／status JSON転記／旧表示tool／assistantの重複一覧0。完全結果／referenceと返された絶対Bunが全後続保護CLIに引き継がれることを実引数と照合する。意味理解・完成文章／操作一式・実質問・通常承認は別の通常assistant表示。
- 追加質問なしのmaterials→planは独立release0。完成またはPR中間planの`payloadRemoved=true`と、今回privateの6実体（diff.bin／history.bin／recent-history.bin／pr-diff.bin／pr-history.bin／pr-templates.bin）不在を提示・質問前に照合する。PR中間`phase=materials, executable=false`は承認・execute不可、返された新referenceで不足文章を補う。
- 材料後に疑義質問が必要な代表は、固定材料取得後・plan前の質問を要するrequestを別fresh runで与え、release成功・新reference採用・6 bin不在（recent-history.binを含む）が実質問より前であることを確認する。inspect時点の質問にはdiff payloadなし。想定外質問へ通常承認を送らない。
- 実削除拒否はpayload差替えによる所有検証失敗と分ける。macOSの別fresh公開CLI代表でmaterials後の既知owned diff.binだけを追加sandbox規則`(deny file-write-unlink (literal "確認済みdiff.bin絶対path"))`で拒否し、通常のvalidate／readを許可したまま保護planを呼ぶ。通常対照は同条件の別freshでdenyなし。拒否時は非0・cleanup.complete=false／remainingと実payload残存・unknown sentinel保持・Stage保持、Git mutation0を確認し、自動retryしない。検証者のowned環境cleanupはprocess終了後、製品cleanupとは分けて記録する。
- `already_pushed`／`existing_pr`はcleanup.complete／実directory不在と不要承認0。plan失敗／削除拒否は停止・返却cleanup／残存報告、所有検証不能時は未確認とし、unknown sentinel／差替え保持・reset／unstage／retry0を公開CLI代表で照合する。

比較はlocalとPR各1組を同条件（小diff／固定履歴日時／scope／固定文章／通常承認／通常解決provider-model-thinking）で行う。read-only baselineを変更せず新旧で同じhelperを固定し、旧版の表示extensionは当時のまま`--tools read,bash,commit_status_display`で明示ロードする。metricのturn/read／arguments/result bytesからprobe・inspect・転記表示・release・readの往復を手分類し、観測不能はunknown。取得→実TUI一覧は別の時刻付きsnapshotで確認し、RPC終了時刻を描画時刻と呼ばない。秒数・usageと構造改善を区別し、条件差／待ち時間／nested二重計上を明示する。

## fresh Pi: commit通常承認とcancel

下の標準例はdefault上のcommit。commit-main代表はSkillとrequestをcommit-mainへ置換し、新branchなし・main前進を期待する。作業branch維持no-confirmはbase commit後に`git switch -c feature/docs`してから同じ追記を行う。対象外保持を組み合わせる場合は`printf 'keep outside\n' > outside.txt`を追加し、requestを「README.mdだけを対象」とする。比較baselineも同じfixture／scopeにする。

各caseで上記setupを新規に行う。標準は明示製品extensionとread,bash,commit_inspectだけ。Codemode／ambient extensionなし。共有RPC helperは接続・入力・観測だけで、Git操作や判断を代行しない。

```bash
"$VERIFY_NODE" --test "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.test.ts"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
  --extension "$SOURCE/extensions/commit-status.js" --tools read,bash,commit_inspect \
  "$OWNED/repo" "$SOURCE/skills/commit/SKILL.md" "$OWNED/evidence" \
  --request '/skill:commit README.mdだけを対象。commit messageは正確に docs: explain local example と末尾LF。' \
  --answer-file "$OWNED/answer" > "$OWNED/driver.out" 2> "$OWNED/driver.err" &
DRIVER_PID=$!
```

`DRIVER_PID=$!`はNode観測者のPID。同じ親Bashを終了させず保持し、その親の`$$`と`DRIVER_PID`を起動直後に記録する。別tool invocationのshellから`wait`しても子でないため待てない。上の起動から下の`wait`までを同一の親shell（対話shell、または起動前に完成・digest固定した使捨てdriver）で実行する。driverならanswer-fileを別shellから作成し、driver自身が`wait "$DRIVER_PID"`のexitを保存する。起動済みdriverの編集・再利用は禁止。no-confirmはforeground実行でもよく、backgroundなら同じ親でPID記録・waitする。

別shellで`operations.jsonl`の`waiting_for_answer`と実際の完成文章／操作一式／一括承認質問を読む。get_commandsは明示Skill1つ、get_stateの正常provider/model/thinkingを確認する。比較時はbaselineとの一致を記録し、不一致なら無断変更しない。承認前HEAD／全refsは元mainだけ、commit数1、Stage後treeは予定tree、予定branch未存在・branch作成／切替／通信0を実Gitで確認する。owned/tmp内の今回private directoryには必要stateだけあり、diff.bin／history.binが質問前に削除済みで0700／0600であることを確認する。

想定した承認質問でなければ実行回答を送らない。同じsessionへ本当の回答を送る。

```bash
printf '提示内容で実行\n' > "$OWNED/answer" # cancel代表は「キャンセル」
wait "$DRIVER_PID"
```

正常は意味から計画した作業branchを1件だけ作成してcommitし、元main ref不変・upstream未設定・通信なし。作業branch維持代表は現在feature/docsだけ前進し、新branchなし。親=元HEAD、tree=承認時index tree、index=実tree、raw本文=`docs: explain local example\n`を`git cat-file commit HEAD`からbytesで照合する（trim／整形log不可）。限定scopeのoutside.txtは未追跡bytes不変。cancelはHEAD／refs不変・予定branch未存在でStage残存、reset／unstageなし。通常assistantの結果報告と実状態を照合し、script成功だけで承認を推定しない。RPC通常テキスト承認はask_user_questionのTUI通過実証ではない。

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

request=`/skill:commit --no-confirm`、answer-fileなしで起動する。候補／理由、実際のdefault質問、選択肢＋自由回答要求を通常assistantで観測する。回答は与えない。HEAD／全refs／index bytesがbeforeと同じ、Stage0と通信0を確認する。「確認が必要」や再実行案内だけの報告なら不成立。commit-mainの既知作業branchは疑義質問で押し通さず拒否し、回答後の作業branch拒否は公開CLIで別途確認する。commitは回答でdefaultを確定後、現在が作業branchなら維持する。

## Bun必須: 不在／非対応／確認不能のGit変更前停止

3入口はBun 1.3.0以上必須。起動前からBunなしPATHを作り、絶対Node観測者でfresh Piを起動する。local2入口それぞれとpushを別fresh状態で通し、no-confirmでも停止することを確認する。対象はREADME pendingの小fixtureだけでよく、無関係なhistoryを増やさない。

[push手順](push-bun.md)のfixture setupを再利用するとGit wrapper／PR呼出しmarkerとread-onlyなsnapshotを使える。local入口の正常caseとは別のfresh OWNEDへsetupし、local caseではremote通信を許可する--fixture-remoteを付けない。fixture seed pushは製品操作ではなく観測log開始前。snapshotはwrite-treeを呼ばずGIT_OPTIONAL_LOCKS=0でindex refreshも避け、index bytes・HEAD・全refs／symref・branch・全local config（upstream含む）・tracked／untracked worktree bytes/mode・bare refsを保持する。

```bash
# fixtureの既存bin/gitを上書きしない。正常setupもrun前に完了しておく。
for utility in bash sh dirname basename uname sed awk grep cut tr sort find ls cat wc od cmp tail head mktemp mkdir rmdir rm test printf env date perl chmod readlink xargs which tee dd diff cp mv stat touch du xxd shasum openssl realpath; do
  executable=$(PATH=/usr/bin:/bin /usr/bin/which "$utility") || continue
  ln -s "$executable" "$OWNED/bin/$utility"
done
export PATH="$OWNED/bin"
! command -v bun && ! command -v python3 || exit 1
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" snapshot "$OWNED" "$GIT" > "$OWNED/before-stop.json"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
  --extension "$SOURCE/extensions/commit-status.js" --tools read,bash,commit_inspect \
  "$OWNED/repo" "$SOURCE/skills/commit/SKILL.md" "$OWNED/evidence" \
  --request '/skill:commit --no-confirm README.mdだけを対象。'
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" snapshot "$OWNED" "$GIT" > "$OWNED/after-stop.json"
cmp "$OWNED/before-stop.json" "$OWNED/after-stop.json"
```

commit-mainはSkillとrequestを置換し別fresh状態で実行。pushは[専用手順](push-bun.md)の--fixture-remoteを付ける。command exit／snapshot一致と全tool操作・git.jsonlで、必要条件「Bun 1.3.0以上」案内、Stage／commit／push／PR作成0、旧Python／手書きmutation／install未試行を照合する。製品Git操作が全くない場合のgit.jsonl未作成は0回として記録する。観測だけでStage成功を推定しない。

非対応versionと不正probeは同じ共有起動経路の代表を選ぶ。古いBun実体がなければinstallせず、owned/bin/bunをversion応答と呼出し記録だけの小fixtureにする。trusted scripts cwd・BUN_OPTIONS／NODE_OPTIONS除去・同梱config／env-file／no-install付き--version以外は拒否し、製品CLI／Gitを代行しない。1.2.0応答と不正応答を別fresh状態で確認し、**Agentの停止判断のみ、実旧Bunの実証ではない**と明記する。source／fixture／driverを起動前manifestへ含める。対応実Bunの正常と人工startup marker非実行は公開CLIの既存testを使う。開始後scanner／hook失敗の代表では別経路への切替がないこともtool操作で確認する。

起動・親PID／wait・manifest・metric・cleanup/readbackは正常caseと共通。停止成功は互換経路でのcommit／local bare到達成功とは呼ばない。

## 通信と小diff一括の観測

正常Pi認証通信と製品Git通信を混同しない。local操作のGit子processをowned PATHの小さいlogging wrapperで観測する場合は、引数をowned/git.logへ追記して確認済み実Gitへ`exec`するだけにする（成功値やGit内容を置換しない）。起動前にwrapperもmanifest固定。trace2も利用できる。全tool操作と子processでfetch／push／ls-remote／gh等の通信コマンド0、必要object欠落時fetch0を確認する。hooks等任意外部process全般の通信sandbox保証とは呼ばない。材料がdisplayed=trueで一覧・diff・必要履歴の一括1応答、不要なread再取得なし、承認質問前にdiff.bin/history.bin削除・private0700/0600を操作記録＋実fileで照合する。

## 証拠・cleanup・readback

保存先は`docs/verification/<issue-number>/<一意run>/<case>/`。source版／dirty／関連digest、環境／操作／command exit／期待／観測／pass-fail／未確認、承認前後の最小Git snapshot、必要RPC操作とmetric、cleanupを無秘密の最小記録にする。Mapに履歴を書かない。fixture由来と確認したものだけを保存し、auth／秘密／不要raw logは記録しない。

`operations.jsonl`は全assistant request（tool-only含む）のtimestamp／duration／取得可能usageを含む。承認前／利用者待機／承認後／全体時間、assistant request数、生成code bytes／行（固定CLI呼出し・文章／設定payloadと区別）、未取得unknownを記録する。nested toolは外側toolCall IDで二重加算しない。旧入口との条件差を明記し、単発観測を安定した高速化の証明にしない。

helperはstdin closeでorderly shutdownし、自分のPi process groupだけをterminate／wait／不存在確認してcleanup.jsonへ記録する。所有するDRIVER_PIDもwaitし、別groupのhook／adapter等があればその所有PID／handleの終了と不存在も確認する。groupGoneでない場合は環境を削除しない。unknown lockは削除せず残存を報告する。

必要証拠をowned外のrunへ保存後、所有確認した今回OWNEDだけを削除する。read-only baseline sourceはRootの保存確認後、全必要run終了・uid確認後に所有者がcleanupする。製品cleanupの未知file保持と、検証者の使捨て環境全体cleanupは別。cleanup後にも短いrun READMEから**全証拠参照を実read**する。

再利用はproject trustを確認し新セッション／reload後、`/skill:verify-project commit Bun local`、または実ファイルの明示read。Rootは別fresh状態でこの手順だけから公開CLI／実入口を選び独立確認する。全Map反復・実GitHub・恒久full-pipeline E2Eは要求しない。
