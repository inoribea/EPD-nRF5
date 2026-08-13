import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 8788;
const SETTINGS_PATH = join(homedir(), '.config', 'openchamber', 'settings.json');
const UPSTREAM_URL = 'http://127.0.0.1:4096/api/quota/opencode-go';

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

async function getMonthlyQuota() {
  const settings = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
  const token = settings.desktopLocalClientToken;
  if (typeof token !== 'string' || token.length === 0) throw new Error('OpenChamber client token is unavailable');

  const upstream = await fetch(UPSTREAM_URL, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!upstream.ok) throw new Error(`OpenChamber quota request failed with HTTP ${upstream.status}`);

  const payload = await upstream.json();
  const monthly = payload?.usage?.windows?.monthly;
  if (!monthly || typeof monthly.usedPercent !== 'number') throw new Error('OpenChamber monthly quota is unavailable');

  return {
    ok: true,
    monthly: {
      resetsAt: monthly.resetAt ?? null,
      usedPercent: Math.max(0, Math.min(100, monthly.usedPercent)),
    },
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`);
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (request.method !== 'GET' || url.pathname !== '/api/opencode-go/monthly') {
    return sendJson(response, 404, { ok: false, error: 'Not found' });
  }

  try {
    return sendJson(response, 200, await getMonthlyQuota());
  } catch {
    return sendJson(response, 503, { ok: false, error: 'OpenCode Go monthly quota is unavailable' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenChamber quota bridge listening on http://${HOST}:${PORT}`);
});
