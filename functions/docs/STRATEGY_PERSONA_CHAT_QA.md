# 戦略型1on1をなりきりDMに

## 本番反映

- 2026-10-08（日本時間）、Realtime Database Rules → main への push（workers.dev は自動配備）→ Hosting の順で配備。
- ソースコミット: `82b5c2c`（main は `8dee7e0..82b5c2c` の fast-forward）。
- Rules: `gazostadium-default-rtdb` へ released successfully（push より先）。戦略型チャットに `effect`（既知の4種だけ、スタンプには付けない）を追加。`$other` は引き続き拒否。
- push は GitHub の障害（Git Operations の major outage、2026-10-07 15:13〜15:14 UTC）で3回 `Internal Server Error` になり、復旧後の4回目で成功。失敗した3回で main は変わっていない。
- Hosting release: `sites/gazostadium/channels/live/releases/1791387173196000`（**00:32:53 JST**）。
- Hosting version: `sites/gazostadium/versions/2312bba742a614e7`。CLI のアップロード対象は93ファイル（前回の92ファイル＋`strategy-chat.mjs`）。
- workers.dev は GitHub の Webhook が性能低下中だったため、Hosting より遅れて **00:35:14 JST** に新しい版へ切り替わった（それまでは `8dee7e0` の版。前の版も新しいRulesで動き、新しいP2Pの合図は無視するだけなので、混在しても対戦は壊れない）。
- 配備は管理 worktree（`.claude/worktrees/chat-persona-share`）から実行。Functions、Firestore Rules、Indexes、保存データの変更・削除は行っていない。

## 仕様

- 対戦スレッドと専用チャットの吹き出しを、通常型1on1と同じ6つの口調の吹き出しにする（チャットは購入した枠・背景を優先）。口調は部屋のプレイヤー情報から決め、チャットには口調の項目を持たせない。名前の前に口調のしるし。
- 対戦スレッドの上に、相手の名前・口調・一人称・「あなたを〇〇と呼ぶ」・理性をまとめたDMの見出しを固定する。
- 80・85・90点で開く権利は光るリボン、指示は金色・質問は紫の吹き出し、「語尾に♡」の指示中は♡の残り回数、看破の宣言には封蝋、看破成功時の「効いてないって言ったよね♡」は打ち消し線付きの証拠。点数・権利・看破・罰のルールと記録は変えていない。
- 相手の手番は、段階（次の1枚・点数・権利・返事・仕留め）と口調に合わせた入力中の一文。ゲームの進み具合から決め、通信は増やさない。
- 専用チャットに「ささやき・強調・震え・ハート」の言い方、相手の吹き出し（スレッド・チャット）へのリアクション、チャットの入力中表示。リアクションと入力中はP2P（`strategy-reaction` / `strategy-chat-typing`）だけで送り、受け手は自分が書いた吹き出しへのリアクションだけを受け付ける。
- 匿名の間は「小悪魔さん（匿名）」と呼び、ヴェール越しの吹き出し。正体判明の画面に入った最初の1回だけ、相手のカードのヴェールが外れる演出。
- スマホ・タブレットはチャットを画面下の帯から開く（品評会は画面内のまま）。帯は画面の登場アニメーションの外に置き、画面下に固定されるようにした。
- 結果画面の名場面カードは、スレッドの言葉・点数の返事・質問と指示・答え・看破とチャットの発言から最大10件。「#3」のように手の番号を付ける。相手の名前と発言はP2Pの許可（`strategy-share-consent-request` / `strategy-share-consent`）がある時だけ。匿名の偵察中の発言には購入した装飾を付けない。対戦画像・UID・URLは入れない。
- 名場面カードの部品（`chat-persona.mjs`）は回の表記を差し替えられるようにした（v2。通常型は従来どおり「R3」）。

## 検証

- 全体: **1,940 tests / 1,911 pass / 0 fail / 29 skip**。新規 `functions/test/strategy-persona-chat.test.js` は10件。
- Database emulator（v4.11.2）で `strategy-hariai-rules-emulator.test.js` **11 pass / 0 fail**。新規ケースで、既知の言い方は scout・battle とも成功、未知の値・文字列以外・スタンプへの言い方・口調の項目は拒否。
- ローカルの戦略型プレビュー（`?strategyPreview`、「匿名の偵察」「正体判明」の切り替えを追加）で、スマホ相当 390x844 と PC 1280x800 を確認。口調の吹き出し、DMの見出しの固定、権利のリボン、指示・答えの吹き出し、看破の封蝋、手番の入力中、王冠・口紅のリアクション、チャット帯の開閉（未読の点）、匿名のヴェール、正体判明の演出、PCでの横はみ出しなし。
- 確認中に、チャット帯が画面下に固定されない不具合（画面の登場アニメーションの transform が原因）を見つけ、帯を画面の直後に置いて修正。
- 通常型1on1の名場面カードが v2 の部品でも従来どおり開き、「R1」の表記になることを確認。
- 実機2台の間のP2P（リアクション・入力中・掲載許可）、実際の対戦での正体判明、結果画面で名場面カードを開く操作は未検証（カードの行の作り方は本物の関数をVMで動かすテストで確認）。

## 独立した配信確認

`node functions/scripts/verify-strategy-persona-chat-release.cjs --deployed-rules <保存した公開中Rules>` を実行。

- **00:35:25 JST**、web.app / firebaseapp.com / Cloudflare の3経路で成功。
- 通常URL・cache-buster付きHTML、HTMLが参照する `strategy.js`・`strategy.css`・`online.js`、`strategy.js` が import する `chat-persona.mjs`（v2）・`strategy-chat.mjs` の通常/検証用URL、合計36件で 200/MIME/LF正規化ハッシュ一致。
- 非公開4パス×3経路、合計12件は404。
- 公開中の RTDB Rules を `firebase database:get /.settings/rules`（読み取りのみ）で取得し、コミット済みの `database.rules.json` と JSON として完全一致。
- 00:33:53 JST の1回目は、Cloudflare だけが前の版だったため不一致（上記のとおり 00:35:14 に切り替わり、再確認で一致）。
- 証拠: 同ディレクトリ `STRATEGY_PERSONA_CHAT_RELEASE_QA.json`（再確認の結果）。
