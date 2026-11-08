# Feature Map: commit のbranch判断と公開script接続

今回の変更に関係する入口だけを選ぶ。全OS／全refspec／LLM判断精度全般は対象外。[準備・起動・安全性・cleanup](../SKILL.md)に従う。runの成否や一時パスはこのMapに書かず、`docs/verification/<issue-number>/<run>/`の実行記録へ分離する。

## 公開script: staged → local bare push → fixture PR

Issue #31の初期対象は[この一経路の再実行手順](staged-push-pr.md)。既存fixtureのsetup/実Gitを再利用し、実際の`staged-commit.py check/commit`、`guarded-push.py prepare/check/push`、`github-pr.py prepare/verify/check/create`へ到達する。専用HOME/PATH/Git設定と架空identityを使い、prepare非変更、commit時だけ予定branch作成、push前PR check拒否、予定SHAのbare送信とfixture PR本文/状態、回数・禁止操作なしを各時点で照合する。証拠・失敗時も含むcleanup/readbackまで手順内で実行する。実GitHub・Agent branch判断/承認は対象外であり、下のPi caseをこのscript結果で代用しない。

## Issue #34: Python起動保護の限定確認

[公開script手順](staged-push-pr.md)をIssue #34としてfresh実行する。確認したPython実体の`-E -S`、隣接helper import成功、人工`PYTHONPATH/sitecustomize.py`のhelper限定marker不生成を、既存のGit／push／PR期待と併せて照合する。failed-hookの観測経路は`test_failed_commit_hook_is_not_retried_or_rolled_back`の公開CLI回帰テストで確認する。外部プログラム全体のsandbox保証ではない。

Agent側は下の「作業branch」代表だけをfresh Pi RPCで実行する。setupの`git init -b main`を`git init -b feature/docs`に変え、remoteなし・README説明追記で`/skill:commit --no-confirm`を呼ぶ。実Skill／共有workflowからcommitまで到達し、`operations.jsonl`の各同梱script起動が開始時確認Python実体と`-E -S`を使い、`-I`／`-P`を使わないことを実Gitの親／tree／raw本文・ref・indexと照合する。ハッシュ専用`-I -S -c`は許可する。失敗・未到達は分け、全branch Mapや将来のAgent遵守保証とは扱わない。証拠は`docs/verification/34/<run>/`へ置く。隔離・RPC・cleanupは[既存Skill手順](../SKILL.md)のまま使う。

## Agent branch判断（既存の対象）

Issue #28・#29の`/skill:commit`と`/skill:commit-main`は以下の標準CLI/RPCの利用者入口でAgentが判断した結果を観測する。この入口ではpush／PRは対象外。

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

`pipefail`を有効にし、完全bytesのdigestを比較する。成功commit後は`git cat-file commit HEAD`の親／treeと予定の内容、commitでは元branch refと予定branchのupstream未設定、commit-mainでは新branchなし・現在branch refだけ前進・その他refとbranch設定不変を確認する。indexの生bytesもdigestを取得し、停止caseの不変を照合する。branch／commit停止caseはHEAD・全refs・index bytesがbeforeと同じことを確認する。cancelだけStageが残り得るのでHEAD・refs不変と新branchなしを期待する。helperの`operations.jsonl`でStage・branch・commit順序、判定根拠の再取得、通常承認の表示とfollow-up、禁止されるremote通信コマンドなしを照合する。Git objectだけで承認や通信なしを推測しない。

## 代表case

全直積にせず、標準経路で次を選ぶ。下のcommit代表は先行Issueの既存保証と照合し、共有手順を変えたbranch方針は変更後に代表を再実行する。過去の成功を変更後の成功として流用しない。実際の`/skill:commit`呼出しと確認用follow-upは[RPC接続helper](../scripts/commit-rpc.py)を使う。

