# Feature Map: commitのbranch方針・承認と公開script接続

今回の変更に関係する入口だけを選ぶ。Mapは再利用する手順と期待であり、run結果／一時pathを混ぜない。観測は`docs/verification/<issue-number>/<一意run>/`へ分離する。全OS／全refspec／LLM判断精度全般／実GitHub／任意中断保証は対象外。[分離・証拠・cleanup](../SKILL.md)と各専用手順を使い、全Map／Maintainは要求しない。

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
| main／default保護・初回例外 | 公開CLI normal main/default拒否、明示initialMain | 全remote空（tag等もなし）かつ送信元／予定／宛先mainだけ許可。no-confirmで推定せず、失敗からcommitのみへ縮小しない |
| 固定宛先・失敗後停止 | 公開CLIのURL／remote drift、commit後URL変更、pre-push非0／HEAD変更、送信後local drift／upstream失敗 | 先行branch／commit／push成功・成否不明・送信readback・upstream／cleanup失敗を区別し後続mutation0。通常hookを有効に固定SHA送信、extra tags／refs／submodule送信なし、必要object不足は非fetch |
| Bun不足停止 | fresh Pi commit-push、開始前からBunなしPATH、絶対Node観測者。no-confirmでも同じ | 必要条件案内でGit変更前停止。read-only snapshotでindex bytes／HEAD／全refs／branch／upstream／worktree／bare refs不変。送信／PR0、代替Python／手書きmutation／install未試行 |

公開CLIは`tests/commit-workflow.test.ts`、fixture自己検査は`push-fixture.test.ts`、RPC／metricは既存TSを再利用。通常テキスト承認はTUI実証でない。証拠保存先・group終了wait／不存在／owned cleanup／全参照readbackは専用手順どおり。全正式checksと受入はRoot担当。

## 未移行PR: 新commit承認後集約と停止・部分成功

[旧集約手順](execution-batching.md)でfresh Piのcommit-pr通常承認を選ぶ。専用HOME/PATH/Git設定と架空identity、local bareとgh/ssh fixture、導入済みPython/Codemodeのみを使う。承認前Stage以外のmutationなし、承認後の公開CLI直列接続、保持文章、実Git/bare/fixture PRを照合する。commit後verify driftとpush後PR check driftは後続mutation0と先行成功保持を確認する。[実commit後の明示中断限定例](interruption.md)、[既存PR／競合／push終点／開始前Codemode不在の限定例](limited-branches.md)は必要時だけ選ぶ。後者の固定Python例や制御traceをfresh Pi全入口通過と呼ばない。旧3run性能条件は移行済みローカル入口に流用しない。

## 公開Python script: staged → local bare push → fixture PR

[公開script手順](staged-push-pr.md)で既存fixtureを使い、staged-commit.py→guarded-push.py→github-pr.pyへ到達する。prepare非変更、commit時だけ予定branch作成、PR準備のcommit前完了、予定SHA／bare／PR全文・Draft/readback、既存PR非重複／非編集、禁止操作なしを時点ごとに確認する。Python起動保護は確認済み実体の-E -Sと人工PYTHONPATH/sitecustomize marker非生成を同じ実Git接続で確認する。これは未移行PRのscript経路であり、現行commit／commit-mainのAgent branch判断を代行しない。証拠／cleanup／readbackは各手順へ従う。
