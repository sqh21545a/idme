const statusDot = document.querySelector('#statusDot');
const statusText = document.querySelector('#statusText');
const pidText = document.querySelector('#pidText');
const batchForm = document.querySelector('#batchForm');
const stopBtn = document.querySelector('#stopBtn');
const refreshBtn = document.querySelector('#refreshBtn');
const clearLogsBtn = document.querySelector('#clearLogsBtn');
const logsEl = document.querySelector('#logs');
const excelFile = document.querySelector('#excelFile');
const excelPath = document.querySelector('#excelPath');

let logOffset = 0;
let visibleLogs = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function uploadExcelFile(file) {
  const body = new FormData();
  body.append('excel', file);

  const response = await fetch('/api/upload-excel', {
    method: 'POST',
    body,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function batchFormDataToOptions() {
  const data = new FormData(batchForm);
  return {
    excel: data.get('excel') || 'idme-accounts.xlsx',
    url: data.get('url') || '',
    proxy: data.get('proxy') || '',
    profileBase: data.get('profileBase') || '.idme-batch-profile',
    timeoutMs: Number(data.get('timeoutMs') || 120000),
    concurrency: Number(data.get('concurrency') || 1),
    browserBlockedLimit: Number(data.get('browserBlockedLimit') || 3),
    browserBlockedRetry: Boolean(data.get('browserBlockedRetry')),
    proxyRefreshUrl: data.get('proxyRefreshUrl') || '',
    proxyRefreshWait: Number(data.get('proxyRefreshWait') || 5),
    proxyRefreshOnFail: Boolean(data.get('proxyRefreshOnFail')),
    startRow: Number(data.get('startRow') || 0),
    endRow: Number(data.get('endRow') || 0),
    profileMode: data.get('profileMode') || 'reuse',
    userAgentMode: data.get('userAgentMode') || 'fixed',
    headless: data.get('browserMode') === 'headless',
    noProxy: Boolean(data.get('noProxy')),
  };
}

function renderStatus(status) {
  const running = Boolean(status && status.running);
  statusDot.classList.toggle('running', running);
  statusText.textContent = running ? '运行中' : '未运行';
  pidText.textContent = running ? `PID: ${status.pid}` : 'PID: -';
}

function appendLocalLog(text) {
  visibleLogs.push(`[UI] ${new Date().toLocaleTimeString()} ${text}`);
  renderLogs();
}

function renderLogs() {
  logsEl.textContent = visibleLogs.join('\n');
  logsEl.scrollTop = logsEl.scrollHeight;
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    renderStatus(status);
  } catch (error) {
    appendLocalLog(`读取状态失败：${error.message}`);
  }
}

async function refreshLogs() {
  try {
    const result = await api(`/api/logs?after=${logOffset}`);
    logOffset = result.offset;
    const newLines = (result.logs || []).map(item => `[${item.time}] ${item.text}`);
    if (newLines.length) {
      visibleLogs.push(...newLines);
      visibleLogs = visibleLogs.slice(-1200);
      renderLogs();
    }
  } catch (_) {}
}

excelFile.addEventListener('change', async () => {
  const file = excelFile.files && excelFile.files[0];
  if (!file) return;

  try {
    appendLocalLog(`正在上传 Excel：${file.name}`);
    const result = await uploadExcelFile(file);
    if (!result.success) {
      appendLocalLog(`Excel 上传失败：${result.error}`);
      return;
    }
    excelPath.value = result.path;
    appendLocalLog(`Excel 已上传：${result.path}`);
  } catch (error) {
    appendLocalLog(`Excel 上传请求失败：${error.message}`);
  }
});

batchForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/api/start-batch', {
      method: 'POST',
      body: JSON.stringify(batchFormDataToOptions()),
    });
    if (!result.success) {
      appendLocalLog(`批量启动失败：${result.error}`);
    } else {
      appendLocalLog(`Excel 批量登录已启动 PID ${result.pid}`);
    }
    renderStatus(result.status);
  } catch (error) {
    appendLocalLog(`批量启动请求失败：${error.message}`);
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    const result = await api('/api/stop', { method: 'POST', body: '{}' });
    appendLocalLog(result.stopped ? `已请求停止 PID ${result.pid}` : '当前没有运行进程');
    renderStatus(result.status);
  } catch (error) {
    appendLocalLog(`停止失败：${error.message}`);
  }
});

refreshBtn.addEventListener('click', () => {
  refreshStatus();
  refreshLogs();
});

clearLogsBtn.addEventListener('click', () => {
  visibleLogs = [];
  renderLogs();
});

refreshStatus();
setInterval(refreshStatus, 2000);
setInterval(refreshLogs, 1200);
