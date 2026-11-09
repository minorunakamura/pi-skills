# 新commit承認後のCodemode集約と停止・部分成功

初期対象は標準経路の新commit、一括承認後の公開CLI接続。実Agentの`commit-pr`通常承認と、ローカル2入口の直前default根拠照合を選ぶ。既存HEAD・Python-free・全入口full pipeline・全異常条件・実GitHub・将来のAgent遵守率は対象外。文言assertやscript単体成功でAgentの操作遵守を代用しない。[Feature Map](feature-map.md)の既存branch/script入口も維持する。

## 前提・fresh setup

[Skillの分離と隔離環境](../SKILL.md)を先に実行する。macOS sandbox、専用HOME/PATH/TMPDIR/Git設定、架空identity、正常なPi認証のみを使い、sourceへの未存在file作成拒否とowned書込成功を確認する。ambient Extensions/MCP/contextは無効、helperは`--no-extensions -e builtin:codemode --tools read,bash,codemode`だけを有効にする。authの独自read・複製・記録、install、利用者設定変更は禁止。既存の開発用`.venv`/pytestが必要。未導入ならinstallせず不足を報告する。

`SOURCE`はcheckout実体、`SELECTED_SOURCE`は今回Piに読ませるsource（通常`SOURCE`）、`OWNED`/`PYTHON`/`GIT`はSkillの隔離setupで確定したもの。全sourceを`git archive HEAD`で使捨て領域へコピーして`chmod -R a-w`した版を、変更前baseline用に保持する。checkoutのreset/stashは禁止。baselineはproduction文書変更前に得る。旧版へ検証helperをコピーせず、現checkoutのhelperから旧Skillを指定する。

以下は隔離環境を設定したBashでrepository rootをcwdに実行する。履歴はbase→first、新差分はpendingだけ。remoteはbaseだけのlocal bare。既存`RemoteTools.setup_tools`とfixtureをそのまま使う。架空GitHub URLはfixtureがlocal bareへ対応させるので、PR caseにはhelperの`--fixture-remote`を付ける。従来のローカルcaseのremote全面禁止をここへ流用しない。

```bash
SELECTED_SOURCE=${SELECTED_SOURCE:-$SOURCE}
PYTHONDONTWRITEBYTECODE=1 "$SOURCE/.venv/bin/python" -B - \
  "$SOURCE" "$SELECTED_SOURCE" "$OWNED" "$PYTHON" "$GIT" <<'PY'
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

source, selected, owned = map(lambda p: Path(p).resolve(), sys.argv[1:4])
python, real_git = sys.argv[4:6]
assert (owned / 'repo').exists() is False
(owned / 'repo').mkdir()
spec = importlib.util.spec_from_file_location(
    'remote_tests', source / 'skills/commit/tests/test_remote_scripts.py')
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# Only these non-secret values survive; setup_tools adds the owned fixture paths.
keys = ('PATH', 'HOME', 'TMPDIR', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL',
        'PI_CODING_AGENT_DIR', 'PI_OFFLINE', 'PI_SKIP_VERSION_CHECK', 'PI_TELEMETRY',
        'VERIFY_PI', 'VERIFY_SANDBOX')
env = {k: os.environ[k] for k in keys}
env.update(LC_ALL='C', PYTHONDONTWRITEBYTECODE='1')
tools = module.RemoteTools()
tools.setup_tools(owned, real_git, env)
env['PATH'] = os.pathsep.join((str(owned / 'bin'), str(Path(python).parent), '/usr/bin', '/bin'))
g = tools.git
for args in [('init', '-b', 'main'), ('config', 'user.name', 'Test User'),
             ('config', 'user.email', 'test@example.invalid'),
             ('config', 'commit.gpgsign', 'false')]:
    g(*args)
# Fixed existing objects make all six performance runs share the same history.
env.update(GIT_AUTHOR_DATE='1794165752 +0900', GIT_COMMITTER_DATE='1794165752 +0900')
tools.add_commit('base.txt', 'base')
base = g('rev-parse', 'HEAD').decode().strip()
g('init', '--bare', '-b', 'main', str(tools.remote))
g('remote', 'add', 'origin', str(tools.remote))
g('push', 'origin', 'main')  # Fixture setup only, not the product push.
g('switch', '-c', 'feature')
env.update(GIT_AUTHOR_DATE='1794165753 +0900', GIT_COMMITTER_DATE='1794165753 +0900')
tools.add_commit('first.txt', 'first')
env.pop('GIT_AUTHOR_DATE')
env.pop('GIT_COMMITTER_DATE')
first = g('rev-parse', 'HEAD').decode().strip()
g('remote', 'set-url', 'origin', 'git@github-work:owner/repo.git')
(tools.repo / 'pending.txt').write_text('pending\n')
# Observe, without replacing the existing fixture behavior or any product guard.
wrapper = tools.bin / 'git'
wrapper.rename(tools.bin / 'fixture-git')
wrapper.write_text(f'#!{python}\nimport json, os, sys\n' +
    f'with open({str(owned / "git.log")!r}, "a") as log:\n' +
    '    log.write(json.dumps(sys.argv[1:]) + "\\n")\n' +
    f'os.execv({str(tools.bin / "fixture-git")!r}, ["git", *sys.argv[1:]])\n')
wrapper.chmod(0o700)
request = ("/skill:commit-pr 既存履歴とpending.txtを含むDraft PR。新branchはplanned、"
    "remote origin、repository github.com/owner/repo、base main、upstreamを設定。"
    "commit messageは正確に feat: pending と末尾LF。"
    "PR titleは正確に feat: 'quoted' $(touch unwanted)。"
    "PR bodyは正確に次の文字列（末尾LFあり）: \n"
    "## Why\n\nKeep `code`, $HOME and 'quotes'.\n")
(owned / 'env.json').write_text(json.dumps(env))
(owned / 'setup.json').write_text(json.dumps({
    'source': str(selected), 'base': base, 'first': first,
    'request': request, 'python': python, 'git': real_git}))
print(owned)
PY
```

