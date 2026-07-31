# 鍛え合い60 V6

## 体験の中心

鍛え合い60は勝敗を競うモードではない。画像に「刺さった」ことをきっかけに、
その画像を選んだ相手が60秒だけ指示役となり、運動する本人へ寄り添う1対1の伴走体験である。

- モードID: `training`
- バリアント: `companion_v6`
- プロトコル: `6`
- 最大5 DRAW
- 最初のHITでDRAWを終了
- 1ワークアウトは常に60秒
- RATE、ランキング、王座、勝敗記録の対象外
- カメラ、マイク、動作センサーは使わない
- 画像と会話本文はFirebaseへ保存しない
- 痛み、めまい、体調変化による中止は常に無罰の`NO CONTEST`

残す価値は次の5点である。

1. 自分が高得点を付けた画像の持ち主が指示役になる。
2. 指示役が、受け側の事前設定の範囲内で種目とBPMを決める。
3. 受け側が内容を確認し、自分の操作で60秒を開始する。
4. 指示役は文字で応援し、受け側は文字で反応できる。
5. 通信が一時的に切れても運動と部屋は維持される。

## V5から廃止するもの

V6はV5のセッション、ルーム、ゲーム進行と互換性を持たない。

- HP、勝敗、OVERKILL
- 採点に応じた60・75・90秒の時間差
- 1試合で複数回のDRAWと運動を交互に繰り返す構造
- DOUBLE HIT時の同時運動
- 待機ticketやP2P接続状態をルーム参加権限の根拠にする設計
- 多数のRTDB子パスからクライアントが現在フェーズを推測する設計
- P2P切断やlistener失敗を試合終了へ変換する設計

V5の履歴、購入品、実績は過去記録として保持する。V6へセッション変換はしない。

## プレイヤーフロー

```text
安全設定と画像5枚を準備
  → マッチング
  → 1枚ずつP2P交換
  → 相手画像を1〜10点で秘密採点
  → 両者とも1〜7点なら次のDRAW
  → 5DRAWすべてMISSなら交流完了
  → どちらかが8点以上ならHIT
  → 指示役と受け側をサーバーが確定
  → 指示役が種目・BPM・完了条件・最初の応援を送る
  → 受け側が内容を確認して準備OK
  → 受け側の操作で60秒開始
  → P2Pの応援とリアクション
  → 完遂確認
  → DOUBLE HITなら役割を交代してもう1本
  → 伴走完了
```

8点以上を付けた本人が「刺さった側」であり、運動を受ける。画像の持ち主が指示役となる。
DOUBLE HITでは`memberOrder`順に2本を実行し、必ず一人が指示役、一人が受け側となる。

## 安全設定

受け側はマッチング前に次を設定する。

- 実行可能なプリセット種目: 腕立て伏せ、スクワット、腹筋
- 自由種目を受け入れるか
- 最大BPM: 40〜160
- 相手だけへ見せる配慮事項: 80文字以内

指示役は受け側が許可した種目と最大BPMを超える指示を送れない。
開始前には受け側の明示的な準備確認を必須とする。

## サーバー正本

Callableは`trainingV6Action`、Realtime Database名前空間は
`online/trainingV6`とする。サーバー正本は`online/trainingV6/state`、
クライアントが直接変更できるP2Pシグナリングと本人presenceはその兄弟へ分離する。
これにより、ICE candidateやpresenceの頻繁な書き込みが正本トランザクションを
再実行させない。試合正本はすべてサーバー専用書き込みとする。

### ルーム

`online/trainingV6/state/rooms/{roomId}`は次を持つ。

- `protocolVersion: 6`
- `variant: "companion_v6"`
- `members/{uid}: true`
- `memberOrder/0`, `memberOrder/1`
- `players/{uid}`: 表示名、安全設定
- `phase`
- `revision`
- `roundNumber`
- `rounds`
- `workoutQueue`
- `activeWorkoutIndex`
- `instruction`
- `workout`
- `result`
- `connections/{uid}`
- `transportRevision`
- `createdAt`, `updatedAt`, `expiresAt`

参加者はルーム作成時に固定する。ルームの読取権限は`members`だけを根拠にし、
待機ticketのリース、presence、P2P接続状態には依存させない。

