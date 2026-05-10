#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const XLSX = require('xlsx');
const {
  createBrowserBlockedTracker,
  checkBrowserBlocked,
  gotoWithRetry,
  launchCloakBrowser,
  fillEmail,
  fillPassword,
  inspectMfaChoices,
  saveMfaChoices,
  clickContinue,
  clickSignIn,
  waitForLoginReady,
  isAccessDeniedTitle,
  isIpProblemTitle,
} = require('./idme');

const DEFAULT_URL = 'https://api.id.me/en/session/new';
const DEFAULT_PROXY = 'socks5://LKUCHRW5:EdQ96GYB@80.211.137.34:6336';
const SUCCESS_URL_PARTS = [
  '/multifactor/',
  '/multifactor/event/',
  '/multifactor/event/phone/new',
];

function parseArgs(argv) {
  const args = {
    excel: 'idme-accounts.xlsx',
    url: DEFAULT_URL,
    proxy: DEFAULT_PROXY,
    noProxy: false,
    headless: false,
    profileBase: '.idme-batch-profile',
    freshProfile: false,
    keepProfile: false,
    randomUserAgent: false,
    slow: 0,
    timeoutMs: 120000,
    concurrency: 1,
    startRow: 0,
    endRow: 0,
    sheet: '',
    browserBlockedLimit: 3,
    browserBlockedRetry: true,
    reuseGoodBrowser: true,
    reuseWrongPasswordLimit: 3,
    proxyRefreshUrl: '',
    proxyRefreshWait: 5,
    proxyRefreshOnFail: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];

    if (item === '--excel' && next) {
      args.excel = next;
      index += 1;
    } else if (item.startsWith('--excel=')) {
      args.excel = item.slice('--excel='.length);
    } else if (item === '--url' && next) {
      args.url = next;
      index += 1;
    } else if (item.startsWith('--url=')) {
      args.url = item.slice('--url='.length);
    } else if (item === '--proxy' && next) {
      args.proxy = next;
      index += 1;
    } else if (item.startsWith('--proxy=')) {
      args.proxy = item.slice('--proxy='.length);
    } else if (item === '--no-proxy') {
      args.noProxy = true;
      args.proxy = '';
    } else if (item === '--headless') {
      args.headless = true;
    } else if (item === '--headed') {
      args.headless = false;
    } else if (item === '--profile-base' && next) {
      args.profileBase = next;
      index += 1;
    } else if (item.startsWith('--profile-base=')) {
      args.profileBase = item.slice('--profile-base='.length);
    } else if (item === '--fresh-profile') {
      args.freshProfile = true;
    } else if (item === '--reuse-profile') {
      args.freshProfile = false;
    } else if (item === '--keep-profile') {
      args.keepProfile = true;
    } else if (item === '--delete-profile') {
      args.keepProfile = false;
    } else if (item === '--random-user-agent') {
      args.randomUserAgent = true;
    } else if (item === '--fixed-user-agent') {
      args.randomUserAgent = false;
    } else if (item === '--slow' && next) {
      args.slow = Number(next) || 0;
      index += 1;
    } else if (item.startsWith('--slow=')) {
      args.slow = Number(item.slice('--slow='.length)) || 0;
    } else if (item === '--timeout-ms' && next) {
      args.timeoutMs = Math.max(10000, Number(next) || args.timeoutMs);
      index += 1;
    } else if (item.startsWith('--timeout-ms=')) {
      args.timeoutMs = Math.max(10000, Number(item.slice('--timeout-ms='.length)) || args.timeoutMs);
    } else if (item === '--concurrency' && next) {
      args.concurrency = Math.max(1, Math.min(10, Number(next) || args.concurrency));
      index += 1;
    } else if (item.startsWith('--concurrency=')) {
      args.concurrency = Math.max(1, Math.min(10, Number(item.slice('--concurrency='.length)) || args.concurrency));
    } else if (item === '--start-row' && next) {
      args.startRow = Math.max(0, Number(next) || 0);
      index += 1;
    } else if (item.startsWith('--start-row=')) {
      args.startRow = Math.max(0, Number(item.slice('--start-row='.length)) || 0);
    } else if (item === '--end-row' && next) {
      args.endRow = Math.max(0, Number(next) || 0);
      index += 1;
    } else if (item.startsWith('--end-row=')) {
      args.endRow = Math.max(0, Number(item.slice('--end-row='.length)) || 0);
    } else if (item === '--sheet' && next) {
      args.sheet = next;
      index += 1;
    } else if (item.startsWith('--sheet=')) {
      args.sheet = item.slice('--sheet='.length);
    } else if (item === '--browser-blocked-limit' && next) {
      args.browserBlockedLimit = Math.max(1, Number(next) || args.browserBlockedLimit);
      index += 1;
    } else if (item.startsWith('--browser-blocked-limit=')) {
      args.browserBlockedLimit = Math.max(1, Number(item.slice('--browser-blocked-limit='.length)) || args.browserBlockedLimit);
    } else if (item === '--browser-blocked-retry') {
      args.browserBlockedRetry = true;
    } else if (item === '--no-browser-blocked-retry') {
      args.browserBlockedRetry = false;
    } else if (item === '--reuse-good-browser') {
      args.reuseGoodBrowser = true;
    } else if (item === '--no-reuse-good-browser') {
      args.reuseGoodBrowser = false;
    } else if (item === '--reuse-wrong-password-limit' && next) {
      args.reuseWrongPasswordLimit = Math.max(1, Number(next) || args.reuseWrongPasswordLimit);
      index += 1;
    } else if (item.startsWith('--reuse-wrong-password-limit=')) {
      args.reuseWrongPasswordLimit = Math.max(1, Number(item.slice('--reuse-wrong-password-limit='.length)) || args.reuseWrongPasswordLimit);
    } else if (item === '--proxy-refresh-url' && next) {
      args.proxyRefreshUrl = next;
      index += 1;
    } else if (item.startsWith('--proxy-refresh-url=')) {
      args.proxyRefreshUrl = item.slice('--proxy-refresh-url='.length);
    } else if (item === '--proxy-refresh-wait' && next) {
      args.proxyRefreshWait = Math.max(0, Number(next) || args.proxyRefreshWait);
      index += 1;
    } else if (item.startsWith('--proxy-refresh-wait=')) {
      args.proxyRefreshWait = Math.max(0, Number(item.slice('--proxy-refresh-wait='.length)) || args.proxyRefreshWait);
    } else if (item === '--proxy-refresh-on-fail') {
      args.proxyRefreshOnFail = true;
    } else if (item === '--no-proxy-refresh-on-fail') {
      args.proxyRefreshOnFail = false;
    }
  }

  return args;
}

