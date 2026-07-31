const PHASE_LABELS = Object.freeze({
  media_exchange: "IMAGE EXCHANGE",
  scoring: "SECRET SCORE",
  instruction: "COMPANION COMMAND",
  ready: "READY",
  workout: "60 SEC TOGETHER",
  complete: "COMPLETE",
  no_contest: "NO CONTEST",
});

const EXERCISE_LABELS = Object.freeze({
  push_up: "腕立て伏せ",
  squat: "スクワット",
  sit_up: "腹筋",
  custom: "自由種目",
});

export function escapeTrainingV6Html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function selected(value, expected) {
  return value === expected ? " selected" : "";
}

function checked(condition) {
  return condition ? " checked" : "";
}

function disabled(condition) {
  return condition ? " disabled" : "";
}

function imagePreview(image, index) {
  return `
    <figure class="training-v6-deck-card${image ? " is-ready" : ""}">
      ${image
        ? `<img src="${escapeTrainingV6Html(image.url)}" alt="選択画像 ${index + 1}">`
        : `<div class="training-image-placeholder"><span>IMAGE ${index + 1}</span><strong>未選択</strong></div>`}
      <figcaption>${image ? `CARD ${index + 1}` : "EMPTY"}</figcaption>
    </figure>
  `;
}

export function renderTrainingV6Loading() {
  return `
    <section class="screen training-screen training-v6-screen training-v6-center">
      <span class="eyebrow">TRAINING 60 / PROTOCOL V6</span>
      <h1>鍛え合い<span>60</span></h1>
      <p>安全な伴走セッションを準備しています。</p>
      <div class="training-v6-loader" aria-label="読み込み中"></div>
    </section>
  `;
}

export function renderTrainingV6Setup({
  authReady,
  name,
  images,
  allowedExercises,
  maxBpm,
  conditionText,
  busy,
  restored,
} = {}) {
  const imageList = Array.from({ length: 5 }, (_, index) => images?.[index] || null);
  const ready = Boolean(authReady)
    && imageList.every(Boolean)
    && String(name || "").trim().length > 0
    && Array.isArray(allowedExercises)
    && allowedExercises.length > 0;
  return `
    <section class="screen training-screen training-v6-screen" aria-labelledby="trainingV6Title">
      <header class="training-heading training-v6-heading">
        <span class="eyebrow">YOUR IMAGE. THEIR RHYTHM. 60 SECONDS TOGETHER.</span>
        <h1 id="trainingV6Title">鍛え合い<span>60</span></h1>
        <p>刺さった一枚の持ち主が、あなたの60秒に寄り添います。勝敗やRATEはありません。</p>
      </header>

      ${restored ? `
        <div class="training-v6-notice" role="status">
          端末に一時保存した画像デッキを復元しました。
        </div>
      ` : ""}

      <form id="trainingV6SetupForm" class="training-v6-setup-grid">
        <section class="training-profile-card">
          <div class="training-section-head">
            <span>01</span>
            <div>
              <h2>あなたの5枚</h2>
              <p>端末内でWebPへ変換し、相手の端末へ直接送ります。</p>
            </div>
          </div>
          <div class="training-v6-deck-grid">
            ${imageList.map(imagePreview).join("")}
          </div>
          <label class="button button-secondary training-file-button training-v6-file-button">
            <input id="trainingV6Images" type="file" accept="image/*" multiple>
            画像を5枚選ぶ
          </label>
          <p class="training-privacy">Firebase・Storage・運営サーバーへ画像を保存しません。試合中の再読み込みに備え、この端末内だけへ最大24時間一時保存します。</p>
        </section>

        <section class="training-profile-card">
          <div class="training-section-head">
            <span>02</span>
            <div>
              <h2>呼ばれたい名前</h2>
              <p>伴走中に相手へ表示します。</p>
            </div>
          </div>
          <label class="training-field">
            <span>表示名</span>
            <input id="trainingV6Name" maxlength="24" value="${escapeTrainingV6Html(name)}" autocomplete="nickname" required>
          </label>
        </section>

        <section class="training-profile-card training-v6-safety-card">
          <div class="training-section-head">
            <span>03</span>
            <div>
              <h2>できる運動の範囲</h2>
              <p>相手は、この範囲を超える指示を送れません。</p>
            </div>
          </div>
          <fieldset class="training-v6-exercise-list">
            <legend>受け入れ可能な種目</legend>
            ${Object.entries(EXERCISE_LABELS).map(([id, label]) => `
              <label>
                <input type="checkbox" name="trainingV6Exercise" value="${id}"${checked(allowedExercises?.includes(id))}>
                <span>${escapeTrainingV6Html(label)}</span>
              </label>
            `).join("")}
          </fieldset>
          <label class="training-field">
            <span>最大BPM</span>
            <select id="trainingV6MaxBpm">
              ${[40, 60, 80, 100, 120, 140, 160].map((bpm) => `
                <option value="${bpm}"${selected(Number(maxBpm), bpm)}>${bpm} BPM</option>
              `).join("")}
            </select>
          </label>
          <label class="training-field">
            <span>相手へ伝える配慮事項（任意）</span>
            <textarea id="trainingV6Condition" maxlength="80" placeholder="例：膝に負担の少ない動きでお願いします">${escapeTrainingV6Html(conditionText)}</textarea>
          </label>
          <div class="training-v6-safety-note">
            痛み・めまい・体調変化があれば、いつでも無罰で中止できます。動作の撮影や判定は行いません。
          </div>
        </section>

        <button class="button button-training training-v6-start" type="submit"${disabled(!ready || busy)}>
          ${busy ? "準備を保存しています…" : ready ? "この5枚で相手を探す" : `画像 ${imageList.filter(Boolean).length} / 5`}
        </button>
      </form>
    </section>
  `;
}

