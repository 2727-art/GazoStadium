# お貢ぎ牧場：有料アイコンの追加（49〜51、2026-10-30）

## 対応内容

ユーザーの依頼（2026-10-30）: 「続いて添付4種類の有料アイコン化をお願いします」。続けて「添付2枚を有料アイコン化お願いします」（服と背景を変えて作り直した2枚）。

- 足した3枚（各 500 Pay、四角に印の色の縁と縁寄せのホログラム、白いきらめきなし）:
  - 49 キャラメル: キャラメル色の長い髪と、ハートの浮かぶ蜂蜜色の瞳。
  - 50 漆黒: 長い黒髪に頬杖、「働きたくない」のTシャツ。切り抜きは他と同じ幅で、Tシャツの文字もアイコンに入る。
  - 51 バニラ: 桃色のメッシュが入った金の髪に、生成りのケーブルニット。
- 入れなかった3枚（最初の4枚のうち）:
  - 前回と同じ制服の金髪ギャルを切り抜いたもの（セーラー襟の線と校章のボタンのブレザーが残る）。
  - ストライプのブレザーとネクタイ、教室のような背景。
  - リボンタイと金の縁取りの制服の上着。
  - 理由は前回と同じく、未成年に見える絵を大人向けのこのモードの管理人の顔として売らない線（年齢・学校を連想させない）。
- ユーザーからの反論と答え:
  - ユーザーの説明: niji7 で成人20歳指定のアニメキャラクターとして作り、niji7 は未成年の画像を作らない。
  - 答え: 判断は生成の設定ではなく見た目によるので、制服の絵は入れない。同じ子を私服などで作り直せば足せる。
  - ユーザーはそのうち2枚を作り直し、それが50・51になった。
- 作成スクリプト（`tools/tribute-avatars/premium-icons.py`）は、正方形なら 1024 以外（niji の 1254px）も受け付ける。先に 1024 に縮めてから同じ座標で切り抜き、記録に `sourceSize` を残す。
- 持っている飾りは Firestore の `in`（30個まで）で読む。飾りと有料アイコンの商品は51で30個ちょうど。これ以上増やす時は、`decorationsAction` の読み方を30個ずつに分ける直しがいる。

コミット:

- 49: `6cb6756`
- 50・51: `8cdb8b8`（origin/main）
- 作業フォルダ: `.claude/worktrees/ranch-photo-icons`（ブランチ `design/ranch-wallet-moves`）

## 配信対象

- Functions: `economyAction`・`tributeAction`
  - 商品の一覧に49〜51
  - `AVATAR_MAX` を51に、有料の番号に49〜51
- Realtime Database のルール: 持ち物の検証に `ranch_avatar_(49|50|51)` を足した
- Firestore のルール・インデックス: 変更なし
- Hosting / workers.dev / hariaistadium.com:
  - `index.html`
  - `tribute.js`・`online.js`・`account.js`（キャッシュキーの末尾 `ranch-premium-icons-v3`）
  - `tribute-core.mjs`・`tribute-deco.mjs`・`tribute-share.mjs`・`shop-products.mjs`（読み込みの印の末尾 `ranch-premium-icons-v3`。`tribute-deco.mjs` は4つの読み込み元で同じ URL）
  - `assets/tribute-avatars/avatar-49.webp`〜`avatar-51.webp`（新規）
  - `tribute.css` は変更なし
- 本番のデータ: 書き込みなし

## 公開前の検証

- `npm --prefix functions run check`: **2,410件中2,376件成功・失敗0・34スキップ**（エミュレータ専用）
- 新しいテスト `functions/test/tribute-premium-icons-3.test.js`:
  - 49〜51 の番号・商品・値段・名前がサーバー・ストア・画面で同じ
  - 名前と説明に、年齢や学校を連想させる言葉がない
  - 飾りの商品がちょうど30個
  - Realtime Database のルール
  - 記録（ハッシュ・大きさ・元画像・1254px の元画像の大きさ）
  - キャッシュキーと `tribute-deco.mjs` の読み込みが1つ、設計書
- 前からのテスト（アイコンの数・値段・ストア・キャッシュキー・2回目のテスト）を51枚・16枚に合わせた。2回目のテストのキャッシュキーの確認は、後ろに印が足されても通る形にした。
- ローカルのプレビュー（カード編集）:
  - 有料の段に16枚。49〜51 の絵が読み込まれる。
  - 50 の試着と「500 Payで買う」の案内。
  - 画面のエラー0件、横のはみ出しなし。
- 確認スクリプト（公開前、`functions/scripts/verify-tribute-premium-icons-3-release.cjs`）:
  - 4経路で違うのは、今回のファイルと、まだない49〜51だけだった。
  - アイコン48枚・`tribute.css`・`app.js`・`achievements.js`・牧場の絵549枚は一致した。
- `functions:list`（公開前）: `economyAction`・`tributeAction` は `50ff973…`（2回目の公開のまま）。

## 本番反映結果

- Functions・Realtime Database のルール・push・Hosting は、ユーザーが手元の PowerShell でこの順に実行した。
  - どれも、作業フォルダに移り、`git rev-parse HEAD` が `8cdb8b8…` で `origin/main` を含む時だけ動く1行の形。
  - push は `33ccb76..8cdb8b8`（2回目の公開の記録 `22c20bb` を含む）。
- `functions:list`: 37関数すべて ACTIVE。
  - 変わったのは `economyAction`・`tributeAction` だけ（`50ff973176ef85d3bf8c3106450a0cbb4b9b0651` → `857acea2d1974309800a18d20e63ac87e430f007`）。
  - ほかの31関数は `43db9e7…` のまま。秘密の値を持つ4関数も前の値のまま。
- Realtime Database のルール: `database:get /.settings/rules` で読み戻し、コミットした `database.rules.json` と一致した（`…|49|50|51)`）。
- workers.dev の自動ビルド（`8cdb8b8`）: 06:55:43Z に成功。
- `verify-tribute-premium-icons-3-release.cjs`（読み取りのみ、07:00:58Z）:
  - 4経路すべてで、コミット `8cdb8b8` と一致した。
    - 3つの入口の `index.html`
    - 変わったファイル・モジュール
    - アイコン51枚
    - 牧場の絵549枚
  - 前回までの公開の印が残っている。非公開のファイルは404。
- 本番（web.app）の内蔵ブラウザ（ページの読み込みだけ。牧場は開いていない）:
  - `tribute.js`・`online.js`・`account.js` が新しいキャッシュキーで載っている。
  - `tribute-deco.mjs` は有料アイコン16枚で、49〜51 がキャラメル・漆黒・バニラ。
  - `tribute-core.mjs` は51種。49〜51 の絵は 200。
  - コンソールのエラーは0件。ブラウザにログインの記録は残っていない。

## 残っていること

- 本番での本物の AnjuPay の購入と、新しいアイコンを付けたカードの保存は、ログインした管理人でしか確かめられない。確認はテストとプレビューで行った。
- 商品は30個ちょうど。次に飾りかアイコンを足す時は、持っている飾りの読み方を30個ずつに分ける直しを先に入れる。
