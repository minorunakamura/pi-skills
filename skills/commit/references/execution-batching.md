# 未移行3入口の新commit承認後の実行集約（Python標準経路）

commit-mainは[専用Bun手順](commit-main-bun.md)で保持参照だけをexecuteするため、この生成例を使わない。他3入口の未移行Python経路と既存保証は維持する。

[workflow](workflow.md)の手順9〜11から全文を読む。これは当該実行の呼出しコードを生成するための指示で、別のrunnerではない。API・branch規則・承認前工程はworkflowのまま。対象は**新commitあり・標準経路・Codemode利用可能**だけ。対象差分なし、既存HEAD、push済みからPRだけ、Python-freeは従来どおり。Codemodeが**集約開始前から利用不可**の場合だけ手順9〜11の逐次script経路を使い、Python-freeへは切り替えない。開始後の非0・例外・timeout・中断・不正応答ではfallbackしない。

## 1回の呼出しと到達点

一括承認（`--no-confirm`では同じ表示後の確定内容）を受けてLLMがコードを生成し、**1回のCodemode**内で既存公開CLIを直列`await`する。中継LLM requestは0回。正常時は生成＋最終報告のassistant 2回とし、最終状態確認・不要な所有物のcleanupも同じ呼出し内に含める。承認前に実行コード生成や確認/cleanupを移して短縮を装わない。mutationの並列実行・未await・途中の文章生成/再承認をしない。

| 到達点 | 集約内の順序 |
| --- | --- |
| commit / commit-main | 保持したローカルdefault根拠を同じ方法で**別途完全再取得・比較** → commit → 最終確認・cleanup。通信なし |
| push | commit → push check／push → 最終確認・cleanup。PR prepare／verify／check／create APIなし |
| PR | commit → PR verify → push check／push → PR check／必要な場合だけcreate → 最終確認・cleanup |

ローカルdefault根拠の再照合はscript snapshotとは別の責務。repository/gitDir・現在branch、全local remote HEADの有無/symbolic target/解決OID、対応remote/順序付きfetch設定、候補・理由・疑義への回答を保持した値と完全比較する。観測失敗・増減・変化なら**commitを呼ばない**。snapshotだけの比較や結果要約で代用しない。予定branchはcommit時だけ作成し、commit-mainは現在default相当branchへ直接commitする。

## 完全JSONはfile側、小さい検証済みsummaryだけをCodemodeへ

開始時確認済みPython実体と`-E -S`、固定scriptパス、引数配列、対象repositoryのcwdを使う。承認済み文章・外部値をshellコマンドとして解釈せず、UTF-8 JSON stdinにする。元のcheck／preparation／COMMIT_RESULTと返された実行用checkを欠落・改変なく後段へ渡す。JSON文字列をobjectの代わりに渡さず、head/refs等を書き換えない。

preparationだけでなく**PR check・結果JSON**も巨大になり得る。容量依存の全量`store()`、全文`read`／`text()`、bash戻り値の切断部分からの復元は禁止。[diff-reviewのprivate保持](diff-review.md)に従い、repo外に今回作成したowned private directory **0700**／file **0600**へ保持する。各writeで`umask 077`（別tool呼出しにも毎回）を設定する。パスの実体が所有範囲内、symlinkでないこと、所有者・mode・完全性（bytes数/digest）を確認し、保持済み入力は使用前にも照合する。既存の2 MiB等の入力/材料制限は拡大しない。

各`tools.bash`では生成した短いPython標準ライブラリのinline入出力コード等で、CLI stdoutと必要なstderrを**完全にfileへ取得・file側で解析/検証**する。大容量stdoutを一度Codemodeへ返してから保存しない。書込失敗・完全性不明なら停止する。Codemodeへ返すのは段階名、形式確認済みの小summary、記録した所有file参照だけ。元JSONはfileで完全保持し、stdinを組み立てる際にも元objectをそのまま読み込む。新production wrapper/共通validatorは作らず、必要な形式検査は当該生成呼出し内に限定する。

## 段階固有の最小結果検査

toolの正常終了とCLI exit 0だけでは続行しない。stdout全体がJSON objectとしてparseでき、`error`がなく、次の型と必要な期待値が一致してから次段階を呼ぶ。欠落・未知status・切断・不一致は停止。script内部の全schema/guardを再実装するものではない。

