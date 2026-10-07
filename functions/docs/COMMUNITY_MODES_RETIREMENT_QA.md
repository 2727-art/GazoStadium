# AnjuPayフリマ・断惑NOTEの機能終了

## 状態と範囲

- 2026-10-07、機能終了の実装とローカル検証。**本番未デプロイ**。
- 作業ブランチ: `codex/retire-flea-danwaku`。開始点: `dc5e4ab67d43fa8aa269549a9637958ee9e1aca0`。
- 本番への操作は下記の集計・Scheduler 設定取得のみ。データ変更、削除、ジョブ停止、Functions/Hosting の配備はしていない。
- トップの入口・専用 JS/CSS の読み込みを撤去。既存クライアントには認証後、両 Callable が `failed-precondition` / `mode-retired` を返す。新規・更新・閲覧・削除を含む旧アクションはサービス処理へ到達しない。
- 共通実績初期化からフリマ事前 backfill とフリマ・断惑の読取りを除去。実績装備変更のフリマ読取り、新規対戦用の断惑バッジ読取りも除去。
- フリマ30件＋断惑10件の実績定義は `legacy: true` で保持。取得済み ID・装備・保留通知を残し、新規の自動解除を止める。未取得者には空の専用実績カテゴリを表示しない。
- 残高・確定済み台帳/取引履歴・共有推しカード・ノート・出品データは物理削除しない。返金処理は追加しない。アカウント移行先の履歴保護、ブロック処理、過去の対戦スナップショット互換を維持。
- 2つの専用 Scheduler のソース export は撤去。内部 cleanup サービスは保守用に残す。本番ジョブは配備時に別途安全確認の上で終了する。

## 本番の読み取り専用事前確認

実行: `node functions/scripts/audit-community-retirement.cjs <firebase-tools/lib の絶対パス>`。
確認日時: **2026-10-07 18:28:51 JST** (`2026-10-07T09:28:51.684Z`)。
全て件数集計のみ。UID、ノート本文、商品説明、個人の残高を取得・表示していない。

| 指標 | 件数 |
|---|---:|
| フリマ出品の全履歴 | 21 |
| status=active のフリマ出品 | 0 |
| 過去30日作成のフリマ出品 | 2 |
| フリマ売買履歴 | 19 |
| フリマ売りっ子カード | 31 |
| 断惑プロフィール | 54 |
| 断惑公開エントリー | 1 |
| 断惑対戦バッジ | 0 |
| 断惑削除待ちジョブ（未来の再試行予定を含む全件） | 0 |

過去30日の起点は `2026-09-07T09:28:51.684Z`。プロフィール件数は現在の利用者数ではない。
ユーザーの「現在出品なし」は現在の active=0 と一致。過去の作成履歴は残っており、データ不存在とは扱わない。

専用ジョブはこの時点ではともに `ENABLED`:

- `firebase-schedule-expireAnjuPayFleaListings-us-central1`: 毎日00:00、Asia/Tokyo。
- `firebase-schedule-cleanupDanwakuDeletionJobs-us-central1`: 15分ごと、Asia/Tokyo。

## 検証

実アカウントでの取引やノート操作、削除処理は行わない。
全体回帰: 1,874 tests / 1,845 pass / 0 fail / 29 skip（明示起動の Emulator 等）。
実 Firebase Emulator（Auth/Functions/Firestore/RTDB、専用 `demo-anju-pay-flea-e2e`）: **8 tests / 8 pass / 0 fail / 0 skip**。`node functions/test/run-anju-pay-flea-e2e-emulator.js`、Node.js 22.23.2 / Java 21、終了コード0。
エミュレーターでは認証/App Check拒否、全旧アクションの利用終了、不正payload・並行再送、新規ユーザーの不要な初期化なしを確認。保存済みwallet/台帳/出品/取引/receipt/ノートと履歴/取得済み実績・保留通知・装備/RTDBを前後比較し、内容およびFirestore updateTimeの不変を確認。試験で作ったdemoデータと非秘密dotenvだけを後片付けし、本番データ・本番dotenvには触れていない。
構文チェック（app、browser/server実績、index、追加script）、`git diff --check` PASS。別担当による差分レビューも実施。
追加回帰では旧 Callable の全アクション拒否、認証維持、同時再送時のサービス・wallet・DB 副作用なし、共通読取りトレース、既得実績・装備保存と現役実績の新規解除を検証。
オフラインブラウザで1280px/390pxの幅を確認。両入口なし、横はみ出しなし。デスクトップでは撤去したフリマ跡の空白を詰め、参加状況と推しカードの上端が一致した。スマートフォン幅はエミュレーションであり実機証明ではない。
`preview-community-retirement.cjs` は全 module script を外し CSP `connect-src 'none'` としたオフライン画面確認用。Firebase 接続・実ログイン・本番統合 QA の証明ではない。

## 後続の本番反映手順（この実装ターンでは未実行）

1. 本番デプロイの指示を得た後、最新 main と競合を確認し、対象差分だけをコミット・反映する。元の OneDrive 側の作業中ブランチは使用しない。
2. 対象 Functions の到達経路を再確認して限定配備する。まず両旧 Callable の終了を反映し、認証/App Check を弱めず終了応答を確認する。共通実績・対戦バッジ経路の Functions も必要なものだけ反映する。
3. 配備前から実行中だった旧リクエストが完了するまで、各 Callable の実際の timeout と配備時刻を基準に待つ。先に cleanup を停止しない。
4. 集計スクリプトを再実行し、active 出品と全削除待ちジョブが0件であることを再確認する。0件でなければ停止せず、残件の原因と必要な対応を報告する。ノートの削除待ちを無視して停止してはいけない。
5. 0件確認後に限り `expireAnjuPayFleaListings` と `cleanupDanwakuDeletionJobs` の2つの定期 Function、および対応する上記2つの Scheduler だけを終了する。Cloud 側で消えたことを別途確認する。データコレクションは削除しない。
6. Hosting を配備し、web.app / firebaseapp.com / Cloudflare の3経路で HTML、参照アセット、キャッシュマーカー `retire-flea-danwaku-v1` と通常 URL の内容を確認する。既存の対戦・牧場・灯り撤去のマーカーを維持し、非公開ファイル404も確認する。
7. 対象 Functions の ACTIVE、Node.js runtime、新 revision、起動エラー不在を確認してから完了とする。配備前後の実使用量を測定するまで、月額削減額は断定しない。

現ソースで変更した共通処理への到達を確認した対象は次の12 exports。後続の main 更新があれば再監査する。

| 反映理由 | Functions |
|---|---|
| 旧機能の終了応答 | `anjuPayFleaAction`, `danwakuNoteAction` |
| 共通実績の参照削減（直接・間接） | `economyAction`, `redeemAchievementCode`, `valueMarketAction`, `valueMarketRankings`, `rouletteTrainingAction`, `playerSafetyAction`, `cleanupPlayerSafety` |
| 新規対戦バッジ取得の終了 | `soloSessionAction`, `soloFamiliarAction`, `matchAchievementShowcase` |

特に `redeemAchievementCode` は getAchievements、`rouletteTrainingAction` は creatorStats、playerSafety の2本は blocked-contact cleanup → 対戦確定/旧市場終了から共通実績に到達する。呼び出し名の直接検索だけで省略しない。

未反映の段階では本番利用・本番の呼出し料金は変化しない。ソースから Scheduler export を消しただけでは、既存の本番ジョブは停止しない。
