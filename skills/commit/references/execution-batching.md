# 承認後は保持済み参照だけで実行する

現行4入口はBun必須。旧Python／Codemodeの生成コード集約は使用しない。
[local](local-bun.md)／[push](push-bun.md)／[PR](pr-bun.md)の起動・準備・表示・承認手順を全文読む。

完成planをprivate0700／0600で保持し、不要diff／historyはどの質問よりも前にreleaseする。通常assistant表示で一括承認した後、同じ確認済みBun実体・trusted scripts cwd・保護起動条件でcommit-workflow.ts executeを呼ぶ。stdinはreferenceだけで、文章や設定の再送・途中LLM判断・毎回の機械処理コード生成は0。参照やscript成功は承認証明でない。

CLIが必要branch→必要commit→raw本文／親／tree／index／refs照合→必要固定SHA push／readback／予定upstream→必要PR／title/body/Draft/head/base/SHA readback→cleanupを行う。localは通信なし、pushはPR API0。既存HEADはcommitなし、同SHA再pushなし、既存PRは非編集・非重複。

失敗／drift／異常応答／成否不明では後続mutation停止。先行成功・操作済みの可能性・事後確認失敗・cleanup失敗を区別し、自動retry／rollback／resume／別経路へ切り替えない。所有確認した実体だけcleanupし、未知sentinel／差替え／別runは消さない。完全atomic性・任意中断必達を保証しない。