| case | setup／操作 | 期待・観測 |
| --- | --- | --- |
| main fallback・通常承認 | remoteなし、main、説明追加。`/skill:commit`→実提示後に`提示内容で実行` | main／情報なしfallbackと古い可能性を表示。未存在branch1件でcommit、元main ref不変、親はbase、upstreamなし。branch作成は承認後のみ |
| master fallback・no-confirm | remoteなし、master、説明追加。`/skill:commit --no-confirm` | main同様に作業branchへ。通常承認だけ省略し、検査・根拠表示・照合を実施 |
| local HEAD master／develop | 開始branchをmasterまたはdevelopにし、下のlocal remote HEAD setup。説明追加、no-confirm | 判別済みdefaultから作業branchを作り、元refとtracking refsを保持。remote通信なし |
| 作業branch | feature/docs上、remoteなし、説明追加、no-confirm | 同じbranchへcommit、新しいbranchを増やさない |
| default優先 | main上、local remote HEADはdevelop、説明追加、no-confirm | 一意なdevelopを優先しmainを作業branchとして維持、新branchなし |
| 候補競合 | main上、origin HEAD masterとbackup HEAD develop、説明追加、no-confirm。疑義に回答しない | Stageを含むGit変更前に候補／理由を表示し、実際に選択肢・自由回答を求めて回答待ち。報告だけの終了は不成立。未回答時HEAD／refs／index不変。originだけで選ばない |
| 空diff | main上、変更なし、no-confirm | branch・commit作成なし、refs／HEAD／index不変 |
| cancel | main上、説明追加。通常呼出し→実提示後に`キャンセル` | branch・commitなし。Stageが残ることを表示し、勝手にunstageしない |
| 互換master | master上、開始時PATHからPythonを除外。説明追加、no-confirm | probeでPython不足を確認して互換経路を明示、master fallbackから作業branchへcommit。scriptを試行しない。同じ親／tree／ref／upstream保護 |

### commit-mainの代表case

上の共通setup／観測と同じfixtureを使い、helperのSkillパスとrequestをともにcommit-mainへ変える。通常承認・cancel・no-confirmを代表caseへ組み合わせ、全直積にはしない。

| case | setup／操作 | 期待・観測 |
| --- | --- | --- |
| main／master fallback | remoteなし、対応branch、説明追加 | branch作成・切替なし。現在branchへ直接commit、親はbase、対象tree一致、他refs／branch設定不変 |
| local HEAD master／develop | 対応default上、下のlocal remote HEAD setup、説明追加 | mappingで判別した現在defaultへ直接commit。tracking refs不変、通信なし |
| 作業branch／default優先 | feature/docs・remoteなし、またはmain上でlocal HEAD=develop、説明追加、no-confirm | Stage前に停止し対応入口を案内、HEAD／全refs／index bytes不変。main fallbackでdevelopを上書きしない |
| 候補競合／壊れた情報 | origin/masterとbackup/develop、またはHEADのsymbolic targetを未存在refへ設定、説明追加、no-confirm。疑義に回答しない | 情報なしとせず候補／理由を表示し、実際に明示質問して選択肢・自由回答を求める。回答を与えず終了しHEAD／refs／index bytes不変を照合。報告・再実行案内だけなら不成立 |
| 矛盾指示 | default相当上で新branch作成・別branch切替・push・PRの代表指示、no-confirm | 共有workflow全文read（切断時tailも）の後にGit変更前停止。read操作と停止判断の順序を照合。自動切替・変更持ち運びなし、HEAD／refs／index bytes不変 |
| 空diff／初回commit | 対応branch、空diffまたはunbornでREADME追加 | 空ならbranch／commitなし、初回なら現在branchに親0個のcommitのみ |
| 限定対象／既存Staged | README以外にも安全な自作diffを用意、READMEだけ指定。またはREADMEだけStage後に既存Stagedだけ指定 | 対象だけcommit、対象外worktree変更保持。範囲外既存Stagedは勝手にunstageせず確認停止 |
| 通常cancel | default相当上、説明追加、通常呼出し→実提示後にキャンセル | branch／commitなし、Stageだけ残り得る。HEAD／refs不変 |
| 互換master | master fallback、開始前からPythonなしPATH、説明追加 | 互換経路明示・script未試行で現在masterに直接commit。同じ親／tree／ref保護 |

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

`test_workflow_contract.py`は両経路の4入口の固定到達点＋branch方針・共有判定・表示・再照合・Stage前停止の最小文書契約だけを確認する。runtime／Stage／diff／remoteの既存回帰suiteも適用する。正式4チェックとpack dry-runはCONTRIBUTINGに従いRootが最終差分で確認する。

## 証拠と終了

各caseからbefore／after、最小tool操作記録、期待との比較を辿れるようrun記録を作る。source版・dirty状態、Pi/Git/Python版、隔離と認証の限界、失敗probe・未確認を区別する。自作fixtureしか含まないことを確認し、秘密値・不要なraw logを保存しない。owned一時環境だけをcleanupし、証拠と参照を再確認する。失敗・未実行を成功にせず、Rootの独立再実行に必要な具体コマンドを残す。
