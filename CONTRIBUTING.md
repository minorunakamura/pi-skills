# 開発と詳細仕様

導入・基本操作は[README](README.md)を参照してください。

## commit 系 Skill の詳細仕様

| 入口 | 終点・branch・runtime |
| --- | --- |
| commit | ローカルcommit。default相当上なら未存在作業branchを承認後に作成。Bun標準経路 |
| commit-main | default相当の現在branchへ直接commit。branch作成・切替・通信なし。Bun標準経路 |
| commit-push | 必要なcommitと固定SHA push。PR APIなし。Bun標準経路 |
| commit-pr | 必要なcommit・pushと通常PR（明示Draft優先）。同一repository内のみ。Bun必須、PR-onlyも対応 |

到達点・branch方針は自由文で上書きしません。矛盾はStageを含むGit変更前に停止し、対応入口を案内します。固定文章・対象・言語・形式などの明確な指定を尊重し、引数全体を固定タイトルにしません。呼出し間で過去の承認は流用しません。

無指定はUntracked・既存Staged・部分Stageの残りを含む全変更（ignore維持）。限定literal paths／既存Stagedだけにも対応します。範囲外既存Stageを勝手にunstageせず確認し、dirty nested submodule内部を自動commitしません。Stageは最終承認前のため、**キャンセル・失敗でもStageが残り得ます**。reset／unstage／amend／force push／rebase／merge／release／deployはしません。空diffでは新commit・空commitを作りません。

完成文章と操作一式を通常assistantで表示し、一括承認／修正／cancelを扱います。作らない文章や操作の選択肢は出しません。明示no-confirmは通常承認だけ省略し、予定表示・検査・疑義の実質問・異常停止は維持します。ask_user_questionがなければ同じ選択肢を通常テキストで示し回答を待ちます。script成功や参照の存在は承認でありません。

各入口の必要文書は開始時に**同じassistant turn**で全文readし、切断時はtailを取得します。commit／commit-mainはlocal、pushはlocal＋push、PRはlocal＋push＋PR＋diff-reviewです。読取順と規則の優先順位は別で、PR > push > local。local専用の無通信・default質問・空diff即終了をpush／PRへ転用しません。

### ローカル2入口のBun標準経路

[commit](skills/commit/SKILL.md)／[commit-main](skills/commit-main/SKILL.md)から[同梱Bun手順](skills/commit/references/local-bun.md)を全文読みます。Bun1.3.0以上の確認済み絶対実体で同梱TSを直接実行し、製品npm依存・build・Codemode・Pythonは不要です。probeもtrusted scripts cwd、空の同梱TOML／env-file=/dev/null／no-install、BUN_OPTIONS／NODE_OPTIONS除去、絶対entrypoint／対象repositoryを使います。tsconfig-overrideなし、対象欠落fallbackなし。通常Git設定・hooksは維持します。

Bun 1.3.0以上は必須です。不在／非対応version／起動異常／不正probe／確認不能では必要条件を案内し、Stageを含むGit変更前に停止します。no-confirmでも省略しません。開始前後を問わず手書きBash／旧Python／互換へのfallback・自動install・PATH／利用者設定変更で迂回しません。新launcherやruntime管理は追加しません。

`commit_inspect`と`commit_workflow`の両toolを必須にし、未導入／非公開ならStage前に停止してextensionの導入・有効化と新sessionまたは`/reload`を案内します。手書きCLI fallbackはありません。`commit_inspect`を実repositoryと明示modeで直接1回呼び、手動probe／inspect／JSON転記／重複一覧を省きます。完全referenceを無改変で後続の`commit_workflow`へ渡し、materials→plan→executeへ進みます。必要な固定材料まとめ読取／release／cleanupだけを補います。defaultは全local remote HEADのsymbolic target／解決OIDと対応remote／順序付きfetch設定から**宛先→送信元**へ逆mappingします。一意default優先、真に情報なしの場合だけmain／master fallback。競合・broken・orphan・non-symbolic・不明mapping・観測不能を情報なしにせず、候補／理由を表示して実質問し、未回答はStage0。commit-mainは回答後も作業branchなら拒否、commitは回答に応じて作業branchを計画します。通信・自動補修なし、Stage前／操作直前の根拠driftを拒否します。ローカル情報は古い可能性があり最新defaultを保証しません。

