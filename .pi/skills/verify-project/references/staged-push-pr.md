# 公開script: staged → local bare push → fixture PR

[Feature Map](feature-map.md)のscript接続用の一経路。repositoryルートをcwdにし、以下のBashブロック全体を実行する。前回の環境・Pi session・一時pathは不要。既存のPython 3.14以上・Git・開発用pytest（`.venv`）が必要。installしない。`uv --no-sync`が失敗したら不足を報告し、認証や安全条件を迂回しない。

Issue #34では全製品CLIを確認したPython実体と`-E -S`で起動し、人工`PYTHONPATH/sitecustomize.py`が子`git-status.py`で実行されないことも限定確認する。外部hook／Git／gh等の環境は保護対象ではない。

これは実Gitと既存`RemoteTools.setup_tools`のgit/gh/ssh fixtureを使う。fixture源を複製せず、内部handlerや判定用setterは呼ばない。実行する製品入口は`staged-commit.py`、`guarded-push.py`、`github-pr.py`の公開CLIだけ。fixtureの架空URLはlocal bareへ割り当てられ、実GitHub・実remoteへ接続しない。Agentのbranch判断・ユーザー承認、実GitHubの認証/権限/通信は未確認。

## 期待結果と観測時点

- 人工起動コードは`sys.argv[0]`が`git-status.py`の時だけ無秘密markerを作る。無保護の対照で実行を確認してmarkerを削除し、以後の全製品CLIでmarkerなしを照合する。fixture自身のPython起動は混同しない。
- 安全な自作ファイル2件の既存履歴（base → first）とpendingのStageだけを準備する。remoteはbaseだけのmain、ローカルはfeature。無関係なhistoryや後続操作を準備しない。
- `check --branch planned` → push prepare → PR prepareの各時点でHEAD・全refs/symref・index bytes/tree・branch設定・bare refs・fixture PR不変。push/createは0回。
- commit時だけplannedを作り、実commitの親=first、tree=Stage、raw message=`feat: pending\n`。feature/mainは保持し、upstreamは未継承。indexの表現はcommitで変わり得るがtreeは同じ。
- PR verify、prepared push checkでも状態不変。prepared PR checkはpush前には拒否（`prepared_commit_changed`）、push/createなし。この拒否は追加の安全時点であり省略しない。
- pushは1回だけ。bare planned SHA=実commit、bare main=base、余分なrefsなし。ローカルは予定tracking refとupstreamだけ追加。HEAD・index不変。
- push後のprepared PR checkは非変更。createは1回だけ。fixtureにOPEN/Draftの1件、title/body/base/head/SHAが入力と実bareに一致。create中もGit状態不変。保存した全Git/gh操作を照合し、予定外のbranch/commit/push/create、fetch/reset/amend/force/rebase/merge/release/deployなし。

各CLI直後のsnapshotを`states.json`、CLIの順番/exitを`operations.json`、実Git objectを`commit.json`、fixtureの最小記録を`push.json`/`gh.json`/`pr.json`、Git操作を`git.json`に保存する。indexの生bytesは保存せずSHA-256で完全bytesを比較する。入力は無秘密の自作fixtureのみ。`gh auth status`の生出力など不要なraw logは保存しない。ignoreは秘密保護ではない。

## 再実行コマンド

`RUN`のprefixは担当に応じ`worker`/`root`へ変えてよい。それ以外は同じ手順でfreshに実行する。assert失敗を期待値の変更で隠さず、記録のfailedと未確認範囲を報告する。

