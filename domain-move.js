(() => {
  "use strict";
  const legacyHosts = new Set(["gazostadium.anjugames.workers.dev", "gazostadium.web.app", "gazostadium.firebaseapp.com"]);
  if (!legacyHosts.has(location.hostname)) return;
  const closedKey = "hariai-domain-move-closed-v2";
  try { if (sessionStorage.getItem(closedKey) === "1") return; } catch { /* Keep the notice available. */ }
  const bar = document.createElement("aside");
  bar.className = "domain-move";
  bar.setAttribute("aria-label", "新URLへの引き継ぎ案内");
  bar.innerHTML = `<div class="domain-move-copy"><strong>新URLへの引き継ぎをお願いします</strong>
    <p>新URLは hariaistadium.com です。移動前に、このURLでGoogle保護または引き継ぎコードを用意してください。</p>
    <p class="domain-move-note">同じ端末・ブラウザでも、URLが変わるとログイン状態は自動では引き継がれません。</p></div>
    <div class="domain-move-actions"><button type="button" data-domain-wallet disabled>このURLでウォレットを開く</button>
    <a href="/account-guide/">引き継ぎ手順を見る</a></div>
    <button class="domain-move-close" type="button" aria-label="引き継ぎ案内を閉じる">×</button>`;
  const wallet = bar.querySelector("[data-domain-wallet]");
  const enable = () => { wallet.disabled = !window.HariaiAccount; };
  enable();
  if (wallet.disabled) window.addEventListener("hariai-account-ready", enable, { once: true });
  wallet.addEventListener("click", () => window.HariaiAccount?.start());
  bar.querySelector(".domain-move-close").addEventListener("click", () => {
    try { sessionStorage.setItem(closedKey, "1"); } catch { /* Closing still works for this page. */ }
    bar.remove();
  });
  document.body.prepend(bar);
})();