source版/dirty、選択sourceの関連ファイルdigest、Pi/Git/Python版、環境の非秘密な前提をrun記録に残す。新規未追跡資産も対象にする。sourceの生diffやauth・settingsの内容は保存しない。

## Pi入口・承認前観測・実回答

```bash
"$PYTHON" "$SOURCE/.pi/skills/verify-project/scripts/check-commit-rpc.py"
"$PYTHON" "$SOURCE/.pi/skills/verify-project/scripts/summarize-commit-rpc.py" --self-check
"$PYTHON" -E -S - "$SOURCE" "$OWNED" <<'PY' > "$OWNED/driver.out" 2> "$OWNED/driver.err" &
import json
import subprocess
import sys
from pathlib import Path
source, owned = map(Path, sys.argv[1:])
setup = json.loads((owned / 'setup.json').read_text())
env = json.loads((owned / 'env.json').read_text())
command = [sys.executable, str(source / '.pi/skills/verify-project/scripts/commit-rpc.py'),
    str(owned / 'repo'), str(Path(setup['source']) / 'skills/commit-pr/SKILL.md'),
    str(owned / 'evidence'), '--fixture-remote', '--request', setup['request'],
    '--answer-file', str(owned / 'answer')]
result = subprocess.run(command, env=env)
(owned / 'exit').write_text(str(result.returncode))
sys.exit(result.returncode)
PY
DRIVER_PID=$!
```

helperは公開RPCの接続・入力・観測のみで、Git操作・branch判断・実行コード生成はしない。`get_commands`で指定Skillのみ、`get_state`で`openai/gpt-6.1-sol high`を確認してからpromptを送る。不一致ならmodelを変更して押し通さず停止する。`operations.jsonl`の`waiting_for_answer`を待ち、実際の提示・一括承認待ちを読む。想定外の質問なら`提示内容で実行`を送らない。待機中もhelperはstdoutを継続読取りする。`--timeout SECONDS`を明示する場合は承認待ちも含む**観測者の期限**であり、製品の各外部コマンド60秒やCodemodeのdeadlineとは別。既定の観測者deadlineはない。

