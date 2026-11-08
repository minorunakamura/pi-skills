# 開発と詳細仕様

利用者向けの導入・基本操作は [README.md](README.md) を参照してください。

## commit 系 Skill の詳細仕様


```text
/skill:commit
/skill:commit-push
/skill:commit-pr
```

**到達点はSkill名で固定です。** `/skill:commit`はcommit、`/skill:commit-push`はpush、`/skill:commit-pr`はcommit → push → 通常PRまで進めます。無指定ではrepository全体の全変更をStageします。 Untracked、既存Staged、部分Stageの残りも対象です（通常のignoreは維持）。従来の`commit`はPRまで進みましたが、現在はローカルcommitで止まります。Stageは最終確認より先に実行するため、**キャンセル・失敗でもStageが残り得ます**。勝手にreset／unstageしません。

引数は固定タイトルではなく、対象・branch／宛先・文章・言語・Draftへの要望などの自由文です。明確な指定を聞き直さず反映します。「このタイトルをそのまま使う」と明示すれば、その文章を維持します。到達点と矛盾する自由文（例：`/skill:commit pushまで`）はGit変更前に停止し、対応Skillを案内します。同じ到達点を重ねても矛盾ではありません。

```text
/skill:commit READMEの説明を整理した変更として日本語で
/skill:commit-push 既存Stagedだけ
/skill:commit-pr Draft。skills/commitだけを対象に、Refs #17を記載
/skill:commit --no-confirm
```

段階実行もできます。各呼出しはその時点の状態・送信履歴・PR全体を改めて確認し、過去の承認は流用しません。

```text
/skill:commit
/skill:commit-push
/skill:commit-pr
```

Stage後の対象差分がなければ新commit・空commit・amendは作りません。commitは操作せず終了し、push／PRは既存HEADから残りへ進みます。HEADも対象差分もなければ送信なし。同SHAの重複push、OPEN/CLOSED/MERGEDの既存PRの重複作成・自動編集はしません。呼出し間に新たな対象変更があれば新commitを作ります。対象外の未Stage変更を勝手に送信へ取り込まず、既存HEADで送信する場合はbranchの既存履歴全体が対象だと示します。

- 必要な項目だけ通常は完成形commitメッセージ、ブランチ全体を対象にしたPR title/body、対象範囲、branch作成、remote／実push URL／target、送信する既存commit＋今回のcommit、upstream、base/head、通常／Draft、Closes/Refsを**一回の確認**で提示します。「提示内容で実行／commitのみ修正／PR・実行設定を修正／キャンセル」と自由入力を使い、片方だけの文章修正では他方を保持して最終一式を再確認します。作成しないcommit／PRの文章や存在しない項目の修正選択肢は出さず、全操作完了済みなら通常承認も求めません。
- `--no-confirm`は通常の内容確認・実行承認だけを省略します。予定内容・結果の報告、Gitleaks、照合、疑義の確認、異常時の停止は省略しません。scriptに承認省略フラグを渡すものではありません。
- pushを伴いmain／remote default上なら、新しい作業branchを1件計画して一括確認に含めます。`--no-confirm`ではその予定branchを自動作成します。不正名・衝突では停止し、既存branchへ勝手に切り替えません。main上の既存commitも同HEADから作業branchへ載せられますが、元mainを巻き戻さずローカルmainにもcommitが残ると報告します。初回main push例外はcommit-pushだけで、明示指示・リモート全体が空・送信元／宛先mainが必要で、`--no-confirm`だけでは許可しません。
- `commit`はremote準備なし、`commit-push`はPR準備なし。PRまでの指定でgh・認証・remote／base等の準備に失敗したら**新commit／push前に停止**し、無断で範囲を縮小しません。限定範囲外のStagedがあれば勝手にunstageせず停止・確認します。submodule内部の変更も親から自動commitせず停止します。
- Python 3.14以上がPiから使える場合は同梱scriptを優先し、開始時probeで未導入・3.13以下と分かった場合だけ[Python不要の互換経路](skills/commit/references/compatibility.md)を使います。両経路の範囲・一括確認・許容遷移・停止条件は同じですが、互換経路はLLMの手順遵守に依存し、scriptと同等の機械的ガードは保証しません。特殊名等を安全に処理できなければ停止します。
- 経路選択はGit変更前の開始時だけです。Python起動失敗・不正応答は停止し、script実行後の検査失敗・状態不一致・認証／通信エラー・timeout等から互換経路へ切り替えません。Pythonや別runtimeの自動install・PATH変更はしません。追加Python packageも不要です。
- 3入口は[共有workflow](skills/commit/references/workflow.md)を全文読みます。scriptは入口でなく`skills/commit/`基準で、対象repositoryをcwdのまま実行します。標準経路は`git-status.py`、`staged-commit.py`、`guarded-push.py`、`github-pr.py`を使います。Stage後にcheck、必要なpush／PR prepareをcommit前に取得し、最終確認後にcommit → PR verify → push check／push → PR check／createと照合します。既存HEADは`prepare --existing-head`→承認→予定branch作成（必要時だけ）→verify／checkへ進み、commitCheckやcommit結果と混在させません。push済みからPRだけなら通常PR checkを使います。準備JSONは実行用checkやユーザー承認ではなく、手書き更新・永続承認DBは使いません。
- diffは概要から必要箇所へ読み、commitと予定PRで全5フィールドが一致する変更単位の理解を再利用します。完全bytesのdigestは機械的に照合し、同じ本文を再読しません。一時diffはrepository外のprivate directory（`0700`）内に`0600`で保存し、不要になったら**どの質問よりも前に**削除成功を確認します。
- Gitleaksがあれば全Staged差分を検査し、未導入なら未検査と報告します。検査失敗やbranch／parent／tree／raw本文／indexの不一致ではpushせず停止します。秘密値・scannerの生出力は表示しません。
- PRはブランチ全体の差分・履歴・テンプレート・確認できたissueを根拠にし、実行したテスト結果だけを記載します。認証済み`gh`が必要で、同一repository内のみ対応します。SSH host aliasはOpenSSHで解決し、fork間PR・独自SSH commandは扱いません。既存PRはOPEN/CLOSED/MERGEDとも重複作成・自動編集しません。
- 必要objectがなければ自動fetchせず停止します。同時に他プロセスからGitを変更しないでください。照合と操作は非atomicで、hook副作用や通信断による部分成功・成否不明は残ります。失敗時は照会だけを行い、自動再試行・rollbackしません。
- reset、amend、force push、rebase、merge、release、deploy、PR自動mergeは行いません。

