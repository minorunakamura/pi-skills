# commit-push: Bun公開CLI／fresh Pi／Bun必須停止

専用toolの明示extension／allowlist、実TUI即時表示・nonTUI・cancel／reloadは[commit_inspect手順](commit-inspect.md)を選ぶ。通常Skill操作は以下の明示extension／allowlistで行い、tool未導入対照だけ両optionを外してread,bashの既定を使う。開始後失敗を対照へ切り替えない。

対象はpushだけ。PR準備／APIは0。製品の[push手順](../../../../skills/commit/references/push-bun.md)を使う。local2入口の無通信／default質問をpushへ転用しない。正式checks／独立Review／受入はRoot担当、全Map／Maintainは不要。

## fresh setupと固定

[local手順](local-bun.md)の「前提・fresh setup」を使う。導入Piの指定5 docsを全文readし、Git／Node24／Bun1.3.0+／Piの絶対実体と正常認証を確認する。sandbox-exec／専用HOME/PATH/TMPDIR/Git設定／架空identity、source書込拒否／owned成功、ambient Extensions／MCP／contextなし。auth独自read／copy／log、install／実repo・実remote mutationは禁止。

そのBashブロックは**export PATHまで**実行し、最後のcd／Git init／README作成は行わない。代わりに以下をrepository rootの同じ親shellで実行する。helperはfixture作成と観測だけで、製品のbranch判断／commit／pushを代行しない。既存repoを再利用しない。

```bash
"$VERIFY_NODE" --test "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.test.ts" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.test.ts"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" setup "$OWNED" "$GIT" new "$VERIFY_NODE" > "$OWNED/before.json"
export PATH="$OWNED/bin:$(dirname "$VERIFY_BUN"):/usr/bin:/bin"
```

既存HEAD代表はfresh OWNEDでsetupの`new`を`existing`へ置換。newはmainにbase1件、READMEだけpending、bare main=base。existingはfeature/readyに2件の既存commit、bareはbase mainだけ。両方ともoutside.txtは未追跡。Git wrapperは引数をgit.jsonlに記録して実Gitをそのまま実行、ghは呼ばれればmarkerを作り非0にする（成功mockなし）。fixture setupのseed pushは観測log開始前で製品送信と区別する。

起動前にsource版／dirty（新規未追跡資材含む）／関連SHA256 manifestを`docs/verification/<issue-number>/<一意run>/<case>/`へ固定する。入口／製品全TS・設定／参照、検証Skill／Map／本手順／fixture／RPC／metric／使捨てsetup・driverを含める。driver完成後、実行前にdigest固定し、run中のsource／手順／helper／driver編集禁止。修正は終了・wait・cleanup後、別fresh runへ。終了後manifest一致も照合する。証拠はowned外へ保存し、auth／秘密／不要raw logを含めない。

## 公開Bun CLIの代表

```bash
"$VERIFY_NODE" --test "$SOURCE/tests/commit-workflow.test.ts"
```

同梱Bun保護起動の公開JSONと実Git／local bareを通す。新commit／既存HEAD、main→未存在branch・元ref／scope外保持、文章なし／commitなし、同SHA no-op、明示初回main新commit／既存HEAD成功とtagのみ非空／既存remote／送信元・宛先違い拒否、通常main／通信default保護、必要object不足の非fetch、URL資格情報／複数URL／customSSH拒否、local default疑義をpushに転用しないことを確認する。

通常pre-push hookが受け取るSHA refspec／通常hook有効、followTags／mirror／submodule設定があっても余分refsなし、最初のpositive fetch mapping先だけが元値のままか予定SHAとなることを確認する。negative等のrefspecにより未更新の場合もあるので、wildcard更新／exact＋negative未更新（後続local-head mappingの有無）／予定upstreamの正常対照と、任意SHA／他ref変更の拒否を選ぶ。mapping先がlocal branch／tagまたはsymbolic ref（未解決含む）ならcommit／branch／push前に拒否し、元ref／HEAD／全refs／設定／Stageを保持する。plan後のsymbolic化も操作前拒否、正常custom mapping／mappingなしは成功する対照を選ぶ。準備後宛先／remote drift、commit後URL変更停止、hook非0、送信後local drift／upstream失敗の先行成功と後続停止を選ぶ。内部handler成功固定で実操作を消さない。local2入口の無通信等の回帰も保持する。