別途、実Gitで承認前のHEAD=setup.first、headsはfeature=first/main=baseだけ、index tree=予定tree、bareはmain=baseだけ、push.logなし、gh.json.prs空、`pr create`記録0を確認して保存する。Stageとcheck/prepareのtree object作成は許可する。承認前にbranch作成・commit・push・PR作成があれば失敗。確認した文章・設定・diff理解・一時diff質問前削除をtool操作と照合してから、この同じsessionへ実回答を送る。

```bash
printf '提示内容で実行\n' > "$OWNED/answer"
wait "$DRIVER_PID"
cat "$OWNED/exit"  # 正常代表は0。0だけで機能成功とはしない。
"$PYTHON" "$SOURCE/.pi/skills/verify-project/scripts/summarize-commit-rpc.py" \
  "$OWNED/evidence/operations.jsonl" > "$OWNED/metrics.json"
```

## 実状態と操作の照合

観測はfixtureでなく確認済みの実Gitを直接使い、read-onlyで行う。`git cat-file commit HEAD`はbytesのまま解析し、整形logや`.strip()`で本文を検査しない。

- 実commit親はsetup.first、treeは承認時index tree、raw本文は`feat: pending\n`。HEAD/planned refだけがそのSHAへ進む。元feature/mainとindex treeは保持。明示upstream=origin/planned、bare planned=実SHA/main=base、余分なrefsなし。
- fixture gh.jsonのPRは1件、title/bodyはsetupの特殊文字と末尾LFが完全一致、Draft=true、head=planned/実SHA、base=main/base SHA。repo/unwantedは未存在。
- product Git/gh操作とRPC記録を読む。commit→verify→push check/push→PR check/create→最終確認/cleanup。push/create各1回、fetch/reset/amend/force/rebase/merge/release/deployなし。承認後の集約は外側Codemode1回・中継LLM0・assistant生成＋報告2回。内部bashの回数は集約回数ではない。正常結果のJSON全量受渡し・型/期待値検査、所有privateファイルのmode/digestと削除を生成コード/操作/実状態で照合する。
- `operations.jsonl`は本文のないtool-onlyを含む全assistant requestのtimestamp/durationMsを保存する。`summarize-commit-rpc.py`は実回答後のuser受領境界〜最終assistant完了をwall、全assistant durationMs合計をrequest時間、assistantが直接要求したtoolCall IDに一致するtool時間だけを外側時間として集計する（boundedなnestedCallsが不完全でも二重加算しない）。Codemode内部bashとの二重加算はしない。不明なmetadataは成功や0に補完しない。

## 停止代表と限定例

毎回fresh setupを使う。失敗注入をAgentへの追加作業指示にせず、fixture外部入力の変更として行う。product script、内部guardの成功固定・check書換えは禁止。期待error、後続mutation0、保持した成功段階と実状態を観測する。正常runを失敗runで上書きしない。

| 選定ケース | 最小の注入/入口 | 期待結果 |
| --- | --- | --- |
| commit後verify drift | gh fixtureのapi user境界で、実HEADがsetup.firstから変わった後だけfixture accountを別の架空accountへ変えるadapter | `pr_preparation_changed`、commit保持、push/create0。部分成功と停止段階を報告 |
| push後PR check drift | 同じ境界でproduct push.log作成後だけaccountを変える | verify/push成功、PR checkで`pr_preparation_changed`、bare SHA保持、create0 |
| ローカル直前照合 | 既存Mapのmain fallback→commitとdefault直接commit-main。少なくとも一方no-confirm | 集約内で保持したdefault根拠を**別途完全再取得/比較してから**commit。前者は新branch/元main保持、後者はbranch作成切替なし。両方通信なし、push/PR API0 |
| 無秘密大容量 | [限定Codemode例のfresh手順](large-json.md)。公開PR prepare/check双方の実JSONをfileへ完全保持。store単一値上限超かつbash戻り値1MiB超のASCII diff | 独立processで0700/0600・各write umask077・非symlink/uid/完全bytes/digestと後段入力/実Git/bare/fixture照合。小summaryだけ返し、所有外sentinelを保持。2MiB制限不変。Skill全文/通常承認の実証ではない |
| 不正応答 | [exit0・非objectのfresh限定例](invalid-json.md)。無秘密の公開CLI応答破損adapterで非object代表を返す。実CLI成功とadapter破損を区別 | 段階固有の解析/型検査で停止し後続0。exit0だけでは成功にしない |
| 1段階後全体中断 | [実commit後のfresh限定例](interruption.md)。次のread-only gh api user境界で所有PID/group/handleを記録して待機。観測者がcommit実成功と境界到達を照合して公開RPC abortを明示送信（外部60秒より前） | commit保持、push/create0。残るbounded出力/結果/実状態から部分成功/成否不明を区別。製品のfinally/report/cleanup必達は期待せず、別groupのCLI/adapterも所有者が終了・wait/不存在確認してから削除 |