materialsで全Staged diffをGitleaks検査します。未導入だけunavailable、検出／失敗は停止。scanner／hook／子CLIの生出力・秘密値は会話へ流しません。小diffは一覧・本文・必要履歴を約32KiBの予算内で一括、大diffは未表示を明示して固定材料名と返却cursorで読み、検査範囲を縮めません。不要diff／履歴payloadはどの質問前にも削除します。追加質問なくplanへ進める場合は独立releaseを省き、完成planまたはPR中間結果の`payloadRemoved=true`を確認してから提示・質問します。先に疑義質問が必要ならrelease成功と返された新referenceを確認・採用してから質問します。PRの`phase=materials, executable=false`は承認・execute不可で、新referenceで不足文章を補います。`already_pushed`／`existing_pr`等の終了結果はcleanup成否・残存を確認し、残操作なしなら不要承認をしません。plan失敗／削除拒否／cleanup失敗は停止して残存を報告し、所有検証不能時にcleanup成功を推定したり承認で迂回したりしません。readの表示予算はJSON全体で1回あたり32KiB（累計ではない）。旧partsの`material_display_budget_exceeded`かつ`materialsPreserved=true`だけは準備を削除せず、応答の同じreferenceで要求量を減らして読み直せます。Skill全体の再実行は不要です。続行しない場合はcleanupし、他の失敗時の停止／cleanupは維持します。

完成文章は承認前にrepo外private directory0700／file0600へ排他的保持。owner／非symlink／regular file／実体／bytes digest・repo／runを照合し、修正時は旧版削除成功後だけ新参照を返します。executeは参照だけで文章／設定を再送せず、途中LLM判断／処理コード生成なし。通常hooks、raw本文（末尾LFなし入力への1 LF追加だけ許容）／全親／tree／branch ref／index／他refsを事後照合します。失敗／drift／成否不明で後続停止し、Git成功応答後の確認失敗・cleanup失敗を区別します。所有実体だけcleanupし未知sentinel／他実行は消しません。完全atomic性・任意強制中断時のcleanup／報告必達は保証しません。

### 後続の固定tool境界

model-onlyの `commit_workflow` は `{repository,operation,input}` を受け、inputはJSON objectです。固定operationは destinations/materials/read/release/plan/execute/cleanup。executeのinputは完全referenceだけで、Bun/config/entrypoint/cwd/env/timeout/commandは公開しません。Piの公開 `executionMode: 'sequential'` で同じturnの並列起動を避け、既存spawn＋stdinとCLIのGit検証・通常hooksを再利用します。複数stepと子command各60秒を考慮してoperation別の時間／出力上限を固定します。

Bun lookupは `ctx.sessionManager.getBranch()` のmessage/toolResult/commit_inspect最終isError=falseだけ。完全検証済みdetails.bunを、caller referenceのrun/repository/directory/dev/ino一致で一意に特定し、遷移するfilesは一致を要求しません。途中update・通常text・失敗・別branch・別repo・証拠不足／矛盾は使いません。同じ絶対実体・実行可能性・保護probeを再確認し、PATH再探索しません。reload後もこの証拠が必要です。最新reference・承認・復旧状態を履歴から導出せず、callerの完全referenceの所有／digest／phaseはCLIが検証します。

正常応答は終了確認／exit0／完全JSONと操作別検証が必要です。materialsとempty、phaseなしread／release、完成planとPR中間materials(executable=false)、already_pushed／existing_pr終端、executeのcommitted／pushed／already_pushed／existing_pr／pr_created、cleanupのcancelled／stagedChangesPreserved／complete／remainingを区別します。固定文章・新reference・部分成功・cleanup不完全を落とさず、contentとdetailsを同じ検証済みデータから作ります。未知field・生scanner／hook／child出力は返しません。

TUIの `commit_workflow` は `renderCall` で操作名だけ、`renderResult` でphase・件数・読取の続き／終端などを短く表示します。Piのtool出力展開（標準 `Ctrl+O`、現在の割当は `/hotkeys`）で完全な結果を表示できます。失敗・先行成功flags・cleanup未完了／未確認・child終了未確認は折り畳み時も残します。描画だけの変更で、model-facing content／details、完全reference、read JSONの予算・bytes、RPC／JSON／printの結果は削りません。完成文章・通常承認は引き続きassistantで別途提示します。

