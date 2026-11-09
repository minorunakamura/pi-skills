# 既存PR・文章未確定・push終点・開始前fallbackの限定例

[集約手順](execution-batching.md)の最後の選定まとまりだけ。共有[workflow手順9〜11](../../../../skills/commit/references/workflow.md)と[集約指示](../../../../skills/commit/references/execution-batching.md)を全文読み、下の**同じ小さい呼出し例**の分岐を実行する。通常Pythonであり、Pi/Codemode/Skill全文/通常承認の実行ではない。文書契約＋限定例＋既存公開CLI回帰の組合せであり、全Agentの遵守証明にしない。既存の正常/性能/大容量/不正/中断/local代表を反復しない。

## 保証と境界

| 共有指示の条件 | 下の例で実際に通す境界・観測 |
| --- | --- |
| 最終checkの既存PR（diff:null正常） | 公開prepared checkの元object → `finish_pr`。create/編集0、元既存結果を保持 |
| create直前競合のexisting正常 | 既存なしの元checkを保持 → 別actorの公開create → 同じcheckで例の公開create。実返値existing、追加gh create/編集0、fixture全PR不変 |
| 準備時既存→文章/承認省略→最終checkで消失 | fixtureの外部PR一覧だけを削除 → 元準備＋実commitの公開prepared check。承認済み文章なしでcreate0、不足を返し、実commit/bare SHA/refs/index保持 |
| push終点 | `after_commit("push", call)`の呼出しtraceでPR prepare/verify/check/create全0。実push入口の再実行ではない |
| Codemode開始前から不在だけ逐次script | `dispatch(False, ...)`は逐次例のみ。開始後の例外/不正/不一致/timeout/中断代表は集約側1回・逐次0、再実行0。可用性検出や実RPCの失敗は通さない |

`finish_pr`は集約指示の「最終PR checkで既存なら保持」「今回確定した文章がある場合だけcreate」「existingの非空pullRequestsを保持」に対応する固定例。`after_commit`/`dispatch`は到達点表/開始前不在の制御接続だけで、callable traceは実製品APIの成功に読み替えない。共通validator/製品runnerではない。既存回帰はscript側の重複防止とdiff:nullを担い、Agentの分岐遵守とは呼ばない。実Codemode正常/停止等は別の選定手順の役割であり、本例で代替しない。

## fresh実行

repository rootをcwdとし、既存Python 3.14以上の開発用`.venv`（pytest importに必要）、Git、macOS sandboxを使う。install不要。Piを起動せずauthを利用/読取/コピーしないので、導入Pi資料の再読やRPC helper変更は不要。専用HOME/PATH/TMPDIR/config・架空identity、全write umask077。外部60秒の製品契約は不変。下の180秒は各CLIを観測する側の期限であり、Codemodeの期限ではない。任意中断でfinally/cleanup必達は保証しない。

```bash
set -euo pipefail
umask 077
SOURCE=$(pwd -P)
PYTHON="$SOURCE/.venv/bin/python"
GIT=$(command -v git)
"$PYTHON" -E -c 'import sys; assert sys.version_info[:2] >= (3,14); import pytest; print(sys.version.split()[0])'
OWNED=$(mktemp -d /private/tmp/pi-limited-branches.XXXXXXXX)
OWNED=$(cd "$OWNED" && pwd -P)
EVIDENCE="$SOURCE/docs/verification/36/worker-limited-branches-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$EVIDENCE" "$OWNED/home" "$OWNED/tmp" "$OWNED/bin" "$OWNED/repo" "$OWNED/private"
export SOURCE PYTHON GIT OWNED EVIDENCE
cat > "$OWNED/sandbox.sb" <<EOF
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "$OWNED") (literal "/dev/null"))
(deny file-read* (subpath "$HOME/.ssh") (subpath "$HOME/.aws")
 (subpath "$HOME/.gnupg") (subpath "$HOME/.config") (subpath "$HOME/.pi/agent"))
EOF
```

次の実行前に、同じprofileでowned書込成功とsourceの未存在一意名作成拒否/未作成を照合し、source版/dirty・関係ファイルdigest・Python/Git版をrunへ保存する。[既存公開script手順](staged-push-pr.md)の`source.json`記録方法を使い、今回の3つの参照文書もdigest対象にする。共有設定へのwrite許可はprofileに一切ない。probeは既存sourceを開かない。

