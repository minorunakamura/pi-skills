# commit-pr: Bun公開CLI／fresh Pi／Bun必須停止

専用toolの明示extension／allowlist、実TUI即時表示・nonTUI・cancel／reloadは[commit_inspect手順](commit-inspect.md)を選ぶ。下の無extension経路は従来CLI／tool未導入対照として維持し、専用toolの実証には使わない。

初期対象は新commit／既存HEAD／PR-only／既存PR、固定文章と片側修正、設定再準備、commit後／送信後部分成功、runtime停止。製品の[PR手順](../../../../skills/commit/references/pr-bun.md)を使う。実GitHub／fork／TUI／全OS／任意中断必達は対象外。正式checks・独立Review・受入はRoot担当。

## fresh setupと固定

[local手順](local-bun.md)の「前提・fresh setup」を**export PATHまで**実行し、cd／Git initは省く。導入Piのdocs/{rpc,rpc-commands,json,message-types,cli}.mdを全文readする。確認済み絶対Git／Node24／Bun1.3.0+／Pi、正常な既存Pi認証、macOS sandbox、専用HOME/PATH/TMPDIR/Git設定／架空identityを使用。source書込拒否とowned書込成功を照合し、auth独自read/copy/log、ambient Extensions/MCP/context、install、実repository／実remote mutationは禁止。

```bash
"$VERIFY_NODE" --test "$SOURCE/.pi/skills/verify-project/scripts/pr-fixture.test.ts" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.test.ts"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/pr-fixture.ts" setup "$OWNED" "$GIT" new "$VERIFY_NODE"
export PATH="$OWNED/bin:$(dirname "$VERIFY_BUN"):/usr/bin:/bin"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" snapshot "$OWNED" "$GIT" > "$OWNED/before.json"
```

setupはpush-fixtureの実Git/local bare・wrapper・観測を再利用。remoteは架空git@github.example.invalid:example/project.git、gh repositoryはgithub.example.invalid/example/project。SSH fixtureはssh -Gとそのrepoのupload/receive-packだけをowned bareへ接続し、gh fixtureはauth／metadata／list／create／viewと全文readbackを記録する。製品へfile URLを同repoとして許可せず、fixtureでGitを成功置換しない。seed pushは製品操作でない。

既存履歴＋今回diffはseed後、READMEを変更する前に`git switch -c feature/ready`→`prior.txt`を追加commit→README pendingにする（setup newのREADMEは一旦そのまま保持し、git add prior.txtだけ）。PR既存HEADはsetupをexisting、PR-onlyはさらに`git push -u origin feature/ready`してから観測logを開始する。outside.txtは対象外untrackedのまま。旧履歴は今回Gitleaks検査済みと呼ばない。

source版／dirty・関連SHA256 manifestをdocs/verification/<issue-number>/<一意run>/<case>/へrun前固定する。全製品TS／設定／Skill／共有手順、検証Skill／Map／関連手順／fixture／RPC／metric／使捨てdriverを含める。run中は編集せず、修正は終了wait／cleanup後に新fresh runへ。run終了時digest不変を照合する。

## 公開CLI: 実Gitのfocused代表

```bash
"$VERIFY_NODE" --test --test-name-pattern='PR ' "$SOURCE/tests/commit-workflow.test.ts"
```

新commit／既存HEAD／PR-only、base全体固定材料と一致単位、固定特殊文字／片側修正と旧参照拒否、未確定materials参照execute拒否、OPEN/CLOSED/MERGED非編集／非重複、準備PR消失／作成前競合、base/Draft再準備、commit後URL drift／送信後local ref drift、create異常応答／readback異常を選ぶ。scope外bytes保持、通常hooks、秘密非出力・未知file保持は共有Bun suiteのscanner／hook／private代表と対応する。内部handler成功mockで代用しない。

## fresh Pi: 通常承認と本当のfollow-up

既存RPC helperをread,bashだけで起動する。使捨てdriverを完成・digest固定してから起動し、親PID／DRIVER_PIDを直後に記録、同じ親shellでwait／exit保存する。以下は片側修正→設定再準備→通常承認を同一sessionで観測する例。

```bash
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
 "$OWNED/repo" "$SOURCE/skills/commit-pr/SKILL.md" "$OWNED/evidence" \
 --fixture-remote --answer-file "$OWNED/answer1" \
 --follow-up-file "$OWNED/answer2" --follow-up-file "$OWNED/answer3" \
 --request '/skill:commit-pr README.mdだけ。remote origin、repository github.example.invalid/example/project、upstream設定、Draft。commit messageは docs: explain local example と末尾LF。PR titleは正確に docs: exact $HOME `code`、bodyは Summary: exact $HOME `code` 日本語 と末尾LF2個。' \
 > "$OWNED/driver.out" 2> "$OWNED/driver.err" &
DRIVER_PID=$!
printf '%s %s\n' "$$" "$DRIVER_PID" > "$OWNED/pids"
wait "$DRIVER_PID"
printf '%s\n' "$?" > "$OWNED/driver-exit"
```