子process起動前の構造／許可field誤りだけが `input_rejected, childStarted=false, inputCorrectionAllowed=true` です。Bun/Git起動0・private準備不変で、同じ承認planの余分field等の形式修正だけなら同referenceで再要求でき、再承認不要です。文章／対象／操作変更は新plan提示・実承認が必要で、driftやruntime／repository／run／所有不一致はこの例外にしません。cancel済みsignalも対象外です。CLI exit1はallowlistと型検証済みの先行成功flags／SHA／cleanupを保持しますが入力修正可能にはしません。

起動後失敗／timeout／cancel／不正応答／成否不明は無断retry／rollbackなし。終了未確認ならcleanupを競合させず、CLI cleanup済みなら二重cleanupしません。transition後の応答喪失等で安全な最新referenceが不明なら古ref更新・探索・強制削除せず残存報告します。executeへinspectの成功update後cancel処理を流用しません。read予算超過のmaterialsPreservedだけは従来の縮小read例外を維持します。自動pageとreference不要の宛先候補取得は下記の契約で提供します。

同梱CLIは開発用公開テスト入口として維持します。開発者はtrusted scripts cwdで `env -u BUN_OPTIONS -u NODE_OPTIONS "$BUN" --config="$SCRIPTS/bunfig.toml" --env-file=/dev/null --no-install "$SCRIPTS/commit-workflow.ts" OPERATION --repository "$REPOSITORY"` へstdin JSONを渡せます。これはSkillのtool未導入時fallbackではありません。

### push／PRのlocal宛先候補

`commit_workflow`の`operation:"destinations"`、`input:{"mode":"push"}`または`{"mode":"pr","scope":{"kind":"paths","paths":["README.md"]}}`はreference不要。同梱公開CLIにも同operationを提供し、既存の初回Bun発見・保護probe、固定spawn＋stdinを使います。mutation操作の完全reference＋一致inspect Bun証拠は変更しません。

結果は`needed`（HEADまたは選択内容）、`remotes`（name／安全なrewrite後url／PR repository候補／理由）、`config`（branchPushRemote／remotePushDefault／branchRemote／branchMerge）、`basis`（source／remote）と未解決`reasons`。config stateのabsent／single／multiple／unknown、値のvalueless／empty／invalid／missingRemote／valueを保存し、remote値は観測済みremote名と一致するものだけを返し、不一致はmissingRemote（値非表示）、不正merge refはinvalidとします。生設定・SSH出力・資格情報URLを返しません。内容なしは必要ないremote照会・質問をせず既存empty経路へ。

toolは観測だけ。assistantは完全な明示先を尊重し、なければbranch.pushRemote → remote.pushDefault → branch.remoteの根拠を区別します。無効／空／複数／存在しないremote／観測失敗から次へfallbackせず、根拠が全てabsentのときだけ単一remoteを提案できます。origin推測なし。曖昧／非対応候補を黙って消さず、安全な候補・理由と実際の宛先質問をStage前に示し、未回答Stage0。PRは共有URL／SSH host正規化だけを使いpreparePrを呼ばず、明示repository不一致・同repo制約を維持します。

private準備／Stage／設定書込・補修／fetch／ls-remote／push／ghなし。SSHの`ssh -G`はMatch exec等を実行し得るので任意外部processまで副作用ゼロとは保証しません。検証はowned設定・fixtureのみ。候補は権限・最新default／SHAの保証ではなく、選択後のinspect／materials／plan／execute再検証とdrift検出を迂回しません。local commit／commit-mainへremote調査を追加しません。直接確認はpush／PR専用手順の未指定正常と別fresh曖昧質問、公開CLI/tool実Git testsを使います。

## 固定材料の自動page JSON

標準readのinputは初回`{"reference":REFERENCE,"materials":["diff","history","files"]}`、続きは`{"reference":REFERENCE,"cursor":NEXT}`です。固定名はdiff/history/recent-history/pr-diff/pr-history/pr-templatesと一覧files/prFiles。未知・その入口で利用不能な材料は拒否します。複数名は重複なしで順に読みます。小材料の既存一括返却は維持し、大材料の初期metadataも32KiB以内、省略一覧はfiles/prFilesから到達可能です。PRの省略した再利用pathもprFiles.reusedStagedで確認できます。不可分metadataが収まらなければ`material_metadata_budget_exceeded`で明示停止し、通常の所有cleanupを報告します（旧readの保持／縮小回復とは別）。

