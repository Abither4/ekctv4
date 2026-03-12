// Cloudflare Worker - CORS Proxy for EKC TV
// Deploy: npx wrangler deploy worker/cors-proxy.js --name ekctv-proxy
// Or paste into Cloudflare Dashboard > Workers > Create > Quick Edit

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    if (!targetUrl) {
      return new Response('Missing ?url= parameter', { status: 400, headers: corsHeaders() });
    }

    try {
      const target = new URL(targetUrl);

      // Only allow proxying to known IPTV servers and known APIs
      const allowed = [
        'pradahype.com',
        'pinkponyclub.online',
        'v3-cinemeta.strem.io',
        'torrentio.strem.fun',
        'comet.elfhosted.com',
        'www.omdbapi.com',
        'pipedapi.kavin.rocks',
        'piped-api.privacy.com.de',
        'piped.video',
        'piped.private.coffee',
        'piped.kavin.rocks',
      ];

      const isAllowed = allowed.some(d => target.hostname === d || target.hostname.endsWith('.' + d));
      // Also allow any stremio addon domains
      const isStremio = target.pathname.includes('/catalog/') ||
                        target.pathname.includes('/stream/') ||
                        target.pathname.includes('/meta/') ||
                        target.pathname.includes('/manifest.json');

      if (!isAllowed && !isStremio) {
        return new Response('Domain not allowed', { status: 403, headers: corsHeaders() });
      }

      // Forward the request
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': 'EKC-TV/4.0',
          'Accept': '*/*',
        },
        redirect: 'follow',
      });

      // Clone response and add CORS headers
      const newHeaders = new Headers(resp.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', '*');
      // Remove restrictive headers from upstream
      newHeaders.delete('X-Frame-Options');
      newHeaders.delete('Content-Security-Policy');

      return new Response(resp.body, {
        status: resp.status,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 502, headers: corsHeaders() });
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}
