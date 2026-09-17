# 画像の好み別の累計実績

## 仕様

通常型1on1・戦略型1on1で、本人が対戦開始時に選んだ好みごとの正式完走を累計する。勝ち・負け・引き分けをすべて含め、相手の選択や実際に送った画像の分類は条件にしない。

| 系列 | Lv.1〜9 | Lv.10 |
| --- | --- | --- |
| アニメ・イラスト | アニメ・イラスト探究 | アニメ・イラストの境地 |
| 実写 | 実写探究 | 実写の境地 |

共通閾値は1、5、20、50、100、300、1,000、3,000、5,000、10,000試合。「どちらも歓迎」はどちらにも加算しない。導入前の対戦や開始時の記録がない旧対戦は既存の通算対戦だけに加算し、過去の好みを推測しない。好みの変更後も両系列の累計を保存する。

「画像の好み」カテゴリで最高解除段階を表示する。🎨・📷と系列の色を使い、Lv.10には既存のFINAL装飾を適用する。2系列とも`autoPublic: false`で、本人が選んだ場合のみ公開する。総合・下限ランキング等の既存ショーケース最大3件枠を共用する。公開称号は累計の歩みであり、現在のマッチング設定そのものを公開する機能ではない。

## 記録と互換性

- 通常V2: 検証済み待機列から選択を取り、ルーム作成と同じRTDB atomic updateで専用の非公開snapshotを保存する。
- 旧通常・顔なじみ再会: 専用の非公開permit項目を保持し、公開ルーム生成前にsnapshotをcreate-onlyで固定する。
- 戦略: accept時の待機列・参加者検証後、active化前にcreate-onlyで固定する。
- 保存先は`online/matchImagePreferenceSnapshots/{solo|strategy}/{roomId}`。schema・モード・roomId・開始時刻・両参加者・期限の一致を確認する。room/player/offer/他者向けレスポンスには含めない。
- 正式決着の`recordVerifiedMatch`だけが本人ごとのsnapshotを使用する。リクエスト側の好みは参照しない。既存のFirestore transactionで統計・解除実績・重複防止claimを同時保存する。
- snapshot読取り障害時はclaim作成前に失敗し、再試行で加算できる。snapshot欠落は旧対戦として扱い、既存の報酬・通算を維持する。
- snapshotの有効期間は24時間。結果受理の上限12時間より長く保持し、既存6時間ごとのcleanupで期限切れを上限付きで削除する。既存のFirestore/RTDB公開プロフィールへ選択別統計は送らない。
- 既存のAnjuPay、RATE、勝敗、完走条件、画像本体の保存方針は変更しない。

## リリース対象

Firebase Realtime Database Rules、Hosting、以下14 Functions。

実績保存: `economyAction`, `redeemAchievementCode`, `valueMarketAction`, `anjuPayFleaAction`, `danwakuNoteAction`, `aiTextTrainingAction`, `rouletteTrainingAction`, `valueMarketRankings`, `playerSafetyAction`, `cleanupPlayerSafety`。

対戦時の公開実績処理: `soloSessionAction`, `soloFamiliarAction`, `matchAchievementShowcase`。

期限切れsnapshot掃除: `cleanupStrategyMatchAchievementFreezes`。

旧catalogで新実績が失われないよう、関連writerとreaderの更新を先にし、新しい対戦snapshotの生成を行う`soloSessionAction`、`soloFamiliarAction`、`playerSafetyAction`を後段で更新する。Firestore Rules/indexと実プレイヤーの既存統計の移行は不要。

## 検証と証跡

- Functions全体チェック: `functions/docs/image-preference-unit-check.log`。
- 実Firebase Emulatorの非公開Rules・戦略マッチング: `functions/docs/image-preference-emulator-check.log`。専用demoプロジェクトのみ使用。
- 実ブラウザーのコレクション・ショーケース・総合・下限ランキング、1440/390/320px: `IMAGE_PREFERENCE_ACHIEVEMENTS_UI_QA.json`と同フォルダーのスクリーンショット。合成fixtureを使用し、本番リクエスト/WebSocketを遮断。
- 本番確認: `verify-image-preference-functions.cjs`、`verify-image-preference-release.cjs`で更新revision/起動/認証境界と公開3経路のHTML/変更asset一致・非公開ファイル除外を確認する。

## 本番リリース結果（2026年9月17日）

実装コミット`661113dd8d6f3b6eb041d73c62fe5cb40fe4354c`を`origin/main`へpushし、gazostadiumへ反映した。2026-09-17 20:57 JSTから、RTDB Rules → 関連writer/reader/cleanup 11件 → playerSafetyAction → soloSessionAction/soloFamiliarAction → Hostingの順でデプロイし、21:04 JSTに独立確認を完了した。

- Node.js 22.23.2のFunctions全体チェック: 1,482件中1,458成功、失敗0、条件付きEmulator試験24件は通常実行ではスキップ。
- 実Firebase Emulatorで追加実行: 非公開snapshotのRulesと既存戦略マッチングの5件成功、失敗・スキップ0。
- UI: コレクション・ショーケース・総合・下限の4面×1440/390/320pxの12条件が成功。新系列名やLvの非表示、横はみ出し、JavaScript例外なし。SECRET/SPECIALの既存表示も確認。
- `IMAGE_PREFERENCE_ACHIEVEMENTS_RULES_QA.json`: 本番Rulesの正規化SHA-256がローカルと一致。新private pathのread/write拒否とindexが一致し、未認証読取りは401。
- `IMAGE_PREFERENCE_ACHIEVEMENTS_FUNCTIONS_QA.json`: 14件すべてACTIVE、Node.js 22、新revision。12 Callableの未認証応答は401 UNAUTHENTICATED。14件すべての起動成功ログを確認し、デプロイ開始以降の対象サービスERRORは0。
- `IMAGE_PREFERENCE_ACHIEVEMENTS_RELEASE_QA.json`: `gazostadium.web.app`、`gazostadium.firebaseapp.com`、`gazostadium.anjugames.workers.dev`すべてでHTMLと変更4assetがローカルに一致。通常URLとcache bust URLの双方でHTTP・Content-Type・LF正規化hashを確認し、非公開のFunctions/記録ファイルは404。
- `ANJU_PAY_LEDGER_REQUIRED`は14件の本番設定が同一であることを事前確認し、その値を維持した。実ユーザーの統計のbackfillは実行していない。

対戦・解除・再送・同時確定の挙動はローカル自動テストと専用demo Emulator、UIは合成fixtureで確認した。本番で合成の対戦や実績付与を発生させる試験は行っていない。