応答は`{fixed:true,parts:[...],next:CURSOR_OR_NULL,done:BOOLEAN,unread:[残る材料名]}`。本文partは`{name,offset,length,totalBytes,encoding,text}`（byte位置／長さ）、一覧partは`{name,offset,count,totalCount,items}`（要素位置／数）です。read応答をJSON.stringifyした全体が32768 bytes以下で、escape・base64・metadata・cursor・next/doneを含みます。tool contentは同じJSONを一度だけ載せ、referenceを重複追加しません（Pi details／描画wrapper全体の上限ではありません）。有効UTF-8の文字境界とBOM bytesを保ち、不正UTF-8／NULを含むbinaryはbase64でlosslessに返します。

cursorは自己完結JSON object`{binding,materials,index,offset}`。bindingは完全referenceのrepository/directory/run/dev/ino／名前順のfiles identityと材料名列／位置を結ぶSHA-256です。保存先・registry・署名・承認tokenではなく、認可は従来の所有／digest検証です。別run／reference／材料、改変、不正・非整数・負数・範囲外・UTF-8途中位置を拒否します。assistantはcursorを無改変で渡すだけで、offset加算／length計算をしません。

空／EOFは正常終了、未読時はstrict progressまたは明示エラー。`done=true,next=null,unread=[]`は要求材料の送出完了だけで、理解・安全認定ではありません。不可分要素の`material_display_budget_exceeded`で同cursorを無限retryしません。開発用CLIの旧parts/fileOffset/fileCountは別schemaで残し、新旧混在は拒否します。旧readの予算超過だけは従来のmaterialsPreserved／縮小再読取を維持。全Staged scanner、固定材料、plan/release/cleanupの安全規則は変えません。

### push入口のBun標準経路

[commit-push](skills/commit-push/SKILL.md)から[push用Bun手順](skills/commit/references/push-bun.md)を全文読みます。local＋pushを同ターンで読み、起動のtool選択と保護形は共有local手順を使います。新commit／既存HEADを区別し、事前push準備・確定文章／操作のprivate保持・通常assistant一括確認後、参照だけexecuteで必要branch／commit／固定SHA push／送信readback／予定upstream／cleanupまで進みます。既存HEADはmessage／commit不要、同SHA再pushなし、HEADも対象diffもなければ通信なし。PR準備／gh APIは0です。

remote／実push URL／target／upstreamを確定表示します。push／PRでは予定branchのremote／merge設定が両方未設定なら送信確認後にpush先をupstreamに自動設定し、既存設定（片側だけ／空値／値なしも含む）は保持します。明示的な設定不要は`setUpstream:false`で保持し、明示`true`でも異なる既存設定は上書きしません。同SHA送信済みなら再pushせず未設定upstreamだけ設定します。ローカルcommit単体では設定しません。branchは通信したremote defaultとmainで判断し、local2入口のdefault質問は転用しません。通常main／remote default宛てを拒否し、明示初回mainだけ全remote空（tag等もなし）かつ送信元／予定／宛先mainで許可。通常hooks有効、余分refs／tag／submodule非送信、必要object不足は非fetch。drift／異常／成否不明は後続停止し、先行branch／commit／push成功、事後照合／upstream／cleanup失敗を区別します。Bun必須条件とGit変更前停止はローカル2入口と共通であり、開始後の失敗でも別経路へ切り替えません。

### PR入口と移行完了

#47でlocal2入口／push、#48でPR本体／PR-onlyをBunへ移行し、#49で対応検証と照合して旧Python製品／tests／開発設定／CI呼出し／配布を撤去しました。4入口すべてBun必須で、開発検証もPython不要です。既存local `.venv`／cacheと過去証拠は残存artifactとして保持し、新しい開発前提にはしません。

commit-prは[PR用Bun手順](skills/commit/references/pr-bun.md)でbranch全体の固定diff／履歴／templateと同repo／認証／権限／base／既存PRを新commit前に準備します。通常PR既定、明示Draft優先、既存PRは全state非編集／非重複。具体branchを準備するplanが文章未確定なら非実行可能materials参照を返し、必要文章を補って完成planを通常承認します。片側文章だけの修正は他方bytesを保持し旧参照失効、設定修正はcleanupから影響準備をやり直します。承認後executeは参照だけ、固定SHA送信とPR全文／head／base／SHA readback、drift／異常応答後停止・先行成功保持を行います。汎用engineや旧CLI／schema互換adapterはありません。

