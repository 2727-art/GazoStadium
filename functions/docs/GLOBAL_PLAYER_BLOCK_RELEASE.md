# 全モード共通ブロック 本番公開記録

公開日: 2026-09-14（日本時間）

実装コミット: `71dca1cf058706b14f9f547ce7b4899043d50874` — `Add shared player blocking across online modes`

画面の最終修正: `29135bb`（説明文修正 `123b6d5` を含む）— 安心設定で「ブロックした相手との」接触を止めることを明記し、共通モジュールと8つの参照元のURL・キャッシュキーを統一。Hostingへ追加配備した。

`gazostadium` 本番で、2026-09-14 17:00:18 JST に `online/config/playerSafetyEnabled=true` を設定し、直後の読み戻しで有効化を確認した。

## プレイヤー向けの変更

- 共通ヘッダーに「安心設定」を追加。ブロックしたプレイヤーの一覧・解除を開ける。顔なじみ帳の公開設定には依存しない。
- 対戦・交流中の「ブロックして退出」、結果や公開相手からのブロック、直前の相手の短期参照を追加。
- 一方がブロックすると、同じアカウントの相手との新しい対戦・入室・交流・新規取引を両方向で制限する。通常型・戦略型1on1、自由卓、推し値市場、AnjuPayフリマ、作者台本・パック、差し入れ、コメント等に共通判定を接続。
- 確定済みの戦績・報酬・売買記録・支払済み利用分は従来条件で保持する。ランキングの正本順位・数値は変更しない。
- 相手へのブロック通知、被ブロック件数の公開、別アカウントの推測による制限は行わない。公開済み外部情報の削除を保証する機能ではない。

## 配備と移行

元の作業フォルダーにある並行変更を取り込まず、`origin/main` の `92d5724` から隔離した worktree で実装した。

1. RTDB Rules、Firestore Rules、必要な複合インデックスを配備。
2. 関連17 Functionsだけを配備。すべて Node.js 22 / ACTIVE、新しい Functions ソースハッシュを確認。
3. 旧ブロックを共通正本へ取り込み、関連する所有者データを補完。
4. 実装コミットを `origin/main` へ push、Firebase Hosting を配備。
5. Firebase Hosting の2ドメインと Cloudflare Worker を個別に取得し、HTMLと変更した11 JS/CSSのLF正規化SHA-256一致を確認。
6. 移行後の outbox が101件すべて完了し、未処理0件になったことを確認して共通機能を有効化。

Functions 対象:

`playerSafetyAction`, `cleanupPlayerSafety`, `soloSessionAction`, `soloFamiliarAction`, `economyAction`, `freeTableAction`, `freeTableInviteAction`, `cleanupExpiredFreeTables`, `valueMarketQueue`, `valueMarketAction`, `valueMarketShop`, `valueMarketRankings`, `anjuPayFleaAction`, `aiTextTrainingAction`, `rouletteTrainingAction`, `danwakuNoteAction`, `cleanupDanwakuDeletionJobs`。

| 移行対象 | 最終結果 |
| --- | --- |
| 旧ブロック | 112レコードを走査、重複統合後の101方向を101件すべて取り込み |
| 保存時の名前補完 | 95件解決、取得不能0件 |
| フリマお気に入りの所有者 | 実行時に存在した94件を94件補完、未解決0件 |
| 現在の部屋参照 | 索引由来34候補を確認。部屋自体の条件不適合17、両者の現在の参照を確認できないもの17を除外。許可補完対象0件 |
| 後続処理 | outbox総数101、未処理0。途中確認で再試行回数増加は観測されなかった |

部屋の対象除外は、古い部屋に新しい許可を与えないための確認である。オンライン人数0人を意味しない。お気に入りの事前確認95件と実行時94件の差は、補完失敗ではなく、走査時点の実在件数の差である。差分1件の個別原因は集計のみでは特定していない。

## 検証

- 必須 `npm run check`: tests 1438 / pass 1415 / fail 0 / skipped 23。23件はEmulator等の環境条件付きであり、全件実行成功とは扱わない。
- 共通ブロックと戦略型遷移の実 Firebase Emulators 検証: 12 pass / 0 fail / 0 skipped。
- 既存の通常型・市場・自由卓・戦略型のRTDB Rules回帰を実Emulatorで実行: 32 pass / 0 fail / 0 skipped。
- ローカル画面検証: 1440×1000、390×844。入口、モーダル、フォーカス復帰、確認画面、横はみ出し、即時の自端末切断、直前相手の導線を確認。APIはローカルfixtureであり、本番操作の証跡とは分ける。
- 最終画面修正後のフロントエンド回帰10件と構文検査が成功。10件には、全入口が一つの共通モジュールを共有し、その更新時に参照元も更新されることを確認する検査を含む。
- 本番Chromeで共通入口から認証・App Check必須の実一覧を取得。PCとスマートフォン幅で空の一覧を正常表示し、準備中の表示・ブラウザーエラーなし。ブロック等の変更操作は実行していない。
- 本番RTDB RulesはJSON正規化で一致、Firestore RulesはLF正規化で一致。必要な2インデックスは READY。
- 本番14 Callableへの無認証リクエストはすべて `401 UNAUTHENTICATED`。本番UIの認証済み読込とは別の認証境界確認。
- 更新した17サービスの起動プローブ成功をログで確認。07:50 UTC以降の検査範囲でERROR以上のログ0件（検査時刻・範囲はJSON参照）。
- 3公開URLすべてでHTTP 200、共通ブロックのマーカーと入口、HTML＋11変更アセットの一致を確認。`/functions/player-safety.js` はすべて404。

本番の実プレイヤーを相手にしたブロック・解除・対戦・購入を試験のために実行してはいない。相互ブロック、競合、旧許可の拒否、精算保持などは自動テストとEmulatorで検証し、本番では配信、設定、権限、関数稼働、実画面の読込を確認する。

## 証跡

- `GLOBAL_PLAYER_BLOCK_DESIGN.md`: 設計・実装仕様。
- `PLAYER_SAFETY_RELEASE_QA.json`: 3公開URLの取得時刻、HTTP、マーカー、全変更アセットの比較ハッシュ。
- `PLAYER_SAFETY_OPERATIONS_QA.json`: 本番Rules・インデックス・Functions・有効化設定・移行集計・稼働ログ集計。
- `PLAYER_SAFETY_UI_QA.json`: ローカル画面検証の範囲。
- 本番ブラウザー検証は別の `PLAYER_SAFETY_PRODUCTION_UI_QA.json` に記録する。
