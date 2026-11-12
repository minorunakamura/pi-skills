# commit系4入口の共有手順

4入口すべてBun 1.3.0以上必須。到達点とbranch方針を入口で確定し、入口の必要な全文read一式を同じassistant turnから呼び、切断時はtailを取得する。規則はPR > push > localを優先する。

- commit／commit-main: [local-bun.md](local-bun.md)
- commit-push: [local-bun.md](local-bun.md)・[push-bun.md](push-bun.md)
- commit-pr（既存HEAD／PR-only含む）: [local-bun.md](local-bun.md)・[push-bun.md](push-bun.md)・[pr-bun.md](pr-bun.md)・[diff-review.md](diff-review.md)

保護されたBun起動・scope／対象外保持・全Staged検査・private参照・通常assistant一括承認・参照だけexecuteは共通。runtime不在／非対応／確認不能はStageを含むGit変更前停止。開始後の失敗でもPython／手書き互換へ切り替えず、自動install・retry・rollbackしない。

[差分確認](diff-review.md)と[承認後の実行](execution-batching.md)は現行Bun手順に対応する。製品・tests・検証helperにPythonは不要。
