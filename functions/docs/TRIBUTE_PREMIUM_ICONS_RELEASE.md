# お貢ぎ牧場：管理人の有料アイコン（2026-10-27）

## 対応内容

管理人の印に、有料のアイコン7枚（`avatar` 36〜42）を足した。

ユーザーの決定（2026-10-27）:

- 1枚 500 Pay の買い切り
- 無料のアイコンと見分けるため、丸く切らずに四角のまま出す
- 縁は案A（金の縁。印の色は縁に使わない）
- 絵はユーザーが niji で作った7枚（圧縮前の原画を使う）

実装:

- 絵
  - 桜色・珊瑚色・シャンパン・抹茶・白桃・藤色・空色。
  - `tools/tribute-avatars/premium-icons.py` で、切り抜き・色調・四隅の色・光ときらめきを重ねた 256px の WebP（各20KB未満）。描き直しはしていない。
  - 記録は `functions/docs/TRIBUTE_PREMIUM_ICONS_ASSETS.json`。
- 金の縁
  - 絵に焼き込まず、`tribute.css`（掲示板・カード編集・ストアの見本）と `tribute-share.mjs`（貢ぎ報告などの画像）で描く。50〜76px では細い線が消えるため。
- 商品
  - 商品の種類 `ranchAvatar`、商品ID `ranch_avatar_36`〜`ranch_avatar_42`。牧場の飾りと同じに扱い、買っても対戦の装備にはしない。
  - ストアの「お貢ぎ牧場の飾り」の棚の先頭に「管理人の有料アイコン（四角・金縁）」を足した。
- カード編集
  - 有料の段を選択欄の一番上に置き、絵の下に値段・試着中・購入済を出す。
  - 持っていないアイコンは試着でき、選択欄のすぐ下で買える。試着中は保存できない。
- サーバー
  - `AVATAR_MAX` を 42 にした。
  - カードを保存する時、有料アイコンも飾りと同じ購入の確認（`economyPurchases/{uid}/items/{商品ID}`）を通す。

コミット:

- 実装: `a8edc2b`、origin/main の取り込み: `e962899`
- main へのマージ: PR #10（`f161881`）
- 作業フォルダ: `.claude/worktrees/ranch-premium-icons`（ブランチ `feature/ranch-premium-icons`）

## 配信対象

- Functions: `economyAction`・`tributeAction`
- Realtime Database のルール: 持ち物の検証に `ranch_avatar_(36〜42)` を足した
- Firestore のルールとインデックス: 変更なし
- Hosting / workers.dev / hariaistadium.com:
  - `index.html`
  - `tribute.js`・`tribute.css`・`online.js`（キャッシュキーの末尾 `ranch-premium-icons-v1`）
  - `tribute-core.mjs`・`tribute-share.mjs`・`tribute-deco.mjs`（読み込みの印の末尾 `ranch-premium-icons-v1`）
  - `assets/tribute-avatars/avatar-36.webp`〜`avatar-42.webp`
- 本番のデータ: 書き込みなし

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,265件中2,233件成功・失敗0・32スキップ**（エミュレータ専用）
  - サーバーと画面で、有料アイコンの番号・商品ID・値段・必要な購入が同じ
  - 有料アイコンを選んだカードは、その商品を持っていないと保存できない
  - Realtime Database の持ち物の検証・ストアの値段・Functions の商品が同じ（151商品）
  - 四角い金の縁が画面とシェア画像の両方にある
- ローカルのプレビュー
  - `?tributePreview=card`: 試着 → 選択欄の下の「買う」→ 購入済 → 保存
  - `?tributePreview=board`: 無料の丸いアイコンの横に、四角い金縁のアイコン
  - `?marketPreview` のストア: 棚の先頭に7枚（500 Pay）
  - 献上レシートの画像: 四角い金縁で描かれる
  - 375px 幅: 選択欄の札が絵の幅に収まり、横にはみ出さない

## 公開の手順と結果

1. Functions（`economyAction`・`tributeAction`）を作業フォルダからデプロイ。
   - 2つとも新しいソースのハッシュ `bc650cc…` になり、ほかの35個は変わっていない。
2. Realtime Database のルールをデプロイ。
   - 本番のルールを読み戻し、コミットした `database.rules.json` と一致することを確かめた。
3. PR #10 を main にマージ（`f161881`）。
4. Hosting をデプロイ（177ファイル、すべて Git で追跡しているファイル）。
5. 配信の確認（`functions/scripts/verify-tribute-premium-icons-release.cjs`、読むだけ）
   - web.app・firebaseapp.com: 3つの入口の `index.html`、変わったファイル・変わっていないファイル・3つのモジュール・7枚のアイコンがコミットと一致。公開しないファイルは404。
   - workers.dev・hariaistadium.com: `f161881` の Workers Builds が失敗し（09:46:47Z）、前回の公開（お預け `ranch-hold-v1`）のまま。

## Workers Builds の失敗

- `f161881` のビルド `e013f5a7-1b10-4f52-bad8-60141404c96f` が failure。ログは Cloudflare のダッシュボードにしかなく、このセッションからは読めなかった。
- 直前の main のビルド（`8473e53`・`dc5e7f1`）は成功していて、Cloudflare の未解決の障害はなく、wrangler の新しい版も出ていない。
- 同じコミットを取り出して `wrangler@4.153.0 deploy --dry-run --assets=.` を走らせると、735ファイルを読んでエラーなく終わる。
- 決まって失敗する原因は見当たらないので、一時的な失敗とみて、この記録のマージでビルドをやり直す。結果は QA の続きに書く。

## まだ確かめていないこと

- 本番での本物の AnjuPay の購入と、有料アイコンを付けたカードの保存。