別shellからoperations.jsonlのwaiting_for_answerと通常assistant完成一式／一括確認を実readする。想定外質問へ実行回答しない。get_commands=明示Skill1つ、通常provider/model/thinkingとdiagnosticなしを確認。承認前はStageと準備だけ、HEAD／全refs／bare refs不変、commit/push/PR作成0、必要privateは0700/0600でdiff/history/PR payload削除済み。

1. answer1へ「commit文章だけを docs: revised example と末尾LFへ修正。PR title/bodyは一字一句保持。」を書く。新planのmessageだけ変更とtitle/body bytes保持、旧参照失効をtool結果で照合。
2. 次のwaiting_for_answerを読んでanswer2へ「Draftを通常PRへ変更。他の固定文章は保持。必要準備をやり直して最終一式を再確認して。」を書く。cleanup→inspectから影響準備再取得、Stage残存、固定文章と通常PRを再提示し再質問することを観測。base変更代表はseedでrelease refを作りrequestでbase releaseへ変更する。
3. 次の最終一式を読んでanswer3へ「提示内容で実行」を書く。新たな文章生成なし、参照だけexecute1回、途中LLM判断0を照合する。RPC text承認をask_user_question renderer／TUI実証と呼ばない。

終了後push-fixture observeとpr-state.json／git.jsonl／gh.jsonlで実commit親／tree／raw本文、元ref／scope外保持、必要push1（PR-onlyは0）、bare SHA=HEAD、固定PR title/body bytes／通常またはDraft／head/base名と両SHAを照合する。PR-onlyは新commit／message修正選択肢なし。既存PRは全state報告だけ、残操作なしなら不要承認なし。

## commit後／送信後driftと開始後fallbackなし

別fresh fixtureで通常承認前にhookを設置し、hookもmanifest固定する。post-commitで`git remote set-url origin https://other.example.invalid/wrong/repo.git`ならcommitVerified=true・pushAttempted=false・PR create0を期待。pre-pushで`git update-ref refs/heads/unplanned HEAD`なら固定SHA送信成功を保持し、post_push_local_verification_failed・PR create0。正常hooksは無効化しない。ghのcreate-response/readback fault代表はpr-state.jsonのfaultを設定し、前者は作成済み可能性、後者はPR全文検証失敗を観測する。

公開CLIとfresh Piの代表で、先行成功をrollbackせず、失敗後の追加mutation／Python／手書き代替／install／経路変更0を全tool操作と実Gitで照合する。利用者設定や実remoteを故意に壊さない。

## Bun不在: PR／PR-onlyを別fresh状態で停止

[localのBun必須停止](local-bun.md#bun必須-不在非対応確認不能のgit変更前停止)のowned utility symlinkを作り、**起動前からPATH=owned/bin**にする。bin/git／gh／ssh fixtureは上書きしない。Bun／PythonがPATHにないことを確認、観測者は確認済み絶対Nodeを使う。new pending PRとexistingをpush済みにしたPR-onlyを別fresh setupで実行する。

```bash
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" snapshot "$OWNED" "$GIT" > "$OWNED/before-stop.json"
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
 "$OWNED/repo" "$SOURCE/skills/commit-pr/SKILL.md" "$OWNED/evidence" --fixture-remote \
 --request '/skill:commit-pr --no-confirm README.mdだけ。remote origin、repository github.example.invalid/example/project。'
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/push-fixture.ts" snapshot "$OWNED" "$GIT" > "$OWNED/after-stop.json"
cmp "$OWNED/before-stop.json" "$OWNED/after-stop.json"
```

PR-only requestは「push済み既存HEADからPRだけ」と明示する。必要条件Bun 1.3.0以上案内、index bytes／HEAD／全refs／branch／upstream／worktree／bare不変、Stage/commit/push/PR0、Python／手書きmutation／install未試行を全tool操作とGit／gh logで照合。snapshotはread-only（write-treeなし）、log未作成は0回。非対応version／不正probeは共有起動経路代表をlocal手順から選び、古Bunをinstallせずversion応答fixtureはAgent停止分岐だけと明記する。対応実Bunの起動汚染防止は共有公開CLI testを使う。

## 証拠／metric／cleanup/readback

source版／dirty／digest、環境、全コマンドexit、期待／観測／成功・失敗・未確認、before／承認前／after snapshot、fixture由来と確認した必要operations.jsonl・git.jsonl・gh.jsonl・pr-state.json・cleanup.jsonを保存。認証／秘密／不要raw logは保存しない。既存summarize-commit-rpc.tsで全assistant request、承認前／待機／承認後／全工程、生成codeと固定CLI／payload、usage／unknownを記録しnested tool二重計上しない。修正／再準備の複数回答では各waiting時刻も残し単一承認のmetricと区別する。単発速度改善と呼ばない。

helperのstdin close→Pi wait→所有group不存在、所有DRIVER_PIDの同親waitをcleanup証拠で確認。別groupの所有hook等も終了確認後、source／driver manifest一致と必要証拠をowned外へ保存し、自分のOWNEDだけcleanup。unknown lock／他runは削除せず報告。cleanup後run READMEから全証拠参照を実readする。Mapにrun履歴を混ぜない。

再利用は本repoでproject trust確認、新sessionまたは/reload、`/skill:verify-project commit-pr Bun`またはこの実ファイルを明示read。Rootは別fresh状態でPR正常／commit後停止／修正／runtime停止を独立確認する。
