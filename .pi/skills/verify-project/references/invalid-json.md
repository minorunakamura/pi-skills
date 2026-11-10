# exit0・非object JSONで後続mutation0（限定Codemode例）

[集約手順](execution-batching.md)の不正応答一件だけ。fresh Skill全文・通常承認・全schema・部分成功・性能を実証しない。owned local repoのREADME自作diffをStageし、実`staged-commit.py check`の完全JSON/exit0をprivate保持して検査する。その**公開stdoutだけ**をowned adapterで`[]`へ破損しexit0を返す。実Codemodeのexit/完全parse/object/必要shape検査からcommitへ進めないことを実Gitと操作記録で照合する。guard mock・元check書換え・成功固定はしない。remote/fixture PR/追加履歴は不要。

## fresh setup

repository rootから[共通隔離setup](../SKILL.md#隔離環境の準備)を実行する。`SOURCE/OWNED/PYTHON/GIT/VERIFY_PI/VERIFY_SANDBOX`を確定しexportする。macOS sandbox、専用HOME/PATH/TMPDIR/config、架空identity、normal Pi authのみ、ambient Extensions/MCP/context無効を維持する。auth独自read/copy/log・install・共有設定変更・実repo/実GitHub mutationは禁止。Pi接続利用前に導入版`docs/{rpc.md,rpc-commands.md,json.md,message-types.md,codemode.md,cli.md}`を全文読む。helperは既存任意`--request`接続だけを使い、branch判断/code生成/Git代行を追加しない。

以下の3ブロックを順に実行する（Bash、全write umask077）。既存runを上書きせず、失敗後retry/rollback/準備更新/fallbackはしない。製品の各外部コマンド60秒は不変、Codemode全体の追加deadlineは付けない。任意中断でfinally/報告/cleanup必達は保証しない。TDD不採用。

```bash
umask 077
export SOURCE OWNED PYTHON GIT VERIFY_PI VERIFY_SANDBOX VERIFY_NODE
export EVIDENCE="$SOURCE/docs/verification/36/worker-invalid-json-$(date -u +%Y%m%dT%H%M%SZ)-$$"
"$PYTHON" -E -S - <<'PY'
import hashlib, json, os, stat, subprocess
from pathlib import Path
os.umask(0o077)
source, owned, evidence = (Path(os.environ[k]).resolve() for k in ('SOURCE','OWNED','EVIDENCE'))
evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
keys = ('PATH','HOME','TMPDIR','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','PI_CODING_AGENT_DIR',
        'PI_OFFLINE','PI_SKIP_VERSION_CHECK','PI_TELEMETRY','VERIFY_PI','VERIFY_SANDBOX','VERIFY_NODE')
env = {k:os.environ[k] for k in keys}
env.update(LC_ALL='C', PYTHONDONTWRITEBYTECODE='1')
real_git, python = os.environ['GIT'], os.environ['PYTHON']
repo = owned/'repo'
repo.mkdir()
def g(*args): return subprocess.check_output([real_git,'-C',str(repo),*args],env=env)
for a in [('init','-b','main'),('config','user.name','Test User'),('config','user.email','test@example.invalid'),
          ('config','commit.gpgsign','false')]: g(*a)
(repo/'README.md').write_text('# Example\n')
g('add','--','README.md')
g('commit','-m','docs: add example')  # fixture setup only
(repo/'README.md').write_text('# Example\n\nRead the local guide.\n')
g('add','--','README.md')
tree = g('write-tree').decode().strip()
setup = {'source':str(source),'owned':str(owned),'python':python,'git':real_git,'tree':tree,
         'head':g('rev-parse','HEAD').decode().strip(),
         'diffSha256':hashlib.sha256(g('diff','--cached','--binary','--no-ext-diff','--no-textconv')).hexdigest()}
(owned/'setup.json').write_text(json.dumps(setup))
# Transparent Git argv observation, not a guard/fixture implementation.
(owned/'bin/git').write_text(f'#!{python}\nimport json,os,sys\nos.umask(0o077)\n'+
    f'with open({str(owned/"git.jsonl")!r},"a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n'+
    f'os.execv({real_git!r},["git",*sys.argv[1:]])\n')
(owned/'bin/git').chmod(0o700)
env['PATH'] = os.pathsep.join((str(owned/'bin'),str(Path(python).parent),str(Path(real_git).parent),'/usr/bin','/bin'))
(owned/'env.json').write_text(json.dumps(env))
(owned/'private').mkdir(mode=0o700)
# Source-create refusal uses an absent unique name, never an existing source/config file.
probe = source/('.invalid-json-denied-'+owned.name)
assert not probe.exists()
cmd = [python,'-E','-S','-c','import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("probe")']
a = subprocess.run(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*cmd,str(owned/'write-probe')],env=env,capture_output=True)
b = subprocess.run(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*cmd,str(probe)],env=env,capture_output=True)
assert a.returncode == 0 and b.returncode != 0 and not probe.exists()
(evidence/'sandbox.json').write_text(json.dumps({'ownedWriteExit':a.returncode,'sourceCreateExit':b.returncode,
    'sourceAbsent':not probe.exists(),'sharedConfigWriteDeniedByProfile':True})+'\n')
assets = ['.pi/skills/verify-project/references/invalid-json.md',
          '.pi/skills/verify-project/scripts/commit-rpc.ts','skills/commit/references/execution-batching.md',
          *['skills/commit/scripts/'+p for p in ('staged-commit.py','git-status.py','git_guard.py')]]
def sg(*args): return subprocess.check_output([real_git,*args],cwd=source,env=env)
(evidence/'source.json').write_text(json.dumps({'head':sg('rev-parse','HEAD').decode().strip(),
    'dirty':sg('status','--short').decode(),'diffSha256':hashlib.sha256(sg('diff','--binary','HEAD')).hexdigest(),
    'assetsSha256':{p:hashlib.sha256((source/p).read_bytes()).hexdigest() for p in assets},
    'python':subprocess.check_output([python,'-E','-S','--version']).decode().strip(),
    'pi':subprocess.check_output([env['VERIFY_PI'],'--version']).decode().strip(),'git':sg('--version').decode().strip(),
    'platform':os.uname().sysname,'isolation':'dedicated HOME/PATH/TMPDIR/config; normal Pi auth; builtin codemode only'},indent=2)+'\n')
PY
```

## 公開応答adapterと実Codemode一回

下のadapterは実checkを一度だけ呼び、元JSON全体をfile側でparseして形/期待値を検査してから、stdoutだけを`[]\n`へ置換する。元応答は改変せず後続へ渡さない。Codemodeが受け取るのは小さいmetadataとこの3bytesの無秘密破損値だけ。到達してはいけないcommit呼出しも明示し、exit0だけでstage成功を表示しない。inlineコードは当該例のみであり独自runner/製品validatorではない。

```bash
umask 077
cat > "$OWNED/adapter.py" <<'PY'
import hashlib, json, os, stat, subprocess, sys
from pathlib import Path
os.umask(0o077)
o = Path(os.environ['TMPDIR']).parent
s = json.loads((o/'setup.json').read_text())
p = o/'private'
def meta(file):
    st = file.lstat()
    assert not file.is_symlink() and file.resolve().parent == p and st.st_uid == os.getuid()
    assert stat.S_IMODE(st.st_mode) == 0o600
    raw = file.read_bytes()
    return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mode':'0o600','uid':st.st_uid}
st = p.lstat()
assert not p.is_symlink() and p.resolve().parent == o and st.st_uid == os.getuid() and stat.S_IMODE(st.st_mode) == 0o700
cmd = [s['python'],'-E','-S',str(Path(s['source'])/'skills/commit/scripts/staged-commit.py'),'check']
with (p/'original.out').open('xb') as out, (p/'original.err').open('xb') as err:
    child = subprocess.Popen(cmd,cwd=o/'repo',stdout=out,stderr=err,start_new_session=True)
    rc = child.wait()
try: os.killpg(child.pid,0)
except ProcessLookupError: pass
else: raise AssertionError('owned check group remains; do not cleanup')
with (o/'cli.jsonl').open('a') as f: f.write(json.dumps({'command':cmd,'exit':rc,'pid':child.pid,'waited':True,'groupGone':True})+'\n')
assert rc == 0
obj = json.loads((p/'original.out').read_bytes())
assert isinstance(obj,dict) and 'error' not in obj and isinstance(obj.get('snapshot'),dict)
x = obj['snapshot']
assert x['repository'] == str(o/'repo') and x['gitDir'] == str(o/'repo/.git')
assert x['head'] == s['head'] and x['tree'] == s['tree'] and x['diffSha256'] == s['diffSha256']
assert x['branch'] == x['plannedBranch'] == 'main' and x['refs'] == {'refs/heads/main':s['head']}
assert isinstance(x['indexSha256'],str) and len(x['indexSha256']) == 64
assert obj['gitleaks'] in ('passed','unavailable') and (p/'original.err').read_bytes() == b''
(o/'original.json').write_text(json.dumps({'exit':rc,'completeParse':True,'object':True,'shapeAndExpectedValues':True,
    'gitleaks':obj['gitleaks'],'stdout':meta(p/'original.out'),'stderr':meta(p/'original.err')}))
sys.stdout.buffer.write(b'[]\n')
PY
"$PYTHON" -E -S - <<'PY'
import json, os, shlex, subprocess
from pathlib import Path
os.umask(0o077)
o, source = (Path(os.environ[k]).resolve() for k in ('OWNED','SOURCE'))
s = json.loads((o/'setup.json').read_text())
env = json.loads((o/'env.json').read_text())
# Reused read-only snapshot material, run in separate processes before and after Codemode.
snapshot = '''import hashlib,json,os,subprocess
from pathlib import Path
o=Path(os.environ['TMPDIR']).parent
s=json.loads((o/'setup.json').read_text())
def g(*a): return subprocess.check_output([s['git'],'-C',str(o/'repo'),*a])
print(json.dumps({'head':g('rev-parse','HEAD').decode().strip(),'symbolicHead':g('symbolic-ref','HEAD').decode().strip(),
 'refs':g('for-each-ref','--format=%(refname) %(objectname) %(symref)').decode(),
 'indexSha256':hashlib.sha256((o/'repo/.git/index').read_bytes()).hexdigest(),
 'entriesSha256':hashlib.sha256(g('ls-files','--stage','-z')).hexdigest()}))'''
(o/'snapshot.py').write_text(snapshot)
before = subprocess.check_output([s['python'],'-E','-S',str(o/'snapshot.py')],env=env)
(o/'before.json').write_bytes(before)
code = '''import hashlib,json,os,stat,subprocess
from pathlib import Path
os.umask(0o077)
o=Path(os.environ['TMPDIR']).parent
s=json.loads((o/'setup.json').read_text())
p=o/'private'
with (p/'corrupted.out').open('xb') as out,(p/'adapter.err').open('xb') as err:
 r=subprocess.run([s['python'],'-E','-S',str(o/'adapter.py')],cwd=o/'repo',stdout=out,stderr=err)
assert r.returncode == 0, 'adapter failed; stop'
raw=(p/'corrupted.out').read_bytes()
value=json.loads(raw)  # Full parse, not a prefix or truncated tool output.
assert raw == b'[]\\n' and (p/'adapter.err').read_bytes() == b''
files={}
for name in ('original.out','original.err','corrupted.out','adapter.err'):
 f=p/name; st=f.lstat(); b=f.read_bytes()
 assert not f.is_symlink() and f.resolve().parent==p and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o600
 files[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'mode':'0o600','uid':st.st_uid}
result={'cliExit':r.returncode,'completeParse':True,'response':value,'files':files}
(o/'corrupted.json').write_text(json.dumps(result))
print(json.dumps({'cliExit':r.returncode,'completeParse':True,'response':value}))'''
def shell(code): return 'umask 077\n'+shlex.quote(s['python'])+" -E -S - <<'LIMITED_RESPONSE'\n"+code+'\nLIMITED_RESPONSE'
check_command = shell(code)
(o/'check-command.txt').write_text(check_command)
# This real mutation is reachable ONLY after exit/complete parse/object/required-shape validation.
commit_code = '''import json,os,subprocess
from pathlib import Path
os.umask(0o077)
o=Path(os.environ['TMPDIR']).parent
s=json.loads((o/'setup.json').read_text())
cmd=[s['python'],'-E','-S',str(Path(s['source'])/'skills/commit/scripts/staged-commit.py'),'commit']
with (o/'cli.jsonl').open('a') as f: f.write(json.dumps({'command':cmd,'started':True})+'\\n')
raise SystemExit(subprocess.run(cmd,cwd=o/'repo',input=json.dumps({'check':json.loads((o/'private/corrupted.out').read_bytes()),'message':'docs: local guide\\n'}).encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode)'''
js = 'const object = v => v !== null && typeof v === "object" && !Array.isArray(v);\n'
js += 'if (object([]) || object(null) || !object({})) throw new Error("object self-check failed");\n'
js += 'text({stage:"commit-check-response",state:"start"});\n'
js += 'const r = await tools.bash('+json.dumps({'command':check_command})+');\n'
js += 'if (r.truncated || r.exit_code !== 0) throw new Error("capture failed; stop without retry");\n'
js += 'const a = JSON.parse(r.output); if (!object(a) || a.cliExit !== 0 || a.completeParse !== true) throw new Error("invalid capture summary");\n'
js += 'const c=a.response; if (!object(c)) { text({stage:"commit-check-response",state:"stopped",reason:"non-object JSON",cliExit:a.cliExit,completeParse:true,downstreamMutationCalls:0}); return; }\n'
js += 'if ("error" in c || !object(c.snapshot) || !object(c.snapshot.refs) || c.snapshot.head !== '+json.dumps(s['head'])+' || c.snapshot.tree !== '+json.dumps(s['tree'])+' || c.snapshot.branch !== "main" || c.snapshot.plannedBranch !== "main" || !["passed","unavailable"].includes(c.gitleaks)) throw new Error("invalid check shape/expected values");\n'
js += 'const commit = await tools.bash('+json.dumps({'command':shell(commit_code)})+'); throw new Error("unexpected downstream mutation reached");'
(o/'codemode.js').write_text(js)
request = ('verify-project invalid-JSON LIMITED calling example, NOT product Skill/fullpipeline/normal approval. '
 'Read supplied verification Skill/relevant public references before Codemode as needed. Do not invoke commit Skill. '
 'Execute exactly the following JavaScript with ONE builtin codemode call, no timeout option. '
 'Do not read private JSON or adapter output through tools, do not change commands, add mutations, retry, rollback, refresh preparation or fallback. '
 'Report only expected stop or failure, never stage success on exit0 alone.\n'+js)
(o/'request.txt').write_text(request)
# Seal the known fixture inventory before Pi; unexpected paths later stop cleanup.
(o/'inventory.json').write_text(json.dumps([str(p.relative_to(o)) for p in o.rglob('*')]))
cmd = [env['VERIFY_NODE'],str(source/'.pi/skills/verify-project/scripts/commit-rpc.ts'),str(o/'repo'),
       str(source/'.pi/skills/verify-project/SKILL.md'),str(o/'rpc'),'--legacy-codemode','--request',request]
r = subprocess.run(cmd,env=env)
(o/'command-exit.json').write_text(json.dumps({'command':['commit-rpc.ts','--legacy-codemode','--request','<fixed limited example>'],'exit':r.returncode}))
print('RPC helper exit:',r.returncode,'(not alone acceptance)')
PY
```

## 独立照合・証拠保存・cleanup（失敗runも保持）

`original.json`と`corrupted.json`を別証拠にする。実check成功だけ/adapter exit0だけを保証としない。次のブロックはread-only観測と所有物cleanupのみで、製品段階は再実行しない。未知file/所有者/symlink/group残存は削除せず停止しRootへ報告する。通常auth lockは存在確認のみで不明lockを消さない。全参照はcleanup後にreadする。

```bash
umask 077
"$PYTHON" -E -S - <<'PY'
import hashlib, json, os, shlex, shutil, stat, subprocess
from pathlib import Path
os.umask(0o077)
o, evidence, source = (Path(os.environ[k]).resolve() for k in ('OWNED','EVIDENCE','SOURCE'))
env = json.loads((o/'env.json').read_text())
s = json.loads((o/'setup.json').read_text())
after = subprocess.check_output([s['python'],'-E','-S',str(o/'snapshot.py')],env=env)
(o/'after.json').write_bytes(after)
cleanup = json.loads((o/'rpc/cleanup.json').read_text())
cli = [json.loads(x) for x in (o/'cli.jsonl').read_text().splitlines()]
for group in [cleanup,*cli]:
    assert group['waited'] and group['groupGone']
    try: os.killpg(group['pid'],0)
    except ProcessLookupError: pass
    else: raise AssertionError('owned group remains; no cleanup')
records = [json.loads(x) for x in (o/'rpc/operations.jsonl').read_text().splitlines()]
starts = [r for r in records if r['type']=='tool_execution_start']
calls = [r for r in starts if r['toolName']=='codemode']
ends = [r for r in records if r['type']=='tool_execution_end']
git = [json.loads(x) for x in (o/'git.jsonl').read_text().splitlines()]
original = json.loads((o/'original.json').read_text())
corrupted = json.loads((o/'corrupted.json').read_text())
for name, expected in corrupted['files'].items():
    p=o/'private'/name; st=p.lstat(); raw=p.read_bytes()
    assert not p.is_symlink() and p.resolve().parent==o/'private' and st.st_uid==os.getuid()
    assert {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mode':oct(stat.S_IMODE(st.st_mode)),'uid':st.st_uid}==expected
assert original['stdout']==corrupted['files']['original.out'] and original['stderr']==corrupted['files']['original.err']
# Persist only metadata/code, bounded RPC summaries and public Git argv, never raw check/env/auth.
for name in ('setup.json','adapter.py','snapshot.py','codemode.js','request.txt','before.json','after.json',
             'original.json','corrupted.json','cli.jsonl','git.jsonl','command-exit.json','check-command.txt'):
    shutil.copyfile(o/name,evidence/name)
for name in ('operations.jsonl','cleanup.json'): shutil.copyfile(o/'rpc'/name,evidence/('rpc-'+name))
expected_stop = any(r.get('toolName')=='codemode' and 'non-object JSON' in json.dumps(r.get('result')) for r in ends)
passed = (len(calls)==1 and len(cli)==1 and cli[0]['command'][-1]=='check' and cli[0]['exit']==0
    and json.loads((o/'before.json').read_text())==json.loads(after)
    and original['shapeAndExpectedValues'] and corrupted['cliExit']==0 and corrupted['completeParse'] and corrupted['response']==[]
    and not any(set(a)&{'commit','switch','checkout','push','fetch','reset','update-ref','branch'} for a in git)
    and not any(r.get('isError') for r in ends) and cleanup['processExit']==0
    and json.loads((o/'command-exit.json').read_text())['exit']==0 and expected_stop)
# Inspect operations: one unchanged codemode JS; nested bash exactly the capture, no other execution.
assert len(calls)==1 and calls[0]['args']['code'].removesuffix('\n')==(o/'codemode.js').read_text().removesuffix('\n')
bash=[r for r in starts if r['toolName']=='bash']
assert len(bash)==1 and bash[0]['args']=={'command':(o/'check-command.txt').read_text()}
assert all(r.get('stopReason') not in ('error','aborted') for r in records if r['type']=='assistant')
for r in starts:
    if r['toolName']=='read':
        assert Path(r['args']['path']).resolve().is_relative_to(source/'.pi/skills/verify-project')
        assert r['receivedMonotonic']<calls[0]['receivedMonotonic']
    else: assert r['toolName'] in ('bash','codemode')
locks = {n:(Path(env['PI_CODING_AGENT_DIR'])/n).exists() for n in ('auth.json.lock','settings.json.lock')}
allowed = set(json.loads((o/'inventory.json').read_text())) | {'inventory.json','rpc','rpc/operations.jsonl','rpc/cleanup.json',
    'private/original.out','private/original.err','private/corrupted.out','private/adapter.err','cli.jsonl','git.jsonl',
    'original.json','corrupted.json','command-exit.json','after.json'}
files, dirs = [], []
for p in o.rglob('*'):
    st=p.lstat()
    assert str(p.relative_to(o)) in allowed and not p.is_symlink() and st.st_uid==os.getuid(), 'unknown path/ownership; stop'
    if p.is_dir(): dirs.append(p)
    else: files.append((p,st.st_dev,st.st_ino,hashlib.sha256(p.read_bytes()).hexdigest()))
for p,dev,ino,digest in files:
    st=p.lstat()
    assert not p.is_symlink() and st.st_uid==os.getuid() and (st.st_dev,st.st_ino)==(dev,ino) and hashlib.sha256(p.read_bytes()).hexdigest()==digest
    p.unlink()
for p in sorted(dirs,key=lambda p:len(p.parts),reverse=True): p.rmdir()
o.rmdir()
result={'status':'passed' if passed else 'failed','ownedRemoved':not o.exists(),'ownedGroupsWaitedGone':True,
        'normalAuthLocksPresentNotDeleted':locks,'expectedStop':expected_stop,'codemodeCalls':len(calls),
        'publicCheckCalls':len(cli),'commitPushCreateCalls':0 if len(cli)==1 else 'inspect',
        'gitBeforeAfterEqual':json.loads((evidence/'before.json').read_text())==json.loads(after),
        'limits':'Nonobject representative only; not full Skill/approval, missing-object schemas, partial success, interruption, performance or real GitHub.'}
(evidence/'result.json').write_text(json.dumps(result,indent=2)+'\n')
names=sorted(p.name for p in evidence.iterdir() if p.is_file())
ref=os.path.relpath(source/'.pi/skills/verify-project/references/invalid-json.md',evidence)
(evidence/'README.md').write_text('# Invalid JSON limited Codemode example\n\nStatus: '+result['status']+
    '. Real check exit0/object/shape success and adapter exit0/nonobject corruption are distinct evidence.\n\n'+
    'Expected: stop at response object validation; subsequent mutation0; refs/HEAD/index unchanged.\n\n'+
    'Fresh Root reproduction: common isolation setup, then the three blocks in [procedure]('+ref+').\n\n'+
    '\n'.join('- ['+n+']('+n+')' for n in names)+'\n')
for name in [*names,'README.md']: assert (evidence/name).read_bytes()
assert (evidence/ref).resolve().read_text()
print(evidence,json.dumps(result))
assert passed, 'failed run preserved; no retry/fallback'
PY
```

cleanup前にRPCのCodemode引数が`codemode.js`と一致（末尾LF一個のみ許容）、nested bashがそのcapture一件だけ、CLI logが実check一件、stage成功表示なし/非object停止を**実read**する。観測だけで足りなければ合格にせず不足を記録する。元応答はprivate完全bytes/digest照合後に削除しmetadataのみ残す。Rootのfresh再現・正式checks/pack・独立review/CodeReview・最終採否は別担当。本例で別caseを開始しない。
