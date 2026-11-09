# 旧サイトの転送（2026-11-09）

新URLは `https://hariaistadium.com/`。旧 workers.dev、web.app、firebaseapp.com の通常ページを同じパスへ301転送する。旧データ、Google連携、引き継ぎコードの発行を終えられるよう、旧オリジンのウォレットと依存アセットは残す。

## 残す入口

- `/?account=1` と `/index.html?account=1` は同一オリジンの `/account-transfer.html?account=1` へ302転送。
- `/account-transfer.html` は各デプロイ時に `index.html` から生成する。noindex。再読み込みでもウォレットを開く。保存されているFirebase Authやブラウザ内データのオリジンを変えない。
- `/account-guide/`、JS/CSS/画像、`robots.txt`、`sitemap.xml`、Google所有権確認ファイルを維持する。
- Firebaseの `/__/` はHosting予約パスで、通常の転送より優先される。`authDomain` は `gazostadium.firebaseapp.com` のまま。

## デプロイ

CloudflareはGitHub mainのWorkers Builds（`npx wrangler deploy`）。`wrangler.jsonc` の build が専用ウォレットHTMLを生成する。Workerは旧ホストにだけ転送を適用する。ページのみworker-firstとし、JS/CSS等の静的配信を維持する。

Firebaseはトップの `account=1` 判別が必要なので、単純な `/` のHosting redirectは使わない。静的トップをHosting公開対象から除外し、独立したHTTP関数 `legacySiteRedirect` へrewriteする。ガイド6ページはHostingの301を使う。ウォレット等は静的ファイルの優先順位でrewriteより先に配信される。

初回または転送関数を変更した場合：

```powershell
npm --prefix functions-legacy-router ci
npx firebase-tools deploy --config firebase.legacy-router.json --only functions --project gazostadium --non-interactive
```

通常のFirebase公開：

```powershell
npx firebase-tools deploy --only hosting --project gazostadium --non-interactive
```

Hostingのpredeployで専用ウォレットHTMLを毎回生成する。転送関数は別codebaseであり、ゲームの既存Functionsやデータベースのデプロイは不要。転送処理にはデータベース・認証の読み書きがない。旧FirebaseトップへのアクセスにHTTP関数の実行が発生する（最小インスタンス0、最大3）。

## 確認と保持

- `node --test functions-legacy-router/test/*.test.cjs`
- 旧3ホストのトップと6ガイドは301、新URLは200。
- 旧ウォレット、案内、所有権ファイルは200。Firebase認証helperのスクリプトとiframeを確認。
- 本番の個人アカウントの連携・切り替え・コード発行は、動作確認だけを目的に実行しない。既存の復元テストとローカルプレビューを使う。
- Search Consoleのアドレス変更と新URLサイトマップを確認する。
- Googleの推奨に従い転送は最低1年、少なくとも2027-11-09まで維持する。例外ページの終了は実際の引き継ぎ状況を確認して別途判断する。robots.txtで旧URLを全面拒否しない。

ロールバックはCloudflareの前バージョン、Firebase Hostingの直前のリリースへ戻す。Gitでもこの変更をrevertして再公開できる。転送レスポンスはno-storeにし、ブラウザに恒久的な転送キャッシュを残さない。
