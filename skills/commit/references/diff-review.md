# 差分の段階的な確認と一時ファイル

標準・互換経路の両方で使う。[workflow.md](workflow.md)の手順2から読み、新commit時はcommit前にStagedと予定PR全体を並行準備する。対象差分なしの既存HEAD時はStaged検査を行わず、必要なPR全体（唯一のmerge-base(base, HEAD)→HEAD tree）と既存履歴を確認する。commitのみ／pushのみでは不要なPR材料を取得しない。commitメッセージに必要な内容確認と、完全な差分の機械的な同一性判定を分ける。要約だけで未確認の変更を理解したことにしない。

呼出し間で以前の理解・承認を無条件に引き継がない。今回確認した完全diffと一致する理解だけを、この実行中に再利用する。既存HEADの準備・verify／checkはcommit結果を使わず、固定HEADのdiff／履歴／index・refsを照合する。

## 1. 全体像から必要箇所へ

- Stagedでは、まず既存の状態取得結果と`git --no-pager diff --cached --no-ext-diff --no-textconv --ignore-submodules=none --stat`・`--numstat -z`等でファイル・変更種別・変更量を把握する。概要と本文は同じ差分に基づくことを確認する。NUL区切りのパスを改行・空白で分割したり、制御文字を無加工表示したりしない。
- 本文は下記のcanonical diffを内部で保持し、必要なファイル・hunkだけを順に表示する。作業ツリーのファイルを代わりに読まない。概要だけでは分からない独立した変更、削除・rename・binary・mode変更も確認する。未確認部分が説明に影響するなら追加で読むか、理解できない理由を示して停止する。
- 表示はツールの出力上限内に収める。切り詰めがあれば、その応答を完全なdiffとみなさず、欠けた必要箇所だけを読み足す。複数の大きな断片を一括出力し、切り詰め後に重複して読み直すことを避ける。
- 全体像・確認済み箇所・変更の要点・未解決の疑問・完全なdiffのdigestを呼出し元で保持する。単なるdigestの取得は内容確認ではない。全ファイルの変更目的が説明でき、WHAT・WHY・分割判断に必要な疑問が解消するまで確認する。
- Codemode等でツール結果を内部処理できる場合は、巨大な結果をそのまま`text()`等へ渡さず、必要な概要・部分だけを出力する。`github-pr.py prepare`のJSONは改変せず保持し、表示用のコピーから`diff`を除く。保持ツールの容量上限を超えるJSONは下記のprivate directory内の権限制限したファイルで保持し、全文を`read`しない。永続的な承認DBにはしない。

## 2. 安全な一時diff

一時ファイルが必要な場合だけ作る。OSの信頼できる一時領域を親にし、`mktemp -d`で毎回新しいprivate directory（`0700`）を確保する。固定名の`/tmp/...diff`、時刻・PIDだけの名前、既存directoryの再利用はしない。実体パスでrepository外と確認する。以下は対象repositoryをcwdにして、第1引数に信頼できる一時親directory（例：`/tmp`）を渡して実行するshell例。

```sh
repository=$(git rev-parse --show-toplevel) || exit 1
repository=$(cd "$repository" && pwd -P) || exit 1
temp_parent=$(cd "${1:?trusted temporary parent required}" && pwd -P) || exit 1
case "$temp_parent/" in
  "${repository%/}/"*) printf '%s\n' 'temporary parent is inside repository' >&2; exit 1 ;;
esac
umask 077
review_dir=$(mktemp -d "$temp_parent/pi-commit-review.XXXXXXXXXX") || exit 1
if ! git --no-pager diff --cached --no-ext-diff --no-textconv --binary --no-color --ignore-submodules=none > "$review_dir/staged.diff" || ! test -s "$review_dir/staged.diff"; then
  rm -f -- "$review_dir/staged.diff"
  rmdir -- "$review_dir"
  exit 1
fi
printf '%s\n' "$review_dir"
```

- 成功時のdirectoryパスだけを保持し、その中で`staged.diff`・`pr.diff`等の用途別名を使う。完全なdiffを保存し、改行変換・末尾改行の除去・表示用の省略はしない。
- fileは`0600`とする。`umask`は別のツール呼出しには引き継がれないため、保存するshell呼出しごとに`umask 077`を設定する。別の書込みツールでもこの権限を保証する。PRのdiffは`PR_PREPARATION.diff`をUTF-8で、JSON全体は保持した値を欠落なく保存する。確認できない切り詰め・取得失敗では停止する。
- directory作成・書込み・コマンドの終了コードをそれぞれ確認する。`mktemp`失敗時に固定名で代用しない。stdout/stderrを捕捉する場合も同じ権限にする。検出値やscannerの生出力、diff内の秘密情報を説明やエラーログへ転載しない。

## 3. 同一性判定と再利用

- 標準経路では、確認したcanonical Staged diffの**生のバイト列全体**のSHA-256を計算し、`staged-commit.py check`の`snapshot.diffSha256`と照合する。次の例は第1引数をdiffのパスとし、`python3`は開始時に選択した実行ファイルに置き換える。`-I -S`でrepositoryや環境変数由来のPythonコードを読み込ませず、ファイル全体をLLMへ返さない。

```sh
python3 -I -S -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"
```

