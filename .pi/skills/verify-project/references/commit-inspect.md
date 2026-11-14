# commit_inspect: 取得・即時表示・nonTUI・cancel・reload

初期対象は専用toolだけ。4 Skill入口の新tool選択・release分岐・一括read・前後比較は[共有W2照合](local-bun.md#w2-通常skill接続readrelease分岐の照合)と組み合わせ、この手順のtool単独成功から推定しない。実Pi 1.4.0を対象とする。色生成失敗／不正応答は`tests/commit-status.test.js`の限定testで確認し、実端末を壊さない。

## fresh setupと公開入口

[local手順](local-bun.md)のfresh setup／sandbox／専用HOME・PATH・TMPDIR・Git設定・架空identity／通常認証／manifest／同親wait／cleanupをそのまま使う。sandbox allowlistを広げず、auth独自read/copy/log・ambient resources・install・実remote・実repository mutationは禁止。Piの導入版docs/{extensions,tui,cli,rpc,rpc-commands,json,message-types,session-format}.mdとexamples/extensions/hello.tsを読む。公開`tool_execution_update.partialResult`と`ExtensionContext.abort()`の型はPi v1.4.0固定sourceでも確認する。

global SYSTEM／APPEND_SYSTEMの自動探索は`--no-context-files`だけでは無効にならない。全modeとreloadでownedの空regular file（run前作成・digest固定）を`--system-prompt`へ、固定の隔離指示を`--append-system-prompt`へ明示する。空system fileはPiの通常default preambleを維持する。既存RPCはこの明示を内部で行う。TUI [Context]とowned標準sessionのsystem出典を照合し、ambient本文は証拠へcopyしない。

base作成時に`old.txt`もcommitし、pending変更で`git mv old.txt renamed.txt`、READMEの一部だけ`git add README.md`してから別の行を追記する。Untrackedも1件追加する。HEAD／全refs／raw index／tracked・untracked bytesを起動前後に比較する（既存push-fixture.tsのread-only snapshotを使える）。inspectはprivate準備を作るがGitは変えない。

起動前に製品extension／CLI一式、関連検証Skill／Map／本手順／RPC／metric／observer／使捨てdriverのdigestを固定する。run中編集しない。変更が必要なら終了wait・owned cleanup後に別fresh runへ。

新toolはmodel-only。modelにrepository実ルート絶対pathと`input:'{"mode":"commit"}'`を渡して**直接**`commit_inspect`を1回呼ぶよう依頼する。codemode／ctx.executeToolで代用しない。取得後は停止しStage・plan・executeを行わない。最終assistantは一覧を繰り返さず短い識別文だけを返す。これは専用toolの公開入口確認であり、未接続の4 Skill経路の実証ではない。

## RPCとprint／JSON

既存RPCは無extension経路を既定のまま維持する。対象extensionを選ぶ場合だけ次を追加する。`--tools`はplain allowlistであり、codemodeを含めない。旧tool比較時だけ`commit_status_display`も指定する。`get_commands`はtool一覧ではない。直接toolCall名／IDを確認する。

```bash
"$VERIFY_NODE" "$SOURCE/.pi/skills/verify-project/scripts/commit-rpc.ts" \
 "$OWNED/repo" "$SOURCE/skills/commit/SKILL.md" "$OWNED/evidence" \
 --extension "$SOURCE/extensions/commit-status.js" \
 --tools read,bash,commit_inspect,commit_workflow --request "この隔離repository $OWNED/repo をcommit_inspectで直接1回inspect。inputはJSON文字列でmode=commit。Stage等はせず停止。結果の一覧は繰り返さずINSPECT_DONEだけ回答。"
```

`tool_execution_update`成功は1回、最終resultのcontent末尾JSONとdetailsが完全一致すること（`{bun,result}`）、reference／branchPolicy／default／evidence／questions／pathBytesを確認する。正常inspectにphaseはない。一覧は色なしでcontentに残る。現在branchの最終成功inspect detailsからBunを取得するcommit_workflowへoperation:"cleanup", input:{reference:REFERENCE}を直接渡し、cleanup.completeとdirectory不在を確認する。所有検証を迂回しない。

print／JSONは同じ隔離引数（`--no-extensions -e EXT --no-mcp --no-skills --no-context-files --no-prompt-templates --no-themes --offline --no-approve --tools read,bash,commit_inspect,commit_workflow`）でそれぞれfresh Piを起動する。`--print` stdoutはfinal assistantだけなので一覧保持の証拠にしない。`--session-dir "$OWNED/sessions"`で作る標準sessionのtoolResultからcontent/detailsを抽出する。JSONは`--mode json`のtool_execution_endを抽出する。raw provider／system prompt／thinking／signatureは証拠へcopyしない。

## 実TUIとreload

OSに導入済みtmuxを使う（追加installなし）。以下はlocal fresh setup後の同じBashで実行する完全な起動例。`TMUX_BIN`は導入実体を確認して指定する。初回`-f /dev/null`で利用者tmux設定を読まず、全呼出しでprivate `-S`を指定する。Pi 1.4.0のこのmacOS実機では`< /dev/tty`だと描画してもキー入力が反映されなかったため、**同じowned paneの具体tty**をstdinに開く（別pane／利用者terminalは使わない）。background stdinの/dev/null化も避ける。

```bash
TMUX_BIN=/opt/homebrew/bin/tmux # この環境の導入済み実体を確認
"$TMUX_BIN" -S "$OWNED/socket" -f /dev/null new-session -d -x 120 -y 60 \
 -s verify '/bin/bash --noprofile --norc +H'
"$TMUX_BIN" -S "$OWNED/socket" set-option -t verify remain-on-exit on
PANE_TTY=$("$TMUX_BIN" -S "$OWNED/socket" display-message -p -t verify '#{pane_tty}')
PANE_PID=$("$TMUX_BIN" -S "$OWNED/socket" display-message -p -t verify '#{pane_pid}')
: > "$OWNED/empty-system.md"
cat > "$OWNED/tui.sh" <<EOF
set +m
cd "$OWNED/repo" || exit 1
export HOME="$HOME" TMPDIR="$TMPDIR" PATH="$PATH"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
export VERIFY_COMMIT_OBSERVATIONS="$OWNED/observations.jsonl"
unset VERIFY_COMMIT_ABORT_AFTER_REFERENCE
# 取得後cancel代表だけ上行の代わりに export VERIFY_COMMIT_ABORT_AFTER_REFERENCE=1
/usr/bin/sandbox-exec -f "$VERIFY_SANDBOX" "$VERIFY_PI" \
 --system-prompt "$OWNED/empty-system.md" \
 --append-system-prompt 'Disposable isolated verification. Operate only in the target repository and owned HOME/TMPDIR. Never access credentials or user settings. Never install, contact remotes or change source.' \
 --no-extensions --extension "$SOURCE/extensions/commit-status.js" \
 --extension "$SOURCE/.pi/skills/verify-project/scripts/commit-observer.js" \
 --no-mcp --no-skills --no-prompt-templates --no-context-files --no-themes \
 --offline --no-approve --tools read,bash,commit_inspect,commit_workflow \
 --session-dir "$OWNED/sessions" < "$PANE_TTY" &
p=\$!
printf '%s %s\\n' "\$\$" "\$p" > "$OWNED/pids"
wait "\$p"
code=\$?
printf '%s\\n' "\$code" > "$OWNED/pi-exit"
exit "\$code"
EOF
# ここでtui.sh／empty-system.mdと関連sourceのdigestを固定してから起動する。
"$TMUX_BIN" -S "$OWNED/socket" send-keys -t verify -l "/bin/bash '$OWNED/tui.sh'"
"$TMUX_BIN" -S "$OWNED/socket" send-keys -t verify Enter
```

`session_start`だけで入力可能とせず、`capture-pane -p`でeditor／footerと[Context]がowned空fileだけ、[Extensions]が明示2つだけと確認する。`pids`のparentとPi PIDを外側`ps -o pid,ppid,pgid,stat,comm -p ...`で照合し、専有PGIDを記録する（Pi PID=PGIDとは限らない）。sandbox内ps禁止を迂回しない。pane内の同じ親がwaitしてexitを保存するので、別shellから無効なwaitをしない。外側controllerをbackgroundにするならそのcontrollerも同じ親でwaitする。

無秘密fixture専用の観測extension`../scripts/commit-observer.js`を明示`-e`で追加できる。`VERIFY_COMMIT_OBSERVATIONS="$OWNED/observations.jsonl"`（parent0700・file0600、symlink不可）を指定する。read／bash／commit_status_display／commit_inspectの公開start/end（read結果本文は除去、resultBytesとread引数は保持）、commit_inspect／commit_workflowの公開update、user時刻／assistantの非thinking記録／最初の本文delta時刻／reload時の過去commit_inspect／commit_workflow content/detailsを記録し、tool実行・renderer・provider応答を置換しない。run前self-checkは`node --test .pi/skills/verify-project/scripts/commit-rpc.test.ts`。logに秘密を含まないfixtureだけで使う。

`send-keys -l`でprompt、入力反映を待って別呼出しで`send-keys Enter`（paste処理が未完了なら再度Enter）。`capture-pane -p`と`capture-pane -p -e`（属性付き）を時刻付きで取得する。`-a`はinactive alternate screenなので使わない。tool更新を検知したら繰り返しcaptureし、一覧の見えるsnapshotと次assistant本文の最初のdeltaを対応させる。**tool終了時刻を描画時刻と呼ばない**。モデルが速すぎて間のsnapshotがなければ順序は未確認。snapshotは実PTYのtmux解釈済みセルであり物理terminal screenshotではない。

操作例（ready確認後）:

```bash
PROMPT="Call commit_inspect directly exactly once with repository $OWNED/repo and input JSON string {\"mode\":\"commit\"}. Do not call other tools, Stage, plan or commit. After the result respond only INSPECT_DONE; do not repeat the list. If it fails, stop without retry or fallback."
"$TMUX_BIN" -S "$OWNED/socket" send-keys -t verify -l "$PROMPT"
# paste処理後にEnterを送る。画面に入力が見えなければ使用可能状態を再確認する。
sleep 0.3
"$TMUX_BIN" -S "$OWNED/socket" send-keys -t verify Enter
# 以下を必要な時点に反復し、各captureの直前・直後の時刻も保存する。
date -u '+%Y-%m-%dT%H:%M:%SZ'
"$TMUX_BIN" -S "$OWNED/socket" capture-pane -p -t verify
"$TMUX_BIN" -S "$OWNED/socket" capture-pane -p -e -t verify
```

一覧は一度だけ、部分Stage／renameは実Gitと一致、path／状態名にdotの専用色なし、通常assistantに同じ一覧なし、content末尾JSON=detailsを照合する。idle後`/reload`を入力し、`session_start reason=reload`と過去detailsの一致・実画面の一覧保持・新inspect call0を確認する。その後新promptで同じ完全referenceをcommit_workflowのcleanupへ渡し、再inspect／手動probe／PATH再探索なしでlookup成功・cleanupを確認する。永続registry・reference再解決を作らない。終了はidleでCtrl-D、必要ならもう一度。所有Pi group不存在とpane親wait後、専用tmux serverだけ終了しsocket/server不存在を確認する。

## 通常cancelの取得前後とBun不足

- **取得前**: owned Git logging wrapperで実Git status到達marker（PID付き）を書いてから、同じstatus引数を実Gitへ渡す直前で保持する。markerとsuccess update0を確認した後、TUI EscapeまたはRPC abort-file（private regular fileに`abort\n`）で通常cancelする。単なるsleep時刻だけで境界認定しない。childとgroup終了、最終isError／processExitConfirmed、referenceなし・cleanup未確認／残存可能性・未知directory探索削除0を照合する。fixture全体の検証者cleanupと製品所有cleanupを混同しない。
- **取得後**: 通常の割込み窓は短い。観測extensionを明示ロードし`VERIFY_COMMIT_ABORT_AFTER_REFERENCE=1`を指定すると、検証済みreferenceの公開success updateを記録してから同期`ctx.abort()`を発火する。これは実Piの通常abort経路であり物理Escape実証ではない。最終isError／details.error=cancelled／同じreferenceとBun／所有検証cleanup.confirmed／cleanup.complete／実directory不在／Git不変を確認する。TUIは`context.isError`で失敗を表示し、保持したdetails.resultを成功一覧として描かない。throwで失われるdetailsをPiが復元する前提にしない。
- **Bun不足**: [localのBun必須停止](local-bun.md#bun必須-不在非対応確認不能のgit変更前停止)のutility-only PATHでfresh Piの新toolを直接呼ぶ。絶対Node観測者を使い、Git snapshot不変・Stage0・fallback/install0を全tool記録と照合する。非対応／不正probe・色失敗／不正inspectは限定自動testの証拠を分ける。

## 証拠・計測・handoff

`docs/verification/<issue-number>/<一意run>/`へsource版／dirty／digest、版／操作exit、期待／観測／未確認、必要tool結果／Git snapshot／時刻付きPTY snapshot／metric／cleanupを保存する。既存metricは全assistant requestとturn毎tool ID、read引数（同ターン性／tail取得）、arguments/result bytesを保持する。bytesは転記の意味分類ではない。意味分類・転記payload量・tool内区間・TUI描画時刻は別の手観測がなければunknown。toolとLLM／待機・nested呼出しを二重加算しない。

W2の比較baselineはIssue52の`docs/verification/52/baseline-20261112T130950Z/manifest.json`とそのread-only source（HEAD `1b660704018a2949f359e538e684e51dc9559561`、manifest SHA256 `55f2c363898cd56726288226afcf71aefd89d799c8346c9be43d4b43f29d3348`）。local保全物であり配布ファイルではない。これはIssue52のW2 handoff専用で、通常の本手順再利用に必要な前提ではない。W2比較とRoot確認終了まで変更・削除しない。

終了時はidleで`send-keys -t verify C-d`、必要ならもう一度。`$OWNED/pi-exit`を読み、記録した専有PGIDへsignal 0でESRCH、所有Pi PID不存在を外側で確認する。stdinが反応しない等の異常時は所有Pi PIDだけへTERMを送り、pane親がwait exitを保存するまで待つ（親ごとkillしてwait証拠を失わない）。`"$TMUX_BIN" -S "$OWNED/socket" kill-server`後に同socketの`list-sessions`非0／server不存在を確認する。未確認processがあれば環境を保持し報告する。

所有PID／専有PGIDの同親wait・group不存在・owned server終了後だけowned環境を削除し、unknown lock／他runは保持する。証拠は残し、cleanup後にrun記録と全参照を実readする。Rootは会話履歴・前回path・稼働processなしの別fresh状態で再実行して独立受入する。全suite／pack／Reviewは別責務であり、この手順の文言assertをAgent動作の証拠にしない。