drift代表はfresh setup後、Pi起動前に次を実行する。`DRIFT=after-commit`または`after-push`を選ぶ。既存ghをbasenameを保持したowned subdirectoryへ移し、公開api user境界で**owned gh.json.accountのみ**変更して同じ引数/stdinで元fixtureへexecする。内部handlerを呼ばない。条件成立/呼出し/実状態を記録し、正常との前提差はそのdriftだけにする。

```bash
umask 077
DRIFT=after-commit
"$PYTHON" -E -S - "$OWNED" "$DRIFT" <<'PY'
import json
import sys
from pathlib import Path
owned = Path(sys.argv[1])
mode = sys.argv[2]
assert mode in ('after-commit', 'after-push')
setup = json.loads((owned / 'setup.json').read_text())
original = owned / 'fixture' / 'gh'
original.parent.mkdir()
(owned / 'bin' / 'gh').rename(original)
adapter = owned / 'bin' / 'gh'
adapter.write_text(f'#!{setup["python"]}\n' +
    'import json, os, subprocess, sys\nfrom pathlib import Path\nos.umask(0o077)\n' +
    f'owned=Path({str(owned)!r})\nmode={mode!r}\n' +
    f'head=subprocess.check_output([{setup["git"]!r}, "-C", str(owned/"repo"), "rev-parse", "HEAD"]).decode().strip()\n' +
    f'changed=head!={setup["first"]!r} if mode=="after-commit" else (owned/"push.log").exists()\n' +
    'if sys.argv[1:]==["api", "--hostname", "github.com", "user"] and changed:\n' +
    '    state=json.loads((owned/"gh.json").read_text())\n' +
    '    state["account"]="other-fixture-account"\n' +
    '    (owned/"gh.json").write_text(json.dumps(state))\n' +
    '    with (owned/"adapter.jsonl").open("a") as log: log.write(json.dumps({"mode":mode,"head":head})+"\\n")\n' +
    f'os.execv({str(original)!r}, ["gh", *sys.argv[1:]])\n')
adapter.chmod(0o700)
PY
```

期待errorの名称だけでなく、adapterが承認前には未発火、対象時点で発火したこと、実commit/送信SHA保持、後続push/create回数とAgentの部分成功報告を確認する。

### ローカル2入口のfresh実行