### フェーズ

```text
media_exchange
  → scoring
  → media_exchange   （両者MISS、次DRAW）
  → instruction      （HIT）
  → ready
  → workout
  → instruction      （DOUBLE HITの2本目）
  → complete

任意の進行中phase
  → no_contest
```

クライアント画面はサーバーから受け取った一つの`phase/revision`だけを描画する。
ローカルのP2P状態は`recovering`オーバーレイとして重ね、正本phaseを変更しない。

### アクション

各変更操作は`protocolVersion`、`actionId`、`expectedRevision`を持つ。
サーバーは`actionId`で重複を除外し、`expectedRevision`で順序違いを拒否する。

- `join`
- `inspect`
- `leave`
- `claim_transport`
- `image_ready`
- `score`
- `instruction`
- `ready`
- `workout_started`
- `workout_completed`
- `no_contest`
- `finish`

クライアントは未知のアクションを送らず、Functionのプロトコル応答が6でない場合は
「最新版を読み込む」画面を表示する。生のFunctionエラーや`permission_denied`は表示しない。

## P2P境界

P2Pは次だけを運ぶ。

- WebPへ端末内変換した画像本体
- 画像転送ACK
- その場だけの定型応援、自由応援、受け側リアクション
- メッセージ表示ACK

P2Pは`phase`、参加権限、運動開始時刻、完遂結果、ルーム終了を変更できない。
切断時は同じルームとphaseを維持し、画像未完了なら再接続後に再送する。
運動中なら60秒タイマーをサーバー時刻で継続し、応援欄だけを「再接続中」とする。

画像は最大1280pxのWebPへ変換し、チャンク分割してDataChannelで送る。
画像、応援、リアクション本文をRealtime Database、Cloud Firestore、
Storage、Cloud Functions、診断ログへ送らない。

## クライアント境界

```text
training.js
  └─ training-v6-app.js          入口と画面イベント
       ├─ training-v6-machine.mjs 純粋な状態遷移
       ├─ training-v6-domain.mjs 採点・役割・入力検証
       ├─ training-v6-session.mjs Callable契約
       ├─ training-v6-p2p.mjs    画像と一時メッセージ
       ├─ training-v6-store.mjs  端末内デッキ復元
       ├─ training-v6-view.mjs   DOM文字列描画
       └─ training-v6-workout.mjs BPM・タイマー・Wake Lock
```

DOM、Firebase、WebRTCを状態機械へ入れない。Firebase購読は本人ticket、
現在roomの正本snapshot、signal、presenceに限定する。

## 復帰と終了

- 再読み込み後は`inspect`で本人のV6 roomを確認する。
- active roomなら新しい`connectionId`を`claim_transport`し、同じphaseへ戻る。
- 別接続がP2P transportを取得しても、旧接続はルームを書き換えない。
- 一時切断、ブラウザのバックグラウンド化、TURN失敗では終了しない。
- プレイヤーが明示的に選んだ`NO CONTEST`だけが安全中止を確定する。
- 24時間操作されず期限切れになったactive roomだけは、サーバーが
  `session_expired / system`の`NO CONTEST`へ一度だけ確定する。
- terminalまたは期限切れ後は新しいsignal/presenceを書けないが、
  受信済みsignalと本人presenceの削除は常に許可する。
- 完了結果を保存した時点でサーバー専用`finalizationOutbox`へ登録し、
  実績・ミッション反映の成功確認後にACKしてからルームを削除可能にする。
- 完了処理待ちのroomは削除せず、ACK済みroom、一時signal/presence、
  古い操作receiptとterminal ticketだけを期限付きcleanupで削除する。

## 検証基準

- Google認証済み × ゲスト
- ゲスト × ゲスト
- Windows Chrome × Windows Edge
- Windows Chrome × Android/iOS Chrome
- 各phaseでの片側再読み込み
- 画像転送中の通信断と再送
- 指示送信の重複、遅延、逆順
- 運動中のバックグラウンド化と復帰
- DOUBLE HITの順次2本
- NO CONTEST
- FunctionとHostingの新旧キャッシュ混在

上記を単体テスト、Rulesテスト、2クライアント相当テストで通してから本番へ切り替える。
