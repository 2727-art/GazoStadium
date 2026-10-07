# 旧推し値市場のトップ参加状況撤去

## 本番反映

- 2026-10-07 **19:15:53 JST**、Hosting のみ配備完了。
- ソースコミット: `c78a38f25d27a3fdbc6132433ac480c2f0274a4f`。
- Hosting release: `sites/gazostadium/releases/1791368153338000`。
- Hosting version: `sites/gazostadium/versions/b2e19dd04af89222`。
- 元の OneDrive 側の未コミット作業には触れず、管理 worktree の最新 main から対象差分のみ反映。

## 対象と維持したもの

- トップの旧市場カード（売り手待機・買い手待機・商談中）、関連説明、専用CSSを撤去。
- `online.js` から `online/publicMarketPresence` の初回/手動get、集計モジュールimport、状態、DOM更新処理を撤去。
- 通常型1on1、戦略型1on1、自由卓の参加状況、初回1回＋手動更新、30秒連打防止、最終取得時刻は維持。
- 「旧推し値市場の記録」の入口とランキング/履歴処理を維持。既存サーバー互換処理、Functions、Rules、保存データは変更・削除していない。
- `app.js` / `online.js` / `styles.css` に `retire-market-lobby-v1` キャッシュ世代を追加。過去の撤去・安全対策マーカーは維持。
- README内の表示/取得説明も現状へ更新。

## 検証

- 全体: **1,877 tests / 1,848 pass / 0 fail / 29 skip**（明示起動のEmulator等）。
- 関連6ファイル: **34 pass / 0 fail / 0 skip**。
- 実関数をVM実行し、取得先が時刻補正・対戦presence・自由卓Callableのみであることを確認。旧市場statsのthrowing getterが呼ばれず、描画からカードが消えることを確認。
- 初回二重取得防止、同時手動取得の共有、30秒連打防止、タブ復帰/再描画で追加取得なし、オフライン取得なしを確認。
- 対戦/自由卓の片方失敗、両方失敗時の前回値・最終成功時刻の維持を確認。
- 構文チェック、diffチェック、別担当の差分/公開検証スクリプトレビューに阻害事項なし。
- 本番の実ユーザー操作・対戦・実機レイアウト試験は行っていない。

## 独立した配信確認

`node functions/scripts/verify-market-lobby-retirement-release.cjs` を実行。

- web.app / firebaseapp.com / Cloudflare の3経路。
- **19:16:44 JST**、通常URL・cache-buster付きHTMLとHTML参照の3アセット、計24件で200/MIME/LF正規化ハッシュ一致。
- 非公開4パス×3経路、計12件は404。
- 初回確認時はCloudflareだけ旧HTMLだったが、追加デプロイやキャッシュ設定変更をせず伝播後の再取得で一致を確認した。
- 証拠: 同ディレクトリ `MARKET_LOBBY_RETIREMENT_RELEASE_QA.json`。

## 通信量への効果

新しいページを読み込んだクライアントでは、ページ初回表示と実行可能な手動更新ごとに旧市場のRTDB getが1回ずつ不要になる。もともと常時購読ではない。この欄はCallableやFirestoreを直接使っていなかったため、今回だけでFunctions呼び出し量やFirestore読み取りが減るとは主張しない。月額削減額は未計測。既に古いページを開いているクライアントは再読込み後に新コードとなる。
