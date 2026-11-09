# 実commit成功後の全体中断（限定Codemode例）

[集約手順](execution-batching.md)の中断一件だけ。full Skill・通常承認・性能・任意中断でのfinally/報告/cleanup必達を実証しない。実check/push prepare/PR prepareの完全JSONを保持し、実Codemodeで公開commitを一回成功させる。次の公開PR verifyのread-only `gh api user`境界で停止し、観測者が成功commitと境界到達を照合してから**公開RPC abort**を一回送る。任意時刻timeoutからcommit後中断を推測しない。製品の各外部60秒timeoutは変えず、それより前に明示中断する。後続mutation・再試行・rollback・準備更新・fallbackは禁止。

## fresh前提

repository rootで[Skillの隔離setup](../SKILL.md#隔離環境の準備)と[集約手順のfresh setupブロック](execution-batching.md#前提fresh-setup)を順に実行する（後者の`SELECTED_SOURCE=$SOURCE`、baseline archiveや性能runは不要）。導入済みPiの `docs/{rpc.md,rpc-commands.md,json.md,codemode.md,cli.md,message-types.md}` を接続前に全文読む。既存`.venv`/RemoteTools/実Git/local bareを使い、installやfixture内部handler・guard差替えをしない。専用HOME/PATH/TMPDIR/config、架空identity、normal Pi authのみ、ambient Extensions/MCP/context無効、明示builtinCodemode、macOS sandboxを維持する。auth独自read/copy/log・共有設定変更・実repo/実GitHub mutationは禁止。

以下はBash、全write umask077。`SOURCE OWNED PYTHON GIT VERIFY_PI VERIFY_SANDBOX`をexportする。run名を再使用しない。helperは接続・入力・観測のみでGit/branch判断/code生成を持たない。`--abort-file`はevidenceと同じowned親0700内の非symlink/所有uid/regular0600・内容`abort\n`だけを受け付け、一回sendする。`--timeout`は付けない。helperの非0は中断観測であってcommit失敗ではない。

## 公開準備・境界adapter・固定呼出し例

```bash
umask 077
export SOURCE OWNED PYTHON GIT VERIFY_PI VERIFY_SANDBOX
export EVIDENCE="$SOURCE/docs/verification/36/worker-interruption-$(date -u +%Y%m%dT%H%M%SZ)-$$"
"$SOURCE/.venv/bin/python" -B - <<'PY'
import hashlib, json, os, shlex, stat, subprocess, time
from pathlib import Path
os.umask(0o077)
o, source, evidence = (Path(os.environ[k]).resolve() for k in ('OWNED','SOURCE','EVIDENCE'))
evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
env=json.loads((o/'env.json').read_text())
s=json.loads((o/'setup.json').read_text())
s['owned']=str(o)
(o/'private').mkdir(mode=0o700)
# Source probe creates an absent unique path, never opens existing source/settings.
probe=source/('.interruption-denied-'+o.name)
assert not probe.exists()
cmd=[s['python'],'-E','-S','-c','import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("probe")']
a=subprocess.run(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*cmd,str(o/'write-probe')],env=env,capture_output=True)
b=subprocess.run(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*cmd,str(probe)],env=env,capture_output=True)
assert a.returncode==0 and b.returncode!=0 and not probe.exists()
(evidence/'sandbox.json').write_text(json.dumps({'ownedWriteExit':a.returncode,'sourceCreateExit':b.returncode,'sourceAbsent':True,'sharedConfigWriteDeniedByProfile':True}))
def g(*args): return subprocess.check_output([s['git'],'-C',str(o/'repo'),*args],env=env)
g('add','--','pending.txt')
s['tree']=g('write-tree').decode().strip()
(o/'setup.json').write_text(json.dumps(s))
# CLI stdout stays private and complete; never put JSON/raw stderr in tool evidence.
cli=[]
for label,script,args,request in [
 ('check','staged-commit.py',['check','--branch','planned'],None),
 ('push-preparation','guarded-push.py',['prepare','--remote','origin','--set-upstream'],{'commitCheck':None}),
 ('pr-preparation','github-pr.py',['prepare','--remote','origin','--repo','owner/repo'],{'commitCheck':None,'pushPreparation':None})]:
 if request is not None:
  request['commitCheck']=json.loads((o/'private/check.out').read_bytes())
  if 'pushPreparation' in request: request['pushPreparation']=json.loads((o/'private/push-preparation.out').read_bytes())
 command=[s['python'],'-E','-S',str(source/'skills/commit/scripts'/script),*args]
 with (o/'private'/f'{label}.out').open('xb') as out,(o/'private'/f'{label}.err').open('xb') as err:
  child=subprocess.Popen(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*command],cwd=o/'repo',env=env,stdin=subprocess.PIPE,stdout=out,stderr=err,start_new_session=True)
  child.communicate(json.dumps(request).encode() if request else None)
 try: os.killpg(child.pid,0)
 except ProcessLookupError: pass
 else: raise AssertionError('preparation group remains')
 cli.append({'stage':label,'command':command,'exit':child.returncode,'pid':child.pid,'waited':True,'groupGone':True})
 (o/'preparation-cli.json').write_text(json.dumps(cli))
 assert child.returncode==0 and (o/'private'/f'{label}.err').read_bytes()==b''
 value=json.loads((o/'private'/f'{label}.out').read_bytes())
 assert isinstance(value,dict) and 'error' not in value
 if label=='check':
  assert value['snapshot']['head']==s['first'] and value['snapshot']['tree']==s['tree'] and value['snapshot']['plannedBranch']=='planned'
 else:
  assert value['kind']==('push-preparation' if label=='push-preparation' else 'pr-preparation')
  assert isinstance(value.get('destination'),dict) and value['commitCheck']==json.loads((o/'private/check.out').read_bytes())
assert not (o/'push.log').exists() and json.loads((o/'gh.json').read_text())['prs']==[]
# Public gh boundary adapter; no mutation or replacement of product/fixture handlers.
(o/'fixture').mkdir()
(o/'bin/gh').rename(o/'fixture/gh')
(o/'bin/gh').write_text(f'#!{s["python"]}\n'+'''import json,os,signal,subprocess,sys,time
from pathlib import Path
os.umask(0o077)
o=Path(os.environ['TMPDIR']).parent
s=json.loads((o/'setup.json').read_text())
if sys.argv[1:]==['api','--hostname','github.com','user']:
 head=subprocess.check_output([s['git'],'-C',str(o/'repo'),'rev-parse','HEAD']).decode().strip()
 if head!=s['first']:
  (o/'barrier.json').write_text(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'head':head,'boundary':'gh api user','monotonic':time.monotonic()}))
  while True: signal.pause()
os.execv(str(o/'fixture/gh'),['gh',*sys.argv[1:]])
''')
(o/'bin/gh').chmod(0o700)
# Input integrity metadata is sealed before Pi and checked before each use.
inputs={}
for name in ('check.out','push-preparation.out','pr-preparation.out'):
 raw=(o/'private'/name).read_bytes()
 assert len(raw)<=2*1024*1024
 inputs[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
(o/'inputs.json').write_text(json.dumps(inputs))
common='''import hashlib,json,os,stat,subprocess,time
from pathlib import Path
os.umask(0o077)
o=Path(os.environ['TMPDIR']).parent
s=json.loads((o/'setup.json').read_text())
p=o/'private'
st=p.lstat()
assert not p.is_symlink() and p.resolve().parent==o and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700
def load(name):
 f=p/name; st=f.lstat(); raw=f.read_bytes()
 assert not f.is_symlink() and f.resolve().parent==p and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o600
 assert len(raw)<=2*1024*1024
 expected=json.loads((o/'inputs.json').read_text())[name]
 assert expected=={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
 value=json.loads(raw)
 assert isinstance(value,dict) and 'error' not in value
 return value
'''
commit=common+'''check=load('check.out')
command=[s['python'],'-E','-S',str(Path(s['source'])/'skills/commit/scripts/staged-commit.py'),'commit']
with (p/'commit.out').open('xb') as out,(p/'commit.err').open('xb') as err:
 child=subprocess.Popen(command,cwd=o/'repo',stdin=subprocess.PIPE,stdout=out,stderr=err,start_new_session=True)
 (o/'commit-handle.json').write_text(json.dumps({'pid':child.pid,'pgid':child.pid,'command':command,'startedMonotonic':time.monotonic()}))
 child.communicate(json.dumps({'check':check,'message':'feat: pending\\n'}).encode())
try: os.killpg(child.pid,0)
except ProcessLookupError: pass
else: raise AssertionError('commit group remains')
assert child.returncode==0 and (p/'commit.err').read_bytes()==b''
c=json.loads((p/'commit.out').read_bytes())
assert isinstance(c,dict) and 'error' not in c
assert isinstance(c['commit'],str) and len(c['commit'])==40 and all(x in '0123456789abcdef' for x in c['commit'])
assert c['branch']=='planned' and c['parents']==[s['first']] and c['tree']==s['tree']
assert c['messageSha256']==hashlib.sha256(b'feat: pending\\n').hexdigest() and c['gitleaks']==check['gitleaks'] and c['gitleaks'] in ('passed','unavailable')
raw=(p/'commit.out').read_bytes()
inputs=json.loads((o/'inputs.json').read_text())
inputs['commit.out']={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
(o/'inputs.json').write_text(json.dumps(inputs))
summary={'stage':'commit','state':'success','commit':c['commit'],'branch':c['branch'],'parents':c['parents'],'tree':c['tree'],'exit':child.returncode,'waited':True,'groupGone':True,'monotonic':time.monotonic()}
(o/'commit-summary.json').write_text(json.dumps(summary))
print(json.dumps(summary))
'''
verify=common+'''preparation=load('pr-preparation.out')
c=load('commit.out')
command=[s['python'],'-E','-S',str(Path(s['source'])/'skills/commit/scripts/github-pr.py'),'verify']
with (p/'verify.out').open('xb') as out,(p/'verify.err').open('xb') as err:
 child=subprocess.Popen(command,cwd=o/'repo',stdin=subprocess.PIPE,stdout=out,stderr=err,start_new_session=True)
 (o/'verify-handle.json').write_text(json.dumps({'pid':child.pid,'pgid':child.pid,'command':command,'startedMonotonic':time.monotonic()}))
 child.communicate(json.dumps({'preparation':preparation,'commit':c}).encode())
# Reaching here is not the expected interruption; never continue to mutation.
raise AssertionError('verify returned before observer interruption; no retry/fallback')
'''
def shell(code): return 'umask 077\n'+shlex.quote(s['python'])+" -E -S - <<'LIMITED_INTERRUPT'\n"+code+'\nLIMITED_INTERRUPT'
commands=[shell(commit),shell(verify)]
(o/'commands.json').write_text(json.dumps(commands))
js='text({stage:"commit",state:"start"});\n'
js+='const r=await tools.bash('+json.dumps({'command':commands[0]})+');\n'
js+='if(r.truncated || r.exit_code!==0) throw new Error("commit capture failed; stop");\n'
js+='const c=JSON.parse(r.output); if(c===null || typeof c!=="object" || Array.isArray(c) || c.stage!=="commit" || c.state!=="success" || c.branch!=="planned" || c.tree!=='+json.dumps(s['tree'])+' || JSON.stringify(c.parents)!==JSON.stringify(['+json.dumps(s['first'])+']) || !/^[0-9a-f]{40}$/.test(c.commit)) throw new Error("invalid commit summary");\n'
js+='text({stage:"commit",state:"success",commit:c.commit});\ntext({stage:"pr-verify",state:"start"});\n'
js+='await tools.bash('+json.dumps({'command':commands[1]})+');\nthrow new Error("unexpected verify return; stop");'
(o/'codemode.js').write_text(js)
request=('verify-project interruption LIMITED calling example, NOT product Skill/fullpipeline/normal approval. '
 'Read supplied verification Skill if needed; do not invoke commit Skill. Execute exactly the following JavaScript with ONE builtin codemode call, no timeout option. '
 'Do not read private JSON, change commands, add mutations, retry, rollback, refresh preparation or fallback. '
 'Observer will abort at a read-only public boundary after successful commit. Do not attempt recovery.\n'+js)
(o/'request.txt').write_text(request)
# Independent read-only Git snapshot: no write-tree or fixture mutations.
snapshot='''import hashlib,json,os,subprocess
from pathlib import Path
o=Path(os.environ['TMPDIR']).parent
s=json.loads((o/'setup.json').read_text())
def g(*a): return subprocess.check_output([s['git'],'-C',str(o/'repo'),*a])
raw=g('cat-file','commit','HEAD'); headers,message=raw.split(b'\\n\\n',1)
print(json.dumps({'head':g('rev-parse','HEAD').decode().strip(),'branch':g('symbolic-ref','HEAD').decode().strip(),
 'refs':g('for-each-ref','--format=%(refname) %(objectname) %(symref)').decode(),
 'indexSha256':hashlib.sha256((o/'repo/.git/index').read_bytes()).hexdigest(),
 'entriesSha256':hashlib.sha256(g('ls-files','--stage','-z')).hexdigest(),
 'commitTree':headers.splitlines()[0].decode(),'parents':[x.decode() for x in headers.splitlines() if x.startswith(b'parent ')],
 'messageSha256':hashlib.sha256(message).hexdigest(),
 'bareRefs':g('-C',str(o/'remote.git'),'for-each-ref','--format=%(refname) %(objectname)').decode(),
 'pushCalls':len((o/'push.log').read_text().splitlines()) if (o/'push.log').exists() else 0,
 'prs':json.loads((o/'gh.json').read_text())['prs']}))
'''
(o/'snapshot.py').write_text(snapshot)
(o/'before.json').write_bytes(subprocess.check_output([s['python'],'-E','-S',str(o/'snapshot.py')],env=env))
def sg(*a): return subprocess.check_output([s['git'],*a],cwd=source,env=env)
assets=['.pi/skills/verify-project/references/interruption.md','.pi/skills/verify-project/scripts/commit-rpc.py',
 '.pi/skills/verify-project/scripts/check-commit-rpc.py','skills/commit/tests/test_remote_scripts.py','skills/commit/tests/fixtures/remote_tools.py',
 'skills/commit/references/execution-batching.md',*['skills/commit/scripts/'+n for n in ('staged-commit.py','guarded-push.py','github-pr.py','git_guard.py')]]
(evidence/'source.json').write_text(json.dumps({'head':sg('rev-parse','HEAD').decode().strip(),'dirty':sg('status','--short').decode(),
 'diffSha256':hashlib.sha256(sg('diff','--binary','HEAD')).hexdigest(),'assetsSha256':{p:hashlib.sha256((source/p).read_bytes()).hexdigest() for p in assets},
 'python':subprocess.check_output([s['python'],'--version']).decode().strip(),'pi':subprocess.check_output([env['VERIFY_PI'],'--version']).decode().strip(),
 'git':sg('--version').decode().strip(),'platform':os.uname().sysname,'isolation':'dedicated HOME/PATH/TMPDIR/config; normal auth; builtin codemode only'},indent=2))
# Seal initial owned inventory, including the fixture's executable symlinks if any.
(o/'inventory.json').write_text(json.dumps([str(p.relative_to(o)) for p in o.rglob('*')]))
print('prepared',evidence)
PY
```

## 接続・成功確認後の明示中断

次の観測コードはbranch判断・製品操作を代行せず、成功/境界を照合して入力markerを置く。待機上限は**観測失敗の安全停止**で、timeoutを中断成功と扱わない。中断直前に全所有系統のPID/PPID/PGIDを記録する。builtin bashはPiとは別groupになり、verify CLIも別groupになる。親Pi groupの終了だけをcleanup根拠にしない。

```bash
umask 077
"$PYTHON" -E -S - <<'PY'
import hashlib,json,os,signal,subprocess,time
from pathlib import Path
os.umask(0o077)
o,source,evidence=(Path(os.environ[k]).resolve() for k in ('OWNED','SOURCE','EVIDENCE'))
s=json.loads((o/'setup.json').read_text()); env=json.loads((o/'env.json').read_text())
command=[s['python'],str(source/'.pi/skills/verify-project/scripts/commit-rpc.py'),str(o/'repo'),
 str(source/'.pi/skills/verify-project/SKILL.md'),str(o/'rpc'),'--fixture-remote','--abort-file',str(o/'abort'),
 '--request',(o/'request.txt').read_text()]
def table():
 rows=subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,pgid=,uid=']).decode().splitlines()
 return {int(x[0]):dict(zip(('pid','ppid','pgid','uid'),map(int,x))) for row in rows if len(x:=row.split())==4}
def exists(pid):
 try: os.kill(pid,0); return True
 except ProcessLookupError: return False
with (o/'driver.out').open('xb') as out,(o/'driver.err').open('xb') as err:
 driver=subprocess.Popen(command,env=env,stdout=out,stderr=err,start_new_session=True)
 (o/'driver-handle.json').write_text(json.dumps({'pid':driver.pid,'pgid':driver.pid}))
 owned_pids={driver.pid}; observed={}; explicit=False; failure=None
 try:
  until=time.monotonic()+240
  while not (o/'barrier.json').exists():
   rows=table()
   # Track only descendants of the known helper while their ownership is observable.
   changed=True
   while changed:
    new={pid for pid,v in rows.items() if v['ppid'] in owned_pids and v['uid']==os.getuid()}
    changed=not new.issubset(owned_pids); owned_pids.update(new)
   observed.update({pid:rows[pid] for pid in owned_pids if pid in rows})
   if driver.poll() is not None: raise AssertionError('helper exited before boundary')
   if time.monotonic()>until: raise AssertionError('observer did not reach boundary; not a passing interruption')
   time.sleep(.05)
  barrier=json.loads((o/'barrier.json').read_text())
  commit=json.loads((o/'commit-summary.json').read_text())
  handle=json.loads((o/'verify-handle.json').read_text())
  raw=(o/'private/commit.out').read_bytes()
  c=json.loads(raw); assert c['commit']==commit['commit']==barrier['head']
  assert commit['state']=='success' and commit['exit']==0 and commit['waited'] and commit['groupGone']
  assert json.loads((o/'inputs.json').read_text())['commit.out']=={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
  before_abort=subprocess.check_output([s['python'],'-E','-S',str(o/'snapshot.py')],env=env)
  (o/'at-boundary.json').write_bytes(before_abort)
  state=json.loads(before_abort)
  assert state['head']==c['commit'] and state['parents']==['parent '+s['first']] and state['commitTree']=='tree '+s['tree']
  assert state['messageSha256']==hashlib.sha256(b'feat: pending\n').hexdigest()
  assert state['branch']=='refs/heads/planned' and state['pushCalls']==0 and state['prs']==[]
  rows=table()
  chain=[]; pid=barrier['pid']
  while pid!=driver.pid:
   assert pid in rows and rows[pid]['uid']==os.getuid()
   chain.append(rows[pid]); pid=rows[pid]['ppid']
  chain.append(rows[driver.pid]); observed.update({v['pid']:v for v in chain}); owned_pids.update(v['pid'] for v in chain)
  assert barrier['pgid']==handle['pgid'] and handle['pid'] in {v['pid'] for v in chain}
  assert any(v['pgid']!=rows[driver.pid]['pgid'] for v in chain)
  now=time.monotonic(); assert 0<=now-barrier['monotonic']<10 and now-handle['startedMonotonic']<45
  (o/'processes.json').write_text(json.dumps({'tracked':list(observed.values()),'boundaryChain':chain,'verifyHandle':handle,'barrier':barrier,
    'observedCommitSuccess':True,'explicitAbortMonotonic':now,'secondsSinceVerifyStart':now-handle['startedMonotonic']}))
  # Exactly one explicit public abort; no arbitrary-time deadline or external command timeout.
  (o/'abort').write_bytes(b'abort\n'); explicit=True
  driver.wait(timeout=30)
 except Exception as e:
  failure=type(e).__name__+': '+str(e)
 finally:
  # Save observations before owner cleanup, including processes left by product interruption.
  rows=table()
  for name in ('commit-handle.json','verify-handle.json','barrier.json'):
   if (o/name).exists():
    h=json.loads((o/name).read_text()); pid=h['pid']
    if pid in rows:
     assert rows[pid]['uid']==os.getuid() and rows[pid]['pgid']==h['pgid']
     owned_pids.add(pid); observed[pid]=rows[pid]
  remaining=[v for pid,v in rows.items() if pid in owned_pids]
  (o/'product-residual.json').write_text(json.dumps({'explicitAbort':explicit,'helperExitBeforeOwnerCleanup':driver.poll(),'processes':remaining,
    'privateResultsRemain':sorted(p.name for p in (o/'private').iterdir()),'failure':failure}))
  groups={v['pgid'] for v in observed.values()}
  # Every group must belong to this recorded lineage, not to the observer/other process.
  assert os.getpgrp() not in groups
  for sig in (signal.SIGTERM,signal.SIGKILL):
   rows=table()
   for pgid in groups:
    members=[v for v in rows.values() if v['pgid']==pgid]
    assert all(v['pid'] in owned_pids and v['uid']==os.getuid() for v in members), 'unknown group member; stop'
    if members:
     try: os.killpg(pgid,sig)
     except ProcessLookupError: pass
   if driver.poll() is None:
    try: driver.wait(timeout=5)
    except subprocess.TimeoutExpired: pass
   until=time.monotonic()+5
   while any(v['pgid'] in groups for v in table().values()) and time.monotonic()<until: time.sleep(.05)
  driver.wait(timeout=5)
  rows=table()
  assert not any(v['pgid'] in groups for v in rows.values()), 'owned group remains; no fixture deletion'
  assert not any(exists(pid) for pid in owned_pids), 'owned PID remains; no fixture deletion'
  (o/'owner-cleanup.json').write_text(json.dumps({'driverWaited':True,'driverExit':driver.returncode,'ownedPids':sorted(owned_pids),
    'ownedGroups':sorted(groups),'allAbsent':True,'failure':failure}))
  (o/'command-exit.json').write_text(json.dumps({'command':['commit-rpc.py','--fixture-remote','--abort-file','<owned marker>','--request','<fixed limited example>'],
    'exit':driver.returncode,'explicitAbort':explicit,'failure':failure}))
print('observer completed; inspect partial results, not helper exit alone')
PY
```

中断応答前の`agent_settled`とRPC abort responseの順は固定しない。helperはtoolのend/settledを残して非0で返すが、任意中断時の報告やfinallyを要件にしない。上のowner cleanupは**製品のcleanup成功ではない**。残存を保存し、自分が観測したCLI/adapter/bashのhandle/groupだけを終了してwait/不存在を確認する。これが成立しなければfixtureを消さずRootへ不足を報告する。

## 独立照合・証拠保存・所有物cleanup

```bash
umask 077
"$PYTHON" -E -S - <<'PY'
import hashlib,json,os,re,shutil,stat,subprocess
from pathlib import Path
os.umask(0o077)
o,source,evidence=(Path(os.environ[k]).resolve() for k in ('OWNED','SOURCE','EVIDENCE'))
s=json.loads((o/'setup.json').read_text()); env=json.loads((o/'env.json').read_text())
(o/'after.json').write_bytes(subprocess.check_output([s['python'],'-E','-S',str(o/'snapshot.py')],env=env))
records=[json.loads(x) for x in (o/'rpc/operations.jsonl').read_text().splitlines()]
starts=[r for r in records if r['type']=='tool_execution_start']; ends=[r for r in records if r['type']=='tool_execution_end']
calls=[r for r in starts if r['toolName']=='codemode']; bash=[r for r in starts if r['toolName']=='bash']
c=json.loads((o/'commit-summary.json').read_text()); before=json.loads((o/'before.json').read_text()); after=json.loads((o/'after.json').read_text())
owner=json.loads((o/'owner-cleanup.json').read_text()); residual=json.loads((o/'product-residual.json').read_text())
meta={}
for p in (o/'private').iterdir():
 st=p.lstat(); raw=p.read_bytes()
 assert not p.is_symlink() and p.resolve().parent==o/'private' and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o600
 meta[p.name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mode':'0o600','uid':st.st_uid}
for name,m in json.loads((o/'inputs.json').read_text()).items(): assert all(meta[name][k]==v for k,v in m.items())
(evidence/'private-metadata.json').write_text(json.dumps(meta,indent=2))
assert owner['allAbsent'] and owner['driverWaited']
for group in owner['ownedGroups']:
 try: os.killpg(group,0)
 except ProcessLookupError: pass
 else: raise AssertionError('owned group remains; no cleanup')
git=[json.loads(x) for x in (o/'git.log').read_text().splitlines()]
gh=[json.loads(x) for x in (o/'gh.log').read_text().splitlines()]
(evidence/'git.json').write_text(json.dumps(git)); (evidence/'gh.json').write_text(json.dumps(gh))
# Evidence is bounded summaries, known code and public argv only; not raw JSON/stdout/env/auth.
for name in ('setup.json','inputs.json','commands.json','codemode.js','request.txt','snapshot.py','before.json','at-boundary.json','after.json',
 'preparation-cli.json','commit-handle.json','verify-handle.json','commit-summary.json','barrier.json','processes.json','product-residual.json',
 'owner-cleanup.json','command-exit.json'):
 if (o/name).exists(): shutil.copyfile(o/name,evidence/name)
shutil.copyfile(o/'bin/gh',evidence/'boundary-adapter.py')
for name in ('operations.jsonl','cleanup.json'):
 if (o/'rpc'/name).exists(): shutil.copyfile(o/'rpc'/name,evidence/('rpc-'+name))
# A bounded Codemode result may survive; report its actual availability, not guaranteed delivery.
commit_output=any(r.get('toolName')=='codemode' and '"stage":"commit","state":"success"' in json.dumps(r.get('result'),ensure_ascii=False).replace('\\"','"').replace(' ','') for r in ends)
passed=(len(calls)==1 and calls[0]['args']['code'].removesuffix('\n')==(o/'codemode.js').read_text().removesuffix('\n')
 and [r['args'] for r in bash]==[{'command':x} for x in json.loads((o/'commands.json').read_text())]
 and len([r for r in records if r['type']=='abort_sent'])==1
 and any(r['type']=='agent_settled' and r.get('aborted') for r in records)
 and residual['explicitAbort'] and owner['failure'] is None and owner['driverExit']!=0
 and after==json.loads((o/'at-boundary.json').read_text()) and after['head']==c['commit']
 and after['bareRefs']==before['bareRefs'] and after['pushCalls']==0 and after['prs']==[]
 and after['entriesSha256']==before['entriesSha256'] and commit_output
 and len([a for a in git if a[:1]==['commit']])==1
 and not any(set(a)&{'push','fetch','reset','--amend','--force','rebase','merge'} for a in git)
 and not any(a[:2]==['pr','create'] for a in gh))
# Inspect available output and metadata independently; do not assume verify succeeded or cleanup ran.
locks={n:(Path(env['PI_CODING_AGENT_DIR'])/n).exists() for n in ('auth.json.lock','settings.json.lock')}
known=set(json.loads((o/'inventory.json').read_text()))|{'inventory.json','driver.out','driver.err','driver-handle.json','rpc','rpc/operations.jsonl','rpc/cleanup.json',
 'commit-handle.json','verify-handle.json','commit-summary.json','private/commit.out','private/commit.err','private/verify.out','private/verify.err',
 'barrier.json','processes.json','at-boundary.json','abort','product-residual.json','owner-cleanup.json','command-exit.json','after.json',
 'repo/.git/COMMIT_EDITMSG','repo/.git/refs/heads/planned','repo/.git/logs/refs/heads/planned',
 'repo/.git/objects/'+c['commit'][:2],'repo/.git/objects/'+c['commit'][:2]+'/'+c['commit'][2:]}
files=[]; dirs=[]
for p in o.rglob('*'):
 st=p.lstat()
 assert str(p.relative_to(o)) in known and not p.is_symlink() and st.st_uid==os.getuid(), 'unknown path/owner; no deletion'
 if p.is_dir(): dirs.append(p)
 else: files.append((p,st.st_dev,st.st_ino,hashlib.sha256(p.read_bytes()).hexdigest()))
for p,dev,ino,digest in files:
 st=p.lstat(); assert not p.is_symlink() and st.st_uid==os.getuid() and (st.st_dev,st.st_ino)==(dev,ino) and hashlib.sha256(p.read_bytes()).hexdigest()==digest
 p.unlink()
for p in sorted(dirs,key=lambda p:len(p.parts),reverse=True): p.rmdir()
o.rmdir()
result={'status':'passed' if passed else 'failed','partialSuccess':'commit verified and retained; PR verify began and was interrupted; no push/create',
 'verifyOutcome':'not successful; output/real state inspected, never retried','boundedCommitOutputRetained':commit_output,
 'productCleanup':'not guaranteed; private files/process residuals recorded before owner cleanup','ownerCleanup':'all recorded groups/PIDs absent, driver waited; owned files removed',
 'ownedRemoved':not o.exists(),'normalAuthLocksPresentNotDeleted':locks,
 'limits':'limited calling example only; no full Skill/normal approval/performance, real GitHub, arbitrary interrupt atomicity/finally/report guarantee'}
(evidence/'result.json').write_text(json.dumps(result,indent=2))
names=sorted(p.name for p in evidence.iterdir() if p.is_file())
ref=os.path.relpath(source/'.pi/skills/verify-project/references/interruption.md',evidence)
(evidence/'README.md').write_text('# Commit-success then explicit whole-Codemode abort\n\nStatus: '+result['status']+
 '. Actual commit, bounded output and next read-only boundary were observed before explicit public RPC abort.\n\n'+
 'Fresh reproduction: common isolation/fresh fixture setup, then all three blocks in [procedure]('+ref+').\n\n'+
 '\n'.join('- ['+n+']('+n+')' for n in names)+'\n')
for name in [*names,'README.md']: assert (evidence/name).read_bytes()
assert (evidence/ref).resolve().read_text()
print(evidence,json.dumps(result))
assert passed, 'failed run preserved; no retry/fallback'
PY
```

cleanup前にCodemode引数/内側bash二件、commit結果のbounded出力、abort/settled metadata、Git/gh操作、実refs/親/tree/本文digest/index/bare、別groupの残存とowner終了を実readする。verifyの空出力を未実行/成功とはしない。判定やcleanupが成立しなければ失敗/未確認を保存して停止し、期待値を緩めない。cleanup後READMEと全参照を実readし、Mapにrun結果を書かない。Rootのfresh再確認・正式checks/pack・独立Review/CodeReview・最終採否は別担当。本例で他caseを再実行しない。
