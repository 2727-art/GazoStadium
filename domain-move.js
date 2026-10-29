(() => {
  "use strict";
  const hostKind = document.documentElement.dataset.domainHost;
  if (hostKind !== "primary" && hostKind !== "legacy") return;
  const isPrimary = hostKind === "primary";
  const closedKey = isPrimary ? "hariai-domain-returning-closed-v1" : "hariai-domain-move-closed-v2";
  try { if (sessionStorage.getItem(closedKey) === "1") return; } catch { /* Keep the notice available. */ }
  const bar = document.getElementById("domainMoveNotice");
  if (!bar) return;
  bar.setAttribute("aria-label", isPrimary ? "以前から遊んでいる方への引き継ぎ案内" : "新URLへの引き継ぎ案内");
  const wallet = bar.querySelector("[data-domain-wallet]");
  if (wallet) {
    const enable = () => { wallet.disabled = !window.HariaiApp; };
    enable();
    if (wallet.disabled) window.addEventListener("hariai-app-ready", enable, { once: true });
    wallet.addEventListener("click", () => window.HariaiApp?.openAccount?.());
  }
  bar.querySelector(".domain-move-close").addEventListener("click", () => {
    try { sessionStorage.setItem(closedKey, "1"); } catch { /* Closing still works for this page. */ }
    bar.remove();
  });
})();