function maskProxy(proxy) {
  return proxy ? proxy.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : 'disabled';
}

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function stableHash(input) {
  let hash = 2166136261;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(list, seed) {
  return list[seed % list.length];
}

function randomToken() {
  return crypto.randomBytes(6).toString('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGetText(url, timeoutMs = 30000, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, response => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400 && redirectsLeft > 0) {
        response.resume();
        resolve(httpGetText(new URL(location, parsed).toString(), timeoutMs, redirectsLeft - 1));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2000) body = body.slice(0, 2000);
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`timeout ${timeoutMs}ms`)));
    request.on('error', reject);
  });
}

async function refreshProxyIp(options, reason) {
  if (!options.proxyRefreshUrl) return { success: false, limited: false, body: '', error: 'proxy refresh url empty' };
  console.log(`[Batch] refresh proxy IP start (${reason})`);
  const body = await httpGetText(options.proxyRefreshUrl);
  const normalizedBody = body.slice(0, 300).replace(/\s+/g, ' ') || 'empty response';
  console.log(`[Batch] refresh proxy IP done (${reason}): ${normalizedBody}`);
  const limited = /too_many_requests|稍后再试|请求过于频繁|频繁|rate.?limit/i.test(body);
  if (limited) {
    console.log(`[Batch] refresh proxy IP limited (${reason}), skip retry for current row`);
    return { success: false, limited: true, body, error: normalizedBody };
  }
  if (options.proxyRefreshWait > 0) {
    console.log(`[Batch] wait ${options.proxyRefreshWait}s after proxy refresh`);
    await sleep(options.proxyRefreshWait * 1000);
  }
  return { success: true, limited: false, body, error: '' };
}

async function safeRunAccount(row, options, label) {
  try {
    return await runAccount(row, options);
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    console.log(`[Batch] row ${row.rowNumber} ${label} error, skip retry and continue: ${message}`);
    return { success: false, status: `登录失败：${label}异常 ${error.message || error}，已跳过继续下一行`, mfaLabel: '' };
  }
}

function generateWindowsUserAgent(seedInput) {
  const seed = stableHash(seedInput);
  const chromeMajor = 146;
  const chromeBuild = 7680;
  const chromePatch = 160 + ((seed >>> 8) % 40);
  const windowsVersions = ['10.0; Win64; x64'];
  return `Mozilla/5.0 (Windows NT ${pick(windowsVersions, seed >>> 12)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeBuild}.${chromePatch} Safari/537.36`;
}

function cellValue(sheet, rowNumber, columnLetter) {
  const cell = sheet[`${columnLetter}${rowNumber}`];
  return cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : '';
}

function setCell(sheet, rowNumber, columnLetter, value) {
  const address = `${columnLetter}${rowNumber}`;
  sheet[address] = { t: 's', v: String(value) };
}

function detectHeader(sheet) {
  const a1 = cellValue(sheet, 1, 'A').toLowerCase();
  const b1 = cellValue(sheet, 1, 'B').toLowerCase();
  const emailHeaders = ['email', '邮箱', '账号', 'mail'];
  const passwordHeaders = ['password', '密码', 'pass'];
  return emailHeaders.some(item => a1.includes(item)) || passwordHeaders.some(item => b1.includes(item));
}

function worksheetLastRow(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:C1');
  return range.e.r + 1;
}

function ensureRangeIncludes(sheet, rowNumber, columnIndex) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:C1');
  range.e.r = Math.max(range.e.r, rowNumber - 1);
  range.e.c = Math.max(range.e.c, columnIndex);
  sheet['!ref'] = XLSX.utils.encode_range(range);
}

function isExcelWriteLockError(error) {
  const code = String(error && error.code ? error.code : '').toUpperCase();
  const message = String(error && error.message ? error.message : error || '');
  return ['UNKNOWN', 'EPERM', 'EBUSY', 'EACCES', 'ENOENT'].includes(code)
    || /UNKNOWN|EPERM|EBUSY|EACCES|permission denied|being used by another process|open .*\.xlsx/i.test(message);
}