| 段階 | 続行条件 |
| --- | --- |
| commit | `commit`/`tree`はOID、`branch`は文字列、`parents`はOID配列、`messageSha256`はSHA-256、`gitleaks`は既知の検査状態。元checkの予定branch・親（unbornは[]）・tree・gitleaksに一致。承認済みraw本文bytesのdigestに一致（末尾LFなしの入力だけ1 LF付与を許す既存規則） |
| PR verify | `kind: pr-verification`、`commit`/`branch`が検証済みcommit、`diffSha256`が元PR準備と一致。実行用checkとして使わない |
| push check | `snapshot` object、`commits` array、`alreadyPushed` boolean。snapshotのhead/branch/remote/targetが検証済みcommit/元destinationに一致 |
| push | `status`は`pushed`/`already_pushed`。同じcommit SHA/branch/remote/target、`upstreamConfigured`はbooleanかつ承認済みsetUpstream方針に一致 |
| PR check | `snapshot` object、`existingPullRequests` array（各numberは正整数、url/stateは必要な文字列）。snapshotのhead/branch/base/remote/GitHub宛先が検証済みSHA/元destinationと一致。既存PRありの`diff: null`は正常 |
| PR create | `created`ならurl文字列/number正整数/head SHA/base文字列/draft booleanと承認内容が一致。`existing`なら**非空**`pullRequests` arrayの必要なnumber/url/stateを検査し、その結果を保持。再create/編集しない |

呼出しのstdinはworkflow手順9〜11の既存APIどおり。verifyのsummaryを準備/実行用checkと取り違えず、pushには返されたPUSH_CHECK、createには返されたPR_CHECKを完全なまま渡す。

最終PR checkで既存PRがあればOPEN/CLOSED/MERGEDとも作成・編集せず結果を保持する。既存PRなしでも、**今回確定した新規作成方針・承認済みtitle/body/draftが保持されている場合だけ**createできる。準備時に既存PRがあり文章/承認を省いた後、そのPRが消えても、途中で文章や設定を生成・補完してcreateしない。成功済みcommit/pushと不足を報告して停止する。createが返す`existing`は競合を含む正常な非重複結果。

## boundedな観測・停止・cleanup

各段階の開始と**検証済み成功**を、段階名・SHA・必要なURL/状態だけのboundedな`text()`で残す。diff・文章・準備全量・秘密値・scanner/hookの生出力は出さない。例えば生成コードでは、開始を`text({stage: "pr-verify", state: "start"})`で残し、`await tools.bash(...)`のfile側検査済みsummaryだけをparseして元SHA/branch/digestと比較し、成功後に`text({stage: "pr-verify", state: "success", commit: summary.commit})`とする（省略部分は当該実行の固定パス/入力で生成する）。単なるexit 0をsuccess表示しない。

非0・不正応答・不一致・例外・timeoutでは後続mutationを0にして止める。検証済み成功段階、失敗/開始済み段階、実際に観測できた事実と成否不明を分けて返す。scriptの`operationMayHaveSucceeded`／`remoteMayHaveChanged`／`branchMayHaveChanged`／`observed`／`observationError`／`observedPullRequests`等を失わず、必要な安全な観測項目をsummaryへ残す。既成功commit/pushを失敗前の状態に置き換えない。生出力を例外へ混ぜない。自動再試行・rollback・準備値更新・別経路での再実行は禁止。成否不明の照会は既存契約のread-only範囲だけ。失敗後の追加照会requestは正常系1回と区別する。

各外部コマンドの既存**60秒timeout**を維持する。1 CLIは複数コマンドを含むので外側bash/Codemodeへ一律60秒などの短い全体deadlineを付けない。Codemode全体の追加hard deadlineは原則なし（`timeout_ms`を省く）。環境の既存制限・ユーザー中断は別の境界で、成否不明を伴い得る。

正常終了/捕捉可能な失敗では`finally`等で不要な**記録済み所有fileだけ**を削除し、空directoryを`rmdir`する。未知file・他実行・glob/再帰削除はしない。cleanup失敗はGit操作失敗と分け残存位置を返す。最終状態確認もread-onlyで、結果を新しい準備値として続行しない。

任意の強制中断では段階出力/結果保存・finally・報告・cleanupの必達を保証しない。残って読める出力/所有結果と実Git/remote状態を照合し、観測がなければ未実行/成功と断定しない。再開用stateや新しい復旧workflowは作らない。LLMは返った小結果から完了・部分成功・成否不明、cleanup残存を通常のassistantメッセージで報告する。