```bash
PROBE="$SOURCE/.limited-branches-denied-$(basename "$OWNED")"
test ! -e "$PROBE"
env -i PATH=/usr/bin:/bin HOME="$OWNED/home" TMPDIR="$OWNED/tmp" \
  /usr/bin/sandbox-exec -f "$OWNED/sandbox.sb" "$PYTHON" -E -S -c \
  'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("probe")' "$OWNED/write-probe"
if env -i PATH=/usr/bin:/bin HOME="$OWNED/home" TMPDIR="$OWNED/tmp" \
  /usr/bin/sandbox-exec -f "$OWNED/sandbox.sb" "$PYTHON" -E -S -c \
  'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("probe")' "$PROBE" 2>/dev/null; then exit 1; fi
test ! -e "$PROBE"
```

以下は当該限定例の固定入力/観測用inline材料のみ。実CLIの元objectを変更せず渡す。最初の空PR準備と、外部PRを初期化した後の既存PR準備を保持し、**同じ一回の実commit/push**で最終check両分岐を確認する。追加履歴はbaseのみ。PR一覧のseed/消失だけがfixture外部入力であり、guard/check/成功をmockしない。別actorのcreateも公開CLIで一回だけ実行する。

これは共有fixture上の**独立した3回の`finish_pr`限定呼出し**であり、1本の製品workflowではない。`old + approved_old=None`の消失呼出しはその場で終了し、当該呼出しのcreate0・Git/push状態保持をassertする。その後のactor/createは、別分岐の初期入力`new + approved`（固定された承認済みfixture値）による競合例だけ。停止したoldへ文章を生成して復旧/続行したものではない。共有fixtureでの材料保持は検証matrixの省力化であり、複数Skill呼出し間の準備/承認再利用を許可しない。各呼出しのsnapshotは既存=公開create0、消失=公開create0、競合=例の公開create1/追加gh create0（別actorのgh create1）として別々に記録する。matrix全体を停止後mutation0とは呼ばない。

