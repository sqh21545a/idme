#!/usr/bin/env node

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const mfaPath = path.join(rootDir, 'idme-mfa-choices.json');
const defaultPort = Number(process.env.PORT || 3100);

let running = null;
let logs = [];
let lastRun = null;

function pushLog(line) {
  const text = String(line || '').replace(/\r?\n$/, '');
  if (!text) return;
  logs.push({ time: new Date().toISOString(), text });
  if (logs.length > 1200) logs = logs.slice(-1200);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeUploadName(name) {
  const ext = path.extname(name || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) return '';
  const base = path.basename(name, ext).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80) || 'accounts';
  return `${base}-${randomUUID()}${ext}`;
}

function readMultipartFile(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      reject(new Error('missing multipart boundary'));
      return;
    }

    const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('uploaded file too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd < 0) {
        reject(new Error('invalid upload body'));
        return;
      }

      const headerText = body.slice(0, headerEnd).toString('utf8');
      const filenameMatch = headerText.match(/filename="([^"]+)"/i);
      const safeName = sanitizeUploadName(filenameMatch ? filenameMatch[1] : '');
      if (!safeName) {
        reject(new Error('only .xlsx and .xls files are supported'));
        return;
      }

      const contentStart = headerEnd + 4;
      const boundaryStart = body.indexOf(Buffer.from('\r\n'), contentStart);
      const endBoundary = body.indexOf(boundary, contentStart);
      const contentEnd = endBoundary >= 0 ? Math.max(contentStart, endBoundary - 2) : boundaryStart;
      if (contentEnd <= contentStart) {
        reject(new Error('empty upload file'));
        return;
      }

      resolve({ filename: safeName, buffer: body.slice(contentStart, contentEnd) });
    });

    req.on('error', reject);
  });
}

