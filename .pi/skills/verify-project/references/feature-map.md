# Feature Map: commitのbranch方針・承認と公開script接続

今回の変更に関係する入口だけを選ぶ。Mapは再利用する手順と期待であり、run結果／一時pathを混ぜない。観測は`docs/verification/<issue-number>/<一意run>/`へ分離する。全OS／全refspec／LLM判断精度全般／実GitHub／任意中断保証は対象外。[分離・証拠・cleanup](../SKILL.md)と各専用手順を使い、全Map／Maintainは要求しない。

## 専用toolの取得・表示

[commit_inspect手順](commit-inspect.md)でfresh setupからmodel-only toolをmodelに直接呼ばせる。部分Stage／renameを実Gitと照合し、content末尾JSONとdetailsの完全一致・同じBun/referenceの後続cleanup・Git不変を確認する。実TUIは次assistant本文より前の一覧snapshot・重複なし・dotのみ色、reload後の過去details描画と新callだけの再inspectを観測する。RPCとprint／JSONは色なし一覧と完全判断材料、通常cancelは参照前後をmarker／公開updateで区別しcleanup報告と実状態、Bun不足はGit変更前停止・fallback0を確認する。色失敗／不正応答は限定testで分離する。

`commit_workflow` の[短い表示と展開](commit-inspect.md#commit_workflowの短いtui表示と展開)は同じowned tmuxで大きいread結果を実際に折り畳み→展開→折り畳み、長い引数・payloadの通常非表示と詳細保持を照合する。失敗の実表示、部分成功／cleanup未完了・未確認の要約と完全content不変の公開renderer testsも使う。RPCをTUI実証と呼ばず、Git操作・検証・承認契約は変えない。

証拠は時刻付き実PTYセルsnapshot（物理screenshotでない）・必要tool結果・版／dirty／digest／exit／unknown／metricと所有PID wait／group・server不存在／owned cleanup／全参照readback。専用tool単独成功で4入口の接続・release・同ターンreadやW2前後比較を保証しない。

## 4入口のW2接続・往復削減

[共有W2照合](local-bun.md#w2-通常skill接続readrelease分岐の照合)を通常extension有効のfresh Skillから行う。同ターン全文read一式／tail／PR > push > local、新tool直接1回・完全結果／同Bun引継ぎ・重複なし、独立releaseなしの直接plan・payloadRemovedと6 bin不在（recent-history.binを含む）、疑義質問前release成功・新reference、PR中間非実行可能→新参照で文章補完、終了cleanup・不要承認なし、失敗／削除拒否の停止・残存を観測する。CLI assertionsや文言testをAgent動作実証にしない。無extension対照は別freshで維持し、開始後失敗のfallbackにしない。

性能比較を選ぶ場合だけlocal／PR各1組の同条件baseline/finalを同じ固定helperで比較する。旧表示extensionは当時sourceを明示し、新toolへ差し替えない。全assistant request／turn read／probe／inspect転記／release／payload bytesを手分類し、LLM・tool・利用者待機／usage／unknownと実TUI描画時刻を分ける。秒数／固定短縮率を合否にしない。

## commit / commit-main Bun標準入口（現行）

[共有local手順](local-bun.md)から必要な公開CLI／fresh Pi代表を選ぶ。Git／Node24／Bun1.3.0+／Piの既存実体、正常認証、macOS sandbox、専用HOME/PATH/TMPDIR/Git設定と架空identityでfresh setupする。source書込拒否／owned書込成功と起動前manifest固定、同じ親shellのPID記録／waitを行う。

| 機能と入口 | 前提・実操作 | 期待・観測 |
| --- | --- | --- |
| default→新branch・通常承認 | remoteなしmain、README小diffと対象外untracked。`/skill:commit README.mdだけ`、完成提示を読んで同じsessionへ実回答 | 材料の意味から未存在作業branchを計画。承認前はmainだけ・Stage済み・payload削除済み、承認後にだけbranch作成。元main ref不変・親=元HEAD・予定tree/index/raw本文一致・新branch upstreamなし・対象外bytes保持・通信0 |
| 作業branch維持・no-confirm | feature/docs、同じ小diff、`/skill:commit --no-confirm` | 現在branchだけ前進し新branchなし。通常承認だけ省略、予定表示／保持／全Staged検査／照合は同じ |
| default優先・明示新branch | local HEAD=developで現在main、または明示新branch。公開CLI inspect(mode=commit)→materials→plan→execute | 一意default優先でmainを作業branchとして維持。明示未存在名は保持し、upstreamを暗黙継承しない |
| 形式・衝突・設定残存 | 公開CLIで不正名／同名／prefix衝突（dangling symbolic branch含む）／upstreamが付く残存remote＋merge設定、plan後dangling導入と直前ref/config drift | 明示名はStage前、生成名はplan時、plan後danglingはexecuteのbranch作成前に拒否。HEAD／index／raw symref保持・不要referent未存在。既存branchへ切替・上書きしない。設定削除なし。無関係な片側設定だけは正常対照。直前driftはbranch作成前に停止 |
| 空diff・unborn・cancel | 公開CLI空diff／初回commit、fresh Pi通常承認待ち→キャンセル | 空diffはbranch/commit/通常承認なし。初回は親0、元default ref未存在保持。cancelはbranch/commitなし、Stageは残す、owned privateだけcleanup |
| default疑義 | local HEAD候補競合またはbroken、`/skill:commit --no-confirm`、回答しない | 候補／理由と実default質問＋自由回答を表示、未回答Stage0、HEAD/refs/index不変、通信・補修なし。停止報告だけで代用しない |
| commit-main直接 | default相当main、`/skill:commit-main` | 現在default refだけ前進、新branch／切替なし。作業branch／矛盾はStage前停止・対応入口案内 |
| branch作成後停止 | 公開CLI、通常post-checkout hookがbranch/index/他refを変更または非0 | commitへ続けない。branch作成済み先行成功／成否不明／cleanupを区別しrollbackしない |
| Bun必須・Git変更前停止 | 起動前からBunなしPATHで絶対Node観測者、fresh Pi commit／commit-main各入口（no-confirm含む）。非対応／不正probeは共有経路の代表 | 必要条件Bun 1.3.0以上の案内、index bytes／HEAD／全refs／branch／upstream／worktree不変、Stage／送信／PR0、Python／手書きmutation／install未試行。version応答fixtureはAgent停止分岐のみ、実旧Bun実証でない |

共有のscope／部分Stage／literal `.`／特殊名／submodule／全Staged scanner／hooks／private差替え・所有外保持、default逆mapping・broken・観測不能・必要checkpoint drift、固定文章修正と旧参照拒否、execute上書き拒否、暗黙fetch禁止／merge拒否／scanner起動失敗は`tests/commit-workflow.test.ts`の実Git＋Bun公開JSONを使う。廃止した互換捕捉例の秘密出力抑制／Git失敗後停止／private・cleanup保護は、このBun公開CLIのscanner／hook／子CLI失敗とprivate差替え／未知sentinel検証で維持する。`tests/verification-skills.test.js`は文書／参照契約のみでAgent動作実証ではない。内部handler成功mockで接続を消さない。

証拠は共有local手順どおりsource版／dirty／digest、環境、操作／command exit、期待／実Git観測、全assistant requestと前後／全体／待機時間・生成code／固定呼出し／payload／usage、失敗・unknownを記録する。旧commitと新commitの1組比較は同じ小diff／history／明示文章／通常承認／通常解決modelで行い、単発速度証明としない。owned group終了／wait／不存在→owned環境cleanup→全証拠参照実readまで行う。RPC通常テキスト承認をTUI通過と呼ばない。

## commit-push Bun必須／runtime停止（現行）

[push専用手順](push-bun.md)でfresh setup→操作→期待照合→証拠→cleanup/readbackを行う。共通local手順のsandbox／正常認証／専用HOME・PATH・TMPDIRと起動前manifest固定を再利用し、TS local bare fixtureは準備と観測だけを担当する。

| 機能と入口 | 前提・実操作 | 期待・観測 |
| --- | --- | --- |
| 新commit・通常一括承認 | fresh main／bare main／README pending／outside untracked。Pi commit-push、完成表示後に同session回答 | 承認前Stageとpush準備だけ、payload削除。承認後参照だけexecuteで必要新branch／commit／固定SHA push／readback／予定upstream／cleanup。元ref・scope外保持、通常hooks、bareの余分refsなし、PR API0 |
| 既存HEAD・同SHA省略 | 公開Bun CLI、またはfresh existing fixtureのPi | message／commit不要、既存履歴を今回scanner済みと呼ばない。必要branchだけ承認後作成、HEAD／commit数不変、同SHA再push・残操作なしの通常承認なし。HEADも対象diffもなければ通信なし |
| upstream自動設定・既存保持 | 公開CLIの`push upstream`／`missing upstream`／`explicit upstream` tests。setUpstream省略／false／true、未設定／同じ／別宛先／片側／空値／値なし設定、送信済みHEAD | 省略時はremote／merge両方未設定だけ自動設定、設定済みは保持。falseは未設定維持、trueの既存衝突はcommit前拒否。元branchのupstream非継承・保持、送信済みなら再pushなしで設定。予定設定は最終一括確認に含める |
| main／default保護・初回例外 | 公開CLI normal main/default拒否、明示initialMain | 全remote空（tag等もなし）かつ送信元／予定／宛先mainだけ許可。no-confirmで推定せず、失敗からcommitのみへ縮小しない |
| 固定宛先・失敗後停止 | 公開CLIのURL／remote drift、commit後URL変更、pre-push非0／HEAD変更、送信後local drift／upstream失敗 | 先行branch／commit／push成功・成否不明・送信readback・upstream／cleanup失敗を区別し後続mutation0。通常hookを有効に固定SHA送信、extra tags／refs／submodule送信なし、必要object不足は非fetch |
| Bun不足停止 | fresh Pi commit-push、開始前からBunなしPATH、絶対Node観測者。no-confirmでも同じ | 必要条件案内でGit変更前停止。read-only snapshotでindex bytes／HEAD／全refs／branch／upstream／worktree／bare refs不変。送信／PR0、代替Python／手書きmutation／install未試行 |

公開CLIは`tests/commit-workflow.test.ts`、fixture自己検査は`push-fixture.test.ts`、RPC／metricは既存TSを再利用。通常テキスト承認はTUI実証でない。証拠保存先・group終了wait／不存在／owned cleanup／全参照readbackは専用手順どおり。全正式checksと受入はRoot担当。

## commit-pr Bun必須／修正／部分成功（現行）

[PR専用手順](pr-bun.md)でfresh setup→操作→期待照合→証拠→cleanup/readbackを再実行する。共有local sandbox・正常認証・起動前manifest固定と既存RPC／metric／push fixtureの観測を再利用し、TS gh/ssh fixtureで架空GitHub URLをowned bareへ接続する。

| 機能と入口 | 前提・実操作 | 期待・観測 |
| --- | --- | --- |
| 新commit・通常PR／Draft | 既存branch履歴＋今回README diff、fresh Pi commit-pr、固定特殊文字文章、通常一括承認 | base全体固定diff/history/templateとremote／PR準備を新commit前に完了。branch名との循環なし。元ref／scope外保持・必要commit/push/PRだけ、全文bytes・Draft/head/base/SHA readback、承認後参照だけexecute |
| Issue Close／参照とupstream | 新commit／既存HEAD／PR-onlyの公開CLI testsでCloses／Refsを含む本文。fresh Piの意味判断を選ぶ場合はユーザー指定Issueのread-only照会と最終表示を観測 | 本文bytesを固定・作成後readback、未設定upstream自動設定・同SHA再pushなし。Issue内容／完了条件を確認し解決ならCloses、関連／一部はRefs、番号創作・直接close・既存PR編集なし。default以外のbaseではmerge時自動Closeされない旨を説明。fixtureの本文検証をGitHub上の実自動CloseやAgent判断の実証にしない |
| 片側修正／設定再準備 | 同sessionへcommitのみ修正→Draft／base設定修正→最終一式承認の実follow-up | 他方bytes保持、旧参照失効。未確定materialsはexecute不可。設定はcleanup→影響準備再取得→再提示・再確認、driftは吸収しない |
| 既存HEAD／PR-only | 公開CLI existing head／push済み、fresh Pi runtime停止は別fresh | commitなし、同SHA再pushなし、存在しない文章／修正選択肢なし。既存履歴を今回scanner済みと呼ばない |
| 既存PR／競合 | 公開CLI OPEN/CLOSED/MERGED、準備後消失／create前競合 | 非重複・非編集。既存PR消失なら追加文章生成せず停止。残操作なしなら不要承認なし |
| commit後／送信後drift・異常応答 | 公開Git hooks／TS gh faultとfresh Pi代表 | commit／送信先行成功を保持し後続PR0、異常create応答は作成済み可能性・readback失敗を区別。Python／手書き代替／install／retry／rollbackなし |
| Bun不足停止 | 起動前からowned PATHにBunなし、絶対Nodeでfresh Pi PR／PR-only別状態。共有経路の非対応／不正probe代表 | Bun1.3.0以上案内、index bytes／HEAD／全refs／branch／upstream／worktree／bare不変、Stage/commit/push/PR0、代替経路未試行。version応答fixtureはAgent停止分岐だけ |

小diff一括／大diffの材料名→返却cursorによる自動page・未表示明示、全Staged検査、private・秘密非出力・未知file保持は共通公開Bun suiteの対応代表で確認する。新PR helper／fixtureにもsource-named testsを持つ。廃止したPython専用の大容量／不正応答／中断／限定分岐例は再建しない。大材料まとめ読取・非object入力拒否・秘密非表示・失敗後停止・所有外保持・既存PR非重複は同じ公開Bun suiteで照合し、任意中断時のcleanup必達は保証しない。証拠／metric／cleanup／全参照実readはPR手順どおり、Rootは別fresh状態で独立確認する。

## 後続固定tool（Issue #60）

4入口は両tool必須、後続materials/read/release/plan/execute/cleanupはcommit_workflowのみ。[localの形式修正](local-bun.md#固定tool-同一承認planの形式修正)で同一承認planの余分field拒否→同ref形式修正→commit1回・再承認0、toolなしStage0を確認する。PR中間／完成／終端／部分成功／cleanup不完全は専用手順と公開tool testsで区別する。[reload](commit-inspect.md#実tuiとreload)は再inspectなしの同Bun lookup／cleanupを確認する。宛先候補取得は下記Issue #62の専用代表を使う。

## 固定材料の自動page（Issue #61）

[localの大UTF-8手順](local-bun.md#大utf-8固定材料-namescursor通常承認commit)でfresh Piの材料名→返却cursor→実際の完成提示・承認質問→真の回答→固定tool commitを確認する。read JSONのみ32KiB以内、全page復元・strict progress・未表示、AI offset/length計算・起動コマンド生成0、質問前payload削除、承認前後の親/tree/index/raw本文/元ref/対象外保持を照合。PR全6材料とprFiles、binary/invalid UTF8/base64、BOM、escape、空/EOF、cursor結合/不正、不可分metadata/要素、旧parts回復・全Staged scannerは公開CLI/toolの実Git代表。既存RPC/observerのworkflow記録を再利用し、新観測基盤・4入口大差分直積・TUI保証は追加しない。

## push／PR local宛先候補（Issue #62）

[push未指定正常と曖昧質問](push-bun.md#local宛先候補と曖昧実質問)、[PR未指定正常](pr-bun.md#local宛先候補から通常pr)を別fresh状態で実行する。reference不要destinations→根拠付き採用または実質問→inspect以後の再検証を照合。候補取得までprivate／Stage／設定変更／製品fetch・ls-remote・push・gh0、Match exec等のssh -G副作用限界を区別。未回答曖昧はStage0、停止報告だけは不成立。完全な明示先の不要調査なし・内容なしempty・設定優先／無効／複数／空／値なし／unknown・HTTPS／SSH alias／local bare／rewrite／不適合候補と非漏洩・同repo不一致／driftは公開CLI/toolの実Git代表。RPC/observerは既存workflow記録を再利用し新runnerなし。Rootは別fresh確認・正式checks・Reviewを担当する。
