import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 8788;
const SETTINGS_PATH = join(homedir(), '.config', 'openchamber', 'settings.json');
const UPSTREAM_BASE_URL = 'http://127.0.0.1:4096/api/quota';
const OPENCODE_AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
const COMMAND_CODE_BILLING_URL = 'https://api.commandcode.ai/alpha/billing/credits';

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

async function getCommandCodeWeeklyQuota() {
  const auth = JSON.parse(await readFile(OPENCODE_AUTH_PATH, 'utf8'));
  const entry = auth['command-code'];
  const access = entry && typeof entry.access === 'string' && entry.access.length > 0 ? entry.access : null;
  if (!access) throw new Error('Command Code oauth token is unavailable');

  const upstream = await fetch(COMMAND_CODE_BILLING_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${access}`,
      'User-Agent': 'cli',
      'x-cli-environment': 'production',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!upstream.ok) throw new Error(`Command Code billing request failed with HTTP ${upstream.status}`);

  const payload = await upstream.json();
  const weekly = payload?.windowLimits?.weekly;
  const cap = weekly && typeof weekly.cap === 'number' && weekly.cap > 0 ? weekly.cap : null;
  const used = weekly && typeof weekly.used === 'number' ? weekly.used : null;
  if (cap === null || used === null) throw new Error('Command Code weekly quota is unavailable');

  return {
    ok: true,
    quota: {
      resetsAt: weekly.resetAt ?? null,
      usedPercent: Math.max(0, Math.min(100, (used / cap) * 100)),
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
    '/api/opencode-go/monthly': { providerId: 'opencode-go', windowName: 'monthly', error: 'OpenCode Go monthly quota is unavailable' },
    '/api/kimi-code/weekly': { providerId: 'kimi-for-coding', windowName: 'weekly', error: 'Kimi Code weekly quota is unavailable' },
  };
  if (url.pathname === '/api/command-code/weekly') {
    try {
      return sendJson(response, 200, await getCommandCodeWeeklyQuota());
    } catch {
      return sendJson(response, 503, { ok: false, error: 'Command Code weekly quota is unavailable' });
    }
  }
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
