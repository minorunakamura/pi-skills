# 開発と詳細仕様

導入・基本操作は[README](README.md)を参照してください。

## commit 系 Skill の詳細仕様

| 入口 | 終点・branch・runtime |
| --- | --- |
| commit | ローカルcommit。default相当上なら未存在作業branchを承認後に作成。未移行Python経路 |
| commit-main | default相当の現在branchへ直接commit。branch作成・切替・通信なし。Bun標準経路 |
| commit-push | 必要なcommitとpush。PR APIなし。未移行Python経路 |
| commit-pr | 必要なcommit・pushと通常PR（明示Draft優先）。同一repository内のみ。未移行Python経路 |

到達点・branch方針は自由文で上書きしません。矛盾はStageを含むGit変更前に停止し、対応入口を案内します。固定文章・対象・言語・形式などの明確な指定を尊重し、引数全体を固定タイトルにしません。呼出し間で過去の承認は流用しません。

無指定はUntracked・既存Staged・部分Stageの残りを含む全変更（ignore維持）。限定literal paths／既存Stagedだけにも対応します。範囲外既存Stageを勝手にunstageせず確認し、dirty nested submodule内部を自動commitしません。Stageは最終承認前のため、**キャンセル・失敗でもStageが残り得ます**。reset／unstage／amend／force push／rebase／merge／release／deployはしません。空diffでは新commit・空commitを作りません。

完成文章と操作一式を通常assistantで表示し、一括承認／修正／cancelを扱います。作らない文章や操作の選択肢は出しません。明示no-confirmは通常承認だけ省略し、予定表示・検査・疑義の実質問・異常停止は維持します。ask_user_questionがなければ同じ選択肢を通常テキストで示し回答を待ちます。script成功や参照の存在は承認でありません。

### commit-mainのBun標準経路

[Skill](skills/commit-main/SKILL.md)から[同梱Bun手順](skills/commit/references/commit-main-bun.md)を全文読みます。Bun1.3.0以上の確認済み絶対実体で同梱TSを直接実行し、製品npm依存・build・Codemode・Pythonは不要です。probeもtrusted scripts cwd、空の同梱TOML／env-file=/dev/null／no-install、BUN_OPTIONS／NODE_OPTIONS除去、絶対entrypoint／対象repositoryを使います。tsconfig-overrideなし、対象欠落fallbackなし。通常Git設定・hooksは維持します。

開始時Bun不在の場合だけ[Python不要のlocal互換手順](skills/commit/references/commit-main-compatibility.md)を読みます。非対応version／起動異常／script開始後の失敗から切替・install・手書きmutationで迂回しません。互換は同じ利用者方針を手順で守りますが、標準CLIと同等の機械的ガードや速度を保証しません。

公開CLIはinspect→materials→plan→execute。必要な固定材料まとめ読取／release／cleanupだけを補います。defaultは全local remote HEADのsymbolic target／解決OIDと対応remote／順序付きfetch設定から**宛先→送信元**へ逆mappingします。一意default優先、真に情報なしの場合だけmain／master fallback。競合・broken・orphan・non-symbolic・不明mapping・観測不能を情報なしにせず、候補／理由を表示して実質問し、未回答はStage0。回答後も作業branchなら拒否します。通信・自動補修なし、Stage前／操作直前の根拠driftを拒否します。ローカル情報は古い可能性があり最新defaultを保証しません。

materialsで全Staged diffをGitleaks検査します。未導入だけunavailable、検出／失敗は停止。scanner／hook／子CLIの生出力・秘密値は会話へ流しません。小diffは一覧・本文・必要履歴を約32KiBの予算内で一括、大diffは未表示を明示して固定材料の必要複数範囲をまとめて読み、検査範囲を縮めません。不要diff／履歴payloadはどの質問前にも削除します。

完成文章は承認前にrepo外private directory0700／file0600へ排他的保持。owner／非symlink／regular file／実体／bytes digest・repo／runを照合し、修正時は旧版削除成功後だけ新参照を返します。executeは参照だけで文章／設定を再送せず、途中LLM判断／処理コード生成なし。通常hooks、raw本文（末尾LFなし入力への1 LF追加だけ許容）／全親／tree／branch ref／index／他refsを事後照合します。失敗／drift／成否不明で後続停止し、Git成功応答後の確認失敗・cleanup失敗を区別します。所有実体だけcleanupし未知sentinel／他実行は消しません。完全atomic性・任意強制中断時のcleanup／報告必達は保証しません。

