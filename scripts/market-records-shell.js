import { renderBlockButton } from "./player-safety.js?v=global-player-block-v1-copy-v2-auth-session-v1-lazy-loading-v1-mobile-loading-v1";
import { ensureHariaiUser } from "./auth-session.js?v=auth-session-v1-lazy-loading-v1-mobile-loading-v1";
import { httpsCallable } from "./assets/firebase/firebase-functions-TFNFZUKR.js";
import { functions, useOfflineMarketPreview } from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1-lazy-loading-v1-mobile-loading-v1";
import { ANJU_PAY_UNIT, formatAnjuPay, formatAnjuPayNumber } from "./anju-pay-format.mjs?v=anju-pay-format-v1";
import { getPlayerTitlePresentation, getPlayerTitleProduct } from "./player-titles.js?v=player-titles-v3-retire-team-v1-remove-royale-v1";
import { getStamp } from "./stamps.js?v=stamps-v1-oshi-jouzu-duo-v1-restore-v1-remove-royale-v1";
const useMarketPreview = useOfflineMarketPreview;
const appRoot = document.querySelector("#app");
const requestMarketRankings = httpsCallable(functions, "valueMarketRankings");
const reads = new Map();
function marketRankingsCallable(payload) {
 if (!["list", "collection"].includes(payload.action)) return requestMarketRankings(payload);
 const key = `${lifecycleGeneration}:${payload.action}:${payload.period || ""}`;
 if(reads.has(key)) return reads.get(key);
 const request = requestMarketRankings(payload).catch(error => {reads.delete(key);throw error;});
 reads.set(key, request);
 return request;
}
let active = false;
let lifecycleGeneration = 0;
let state;
function createState() {
 return { authReady:useMarketPreview, screen: "rankings", name: "PLAYER", uid: "", room: null,
  marketPolicy: {successFeeBasisPoints:500,minimumSuccessFee:1},
  rankings: {monthly:{sellers:[],buyers:[],label:""},lifetime:{sellers:[],buyers:[],label:""}},
  rankingPeriod: "monthly", rankingPeriodsLoaded: new Set(), rankingsStatus: "loading", rankingReturnScreen: "landing",
  rankingMonthlyAchievements: normalizeMarketMonthlyAchievements(null), rankingMonthlyAchievementsAvailable:false,
  rankingMeta:{monthlyStartKey:"",finalizedSeasonKey:"",rankingContributionCap:500},
  rankingProfile:{xHandle:"",tagline:""},rankingProfileEligible:false,rankingProfileName:"",rankingProfileOpen:false,rankingProfileBusy:false,
  certificates:[],certificateStatus:"idle",certificateHasMore:false,certificateReturnScreen:"rankings"
 };
}
function isCurrentLifecycle(generation) { return active && generation === lifecycleGeneration; }
// Existing historical records remain; retired referral/trading actions have no UI.
function renderMarketRecommendationAction() { return ""; }
function applyMarketPatronExperience() {}
function showToast(message) { window.HariaiApp.shared.showToast(message); }
function render() {
 if(!active) return;
 appRoot.innerHTML = `<nav class="market-records-nav" aria-label="旧市場の記録"><button type="button" class="button button-ghost" id="recordsRankings">ランキング・永久実績</button><button type="button" class="button button-ghost" id="recordsCertificates">購入済みの推し値証書</button></nav>` + (state.screen === "certificates" ? renderCertificates() : renderRankings());
 if(!state.authReady) appRoot.querySelectorAll("button").forEach(button => {if(button.id !== "marketRankingBack")button.disabled=true;});
 if(state.rankingsStatus === "error" && state.screen === "rankings") appRoot.insertAdjacentHTML("beforeend", `<p role="alert">ランキングを読み込めませんでした。<button class="button button-ghost" id="recordsRetry">再読み込み</button></p>`);
 document.querySelector("#recordsRankings").onclick = () => { state.screen="rankings"; if(state.rankingsStatus==="idle") openRankings("landing"); else render(); };
 document.querySelector("#recordsCertificates").onclick = () => openCertificates("rankings");
 document.querySelector("#marketRankingBack")?.addEventListener("click", requestHome);
 document.querySelector("#marketCertificatesBack")?.addEventListener("click", () => {state.screen="rankings";render();});
 document.querySelector("#marketCertificatesRetry")?.addEventListener("click", () => openCertificates("rankings",{force:true}));
 document.querySelector("#recordsRetry")?.addEventListener("click", () => start());
 document.querySelectorAll("[data-market-ranking-period]").forEach(button => button.addEventListener("click", () => selectMarketRankingPeriod(button.dataset.marketRankingPeriod)));
 document.querySelector("#marketRankingProfileForm")?.addEventListener("submit",saveMarketRankingPublicProfile);
 document.querySelector("#marketRankingXHandle")?.addEventListener("input",updateMarketXHandleInput);
 for(const id of ["marketRankingXPublic","marketRankingTagline","marketRankingTaglinePublic"])document.getElementById(id)?.addEventListener("input",updateMarketProfilePreview);
}
async function start() {
 if (["HariaiOnline","HariaiStrategy","HariaiAiTextTraining","HariaiRouletteTraining","HariaiTribute","HariaiStadium","HariaiAccount"].some(name => window[name]?.isActive?.())) return;
 active = true;
 const generation = ++lifecycleGeneration;
 reads.clear();
 state = createState();
 render();
 appRoot.focus({preventScroll:true});
 try {
  if(!useMarketPreview) { const user = await ensureHariaiUser(); if(!isCurrentLifecycle(generation))return; state.uid=user.uid; state.authReady=true; }
  if(isCurrentLifecycle(generation)) await openRankings("landing");
 } catch(error){if(isCurrentLifecycle(generation)){state.rankingsStatus="error";render();showToast(error.message || "記録を読み込めませんでした。");}}
}
function requestHome() { active=false; lifecycleGeneration++; window.HariaiApp.returnHome(); }
window.HariaiMarket = {start,openRankingsFromLanding:start,isActive:()=>active,requestHome};
window.dispatchEvent(new Event("hariai-market-ready"));
