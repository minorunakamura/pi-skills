# 無秘密大容量JSONの完全受渡し/private保持（限定Codemode例）

[集約手順](execution-batching.md)の大容量一件だけ。fresh Skill全文・通常承認・Agent判断を検証しない。既存RPC helperの任意`--request`接続を使い、下の固定例を**実Codemode一回**で実行する。helperへGit代行・branch判断・code生成を追加しない。実Git/local bare/既存RemoteToolsの公開gh/ssh fixtureと製品公開CLIを使い、guard/checkを改変しない。PR createは不要なので呼ばない。

## 前提と実行

repository rootから[Skillの隔離環境](../SKILL.md#隔離環境の準備)を実行し、`SOURCE`/`OWNED`/`PYTHON`/`GIT`/`VERIFY_PI`/`VERIFY_SANDBOX`を確定する。Pi 1.4.0、macOS sandbox、専用HOME/PATH/TMPDIR/config・架空identity、normal Pi authのみ、ambient Extensions/MCP/context無効を維持する。auth独自read/copy/record・install・共有設定変更・実GitHub mutationは禁止。公開Pi接続の変更/利用前には導入版の`docs/{rpc.md,rpc-commands.md,json.md,codemode.md,cli.md}`と関連message-typesを全文読む。

以下はBash。全writeはumask077。runは既存ignore対象の一意名とし、過去runを上書きしない。TDDは採用しない。fixture前提→公開seam→期待照合の順に実行し、失敗後retry/rollback/準備更新/fallbackしない。外部コマンドの製品既存60秒は不変、helper `--timeout`を使うなら別の観測者deadlineであり、任意中断のfinally必達を保証しない。

```bash
umask 077
export SOURCE OWNED PYTHON GIT VERIFY_PI VERIFY_SANDBOX VERIFY_NODE
RUN="worker-large-json-$(date -u +%Y%m%dT%H%M%SZ)-$$"
export EVIDENCE="$SOURCE/docs/verification/36/$RUN"
"$SOURCE/.venv/bin/python" -B - <<'PY'
import hashlib, importlib.util, json, os, subprocess
from pathlib import Path
source, owned, evidence = (Path(os.environ[k]).resolve() for k in ('SOURCE','OWNED','EVIDENCE'))
os.umask(0o077)
evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
clean = {'PATH':'/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM':'1', 'GIT_CONFIG_GLOBAL':'/dev/null'}
def git(*args):
    return subprocess.check_output([os.environ['GIT'], *args], cwd=source, env=clean)
assets = ['.pi/skills/verify-project/references/large-json.md',
          '.pi/skills/verify-project/scripts/commit-rpc.ts',
          'skills/commit/tests/test_remote_scripts.py', 'skills/commit/tests/fixtures/remote_tools.py',
          *['skills/commit/scripts/'+p for p in ('staged-commit.py','guarded-push.py','github-pr.py','git_guard.py')]]
(evidence/'source.json').write_text(json.dumps({
    'head':git('rev-parse','HEAD').decode().strip(), 'dirty':git('status','--short').decode(),
    'diffSha256':hashlib.sha256(git('diff','--binary','HEAD')).hexdigest(),
    'assetsSha256':{p:hashlib.sha256((source/p).read_bytes()).hexdigest() for p in assets},
    'python':os.environ['PYTHON'], 'git':git('--version').decode().strip(),
    'pi':subprocess.check_output([os.environ['VERIFY_PI'],'--version']).decode().strip(),
    'platform':os.uname().sysname}, indent=2)+'\n')
(owned/'repo').mkdir()
spec = importlib.util.spec_from_file_location('remote_tests',source/'skills/commit/tests/test_remote_scripts.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
keys = ('PATH','HOME','TMPDIR','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL',
        'PI_CODING_AGENT_DIR','PI_OFFLINE','PI_SKIP_VERSION_CHECK','PI_TELEMETRY','VERIFY_PI','VERIFY_SANDBOX','VERIFY_NODE')
env = {k:os.environ[k] for k in keys}
env.update(LC_ALL='C', PYTHONDONTWRITEBYTECODE='1')
tools = m.RemoteTools()
tools.setup_tools(owned, os.environ['GIT'], env)
env['PATH'] = os.pathsep.join((str(owned/'bin'), str(Path(os.environ['PYTHON']).parent), '/usr/bin','/bin'))
g = tools.git
for a in [('init','-b','main'),('config','user.name','Test User'),
          ('config','user.email','test@example.invalid'),('config','commit.gpgsign','false')]: g(*a)
tools.add_commit('base.txt','base')
base = g('rev-parse','HEAD').decode().strip()
g('init','--bare','-b','main',str(tools.remote))
g('remote','add','origin',str(tools.remote))
g('push','origin','main')  # setup, not a product push
assert not (owned/'push.log').exists()
g('switch','-c','feature')
g('remote','set-url','origin','git@github-work:owner/repo.git')
# ASCII has no JSON unicode expansion; only LF gains one escape byte per line.
payload = ''.join(f'public-fixture-{i:05d} '+ 'x'*76+'\n' for i in range(11200))
(owned/'repo/pending.txt').write_text(payload)
g('add','--','pending.txt')
tree = g('write-tree').decode().strip()
raw = g('--no-pager','diff','--cached','--no-ext-diff','--no-textconv','--binary','--no-color','--ignore-submodules=none')
assert 1048576 < len(raw) < 2097152
# Log only public Git argv, without altering the existing fixture or guard.
wrapper = owned/'bin/git'
wrapper.rename(owned/'bin/fixture-git')
wrapper.write_text(f'#!{os.environ["PYTHON"]}\nimport json, os, sys\nos.umask(0o077)\n'+
    f'with open({str(owned/"git.log")!r},"a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n'+
    f'os.execv({str(owned/"bin/fixture-git")!r}, ["git",*sys.argv[1:]])\n')
wrapper.chmod(0o700)
private = owned/'private'
private.mkdir(mode=0o700)
# The example does NOT own this file; only the outer fixture owner does.
(private/'outside-sentinel').write_bytes(b'outside-example-ownership\n')
setup = {'base':base,'tree':tree,'refs':g('for-each-ref','--format=%(refname) %(objectname)').decode().splitlines(),
         'diffBytes':len(raw),'diffSha256':hashlib.sha256(raw).hexdigest(),
         'payloadBytes':len(payload.encode()),'source':str(source),'owned':str(owned),'python':os.environ['PYTHON'],
         'git':os.environ['GIT']}
(owned/'setup.json').write_text(json.dumps(setup))
(owned/'env.json').write_text(json.dumps(env))
(evidence/'setup.json').write_text(json.dumps(setup,indent=2)+'\n')
# Probe a NEW absent source name: never open an existing source/config for write.
probe = source/('.large-json-denied-'+owned.name)
assert not probe.exists()
command = [os.environ['PYTHON'],'-E','-S','-c',
           'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("probe")']
a = subprocess.run(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*command,str(owned/'write-probe')],
                   env=env,capture_output=True)
b = subprocess.run(['/usr/bin/sandbox-exec','-f',env['VERIFY_SANDBOX'],*command,str(probe)],
                   env=env,capture_output=True)
assert a.returncode == 0 and b.returncode != 0 and not probe.exists()
assert (owned/'write-probe').read_text() == 'probe'
(evidence/'sandbox.json').write_text(json.dumps({'ownedWriteExit':a.returncode,
    'sourceCreateExit':b.returncode,'sourceAbsent':not probe.exists(),
    'sharedConfigWriteDeniedByProfile':True})+'\n')
PY
```

次の2つは当該呼出しのinlineコード材料で、汎用runner/製品wrapperではない。最初のprocessはCLI stdout/必要stderrを直接private fileへ完全取得、file側でparseし必要形/期待値を検査する。後段stdinの生成前に元file bytes/digestを再照合し、objectをそのまま渡す。入力も2MiB未満をassertする。もう一つの**独立process**が残ったfileのmode/uid/bytes/digestを再取得し、実Git/bare/fixtureと完全照合する。全JSONをstore/read/text/tool stdoutへ出さない。

```bash
umask 077
cat > "$OWNED/pipeline.txt" <<'PY'
import hashlib, json, os, signal, stat, subprocess
from pathlib import Path
os.umask(0o077)
owned = Path(os.environ['TMPDIR']).parent
setup = json.loads((owned/'setup.json').read_text())
private = owned/'private'
records, operations, inputs, groups = {}, [], [], []
def digest(b): return hashlib.sha256(b).hexdigest()
def metadata(p):
    s = p.lstat()
    assert not p.is_symlink() and s.st_uid == os.getuid()
    assert stat.S_IMODE(s.st_mode) == (0o700 if p.is_dir() else 0o600)
    assert p.resolve().parent == (owned if p.is_dir() else private)
    b = b'' if p.is_dir() else p.read_bytes()
    return {'bytes':len(b),'sha256':digest(b),'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid}
metadata(private)
def load(name):
    p = private/name
    assert metadata(p) == records[name]
    obj = json.loads(p.read_bytes())
    assert isinstance(obj,dict) and 'error' not in obj
    return obj
def retained(name):
    obj = load(name)
    inputs.append({'file':name,**metadata(private/name)})
    return obj
def cli(label, script, args, request=None):
    for suffix in ('.out','.err','.in'):
        p = private/(label+suffix)
        assert not p.exists() and not p.is_symlink()
        with p.open('xb') as f:
            if suffix == '.in' and request is not None:
                raw = json.dumps(request,ensure_ascii=True).encode()
                assert len(raw) < 2097152
                f.write(raw)
        records[p.name] = metadata(p)
    command = [setup['python'],'-E','-S',str(Path(setup['source'])/'skills/commit/scripts'/script),*args]
    with (private/(label+'.in')).open('rb') as src, (private/(label+'.out')).open('wb') as out, (private/(label+'.err')).open('wb') as err:
        p = subprocess.Popen(command,cwd=owned/'repo',stdin=src,stdout=out,stderr=err,start_new_session=True)
        try:
            # No extra per-CLI deadline: product external commands retain their 60s timeout.
            exitcode = p.wait()
        finally:
            try: os.killpg(p.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            p.wait()
            try: os.killpg(p.pid,0)
            except ProcessLookupError: groups.append({'pid':p.pid,'waited':True,'groupGone':True})
            else: raise AssertionError('owned CLI group remains')
    records[label+'.out'] = metadata(private/(label+'.out'))
    records[label+'.err'] = metadata(private/(label+'.err'))
    operations.append({'stage':label,'command':command,'exit':exitcode})
    assert exitcode == 0, label+' CLI failed (raw output retained privately)'
    result = load(label+'.out')
    assert (private/(label+'.err')).stat().st_size == 0
    return result
try:
    check = cli('commit-check','staged-commit.py',['check','--branch','planned'])
    assert check['snapshot']['plannedBranch'] == 'planned'
    assert check['snapshot']['head'] == setup['base'] and check['snapshot']['tree'] == setup['tree']
    assert check['snapshot']['diffSha256'] == setup['diffSha256']
    assert check['gitleaks'] in ('passed','unavailable')
    pushed = cli('push-prepare','guarded-push.py',['prepare','--remote','origin','--set-upstream'],
        {'commitCheck':retained('commit-check.out')})
    assert pushed['kind'] == 'push-preparation' and pushed['commitCheck'] == check
    assert pushed['destination']['branch'] == pushed['destination']['target'] == 'planned'
    assert pushed['destination']['remote'] == 'origin'
    prepared = cli('pr-prepare','github-pr.py',['prepare','--remote','origin','--repo','owner/repo'],
        {'commitCheck':retained('commit-check.out'),'pushPreparation':retained('push-prepare.out')})
    assert prepared['kind'] == 'pr-preparation' and prepared['commitCheck'] == check
    assert prepared['pushPreparation'] == pushed and prepared['existingPullRequests'] == []
    assert prepared['diffSha256'] == setup['diffSha256'] and prepared['mergeBase'] == setup['base']
    assert digest(prepared['diff'].encode()) == setup['diffSha256']
    assert len((private/'pr-prepare.out').read_bytes()) > 1048576
    assert len(json.dumps(prepared,ensure_ascii=True)) > 262144
    commit = cli('commit','staged-commit.py',['commit'],
        {'check':retained('commit-check.out'),'message':'feat: large public fixture\n'})
    sha = commit['commit']
    assert len(sha) == 40 and all(c in '0123456789abcdef' for c in sha)
    assert commit['branch'] == 'planned' and commit['parents'] == [setup['base']]
    assert commit['tree'] == setup['tree'] and commit['gitleaks'] == check['gitleaks']
    assert commit['messageSha256'] == digest(b'feat: large public fixture\n')
    verified = cli('verify','github-pr.py',['verify'],
        {'preparation':retained('pr-prepare.out'),'commit':retained('commit.out')})
    assert verified == {'kind':'pr-verification','commit':sha,'branch':'planned','diffSha256':setup['diffSha256']}
    pc = cli('push-check','guarded-push.py',['check','--prepared'],
        {'preparation':retained('push-prepare.out'),'commit':retained('commit.out')})
    assert isinstance(pc['snapshot'],dict) and isinstance(pc['commits'],list) and pc['alreadyPushed'] is False
    assert pc['snapshot'] == {**pushed['destination'],'head':sha}
    sent = cli('push','guarded-push.py',['push'],{'check':retained('push-check.out')})
    assert sent == {'status':'pushed','commit':sha,'branch':'planned','remote':'origin','target':'planned','upstreamConfigured':True}
    pr = cli('pr-check','github-pr.py',['check','--prepared'],
        {'preparation':retained('pr-prepare.out'),'commit':retained('commit.out')})
    s = pr['snapshot']
    assert isinstance(s,dict) and isinstance(pr['commits'],list) and pr['existingPullRequests'] == []
    assert s['head'] == sha and s['branch'] == 'planned' and s['base'] == 'main' and s['baseHead'] == setup['base']
    assert s['remote'] == 'origin' and s['githubRepository'] == 'github.com/owner/repo'
    assert digest(pr['diff'].encode()) == setup['diffSha256']
    assert len((private/'pr-check.out').read_bytes()) > 1048576
    assert len(json.dumps(pr,ensure_ascii=True)) > 262144
    # A full unchanged PR_CHECK is handed to a downstream read-only consumer, not create.
    consumer = private/'consumer.in'
    with consumer.open('xb') as f: f.write(json.dumps({'check':retained('pr-check.out')}).encode())
    records[consumer.name] = metadata(consumer)
    print(json.dumps({'stage':'pr-check','status':'validated','commit':sha,
        'prepareBytes':records['pr-prepare.out']['bytes'],'checkBytes':records['pr-check.out']['bytes']}))
finally:
    # No success assertion or raw JSON in stdout on failure; no downstream mutation/retry.
    (owned/'manifest.json').write_text(json.dumps({'files':records,'operations':operations,'inputs':inputs,'groups':groups}))
PY
cat > "$OWNED/observe.txt" <<'PY'
import hashlib, json, os, stat, subprocess
from pathlib import Path
os.umask(0o077)
owned = Path(os.environ['TMPDIR']).parent
setup = json.loads((owned/'setup.json').read_text())
manifest = json.loads((owned/'manifest.json').read_text())
private = owned/'private'
observed = {}
def digest(b): return hashlib.sha256(b).hexdigest()
def g(*args):
    return subprocess.check_output([setup['git'],'-C',str(owned/'repo'),*args])
try:
    ds = private.lstat()
    assert not private.is_symlink() and ds.st_uid == os.getuid() and stat.S_IMODE(ds.st_mode) == 0o700
    for name, expected in manifest['files'].items():
        p = private/name
        assert p.parent == private and p.resolve().parent == private and not p.is_symlink()
        st = p.lstat()
        b = p.read_bytes()
        actual = {'bytes':len(b),'sha256':digest(b),'mode':oct(stat.S_IMODE(st.st_mode)),'uid':st.st_uid}
        assert actual == expected and actual['mode'] == '0o600' and st.st_uid == os.getuid()
        observed[name] = actual
    (owned/'independent-files.json').write_text(json.dumps(observed))
    def read(name): return json.loads((private/name).read_bytes())
    prep, check, commit = read('pr-prepare.out'), read('pr-check.out'), read('commit.out')
    assert read('verify.in')['preparation'] == prep
    assert read('pr-check.in')['preparation'] == prep
    assert read('consumer.in')['check'] == check
    # Full input values: canonical object digests, not just the diff field.
    def object_digest(o): return digest(json.dumps(o,sort_keys=True,ensure_ascii=True).encode())
    transfers = {'prepareObjectSha256':object_digest(prep),'checkObjectSha256':object_digest(check)}
    assert object_digest(read('verify.in')['preparation']) == transfers['prepareObjectSha256']
    assert object_digest(read('pr-check.in')['preparation']) == transfers['prepareObjectSha256']
    assert object_digest(read('consumer.in')['check']) == transfers['checkObjectSha256']
    sha = commit['commit']
    assert g('rev-parse','HEAD').decode().strip() == sha
    headers, body = g('cat-file','commit',sha).split(b'\n\n',1)
    assert headers.splitlines()[0] == ('tree '+setup['tree']).encode()
    assert [x for x in headers.splitlines() if x.startswith(b'parent ')] == [('parent '+setup['base']).encode()]
    assert body == b'feat: large public fixture\n'
    assert g('write-tree').decode().strip() == setup['tree']
    assert g('rev-parse','main').decode().strip() == g('rev-parse','feature').decode().strip() == setup['base']
    expected_refs = sorted([*setup['refs'], 'refs/heads/planned '+sha,'refs/remotes/origin/planned '+sha])
    assert g('for-each-ref','--format=%(refname) %(objectname)').decode().splitlines() == expected_refs
    assert g('config','--get','branch.planned.remote') == b'origin\n'
    assert g('config','--get','branch.planned.merge') == b'refs/heads/planned\n'
    bare = g('-C',str(owned/'remote.git'),'for-each-ref','--format=%(refname) %(objectname)').decode()
    assert bare == 'refs/heads/main '+setup['base']+'\nrefs/heads/planned '+sha+'\n'
    raw = g('--no-pager','diff','--no-ext-diff','--no-textconv','--binary','--no-color','--no-renames','--ignore-submodules=none',setup['base'],sha,'--')
    assert len(raw) == setup['diffBytes'] and digest(raw) == setup['diffSha256']
    assert prep['diff'].encode() == check['diff'].encode() == raw
    calls = [json.loads(l) for l in (owned/'git.log').read_text().splitlines()]
    pushes = [json.loads(l) for l in (owned/'push.log').read_text().splitlines()]
    gh = [json.loads(l) for l in (owned/'gh.log').read_text().splitlines()]
    assert len(pushes) == 1 and sha+':refs/heads/planned' in pushes[0]
    assert sum(c[:1] == ['commit'] for c in calls) == 1
    assert [c for c in calls if c[:1] == ['switch']] == [['switch','--no-track','-c','planned']]
    assert not any(set(c)&{'fetch','reset','--amend','--force','-f','rebase','merge','release','deploy'} for c in calls)
    assert not any(c[:2] == ['pr','create'] for c in gh)
    assert json.loads((owned/'gh.json').read_text())['prs'] == []
    assert [o['stage'] for o in manifest['operations']] == ['commit-check','push-prepare','pr-prepare','commit','verify','push-check','push','pr-check']
    assert all(o['exit'] == 0 for o in manifest['operations'])
    result = {'status':'passed','independentFiles':observed,'transfers':transfers,
        'diffBytes':len(raw),'diffSha256':digest(raw),'commit':sha,'bareRefs':bare,
        'pushes':len(pushes),'creates':0,'privateDirectoryMode':'0o700','uid':ds.st_uid}
    (owned/'observed.json').write_text(json.dumps(result))
    print(json.dumps({k:v for k,v in result.items() if k not in ('independentFiles','transfers','bareRefs')}))
finally:
    # Delete only exact recorded files after integrity/ownership checks. Unknown file survives.
    removed = []
    for name, expected in manifest['files'].items():
        p = private/name
        if name not in observed: continue
        assert p.parent == private and not p.is_symlink() and digest(p.read_bytes()) == expected['sha256']
        p.unlink()
        removed.append(name)
    sentinel = private/'outside-sentinel'
    assert sentinel.read_bytes() == b'outside-example-ownership\n' and not sentinel.is_symlink()
    assert sorted(p.name for p in private.iterdir()) == ['outside-sentinel']
    try: private.rmdir()
    except OSError: directory_retained = True
    else: raise AssertionError('nonempty directory unexpectedly removed')
    (owned/'private-cleanup.json').write_text(json.dumps({'removed':removed,'sentinelRetained':True,
        'sentinelSha256':digest(sentinel.read_bytes()),'directoryRetained':directory_retained}))
PY
```

次の接続は下記コードをrequestへ含めるだけ。`--request`はSkill本体呼出しではない限定例である。helper systemに従う先行公開文書readは許容し、Codemode集約区間と区別する（大容量JSONをreadしてはいけない）。Pi側がinlineコマンドを変更・追加mutation・再試行したら成功とせず、操作記録を読む。helper既存system指示の「Skill遵守」は製品Skill実行を偽装する許可ではなく、この検証用限定例を選択する。小さいsummaryのみを返す。

```bash
umask 077
"$PYTHON" -E -S - <<'PY'
import json, os, shlex, subprocess
from pathlib import Path
owned, source = (Path(os.environ[k]).resolve() for k in ('OWNED','SOURCE'))
env = json.loads((owned/'env.json').read_text())
commands = []
for name in ('pipeline','observe'):
    code = (owned/(name+'.txt')).read_text()
    command = 'umask 077\n'+shlex.quote(os.environ['PYTHON'])+" -E -S - <<'PRIVATE_JSON_EXAMPLE'\n"+code+'\nPRIVATE_JSON_EXAMPLE'
    commands.append(command)
js = 'const first = await tools.bash('+json.dumps({'command':commands[0]})+');\n'
js += 'if (first.truncated || first.exit_code !== 0) throw new Error("pipeline failed; stop without retry");\n'
js += 'const a = JSON.parse(first.output); if (a.stage !== "pr-check" || a.status !== "validated" || a.prepareBytes <= 1048576 || a.checkBytes <= 1048576) throw new Error("invalid pipeline summary"); text(a);\n'
js += 'const observed = await tools.bash('+json.dumps({'command':commands[1]})+');\n'
js += 'if (observed.truncated || observed.exit_code !== 0) throw new Error("independent observation/cleanup failed");\n'
js += 'const b = JSON.parse(observed.output); if (b.status !== "passed" || b.commit !== a.commit || b.pushes !== 1 || b.creates !== 0) throw new Error("invalid independent summary"); text(b);'
request = ('This is the verify-project large-JSON limited calling example, NOT a commit Skill/approval run. '
    'Do not invoke the product Skill or read large JSON. Execute exactly this JavaScript with ONE codemode call; '
    'no options timeout, no store/load or large JSON read, no retries or fallback. '
    'Preliminary public verification-document reads required by the supplied Skill are allowed BEFORE Codemode. '
    'All operations are restricted to the owned local fixture. Then give only a bounded success/failure report.\n'+js)
(owned/'request.txt').write_text(request)
command = [env['VERIFY_NODE'],str(source/'.pi/skills/verify-project/scripts/commit-rpc.ts'),
    str(owned/'repo'),str(source/'.pi/skills/verify-project/SKILL.md'),str(owned/'rpc'),
    '--fixture-remote','--legacy-codemode','--request',request]
result = subprocess.run(command,env=env)
(owned/'command-exit.json').write_text(json.dumps({'command':['commit-rpc.ts','--fixture-remote','--legacy-codemode','--request','<fixed inline example>'],
    'exit':result.returncode}))
assert result.returncode == 0
PY
```

## 独立readbackとcleanup（成功・失敗共通）

helperの`rpc/cleanup.json`のwait/groupGone/exitを実readする。`operations.jsonl`で外側codemodeちょうど1、内側bash2、先行公開文書read以外の追加toolなし、assistant error/abortなし、CLI大容量応答の転載なしを確認する。`manifest.json`は全CLI argv/exit・stdin/out/err mode/bytes/SHA-256・使用前再照合・所有CLI group wait/不存在。`observed.json`は別processによる全file metadataと完全object/diff digest・実Git/bare/fixture照合。`private-cleanup.json`は記録済みfileだけ削除、所有外sentinel保持、非空dirのrmdir拒否。prepare/PR check双方の実サイズが262144文字/1MiBを超え、全入力とcanonical diffは2MiB未満であることを実測で判定する。fixtureをUnicode化してJSONが倍増/上限超なら、製品limitや期待を緩めず、元limit内のASCII材料サイズを観測に基づき選ぶ。

証拠へ必要最小限の`source.json`/`setup.json`/`sandbox.json`、`manifest.json`、`observed.json`、`private-cleanup.json`、`command-exit.json`、RPC operations/cleanup、request（無秘密inlineコードだけ）を保存する。**大容量JSON・payload・env/auth・fixture内部auth生出力は保存しない**。失敗時は成功済み段階・最後のexit・未確認・残存を記録し、独立観測を成功扱いしない。失敗後の追加mutationなし。

一時環境を消す前に、所有Pi/CLI groupsのwait/不存在を確認する。任意中断で未終了ならcleanupを止め残存を報告する。通常auth lockの存在だけを確認し、未知lockは削除しない。まず例のcleanup後sentinelが残ることを記録し、その後外側fixture所有者がsentinelを証拠へ移す。今回作ったfixture全体は所有物と確認してからcleanupするが、未知file/symlink/所有者不一致があれば再帰削除せず止める。認証/共有pathをcleanup対象へ含めない。READMEに期待/観測、失敗/未確認、command/exit、cleanupと全相対参照を記し、**cleanup後にREADMEと全参照を実read**する。

Root fresh再現は共通隔離setupからこの3ブロックを順に実行し、自身の新runへ保存する。一時path・前session・生存processへ依存しない。正式checks/独立review/CodeReview/最終採否はRootが別に行う。性能3run・通常Agent・全suiteはこの一件の検証対象外。

次の外側read-only判定/証拠保存/cleanupを最後に実行する（製品段階を再実行しない）。helper exit0と機能成功を混同せず、失敗runも同じコードで保存してからstatusを返す。これは当該fixtureの明示inventoryだけを扱い、未知fileを見つけたら削除せず停止する。

```bash
umask 077
"$PYTHON" -E -S - <<'PY'
import hashlib, json, os, re, shlex, shutil, signal, stat
from pathlib import Path
owned, evidence, source = (Path(os.environ[k]).resolve() for k in ('OWNED','EVIDENCE','SOURCE'))
os.umask(0o077)
setup = json.loads((owned/'setup.json').read_text())
manifest = json.loads((owned/'manifest.json').read_text())
cleanup = json.loads((owned/'rpc/cleanup.json').read_text())
assert cleanup['waited'] and cleanup['groupGone'] and cleanup['processExit'] == 0
for group in [*manifest['groups'], {'pid':cleanup['pid'],'waited':True,'groupGone':True}]:
    assert group['waited'] and group['groupGone']
    try: os.killpg(group['pid'],0)
    except ProcessLookupError: pass
    else: raise AssertionError('owned group remains; do not cleanup')
records = [json.loads(l) for l in (owned/'rpc/operations.jsonl').read_text().splitlines()]
starts = [r for r in records if r['type'] == 'tool_execution_start']
codemode = [r for r in starts if r['toolName'] == 'codemode']
bash = [r for r in starts if r['toolName'] == 'bash']
ends = [r for r in records if r['type'] == 'tool_execution_end']
assert len(codemode) == 1
for r in starts:
    assert r['toolName'] in ('read','bash','codemode')
    if r['toolName'] == 'read':
        p = Path(r['args']['path']).resolve()
        assert p.is_relative_to(source/'.pi/skills/verify-project') and p.suffix == '.md'
        assert r['receivedMonotonic'] < codemode[0]['receivedMonotonic']
for name, call in zip(('pipeline','observe'),bash):
    expected = 'umask 077\n'+shlex.quote(setup['python'])+" -E -S - <<'PRIVATE_JSON_EXAMPLE'\n"+(owned/(name+'.txt')).read_text()+'\nPRIVATE_JSON_EXAMPLE'
    assert call['args']['command'] == expected, 'inline command was changed'
for r in ends:
    if r['toolName'] in ('bash','codemode'):
        assert len(json.dumps(r['result'])) < 20000, 'unbounded output'
passed = (owned/'observed.json').exists() and len(bash) == 2 and not any(r.get('isError') for r in ends)
passed = passed and all(r.get('stopReason') not in ('error','aborted') for r in records if r['type'] == 'assistant')
# Persist only metadata/code and bounded summaries, never large CLI JSON or env/auth.
for name in ('manifest.json','observed.json','independent-files.json','private-cleanup.json',
             'command-exit.json','request.txt'):
    if (owned/name).exists(): shutil.copyfile(owned/name,evidence/name)
for name in ('operations.jsonl','cleanup.json'):
    shutil.copyfile(owned/'rpc'/name,evidence/('rpc-'+name))
lock_presence = {name:(Path(os.environ['PI_CODING_AGENT_DIR'])/name).exists()
                 for name in ('auth.json.lock','settings.json.lock')}
# Exact file inventory of this fixture, not an arbitrary recursive-delete root.
top = {'setup.json','env.json','sandbox.sb','write-probe','pipeline.txt','observe.txt','request.txt',
       'manifest.json','observed.json','independent-files.json','private-cleanup.json','command-exit.json','procedure.sh',
       'gh.json','gh.log','git.log','push.log'}
hooks = {'applypatch-msg','commit-msg','fsmonitor-watchman','post-update','pre-applypatch','pre-commit',
         'pre-merge-commit','pre-push','pre-rebase','pre-receive','prepare-commit-msg','push-to-checkout','sendemail-validate','update'}
def known(rel):
    if len(rel.parts) == 1: return str(rel) in top
    if str(rel) in ('bin/git','bin/fixture-git','bin/gh','bin/ssh','python/git','repo/base.txt','repo/pending.txt',
                    'rpc/operations.jsonl','rpc/cleanup.json','private/outside-sentinel','gh.json','gh.log','git.log','push.log'): return True
    if rel.parts[0] == 'private': return rel.name in manifest['files']
    if rel.parts[0] == 'remote.git': tail = Path(*rel.parts[1:])
    elif rel.parts[:2] == ('repo','.git'): tail = Path(*rel.parts[2:])
    else: return False
    t = str(tail)
    return (t in ('HEAD','config','description','index','COMMIT_EDITMSG','info/exclude','logs/HEAD')
        or re.fullmatch(r'(?:logs/)?refs/(?:heads/(?:main|feature|planned)|remotes/origin/(?:main|planned))',t)
        or re.fullmatch(r'objects/[0-9a-f]{2}/[0-9a-f]{38}',t)
        or (tail.parent == Path('hooks') and tail.suffix == '.sample' and tail.stem in hooks))
files, directories = [], []
for p in owned.rglob('*'):
    s = p.lstat()
    assert not p.is_symlink() and s.st_uid == os.getuid(), 'unknown ownership/symlink; stop'
    if p.is_dir(): directories.append(p)
    else:
        assert p.is_file() and known(p.relative_to(owned)), 'unknown file; stop without deleting'
        files.append((p,s.st_dev,s.st_ino,hashlib.sha256(p.read_bytes()).hexdigest()))
ancestors = {q for p,_,_,_ in files for q in p.parents if q != owned and q.is_relative_to(owned)}
empty = {owned/'home',owned/'tmp'}
for root in (owned/'repo/.git',owned/'remote.git'):
    empty.update(root/t for t in ('objects/pack','objects/info','refs/tags'))
assert all(p in ancestors or p in empty for p in directories), 'unknown directory; stop without deleting'
# First observe sentinel retention by the example; only now its outer owner moves it.
sentinel = owned/'private/outside-sentinel'
assert sentinel.read_bytes() == b'outside-example-ownership\n'
shutil.copyfile(sentinel,evidence/'outside-sentinel.txt')
for p,dev,ino,digest in files:
    s = p.lstat()
    assert s.st_uid == os.getuid() and (s.st_dev,s.st_ino) == (dev,ino) and not p.is_symlink()
    assert hashlib.sha256(p.read_bytes()).hexdigest() == digest
    p.unlink()
for p in sorted(directories,key=lambda p:len(p.parts),reverse=True): p.rmdir()
owned.rmdir()
result = {'status':'passed' if passed else 'failed','ownedRemoved':not owned.exists(),
          'ownedGroupsWaitedGone':True,'normalAuthLocksPresentNotDeleted':lock_presence,
          'codemodeCalls':len(codemode),'internalBashCalls':len(bash),
          'preliminaryDocumentReads':sum(r['toolName']=='read' for r in starts),
          'sentinelRetainedByExampleThenCopiedByOwner':True,
          'limits':'Skill/normal approval, real GitHub, arbitrary interruption/finally, performance and other cases unverified.'}
(evidence/'result.json').write_text(json.dumps(result,indent=2)+'\n')
files = sorted(p.name for p in evidence.iterdir() if p.is_file())
reference = os.path.relpath(source/'.pi/skills/verify-project/references/large-json.md',evidence)
(evidence/'README.md').write_text('# Large JSON limited Codemode example\n\n'+
    'Status: '+result['status']+'. Public CLI exit0 alone is not acceptance.\n\n'+
    'Procedure: [large-json.md]('+reference+')\n\n'+
    '\n'.join('- ['+n+']('+n+')' for n in files)+'\n')
# Read every reference after cleanup; no surviving process or ephemeral path is needed.
for name in [*files,'README.md']:
    assert (evidence/name).read_bytes()
assert (evidence/reference).resolve().read_text()
print(evidence, json.dumps(result))
assert passed, 'failed run preserved; no retry/fallback performed'
PY
```
