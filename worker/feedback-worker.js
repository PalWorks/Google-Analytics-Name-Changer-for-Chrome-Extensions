/**
 * GA4 Name Changer — feedback relay
 *
 * A Cloudflare Worker that receives the options page's feedback form and sends
 * it through Resend.
 *
 * WHY THIS EXISTS: the extension cannot call Resend itself. Resend authenticates
 * with an API key, and any key shipped inside a Chrome extension is readable by
 * everyone who installs it — the package is just files on disk. A leaked key
 * lets anyone send mail as your domain. So the key lives here, as a Worker
 * secret, and the extension only ever talks to this endpoint.
 *
 * DEPLOY
 *   npm create cloudflare@latest ga4nc-feedback -- --type hello-world
 *   # replace src/index.js with this file, then:
 *   npx wrangler secret put RESEND_API_KEY
 *   npx wrangler deploy
 *
 * Then set FEEDBACK_ENDPOINT in options/options.js to the deployed URL plus
 * /feedback, and add that origin to optional_host_permissions in manifest.json.
 */

const FROM = 'GA4 Name Changer Support <GA4NameChangerSupport@palworks.ai>';
const TO = 'palaniappan.tn2@gmail.com';

// Only these origins may post. Replace with your published extension ID once
// you know it; the unpacked ID differs from the Web Store one.
const ALLOWED_ORIGIN_PREFIX = 'chrome-extension://';

const MAX_FIELD = 4000;
const MAX_BODY_BYTES = 16 * 1024;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

/** Escape anything that reaches the HTML email body. */
function esc(value) {
  return String(value == null ? '' : value)
    .slice(0, MAX_FIELD)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function diagnosticsTable(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return '<p>(none supplied)</p>';
  const rows = Object.entries(diagnostics)
    .slice(0, 40)
    .map(([k, v]) =>
      `<tr><td style="padding:2px 10px 2px 0;color:#6e6e73;white-space:nowrap">${esc(k)}</td>` +
      `<td style="padding:2px 0"><code>${esc(v)}</code></td></tr>`)
    .join('');
  return `<table style="border-collapse:collapse;font-size:13px">${rows}</table>`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json(405, { error: 'method not allowed' }, origin);
    }
    if (!origin.startsWith(ALLOWED_ORIGIN_PREFIX)) {
      return json(403, { error: 'forbidden origin' }, origin);
    }
    if (!env.RESEND_API_KEY) {
      return json(500, { error: 'server not configured' }, origin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json(413, { error: 'payload too large' }, origin);
    }

    let payload;
    try { payload = JSON.parse(raw); }
    catch { return json(400, { error: 'invalid JSON' }, origin); }

    const email = String(payload.email || '').trim();
    const message = String(payload.message || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'invalid email' }, origin);
    }
    if (message.length < 10) {
      return json(400, { error: 'message too short' }, origin);
    }

    const name = String(payload.name || '').trim() || '(not given)';
    const phone = String(payload.phone || '').trim() || '(not given)';

    const html = `
      <h2 style="margin:0 0 12px;font:600 17px system-ui">GA4 Name Changer feedback</h2>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:2px 10px 2px 0;color:#6e6e73">Name</td><td>${esc(name)}</td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6e6e73">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6e6e73">Phone</td><td>${esc(phone)}</td></tr>
      </table>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;padding:14px;
                  background:#f5f5f7;border-radius:8px">${esc(message)}</div>
      <h3 style="margin:20px 0 8px;font:600 14px system-ui">Installation details</h3>
      ${diagnosticsTable(payload.diagnostics)}
    `;

    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: `GA4 Name Changer feedback from ${name}`,
        html
      })
    });

    if (!sent.ok) {
      return json(502, { error: 'delivery failed', detail: await sent.text() }, origin);
    }
    return json(200, { ok: true }, origin);
  }
};
