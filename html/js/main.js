let bleDevice, gattServer;
let epdService, epdCharacteristic;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let paintManager, cropManager;
let rleSupport;

const EpdCmd = {
  SET_PINS: 0x00,
  INIT: 0x01,
  CLEAR: 0x02,
  SEND_CMD: 0x03,
  SEND_DATA: 0x04,
  REFRESH: 0x05,
  SLEEP: 0x06,

  SET_TIME: 0x20,

  WRITE_IMG: 0x30, // v1.6

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

const canvasSizes = [
  { name: '1.54_152_152', width: 152, height: 152 },
  { name: '1.54_200_200', width: 200, height: 200 },
  { name: '2.13_104_212', width: 104, height: 212 },
  { name: '2.13_122_250', width: 122, height: 250 },
  { name: '2.66_152_296', width: 152, height: 296 },
  { name: '2.66_184_360', width: 184, height: 360 },
  { name: '2.9_128_296', width: 128, height: 296 },
  { name: '2.9_168_384', width: 168, height: 384 },
  { name: '3.5_184_384', width: 184, height: 384 },
  { name: '3.5_360_600', width: 360, height: 600 },
  { name: '3.7_240_416', width: 240, height: 416 },
  { name: '3.7_280_480', width: 280, height: 480 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '3.98_768_552', width: 768, height: 552 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '5.83_600_448', width: 600, height: 448 },
  { name: '5.83_648_480', width: 648, height: 480 },
  { name: '7.5_640_384', width: 640, height: 384 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '7.5_880_528', width: 880, height: 528 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4.0E6_600_400', width: 600, height: 400 },
  { name: '7.3E6_800_480', width: 800, height: 480 },
];

function hex2bytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(bytes);
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2);
    }, "");
}

function intToHex(intIn) {
  let stringOut = ("0000" + intIn.toString(16)).substr(-4)
  return stringOut.substring(2, 4) + stringOut.substring(0, 2);
}

function resetVariables() {
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  rleSupport = false;
  document.getElementById("log").value = '';
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic) {
    addLog("服务不可用，请检查蓝牙连接");
    return false;
  }
  let payload = [cmd];
  if (data) {
    if (typeof data == 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data)
  }
  addLog(bytes2hex(payload), '⇑');
  try {
    if (withResponse)
      await epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload));
    else
      await epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
  } catch (e) {
    console.error(e);
    if (e.message) addLog("write: " + e.message);
    return false;
  }
  return true;
}