```bash
cat > "$OWNED/example.py" <<'PY'
import hashlib, importlib.util, json, os, signal, stat, subprocess, sys
from pathlib import Path
os.umask(0o077)
source, owned = Path(sys.argv[1]), Path(sys.argv[2])
real_git = sys.argv[3]
assert sys.version_info[:2] >= (3,14)
env = {'PATH':str(owned/'bin'), 'HOME':str(owned/'home'), 'TMPDIR':str(owned/'tmp'),
       'GIT_CONFIG_NOSYSTEM':'1', 'GIT_CONFIG_GLOBAL':'/dev/null', 'LC_ALL':'C'}
spec = importlib.util.spec_from_file_location('remote_tests', source/'skills/commit/tests/test_remote_scripts.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
t = m.RemoteTools()
t.setup_tools(owned, real_git, env)
g = t.git
for a in [('init','-b','main'), ('config','user.name','Test User'),
          ('config','user.email','test@example.invalid'), ('config','commit.gpgsign','false')]: g(*a)
t.add_commit('base.txt','base')
base = g('rev-parse','HEAD').decode().strip()
g('init','--bare','-b','main',str(t.remote))
g('remote','add','origin',str(t.remote))
g('push','origin','main')  # owned fixture seed, not product push
assert t.push_calls() == []
g('switch','-c','feature')
g('remote','set-url','origin','git@github-work:owner/repo.git')
(t.repo/'pending.txt').write_text('pending\n')
g('add','--','pending.txt')
tree = g('write-tree').decode().strip()
operations, files, branches = [], {}, {}
def digest(raw): return hashlib.sha256(raw).hexdigest()
def meta(p):
    s=p.lstat()
    assert not p.is_symlink() and s.st_uid==os.getuid() and p.resolve().parent==owned/'private'
    assert stat.S_IMODE(s.st_mode)==0o600
    raw=p.read_bytes()
    return {'bytes':len(raw),'sha256':digest(raw),'mode':'0o600','uid':s.st_uid}
def cli(label, script, args, request=None):
    os.umask(0o077)
    command=[sys.executable,'-E','-S',str(source/'skills/commit/scripts'/script),*args]
    paths=[owned/'private'/(label+s) for s in ('.in','.out','.err')]
    raw=b'' if request is None else json.dumps(request).encode()
    assert len(raw)<2097152
    for p in paths:
        with p.open('xb') as f:
            if p==paths[0]: f.write(raw)
    with paths[0].open('rb') as inp, paths[1].open('wb') as out, paths[2].open('wb') as err:
        child=subprocess.Popen(command,cwd=t.repo,env=env,stdin=inp,stdout=out,stderr=err,start_new_session=True)
        try: rc=child.wait(timeout=180)  # observer only; product external timeout stays 60s
        finally:
            try: os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            child.wait()
            try: os.killpg(child.pid,0)
            except ProcessLookupError: pass
            else: raise AssertionError('owned CLI group remains; do not cleanup')
    operations.append({'label':label,'command':command,'exit':rc,'pid':child.pid,'waited':True,'groupGone':True})
    files.update({p.name:meta(p) for p in paths})
    assert rc==0 and paths[2].read_bytes()==b'', label+' failed; stop without retry'
    value=json.loads(paths[1].read_bytes())
    assert isinstance(value,dict) and 'error' not in value
    return value

def finish_pr(preparation, checked, approved, create):
    # Fixed calling example: the public CLI retains responsibility for its guards.
    if checked['existingPullRequests']:
        return {'status':'existing','pullRequests':checked['existingPullRequests']}
    if approved is None:
        assert preparation['existingPullRequests']
        return {'status':'stopped','reason':'new PR text/settings not confirmed'}
    result=create({'check':checked, **approved})
    assert result['status'] in ('created','existing')
    if result['status']=='existing': assert result['pullRequests']
    return result

# Small control-only examples; these labels are NOT public CLI execution evidence.
def after_commit(endpoint, call):
    if endpoint=='PR': call('pr-verify')
    call('push-check'); call('push')
    if endpoint=='PR': call('pr-check/create')
def dispatch(available_before_start, aggregate, sequential):
    if not available_before_start: return sequential()
    return aggregate()  # No catch/retry or fallback after this boundary.
trace=[]
after_commit('push',trace.append)
assert trace==['push-check','push']
branches['push-endpoint']={'trace':trace,'prPrepareVerifyCheckCreateCalls':0,'boundary':'control example only'}
trace=[]
assert dispatch(False,lambda:trace.append('aggregate'),lambda:trace.append('sequential-script')) is None
assert trace==['sequential-script']
branches['absent-before-start']={'trace':trace,'boundary':'control example only'}
for reason in ('nonzero','invalid-response','mismatch','timeout','interrupted'):
    trace=[]
    def fail():
        trace.append('aggregate-start')
        raise RuntimeError(reason)
    try: dispatch(True,fail,lambda:trace.append('sequential-script'))
    except RuntimeError as e: assert str(e)==reason
    else: raise AssertionError('expected failure')
    assert trace==['aggregate-start']
    branches['failure-after-start-'+reason]={'trace':trace,'boundary':'control example, not runtime injection'}

cc=cli('commit-check','staged-commit.py',['check'])
assert cc['snapshot']['head']==base and cc['snapshot']['tree']==tree
assert cc['snapshot']['plannedBranch']=='feature' and cc['gitleaks'] in ('passed','unavailable')
pp=cli('push-prepare','guarded-push.py',['prepare','--remote','origin'],{'commitCheck':cc})
assert pp['kind']=='push-preparation' and pp['commitCheck']==cc
pr_args=['prepare','--remote','origin','--repo','owner/repo']
new=cli('prepare-no-pr','github-pr.py',pr_args,{'commitCheck':cc,'pushPreparation':pp})
assert new['kind']=='pr-preparation' and new['existingPullRequests']==[]
# Seed a minimal existing PR exactly as the existing future-PR regression does.
t.gh_state['prs']=[{'number':1,'url':'https://github.com/owner/repo/pull/1','state':'MERGED',
    'isCrossRepository':False,'headRefName':'feature','baseRefName':'main'}]
t.save_gh()
old=cli('prepare-existing','github-pr.py',pr_args,{'commitCheck':cc,'pushPreparation':pp})
assert old['kind']=='pr-preparation' and old['existingPullRequests'] and old['diff'] is None
assert old['commitCheck']==cc and old['pushPreparation']==pp
# No new PR text/settings/approval is constructed for this preparation.
approved_old=None
commit=cli('commit','staged-commit.py',['commit'],{'check':cc,'message':'feat: pending\n'})
sha=commit['commit']
assert commit['branch']=='feature' and commit['parents']==[base] and commit['tree']==tree
assert commit['messageSha256']==digest(b'feat: pending\n') and commit['gitleaks']==cc['gitleaks']
v=cli('verify','github-pr.py',['verify'],{'preparation':old,'commit':commit})
assert v=={'kind':'pr-verification','commit':sha,'branch':'feature','diffSha256':old['diffSha256']}
pc=cli('push-check','guarded-push.py',['check','--prepared'],{'preparation':pp,'commit':commit})
assert pc['snapshot']=={**pp['destination'],'head':sha} and pc['alreadyPushed'] is False
sent=cli('push','guarded-push.py',['push'],{'check':pc})
assert sent=={'status':'pushed','commit':sha,'branch':'feature','remote':'origin','target':'feature','upstreamConfigured':False}
def state():
    return {'head':g('rev-parse','HEAD').decode().strip(),
        'refs':g('for-each-ref','--format=%(refname) %(objectname) %(symref)').decode(),
        'indexSha256':digest((t.repo/'.git/index').read_bytes()),
        'bareRefs':t.remote_git('for-each-ref','--format=%(refname) %(objectname)').decode(),
        'pushCalls':t.push_calls()}
before=state()
assert before['head']==sha and t.remote_git('rev-parse','feature').decode().strip()==sha
assert g('cat-file','commit',sha).split(b'\n\n',1)[1]==b'feat: pending\n'
assert g('rev-parse','main').decode().strip()==base
checks={}
def check(label, preparation):
    c=cli(label,'github-pr.py',['check','--prepared'],{'preparation':preparation,'commit':commit})
    s=c['snapshot']
    assert s['head']==sha and s['branch']=='feature' and s['base']=='main' and s['remote']=='origin'
    assert isinstance(c['existingPullRequests'],list)
    checks[label]=c
    return c
creates=[]
def create(request):
    creates.append(request)
    return cli('example-create','github-pr.py',['create'],request)
existing=check('check-existing',old)
assert existing['diff'] is None and existing['existingPullRequests'][0]['state']=='MERGED'
fixture_before=(owned/'gh.json').read_bytes()
r=finish_pr(old,existing,approved_old,create)
assert r['pullRequests'] is existing['existingPullRequests'] and creates==[]
assert (owned/'gh.json').read_bytes()==fixture_before
branches['final-existing']={'result':r,'createCalls':0,'checkDiffIsNull':True}
# External disappearance, not a rewritten check or preparation.
t.gh_state['prs']=[]
t.save_gh()
missing=check('check-disappeared',old)
assert missing['existingPullRequests']==[] and isinstance(missing['diff'],str)
r=finish_pr(old,missing,approved_old,create)
assert r['status']=='stopped' and creates==[] and t.gh_calls('pr create')==[]
assert state()==before
branches['unconfirmed-disappeared']={'result':r,'approvedTextSettingsPresent':False,'createCalls':0,'gitPushStateUnchanged':True}
# A different preparation had no PR and has fixed approved text/settings as input.
approved={'title':"feat: 'quoted' $(touch unwanted)",'body':'Keep `code`, $HOME and quotes.\n','draft':True}
no_pr=check('check-before-race',new)
assert no_pr['existingPullRequests']==[]
actor=cli('other-actor-create','github-pr.py',['create'],{'check':no_pr,**approved})
assert actor['status']=='created' and len(t.gh_calls('pr create'))==1
fixture_before=(owned/'gh.json').read_bytes()
r=finish_pr(new,no_pr,approved,create)
assert r['status']=='existing' and r['pullRequests'][0]['number']==actor['number']
assert len(creates)==1 and creates[0]['check'] is no_pr
assert len(t.gh_calls('pr create'))==1 and t.gh_calls('pr edit')==[]
assert (owned/'gh.json').read_bytes()==fixture_before and state()==before
assert not (t.repo/'unwanted').exists()
branches['create-race']={'result':r,'examplePublicCreateCalls':1,'additionalGhCreateCalls':0,'editCalls':0,'fixtureBytesUnchanged':True}
# Full private bytes/digests remain intact, including original objects and CLI stdin.
for name, expected in files.items(): assert meta(owned/'private'/name)==expected
for label,c in checks.items(): assert json.loads((owned/'private'/(label+'.out')).read_bytes())==c
assert json.loads((owned/'private/example-create.in').read_bytes())=={'check':no_pr,**approved}
assert json.loads((owned/'private/check-disappeared.in').read_bytes())=={'preparation':old,'commit':commit}
for d in (owned,owned/'private'):
    s=d.lstat()
    assert not d.is_symlink() and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700
result={'status':'passed','branches':branches,'operations':operations,'privateMetadata':files,
    'gitBefore':before,'gitAfter':state(),'publicBoundaries':'prepare/commit/verify/push/prepared PR checks/create; owned Git/bare/gh fixture',
    'unverified':'Pi/Codemode/Agent approval, availability detection, runtime failure injection, full entry pipelines, real GitHub; created branch of finish_pr not executed'}
(owned/'result.json').write_text(json.dumps(result,indent=2)+'\n')
PY
# Clean environment: no ambient credentials, MCP/extensions/context or shell startup.
# pytest is imported only for the existing RemoteTools definition, not used as a runner here.
env -i PATH=/usr/bin:/bin HOME="$OWNED/home" TMPDIR="$OWNED/tmp" \
  /usr/bin/sandbox-exec -f "$OWNED/sandbox.sb" \
  "$PYTHON" -E -B "$OWNED/example.py" "$SOURCE" "$OWNED" "$GIT"
```

