# 自由卓の提供終了

対象日: 2026-10-09（日本時間）

## 範囲

依頼: 推奨順序で自由卓を完全に閉鎖する。通常型・戦略型の対戦／試合後チャット、縁側、牧場、AI文字コラ、ルーレット、共通安心設定、実績、AnjuPay、過去通報は撤廃しない。

実装コミット: `92edadf`。公開検証スクリプト: `d5aed30`。
基点: `3c31c9cd6e974987963073b8b650ec3c4ae7c293`。
元の作業フォルダーの未確定変更には触らず、管理された専用worktreeで実施。

## 実装

- 自由卓専用5 callableは、履歴・ウォレット・Firebaseデータを読む前に終了応答。公開人数APIだけは旧クライアント互換の0卓＋終了マーカーを返す。
- App Check・認証境界は維持。診断APIの自由卓専用DBアクセス・診断保存を停止。共通TURN・通常型診断は変更しない。
- トップの入口・卓数・統計照会、通常型／戦略型結果の灯り・統計照会を削除。トップの人数は通常型・戦略型の初回スナップショットだけ維持。
- 旧招待URLは、招待API・匿名認証・ロビーの人数照会なしに終了案内。ホームに戻る時は招待パラメーターだけ除去。
- 旧HTMLが読み込む自由卓JSにも固定終了ガード。新HTMLは専用JS/CSSを読み込まない。
- RTDB `freeTables` の全子孫をクライアント拒否。Admin保持期限清掃用 `sessions.expiresAt` インデックスは維持。自由卓以外のルールは基点とJSON比較して同一。
- 5分ごとの稼働状態全走査を、毎日04:30 Asia/Tokyoの保持期限処理へ変更。既存 `expireAt` に基づく4コレクションの期限切れ処理と、終了確定済みで15分以上を経過したセッションの上限付き清掃のみ。
- 一括の履歴削除はしない。共通安全サービスの旧自由卓関係解消、旧ブロック参照、AI用共通ambienceは維持。

## 安全な反映順序

1. 指定5 callableと `cleanupExpiredFreeTables` のみ配備し、ACTIVE・Node22・revision・保持期限専用スケジュールを確認。
2. 検証したrevisionの指紋を管理用終了マーカーに記録。旧ジョブの最大300秒を超える360秒を待つ。
3. 管理スクリプトで本番の対象件数を再確認。既存セッションがあれば正規 `safe_exit` を先に確定し、自由卓の接触権限だけを失効。
4. 同値比較に成功した自由卓の一時状態だけ整理。変化・未知データがあれば保留し、無条件削除しない。
5. RTDBルール、Hostingの順に配備し、3オリジンの配信内容を独立検証。

管理コマンドは `functions/scripts/retire-free-table-runtime.cjs`。既定はread-only件数集計。適用は明示オプションと本番6関数・Schedulerのrevision検証が必要。ログにはUID・本文・認証情報を出さない。

## 検証

- 全体 `npm --prefix functions run check`: 1,965 tests / 1,934 pass / 0 fail / 31 skip（エミュレーター専用など）。
- 認証・App Check付きCallable Emulator: 1件の統合試験で対象5 API、複数旧操作、履歴不変、診断未作成を確認。
- 自由卓拒否＋共通安全のRTDB/Firestore Emulator: 11 pass / 0 skip。22旧経路、正当な旧参加者、通常／戦略の許可維持、ブロック後拒否を確認。
- 実Admin SDKの空キャッシュからの保持期限清掃: 1 pass / 0 skip。終了済みだけ削除、生存中fixture・他モード不変、再実行時無変更。
- 旧自由卓JSを実行するVM試験: 認証・API・RTDB・timer・localStorage変更を発生させず終了案内。共有P2Pの既存アルゴリズム試験は維持。
- 公開確認: `functions/scripts/verify-free-table-retirement-release.cjs`。3オリジンで実HTML参照・LF正規化ハッシュ、旧資産URL、画像バイトハッシュ、非公開パス404を照合。

## 本番記録

初回read-only確認: 稼働セッション0、active0、接触権限0、招待0、公開卓0。
残存一時状態: roomStates19、roomOwners19、openGenerations285、requestsの親レコード2。

Functions反映開始: 2026-10-09 10:57:21 JST。6本すべて新しいrevisionでACTIVE / nodejs22を確認（11:01:04 JST）。今回更新されたFunctionsが承認済みの6本だけであることもAPIメタデータで照合。

| Function | 確認したrevision |
| --- | --- |
| freeTableAction | freetableaction-00010-liz |
| freeTableInviteAction | freetableinviteaction-00009-xok |
| freeTableInvitePreview | freetableinvitepreview-00008-neg |
| freeTablePublicStats | freetablepublicstats-00009-piy |
| reportFreeTableP2pConnectivity | reportfreetablep2pconnectivity-00006-wiv |
| cleanupExpiredFreeTables | cleanupexpiredfreetables-00010-mur |

5 callableの未認証POSTはいずれも401 UNAUTHENTICATED。SchedulerはENABLED / every day 04:30 / Asia/Tokyo。対象Cloud Run revisionの11:00:36 JST以降のERROR以上ログは11:01:57 JSTの照会で0件。

終了マーカー確定: 2026-10-09 11:01:25.625 JST。静止確認の満了は11:07:25.625 JST以降。適用開始は11:07:43 JSTで、必要な360秒を満たした。

管理整理は `complete:true`。roomStates19、roomOwners19、openGenerations285、requestsの親レコード2、合計325個の一時レコードだけを削除。セッション終了0、接触権限失効0、チャット削除0、競合レコード0、保持待ち0、未知の孤立チャット0。過去のFirestoreデータの一括削除やブロック変更は実行していない。一時レコードの復元用バックアップは作成していない。

RTDB RulesとHostingを順に配備完了。11:10:06 JSTに本番Rulesを取得し、ローカルRulesと全体JSONの正規化比較で同一と確認。

11:10:22 JSTの公開検証は、以下3オリジンすべて `ok:true`。

- https://gazostadium.web.app
- https://gazostadium.firebaseapp.com
- https://gazostadium.anjugames.workers.dev

各オリジンで通常・キャッシュ回避・旧招待の3種類のHTML、変更した6つのJS、共有部品8検査、画像2枚、旧HTMLが参照していたものを含む自由卓JSの4種類のURL、非公開パス10件の404を確認。HTML/JS/CSSのLF正規化SHA-256、画像のバイトSHA-256が作業ソースと一致。トップ画像・OGP・ヒーロー／名場面見本・共通チャット資産は基点から変更していない。

公開反映後の再dry-runでも全対象runtime枝0、稼働セッション0、接触権限0、未知データ0を確認。これは管理用の終了マーカーを削除したという意味ではなく、利用者が使える自由卓の稼働状態がないという確認である。

## 境界と復旧上の注意

費用の削減額はまだ請求実績で測定していない。旧ページを開いたままの端末から旧APIへの失敗リクエストが残る可能性はあるが、終了応答では自由卓DB照会を実行しない。実機の全プレイヤー操作を本番で代行・再現してはいない。

ロールバックで旧機能を再開しない。表示の修正が必要でも、サーバーの終了応答・RTDB拒否を維持する。一時状態を削除した後の旧稼働状態への巻き戻しは対象外。保持した過去データと共通ブロックはそのまま維持する。