async function safeWriteWorkbook(workbook, excelPath, label = 'excel write') {
  const attempts = [1000, 2000, 3000, 5000, 8000];
  let lastError = null;

  for (let attempt = 1; attempt <= attempts.length + 1; attempt += 1) {
    try {
      XLSX.writeFile(workbook, excelPath);
      if (attempt > 1) console.log(`[Batch] ${label} succeeded after retry ${attempt}/${attempts.length + 1}`);
      return true;
    } catch (error) {
      lastError = error;
      const message = error && error.message ? error.message : String(error);
      const retryable = isExcelWriteLockError(error);
      if (!retryable || attempt > attempts.length) {
        console.log(`[Batch] ${label} failed, keep running without exiting: ${message}`);
        console.log(`[Batch] 请关闭正在打开的 Excel/WPS 文件后继续运行：${excelPath}`);
        return false;
      }
      const waitMs = attempts[attempt - 1];
      console.log(`[Batch] ${label} failed ${attempt}/${attempts.length + 1}: ${message}`);
      console.log(`[Batch] Excel 文件可能被占用，等待 ${Math.round(waitMs / 1000)}s 后重试：${excelPath}`);
      await sleep(waitMs);
    }
  }

  console.log(`[Batch] ${label} failed, keep running without exiting: ${lastError && lastError.message ? lastError.message : lastError}`);
  return false;
}

function isFilledLoginStatus(status) {
  const text = String(status || '').trim();
  return Boolean(text) && !/^运行中\b/i.test(text);
}

function buildRows(sheet, options) {
  const hasHeader = detectHeader(sheet);
  const firstDataRow = hasHeader ? 2 : 1;
  const lastRow = worksheetLastRow(sheet);
  const start = options.startRow > 0 ? Math.max(options.startRow, firstDataRow) : firstDataRow;
  const end = options.endRow > 0 ? Math.min(options.endRow, lastRow) : lastRow;
  const rows = [];
  let skippedByStatus = 0;

  if (hasHeader) {
    setCell(sheet, 1, 'C', cellValue(sheet, 1, 'C') || 'HTTP Proxy');
    setCell(sheet, 1, 'D', cellValue(sheet, 1, 'D') || '登录状态');
    setCell(sheet, 1, 'E', cellValue(sheet, 1, 'E') || '记录时间');
    setCell(sheet, 1, 'F', cellValue(sheet, 1, 'F') || 'User Agent');
    setCell(sheet, 1, 'G', cellValue(sheet, 1, 'G') || 'MFA 验证方式');
  }

  for (let rowNumber = start; rowNumber <= end; rowNumber += 1) {
    const email = cellValue(sheet, rowNumber, 'A');
    const password = cellValue(sheet, rowNumber, 'B');
    const proxy = cellValue(sheet, rowNumber, 'C');
    const status = cellValue(sheet, rowNumber, 'D');
    if (!email && !password && !proxy && !status) continue;
    if (isFilledLoginStatus(status)) {
      skippedByStatus += 1;
      console.log(`[Batch] row ${rowNumber} skipped: 登录状态已有内容：${status}`);
      continue;
    }
    rows.push({ rowNumber, email, password, proxy, status });
  }

  return { rows, hasHeader, skippedByStatus };
}