- 互換経路では、同じ完全なdiffを`git hash-object --stdin`へ渡したdigestで観測値を照合する（`-w`なし）。標準経路のSHA-256とは比較しない。全Staged差分のGitleaks検査と検査前後・操作直前の照合は省略しない。
- 予定PRは準備が返した唯一のmerge-base(base, 親HEAD)→index treeのブランチ全体diffを対象に、ファイル一覧・変更量・既存commit履歴を把握する。標準経路の概要をGitで取る場合も固定したmerge-base／treeを使う。今回の未作成commitは別に扱い、SHAを捏造しない。確認済みStaged diffと同じだと仮定しない。
- 完全な2つのdiffを比較するなら、次の例に各ファイルのパスを第1・第2引数で渡す。終了コード`0`だけが一致、`1`は相違、その他は比較失敗。相違なら下記の変更単位で再利用を判断して異なる必要箇所を確認し、比較失敗なら停止する。一致した場合でも未読の履歴・テンプレートは確認する。

```sh
cmp -s -- "$1" "$2"
```

- digest比較でも、同じアルゴリズム・同じcanonical形式の完全なバイト列を使う。切り詰められる`read`結果・表示用の文字列・stat・要約を比較しない。部分diffのdigestを全体のものとして扱わない。
- commit・push・PR作成の承認やscriptのsnapshot照合を、digest一致で代替しない。固定した準備と実行時の不一致なら古い内容確認・承認で進めず停止する。Staged対予定PRの通常の相違とは区別する。

### 並行準備の完全digestと変更単位

到達点がPRなら新commit／push前に準備する。既存HEADでもPR全体と履歴を今回改めて確認し、今回commitを作らないのにStaged diffやcommit文章を作らない。commit用Stagedの理解をPR全体へ無条件に広げず、同一と機械的に確認した単位だけを再利用する。

- `github-pr.py prepare`は、唯一の`merge-base(baseHead, 親HEAD)`から保持したindex treeまでの予定PR全体を返す。`diffSha256`は`--no-ext-diff --no-textconv --binary --no-color --no-renames --ignore-submodules=none`による**完全bytes**のSHA-256、`mergeBase`はその起点。`commits`は既存branch履歴だけで、今回予定するcommitのSHAや本文と混同しない。既存PRでは新規文章用の`diff`はnullだが、照合用digest・unitsは保持される。
- `units`の各要素は`{path, oldMode, newMode, oldOid, newOid}`。`git diff --raw -z --no-abbrev --no-renames`相当のpath・mode・完全OIDによる変更単位であり、パスを空白・改行で分割しない。Staged側も保持した親HEAD／index treeに対応する同じraw形式で比較できる。Stagedの完全diff digestは引き続き`COMMIT_CHECK.snapshot.diffSha256`を使う。
次はルートをcwdとして、第1引数を固定した親HEAD（PR側はmerge-base）、第2引数を予定index treeにした変更単位の取得例。NULを保持して解析し、raw headerのold/new modeと完全OID、および次のNUL区切りpathを対応させる。初回ローカルcommitのStaged側は`--cached`の同じraw形式を使える（PRの親／base不足を回避するものではない）。

```bash
git --no-pager diff --raw -z --no-abbrev --no-renames --no-ext-diff --no-textconv --ignore-submodules=none "$1" "$2" --
```

- PR全体のdigestがStagedと異なっても、**全5フィールドが一致する単位**の確認済み要点は再利用できる。既存branch commitが同じパスを変更している場合、new blobが同じでもold blobが異なれば別単位であり、再利用しない。pathだけ・stat・要約で一致を推定せず、異なる単位と未確認の履歴・テンプレートを必要範囲で読む。これは機械的な材料の同一性であり、Agentが内容を理解した証明ではない。
- このStaged対PRの相違と、固定したPR準備対実commitの不一致を区別する。後者は`verify`（commit後・push前）と`check --prepared`（push後）が完全digest・units等を再計算して停止判定する。元の準備・commit結果を改変せず保持し、一致時は本文を再表示せず確認済み要点を使う。digest取得・安全な再計算はLLMへの再読ではない。一時diffの権限・質問前削除、検査・承認は上記のまま維持する。

## 4. 後始末

内容確認と完全なdiffのdigest取得が終わり、不要になった一時diffはその時点で削除する。**どの質問よりも前に一時diffの削除成功を確認する**。ブランチ・分割・WHY・メッセージ・PR等の質問でも、後続の終了処理に削除を先送りしない。保持したdigest・確認済みの要点・操作に必要なcheck結果を使い、承認待ちに元のdiffファイルを残さない。後続のPRとの比較にも、元ファイルを残す代わりに同じcanonical形式・アルゴリズムのdigestを使える。

この実行が作成したファイルだけを削除し、空になったprivate directoryを`rmdir`する。別ツールから読む間は残す必要があるため、作成したshellが終了しただけで消すtrapは使わない。以下は第1引数が保持したdirectoryで、この2ファイルだけを作成した場合。他にもJSON等を作った場合は、不要になったものの記録したパスだけを追加する。

```sh
rm -f -- "$1/staged.diff" "$1/pr.diff" || exit 1
rmdir -- "$1"
```

他実行のdirectory、globで一致したファイル、作成記録のないものを削除しない。後始末失敗なら承認質問へ進まず停止し、残存場所と失敗を報告する。Gitのreset・rollbackは行わない。

正常終了・失敗・キャンセル時にも、まだ不要な作成ファイルが残っていれば後始末する。ただし、UIキャンセルや強制中断ではLLMが再開せず終了処理を実行できない場合がある。承認待ち前の削除で今回の経路を防ぐのであり、削除前の任意のタイミングでの強制中断まで保証するものではない。