関連Issueはユーザー指定・明示文脈を根拠に`gh issue view`等で内容と完了条件を確認します。PR全体で解決するなら本文に`Closes #123`、関連のみ／一部なら`Refs #123`（別repositoryは`owner/repo#123`）を記し、最終一括確認に含めます。番号を創作せず、固定本文に無断追記せず、既存PRを編集せず、Issueを直接closeしません。自動Closeはdefault branchへのmerge時で、別baseではそのmergeで自動Closeされないことを説明します。

直接確認は[検証Skill](.pi/skills/verify-project/SKILL.md)から[ローカルBun手順](.pi/skills/verify-project/references/local-bun.md)を選びます。fresh Piの通常承認／cancel／no-confirm／default実質問・未回答Stage0／Bun不足／非対応／確認不能のGit変更前停止と実Gitを照合します。pushは[専用Bun検証手順](.pi/skills/verify-project/references/push-bun.md)、PR入口は[PR用Bun検証手順](.pi/skills/verify-project/references/pr-bun.md)を使います。共有RPC／metric／fixture helperはNode24で実行し、helperの既定read,bashだけはtool未導入対照として保持し、通常Skill検証では明示extensionとread,bash,commit_inspect,commit_workflowを使います。専用toolの直接確認は[commit_inspect検証手順](.pi/skills/verify-project/references/commit-inspect.md)で明示extensionとplain allowlistを選択し、実TUI／nonTUI／cancel／reloadを区別して確認します。model/thinkingは通常解決を記録し比較条件と照合、認証の独自read/copy/logは禁止。RPC通常テキスト承認はask_user_questionのTUI実証でありません。

性能比較を対象に選ぶ場合だけ、production変更前のread-only archiveでlocal commitとcommit-prを各1組、同じ小diff／history／明示文章／通常承認で比較します。新旧とも同じ観測helperを固定し、baselineは当時の表示extensionを使います。inspect取得→一覧までのLLM介在、probe／転記／release／全文readの同ターン性も操作記録から分類します。provider／model／thinkingは通常解決を照合し、無断変更しません。承認前／後／全体時間、利用者待機、全assistant request、生成codeと固定呼出し／payload、取得可能usage・失敗・unknownを分け、nested toolを二重加算しません。構造改善と時間効果を分け、単発観測を安定した高速化の証明と呼びません。変更前baselineがすでにBun版ならPython→Bunの速度効果とは呼ばず、条件差・比較不能・未実証を明記します。

#### 状態一覧の色付き表示

同梱の`extensions/commit-status.js`はmodel-onlyの`commit_inspect`でBun確認→保護起動inspect→状態表示を1回に連結します。入力はrepository実ルート絶対pathと、明示mode（commit／commit-main／push／pr）を含む既存inspectのJSON文字列です。任意command／runtime／scripts指定は受け付けず、symlink導入でも配布元実体のCLIを使います。Bun 1.3.0以上の実行可能な絶対実体を確認し、trusted scripts cwd・空の同梱TOML・env-file=/dev/null・no-install・BUN_OPTIONS／NODE_OPTIONS除去をprobeとinspectの両方に適用します。開始後の失敗からfallback／installはしません。

成功にはexit0・完全JSON・inspect固有のreference／branchPolicy／default／evidence／questions／pathBytes等の構造検証が必要です（正常inspectにphaseなし）。content末尾JSONとdetailsは同じ`{bun,result}`で完全材料を保持し、後続toolは同じBun絶対実体と完全referenceを使います。CLIの所有・digest・repository検証は維持し、Stage以降を自動連結しません。inspectはGit mutationなしでもprivate準備を作るため、readOnlyHint／idempotentHintはfalseです。

実行と描画を分離し、TUIはdetailsからrenderResultで次LLM応答を待たず表示、通常assistantに同じ一覧を繰り返しません。RPC／JSON／printには色なし一覧と完全材料をcontentに残します。print stdoutは最終assistantだけなので標準sessionのtoolResultも観測します。rendererの色生成失敗だけ同じデータで色なしへ代替し、再inspectしません。不正応答・取得失敗は代替対象でありません。PiのrenderResult第一引数はcontent/details、失敗判定は第四引数context.isErrorです。取得後cancelのdetails.resultを成功一覧として描きません。