```bash
set -euo pipefail
umask 077
RUN="worker-$(date -u +%Y%m%dT%H%M%SZ)-$$"
UV_OFFLINE=1 mise exec -- uv run --no-sync --locked --python python python -B - \
  "docs/verification/34/$RUN" "$(command -v git)" <<'PY'
import hashlib
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

source = Path.cwd().resolve()
evidence = (source / sys.argv[1]).resolve()
assert evidence.parent == source / 'docs/verification/34'
evidence.mkdir(parents=True, exist_ok=False)
real_git = str(Path(sys.argv[2]).resolve())
assert sys.version_info >= (3, 14)

def save(name, value):
    (evidence / name).write_text(json.dumps(value, indent=2) + '\n')

# Whitelist, rather than inheriting credentials, hooks, config or shell startup.
clean = {'PATH': '/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM': '1',
         'GIT_CONFIG_GLOBAL': os.devnull, 'LC_ALL': 'C'}
def source_git(*args):
    return subprocess.check_output([real_git, *args], cwd=source, env=clean).decode().strip()

save('source.json', {'head': source_git('rev-parse', 'HEAD'),
     'dirty': source_git('status', '--short'),
     'diffSha256': hashlib.sha256(subprocess.check_output(
         [real_git, 'diff', '--binary', 'HEAD'], cwd=source, env=clean)).hexdigest(),
     'python': sys.version, 'pythonExecutable': sys.executable,
     'git': source_git('--version'), 'gitExecutable': real_git,
     'platform': sys.platform,
     'assetsSha256': {name: hashlib.sha256((source / name).read_bytes()).hexdigest()
         for name in ['CONTRIBUTING.md', '.pi/skills/verify-project/SKILL.md',
                      '.pi/skills/verify-project/references/feature-map.md',
                      '.pi/skills/verify-project/references/staged-push-pr.md',
                      'skills/commit/tests/test_remote_scripts.py',
                      'skills/commit/tests/fixtures/remote_tools.py',
                      'skills/commit/scripts/staged-commit.py',
                      'skills/commit/scripts/git_guard.py']}})
spec = importlib.util.spec_from_file_location(
    'remote_tests', source / 'skills/commit/tests/test_remote_scripts.py')
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
owned = Path(tempfile.mkdtemp(prefix='pi-staged-pr-')).resolve()
operations, states, pids = [], {}, []
result = {'status': 'failed', 'unverified': 'See the last recorded operation/state.'}
try:
    for directory in ('repo', 'bin', 'home', 'tmp'):
        (owned / directory).mkdir()
    env = {**clean, 'PATH': str(owned / 'bin'), 'HOME': str(owned / 'home'),
           'TMPDIR': str(owned / 'tmp')}
    tools = module.RemoteTools()
    tools.setup_tools(owned, real_git, env)
    g = tools.git
    for args in [('init', '-b', 'main'), ('config', 'user.name', 'Test User'),
                 ('config', 'user.email', 'test@example.invalid'),
                 ('config', 'commit.gpgsign', 'false')]:
        g(*args)
    tools.add_commit('base.txt', 'base')
    base = g('rev-parse', 'HEAD').decode().strip()
    g('init', '--bare', '-b', 'main', str(tools.remote))
    g('remote', 'add', 'origin', str(tools.remote))
    # Seed via the real Git, separately from the one product push being observed.
    g('push', 'origin', 'main')
    g('switch', '-c', 'feature')
    tools.add_commit('first.txt', 'first')
    first = g('rev-parse', 'HEAD').decode().strip()
    g('remote', 'set-url', 'origin', 'git@github-work:owner/repo.git')
    (tools.repo / 'pending.txt').write_text('pending')
    g('add', '--', 'pending.txt')
    staged_tree = g('write-tree').decode().strip()

    startup = owned / 'startup'
    startup.mkdir()
    marker = owned / 'git-status-startup'
    (startup / 'sitecustomize.py').write_text(
        'import sys\nfrom pathlib import Path\n' +
        "if Path(sys.argv[0]).name == 'git-status.py':\n" +
        f'    Path({str(marker)!r}).touch()\n')
    env['PYTHONPATH'] = str(startup)
    # Positive control: only the owned git-status startup probe may create the marker.
    control = subprocess.run([sys.executable, '-B',
        str(source / 'skills/commit/scripts/git-status.py')],
        cwd=tools.repo, env=env, capture_output=True, timeout=30)
    assert control.returncode == 0 and marker.exists()
    marker.unlink()
    save('startup.json', {'unprotectedControlExit': control.returncode,
                         'unprotectedControlMarker': True, 'productMarker': False})

    # Observe every product Git invocation, outside the unchanged fixture wrapper.
    wrapper = tools.bin / 'git'
    wrapper.rename(tools.bin / 'fixture-git')
    wrapper.write_text(f'#!{sys.executable}\n' +
        'import json, os, sys\n' +
        f'with open({str(owned / "git.log")!r}, "a") as log:\n' +
        '    log.write(json.dumps(sys.argv[1:]) + "\\n")\n' +
        f'os.execv({str(tools.bin / "fixture-git")!r}, ["git", *sys.argv[1:]])\n')
    wrapper.chmod(0o700)

    def snapshot(label):
        index = tools.repo / '.git/index'
        before = index.read_bytes()
        state = {
            'repository': g('rev-parse', '--show-toplevel').decode().strip(),
            'gitDir': g('rev-parse', '--absolute-git-dir').decode().strip(),
            'head': g('rev-parse', 'HEAD').decode().strip(),
            'branch': g('symbolic-ref', 'HEAD').decode().strip(),
            'refs': g('for-each-ref', '--format=%(refname) %(objectname) %(symref)').decode(),
            'indexSha256': hashlib.sha256(before).hexdigest(),
            'tree': g('write-tree').decode().strip(),
            'branchConfig': g('config', '--local', '--list').decode(),
            'remoteRefs': tools.remote_git('for-each-ref', '--format=%(refname) %(objectname)').decode(),
            'prs': json.loads((owned / 'gh.json').read_text())['prs'],
            'pushes': len(tools.push_calls()), 'creates': len(tools.gh_calls('pr create'))}
        assert index.read_bytes() == before, 'Observation must not change index bytes'
        states[label] = state
        save('states.json', states)
        return state

    def cli(name, *args, request=None, success=True):
        command = [sys.executable, '-E', '-S', '-B', str(source / 'skills/commit/scripts' / name), *args]
        # A separate owned process group allows cleanup even on timeout/failure.
        process = subprocess.Popen(command, cwd=tools.repo, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True)
        pids.append(process.pid)
        try:
            out, err = process.communicate(
                json.dumps(request).encode() if request is not None else None, timeout=30)
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        response = json.loads(out)
        operations.append({'script': name, 'argv': command, 'args': list(args), 'exit': process.returncode,
                           'error': response.get('error')})
        save('operations.json', operations)
        save('startup.json', {'unprotectedControlExit': control.returncode,
                             'unprotectedControlMarker': True, 'productMarker': marker.exists()})
        assert not marker.exists(), 'Bundled git-status loaded Python startup code'
        assert (process.returncode == 0) == success
        assert b'Traceback' not in err and b'SECRET' not in out + err
        return response

    before = snapshot('staged')
    checked = cli('staged-commit.py', 'check', '--branch', 'planned')
    assert snapshot('commit-check') == before
    pushed = cli('guarded-push.py', 'prepare', '--remote', 'origin', '--set-upstream',
                 request={'commitCheck': checked})
    assert snapshot('push-prepare') == before
    prepared = cli('github-pr.py', 'prepare', '--remote', 'origin', '--repo', 'owner/repo',
                   request={'commitCheck': checked, 'pushPreparation': pushed})
    assert snapshot('pr-prepare') == before
    commit = cli('staged-commit.py', 'commit',
                 request={'check': checked, 'message': 'feat: pending\n'})
    committed = snapshot('committed')
    sha = commit['commit']
    raw = g('cat-file', 'commit', sha).decode()
    headers, message = raw.split('\n\n', 1)
    save('commit.json', {'sha': sha, 'headers': headers, 'rawMessage': message})
    assert [line for line in headers.splitlines() if line.startswith('parent ')] == ['parent ' + first]
    assert headers.splitlines()[0] == 'tree ' + staged_tree
    assert message == 'feat: pending\n'
    assert committed['branch'] == 'refs/heads/planned' and committed['head'] == sha
    assert committed['tree'] == staged_tree
    assert g('rev-parse', 'feature').decode().strip() == first
    assert g('rev-parse', 'main').decode().strip() == base
    assert committed['refs'] == ''.join(sorted(
        before['refs'].splitlines(keepends=True) + [f'refs/heads/planned {sha} \n']))
    assert committed['branchConfig'] == before['branchConfig']
    for key in ('repository', 'gitDir', 'remoteRefs', 'prs', 'pushes', 'creates'):
        assert committed[key] == before[key]
    request = {'preparation': prepared, 'commit': commit}
    rejected = cli('github-pr.py', 'check', '--prepared', request=request, success=False)
    assert rejected['error'] == 'prepared_commit_changed'
    assert snapshot('pr-check-before-push-rejected') == committed
    verified = cli('github-pr.py', 'verify', request=request)
    assert verified['kind'] == 'pr-verification' and verified['commit'] == sha
    assert snapshot('pr-verify') == committed
    push_check = cli('guarded-push.py', 'check', '--prepared',
                     request={'preparation': pushed, 'commit': commit})
    assert snapshot('push-check') == committed
    cli('guarded-push.py', 'push', request={'check': push_check})
    sent = snapshot('pushed')
    assert sent['remoteRefs'] == f'refs/heads/main {base}\nrefs/heads/planned {sha}\n'
    assert sent['refs'] == committed['refs'] + f'refs/remotes/origin/planned {sha} \n'
    assert sent['branchConfig'] == committed['branchConfig'] + (
        'branch.planned.remote=origin\nbranch.planned.merge=refs/heads/planned\n')
    for key in ('repository', 'gitDir', 'head', 'branch', 'indexSha256', 'tree', 'prs', 'creates'):
        assert sent[key] == committed[key]
    assert sent['pushes'] == 1
    executable = cli('github-pr.py', 'check', '--prepared', request=request)
    assert snapshot('pr-check-after-push') == sent
    title = "feat: 'quoted' $(touch unwanted)"
    body = "## Why\n\nKeep `code`, $HOME and 'quotes'.\n\nCloses #1\n"
    created = cli('github-pr.py', 'create', request={
        'check': executable, 'title': title, 'body': body, 'draft': True})
    final = snapshot('created')
    assert created['status'] == 'created'
    assert final['pushes'] == 1 and final['creates'] == 1
    assert len(final['prs']) == 1
    pr = final['prs'][0]
    assert pr == {'number': 1, 'url': 'https://github.com/owner/repo/pull/1',
        'state': 'OPEN', 'isDraft': True, 'title': title, 'body': body,
        'baseRefName': 'main', 'headRefName': 'planned', 'baseRefOid': base,
        'headRefOid': sha, 'isCrossRepository': False}
    assert not (tools.repo / 'unwanted').exists()
    for key in final.keys() - {'prs', 'creates'}:
        assert final[key] == sent[key]
    git_calls = [json.loads(line) for line in (owned / 'git.log').read_text().splitlines()]
    gh_calls = [json.loads(line) for line in (owned / 'gh.log').read_text().splitlines()]
    save('pr.json', pr)
    assert sum('push' in call for call in git_calls) == 1
    assert sum(call[:1] == ['commit'] for call in git_calls) == 1
    assert [call for call in git_calls if call[:1] == ['switch']] == [
        ['switch', '--no-track', '-c', 'planned']]
    assert not any(set(call) & {'fetch', 'reset', '--amend', '--force', '-f',
                              'rebase', 'merge', 'release', 'deploy'} for call in git_calls)
    assert len(tools.gh_calls('pr create')) == 1
    result = {'status': 'passed', 'expectedObserved': 'All per-step assertions passed.',
              'gitleaks': checked['gitleaks'],
              'unverified': 'Agent decisions/approval, real GitHub/network, other paths/guards/OS.'}
finally:
    try:
        save('operations.json', operations)
        save('states.json', states)
        for filename, log in [('git.json', 'git.log'), ('gh.json', 'gh.log'), ('push.json', 'push.log')]:
            path = owned / log
            save(filename, [json.loads(line) for line in path.read_text().splitlines()]
                 if path.exists() else [])
    finally:
        # Evidence write failures must not bypass owned-environment cleanup.
        try:
            shutil.rmtree(owned)
        finally:
            result['cleanup'] = {'ownedRemoved': not owned.exists(),
                                 'ownedPidsWaited': pids, 'persistentProcesses': False}
            save('result.json', result)
    # Read every saved evidence file after cleanup; no reference depends on owned.
    files = sorted(path.name for path in evidence.glob('*.json'))
    for name in files:
        json.loads((evidence / name).read_text())
    (evidence / 'README.md').write_text(
        '# staged → push → fixture PR\n\n' +
        'Procedure: [staged-push-pr.md](../../../../.pi/skills/verify-project/references/staged-push-pr.md)\n\n' +
        '\n'.join(f'- [{name}]({name})' for name in files) + '\n')
    assert (evidence / 'README.md').read_text()
    assert (evidence / '../../../../.pi/skills/verify-project/references/staged-push-pr.md').resolve().read_text()
print(evidence.relative_to(source), result['status'], 'cleanup/readback passed')
PY
```

期待exitは0、末尾は`docs/verification/34/<run> passed cleanup/readback passed`。失敗時も`result.json`と最後までの操作/状態を読み、未到達の段階を成功にしない。setup/CLI以外の恒久processは起動せず、各CLIは専用process groupを終了・waitし、成功失敗とも自分で作った一時directoryだけを削除する。`cleanup`失敗なら残存対象を報告し、他のPID/環境を削除しない。

## 記録の仕上げと独立確認

runのREADMEへ実行者、実行コマンド、exit、期待との比較、未確認、証拠・cleanup/readback結果を追記する。`git.json`/`gh.json`を実readして操作の順序・回数と禁止操作なしを確認する（assertだけで全コマンドの意味を判定したとはしない）。source.jsonの版/dirtyに加えて、新規未追跡の検証資産があればそのファイルも読んで記録する。source変更後は関連経路を更新・再実行し、以前の成功を流用しない。追記後もREADMEと全相対参照を実readする。

Rootはこの手順だけからprefixをrootにしてfresh再実行し、自分で期待と観測を照合する。全branchのPi session・全Mapはこのscript確認の前提でない。通常テスト・正式4チェック/pack・独立Reviewと明示Code Review・Rootの最終受入れは別に維持する。