### 他3入口は未移行

commit／commit-push／commit-prは[旧共有workflow](skills/commit/references/workflow.md)・[旧互換経路](skills/commit/references/compatibility.md)を維持します。Python3.14以上の開始時確認実体と-E -Sで同梱scriptを起動し、開始時Python不足の場合だけ既存Python-free経路を使います。新TSへ旧CLI／schema互換adapterは作りません。Python製品／tests／fixture／開発設定・CIと配布物は、この3入口に必要なため今回残しています。pack全体からPythonを除外しません。

旧経路の新commit承認後Codemode集約は[旧実行集約](skills/commit/references/execution-batching.md)。commitはdefaultから作業branch、pushはPR準備なし、PRはcommit前に必要準備を完了してからcommit→verify→push→PRへ進みます。既存HEAD／PR-only、既存PR非重複／非編集、通常main/default直接push禁止と明示初回main例外は変更しません。開始後fallback／retry／rollbackなし。旧性能3run条件を今回commit-mainへ流用しません。

### ローカルdefaultとbranch方針

利用者方針は両ローカル入口で同じですが、commit-mainは新CLIの機械的照合、commitは[旧共有手順](skills/commit/references/workflow.md#ローカルdefault判定)でのAgent判断です。一意なdevelopならmainは作業branchであり、mainという名前だけで直接commitしません。defaultへ自動切替せず未commit変更を持ち運びません。

直接確認は[検証Skill](.pi/skills/verify-project/SKILL.md)から[commit-main Bun手順](.pi/skills/verify-project/references/commit-main-bun.md)を選びます。fresh Piの通常承認／cancel／no-confirm／default実質問・未回答Stage0／Bunなしlocal互換と実Gitを照合します。他3入口は[旧集約手順](.pi/skills/verify-project/references/execution-batching.md)／[公開Python接続](.pi/skills/verify-project/references/staged-push-pr.md)を使います。共有RPC／metric helperはNode24で、legacy Codemodeだけ明示optionを付けます。model/thinkingは通常解決を記録し比較条件と照合、認証の独自read/copy/logは禁止。RPC通常テキスト承認はask_user_questionのTUI実証でありません。

単発の旧commit baselineと新commit-mainはbranch操作等の条件が違います。承認前／後／全体時間、利用者待機、全assistant request、生成codeと固定呼出し／payload、取得可能usage・失敗・unknownを分け、nested toolを二重加算しません。構造改善と時間効果を分け、同条件高速化や全4入口完成と呼びません。

#### 状態一覧の色付き表示

同梱の`extensions/commit-status.js`は、取得済みの状態JSONを表示するだけの`commit_status_display` toolを追加します。Git操作や`git-status.py`のJSONは変更しません。Pi packageとして導入した場合はmanifestの指定に従って読み込まれ、`/reload`後に使えます。Pi 1.3.0を対象としています。

絵文字ではないテキストの`●`だけを色付けし、状態名・ファイル名は通常色で表示します。このtoolは標準の色付き背景枠を使わず、通常背景に一覧を表示します。theme設定や他のtoolの表示は変更しません。

| 状態 | themeの色指定 | 標準darkでの色 |
| --- | --- | --- |
| Modified | `warning` | 黄色 |
| Untracked | `mdLink` | 青色 |
| Added | `success` | 緑色 |
| Deleted | `error` | 赤色 |

部分StageはStaged/Unstagedを分け、rename/copyは元パスも表示します。色は有効なthemeに従います。toolがない環境やTUI以外では通常のテキスト表示を使います。承認・検査の手順は変わりません。

スキルだけをsymlinkで導入している場合は、cloneしたリポジトリのルートから表示extensionもリンクできます。既存ファイルは上書きしません。

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/commit-status.js" ~/.pi/agent/extensions/commit-status.js
```

その後Piで`/reload`を実行してください。

## 開発時の検証

開発にはmiseとGitを使います。Node24・Bun1.3.0・pnpm、および未移行3入口に必要なPython3.14系・uv・Ruff・tyを`mise.toml`で固定します。pytest 9系は開発用依存として`pyproject.toml`と`uv.lock`で管理し、uvが`.venv`に導入します。miseを有効化したshellで次を実行してください。

```bash
mise install
pnpm install --frozen-lockfile
mise exec -- uv sync --locked --python python
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
```

`pnpm lint`はoxlint + oxlint-tsgolintのtype-aware lint（--type-aware --deny-warnings）と既存PythonのRuff。`pnpm typecheck`はtsc --noEmitとty、formatはBiome専用（linter/assist無効）とPythonのRuff、testはNode24標準node:test／node:assertのTS直接実行・既存JS tests・pytestです。製品TS・tests・fixture・隠し`.pi/skills/verify-project/scripts` helperを収集し、最寄りtsconfigを整合します。warningはsource修正で0にし、quiet／一括disable／除外で隠しません。devDependenciesとlockはexact version固定、追加製品npm依存はありません。Node/Bun用build成果物は作りません。Python設定／uv.lockの撤去は残3入口の移行後です。

pytestでは`tmp_path`・共通fixture・`parametrize`・`monkeypatch`を使い、一時Gitリポジトリとbare remoteでstatus解析、部分Stage、Gitleaks検査、状態変化時のcommit/push拒否、main保護と初回登録の例外、PRの本文・Draft・重複防止、認証・通信エラーとtimeout時の再試行禁止などを検証します。Gitleaks・gh・SSHはテスト用の実行ファイルで再現するため、実行時には不要です。実remoteやGitHubには接続しません。回帰テストはGitとPOSIX環境を対象とします。表示extensionのNode.jsテストはPi提供moduleの境界だけをstubにし、色の割当て、部分Stage・rename・競合、制御文字のescape、不正JSONの拒否、TUI以外の表示を確認します。Pi本体の追加installや外部接続は不要です。Pi提供moduleはoptionalなpeer dependencyとして宣言し、`pnpm-workspace.yaml`でpeerの自動installを無効化して、開発時にもSDKを二重導入しません。

### 変更対象から検証を選ぶ

件数ではなく、変更した保証・具体的な回帰リスク → 公開seam → 必要最小限の前提 → 実操作と観測の順に選びます。既存テストを優先し、対象と無関係なhistory・remote・後続操作を準備しません。ただし対象の接続・状態遷移は実際に通し、内部setterや成功固定のmockで実Git取得・操作を代用しません。負例は正常例との差分が拒否対象だけであることと期待errorを照合します。

| 変更箇所・理由 | Workerの対象例と直接確認 |
| --- | --- |
| commit/index・branch作成・raw message照合 | `test_commit_scripts.py`の変更した契約と正常/拒否代表。親・tree・raw message、元ref・index bytes/mode・upstreamを実Gitで照合。Agentのdefault判断・確認対話を変えた時だけ既存branch Mapの関係caseも実Skill入口で確認 |
| push/PRのprepare・照合・状態遷移 | `test_remote_scripts.py`の変更した群＋同じ公開経路の正常/拒否代表。staged経路なら`test_pr_prepared_check_accepts_only_planned_push_and_git_mapped_refs[standard]`、push前verifyの区別なら`test_pr_verify_accepts_actual_commit_before_push_but_is_not_create_check`。existing-headや通常push/check・PR/checkの変更にはそれぞれの既存代表を選び、stagedだけで代用しない |
| remoteの宛先・fetch mapping・drift・失敗処理 | 変更したガードの既存正常/拒否node IDを選ぶ。SHA固定・main/default保護・余分なrefs非送信、Git自身のmapping/実object、各hook/check前後の安全時点、失敗後の非retry/非rollbackなど異なる保証を同じ判定として削らない。実2MiB等が対象なら実物の限界を確認 |
| 共通fixture/接続wrapper | 実callersを検索し、影響する`test_remote_scripts.py`、`test_commit_scripts.py`、`test_diff_review.py`、`test_stage_workflow.py`等へ広げる。共有状態や巨大fakeへ移さない。fixture未変更なら無関係な群へ一律に広げない |
| 承認後Codemode集約 | `test_workflow_contract.py`の最小契約、runtime/diff関係回帰、prepared正常接続・verify非実行用とpush/PR失敗・timeout非retry代表。上記の実Agent手順で操作遵守/構造/実状態を別途照合し、文言assertやscript成功で代用しない |
| workflow/文書契約・runtime/Stage/diff・表示extension | 関係する既存`test_workflow_contract.py`、`test_runtime_selection.py`、`test_stage_workflow.py`、`test_diff_review.py`、Nodeテスト等を選ぶ。文言/形式検査はAgent動作や実操作の証拠とは分ける |
| 検証Skill/Map/手順 | 変更した参照・構文/assertと、その手順で選んだ機能の実操作・証拠・cleanup/readback。公開script接続は[staged → local bare push → fixture PR](.pi/skills/verify-project/references/staged-push-pr.md)。branch判断MapとRPC helperは別入口として保持し、script結果をAgent判断成功と呼ばない |

例えば公開scriptの再実行手順だけの変更なら、その新しい隔離経路と関係する正常/拒否代表を選び、全remoteや全branchのPi sessionは起動しません。共通fixtureを変えた場合だけその実callersへ対象を広げます。選んだnode ID/経路と理由、維持する保証、未確認範囲をrun記録に残してください。通常の関連更新に全Map実行やMaintainは不要です。

### Worker / Root / Reviewer の分担

- **Worker**: 変更したテスト群・実callers・対応する実Git正常/拒否代表を実行します。変更対象、選択理由、コマンド/exit、期待と観測、未確認、証拠・owned環境のcleanupを報告します。全remote・広い非remote回帰・正式全suite・全Mapを無条件には要求しません。非自明なhelperには最小assert self-checkと実手順の実行を残します。文書整理・既存テスト再構成にはTDDを一律要求しませんが、検証不要にはしません。
- **Root**: 各Work Itemの最終差分で`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、全収集の`pnpm test`を自ら実行します。配布文書/参照変更では`npm pack --dry-run --json --ignore-scripts`も確認します。正式testの件数・pass/fail/skip・pytest時間・外側wall timeを記録します。Workerとは新しい隔離状態で変更に対応する公開CLI/実状態を独立に直接確認し、全完了条件を受け入れます。手順変更ではWorker実行後、履歴・前回の一時path・稼働processなしで手順だけから再実行します。Workerの全操作や過去の全シナリオの丸ごと反復は不要で、一つの直接実行で複数条件を満たして構いません。
- **Reviewer**: sourceと変更前後の保証対応、期待error、負例の成立、隔離と証拠を点検し、疑義のある対象だけ追加実行します。Reviewごとの全suite/全Mapは不要です。**独立ReviewとCode Reviewの明示承認は省略しません**。最終受入れはRootが行います。

source再変更後は該当検証と最終チェックを更新し、以前の結果/Approveを流用しません。同じ最終差分の性能確認だけを理由に全suiteを2回実行せず、固定の短縮率や秒数を合否条件にしません。旧Plan・CLOSED Issue・既存証拠は保持し、昔のwrapper性能比較や過去の全代表を無条件の再実行義務にしません。

証拠は既存ignore対象の`docs/verification/<issue-number>/<一意なrun>/`へsource版/dirty状態・環境・入口・操作・期待と観測・未確認・cleanupを最小限保存し、記録から全証拠へ解決可能な参照を置きます。専用HOME/PATH/Git設定、架空identity、無秘密の入力と独立repositoryを使い、ambient credentials・利用者設定・実remote/実GitHubから隔離します。成功失敗とも所有した一時環境/PIDだけcleanupし、証拠を残して全参照を実readします。無断install、既存設定変更、証拠の自動公開はしません。全体のremoteテスト軽量化・性能比較はこの手順整備と別の成果であり、手順追加だけで実施済みとしません。

### 検証 Skill の形式検査と直接確認

[create-verification-skill](skills/create-verification-skill/SKILL.md) と [maintain-verification-skill](skills/maintain-verification-skill/SKILL.md) の形式・参照は `tests/verification-skills.test.js` で限定して検査します。frontmatter の名前・英語 description・明示呼び出し設定・license と、今回追加した Markdown 相対参照の解決を Node.js 標準 test runner で確認します。既存の `tests/*.test.js` 収集に含まれ、新依存や汎用 Markdown validator は不要です。

```bash
node --test tests/verification-skills.test.js
pnpm exec oxlint --type-aware --deny-warnings tests/verification-skills.test.js
pnpm exec biome format tests/verification-skills.test.js
```

この検査は Agent の実動作、安全性、検証結果の正しさを保証しません。本文の契約も確認し、最終差分で上記の正式4チェックと `npm pack --dry-run --json --ignore-scripts` を実行して、両 Skill の `SKILL.md` と共有する `skills/create-verification-skill/references/pstack.md` の同梱を確認します。今回の Markdown・形式検査に TDD は採用しませんが、必要な検査・直接確認は省きません。

直接確認には、ネットワークや利用者の実データが不要な扱いやすい既存 local CLI の隔離コピーを優先します。適切な対象がなければ、既存 runtime だけで動く二つの利用者向け操作を持つ最小の disposable fixture を使います。恒久 fixture や新しい runner は追加しません。

1. 対象の Pi 版を記録し、共通 Create / Maintain の検出と明示呼び出しを確認します。実際に Create を実行し、初期対象・対象外、生成先、通知、少なくとも一機能の実操作・観測・証拠を確認します。全 Map 実行を初回の成立条件にしません。
2. fresh Pi session に生成資産の場所と今回選ぶ機能だけを渡し、会話履歴・前回の一時絶対パス・生存 process なしで再実行します。project trust と標準探索または明示読み込みを使い、新しい証拠を確認します。自動選択の確率評価はしません。
3. 隔離対象の一機能の入口を変え、関連する手順・helper・Map だけを更新して再実行します。無関係な全 Map 実行や Maintain を要求しないことを確認します。
4. 同じ隔離対象に限定的な古い手順を残し、ユーザーの明示呼び出しで Maintain を実行します。全 Map の対応 source と利用者の入口からの実操作を確認し、劣化した検証資産だけを修正して再実行することを確かめます。
5. 同じ隔離対象に製品不具合と前提不足を順に与えます。Maintain が実際に経路を試して機能ごとの失敗・未確認と理由を区別し、製品を直さず期待値を緩めずに証拠を報告することを確認します。失敗後の cleanup と証拠保持も確かめます。

生成物の通知・License 方針の直接確認には、上記1・2を次の条件で使います。

- 新規生成: License を宣言する規約・第三者素材・既存検証資産のない隔離 CLI を用意し、改訂 Create を明示的に実行します。通常の依頼として初期 Map に保存・表示を含め、今回は保存だけ実操作し、製品 source は変更しないことを指定します。期待する通知・License の結論は追加 prompt で誘導せず、生成された Skill / Map を直接読み、`references/pstack.md` とそれを前提としたリンク、生成元由来の `license: MIT` がないことを確認します。この規約のない代表例では License 未指定を許容します。
- fresh reuse: 前回の会話や一時状態を渡さず、生成資産から保存だけを再実行します。新しい証拠・実操作結果・cleanup に加え、不要な通知・MIT が再追加されないことを確認します。

第三者素材を実際にコピーする場合の必要な通知と既存資産の通知・License の保護は、本文・差分でも確認します。この代表例だけで全プロジェクトの規約追従や第三者素材転用の法的十分性を実証したとは扱いません。

成功・失敗のいずれでも、自分が作った instance と状態だけを後始末し、証拠は残します。各段階で後始末後にも実行記録とリンク先が読めることを確認し、移動する場合は移動後も参照を解決できるようにします。記録には source 版・dirty 状態、前提、操作、期待と観測、成否・未確認範囲、必要なログへの参照を残します。取得前の機密性確認と対象 repository の証拠・ignore 方針を守り、秘密情報や不要な raw log を保存しません。最終受入れは Root が操作結果・source 差分・記録を照合して判断します。直接確認できなければ理由を報告し、文書生成だけを成功としません。

実証は選んだ CLI / Pi 環境と代表シナリオに限ります。browser、TUI、長寿命 service、共有 instance、全 OS、実 Taskflow 結合、製品不具合一般の分類精度、秘密情報全般の自動検出は同等に実証したと扱いません。Maintain はユーザーの明示実行だけを対象とし、Taskflow から自動実行しません。

## CI

`.github/workflows/ci.yml`で、PRの作成・更新とmainへのpush時にUbuntu上で同じlint・型検査・format確認・Node TS/JS testsとpytestを実行します。依存は`pnpm install --frozen-lockfile`と`uv sync --locked`で固定し、Pythonはmiseで選ばれた実行ファイルを使います。Actionはcommit SHA、mise本体もバージョンを固定しています。

権限は`contents: read`のみで、checkoutの認証情報は永続化しません。実GitHubへのpush・PR作成や個人の認証情報は不要です。CI成功をmerge条件にする場合は、workflowとは別にGitHubのRuleset等で必須チェックを設定してください。