async function writeImage(data, step = 'bw') {
  const chunkSize = document.getElementById('mtusize').value - 2;
  const interleavedCount = document.getElementById('interleavedcount').value;
  let noReplyCount = interleavedCount;
  let totalRleLength = 0;
  const stepText = step === 'bw' ? '数据块' : '红色块';

  // Use RLE only when its complete encoded stream is smaller than the
  // original data. Each RLE chunk contains complete codes.
  const rleChunks = rleSupport ? rleCompressMTU(data, chunkSize) : null;
  const rleLength = rleChunks ? rleChunks.reduce((total, chunk) => total + chunk.length, 0) : data.length;
  const useRle = rleSupport && rleLength < data.length;
  const totalChunks = useRle ? rleChunks.length : Math.ceil(data.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    let chunk;
    if (useRle) {
      chunk = rleChunks[i];
      totalRleLength += chunk.length;
    } else {
      const off = i * chunkSize;
      chunk = data.slice(off, off + chunkSize);
    }

    const currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${stepText}: ${i + 1}/${totalChunks}, 总用时: ${currentTime}s`);

    const payload = [
      rleSupport
        ?
        (step === 'bw' ? 0x00 : 0x01) | (i === 0 ? 0x02 : 0x00) | (useRle ? 0x04 : 0x00)
        :
        (step === 'bw' ? 0x0F : 0x00) | (i === 0 ? 0x00 : 0xF0)
      ,
      ...chunk,
    ];
    if (noReplyCount > 0) {
      await write(EpdCmd.WRITE_IMG, payload, false);
      noReplyCount--;
    } else {
      await write(EpdCmd.WRITE_IMG, payload, true);
      noReplyCount = interleavedCount;
    }
  }
}

async function setDriver() {
  await write(EpdCmd.SET_PINS, document.getElementById("epdpins").value);
  await write(EpdCmd.INIT, document.getElementById("epddriver").value);
}

async function syncTime(mode) {
  if (mode === 2) {
    if (!confirm('提醒：时钟模式目前使用全刷实现，此功能目前多用于修复老化屏残影问题，不建议长期开启，是否继续？')) return;
  }
  const timestamp = new Date().getTime() / 1000;
  const data = new Uint8Array([
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF,
    -(new Date().getTimezoneOffset() / 60),
    mode
  ]);
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

// ---- AIUsage: fetch usage summary, render to canvas, push as image ----
let aiusageTimer = null;
let aiusageBusy = false;

function aiusageNum(value, fallback) {
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : fallback;
}

function aiusageTopModels(models) {
  if (!Array.isArray(models)) return 'UNAVAILABLE';
  const names = models.slice(0, 4)
    .map(model => model && typeof model.model === 'string' ? model.model : '')
    .filter(Boolean);
  return names.length > 0 ? names.join(' · ') : 'UNAVAILABLE';
}

function aiusageFormatTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function aiusagePeriodLabel(range) {
  switch (range) {
    case 'last30': return 'LAST 30 DAYS';
    case 'week': return 'THIS WEEK';
    case 'month': return 'THIS MONTH';
    case 'all': return 'ALL TIME';
    default: return 'TODAY';
  }
}

function aiusageDailyTotal(row) {
  return (row.inputTokens || 0) + (row.outputTokens || 0) + (row.cacheReadTokens || 0) +
         (row.cacheWriteTokens || 0) + (row.thinkingTokens || 0);
}

function aiusageCodexWeekly(quotas) {
  if (!Array.isArray(quotas)) return null;
  const codex = quotas.find(quota => quota && quota.tool === 'codex' && quota.success === true);
  const weekly = codex && Array.isArray(codex.tiers) ? codex.tiers.find(tier => tier && tier.name === 'weekly_limit') : null;
  return weekly && typeof weekly.utilization === 'number' ? {
    usedPercent: Math.max(0, Math.min(100, weekly.utilization)),
    resetsAt: weekly.resetsAt || null,
  } : null;
}

function drawQuotaBar(x, y, width, height, label, quota, tinySize, smallSize) {
  const available = quota && typeof quota.usedPercent === 'number';
  const percent = available ? 100 - Math.max(0, Math.min(100, quota.usedPercent)) : 0;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold ' + smallSize + 'px Arial';
  ctx.fillStyle = '#000000';
  ctx.fillText(label, x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#000000';
  ctx.fillText(available ? Math.round(percent) + '%' : 'UNAVAILABLE', x + width, y);

  const barY = y + Math.round(height * 0.24);
  const barH = Math.max(8, Math.round(height * 0.34));
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(x, barY, width, barH);
  if (available && percent > 0) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 1, barY + 1, Math.max(1, Math.round((width - 2) * percent / 100)), Math.max(1, barH - 2));
  }

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.font = tinySize + 'px Arial';
  const resetText = quota && quota.resetsAt ? 'RESET ' + new Date(quota.resetsAt).toLocaleDateString() : '';
  ctx.fillText(resetText, x, y + height);
}

function renderAIUsageToCanvas(data) {
  const summary = data.summary || {};
  const trend = data.trend || [];
  const range = data.range || 'day';
  const w = canvas.width, h = canvas.height;
  fillCanvas('white');
  const pad = Math.max(10, Math.round(Math.min(w, h) * 0.05));

  const totalCost = aiusageNum(summary.totalCost, 0);
  const totalSessions = Math.round(aiusageNum(summary.totalSessions, 0));
  const activeDays = Math.round(aiusageNum(summary.activeDays, 0));
  const topModels = aiusageTopModels(data.models);

  const titleSize = Math.max(14, Math.round(h * 0.06));
  const smallSize = Math.max(11, Math.round(h * 0.04));
  const tinySize = Math.max(9, Math.round(h * 0.032));

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000000';

  // Header: title + period
  ctx.textAlign = 'left';
  ctx.font = 'bold ' + titleSize + 'px Arial';
  ctx.fillText('AI USAGE', pad, pad + titleSize);
  ctx.textAlign = 'center';
  ctx.font = tinySize + 'px Arial';
  ctx.fillText(new Date().toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }), w / 2, pad + titleSize);
  ctx.textAlign = 'right';
  ctx.font = tinySize + 'px Arial';
  ctx.fillText(aiusagePeriodLabel(range), w - pad, pad + titleSize);
  const headBottom = pad + titleSize + Math.round(h * 0.015);
  ctx.fillRect(pad, headBottom, w - 2 * pad, Math.max(1, Math.round(h * 0.004)));

  // Compact summary metrics occupy the former quota-card position.
  const statsY = headBottom + Math.round(h * 0.075);
  const col = (w - 2 * pad) / 3;
  const statValSize = Math.max(16, Math.round(h * 0.06));
  const statLabSize = Math.max(9, Math.round(h * 0.032));
  const statLabelY = statsY + Math.round(h * 0.045);
  const stats = [
    { v: '$' + totalCost.toFixed(2), l: 'COST' },
    { v: String(totalSessions), l: 'SESSIONS' },
    { v: String(activeDays), l: 'ACTIVE DAYS' },
  ];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + statValSize + 'px Arial';
  for (let i = 0; i < 3; i++) {
    const cx = pad + col * i + col / 2;
    ctx.fillText(stats[i].v, cx, statsY);
  }
  ctx.font = statLabSize + 'px Arial';
  for (let i = 0; i < 3; i++) {
    const cx = pad + col * i + col / 2;
    ctx.fillText(stats[i].l, cx, statLabelY);
  }
  ctx.textBaseline = 'alphabetic';
  const statsBottom = statLabelY + Math.round(h * 0.025);

  // Daily trend chart — dual line (tokens solid, cost dashed)
  const chartTop = statsBottom + Math.round(h * 0.055);
  const chartH = Math.round(h * 0.25);
  const chartBottom = chartTop + chartH;
  const trendRows = trend.slice(-30);
  const costRows = Array.isArray(data.cost) ? data.cost.slice(-30) : [];
  const costByDate = {};
  for (const r of costRows) {
    if (r && r.date) costByDate[r.date] = aiusageNum(r.cost, 0);
  }
  const days = trendRows.map(aiusageDailyTotal);
  const costs = trendRows.map(r => aiusageNum(costByDate[r.date], 0));
  const maxTok = Math.max(1, ...days);
  const maxCost = Math.max(0.01, ...costs);

  ctx.font = tinySize + 'px Arial';
  const tickGap = Math.round(w * 0.01);
  const leftLabelW = Math.max(Math.round(ctx.measureText(aiusageFormatTokens(maxTok)).width), Math.round(w * 0.04));
  const rightLabelW = Math.max(Math.round(ctx.measureText('$' + maxCost.toFixed(2)).width), Math.round(w * 0.04));
  const dateLabelH = Math.round(h * 0.055);
  const plotLeft = pad + leftLabelW + tickGap;
  const plotRight = w - pad - rightLabelW - tickGap;
  const plotTop = chartTop;
  const plotBottom = chartBottom - dateLabelH;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  // Horizontal dotted grid lines + left token labels + right cost labels
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 2]);
  const gridSteps = 3;
  for (let g = 0; g <= gridSteps; g++) {
    const gy = plotTop + Math.round(plotH * g / gridSteps);
    ctx.beginPath();
    ctx.moveTo(plotLeft, gy);
    ctx.lineTo(plotRight, gy);
    ctx.stroke();
    const tokVal = maxTok * (1 - g / gridSteps);
    const costVal = maxCost * (1 - g / gridSteps);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(aiusageFormatTokens(tokVal), plotLeft - Math.round(w * 0.005), gy);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FF0000';
    ctx.fillText('$' + (costVal >= 100 ? costVal.toFixed(0) : costVal >= 1 ? costVal.toFixed(2) : costVal.toFixed(3)),
                 plotRight + Math.round(w * 0.005), gy);
    ctx.fillStyle = '#000000';
  }
  ctx.setLineDash([]);
  ctx.textBaseline = 'alphabetic';

  // Baseline
  ctx.fillRect(plotLeft, plotBottom, plotW, Math.max(1, Math.round(h * 0.003)));

  if (days.length > 0) {
    const slot = days.length > 1 ? plotW / (days.length - 1) : 0;
    ctx.strokeStyle = '#000000';

    // Token line (dashed black)
    ctx.setLineDash([Math.max(2, Math.round(w * 0.012)), Math.max(2, Math.round(w * 0.008))]);
    ctx.beginPath();
    for (let i = 0; i < days.length; i++) {
      const x = plotLeft + i * slot;
      const y = plotTop + plotH - (days[i] / maxTok) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Cost line (solid red)
    ctx.strokeStyle = '#FF0000';
    ctx.beginPath();
    for (let i = 0; i < costs.length; i++) {
      const x = plotLeft + i * slot;
      const y = plotTop + plotH - (costs[i] / maxCost) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#000000';

    // Date tick labels (first / middle / last)
    ctx.textAlign = 'center';
    ctx.font = tinySize + 'px Arial';
    const tickIdx = [0, Math.floor((days.length - 1) / 2), days.length - 1];
    for (const i of tickIdx) {
      if (i < 0 || i >= trendRows.length) continue;
      const x = plotLeft + i * slot;
      const row = trendRows[i];
      const label = row && row.date ? String(row.date).slice(5) : '';
      ctx.fillText(label, x, chartBottom - Math.round(h * 0.008));
    }
  }

  // Subscription quota cards sit below the chart.
  const quotaTop = chartBottom + Math.round(h * 0.08);
  const quotaHeight = Math.max(28, Math.round(h * 0.095));
  const quotaGap = Math.max(12, Math.round(h * 0.045));
  const quotaWidth = w - 2 * pad;
  drawQuotaBar(pad, quotaTop, quotaWidth, quotaHeight, 'CODEX WEEKLY', aiusageCodexWeekly(data.quotas), tinySize, smallSize);
  drawQuotaBar(pad, quotaTop + quotaHeight + quotaGap, quotaWidth, quotaHeight, 'OPENCODE GO MONTHLY', data.goMonthly, tinySize, smallSize);

  // Footer: up to four models supplied by AIUsage
  const footY = h - pad;
  ctx.textAlign = 'center';
  ctx.font = smallSize + 'px Arial';
  ctx.fillText('TOP  ' + topModels, w / 2, footY);
  ctx.textAlign = 'left';
}

async function fetchAIUsageData() {
  const url = document.getElementById('aiusageurl').value;
  if (!url) throw new Error('请填写 AIUsage API 地址。');
  const parsed = new URL(url, location.href);
  const range = parsed.searchParams.get('range') || 'day';

  const summaryResp = await fetch(url);
  if (!summaryResp.ok) throw new Error(`AIUsage API returned HTTP ${summaryResp.status}`);
  const summary = await summaryResp.json();

  const trendRange = range === 'all' ? 'last30' : range;
  const trendUrl = new URL('/api/tokens', parsed.origin);
  trendUrl.searchParams.set('range', trendRange);
  let trend = [];
  try {
    const trendResp = await fetch(trendUrl.toString());
    if (trendResp.ok) {
      const trendJson = await trendResp.json();
      trend = Array.isArray(trendJson.data) ? trendJson.data : [];
    }
  } catch (e) {
    console.warn('AIUsage trend fetch failed:', e);
  }

  // Fetch aligned daily cost data for the dual-axis line chart.
  // /api/cost returns {data:[{date,cost}], byTool, byModel}; we only need data.
  const costUrl = new URL('/api/cost', parsed.origin);
  costUrl.searchParams.set('range', 'last30');
  let cost = [];
  try {
    const costResp = await fetch(costUrl.toString());
    if (costResp.ok) {
      const costJson = await costResp.json();
      cost = Array.isArray(costJson.data) ? costJson.data : [];
    }
  } catch (e) {
    console.warn('AIUsage cost fetch failed:', e);
  }

  const modelsUrl = new URL('/api/models', parsed.origin);
  modelsUrl.searchParams.set('range', range);
  let models = null;
  try {
    const modelsResp = await fetch(modelsUrl.toString());
    if (modelsResp.ok) {
      const modelsJson = await modelsResp.json();
      models = Array.isArray(modelsJson.models) ? modelsJson.models : null;
    }
  } catch (e) {
    console.warn('AIUsage models fetch failed:', e);
  }

  const quotasUrl = new URL('/api/quotas', parsed.origin);
  let quotas = null;
  try {
    const quotasResp = await fetch(quotasUrl.toString());
    if (quotasResp.ok) {
      const quotasJson = await quotasResp.json();
      quotas = Array.isArray(quotasJson.quotas) ? quotasJson.quotas : null;
    }
  } catch (e) {
    console.warn('AIUsage quota fetch failed:', e);
  }

  let goMonthly = null;
  try {
    const goResp = await fetch('http://127.0.0.1:8788/api/opencode-go/monthly');
    if (goResp.ok) {
      const goJson = await goResp.json();
      if (goJson.ok === true && goJson.monthly && typeof goJson.monthly.usedPercent === 'number') {
        goMonthly = goJson.monthly;
      }
    }
  } catch (e) {
    console.warn('OpenCode Go quota fetch failed:', e);
  }

  return { summary: summary, trend: trend, cost: cost, models: models, quotas: quotas, goMonthly: goMonthly, range: range };
}

async function reconnectAIUsageDevice() {
  if (epdCharacteristic) return true;
  if (!bleDevice) return false;

  addLog('AIUsage 定时发送发现蓝牙已断开，正在自动重连...');
  await connect();
  if (!epdCharacteristic) addLog('AIUsage 自动重连失败，本次定时发送已跳过。');
  return epdCharacteristic != null;
}

async function pushAIUsage(autoReconnect = false) {
  if (aiusageBusy) { addLog('AIUsage 发送中，请稍候。'); return; }
  aiusageBusy = true;
  try {
    if (!epdCharacteristic) {
      if (!autoReconnect || !await reconnectAIUsageDevice()) {
        if (!autoReconnect) addLog('请先连接设备。');
        return;
      }
    }
    if (!updateDitcherOptions()) return;
    const data = await fetchAIUsageData();
    renderAIUsageToCanvas(data);
    await sendimg();
    addLog('AIUsage 截图已发送。');
  } catch (e) {
    console.error(e);
    addLog('AIUsage 发送失败：' + (e.message || e));
  } finally {
    aiusageBusy = false;
  }
}

function startAIUsageTimer() {
  stopAIUsageTimer();
  const minutes = Math.max(1, parseInt(document.getElementById('aiusageinterval').value, 10) || 30);
  aiusageTimer = setInterval(() => pushAIUsage(true), minutes * 60 * 1000);
  document.getElementById('aiusagetimerbutton').innerHTML = '停止定时';
  addLog(`AIUsage 定时已开启：每 ${minutes} 分钟发送一次。`);
}

function stopAIUsageTimer() {
  if (aiusageTimer) { clearInterval(aiusageTimer); aiusageTimer = null; }
  const btn = document.getElementById('aiusagetimerbutton');
  if (btn) btn.innerHTML = '开始定时';
}

function toggleAIUsageTimer() {
  if (aiusageTimer) { stopAIUsageTimer(); addLog('AIUsage 定时已关闭。'); }
  else startAIUsageTimer();
}

async function clearScreen() {
  if (confirm('确认清除屏幕内容?')) {
    await write(EpdCmd.CLEAR);
    addLog("清屏指令已发送！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

async function sendcmd() {
  const cmdTXT = document.getElementById('cmdTXT').value;
  if (cmdTXT == '') return;
  const bytes = hex2bytes(cmdTXT);
  await write(bytes[0], bytes.length > 1 ? bytes.slice(1) : null);
}

function convertUC8159(blackWhiteData, redWhiteData) {
  const halfLength = blackWhiteData.length;
  let payloadData = new Uint8Array(halfLength * 4);
  let payloadIdx = 0;
  let black_data, color_data, data;
  for (let i = 0; i < halfLength; i++) {
    black_data = blackWhiteData[i];
    color_data = redWhiteData[i];
    for (let j = 0; j < 8; j++) {
      if ((color_data & 0x80) == 0x00) data = 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data = 0x00;  // black
      else data = 0x03;  // white
      data = (data << 4) & 0xFF;
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      j++;
      if ((color_data & 0x80) == 0x00) data |= 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data |= 0x00;  // black
      else data |= 0x03;  // white
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      payloadData[payloadIdx++] = data;
    }
  }
  return payloadData;
}

async function sendimg() {
  if (cropManager.isCropMode()) {
    alert("请先完成图片裁剪！发送已取消。");
    return;
  }

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];

  if (!selectedOption) {
    addLog('请先在“驱动”中选择受支持的墨水屏型号。');
    return;
  }

  if (selectedOption.getAttribute('data-size') !== canvasSize) {
    if (!confirm("警告：画布尺寸和驱动不匹配，是否继续？")) return;
  }
  if (selectedOption.getAttribute('data-color') !== ditherMode) {
    if (!confirm("警告：颜色模式和驱动不匹配，是否继续？")) return;
  }

  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, ditherMode);

  updateButtonStatus(true);

  await write(EpdCmd.INIT);

  if (ditherMode === 'threeColor') {
    const halfLength = Math.floor(processedData.length / 2);
    const blackWhiteData = processedData.slice(0, halfLength);
    const redWhiteData = processedData.slice(halfLength);
    if (['08', '09', '0e', '0f'].includes(epdDriverSelect.value)) {
      await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw');
    } else {
      await writeImage(blackWhiteData, 'bw');
      await writeImage(redWhiteData, 'red');
    }
  } else if (ditherMode === 'blackWhiteColor') {
    if (['08', '09', '0e', '0f'].includes(epdDriverSelect.value)) {
      const emptyData = new Uint8Array(processedData.length).fill(0xFF);
      await writeImage(convertUC8159(processedData, emptyData), 'bw');
    } else {
      await writeImage(processedData, 'bw');
    }
  } else if (ditherMode === 'fourColor' || ditherMode === 'sixColor') {
    await writeImage(processedData, 'bw');
  } else {
    addLog("当前固件不支持此颜色模式。");
    updateButtonStatus();
    return;
  }

  await write(EpdCmd.REFRESH);
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`发送完成！耗时: ${sendTime}s`);
  setStatus(`发送完成！耗时: ${sendTime}s`);
  addLog("屏幕刷新完成前请不要操作。");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
}

function downloadDataArray() {
  if (cropManager.isCropMode()) {
    alert("请先完成图片裁剪！下载已取消。");
    return;
  }

  const mode = document.getElementById('ditherMode').value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, mode);

  if (mode === 'sixColor' && processedData.length !== canvas.width * canvas.height) {
    console.log(`错误：预期${canvas.width * canvas.height}字节，但得到${processedData.length}字节`);
    addLog('数组大小不匹配。请检查图像尺寸和模式。');
    return;
  }

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    const hexValue = (processedData[i] & 0xff).toString(16).padStart(2, '0');
    dataLines.push(`0x${hexValue}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const colorModeValue = mode === 'sixColor' ? 0 : mode === 'fourColor' ? 1 : mode === 'blackWhiteColor' ? 2 : 3;
  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    `const uint8_t colorMode = ${colorModeValue};`
  ].join('\n');

  const blob = new Blob([arrayContent], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'imagedata.h';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  document.getElementById("reconnectbutton").disabled = (gattServer == null || gattServer.connected) ? 'disabled' : null;
  document.getElementById("sendcmdbutton").disabled = status;
  document.getElementById("calendarmodebutton").disabled = status;
  document.getElementById("clockmodebutton").disabled = status;
  document.getElementById("aiusagesendbutton").disabled = status;
  document.getElementById("aiusagetimerbutton").disabled = status;
  document.getElementById("clearscreenbutton").disabled = status;
  document.getElementById("sendimgbutton").disabled = status;
  document.getElementById("setDriverbutton").disabled = status;
}

function disconnect() {
  updateButtonStatus();
  resetVariables();
  addLog('已断开连接.');
  document.getElementById("connectbutton").innerHTML = '连接';
}

async function preConnect() {
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) {
      bleDevice.gatt.disconnect();
    }
  }
  else {
    resetVariables();
    try {
      bleDevice = await navigator.bluetooth.requestDevice({
        optionalServices: ['62750001-d828-918d-fb46-b6c11c675aec'],
        acceptAllDevices: true
      });
    } catch (e) {
      console.error(e);
      if (e.message) addLog("requestDevice: " + e.message);
      addLog("请检查蓝牙是否已开启，且使用的浏览器支持蓝牙！建议使用以下浏览器：");
      addLog("• 电脑: Chrome/Edge");
      addLog("• Android: Chrome/Edge");
      addLog("• iOS: Bluefy 浏览器");
      return;
    }

    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    setTimeout(async function () { await connect(); }, 300);
  }
}