export function renderTrainingV6Matching({
  waitedSeconds = 0,
  connectionLabel = "接続確認中",
} = {}) {
  return `
    <section class="screen training-screen training-v6-screen training-v6-center">
      <span class="eyebrow">COMPANION MATCHING / V6</span>
      <h1>寄り添う相手を<br>探しています</h1>
      <p>画像デッキと安全設定はこの端末に保持されています。</p>
      <div class="training-v6-match-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="training-v6-match-meta">
        <span>${escapeTrainingV6Html(connectionLabel)}</span>
        <strong>${Math.max(0, Number(waitedSeconds) || 0)} sec</strong>
      </div>
      <button class="button button-secondary" id="trainingV6CancelMatch">設定を保って検索をやめる</button>
    </section>
  `;
}

function roomHeader(model) {
  const snapshot = model.snapshot || {};
  return `
    <header class="training-v6-room-head">
      <div>
        <span class="eyebrow">${escapeTrainingV6Html(PHASE_LABELS[snapshot.phase] || snapshot.phase)}</span>
        <h1>${escapeTrainingV6Html(model.ownName)} <span>×</span> ${escapeTrainingV6Html(model.opponentName)}</h1>
      </div>
      <div class="training-v6-room-badges">
        <span>DRAW ${Number(snapshot.roundNumber || 1)} / 5</span>
        <span class="is-${escapeTrainingV6Html(model.transportState)}">${model.transportState === "online" ? "P2P CONNECTED" : "P2P RECONNECTING"}</span>
      </div>
    </header>
  `;
}

function recoveryOverlay(model) {
  if (model.transportState !== "recovering") return "";
  return `
    <aside class="training-v6-recovery" role="status">
      <strong>応援・画像通信を再接続しています</strong>
      <span>ルームと進行は保持されています。タイトルへは戻りません。</span>
    </aside>
  `;
}

function stopButton() {
  return `
    <button class="training-v6-health-stop" id="trainingV6HealthStop">
      痛み・めまい・体調変化のため中止（NO CONTEST）
    </button>
  `;
}