[共有W2接続・read／release照合](local-bun.md#w2-通常skill接続readrelease分岐の照合)も適用する。 大材料は[local自動page代表](local-bun.md#大utf-8固定材料-namescursor通常承認commit)を再利用し、材料名→返却cursorだけ・JSON全体32KiB・未表示／終端を確認する。PR素材／prFilesは公開CLI/toolの同一repository fixtureで照合し、各入口の大差分full pipelineを直積反復しない。

## fresh Pi通常一括承認

明示製品extensionとread,bash,commit_inspect,commit_workflowの既存RPCを使い、Codemode／ambient extensionなし。以下を完成・digest固定済みの使捨てdriver、または保持する同じ対話Bashで実行し、PIDと親PIDを直後に記録する。

```bash
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
  --extension "$SOURCE/extensions/commit-status.js" --tools read,bash,commit_inspect,commit_workflow \
  "$OWNED/repo" "$SOURCE/skills/commit-push/SKILL.md" "$OWNED/evidence" \
  --fixture-remote --answer-file "$OWNED/answer" \
  --request '/skill:commit-push README.mdだけ。upstreamを設定。commit messageは正確に docs: explain local example と末尾LF。' \
  > "$OWNED/driver.out" 2> "$OWNED/driver.err" &
DRIVER_PID=$!
printf '%s %s\n' "$$" "$DRIVER_PID" > "$OWNED/pids"
wait "$DRIVER_PID"
printf '%s\n' "$?" > "$OWNED/driver-exit"
```

別shellからwaiting_for_answerと実際の通常assistant完成message／remote／実URL／target／upstream／元branch保持／操作一式／一括確認質問を読む。想定外質問へ承認しない。承認前にfixture helperの`observe OWNED GIT`を実行し保存する。HEAD／全refs／bare refsはbeforeと一致、現在main、count1、Stage後tree=予定tree、予定branch未存在、commit／push／upstream mutation0、ls-remoteは準備として許可。今回のowned/tmp privateは0700／0600、diff.bin／history.binが質問前に削除済み。Gitleaks不在は未検査表示を確認する。

```bash
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" observe "$OWNED" "$GIT" > "$OWNED/approval.json"
printf '提示内容で実行\n' > "$OWNED/answer"
```

同じsessionに通常テキストで回答する（ask_user_question renderer／TUI通過実証ではない）。終了後observeをafter.jsonへ保存。newは作業branch1件だけ作成、元main不変、親=base、raw本文=`docs: explain local example\n`、予定tree=index=実tree、bare予定branch=実SHA／bare main不変、余分refs/tagなし、予定upstreamだけ設定、outside.txt bytes保持。承認後は参照だけexecute1回、途中判断／処理コード生成0。git.jsonlは製品push1回、gh-calledなし、fetch／force／amend等0、通常結果報告と実状態が一致することを照合する。

existingはrequestを「既存HEADだけをpush。remote origin、upstream設定」にし、新commit文章／修正選択肢なし、commit数／HEAD不変、feature/readyの固定SHAだけbareへ送信、新branch／commitなしを確認する。公開CLI代表と重複する全ケースをPiで直積反復しない。適切異常は公開Git hook／drift代表で別途観測する。

## Bun不足のGit変更前停止

別fresh fixtureをsetup後、[localのBun必須停止手順](local-bun.md#bun必須-不在非対応確認不能のgit変更前停止)で起動前からPATH=owned/binとし、fixtureのbin/gitは上書きしない。絶対Node観測者と同じRPC helperを使い、Skill／requestをcommit-pushへ置換して--fixture-remoteを付ける。requestは「/skill:commit-push --no-confirm README.mdだけ。remote origin、upstreamを設定。」とする。

before/afterはfixtureの**snapshot** operationを使う。observeはwrite-treeを含むのでruntime停止の不変性検査には使わない。index bytes／HEAD／全refs／branch／upstream／tracked・untracked worktree／bare refs完全一致、必要条件Bun 1.3.0以上案内、Stage／commit／送信／PR0、代替Python／手書きmutation／install未試行を全tool操作・Git wrapper logと照合する。非対応／不正probeは共有起動経路代表をlocal手順で選び、対応実Bunとversion応答fixtureを区別する。

## 証拠・metric・cleanup/readback

source版／dirty／digest、環境、操作／exit／期待／実観測／pass-fail／未確認、before／approval／afterの最小snapshot、fixture由来と確認済みoperations.jsonl／git.jsonl／cleanup.json、metricを保存する。既存summarize-commit-rpc.tsを使い全assistant request、承認前／待機／承認後／全工程、固定呼出し／payloadと生成code、取得可能usage／unknownを区別する。nested tool二重計上なし。性能閾値／旧3run条件は流用しない。

helperはstdin close→Pi終了wait→所有group不存在をcleanup.jsonへ記録。所有DRIVER_PIDも同じ親でwaitし、終了exitを保存。残存group／unknown lockがあれば削除せず報告。必要証拠をowned外へ保存し、source／driver manifest不変を照合後、所有確認したOWNEDだけ削除する。cleanup後、短いrun記録から**全証拠参照を実read**する。Mapにrun履歴を混ぜない。

Piを本repositoryで起動しproject trustを確認、新セッション／reload後、`/skill:verify-project commit-push Bun`または本実ファイルを明示readして再利用する。Rootは別fresh状態で独立確認する。実GitHub／TUI／全OS／任意中断保証は対象外。

## local宛先候補と曖昧実質問

上の通常一括承認はremote未指定で行う。fresh fixtureの単一originは名前推測でなく`destinations.basis.source=singleRemote`を根拠に採用する。最初の`commit_workflow destinations`はreferenceなし`input:{mode:"push",scope:...}`、次に完全push.remoteを含むinspect1回、以後は既存reference経路。候補結果の実URL／config／PR不要を記録する。候補取得時点ではprivateなし・index/config/HEAD/refs/bare不変、git.jsonlの候補取得からinspect前までfetch/ls-remote/push0・gh-calledなし。観測のsnapshotはwrite-treeなしのsnapshot operationを使い、承認前observeと区別する。通常の承認前後照合・親shell wait／groupGone／cleanup/readbackは上記と同じ。

曖昧は別fresh setupで、起動前に`git remote add backup "$OWNED/remote.git"`を追加する（両方owned、送信先を推測させない）。before snapshotを保存し、requestを`/skill:commit-push --no-confirm README.mdだけ。`、answer-fileとabort-fileをowned直下に指定して同じRPCを起動する。operationsの実際の候補・理由と「どのremoteへpushしますか？」相当の宛先質問を読む。未回答時snapshotを保存しbefore完全一致・Stage0・privateなし・製品fetch/ls-remote/push/gh0・手動調査／起動コマンド0を確認する。承認は送らず、その後answer-fileへ「キャンセル」を同sessionに送るか、owned 0600 abort markerへ正確に`abort\n`を書く。abort時helper exitは非0でもcleanupのwait/groupGoneを保存する。曖昧質問へ実行承認を捏造しない。終了待ち・owned group不存在確認後だけowned cleanupし、証拠を保持・全参照readbackする。