async function reConnect() {
  if (bleDevice != null && bleDevice.gatt.connected)
    bleDevice.gatt.disconnect();
  resetVariables();
  addLog("正在重连");
  setTimeout(async function () { await connect(); }, 300);
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx == 0) {
    addLog(`收到配置：${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    const driverId = bytes2hex(data.slice(7, 8));
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    if (Array.from(epddriver.options).some(option => option.value === driverId)) {
      epddriver.value = driverId;
      updateDitcherOptions();
    } else {
      addLog(`设备驱动 0x${driverId} 不在此页面的支持列表中；请手动选择对应型号。`);
    }
  } else {
    if (textDecoder == null) textDecoder = new TextDecoder();
    const msg = textDecoder.decode(data);
    addLog(msg, '⇓');
    if (msg.startsWith('mtu=') && msg.length > 4) {
      const mtuSize = parseInt(msg.substring(4));
      document.getElementById('mtusize').value = mtuSize;
      addLog(`MTU 已更新为: ${mtuSize}`);
      if (msg.includes('rle=1')) {
        rleSupport = true;
        addLog('已开启 RLE 压缩传输支持');
      }
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const t = parseInt(msg.substring(2)) + new Date().getTimezoneOffset() * 60;
      addLog(`远端时间: ${new Date(t * 1000).toLocaleString()}`);
      addLog(`本地时间: ${new Date().toLocaleString()}`);
    }
  }
}

async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;

  try {
    addLog("正在连接: " + bleDevice.name);
    gattServer = await bleDevice.gatt.connect();
    addLog('  找到 GATT Server');
    epdService = await gattServer.getPrimaryService('62750001-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 EPD Service');
    epdCharacteristic = await epdService.getCharacteristic('62750002-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 Characteristic');
  } catch (e) {
    console.error(e);
    if (e.message) addLog("connect: " + e.message);
    disconnect();
    return;
  }

  try {
    const versionCharacteristic = await epdService.getCharacteristic('62750003-d828-918d-fb46-b6c11c675aec');
    const versionData = await versionCharacteristic.readValue();
    appVersion = versionData.getUint8(0);
    addLog(`固件版本: 0x${appVersion.toString(16)}`);
  } catch (e) {
    console.error(e);
    appVersion = 0x15;
  }

  if (appVersion < 0x16) {
    const oldURL = "https://tsl0922.github.io/EPD-nRF5/v1.5";
    alert("!!!注意!!!\n当前固件版本过低，可能无法正常使用部分功能，建议升级到最新版本。");
    if (confirm('是否访问旧版本上位机？')) location.href = oldURL;
    setTimeout(() => {
      addLog(`如遇到问题，可访问旧版本上位机: ${oldURL}`);
    }, 500);
  }

  try {
    await epdCharacteristic.startNotifications();
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
  } catch (e) {
    console.error(e);
    if (e.message) addLog("startNotifications: " + e.message);
  }

  await write(EpdCmd.INIT);

  document.getElementById("connectbutton").innerHTML = '断开';
  updateButtonStatus();
}

function setStatus(statusText) {
  document.getElementById("status").innerHTML = statusText;
}

function addLog(logTXT, action = '') {
  const log = document.getElementById("log");
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ":" +
    String(now.getMinutes()).padStart(2, '0') + ":" +
    String(now.getSeconds()).padStart(2, '0') + " ";

  const logEntry = document.createElement('div');
  const timeSpan = document.createElement('span');
  logEntry.className = 'log-line';
  timeSpan.className = 'time';
  timeSpan.textContent = time;
  logEntry.appendChild(timeSpan);

  if (action !== '') {
    const actionSpan = document.createElement('span');
    actionSpan.className = 'action';
    actionSpan.innerHTML = action;
    logEntry.appendChild(actionSpan);
  }
  logEntry.appendChild(document.createTextNode(logTXT));

  log.appendChild(logEntry);
  log.scrollTop = log.scrollHeight;

  while (log.childNodes.length > 20) {
    log.removeChild(log.firstChild);
  }
}

function clearLog() {
  document.getElementById("log").innerHTML = '';
}

function fillCanvas(style) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setCanvasTitle(title) {
  const canvasTitle = document.querySelector('.canvas-title');
  if (canvasTitle) {
    canvasTitle.innerText = title;
    canvasTitle.style.display = title && title !== '' ? 'block' : 'none';
  }
}

function updateImage() {
  const imageFile = document.getElementById('imageFile');
  if (imageFile.files.length == 0) {
    fillCanvas('white');
    return;
  }

  const image = new Image();
  image.onload = function () {
    URL.revokeObjectURL(this.src);
    if (image.width / image.height == canvas.width / canvas.height) {
      if (cropManager.isCropMode()) cropManager.exitCropMode();
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);
      convertDithering();
    } else {
      alert(`图片宽高比例与画布不匹配，将进入裁剪模式。\n请放大图片后移动图片使其充满画布, 再点击"完成"按钮。`);
      paintManager.setActiveTool(null, '');
      cropManager.initializeCrop();
    }
  };
  image.src = URL.createObjectURL(imageFile.files[0]);
}

function updateCanvasSize() {
  const selectedSizeName = document.getElementById('canvasSize').value;
  const selectedSize = canvasSizes.find(size => size.name === selectedSizeName);

  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;

  updateImage();
}

function updateDitcherOptions() {
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  if (!selectedOption) {
    addLog('请选择受支持的墨水屏驱动后再传图。');
    return false;
  }
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');
  const selectedSize = canvasSizes.find(size => size.name === canvasSize);
  if (!colorMode || !selectedSize) {
    addLog('当前驱动缺少画布或颜色配置，无法传图。');
    return false;
  }

  document.getElementById('ditherMode').value = colorMode;
  document.getElementById('canvasSize').value = canvasSize;

  updateCanvasSize(); // always update image
  return true;
}

function rotateCanvas() {
  const currentWidth = canvas.width;
  const currentHeight = canvas.height;

  // Capture current canvas content
  const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

  // Swap canvas dimensions
  canvas.width = currentHeight;
  canvas.height = currentWidth;

  // Create temporary canvas for rotation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = currentWidth;
  tempCanvas.height = currentHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  // Draw rotated image on the resized canvas
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(tempCanvas, -currentWidth / 2, -currentHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  paintManager.clearHistory(); // Clear history as canvas size changed
  paintManager.clearElements(); // Clear stored text positions and line segments
  paintManager.saveToHistory(); // Save rotated canvas to history
}

function clearCanvas() {
  if (confirm('清除画布内容?')) {
    fillCanvas('white');
    paintManager.clearElements(); // Clear stored text positions and line segments
    if (cropManager.isCropMode()) cropManager.exitCropMode();
    paintManager.saveToHistory(); // Save cleared canvas to history
    return true;
  }
  return false;
}

function convertDithering() {
  paintManager.redrawTextElements();
  paintManager.redrawLineSegments();

  const contrast = parseFloat(document.getElementById('ditherContrast').value);
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustContrast(imageData, contrast);

  const alg = document.getElementById('ditherAlg').value;
  const strength = parseFloat(document.getElementById('ditherStrength').value);
  const mode = document.getElementById('ditherMode').value;
  const processedData = processImageData(ditherImage(imageData, alg, strength, mode), mode);
  const finalImageData = decodeProcessedData(processedData, canvas.width, canvas.height, mode);
  ctx.putImageData(finalImageData, 0, 0);

  paintManager.saveToHistory(); // Save dithered image to history
}

function applyDither() {
  cropManager.finishCrop(() => convertDithering());
}

function initEventHandlers() {
  document.getElementById("ditherStrength").addEventListener("input", (e) => {
    document.getElementById("ditherStrengthValue").innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
  document.getElementById("ditherContrast").addEventListener("input", (e) => {
    document.getElementById("ditherContrastValue").innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
}

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.get('debug');

  if (debugMode === 'true') {
    document.body.classList.add('dark-mode');
    link.innerHTML = '正常模式';
    link.setAttribute('href', window.location.pathname);
    addLog("注意：开发模式功能已开启！不懂请不要随意修改，否则后果自负！");
  } else {
    document.body.classList.remove('dark-mode');
    link.innerHTML = '开发模式';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

document.body.onload = () => {
  textDecoder = null;
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);

  paintManager.initPaintTools();
  cropManager.initCropTools();
  initEventHandlers();
  updateButtonStatus();
  checkDebugMode();
}