function renderMediaExchange(model) {
  return `
    <section class="training-v6-phase training-v6-media">
      <div class="training-v6-phase-kicker">RANDOM DRAW / P2P IMAGE</div>
      <h2>DRAW ${model.snapshot.roundNumber}を交換中</h2>
      <p>両方の端末で画像本体を確認できてから、採点へ進みます。</p>
      <div class="training-v6-transfer-grid">
        <article class="${model.localImageAcknowledged ? "is-complete" : ""}">
          <i></i><strong>あなたの画像を相手へ送信</strong>
          <span>${model.localImageAcknowledged ? "受信確認済み" : "暗号化されたP2P経路で送信中"}</span>
        </article>
        <article class="${model.remoteImage ? "is-complete" : ""}">
          <i></i><strong>相手画像を受信・検証</strong>
          <span>${model.remoteImage ? "端末内で検証済み" : "相手からの画像を待っています"}</span>
        </article>
      </div>
    </section>
  `;
}

function renderScoring(model) {
  return `
    <section class="training-v6-phase training-v6-score">
      <div class="training-v6-phase-kicker">SECRET SCORE</div>
      <h2>この一枚は、あなたにどれくらい刺さりましたか？</h2>
      ${model.remoteImage
        ? `<figure class="training-v6-main-image"><img src="${escapeTrainingV6Html(model.remoteImage.url)}" alt="相手のDRAW画像"></figure>`
        : `<div class="training-image-placeholder"><span>RECONNECTING IMAGE</span><strong>画像を再受信しています</strong></div>`}
      ${model.ownScore
        ? `<div class="training-v6-score-wait"><strong>${model.ownScore}点で確定</strong><span>相手の採点を待っています。採点は両者確定まで相手へ見えません。</span></div>`
        : `<div class="training-v6-score-grid" aria-label="1点から10点で採点">
            ${Array.from({ length: 10 }, (_, index) => index + 1).map((score) => `
              <button type="button" data-training-v6-score="${score}"${disabled(!model.remoteImage)}>
                <strong>${score}</strong><span>${score >= 8 ? "HIT" : "MISS"}</span>
              </button>
            `).join("")}
          </div>`}
      <p class="training-v6-score-rule">8点以上を付けたあなたが受け側となり、画像の持ち主が60秒の指示役になります。</p>
    </section>
  `;
}

function instructionSummary(instruction) {
  if (!instruction) return "";
  return `
    <article class="training-v6-instruction-card">
      <span>${escapeTrainingV6Html(EXERCISE_LABELS[instruction.exerciseId] || instruction.exercise)}</span>
      <h3>${escapeTrainingV6Html(instruction.exercise)}</h3>
      <div class="training-v6-rhythm"><strong>${Number(instruction.bpm)} BPM</strong><small>${Number(instruction.beatsPerRep)}拍 / 1回</small></div>
      <p>${escapeTrainingV6Html(instruction.command)}</p>
      <dl>
        <div><dt>完了条件</dt><dd>${escapeTrainingV6Html(instruction.completion)}</dd></div>
      </dl>
    </article>
  `;
}

function renderInstruction(model) {
  if (!model.isTrainer) {
    return `
      <section class="training-v6-phase training-v6-wait-role">
        <div class="training-v6-role-mark">RECEIVER</div>
        <h2>${escapeTrainingV6Html(model.opponentName)}さんが、あなたの60秒を考えています</h2>
        <p>できる種目と最大BPMの範囲内で指示が届きます。</p>
      </section>
    `;
  }
  const victimProfile = model.victimProfile || {};
  const allowed = victimProfile.allowedExercises || [];
  const firstExercise = allowed[0] || "squat";
  return `
    <section class="training-v6-phase training-v6-command">
      <div class="training-v6-role-mark">COMPANION</div>
      <h2>${escapeTrainingV6Html(model.opponentName)}さんの60秒に寄り添う</h2>
      <p>相手の安全設定を守り、種目・リズム・最初の一言を決めてください。</p>
      ${victimProfile.conditionText ? `<div class="training-v6-condition"><strong>配慮事項</strong>${escapeTrainingV6Html(victimProfile.conditionText)}</div>` : ""}
      <form id="trainingV6InstructionForm" class="training-v6-command-form">
        <label class="training-field">
          <span>種目</span>
          <select id="trainingV6ExerciseId">
            ${allowed.map((id) => `<option value="${escapeTrainingV6Html(id)}">${escapeTrainingV6Html(EXERCISE_LABELS[id] || id)}</option>`).join("")}
          </select>
        </label>
        <label class="training-field training-v6-custom-exercise"${firstExercise === "custom" ? "" : " hidden"}>
          <span>自由種目名</span>
          <input id="trainingV6Exercise" maxlength="40" value="">
        </label>
        <div class="training-v6-command-row">
          <label class="training-field">
            <span>BPM（最大 ${Number(victimProfile.maxBpm || 160)}）</span>
            <input id="trainingV6Bpm" type="number" min="40" max="${Number(victimProfile.maxBpm || 160)}" value="${Math.min(100, Number(victimProfile.maxBpm || 100))}">
          </label>
          <label class="training-field">
            <span>1回の拍数</span>
            <select id="trainingV6Beats"><option value="2">2拍</option><option value="4" selected>4拍</option><option value="8">8拍</option></select>
          </label>
        </div>
        <label class="training-field"><span>完了条件</span><input id="trainingV6Completion" maxlength="60" value="60秒、自分のペースで続ける"></label>
        <label class="training-field"><span>運動の指示</span><textarea id="trainingV6Command" maxlength="120">呼吸を止めず、無理のない範囲でリズムに合わせて続けてください。</textarea></label>
        <label class="training-field"><span>最初の応援（P2P・保存なし）</span><input id="trainingV6InitialCheer" maxlength="40" value="一緒に60秒、最後までそばにいます！"></label>
        <button class="button button-training" type="submit">この内容で指示を送る</button>
      </form>
    </section>
  `;
}