PR用setupやdriftを流用しない。各caseで[Skillの隔離setup](../SKILL.md)から新しい`OWNED`を作り、[Mapの共通setup](feature-map.md#共通setupと観測)のmain/README追記を実行する。`commit`はremoteなしのmain fallback、`commit-main`は同じsetupのbase commit後・追記前に[通信なしremote HEAD fixture](feature-map.md#通信なしのremote-head-fixture)を`REMOTE=origin DEFAULT=main`で追加し、判別済みdefaultへの直接commitを確認する。fixture URLは接続せず、fetchしない。

両caseともPi起動前のbranch/HEAD/全refs（symbolic target含む）/index bytes/tree/branch設定を保存する。通常承認の`commit-main`は次のように起動し、別shellで`waiting_for_answer`と実提示を読んでから、承認前にも同じref/HEADと新branch/commit/push/createが0であることを確認してanswer fileを作る。Stage後のindex更新は許容する。

```bash
umask 077
"$PYTHON" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.py" \
  "$OWNED/repo" "$SOURCE/skills/commit-main/SKILL.md" "$OWNED/evidence" \
  --request '/skill:commit-main' --answer-file "$OWNED/answer" &
DRIVER_PID=$!
# 別shellで承認前観測後、同じowned answer fileへ実回答する。
# printf '提示内容で実行\n' > "$OWNED/answer"
wait "$DRIVER_PID"
```

`commit`はSkill/requestをともにcommitへ変え、`--request '/skill:commit --no-confirm'`とし、`--answer-file`を付けない。通常承認がないので起動前snapshotと操作順序を用いて、予定表示より前のbranch/commitなしとStage/check後だけのcommitを照合する。いずれも`--fixture-remote`を付けず、push/PR用prepareやgh fixtureは不要。

生成Codemodeと内側bashの完全な引数を読み、Stage前に保持したrepository/gitDir・現在branch・全local remote HEADの有無/symbolic target/解決OID・対応remote/順序付きfetch設定・候補/理由/回答を、集約内で**別途同じ方法で完全再取得して比較した後**にcommitしたことを確認する。単なるscript snapshot比較を成功としない。実Gitでcommit親=base、tree=Stage後予定tree、raw本文=提示値（既存LF規則）、元main保持/新branch1件（commit）、mainだけ前進/branch作成切替0（commit-main）、index treeと他refs/設定保持を照合する。Git操作記録からls-remote/fetch/push/gh/remote APIなし、commit終点・不要後続API0を確認する。通常承認のmetricには既存summarizerを使えるが、no-confirmを承認後性能3runへ混ぜない。cleanup/readbackは共通のまま。

既存PR（check.diff=null正常）、create競合の`existing`非重複/非編集、新規文章が未確定のままPR消失時create禁止、commit-pushのPR API非呼出し、Codemode開始前から不在の場合だけの逐次script fallbackは、[共有文書＋同じ呼出し例の限定実行＋既存回帰](limited-branches.md)で選ぶ。通常Pythonの固定例で実公開CLIの元準備/checkと文章有無を入力にし、push終点/fallbackの制御traceは実Agent/runtime境界と区別する。これらをfresh Pi全入口full pipeline通過と呼ばない。Codemode開始後の失敗からfallback・再試行・rollback・準備更新はしない。公開境界を通さない限定例の範囲はrun記録へ明示する。

## 証拠・cleanup・再実行

証拠は`docs/verification/36/<一意なrun>/<case>/`。source版/dirty/digest、環境/command/exit、approval前後のGit/index/bare/PR最小snapshot、操作、全metric、期待と観測、失敗・未確認、cleanupを残す。Mapとrun結果は分離する。秘密値・auth生出力・不要なraw logは保存しない。fixtureだけのoperationsも保存前に内容を確認する。

helperのstdin closeは公開RPCのorderly shutdownを使い、必要なら自分が起動したPi process groupだけterminate/killしてwaitし、`cleanup.json`へgroupGone/waited/exitを残す。中断caseのadapter/CLI/hookの**所有PID/group/handleも別途終了・wait/不存在を確認**してから環境を削除する。helperのgroup外へ残るprocessがあればcleanup成功とせず報告する。process名で一括終了しない。通常認証lockが残れば勝手に削除しない。

必要な証拠をowned外の上記runへコピーし、待機/終了確認済みの自分のOWNEDだけを削除する（検証環境全体の削除と製品の未知file削除禁止を混同しない）。read-only旧sourceも全run終了後に所有確認して削除する。cleanup後、短いrun READMEから全証拠とこの手順へ相対リンクし、全参照を実readする。一時パスや生存processを再実行の前提にしない。

性能比較は同fixture/履歴/差分/入口/文章指定/Pi版/provider-model-thinking/fresh contextで前後各3run。全値と中央値、失敗run、条件差、ばらつきと限界を報告する。承認前へ作業を移して短縮を装わず、生成・確認・cleanup・最終報告を含める。固定秒数/短縮率の閾値はなく、構造達成と実測時間の効果を別に判定する。時間短縮未観測なら高速化実証済みと書かない。

Rootはこの手順だけから別fresh PR正常/commit後停止/local直前照合を選び独立再実行する。正式4チェック/pack、独立Review/明示Code Review、全完了条件の受入れは[CONTRIBUTING](../../../../CONTRIBUTING.md)どおり別に行う。Piの新セッションか`/reload`、project trustの後、`/skill:verify-project 新commit承認後のCodemode集約と停止`または実Skillの明示readで再利用する。自動選択や全Map実行を必須にしない。