inspectがexit1で終了確認済み、timeout／cancel等なし、完全JSONのerrorが固定allowlist（`invalid_input`／`invalid_push_input`／`invalid_pr_input`／`invalid_pr_repository`／`invalid_pr_base`）に一致する場合だけ、`inspect_failed`に`cause`を追加します。生出力・未知フィールドは返さず、未知コード・不正応答は汎用エラーのままです。causeはcleanup成功の証明でも再試行の許可でもありません。

通常cancelで完全な信頼できるreference取得済みなら、同じBunと所有検証CLIでcleanupし、abort済みsignalを引き継がず上限と終了確認を持たせます。取得前・切断JSON等は成功／cleanup済みとせず残存可能性を明示し、未知directoryを探索削除しません。最終isErrorとcleanup成否・child終了確認を区別し、任意強制中断での返却必達や永続registry／reloadをまたぐ自動復旧は保証しません。

既存`commit_status_display`は取得済みJSON表示だけ・Git操作なしの互換toolとして維持し、入力とannotationsは変更しません。Pi packageのmanifestで読み込まれ、追加・更新後に新sessionまたは`/reload`で使えます。今回の実TUI直接確認はPi 1.4.0が対象です。4 Skill入口もこのtool選択・Bun引継ぎ・同ターンread・release分岐を使います。接続と前後比較はfresh Skillで別途確認し、tool単独の確認から完了を推定しません。

絵文字ではないテキストの`●`だけを色付けし、状態名・ファイル名は通常色で表示します。このtoolは標準の色付き背景枠を使わず、通常背景に一覧を表示します。theme設定や他のtoolの表示は変更しません。

| 状態 | themeの色指定 | 標準darkでの色 |
| --- | --- | --- |
| Modified | `warning` | 黄色 |
| Untracked | `mdLink` | 青色 |
| Added | `success` | 緑色 |
| Deleted | `error` | 赤色 |

部分StageはStaged/Unstagedを分け、rename/copyは元パスも表示します。色は有効なthemeに従います。両toolのいずれかが未導入／非公開ならStage前に停止し、手書きCLIへfallbackしません。TUI以外ではtool contentの通常textを使います。完成commit／PR文章・操作一式と明示承認は通常assistantで別途表示し、tool contentを承認表示に流用しません。承認・検査の手順は変わりません。