function renderReady(model) {
  return `
    <section class="training-v6-phase training-v6-ready">
      <div class="training-v6-role-mark">${model.isVictim ? "RECEIVER" : "COMPANION"}</div>
      <h2>${model.isVictim ? "内容を確認して、自分のタイミングで進む" : `${escapeTrainingV6Html(model.opponentName)}さんの準備を待っています`}</h2>
      ${instructionSummary(model.instruction)}
      ${messageList(model)}
      ${model.isVictim
        ? `<button class="button button-training" id="trainingV6Ready"${disabled(model.transportState !== "online")}>${model.transportState === "online" ? "内容を確認しました" : "応援通信を再接続中"}</button>`
        : `<p class="training-v6-wait-copy">開始を急かさず、相手の準備を待ちましょう。</p>`}
    </section>
  `;
}

function messageList(model) {
  const messages = Array.isArray(model.messages) ? model.messages.slice(-20) : [];
  if (!messages.length) {
    return `<div class="training-v6-message-empty">ここに応援とリアクションが表示されます。</div>`;
  }
  return messages.map((message) => `
    <div class="training-v6-message ${message.own ? "is-own" : "is-remote"}">
      <span>${message.kind === "cheer" ? "応援" : "リアクション"}</span>
      <p>${escapeTrainingV6Html(message.text)}</p>
      ${message.pending ? "<small>送信確認中</small>" : ""}
    </div>
  `).join("");
}

function renderWorkout(model) {
  const started = Number(model.workout?.startedAt) > 0;
  const remaining = Math.max(0, Math.ceil(Number(model.remainingMs || 60_000) / 1_000));
  const progress = Math.max(0, Math.min(100, Number(model.progress || 0) * 100));
  return `
    <section class="training-v6-phase training-v6-workout">
      <div class="training-v6-role-mark">${model.isVictim ? "MOVE" : "STAY WITH THEM"}</div>
      ${instructionSummary(model.instruction)}
      ${started
        ? `<div class="training-v6-timer" style="--training-progress:${progress}%">
            <div><strong id="trainingV6Seconds">${remaining}</strong><span>SEC</span></div>
            <div class="training-v6-progress"><i id="trainingV6Progress"></i></div>
          </div>`
        : `<div class="training-v6-start-workout">
            <h2>${model.isVictim ? "準備ができたら60秒を開始" : "相手が開始するのを待っています"}</h2>
            ${model.isVictim
              ? model.transportState === "online"
                ? `<button class="button button-training" id="trainingV6StartWorkout">BPMを鳴らして開始</button>`
                : `<p class="training-v6-wait-copy">伴走相手との応援通信を再接続してから開始できます。</p>`
              : ""}
          </div>`}
      ${started ? `
        <div class="training-v6-companion-panel">
          <div class="training-v6-messages" id="trainingV6Messages">${messageList(model)}</div>
          <div class="training-v6-quick-messages">
            ${(model.isVictim
              ? ["届いてる！", "ありがとう！", "まだいける！", "きつい！", "ラスト！"]
              : ["いける！", "いいリズム！", "あと半分！", "無理しないで！", "ラスト！"]
            ).map((text) => `<button type="button" data-training-v6-message="${escapeTrainingV6Html(text)}">${escapeTrainingV6Html(text)}</button>`).join("")}
          </div>
          <form id="trainingV6MessageForm" class="training-v6-message-form">
            <input id="trainingV6MessageText" maxlength="40" placeholder="${model.isVictim ? "文字でリアクション" : "文字で応援"}">
            <button type="submit">送る</button>
          </form>
        </div>
      ` : ""}
      ${started && model.isVictim && model.workoutComplete
        ? `<button class="button button-training training-v6-complete-workout" id="trainingV6CompleteWorkout">60秒を完遂しました</button>`
        : ""}
    </section>
  `;
}

