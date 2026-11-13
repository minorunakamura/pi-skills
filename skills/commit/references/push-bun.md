# commit-push: Bun標準手順

到達点はpushのみ。PR準備・gh・PR APIは0。新commit／既存HEADとも、必要準備→完成文章／操作のprivate保持→通常assistant一括確認→参照だけexecute→固定SHA push／readback／予定upstream／cleanupを行う。準備失敗からcommitだけへ縮小しない。旧Python／Codemodeは呼ばない。

入口で[共有local手順](local-bun.md)と本手順を同じassistant turnに全文readし、切断時はtailを取得する。PR > push > localの優先順位で、**起動・scope／疑わしい対象・Stage／全Staged検査・固定材料読取・private参照／release／cleanup・文章／一括承認・失敗停止**を共通利用する。ただしlocal2入口のdefault判定・default質問・空diff即終了・mode／branch方針・通信禁止はこの入口には適用しない。以下がpush用の差分であり、省略しない。

## 0. 起動とStage前

共有local手順のtool選択を使う。利用可能な`commit_inspect`を実repositoryと以下の完全なinspect入力で直接1回呼び、完全結果／referenceと返されたBun絶対実体を後続の全保護CLI呼出しへ引き継ぐ。手動probe・inspect・JSON転記・重複一覧は不要。開始時から`commit_inspect`が利用不能な場合だけ既存Bun確認＋CLI inspect＋通常テキスト表示。Bun 1.3.0以上の確認不能／開始後の失敗はStageを含むGit変更前に停止し、fallback／installしない。

**`commit_inspect`でもCLIでも、既存HEADまたは対象変更がある場合は`mode:"push"`に加え、`push.remote`が必須。modeだけでは呼ばない。** inspect前に`git remote`とlocal設定で宛先を確認し、ユーザーの明示先を優先、曖昧なら実質問する。例のoriginを推測採用しない。HEADも対象変更もない場合だけ宛先設定を省略できる。

`commit_inspect`呼び出し例：

```json
{"repository":"/absolute/path/to/repo","input":"{\"mode\":\"push\",\"push\":{\"remote\":\"origin\"}}"}
```

以下は**`commit_inspect`が開始時から利用不能な場合だけ**使う同じ入力のCLI実行例。保護probeと全起動条件（trusted cwd・環境除去・同梱config・env-file・no-install）は共有local手順どおり。

```bash
cd "$SCRIPTS" || exit 1
printf '%s\n' '{"mode":"push","push":{"remote":"origin"}}' | env -u BUN_OPTIONS -u NODE_OPTIONS "$BUN" --config="$SCRIPTS/bunfig.toml" --env-file=/dev/null --no-install "$SCRIPTS/commit-workflow.ts" inspect --repository "$REPOSITORY"
```

以下も同じ起動形でoperationだけ置換しstdin JSONを渡す。push設定は`remote`必須、`target`省略時は予定branch名。`setUpstream`省略時は、予定branchのremote／merge設定が両方未設定ならpush先をupstreamに自動設定し、設定済み（片側だけ／空値／値なしも含む）なら既存設定を保持する。自動設定だけのための追加質問はせず、設定先を最終一括確認に含める。利用者が設定不要と明示した場合は`setUpstream:false`で未設定を維持する。`true`の明示指定は未設定または同じ指定先だけを許し、異なる既存設定は上書きせず停止する。新branchはinspectの`newBranch`で明示でき、未指定名は材料の意味から後で決める。資格情報入りURLや複数push URLを拒否し、生設定／秘密値を表示しない。

inspectは通信せずlocal push URL（pushInsteadOf等のrewrite後）／順序付きfetch設定／SSH解決を保持する。SSHではssh -Gのalias解決を照合し、core.sshCommand／GIT_SSH_COMMAND／GIT_SSHは拒否する。local bare／file URLも対応。HEADも選択した変更もなければremote設定不要。

一覧は共有のtool表示（開始時から`commit_inspect`が利用不能な場合だけ通常テキスト）とし、重複表示しない。scopeはall／paths／staged（無指定は全変更、Untracked／部分Stage残り含む）。outsideStaged／suspiciousは共有手順どおり実質問し、実回答だけmaterialsへ。detached／競合／MERGE_HEAD／dirty nested submodule／終点矛盾はStage前停止。pushは**通信したremote defaultとmain**でbranch方針を決める。local default疑義を理由に余分なdefault質問をしない。

## 1. materials: 新commit要否とpush材料

`{"reference":REFERENCE}`に必要な実回答（includeOutsideStaged／reviewedPaths）だけを追加する。scope／状態を照合→必要Stage→全Staged Gitleaks検査→remote準備を行う。Stageは承認前で、cancel／失敗でも残り得る。reset／unstageしない。

- HEADも対象diffもなければ`phase=empty`で通信・commit・branch・通常承認なし。
- `phase=materials`の`commitNeeded=true`は新commitが必要。固定Staged材料から文章を作る。scanner=unavailableは新commitの未検査と明示する。
- `commitNeeded=false`は既存HEADをそのまま送信する。messageもcommitも作らない。対象外worktreeを取り込まず、既存履歴を今回Gitleaks検査済みと呼ばない。空commit／amend／再作成なし。
- remoteの**全refs**を観測してdefault／全空判定を確定し、送信履歴と必要object／祖先関係を確認する。不明default／non-fast-forward／必要object欠落／通信失敗はcommit前停止。PR材料／APIは使わない。
- 小材料は一覧／固定diff／送信履歴`history`／HEADから直近最大5件の`recentHistory`を一括。新commitの言語・形式は共有local手順に従い`recentHistory`から判定する。送信履歴は5件に制限しない。大材料の未表示を明示し、共有のreadで必要な複数bytes範囲をまとめて読む。直近履歴は`name:"recent-history"`と`recentHistoryBytes`を使う。readの`material_display_budget_exceeded`かつ`materialsPreserved=true`だけは、応答のreferenceで要求量を減らして読み直す。準備／Skill全体の再実行は不要。意味不明を推測しない。質問前にはreleaseで不要diff／historyを削除する。

