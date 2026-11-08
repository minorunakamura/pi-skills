# Feature Map: commit のローカルdefaultと作業branch

初期対象はIssue #28の`/skill:commit`だけ。標準CLI/RPCの利用者入口でAgentが判断した結果を観測する。push／PR・commit-main（未導入）・全OS／全refspec／LLM判断精度全般は対象外。[準備・起動・安全性・cleanup](../SKILL.md)に従う。runの成否や一時パスはこのMapに書かず、`docs/verification/28/<run>/`の実行記録へ分離する。

## 共通setupと観測

各caseで新しいowned repoを使い、環境はSkillの隔離設定を引き継ぐ。次はmain開始のsetup。master等のcaseは`-b`の値だけを変える。複数caseなら別のrepo名・evidence名を使う。これは検証fixtureの準備であり、本repositoryではcommitしない。

```bash
mkdir "$OWNED/repo"
cd "$OWNED/repo"
git init -b main
git config user.name 'Test User'
git config user.email test@example.invalid
git config commit.gpgsign false
printf '# Example\n' > README.md
git --literal-pathspecs add -- README.md
git commit -m 'docs: add example'
printf '\nRun the example locally to read the guide.\n' >> README.md
```

unbornだけはbase commitのadd／commitを省略する。空diffだけは最後の追記を省略する。remote HEAD caseはbase commit後に下のfixtureを追加する。初回main push等の指示を加えない。通常はbranch名をpromptで誘導せず、実Skillにdiffから決めさせる。

観測はbefore／afterの両方で行う。Gitの非0がunborn等の期待された状態か、失敗かを区別する。例えば以下の取得をそれぞれcase証拠へ保存する（index未作成はその旨を記録）。

```sh
git symbolic-ref --quiet HEAD
git rev-parse --verify --quiet HEAD
git for-each-ref --format='%(refname) %(objectname) %(symref)'
git ls-files --stage -z | git hash-object --stdin
git --no-pager diff --cached --no-ext-diff --no-textconv --binary --no-color | git hash-object --stdin
git config --local --get-regexp '^branch\.'
```

`pipefail`を有効にし、完全bytesのdigestを比較する。成功commit後は`git cat-file commit HEAD`の親／treeと予定の内容、元branch ref、予定branchのupstream未設定を確認する。branch／commit停止caseはHEAD・全refs・index bytesがbeforeと同じことを確認する。cancelだけStageが残り得るのでHEAD・refs不変と新branchなしを期待する。helperの`operations.jsonl`でStage・branch・commit順序、判定根拠の再取得、通常承認の表示とfollow-up、禁止されるremote通信コマンドなしを照合する。Git objectだけで承認や通信なしを推測しない。

## 代表case

全直積にせず、標準経路で次を選ぶ。実際の`/skill:commit`呼出しと確認用follow-upは[RPC接続helper](../scripts/commit-rpc.py)を使う。

| case | setup／操作 | 期待・観測 |
| --- | --- | --- |
| main fallback・通常承認 | remoteなし、main、説明追加。`/skill:commit`→実提示後に`提示内容で実行` | main／情報なしfallbackと古い可能性を表示。未存在branch1件でcommit、元main ref不変、親はbase、upstreamなし。branch作成は承認後のみ |
| master fallback・no-confirm | remoteなし、master、説明追加。`/skill:commit --no-confirm` | main同様に作業branchへ。通常承認だけ省略し、検査・根拠表示・照合を実施 |
| local HEAD master／develop | 開始branchをmasterまたはdevelopにし、下のlocal remote HEAD setup。説明追加、no-confirm | 判別済みdefaultから作業branchを作り、元refとtracking refsを保持。remote通信なし |
| 作業branch | feature/docs上、remoteなし、説明追加、no-confirm | 同じbranchへcommit、新しいbranchを増やさない |
| default優先 | main上、local remote HEADはdevelop、説明追加、no-confirm | 一意なdevelopを優先しmainを作業branchとして維持、新branchなし |
| 候補競合 | main上、origin HEAD masterとbackup HEAD develop、説明追加、no-confirm。疑義に回答しない | Stageを含むGit変更前に候補／理由を表示して確認・未解決停止。HEAD／refs／index不変。originだけで選ばない |
| 空diff | main上、変更なし、no-confirm | branch・commit作成なし、refs／HEAD／index不変 |
| cancel | main上、説明追加。通常呼出し→実提示後に`キャンセル` | branch・commitなし。Stageが残ることを表示し、勝手にunstageしない |
| 互換master | master上、開始時PATHからPythonを除外。説明追加、no-confirm | probeでPython不足を確認して互換経路を明示、master fallbackから作業branchへcommit。scriptを試行しない。同じ親／tree／ref／upstream保護 |

### 通信なしのremote HEAD fixture

`REMOTE`はorigin等のfixture名、`DEFAULT`はmasterかdevelop。実接続のない`https://example.invalid/fixture.git`をlocal設定するだけとし、fetchはしない。base HEADをtracking refへ保存してsymbolic HEADを設定する。

```bash
git remote add "$REMOTE" https://example.invalid/fixture.git
git update-ref "refs/remotes/$REMOTE/$DEFAULT" HEAD
git symbolic-ref "refs/remotes/$REMOTE/HEAD" "refs/remotes/$REMOTE/$DEFAULT"
```

複数remoteが同じbranchなら一意として使える。逆解決の追加代表例ではremoteのfetch設定をexact mapping（remote側masterを別名tracking refへ対応）にし、末尾名ではなくremote branchを使うことを確認する。競合／壊れたsymbolic target／mapping不明は情報なしと混同しない。通信・自動補修をしてfixtureを成立させない。

## テストと追加保証

既存の`test_commit_scripts.py`の初回／通常branch作成・main/master/developの元ref保持・upstream非継承、不正名・衝突・hook改変・状態変化停止を再利用する。scriptテストはAgentのdefault判断を保証しない。明示新branch、unborn、壊れたref、複数remote同名・exact mapping等の追加caseは必要に応じて同じ実入口と観測方法で補う。基本の必須代表caseをこれで削らない。

`test_workflow_contract.py`は両経路の共有判定・表示・再照合・未導入案内の最小文書契約だけを確認する。runtime／Stage／diff／remoteの既存回帰suiteも適用する。正式4チェックとpack dry-runはCONTRIBUTINGに従いRootが最終差分で確認する。

## 証拠と終了

各caseからbefore／after、最小tool操作記録、期待との比較を辿れるようrun記録を作る。source版・dirty状態、Pi/Git/Python版、隔離と認証の限界、失敗probe・未確認を区別する。自作fixtureしか含まないことを確認し、秘密値・不要なraw logを保存しない。owned一時環境だけをcleanupし、証拠と参照を再確認する。失敗・未実行を成功にせず、Rootの独立再実行に必要な具体コマンドを残す。
