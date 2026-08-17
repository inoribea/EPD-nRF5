import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 8788;
const SETTINGS_PATH = join(homedir(), '.config', 'openchamber', 'settings.json');
const UPSTREAM_BASE_URL = 'http://127.0.0.1:4096/api/quota';

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

async function getQuota(providerId, windowName) {
  const settings = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
  const token = settings.desktopLocalClientToken;
  if (typeof token !== 'string' || token.length === 0) throw new Error('OpenChamber client token is unavailable');

  const upstream = await fetch(`${UPSTREAM_BASE_URL}/${providerId}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!upstream.ok) throw new Error(`OpenChamber quota request failed with HTTP ${upstream.status}`);

  const payload = await upstream.json();
  const usageWindow = payload?.usage?.windows?.[windowName];
  if (!usageWindow || typeof usageWindow.usedPercent !== 'number') throw new Error('OpenChamber quota is unavailable');

  return {
    ok: true,
    quota: {
      resetsAt: usageWindow.resetAt ?? null,
      usedPercent: Math.max(0, Math.min(100, usageWindow.usedPercent)),
    },
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`);
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (request.method !== 'GET') {
    return sendJson(response, 404, { ok: false, error: 'Not found' });
  }
  if (url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, service: 'openchamber-quota-bridge' });
  }

  const routes = {
    '/api/codex/weekly': { providerId: 'codex', windowName: 'weekly', error: 'Codex weekly quota is unavailable' },
    '/api/command-code/weekly': { providerId: 'commandcode', windowName: 'weekly', error: 'Command Code weekly quota is unavailable' },
    '/api/opencode-go/monthly': { providerId: 'opencode-go', windowName: 'monthly', error: 'OpenCode Go monthly quota is unavailable' },
    '/api/kimi-code/weekly': { providerId: 'kimi-for-coding', windowName: 'weekly', error: 'Kimi Code weekly quota is unavailable' },
  };
  const route = routes[url.pathname];
  if (!route) return sendJson(response, 404, { ok: false, error: 'Not found' });

  try {
    return sendJson(response, 200, await getQuota(route.providerId, route.windowName));
  } catch {
    return sendJson(response, 503, { ok: false, error: route.error });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenChamber quota bridge listening on http://${HOST}:${PORT}`);
});