`branchPolicy.createBranch=true`ならmain／remote defaultから、または明示新branch指示から未存在作業branchを1件計画する。既存HEADも同じ方針で、元refを保持して同SHAの新branchだけを承認後に作る。`false`なら現在作業branchを維持する。新branch名の形式／namespace衝突（dangling含む）／残存upstream設定を拒否し、既存branchへ切替・上書きしない。

通常のtarget=main／remote defaultは拒否する。**利用者が明示した初回main pushだけ**inspectの`push.initialMain:true`を使う。remote全体がtag等もなく空、送信元現在branchも予定branchもtargetもmainの全条件が必要。no-confirmから推定しない。新branch指定と混ぜない。

## 2. plan: 全準備完了・保持と一括確認

stdinは`{"reference":REFERENCE}`に、commitNeeded=trueなら`message:"完成文章\n"`、新branchが必要なら`newBranch:"docs/example"`を追加する。既存HEADではmessageを渡さない（拒否される）。target省略ならこの具体名で宛先を確定する。branch／宛先／URL／upstreamとremote target/default SHAの準備は**新commit前にすべて完了**し、状態driftを新値で吸収しない。

追加質問なしなら材料から直接planへ進み、独立releaseを省く。先に質問が必要ならrelease成功・返却reference採用後だけ質問する。失敗／削除拒否は共有local手順どおり停止・cleanup／残存を報告する。

`phase=already_pushed`なら同SHA再push・commit・通常承認なしで`cleanup.complete`と残存を確認・報告する。残るbranch／upstream操作があればplanになる。

`phase=plan`は確定文章／操作がimmutable private保持され、`payloadRemoved=true`を確認してから提示する。返された新referenceだけを採用する。通常assistantで次をまとめて表示する。

- 新commitがある場合だけ返された完成messageを1 code block。固定bytes／言語／形式を維持し、WHY／Issue／未実施テスト成功を創作しない。
- scope／Stage／scanner、元branchと予定branch（必要時だけ新規、元ref保持）、親／tree。既存HEADの場合は送信対象が既存履歴で新commitなしと明示。
- **remote・実push URL・target（refs/heads/...）・予定upstream（設定先か既存保持）**、remote default／初回例外、操作一式（必要branch→必要commit→検証→固定SHA push必要時だけ→送信readback→予定upstream→cleanup）。

表示後に通常一回のask_user_question（なければ通常テキスト）で`提示内容で実行`／新commit時だけ`commit文章を修正`／`実行設定を修正`／`キャンセル`＋自由回答を求める。script成功／参照存在は承認でない。no-confirmはこの通常承認だけ省略し、同じ表示／保持／検査を行う。存在しないPR文章／commit文章の修正選択肢は出さない。

文章修正は同じplanへ現参照と修正messageだけ。予定branchを保持し、旧参照失効後に最終一式を再提示・再承認。設定変更はcleanup→新inspectから影響準備を取り直し、Stage残存を説明して再確認。cancelはcleanupして終了。driftを自動再準備しない。

## 3. execute: 参照だけで終点まで

承認後は`{"reference":REFERENCE}`**だけ**でexecuteを呼ぶ。文章／設定再送・途中LLM判断・コード／文章再生成なし。直前照合→必要branchだけ作成（通常post-checkout有効）→必要commitだけ作成（通常hooks）→raw本文／親／tree／index／ref検証→remote再照合→**固定SHA:refs/heads/target**の明示refspecでpush→送信SHA readback→許可したtracking refだけ照合→予定upstreamだけ設定／照合→cleanupを行う。

force／mirror／暗黙tags／submodule送信はしない。最初のpositive fetch mapping先のtracking refだけ、元値のままか予定SHAへの更新を許す。negative等のrefspecにより実Gitが更新しない場合もあり、未更新を送信SHAに読み替えない。そのmapping先がlocal branch／tagまたはsymbolic ref（未解決も含む）ならplanで拒否し、実行時もbranch／commit／push前に再確認する。local default逆mappingとは別の意味。upstreamの設定が予定されている場合は未設定または同じ予定先だけ受け付け、送信確認後だけ更新する。同SHAが送信済みでも未設定upstreamの自動設定は行い、再pushしない。元ref／他refs／対象外worktree／無関係なupstreamを保持する。

phase=pushed／already_pushedの実SHA・branch・commitCreated／pushSent／pushVerified／upstreamConfigured／cleanupを通常assistantで報告する。非0／不正応答／drift／成否不明は後続mutation停止。branchCreated／branchMayHaveChanged、commitSucceeded（成功応答）／commitVerified、pushAttempted／pushSucceeded（成功応答）／pushVerified（readback）、remoteObservedを区別する。push失敗をcommit失敗と言い換えず、先行成功を保持する。timeout等は送信済みの可能性がある。upstream更新／事後照合／cleanup失敗は送信成功と別に報告し、自動retry／rollback／resume／別経路なし。

cleanup complete=falseはGit成否と独立した残存報告。所有確認できないもの／未知sentinel／別runは消さない。確認と操作の完全atomic性／任意強制中断時のcleanup必達は保証しない。