function renderTerminal(model) {
  const complete = model.snapshot.phase === "complete";
  const result = model.snapshot.result || {};
  return `
    <section class="training-v6-phase training-v6-result">
      <span class="eyebrow">${complete ? "ACCOMPANIMENT COMPLETE" : "SAFETY FIRST / NO CONTEST"}</span>
      <h2>${complete ? "ひとりではない60秒を、完遂しました" : "安全にセッションを終了しました"}</h2>
      <p>${complete
        ? result.type === "all_miss"
          ? "今回はHITなし。5枚を見せ合った時間も、ひとつの交流です。"
          : "指示する人、動く人。役割を分けたからこそ、相手の60秒に寄り添えました。"
        : "体調と安全を優先した中止です。勝敗も不利益もありません。"}</p>
      <dl class="training-v6-result-stats">
        <div><dt>DRAW</dt><dd>${Number(result.drawCount || model.snapshot.roundNumber || 0)}</dd></div>
        <div><dt>WORKOUT</dt><dd>${Number(result.workoutCount || 0)}</dd></div>
        <div><dt>RATE</dt><dd>対象外</dd></div>
      </dl>
      <button class="button button-training" id="trainingV6Finish">タイトルへ戻る</button>
    </section>
  `;
}

export function renderTrainingV6Room(model = {}) {
  const phase = model.snapshot?.phase;
  let phaseContent = "";
  if (phase === "media_exchange") phaseContent = renderMediaExchange(model);
  else if (phase === "scoring") phaseContent = renderScoring(model);
  else if (phase === "instruction") phaseContent = renderInstruction(model);
  else if (phase === "ready") phaseContent = renderReady(model);
  else if (phase === "workout") phaseContent = renderWorkout(model);
  else if (phase === "complete" || phase === "no_contest") {
    phaseContent = renderTerminal(model);
  }
  return `
    <section class="screen training-screen training-v6-screen training-v6-room">
      ${roomHeader(model)}
      ${recoveryOverlay(model)}
      ${phaseContent}
      ${phase !== "complete" && phase !== "no_contest" ? stopButton() : ""}
    </section>
  `;
}

export function renderTrainingV6Error({
  title = "鍛え合い60を開始できませんでした",
  message = "通信状態を確認してください。",
  updateRequired = false,
  ownerReplaced = false,
} = {}) {
  return `
    <section class="screen training-screen training-v6-screen training-v6-center">
      <span class="eyebrow">${updateRequired ? "UPDATE REQUIRED" : "CONNECTION PAUSED"}</span>
      <h1>${escapeTrainingV6Html(title)}</h1>
      <p>${escapeTrainingV6Html(message)}</p>
      ${ownerReplaced
        ? ""
        : updateRequired
        ? `<button class="button button-training" id="trainingV6Reload">最新版を読み込む</button>`
        : `<button class="button button-training" id="trainingV6Retry">接続を再試行</button>`}
      <button class="button button-secondary" id="trainingV6ErrorHome">タイトルへ戻る</button>
    </section>
  `;
}

export { EXERCISE_LABELS, PHASE_LABELS };
