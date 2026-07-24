# AnjuPay 台帳の有効化手順

`systemConfig/anjuPayLedger` は、AnjuPay 履歴の収集と公開を開始する
サーバー側マーカーです。記録開始前のAnjuPay増減履歴は復元せず、有効化時の残高を
`opening-v1` として記録し、それ以後の変更だけを台帳へ追加します。

導入は必ず次の準備と3段階で行います。

0. Functionsを配備する前に、このdocumentを
   `{ enabled: false, activatedAt: 0 }`で作成します。documentがない場合、
   台帳対応Functionsは残高操作をfail-closedで拒否します。初回配備に限り、
   `functions/.env.gazostadium`（Git管理外）へ
   `ANJU_PAY_LEDGER_REQUIRED=false`を設定します。このパラメータの既定値は
   `true`なので、設定を忘れた場合も未記帳のまま残高を更新しません。
1. 上記の無効状態のまま、台帳対応済みの Functions を全て
   デプロイします。この段階では既存の残高処理だけが動作し、履歴 API は
   `available: false` を返します。
2. 新しい Functions revision への切り替わりを確認し、少なくとも callable の
   timeout（現在30秒）を超えて旧 instance の処理が完了するのを待ってから、
   `enabled: true`と`activatedAt: <現在のUnix epochミリ秒>`を同時に設定します。
3. 直ちに`ANJU_PAY_LEDGER_REQUIRED=true`へ変更して全Functionsを再配備し、
   再び旧instanceのドレインを待ちます。台帳必須revisionへの切り替わりを
   確認し、デプロイ済みrevisionの実行時パラメータが実際に`true`であることを
   確認してから対応UIを公開します。マーカーが有効なら互換revisionでも通常の
   スモークテストは通るため、画面操作だけを確認の代わりにしてはいけません。
   以後、このパラメータを`false`に戻してはいけません。

`activatedAt` は one-way の本番移行マーカーです。一度設定した後は、値を変更・
削除してはいけません。`enabled`を誤って`false`にしても、`activatedAt`が残って
いれば記帳は継続します。台帳必須revisionでは、documentの削除、
`activatedAt`の消去、完全な無効状態への巻き戻し、または`enabled: true`だけで
`activatedAt`がない不完全な設定を検出した場合、新規walletを含む全ての
残高操作がfail-closedで停止します。

有効化後は、台帳非対応の旧Functions revisionや
`ANJU_PAY_LEDGER_REQUIRED=false`の互換revisionへロールバックしてはいけません。
旧revisionはこのマーカーを認識せず、残高だけを更新して回復不能な履歴欠落を
作るためです。緊急時は経済系Callableへのトラフィックを止め、台帳必須revisionを
基点に修正版を配備します。設定documentとFunctionsパラメータは変更前に
エクスポートし、変更・削除を監視してください。

各残高変更 transaction は同じ transaction 内でこの設定を読みます。有効化の
境界にある変更も、wallet の開始残高・連番・明細と残高更新が一つの atomic
commit になるように実装されています。

## Firebase Emulator 競合試験

本番有効化前に、64bit版JDK 21以上とFirebase CLIを使い、必ず
`demo-gazostadium`で次の試験を実行します。`functions/.env.local`はGit管理外で、
ローカル試験時も`ANJU_PAY_LEDGER_REQUIRED=true`のままにします。

PowerShell:

```powershell
$env:RUN_FIRESTORE_EMULATOR_TESTS = "1"
$env:ANJU_PAY_FIRESTORE_TEST_PROJECT_ID = "demo-gazostadium"
npx --yes firebase-tools@15.24.0 emulators:exec `
  --only auth,database,firestore,functions `
  --project demo-gazostadium `
  "npm --prefix functions run test:emulator"
```

試験は、実Firestore transactionの同一wallet競合、冪等再送、複数送信者から
同一受信者への差し入れ、市場売買と成功手数料、履歴ページング境界、
Security Rules、設定不備と不完全な市場保留状態のfail-closedを確認します。
通常の回帰基準は同一walletへの8並列です。16並列以上はEmulatorの
transaction lock timeoutが不安定に発生する負荷限界試験として扱い、
失敗時にも確定済みの残高・連番・明細・operation数が一致することを確認します。
