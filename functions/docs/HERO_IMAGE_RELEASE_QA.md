# トップ見本画像・小バッジ撤去・キャッシュ本番確認

## 完了

- 2026-10-07 **20:23:26 JST**、最終Firebase Hosting配備が完了。
- **20:24:32 JST**からの公開配信検証で、Firebase2経路とCloudflare経路すべて成功。
- 最終ソースコミット: `d07676cbf15db687c6886a9bf8b86491c469623f`。
- 画像・表示の実装コミット: `45470b84fe911cbbf307ae1189072364c533f94a`。
- Hosting release: `sites/gazostadium/releases/1791372206403000`。
- Hosting version: `sites/gazostadium/versions/666695030502ee18`。
- 元のOneDrive側の未コミット作業には触れず、管理worktreeの対象差分だけを公開。
- Functions、Rules、Indexes、保存データの変更・削除なし。画像表示にデータベース取得や定期送信を追加していない。

## 実装

- 固定のPNGをトップのプレースホルダーに表示し、丸い「小」バッジを削除。
- ファイル: `assets/landing/hero-example.d9a004076802.png`。
- 360×270、38,093バイト、元のPNGを再圧縮せずそのままコピー。
- SHA-256: `d9a00407680297c6b33868c9b12b42165dd94437b54ff9fe66b70bfbdfe414a0`。
- 表示は既存幅168pxを維持し、比率4:3、狭い画面の幅制限を適用。CSSはトップの画像だけに限定。
- 90点の表示とセリフ、外側のアクセシビリティ説明を維持。内側画像のaltは空で、aria-hidden配下の重複説明を防止。
- Firebaseは `firebase.json`、Cloudflareは `_headers` で、この画像の完全一致パスだけに `Cache-Control: public, max-age=31536000, immutable` を適用。
- ハッシュ入りのファイル名により、画像更新時は別URLへ変更。両設定と参照・テストを一緒に更新する手順をREADMEに記載。
- HTML、JavaScript、CSS、参加人数には1年間のimmutable設定を適用しない。
- app.jsとvelvet.cssの参照に `hero-image-v1` を追加し、従来のキャッシュ世代を維持。

## Cloudflareで見つかった差異と修正

初回の公開確認で、Firebase2経路の画像は1年間のimmutableだったが、Cloudflareでは画像が正しく表示される一方、`public, max-age=0, must-revalidate` だった。Firebase設定だけではCloudflareの静的配信ヘッダーに反映されないことを、実際のHTTP応答で確認した。

[Cloudflare公式の静的アセット用ヘッダー仕様](https://developers.cloudflare.com/workers/static-assets/headers/)に沿って、`_headers` に画像1パスだけの設定を追加。既存のGit連携で公開された後、同じ通常URLから1年間のimmutableを確認した。Cloudflareアカウントの権限・料金プラン・グローバルなキャッシュ設定は変更していない。`_headers` はFirebaseの公開除外にも追加し、両配信先でファイル自体が404になることを確認した。

## テストと画面確認

- 全体: **1,887 tests / 1,858 pass / 0 fail / 29 skip**。
- 関連: **9 pass / 0 fail / 0 skip**。
- 構文・diffチェック成功。実装差分の独立レビューでP1/P2指摘なし。
- 画像・サイズ・ハッシュ・寸法、バッジ撤去、90点維持、FirebaseとCloudflareの画像限定キャッシュ設定を回帰テストで確認。
- 公開検証スクリプト自体も、正常例、no-cache/no-store/private、重複max-age、バッジ復活の拒否などのローカル正負テストを確認。
- 実装時のオフラインプレビューで1280×900、390×844、320×740を目視確認。画像の読み込み、168×126の比率維持、バッジなし、90点あり、画像と見本カードの収まりを確認。
- この画面確認はmodule scriptを除去しCSPで通信を禁止した合成プレビュー。本番アカウントや対戦、実スマートフォンでの試験ではない。

## 独立した本番配信確認

`node functions/scripts/verify-hero-image-release.cjs` を実行。

- 3経路: `gazostadium.web.app`、`gazostadium.firebaseapp.com`、`gazostadium.anjugames.workers.dev`。
- 通常/nonce付きHTML6件と、各HTML参照のapp.js・velvet.css12件: 200、MIME、LF正規化ハッシュ、表示要件、キャッシュ世代が一致。
- 配信されたapp.js内のsrcから解決したPNG3件: 200、image/png、原本の38,093バイトとSHA-256が一致。
- 全3画像のCache-Controlは **public, max-age=31536000, immutable**。
- HTML/JS/CSSにimmutableまたは1年以上のmax-age/s-maxageがないことを確認。
- 非公開4パス×3経路、合計12件は404。
- 検証は公開ファイルのGETのみ。ログイン、ゲームAPI、保存データへのアクセスなし。
- レスポンスヘッダーの検証であり、全ユーザー端末でのキャッシュ保持や実際の月額削減額を保証するものではない。
- 証拠: `HERO_IMAGE_RELEASE_QA.json`。
