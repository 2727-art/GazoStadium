# なりきり吹き出しと名場面カード（通常型1on1）

## 本番反映

- 2026-10-07、Realtime Database Rules → main への push（workers.dev は自動配備）→ Hosting の順で配備。
- ソースコミット: `d160e168d4769fc491961d4f7269363d861d1259`（機能 `767f913`、Rulesエミュレーターテスト `d160e16`）。main は `3b4c402..d160e16` の fast-forward。
- Rules: `gazostadium-default-rtdb` へ released successfully（Hosting より先に完了）。
- Hosting release: `sites/gazostadium/channels/live/releases/1791376304060000`（**21:31:44 JST**）。
- Hosting version: `sites/gazostadium/versions/41f14fc359ccea6f`。CLI のアップロード対象は91ファイル。
- 配備は管理 worktree（`.claude/worktrees/chat-persona-share`）から実行。メインのチェックアウト（`release/velvet-stage`）は origin/main より23コミット古いため使っていない。
- Functions、Firestore Rules、Indexes、保存データの変更・削除は行っていない。

## 仕様

### なりきり吹き出し

- 発言に送信者の口調セットID（`voiceSetId`）と言い方（`effect`）を添え、従来どおり RTDB `online/rooms/$roomId/chat` に保存する。Rules は既知の6口調・4言い方だけを許可し、スタンプには言い方を付けられない。
- 吹き出しは、購入済みのチャット背景・フレームがあればそちらを優先し、ない時だけ口調ごとの吹き出しにする。名前の前に口調のしるしを付ける。
- 言い方は「ささやき・強調・震え・ハート」。送信後は「ふつう」に戻る。出現アニメーションは各発言の初回描画だけで、`prefers-reduced-motion` では止める。
- リアクション（口紅・王冠・ハート・なみだ・ぞくっ）は相手の吹き出しに1つ。P2P `chat-reaction` で送り、受信側は自分が書いた発言IDだけを受け付ける。Firebase に保存しない。
- 入力中の表示は P2P `chat-typing`（2.5秒間隔で送信、5秒で自動消去）。文言は相手の口調に合わせる。
- 旧クライアントは未知の P2P 種別を無視し、追加フィールドを表示に使わないため、従来の吹き出しで表示される。

### 名場面カード

- 結果画面の「名場面カードを作る」から最大10件を選び、Canvas で横1080pxの PNG を作る。ファイル共有に対応した端末（iPhone など）は共有シート、それ以外は保存。
- 相手の名前と発言は、P2P の掲載許可（`share-consent-request` / `share-consent`、要求IDは16桁の16進数）を得た時だけ載せる。未許可の間は名前を「相手」、発言を固定長のぼかし帯（文字数を出さない）にし、スタンプIDも出さない。
- 対戦画像・プロフィール画像・UID は含めない。カードにも共有文にも URL を入れない（「貼り合いスタジアム」とハッシュタグのみ）。
- 交流を終了した相手（`playerSafetyStopped`）とは、ボタン表示・P2P の送受信とも行わない。

## 検証

- 全体: **1,901 tests / 1,872 pass / 0 fail / 29 skip**。新規 `functions/test/chat-persona-share.test.js` は10件。
- Database emulator（v4.11.2）で `normal-p2p-v2-rules-emulator.test.js` **15 pass / 0 fail**。新規ケースで、既知の口調・言い方は書き込み成功、未知の口調・未知の言い方・文字列以外・スタンプへの言い方は拒否を確認。
- ローカルプレビュー（`?battlePreview`）で、スマートフォン相当 375x812 と PC 1280x800 を確認。吹き出し、言い方、リアクションの付け外し、入力中表示、カード作成（スタンプを含む）、許可の流れ（プレビューは相手の応答を擬似再現）、ダイアログの開閉、PNG 生成（`toBlob` 成功＝Canvas は汚染されていない）。
- 実アカウント、実対戦、2台の実機間の P2P、iPhone の共有シートは検証していない。

## 独立した配信確認

`node functions/scripts/verify-chat-persona-release.cjs --deployed-rules <保存した公開中Rules>` を実行。

- **21:34:56 JST**、web.app / firebaseapp.com / Cloudflare の3経路で成功。
- 通常URL・cache-buster付きHTML、HTMLが参照する `online.js`・`chat-persona.css`、`online.js` が import する `chat-persona.mjs` の通常/検証用URL、合計24件で 200/MIME/LF正規化ハッシュ一致。
- 非公開4パス×3経路、合計12件は404。
- 公開中の RTDB Rules を `firebase database:get /.settings/rules`（読み取りのみ）で取得し、コミット済みの `database.rules.json` と JSON として完全一致。
- 証拠: 同ディレクトリ `CHAT_PERSONA_RELEASE_QA.json`。

## 公開後に確かめること

- 2台で通常型1on1を1回行い、リアクション・入力中表示・掲載許可の送受信と、iPhone の共有シートからの投稿を確認する。