function classifyOutput(output, exitCode, signal, timedOut) {
  const passwordUrlMatch = output.match(/\[IDme\] url after password Continue: (.+)/);
  const passwordUrl = passwordUrlMatch ? passwordUrlMatch[1].trim() : '';
  const hasSuccessUrl = SUCCESS_URL_PARTS.some(part => passwordUrl.includes(part));
  const mfaMatch = output.match(/\[IDme\] MFA choices: (.+)/);
  let hasMfaChoice = false;
  let mfaLabel = '';

  if (mfaMatch) {
    try {
      const choices = JSON.parse(mfaMatch[1]);
      const setupChoice = Array.isArray(choices)
        ? choices.find(choice => choice && !choice.error && choice.name === 'multifactor[setup]' && choice.label)
        : null;
      const phoneChoice = Array.isArray(choices)
        ? choices.find(choice => choice && !choice.error && /\(\*\*\*\)|\*+[- )]*\d+/.test(choice.label || ''))
        : null;
      const firstChoice = setupChoice || phoneChoice || (Array.isArray(choices)
        ? choices.find(choice => choice && !choice.error && (choice.label || choice.description))
        : null);
      hasMfaChoice = Boolean(firstChoice);
      mfaLabel = firstChoice ? (firstChoice.label || firstChoice.description || '') : '';
    } catch (_) {}
  }

  if (hasSuccessUrl || hasMfaChoice) {
    return { success: true, status: `登录成功${mfaLabel ? `：${mfaLabel}` : ''}`, mfaLabel };
  }

  if (timedOut) return { success: false, status: '登录失败：超时', mfaLabel: '' };
  if (exitCode === 12 || /browser_blocked_limit_reached|BROWSER_BLOCKED_LIMIT_REACHED/i.test(output)) {
    const accessDenied = /Access denied \| www\.id\.me/i.test(output);
    const somethingWrong = /Something isn't right - ID\.me/i.test(output);
    const label = accessDenied ? 'Access denied' : somethingWrong ? "Something isn't right" : 'browser_blocked';
    return { success: false, status: `登录失败：${label}，疑似 IP 问题`, mfaLabel: '', browserBlocked: true };
  }
  if (/entry goto failed \d+\/\d+:.*ERR_|direct login goto failed \d+\/\d+:.*ERR_|page\.goto: net::ERR_/i.test(output)) {
    return { success: false, status: '登录失败：网络打开失败，已自动重试仍失败', mfaLabel: '', networkOpenFailed: true };
  }
  if (/Something isn't right - ID\.me/i.test(output) && /password input not found|Continue submit not found|url after email Continue: https:\/\/api\.id\.me\/en\/session\/identify/i.test(output)) {
    return { success: false, status: "登录失败：Something isn't right，疑似 IP 问题", mfaLabel: '', browserBlocked: true };
  }
  if (/\[IDme\] password rejected: session page after password Continue/i.test(output)) {
    return { success: false, status: '登录失败：密码错误', mfaLabel: '', passwordWrong: true };
  }
  if (exitCode !== 0) return { success: false, status: `登录失败：进程退出 ${exitCode}${signal ? `/${signal}` : ''}`, mfaLabel: '' };

  if (/fill email: \{"success":false/.test(output)) return { success: false, status: '登录失败：邮箱输入框未找到', mfaLabel: '' };
  if (/fill password: \{"success":false/.test(output)) return { success: false, status: '登录失败：密码输入框未找到', mfaLabel: '' };
  if (/click Continue after email: \{"success":false/.test(output)) return { success: false, status: '登录失败：邮箱 Continue 未找到', mfaLabel: '' };
  if (/click Continue after password: \{"success":false/.test(output)) return { success: false, status: '登录失败：密码 Continue 未找到', mfaLabel: '' };

  const lastUrlMatch = output.match(/\[IDme\] url after password Continue: (.+)|\[IDme\] url: (.+)/g);
  const lastUrl = lastUrlMatch && lastUrlMatch.length ? lastUrlMatch[lastUrlMatch.length - 1].replace(/^.*?: /, '') : '';
  return { success: false, status: `登录失败：未进入 MFA${lastUrl ? `，当前 ${lastUrl}` : ''}`, mfaLabel: '' };
}

function isReusableNoBrowserBlockedStatus(status) {
  const text = String(status || '');
  return /登录失败：未进入 MFA，当前 https:\/\/api\.id\.me\/en\/session(?:\/authentication_options)?\b/.test(text)
    && !/browser_blocked/i.test(text);
}

function createProxyPool(initialProxies = []) {
  const proxies = [];
  const seen = new Set();
  let cursor = 0;

  const add = (proxy, reason = '') => {
    const value = String(proxy || '').trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    proxies.push(value);
    console.log(`[Batch] saved no-browser_blocked proxy${reason ? ` (${reason})` : ''}: ${maskProxy(value)}`);
    return true;
  };

  initialProxies.forEach(item => add(item.proxy || item, item.reason || 'excel history'));

  return {
    add,
    size: () => proxies.length,
    next(excludeProxy = '') {
      if (!proxies.length) return '';
      for (let attempt = 0; attempt < proxies.length; attempt += 1) {
        const proxy = proxies[cursor % proxies.length];
        cursor += 1;
        if (proxy !== excludeProxy) return proxy;
      }
      return '';
    },
  };
}

function isReusableBrowserEligible(options) {
  return options.reuseGoodBrowser && !options.randomUserAgent;
}

function reusableProfileName(workerIndex, options) {
  return `${options.profileBase}-${options.runId}-worker${workerIndex + 1}-reuse`;
}

async function closeReusableSession(session, options, reason = '') {
  if (!session) return;
  try {
    await session.context.close();
  } catch (error) {
    console.log(`[Batch] reusable browser close failed${reason ? ` (${reason})` : ''}: ${error.message}`);
  }
  if (!options.keepProfile) {
    try {
      fs.rmSync(session.profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
      console.log(`[Batch] reusable browser deleted profile/cache${reason ? ` (${reason})` : ''}: ${session.profile}`);
    } catch (error) {
      console.log(`[Batch] reusable browser delete profile/cache failed${reason ? ` (${reason})` : ''}: ${error.message}`);
    }
  }
}

async function prepareSignInPage(session, options, label) {
  const page = session.page;
  const entryUrl = 'https://www.id.me/';
  await gotoWithRetry(page, entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }, `${label} entry goto`, 10);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  console.log(`[Batch] ${label} entry title: ${await page.title().catch(() => '')}`);
  console.log(`[Batch] ${label} entry url: ${page.url()}`);
  let signInResult = await clickSignIn(page);
  console.log(`[Batch] ${label} click Sign in: ${JSON.stringify(signInResult)}`);
  if (!signInResult.success) {
    await gotoWithRetry(page, page.url(), { waitUntil: 'domcontentloaded', timeout: 60000 }, `${label} entry reload`, 5);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    signInResult = await clickSignIn(page);
    console.log(`[Batch] ${label} retry click Sign in: ${JSON.stringify(signInResult)}`);
  }
  const readyResult = await waitForLoginReady(page, 120000, session.browserBlockedTracker);
  console.log(`[Batch] ${label} login ready wait: ${JSON.stringify(readyResult)}`);
  session.ready = readyResult.success;
}

async function ensureReusableSession(session, row, options, workerIndex, rowProxy, userAgent) {
  if (session && session.proxy === rowProxy && session.userAgent === userAgent) return session;
  await closeReusableSession(session, options, 'proxy/userAgent changed');

  const profile = reusableProfileName(workerIndex, options);
  const launchOptions = {
    url: options.url,
    entryUrl: 'https://www.id.me/',
    clickSignInFirst: true,
    headless: options.headless,
    profile,
    slow: options.slow,
    proxy: options.noProxy ? '' : rowProxy,
    userAgent,
    browserBlockedLimit: options.browserBlockedLimit,
    exitAfterRun: false,
    disableExtension: false,
  };
  const browserBlockedTracker = createBrowserBlockedTracker(options.browserBlockedLimit);
  console.log(`[Batch] worker ${workerIndex + 1} launch reusable browser profile=${profile} proxy=${maskProxy(rowProxy)} userAgent=${userAgent || 'browser default'}`);
  const browser = await launchCloakBrowser(launchOptions);
  const nextSession = {
    ...browser,
    profile,
    profilePath: path.resolve(process.cwd(), profile),
    proxy: rowProxy,
    userAgent,
    browserBlockedTracker,
    ready: false,
    wrongPasswordCount: 0,
  };
  await prepareSignInPage(nextSession, options, `worker ${workerIndex + 1}`);
  return nextSession;
}

async function runAccountInReusableBrowser(session, row, options, workerIndex) {
  const page = session.page;
  const label = `worker ${workerIndex + 1} row ${row.rowNumber}`;
  try {
    if (!session.ready) await prepareSignInPage(session, options, label);

    console.log(`[Batch] ${label} reusable start email=${row.email} proxy=${maskProxy(session.proxy)}`);
    console.log(`[IDme] title: ${await page.title().catch(() => '')}`);
    console.log(`[IDme] url: ${page.url()}`);
    const emailInputs = await page.evaluate(() => Array.from(document.querySelectorAll('input, textarea')).length).catch(() => 0);
    console.log(`[Batch] ${label} inputs on page: ${emailInputs}`);

    const emailResult = await fillEmail(page, row.email);
    console.log(`[IDme] fill email: ${JSON.stringify(emailResult)}`);
    if (!emailResult.success) throw new Error(`Email fill failed: ${emailResult.error || 'unknown'}`);

    let continueResult = await clickContinue(page);
    let emailContinueAttempt = 1;
    while (true) {
      const continueLabel = emailContinueAttempt === 1 ? 'email Continue' : `retry email Continue ${emailContinueAttempt - 1}`;
      console.log(`[IDme] click Continue after ${continueLabel}: ${JSON.stringify(continueResult)}`);
      console.log(`[IDme] title after ${continueLabel}: ${await page.title().catch(() => '')}`);
      console.log(`[IDme] url after ${continueLabel}: ${page.url()}`);

      const titleAfterEmail = await page.title().catch(() => '');
      const blockedAfterEmail = /\/message\/browser_blocked/i.test(continueResult.afterUrl || continueResult.url || page.url()) || isIpProblemTitle(titleAfterEmail);
      if (!blockedAfterEmail) {
        await checkBrowserBlocked(page, session.browserBlockedTracker, `after ${continueLabel}`);
        break;
      }

      await checkBrowserBlocked(page, session.browserBlockedTracker, `after ${continueLabel}`);
      await prepareSignInPage(session, options, `${label} after browser_blocked`);
      const retryEmailResult = await fillEmail(page, row.email);
      console.log(`[IDme] retry fill email after ${continueLabel}: ${JSON.stringify(retryEmailResult)}`);
      if (!retryEmailResult.success) throw new Error(`Retry email fill failed: ${retryEmailResult.error || 'unknown'}`);
      continueResult = await clickContinue(page);
      emailContinueAttempt += 1;
    }

    const passwordResult = await fillPassword(page, row.password);
    console.log(`[IDme] fill password: ${JSON.stringify(passwordResult)}`);
    if (!passwordResult.success) {
      await checkBrowserBlocked(page, session.browserBlockedTracker, 'password input not found');
      throw new Error(`Password fill failed: ${passwordResult.error || 'unknown'}`);
    }
    const passwordContinueResult = await clickContinue(page);
    console.log(`[IDme] click Continue after password: ${JSON.stringify(passwordContinueResult)}`);
    console.log(`[IDme] title after password Continue: ${await page.title().catch(() => '')}`);
    console.log(`[IDme] url after password Continue: ${page.url()}`);
    await checkBrowserBlocked(page, session.browserBlockedTracker, 'after password Continue');

    if (/https:\/\/api\.id\.me\/en\/session(?:\/authentication_options)?\b/.test(page.url())) {
      session.wrongPasswordCount = (session.wrongPasswordCount || 0) + 1;
      const keepReusableBrowser = session.wrongPasswordCount < options.reuseWrongPasswordLimit;
      const limitMessage = keepReusableBrowser
        ? `，复用浏览器连续密码错误 ${session.wrongPasswordCount}/${options.reuseWrongPasswordLimit}`
        : `，复用浏览器连续密码错误达到 ${session.wrongPasswordCount}/${options.reuseWrongPasswordLimit}，换新浏览器`;
      console.log(`[IDme] password rejected: session page after password Continue${limitMessage}`);
      if (keepReusableBrowser) {
        await prepareSignInPage(session, options, `${label} password rejected return`);
      }
      return { success: false, status: `登录失败：密码错误${limitMessage}`, mfaLabel: '', passwordWrong: true, keepReusableBrowser };
    }

    const mfaChoices = await inspectMfaChoices(page).catch(error => [{ error: error.message }]);
    console.log(`[IDme] MFA choices: ${JSON.stringify(mfaChoices)}`);
    await saveMfaChoices(mfaChoices.filter(choice => !choice.error)).catch(error => {
      console.log(`[IDme] save MFA choices failed: ${error.message}`);
    });
    const output = `[IDme] url after password Continue: ${page.url()}\n[IDme] MFA choices: ${JSON.stringify(mfaChoices)}`;
    return { ...classifyOutput(output, 0, '', false), keepReusableBrowser: false };
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    if (/BROWSER_BLOCKED_LIMIT_REACHED/i.test(message)) {
      const accessDenied = /Access denied \| www\.id\.me/i.test(message);
      const somethingWrong = /Something isn't right - ID\.me/i.test(message);
      const label = accessDenied ? 'Access denied' : somethingWrong ? "Something isn't right" : 'browser_blocked';
      return { success: false, status: `登录失败：${label}，疑似 IP 问题`, mfaLabel: '', browserBlocked: true, keepReusableBrowser: false };
    }
    return { success: false, status: `登录失败：复用浏览器异常 ${error.message || error}`, mfaLabel: '', keepReusableBrowser: false };
  }
}

function runAccount(row, options) {
  return new Promise(resolve => {
    const environmentId = row.environmentId || randomToken();
    const isTemporaryProfile = options.freshProfile || options.randomUserAgent || options.concurrency > 1;
    const profile = isTemporaryProfile
      ? `${options.profileBase}-${options.runId}-row${row.rowNumber}-${environmentId}`
      : `${options.profileBase}-row${row.rowNumber}`;
    const rowProxy = row.proxy || options.proxy || '';
    const userAgentSeed = `${row.email}|${row.rowNumber}|${rowProxy}|${options.runId}|${environmentId}`;
    const userAgent = row.userAgent || (options.randomUserAgent ? generateWindowsUserAgent(userAgentSeed) : '');
    const args = [
      'src/idme.js',
      '--url', options.url,
      '--entry-url', 'https://www.id.me/',
      '--click-sign-in-first',
      options.headless ? '--headless' : '--headed',
      '--exit-after-run',
      '--profile', profile,
      '--email', row.email,
      '--password', row.password,
    ];

    if (userAgent) args.push('--user-agent', userAgent);
    if (rowProxy) args.push('--proxy', rowProxy);
    if (options.noProxy) args.push('--no-proxy');
    if (options.slow) args.push('--slow', String(options.slow));
    args.push('--browser-blocked-limit', String(options.browserBlockedLimit));

    const safeCommand = `node ${args.map(item => item.includes(' ') ? `"${item}"` : item).join(' ')}`.replace(/--password\s+\S+/, '--password ***').replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
    console.log(`[Batch] row ${row.rowNumber} start email=${row.email} profile=${profile} proxy=${maskProxy(rowProxy)}`);
    console.log(`[Batch] row ${row.rowNumber} userAgent=${userAgent || 'browser default'}`);
    console.log(`[Batch] command: ${safeCommand}`);

    let output = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      });
    } catch (error) {
      console.log(`[Batch] row ${row.rowNumber} spawn failed: ${error.message}`);
      resolve({ success: false, status: `登录失败：启动子进程异常 ${error.message}`, mfaLabel: '' });
      return;
    }

    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        console.log(`[Batch] row ${row.rowNumber} inactive timeout, killing PID ${child.pid}`);
        child.kill('SIGKILL');
      }, options.timeoutMs);
    };
    resetTimer();

    child.stdout.on('data', chunk => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
      resetTimer();
    });
    child.stderr.on('data', chunk => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
      resetTimer();
    });
    child.on('error', error => {
      clearTimeout(timer);
      console.log(`[Batch] row ${row.rowNumber} child process error: ${error.message}`);
      resolve({ success: false, status: `登录失败：子进程异常 ${error.message}`, mfaLabel: '' });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const result = classifyOutput(output, code, signal, timedOut);
      console.log(`[Batch] row ${row.rowNumber} result: ${result.status}`);

      if (!options.keepProfile) {
        const profilePath = path.resolve(process.cwd(), profile);
        try {
          fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
          console.log(`[Batch] row ${row.rowNumber} deleted profile/cache: ${profile}`);
        } catch (error) {
          console.log(`[Batch] row ${row.rowNumber} delete profile/cache failed: ${error.message}`);
        }
      }

      resolve(result);
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.runId = `${Date.now()}-${randomToken()}`;
  const excelPath = resolveProjectPath(options.excel);

  if (!fs.existsSync(excelPath)) {
    throw new Error(`Excel 文件不存在：${excelPath}`);
  }

  console.log(`[Batch] excel: ${excelPath}`);
  console.log(`[Batch] url: ${options.url}`);
  console.log(`[Batch] proxy: ${maskProxy(options.proxy)}`);
  console.log(`[Batch] profile base: ${options.profileBase}`);
  console.log(`[Batch] profile mode: ${options.freshProfile ? 'fresh' : 'reuse'}`);
  console.log(`[Batch] profile/cache cleanup: ${options.keepProfile ? 'keep' : 'delete after each account'}`);
  console.log(`[Batch] user agent mode: ${options.randomUserAgent ? 'random' : 'fixed'}`);
  console.log(`[Batch] concurrency: ${options.concurrency}`);
  console.log(`[Batch] browser_blocked limit: ${options.browserBlockedLimit}`);
  console.log(`[Batch] browser_blocked retry: ${options.browserBlockedRetry ? 'enabled' : 'disabled'}`);
  console.log(`[Batch] proxy refresh on fail: ${options.proxyRefreshUrl && options.proxyRefreshOnFail ? 'enabled' : 'disabled'}`);
  if (options.proxyRefreshUrl) console.log(`[Batch] proxy refresh wait: ${options.proxyRefreshWait}s`);
  console.log(`[Batch] reuse good browser: ${isReusableBrowserEligible(options) ? 'enabled' : 'disabled'}`);
  if (isReusableBrowserEligible(options)) {
    console.log(`[Batch] reusable browser wrong-password limit: ${options.reuseWrongPasswordLimit}`);
  }
  console.log(`[Batch] run id: ${options.runId}`);

  const workbook = XLSX.readFile(excelPath);
  const sheetName = options.sheet || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`找不到工作表：${sheetName}`);

  const { rows, skippedByStatus } = buildRows(sheet, options);
  console.log(`[Batch] sheet: ${sheetName}`);
  console.log(`[Batch] rows: ${rows.length}`);
  console.log(`[Batch] skipped rows with existing login status: ${skippedByStatus}`);

  if (!rows.length) {
    console.log('[Batch] 没有可运行的账号行。A列=email，B列=password，C列=HTTP Proxy。');
    return;
  }

  const historicalNoBrowserBlockedProxies = rows
    .filter(row => row.proxy && isReusableNoBrowserBlockedStatus(row.status))
    .map(row => ({ proxy: row.proxy, reason: `excel row ${row.rowNumber}` }));
  const noBrowserBlockedProxyPool = createProxyPool(historicalNoBrowserBlockedProxies);
  console.log(`[Batch] no-browser_blocked proxy pool: ${noBrowserBlockedProxyPool.size()}`);

  const queue = rows.slice();
  let writeChain = Promise.resolve();
  const writeExcel = async (update, label = 'excel write') => {
    writeChain = writeChain.then(async () => {
      update();
      await safeWriteWorkbook(workbook, excelPath, label);
    }).catch(error => {
      const message = error && error.message ? error.message : String(error);
      console.log(`[Batch] ${label} failed before workbook write, keep running without exiting: ${message}`);
      return false;
    });
    return writeChain;
  };
  let lastGoodProxy = '';
  let proxyRefreshChain = Promise.resolve();
  const refreshProxyForFail = reason => {
    if (!options.proxyRefreshUrl || !options.proxyRefreshOnFail) {
      return Promise.resolve({ success: false, limited: false, body: '', error: 'proxy refresh disabled' });
    }
    proxyRefreshChain = proxyRefreshChain.then(() => refreshProxyIp(options, reason)).catch(error => {
      const message = error && error.message ? error.message : String(error);
      const limited = /too_many_requests|稍后再试|请求过于频繁|频繁|rate.?limit/i.test(message);
      console.log(`[Batch] refresh proxy IP failed (${reason}): ${message}`);
      return { success: false, limited, body: '', error: message };
    });
    return proxyRefreshChain;
  };

  const workerCount = Math.min(options.concurrency, queue.length);
  const runWorker = async workerIndex => {
    let reusableSession = null;
    try {
      while (queue.length) {
        const row = queue.shift();
        ensureRangeIncludes(sheet, row.rowNumber, 6);

      if (!row.email || !row.password) {
        const status = !row.email ? '登录失败：邮箱为空' : '登录失败：密码为空';
        await writeExcel(() => {
          setCell(sheet, row.rowNumber, 'D', status);
          setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
          setCell(sheet, row.rowNumber, 'G', '');
        });
        console.log(`[Batch] row ${row.rowNumber} skipped: ${status}`);
        continue;
      }

      const rowProxy = row.proxy || options.proxy || '';
      const environmentId = randomToken();
      const userAgentSeed = `${row.email}|${row.rowNumber}|${rowProxy}|${options.runId}|${environmentId}`;
      const userAgent = options.randomUserAgent ? generateWindowsUserAgent(userAgentSeed) : '';
      await writeExcel(() => {
        setCell(sheet, row.rowNumber, 'D', `运行中 worker ${workerIndex + 1}`);
        setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
        setCell(sheet, row.rowNumber, 'F', userAgent || 'browser default');
        setCell(sheet, row.rowNumber, 'G', '');
      });

        let finalUserAgent = userAgent;
        let finalProxy = rowProxy;
        let result;
        try {
          if (isReusableBrowserEligible(options)) {
            reusableSession = await ensureReusableSession(reusableSession, row, options, workerIndex, rowProxy, userAgent);
            result = await runAccountInReusableBrowser(reusableSession, { ...row, userAgent, environmentId }, options, workerIndex);
            if (!result.keepReusableBrowser) {
              await closeReusableSession(reusableSession, options, result.success ? 'success MFA' : result.browserBlocked ? 'browser_blocked' : 'not reusable result');
              reusableSession = null;
            }
          } else {
            result = await runAccount({ ...row, userAgent, environmentId }, options);
          }
        } catch (error) {
          const message = error && error.stack ? error.stack : String(error);
          console.log(`[Batch] row ${row.rowNumber} unexpected error, skip and continue: ${message}`);
          await closeReusableSession(reusableSession, options, 'unexpected row error');
          reusableSession = null;
          result = { success: false, status: `登录失败：运行异常 ${error.message || error}，已跳过继续下一行`, mfaLabel: '' };
        }
      if (result.networkOpenFailed && options.proxyRefreshUrl && options.proxyRefreshOnFail) {
        const retryEnvironmentId = randomToken();
        finalUserAgent = options.randomUserAgent
          ? generateWindowsUserAgent(`${row.email}|${row.rowNumber}|${finalProxy}|${options.runId}|network_refresh|${retryEnvironmentId}`)
          : userAgent;
        console.log(`[Batch] row ${row.rowNumber} network failed, refresh proxy IP and retry once with same SOCKS5`);
        await writeExcel(() => {
          setCell(sheet, row.rowNumber, 'D', '网络打开失败，刷新代理 IP 后重试中');
          setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
          setCell(sheet, row.rowNumber, 'F', finalUserAgent || 'browser default');
          setCell(sheet, row.rowNumber, 'G', '');
        });
        await closeReusableSession(reusableSession, options, 'network failed before proxy refresh');
        reusableSession = null;
        const refreshResult = await refreshProxyForFail(`row ${row.rowNumber} network failed`);
        if (refreshResult.limited) {
          result = { success: false, status: `登录失败：代理刷新过于频繁，已跳过当前账号（${refreshResult.error || 'too_many_requests'}）`, mfaLabel: '' };
        } else {
          result = await safeRunAccount({ ...row, proxy: finalProxy, userAgent: finalUserAgent, environmentId: retryEnvironmentId }, { ...options, freshProfile: true }, '网络失败后重试');
        }
      }
      if (result.networkOpenFailed && lastGoodProxy && lastGoodProxy !== rowProxy) {
        const retryEnvironmentId = randomToken();
        finalProxy = lastGoodProxy;
        finalUserAgent = options.randomUserAgent
          ? generateWindowsUserAgent(`${row.email}|${row.rowNumber}|${lastGoodProxy}|${options.runId}|last_good_proxy|${retryEnvironmentId}`)
          : userAgent;
        console.log(`[Batch] row ${row.rowNumber} current proxy network failed, retry once with last good proxy: ${maskProxy(lastGoodProxy)}`);
        await writeExcel(() => {
          setCell(sheet, row.rowNumber, 'D', '当前代理网络失败，使用最近成功代理重试中');
          setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
          setCell(sheet, row.rowNumber, 'F', finalUserAgent || 'browser default');
          setCell(sheet, row.rowNumber, 'G', '');
        });
        result = await safeRunAccount({ ...row, proxy: lastGoodProxy, userAgent: finalUserAgent, environmentId: retryEnvironmentId }, { ...options, freshProfile: true }, '最近成功代理重试');
        if (result.networkOpenFailed) {
          result = { ...result, status: '登录失败：当前代理和最近成功代理均打开失败' };
        }
      }
      if (result.browserBlocked && options.browserBlockedRetry) {
        const retryEnvironmentId = randomToken();
        finalUserAgent = generateWindowsUserAgent(`${userAgentSeed}|browser_blocked_retry|${retryEnvironmentId}`);
        if (options.proxyRefreshUrl && options.proxyRefreshOnFail) {
          console.log(`[Batch] row ${row.rowNumber} browser_blocked reached ${options.browserBlockedLimit}, refresh proxy IP and retry once with new UA: ${finalUserAgent}`);
        } else {
          console.log(`[Batch] row ${row.rowNumber} browser_blocked reached ${options.browserBlockedLimit}, retry once with new UA: ${finalUserAgent}`);
        }
        await writeExcel(() => {
          setCell(sheet, row.rowNumber, 'D', options.proxyRefreshUrl && options.proxyRefreshOnFail ? 'browser_blocked，刷新代理 IP 并换新 UA 重试中' : 'browser_blocked，换新 UA 重试中');
          setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
          setCell(sheet, row.rowNumber, 'F', finalUserAgent);
          setCell(sheet, row.rowNumber, 'G', '');
        });
        await closeReusableSession(reusableSession, options, 'browser_blocked before proxy refresh');
        reusableSession = null;
        const refreshResult = await refreshProxyForFail(`row ${row.rowNumber} browser_blocked`);
        if (refreshResult.limited) {
          result = { success: false, status: `登录失败：代理刷新过于频繁，已跳过当前账号（${refreshResult.error || 'too_many_requests'}）`, mfaLabel: '' };
        } else {
          result = await safeRunAccount({ ...row, proxy: finalProxy, userAgent: finalUserAgent, environmentId: retryEnvironmentId }, { ...options, freshProfile: true, randomUserAgent: true }, 'browser_blocked 后重试');
        }
        if (result.browserBlocked) {
          let safeProxy = noBrowserBlockedProxyPool.next(finalProxy) || (lastGoodProxy !== finalProxy ? lastGoodProxy : '');
          if (safeProxy) {
            for (let safeAttempt = 1; safeAttempt <= 3 && result.browserBlocked; safeAttempt += 1) {
              const safeEnvironmentId = randomToken();
              finalProxy = safeProxy;
              finalUserAgent = generateWindowsUserAgent(`${userAgentSeed}|browser_blocked_safe_proxy|${safeAttempt}|${safeProxy}|${safeEnvironmentId}`);
              console.log(`[Batch] row ${row.rowNumber} still browser_blocked, replace window proxy ${safeAttempt}/3: ${maskProxy(safeProxy)}`);
              await writeExcel(() => {
                setCell(sheet, row.rowNumber, 'C', finalProxy);
                setCell(sheet, row.rowNumber, 'D', `疑似 IP 问题，使用未 browser_blocked 代理重试 ${safeAttempt}/3`);
                setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
                setCell(sheet, row.rowNumber, 'F', finalUserAgent);
                setCell(sheet, row.rowNumber, 'G', '');
              });
              result = await safeRunAccount({ ...row, proxy: safeProxy, userAgent: finalUserAgent, environmentId: safeEnvironmentId }, { ...options, freshProfile: true, randomUserAgent: true }, `未 browser_blocked 代理重试 ${safeAttempt}/3`);
              if (result.browserBlocked) safeProxy = noBrowserBlockedProxyPool.next(finalProxy) || safeProxy;
            }
            if (result.browserBlocked) {
              result = { ...result, status: '登录失败：更换未 browser_blocked 代理重试 3 次仍 browser_blocked，跳过账号' };
            }
          } else {
            result = { ...result, status: '登录失败：换新 UA 后仍 browser_blocked，暂无未 browser_blocked 代理可用，跳过账号' };
          }
        }
      }
      if (finalProxy && !result.browserBlocked && !result.networkOpenFailed) {
        if (result.success) {
          lastGoodProxy = finalProxy;
          console.log(`[Batch] row ${row.rowNumber} saved last good proxy: ${maskProxy(lastGoodProxy)}`);
        }
        if (result.success || isReusableNoBrowserBlockedStatus(result.status)) {
          noBrowserBlockedProxyPool.add(finalProxy, `row ${row.rowNumber} ${result.success ? 'success' : 'no browser_blocked'}`);
        }
      }
      await writeExcel(() => {
        if (finalProxy) setCell(sheet, row.rowNumber, 'C', finalProxy);
        setCell(sheet, row.rowNumber, 'D', result.status);
        setCell(sheet, row.rowNumber, 'E', new Date().toLocaleString('zh-CN', { hour12: false }));
        setCell(sheet, row.rowNumber, 'F', finalUserAgent || 'browser default');
        setCell(sheet, row.rowNumber, 'G', result.mfaLabel || '');
        });
      }
    } finally {
      await closeReusableSession(reusableSession, options, `worker ${workerIndex + 1} done`);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, (_, index) => runWorker(index)));

  console.log('[Batch] all done.');
}

main().catch(error => {
  console.error('[Batch] failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