### ローカルdefaultとbranch方針

`/skill:commit`はdefault相当上なら、Stage後のdiffの主目的から未存在の作業branchを1件計画し、通常の一括承認後のcommit時だけ作成します。作業branch上では現在branchを使い、明示新branch指定は維持します。不正名・衝突は停止し、既存branchへの自動切替・上書きはしません。対象diffなしではbranch・commitとも作らず終了し、初回commit前にも同じ方針を適用します。defaultへの直接commit指示ではGit変更前に停止し、branch作成を迂回しません。直接ローカルcommit用の`/skill:commit-main`は後続Work Itemで提供予定で、現在は未導入です。入口は引き続き3つ、配布Skillは7つです。

判定の詳細は[共有手順のローカルdefault判定](skills/commit/references/workflow.md#ローカルdefault判定)に一箇所で定義し、Python不要の互換経路も参照します。

- local remote HEADのsymbolic refと対応するremote／fetch設定から、宛先tracking refをremote側のbranchへ逆解決します。複数remoteが同じbranch名へ解決できれば利用できます。一意に判別できたdefaultを優先し、例えばdevelopならmainという別branchは作業branchです。
- remote HEAD情報が存在しない場合だけmain／masterをdefault相当とするfallbackを使います。remote未設定・unbornにも適用します。upstream、存在branch、`init.defaultBranch`、古い会話は根拠にしません。
- 候補の競合、壊れたref、対応不明・安全に解釈できないmappingは情報なしと混同せず、理由を示して確認し、未解決ならStageを含むGit変更前に停止します。origin名だけで選ばず、`--no-confirm`も疑義解消を省略しません。
- 判定の通信・設定補修はしません。今回の根拠を保持しStage前と操作直前に再取得・照合して、変化なら停止します。判定根拠とローカル情報の古さを予定内容に示します。remoteの最新defaultは保証しません。これはAgentの手順であり、新しいscriptガードではありません。永続stateは作りません。

標準経路は既存の`staged-commit.py check --branch NEW`とcommit APIを使います。checkではbranchを作らず、承認後のcommit時だけ`--no-track`で作成します。元defaultの既存refを進めず、upstreamも暗黙継承しません。既存Stage・ignore・対象・Gitleaks・diff・状態照合・detached／競合／submodule停止、失敗後の経路切替・自動再試行・rollback禁止は両経路で維持します。Stageはキャンセル時にも残り得ます。branch作成とcommitは非atomicで、失敗時にbranchだけ残る場合もあります。push／PRのremote default確認・直接push禁止・初回main push例外・既存HEAD処理は変更しません。

#### branch判断の直接確認

[プロジェクト検証Skill](.pi/skills/verify-project/SKILL.md)と[Feature Map](.pi/skills/verify-project/references/feature-map.md)に今回のbranch判断だけの再実行手順を置きます。Piの新セッションまたは`/reload`とproject trustを確認し、`/skill:verify-project commitのbranch判断`、または実ファイルの明示読み込みで使います。隔離repository／HOME／Git設定と架空identityを使い、変更後の実Skill入口から実行します。文言assertやscript単体実行をAgent判断の実証にしません。標準経路のmain／master fallback、local remote HEAD master／develop、作業branch、判別済みdefault優先、候補競合、空diff、一括承認／cancel／no-confirmと、開始時Python不足での互換経路master fallbackを代表確認します。before／afterのbranch・HEAD・refs・index・親・treeと最小tool操作記録を照合し、remote通信追加なしを確認します。

証拠とrun記録は既存ignore対象の`docs/verification/28/`等へ保存し、Mapの手順と分けます。秘密情報・不要なraw logは保存せず、認証は正常なPiの方法だけを使います。利用者設定は変更せず、作成した一時環境だけcleanupし、その後も証拠参照を確認します。既存script統合テストと正式チェック、Rootの独立再実行・受入判断を代替しません。

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

開発にはmiseとGitを使います。Python 3.14系・uv・Node.js・pnpm・Ruff・tyのバージョンは`mise.toml`で固定します。pytest 9系は開発用依存として`pyproject.toml`と`uv.lock`で管理し、uvが`.venv`に導入します。miseを有効化したshellで次を実行してください。

```bash
mise install
pnpm install --frozen-lockfile
mise exec -- uv sync --locked --python python
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
```

`pnpm lint`はPythonにRuff、表示extensionとNode.jsテストにBiomeを使います。`pnpm typecheck`はPythonをtyで検査し、`pnpm format:check`はBiomeとRuff、`pnpm test`はNode.js標準のtest runnerとpytestを実行します。`pnpm lint:fix`でRuffの自動修正、`pnpm format`で整形を適用します。BiomeはJSON・JavaScript等のformatに使います。Ruffの`target-version`とtyの`python-version`も3.14に合わせています。型検査はscript・テスト・fixtureを含み、診断の一括無効化やテスト除外はしません。これらは開発用です。同梱scriptはPython標準ライブラリだけを使い、互換経路はPythonを必要としません。

pytestでは`tmp_path`・共通fixture・`parametrize`・`monkeypatch`を使い、一時Gitリポジトリとbare remoteでstatus解析、部分Stage、Gitleaks検査、状態変化時のcommit/push拒否、main保護と初回登録の例外、PRの本文・Draft・重複防止、認証・通信エラーとtimeout時の再試行禁止などを検証します。Gitleaks・gh・SSHはテスト用の実行ファイルで再現するため、実行時には不要です。実remoteやGitHubには接続しません。回帰テストはGitとPOSIX環境を対象とします。表示extensionのNode.jsテストはPi提供moduleの境界だけをstubにし、色の割当て、部分Stage・rename・競合、制御文字のescape、不正JSONの拒否、TUI以外の表示を確認します。Pi本体の追加installや外部接続は不要です。Pi提供moduleはoptionalなpeer dependencyとして宣言し、`pnpm-workspace.yaml`でpeerの自動installを無効化して、開発時にもSDKを二重導入しません。

### 検証 Skill の形式検査と直接確認

[create-verification-skill](skills/create-verification-skill/SKILL.md) と [maintain-verification-skill](skills/maintain-verification-skill/SKILL.md) の形式・参照は `tests/verification-skills.test.js` で限定して検査します。frontmatter の名前・英語 description・明示呼び出し設定・license と、今回追加した Markdown 相対参照の解決を Node.js 標準 test runner で確認します。既存の `tests/*.test.js` 収集に含まれ、新依存や汎用 Markdown validator は不要です。

```bash
node --test tests/verification-skills.test.js
pnpm exec biome lint tests/verification-skills.test.js
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

`.github/workflows/ci.yml`で、PRの作成・更新とmainへのpush時にUbuntu上で同じlint・型検査・format確認・pytestを実行します。依存は`pnpm install --frozen-lockfile`と`uv sync --locked`で固定し、Pythonはmiseで選ばれた実行ファイルを使います。Actionはcommit SHA、mise本体もバージョンを固定しています。

権限は`contents: read`のみで、checkoutの認証情報は永続化しません。実GitHubへのpush・PR作成や個人の認証情報は不要です。CI成功をmerge条件にする場合は、workflowとは別にGitHubのRuleset等で必須チェックを設定してください。
