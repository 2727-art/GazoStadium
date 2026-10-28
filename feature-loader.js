(() => {
  "use strict";
  const manifest = JSON.parse(document.querySelector("#featureManifest").textContent);
  const features = new Map();
  const scripts = new Map();
  const styles = new Map();

  function style(name) {
    if (styles.has(name)) return styles.get(name);
    const link = document.querySelector(`link[data-feature-style="${name}"]`);
    if (!link) return Promise.reject(new Error(`Missing stylesheet: ${name}`));
    const request = new Promise((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => { link.removeAttribute("href"); reject(new Error("画面のスタイルを読み込めませんでした。もう一度お試しください。")); };
      link.rel = "stylesheet";
      link.href = link.dataset.src;
    }).catch(error => { styles.delete(name); throw error; });
    styles.set(name, request);
    return request;
  }

  function classic(src) {
    if (scripts.has(src)) return scripts.get(src);
    const request = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); reject(new Error("機能を読み込めませんでした。もう一度お試しください。")); };
      document.head.appendChild(script);
    }).catch(error => { scripts.delete(src); throw error; });
    scripts.set(src, request);
    return request;
  }

  function load(name) {
    if (features.has(name)) return features.get(name);
    const config = manifest[name];
    if (!config) return Promise.reject(new Error("未対応の画面です。"));
    const request = Promise.resolve().then(async () => {
      await Promise.all([...(config.depends || []).map(load), ...(config.styles || []).map(style), ...(config.classic || []).map(classic)]);
      if (config.module) await import(new URL(config.module, document.baseURI).href);
    }).catch(error => { features.delete(name); throw error; });
    features.set(name, request);
    return request;
  }
  window.HariaiFeatures = Object.freeze({ load });
})();