## 回帰・証拠・cleanup

実行前に同じsandbox profileでowned書込成功・sourceの未存在一意名作成拒否/未作成を照合する（既存sourceを開かない）。共有設定へのwrite許可はprofileに一切ない。source版/dirty・関係ファイルdigest・Python/Git版・環境・実command/exit・probe結果をrunへ保存する。実CLIの完全JSONはprivate保持し、保存証拠は`result.json`の分岐根拠/段階名/exit/実Git/bytes/digestだけ。無秘密fixtureでもauth生出力や不要な全JSONを転載しない。失敗runも保持しretry/fallback/rollback/準備更新しない。

既存nodeだけを選ぶ（文書契約と公開script回帰。既存testの変更なし）：

```bash
env -i PATH="$(dirname "$GIT"):/usr/bin:/bin" HOME="$OWNED/home" TMPDIR="$OWNED/tmp" \
  /usr/bin/sandbox-exec -f "$OWNED/sandbox.sb" \
  "$PYTHON" -E -B -m pytest -q -p no:cacheprovider --basetemp "$OWNED/regression" \
  skills/commit/tests/test_workflow_contract.py::test_new_commit_execution_batches_after_approval_without_changing_other_routes \
  skills/commit/tests/test_remote_scripts.py::TestRemoteScripts::test_pr_existing_open_closed_and_merged_are_not_duplicated \
  skills/commit/tests/test_remote_scripts.py::TestRemoteScripts::test_existing_merged_pr_is_returned_even_when_diff_is_empty \
  skills/commit/tests/test_remote_scripts.py::TestRemoteScripts::test_pr_future_existing_merged_duplicate_allows_empty_planned_diff
```