スキルだけをsymlinkで導入している場合は、cloneしたリポジトリのルートから表示extensionもリンクできます。既存ファイルは上書きしません。

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/commit-status.js" ~/.pi/agent/extensions/commit-status.js
```

その後Piで`/reload`を実行してください。


## 開発時の検証

開発にはmiseとGitを使います。Node24・Bun1.3.0・pnpmを`mise.toml`で固定します。新しい環境ではmiseを有効化したshellで次を実行してください（検証作業中の無断installはしません）。Python／uv／Ruff／ty／pytestは不要です。

```bash
mise install
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
```

`pnpm lint`はoxlint + oxlint-tsgolintのtype-aware lint（--type-aware --deny-warnings）、`pnpm typecheck`はtsc --noEmit、formatはBiome専用（linter/assist無効）、testはNode24標準node:test／node:assertのTS直接実行と既存JS testsです。製品TS・tests・fixture・隠し`.pi/skills/verify-project/scripts` helperを収集し、最寄りtsconfigを整合します。warningはsource修正で0にし、quiet／一括disable／除外で隠しません。devDependenciesとlockはexact version固定、追加製品npm依存・build成果物はありません。

`tests/commit-workflow.test.ts`は実Gitと保護起動したBun公開CLIを使い、scope／部分Stage／default／全Staged検査／通常hooks／raw本文／固定SHA／PR非重複／drift後停止／private所有物とcleanupを検証します。scanner・gh・SSHはowned fixtureで観測し、実remoteやGitHubには接続しません。回帰テストはGitとPOSIX環境が対象です。表示extensionのNode testsはPi提供module境界だけをstubにし、色・部分Stage・rename・競合・制御文字escape・不正JSON・TUI以外の表示を確認します。Pi本体の追加installや外部接続は不要です。Pi提供moduleはoptional peer dependency、`pnpm-workspace.yaml`でpeer自動installを無効化し、SDKを二重導入しません。

### 変更対象から検証を選ぶ

件数ではなく、変更した保証・具体的な回帰リスク → 公開seam → 必要最小限の前提 → 実操作と観測の順に選びます。既存テストを優先し、対象と無関係なhistory・remote・後続操作を準備しません。ただし対象の接続・状態遷移は実際に通し、内部setterや成功固定のmockで実Git取得・操作を代用しません。負例は正常例との差分が拒否対象だけであることと期待errorを照合します。

| 変更箇所・理由 | Workerの対象例と直接確認 |
| --- | --- |
| commit/index・scope・default・branch・raw本文 | `tests/commit-workflow.test.ts`の対応公開CLI正常／拒否代表。親・tree・元ref・index bytes・upstreamを実Gitで照合。Agentの判断・確認対話は[local手順](.pi/skills/verify-project/references/local-bun.md)で実入口を選ぶ |
| push/PR準備・固定宛先・状態遷移 | 同suiteのpush／PR代表。新commit／既存HEAD／PR-only、固定SHA／通常hooks／tracking mapping／readback／既存PR、先行成功と後続停止を区別し、内部handler成功mockで消さない |
| stdin・秘密保護・失敗・private | 同suiteの不正UTF-8／JSON／非object入力、scanner／hook／子CLI生出力非表示、drift拒否、差替え／別repo・run／未知sentinel保持。廃止CLI間のschemaや内部timeout monkeypatchは再建せず公開境界で確認 |
| 共通fixture／RPC／metric helper | 実callersを検索して対応する`push-fixture.test.ts`／`pr-fixture.test.ts`／`commit-rpc.test.ts`と利用する公開CLIへ広げる。fixtureがGit操作・文章・判断を代行しない |
| workflow／文書契約・runtime・表示extension | `tests/verification-skills.test.js`と表示extension tests。文言assertはAgent動作の証拠でない。Bun不足はfresh Pi実入口と変更前後のread-only snapshot／tool操作で確認 |
| 検証Skill／Map／手順 | 関連する参照検査と、その手順で選んだ機能のfresh setup→実操作→期待照合→証拠→所有PID wait／group不存在→owned cleanup→全参照readback。local／push／PRの専用Bun手順を再利用 |

例えば公開scriptの再実行手順だけの変更なら、その新しい隔離経路と関係する正常/拒否代表を選び、全remoteや全branchのPi sessionは起動しません。共通fixtureを変えた場合だけその実callersへ対象を広げます。選んだnode ID/経路と理由、維持する保証、未確認範囲をrun記録に残してください。通常の関連更新に全Map実行やMaintainは不要です。

### Worker / Root / Reviewer の分担

- **Worker**: 変更したテスト群・実callers・対応する実Git正常/拒否代表を実行します。変更対象、選択理由、コマンド/exit、期待と観測、未確認、証拠・owned環境のcleanupを報告します。全remote・広い非remote回帰・正式全suite・全Mapを無条件には要求しません。非自明なhelperには最小assert self-checkと実手順の実行を残します。文書整理・既存テスト再構成にはTDDを一律要求しませんが、検証不要にはしません。
- **Root**: 各Work Itemの最終差分で`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、全収集の`pnpm test`を自ら実行します。配布文書/参照変更では`npm pack --dry-run --json --ignore-scripts`も確認します。正式testの件数・pass/fail/skip・Node test実行時間・外側wall timeを記録します。Workerとは新しい隔離状態で変更に対応する公開CLI/実状態を独立に直接確認し、全完了条件を受け入れます。手順変更ではWorker実行後、履歴・前回の一時path・稼働processなしで手順だけから再実行します。Workerの全操作や過去の全シナリオの丸ごと反復は不要で、一つの直接実行で複数条件を満たして構いません。
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

`.github/workflows/ci.yml`で、PRの作成・更新とmainへのpush時にUbuntu上で同じlint・型検査・format確認・Node TS/JS testsを実行します。依存は`pnpm install --frozen-lockfile`で固定し、Python開発環境を準備しません。Actionはcommit SHA、mise本体もバージョンを固定しています。

権限は`contents: read`のみで、checkoutの認証情報は永続化しません。実GitHubへのpush・PR作成や個人の認証情報は不要です。CI成功をmerge条件にする場合は、workflowとは別にGitHubのRuleset等で必須チェックを設定してください。