async function saveUploadedExcel(req) {
  const upload = await readMultipartFile(req);
  const uploadsDir = path.join(rootDir, 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const outputPath = path.join(uploadsDir, upload.filename);
  await fs.writeFile(outputPath, upload.buffer);
  return path.relative(rootDir, outputPath);
}

function maskProxy(proxy) {
  return proxy ? proxy.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : '';
}

function defaultStatus() {
  const exitCode = lastRun ? lastRun.exitCode : null;
  const signal = lastRun ? lastRun.signal || '' : '';
  return {
    running: Boolean(running),
    pid: running ? running.pid : null,
    lastRun,
    logCount: logs.length,
    exitCode,
    signal,
    exitText: running ? '运行中' : lastRun && lastRun.endedAt ? `已退出 code=${exitCode}${signal ? ` signal=${signal}` : ''}` : '未运行',
  };
}

async function readMfaChoices() {
  try {
    const raw = await fs.readFile(mfaPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return { recordedAt: '', choices: [] };
  }
}

function startProcess(script, args, options = {}, runType = 'single') {
  if (running) {
    return { success: false, error: 'IDme automation is already running', status: defaultStatus() };
  }

  logs = [];
  lastRun = {
    type: runType,
    startedAt: new Date().toISOString(),
    endedAt: '',
    exitCode: null,
    command: `node ${args.map(item => item.includes(' ') ? `"${item}"` : item).join(' ')}`,
    options: {
      ...options,
      password: options.password ? '***' : '',
      proxy: maskProxy(options.proxy || ''),
    },
  };

  pushLog(`[WebUI] starting ${runType}: ${lastRun.command.replace(/--password\s+\S+/, '--password ***')}`);
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  running = child;
  child.stdout.on('data', chunk => {
    String(chunk).split(/\r?\n/).forEach(pushLog);
  });
  child.stderr.on('data', chunk => {
    String(chunk).split(/\r?\n/).forEach(line => pushLog(line ? `[stderr] ${line}` : ''));
  });
  child.on('exit', (code, signal) => {
    const exitCode = code === null || code === undefined ? '' : code;
    const exitSignal = signal || '';
    pushLog(`[WebUI] process exited code=${exitCode} signal=${exitSignal}`);
    if (exitCode !== 0 || exitSignal) {
      pushLog(`[WebUI] process ended unexpectedly, last exit code=${exitCode || 'null'}${exitSignal ? ` signal=${exitSignal}` : ''}`);
    } else {
      pushLog('[WebUI] process completed normally, exit code=0');
    }
    if (lastRun) {
      lastRun.endedAt = new Date().toISOString();
      lastRun.exitCode = code;
      lastRun.signal = exitSignal;
      lastRun.exitText = exitCode === 0 && !exitSignal
        ? '正常结束 code=0'
        : `异常退出 code=${exitCode || 'null'}${exitSignal ? ` signal=${exitSignal}` : ''}`;
    }
    if (running === child) running = null;
  });

  return { success: true, pid: child.pid, status: defaultStatus() };
}

function startAutomation(options = {}) {
  const args = ['src/idme.js'];
  if (options.url) args.push('--url', String(options.url));
  args.push(options.headless ? '--headless' : '--headed');
  if (options.profile) args.push('--profile', String(options.profile));
  if (options.proxy) args.push('--proxy', String(options.proxy));
  if (options.noProxy) args.push('--no-proxy');
  if (options.email) args.push('--email', String(options.email));
  if (options.password) args.push('--password', String(options.password));
  if (options.slow) args.push('--slow', String(options.slow));

  return startProcess('src/idme.js', args, options, 'single');
}

function startBatchAutomation(options = {}) {
  const args = ['src/batch-login.js'];
  if (options.excel) args.push('--excel', String(options.excel));
  if (options.url) args.push('--url', String(options.url));
  if (options.profileBase) args.push('--profile-base', String(options.profileBase));
  args.push(options.profileMode === 'fresh' ? '--fresh-profile' : '--reuse-profile');
  args.push(options.userAgentMode === 'random' ? '--random-user-agent' : '--fixed-user-agent');
  args.push(options.headless === true ? '--headless' : '--headed');
  if (options.proxy) args.push('--proxy', String(options.proxy));
  if (options.noProxy) args.push('--no-proxy');
  if (options.slow) args.push('--slow', String(options.slow));
  if (options.timeoutMs) args.push('--timeout-ms', String(options.timeoutMs));
  if (options.concurrency) args.push('--concurrency', String(options.concurrency));
  if (options.browserBlockedLimit) args.push('--browser-blocked-limit', String(options.browserBlockedLimit));
  args.push(options.browserBlockedRetry === false ? '--no-browser-blocked-retry' : '--browser-blocked-retry');
  if (options.proxyRefreshUrl) args.push('--proxy-refresh-url', String(options.proxyRefreshUrl));
  if (options.proxyRefreshWait !== undefined && options.proxyRefreshWait !== '') args.push('--proxy-refresh-wait', String(options.proxyRefreshWait));
  args.push(options.proxyRefreshOnFail === false ? '--no-proxy-refresh-on-fail' : '--proxy-refresh-on-fail');
  if (options.startRow) args.push('--start-row', String(options.startRow));
  if (options.endRow) args.push('--end-row', String(options.endRow));
  if (options.sheet) args.push('--sheet', String(options.sheet));

  return startProcess('src/batch-login.js', args, options, 'batch');
}

function createExcelTemplate(options = {}) {
  if (running) {
    return { success: false, error: 'IDme automation is running, stop it before creating template', status: defaultStatus() };
  }

  const args = ['src/create-excel-template.js'];
  if (options.output) args.push('--output', String(options.output));

  return startProcess('src/create-excel-template.js', args, options, 'template');
}

function stopAutomation() {
  if (!running) return { success: true, stopped: false, status: defaultStatus() };
  const pid = running.pid;
  pushLog(`[WebUI] stopping PID ${pid}`);
  running.kill('SIGTERM');
  setTimeout(() => {
    if (running && running.pid === pid) {
      try {
        running.kill('SIGKILL');
      } catch (_) {}
    }
  }, 3000).unref();
  return { success: true, stopped: true, pid, status: defaultStatus() };
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (_) {
    sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, defaultStatus());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const after = Number(url.searchParams.get('after') || 0);
      sendJson(res, 200, { offset: logs.length, logs: logs.slice(Math.max(0, after)) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/mfa') {
      sendJson(res, 200, await readMfaChoices());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      const body = await readJsonBody(req);
      sendJson(res, 200, startAutomation(body));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/upload-excel') {
      const uploadedPath = await saveUploadedExcel(req);
      pushLog(`[WebUI] uploaded Excel: ${uploadedPath}`);
      sendJson(res, 200, { success: true, path: uploadedPath });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/start-batch') {
      const body = await readJsonBody(req);
      sendJson(res, 200, startBatchAutomation(body));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/create-template') {
      const body = await readJsonBody(req);
      sendJson(res, 200, createExcelTemplate(body));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      sendJson(res, 200, stopAutomation());
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

server.listen(defaultPort, '127.0.0.1', () => {
  console.log(`[IDme WebUI] http://127.0.0.1:${defaultPort}/`);
});
