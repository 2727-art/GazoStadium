import routing from "../functions-legacy-router/route.cjs";
const { LEGACY_HOSTS, APP_PATHS, redirectFor, keepLegacyAsset } = routing;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!LEGACY_HOSTS.has(url.hostname) || (!APP_PATHS.has(url.pathname) && keepLegacyAsset(url.pathname))) {
      return env.ASSETS.fetch(request);
    }
    const { status, location } = redirectFor(url);
    return new Response(null, {
      status,
      headers: { Location: location, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  },
};
