# AnjuPayフリマ・断惑NOTEの機能終了

## 状態と範囲

- 2026-10-07、機能終了の実装・検証・**本番デプロイ完了**。Hosting の公開日時は **18:54:54 JST**。
- 作業ブランチ: `codex/retire-flea-danwaku`。開始点: `dc5e4ab67d43fa8aa269549a9637958ee9e1aca0`。
- 対象12 Functions と Hosting の限定配備、専用2 Functions と対応する2 Scheduler の削除を実施。プレイヤーのデータコレクション・残高・ノート・取引履歴は削除していない。Rules/Indexes は変更していない。
- トップの入口・専用 JS/CSS の読み込みを撤去。既存クライアントには認証後、両 Callable が `failed-precondition` / `mode-retired` を返す。新規・更新・閲覧・削除を含む旧アクションはサービス処理へ到達しない。
- 共通実績初期化からフリマ事前 backfill とフリマ・断惑の読取りを除去。実績装備変更のフリマ読取り、新規対戦用の断惑バッジ読取りも除去。
- フリマ30件＋断惑10件の実績定義は `legacy: true` で保持。取得済み ID・装備・保留通知を残し、新規の自動解除を止める。未取得者には空の専用実績カテゴリを表示しない。
- 残高・確定済み台帳/取引履歴・共有推しカード・ノート・出品データは物理削除しない。返金処理は追加しない。アカウント移行先の履歴保護、ブロック処理、過去の対戦スナップショット互換を維持。
- 2つの専用 Scheduler のソース export は撤去。内部 cleanup サービスは保守用に残す。本番の専用ジョブは Callable 閉鎖後の安全確認を経て削除し、個別 GET の404で終了を確認した。

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

## 実施した本番反映手順

1. ユーザーの「進めてください」を受け、最新 main との競合を確認して対象差分だけを push した。元の OneDrive 側の作業中ブランチは使用せず、分離 worktree から配備した。
2. 下記12 Functions の到達経路を再監査して限定配備。両旧 Callable は認証/App Check を維持したまま終了するコードに更新。全12本の配備が成功した。
3. 両 Callable の Cloud Run 新 revision への100%切替を確認。30秒の設定 timeout だけを根拠にせず、直近24時間の旧 revision リクエストを全ページ確認した。フリマ88件、断惑49件、最後のリクエストは18:21 JST台、5xxなし、最大 latency はそれぞれ5.477秒/2.746秒。新 revision の Ready は18:50:21/22 JST、確認は18:50:59 JST。旧リクエストの処理が残っている兆候はなかった。
4. **18:53:46 JST** (`2026-10-07T09:53:46.689Z`) に集計を再実行し、active 出品0件・全削除待ちジョブ0件を再確認した。他の集計件数も事前確認と同じ。
5. その後 `expireAnjuPayFleaListings` と `cleanupDanwakuDeletionJobs` の2 Functions と対応する2 Scheduler だけを削除した。18:55:56 JST の個別 GET で4リソース全て404。データコレクションは削除していない。
6. Hosting を配備し、**18:55:54 JST** に web.app / firebaseapp.com / Cloudflare の3経路を独立確認。通常URL・キャッシュ回避URLの HTML と参照アセット24件は200・MIME・LF正規化ハッシュ一致。キャッシュマーカー `retire-flea-danwaku-v1`、専用読込みと入口の不在、既存8マーカー、既得実績40定義を確認。非公開7パス×3経路は全て404。
7. 18:55:12 JST の配備前後比較で対象12本のみ revision/hash が変わり、全て ACTIVE / Node.js 22。対象外24本の revision/hash は不変、Functions は38→36、Scheduler は13→11で意図した2件のみ減少。残存ジョブの state/schedule/timeZone は不変。11 Callable の無認証 POST は全て401 / UNAUTHENTICATED。配備開始18:48:34 JSTから18:55:56 JSTの確認まで、新 revision 全12本の startup probe 成功、severity ERROR 以上のログ0件を確認した。

変更した共通処理への到達を再確認し、実際に配備した対象は次の12 exports。

| 反映理由 | Functions |
|---|---|
| 旧機能の終了応答 | `anjuPayFleaAction`, `danwakuNoteAction` |
| 共通実績の参照削減（直接・間接） | `economyAction`, `redeemAchievementCode`, `valueMarketAction`, `valueMarketRankings`, `rouletteTrainingAction`, `playerSafetyAction`, `cleanupPlayerSafety` |
| 新規対戦バッジ取得の終了 | `soloSessionAction`, `soloFamiliarAction`, `matchAchievementShowcase` |

特に `redeemAchievementCode` は getAchievements、`rouletteTrainingAction` は creatorStats、playerSafety の2本は blocked-contact cleanup → 対戦確定/旧市場終了から共通実績に到達する。呼び出し名の直接検索だけで省略しない。

## 識別情報・効果・検証範囲

- 実装コミット: `78f57146fee9261307113465daba29ef49a98109`。
- 配備元コミット（公開確認スクリプトを含む）: `af813d2829b9bd9507ad0099449c3673b1b539ca`。
- Hosting release: `sites/gazostadium/releases/1791366894367000`。
- Hosting version: `sites/gazostadium/versions/ebaefc127395fdec`、`FINALIZED`。
- 公開時刻: `2026-10-07T09:54:54.367Z`。
- 旧機能 Callable の revision: `anjupayfleaaction-00021-sel` / `danwakunoteaction-00009-nab`。
- 機械可読の前後比較、各 revision/hash、4件の404、認証プローブ、3経路の内容確認は同ディレクトリの `COMMUNITY_MODES_RETIREMENT_RELEASE_QA.json` に記録。

専用定期呼出しは15分ごと96回/日＋毎日1回、合計97回/日分の予定実行をなくした。トップページからの専用モジュール読込みと機能呼出しを撤去し、共通実績・新規対戦スナップショットの不要な読み取りも除去した。保存済みデータは保持するため、この作業で既存ストレージ容量を減らしたとは扱わない。実使用量を比較するまでは月額削減額を断定しない。

認証済み `mode-retired` 応答と保存データ不変の実動作証明は Firebase Emulator による。本番は配備ソース/revision/traffic/集計/配信内容/無認証境界/限定期間のログで確認し、実アカウントの取引・ノート更新・対戦は行っていない。ログ確認期間後の無障害やスマートフォン実機挙動を保証するものではない。

安全確認では、[Cloud Run のタイムアウト後もコンテナ処理が続きうる仕様](https://docs.cloud.google.com/run/docs/configuring/request-timeout)を踏まえ、新旧 traffic と旧 revision の実リクエスト結果を確認した。