最初のremote testは名前に反して現在のparameterがCLOSEDだけであり、check後のcreateでPRを作った後、**保持した同じcheck**で再createして返値existingを実照合する。MERGED/diff:nullは次のtest、準備時既存は最後のtestで補う。OPEN/CLOSED/MERGED全状態のAgent実行を通したとは書かない。

全CLIは所有groupをwait/不存在確認してから返る。成功後に呼出し元で`result.json`をreadし、各private fileの非symlink/uid/0600/bytes/digest、所有root/dir0700、全CLI group不存在を独立に再照合する。未知root entry/所有者/symlink/group残存なら削除せず報告する。pytestが今回の`--basetemp`直下へ作成した3つの`*current` symlinkだけは例外として、実際の名前/uid/link文字列を記録し、targetが同じowned basetemp直下の今回のtest directory（非symlink）であると確認してから、その既知linkだけをunlinkする。一般のsymlinkを辿ったりglobで削除しない。必要証拠をrunへ保存した後だけ、自分が作成したfixture全体をcleanupする（製品例が未知fileを削除する権限とは別）。ファイルのinode/digest/uidを再照合してunlink、空dirをrmdirする。中断で記録が欠ければ未確認とし、cleanup必達と書かない。authに接続せずlockも作成/削除しない。

短いrun READMEにsource/environment/command-exit/probe、result、回帰結果、cleanupとこの手順への相対リンクを置き、cleanup後に**全参照を実read**する。Rootはこの手順のfresh setup/固定例を使って独立再現できる。全入口/実Codemode/性能の再実行を要求せず、正式4checks/pack/独立review/CodeReview/最終採否はRootへ残す。本まとまり完了後に別caseを開始しない。
