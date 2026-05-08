#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

function parseArgs(argv) {
  const args = {
    url: 'https://api.id.me/en/session/new',
    entryUrl: '',
    clickSignInFirst: false,
    headless: false,
    profile: '.idme-profile',
    slow: 0,
    proxy: 'http://wXYSygNq:rIj4WNT75PF12hPb@us.proxy302.com:2222',
    email: '',
    password: '',
    userAgent: '',
    browserBlockedLimit: 3,
    exitAfterRun: false,
    disableExtension: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];

    if (item === '--url' && next) {
      args.url = next;
      index += 1;
    } else if (item.startsWith('--url=')) {
      args.url = item.slice('--url='.length);
    } else if (item === '--entry-url' && next) {
      args.entryUrl = next;
      index += 1;
    } else if (item.startsWith('--entry-url=')) {
      args.entryUrl = item.slice('--entry-url='.length);
    } else if (item === '--click-sign-in-first') {
      args.clickSignInFirst = true;
    } else if (item === '--headless') {
      args.headless = true;
    } else if (item === '--headed') {
      args.headless = false;
    } else if (item === '--profile' && next) {
      args.profile = next;
      index += 1;
    } else if (item.startsWith('--profile=')) {
      args.profile = item.slice('--profile='.length);
    } else if (item === '--slow' && next) {
      args.slow = Number(next) || 0;
      index += 1;
    } else if (item.startsWith('--slow=')) {
      args.slow = Number(item.slice('--slow='.length)) || 0;
    } else if (item === '--proxy' && next) {
      args.proxy = next;
      index += 1;
    } else if (item.startsWith('--proxy=')) {
      args.proxy = item.slice('--proxy='.length);
    } else if (item === '--no-proxy') {
      args.proxy = '';
    } else if (item === '--email' && next) {
      args.email = next;
      index += 1;
    } else if (item.startsWith('--email=')) {
      args.email = item.slice('--email='.length);
    } else if (item === '--password' && next) {
      args.password = next;
      index += 1;
    } else if (item.startsWith('--password=')) {
      args.password = item.slice('--password='.length);
    } else if (item === '--user-agent' && next) {
      args.userAgent = next;
      index += 1;
    } else if (item.startsWith('--user-agent=')) {
      args.userAgent = item.slice('--user-agent='.length);
    } else if (item === '--browser-blocked-limit' && next) {
      args.browserBlockedLimit = Math.max(1, Number(next) || args.browserBlockedLimit);
      index += 1;
    } else if (item.startsWith('--browser-blocked-limit=')) {
      args.browserBlockedLimit = Math.max(1, Number(item.slice('--browser-blocked-limit='.length)) || args.browserBlockedLimit);
    } else if (item === '--exit-after-run') {
      args.exitAfterRun = true;
    } else if (item === '--disable-extension') {
      args.disableExtension = true;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function createBrowserBlockedTracker(limit) {
  return {
    limit: Math.max(1, Number(limit) || 3),
    count: 0,
  };
}

async function checkBrowserBlocked(page, tracker, where) {
  const url = page.url();
  const blocked = /\/message\/browser_blocked/i.test(url);
  if (!blocked) return false;

  tracker.count += 1;
  console.log(`[IDme] browser_blocked detected ${tracker.count}/${tracker.limit} at ${where}: ${url}`);
  if (tracker.count >= tracker.limit) {
    throw new Error(`BROWSER_BLOCKED_LIMIT_REACHED at ${where}: ${url}`);
  }
  return true;
}

function isRetryableNavigationError(error) {
  const message = error && (error.stack || error.message || String(error));
  return /ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|Timeout/i.test(message || '');
}

async function isNoNetworkPage(page) {
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('body').innerText({ timeout: 1000 }).catch(() => ''),
  ]);
  return /No internet|This site can.?t be reached|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/i.test(`${title}\n${bodyText}`);
}

async function gotoWithRetry(page, url, options = {}, label = 'goto', maxAttempts = 3) {
  let lastError;
  const attempts = Math.max(1, Number(maxAttempts) || 3);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.log(`[IDme] ${label} attempt ${attempt}/${attempts}: ${url}`);
      await page.goto(url, options);
      if (await isNoNetworkPage(page)) {
        lastError = new Error(`${label} no network page after goto: ${page.url()}`);
        console.log(`[IDme] ${label} no network page ${attempt}/${attempts}: ${page.url()}`);
        if (attempt >= attempts) break;
        await sleep(3000 * attempt);
        continue;
      }
      return { success: true, attempt, url: page.url() };
    } catch (error) {
      lastError = error;
      const message = error && (error.message || String(error));
      console.log(`[IDme] ${label} failed ${attempt}/${attempts}: ${message}`);
      if (attempt >= attempts || !isRetryableNavigationError(error)) break;
      await sleep(3000 * attempt);
    }
  }

  throw lastError;
}

async function launchCloakBrowser(options) {
  const { launchPersistentContext } = await import('cloakbrowser');
  const profileDir = path.resolve(process.cwd(), options.profile);
  const extensionDir = path.resolve(process.cwd(), 'cf-autoclick-master (1)', 'cf-autoclick-master');

  const useProxyGeo = Boolean(options.proxy);
  const browserArgs = [
    '--disable-blink-features=AutomationControlled',
    '--lang=en-US,en',
  ];

  if (!options.disableExtension) {
    browserArgs.push(
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    );
  }

  const launchOptions = {
    userDataDir: profileDir,
    headless: options.headless,
    viewport: { width: 1365, height: 900 },
    ...(useProxyGeo ? { geoip: true } : { locale: 'en-US', timezone: 'America/New_York' }),
    userAgent: options.userAgent || undefined,
    proxy: options.proxy || undefined,
    args: browserArgs,
    launchOptions: {
      ignoreDefaultArgs: [
        '--enable-automation',
        '--enable-unsafe-swiftshader',
        '--disable-extensions',
      ],
    },
  };

  let context;
  try {
    context = await launchPersistentContext(launchOptions);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (!useProxyGeo || !message.includes('mmdb-lib is required for geoip: true')) {
      throw error;
    }

    console.warn('[IDme] geoip disabled: mmdb-lib is unavailable, falling back to fixed locale/timezone');
    context = await launchPersistentContext({
      ...launchOptions,
      geoip: false,
      locale: 'en-US',
      timezone: 'America/New_York',
    });
  }

  const page = context.pages()[0] || await context.newPage();
  return { context, page, profileDir, extensionDir };
}

async function inspectEmailInputs(page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    return Array.from(document.querySelectorAll('input, textarea'))
      .map((element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || '',
        name: element.getAttribute('name') || '',
        id: element.id || '',
        autocomplete: element.getAttribute('autocomplete') || '',
        placeholder: element.getAttribute('placeholder') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        value: element.value || '',
        visible: visible(element),
      }))
      .filter(item => item.visible)
      .slice(0, 20);
  });
}

function emailInputCandidates(page) {
  return [
    page.getByLabel(/email/i).first(),
    page.locator('input[type="email"]').first(),
    page.locator('input[name*="email" i]').first(),
    page.locator('input[id*="email" i]').first(),
    page.locator('input[autocomplete="email"]').first(),
    page.locator('input[placeholder*="email" i]').first(),
  ];
}

async function hasVisibleEmailInput(page, timeoutMs = 500) {
  for (const locator of emailInputCandidates(page)) {
    try {
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    } catch (_) {}
  }

  return false;
}

async function fillEmail(page, email) {
  const expected = String(email || '').trim();

  for (const locator of emailInputCandidates(page)) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await locator.click({ timeout: 10000 });
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await locator.fill(expected, { timeout: 10000 });
        const actual = await locator.inputValue({ timeout: 3000 }).catch(() => '');
        if (actual.trim() === expected) return { success: true, value: actual, attempt };
        await page.waitForTimeout(500);
      }
      const actual = await locator.inputValue({ timeout: 3000 }).catch(() => '');
      return { success: false, error: 'email value mismatch after fill', value: actual };
    } catch (_) {}
  }

  return { success: false, error: 'email input not found' };
}

async function fillPassword(page, password) {
  const candidates = [
    page.getByLabel(/password/i).first(),
    page.locator('input[type="password"]').first(),
    page.locator('input[name*="password" i]').first(),
    page.locator('input[id*="password" i]').first(),
    page.locator('input[autocomplete="current-password"]').first(),
    page.locator('input[placeholder*="password" i]').first(),
  ];

  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 5000 });
      await locator.fill(password, { timeout: 10000 });
      return { success: true };
    } catch (_) {}
  }

  return { success: false, error: 'password input not found', url: page.url() };
}

async function inspectMfaChoices(page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    return Array.from(document.querySelectorAll('.selection-choices .field.radio'))
      .map((field, index) => {
        const input = field.querySelector('input[type="radio"]');
        const label = input && input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : field.querySelector('label');
        const sr = input && input.getAttribute('aria-labelledby') ? document.getElementById(input.getAttribute('aria-labelledby')) : null;

        return {
          index,
          id: input ? input.id : '',
          name: input ? input.name : '',
          value: input ? input.value : '',
          checked: input ? input.checked : false,
          label: label ? label.textContent.trim() : '',
          description: sr ? sr.textContent.trim() : '',
          visible: visible(field),
        };
      })
      .filter(item => item.visible || item.checked);
  });
}

async function saveMfaChoices(choices) {
  if (!choices.length) return;

  const outputPath = path.resolve(process.cwd(), 'idme-mfa-choices.json');
  await fs.writeFile(outputPath, JSON.stringify({ recordedAt: new Date().toISOString(), choices }, null, 2));
}

async function clickContinue(page) {
  const candidates = [
    page.locator('input[type="submit"][name="commit"][value="Continue"]').first(),
    page.locator('input[type="submit"][value="Continue"]').first(),
    page.getByRole('button', { name: /^Continue$/i }).first(),
    page.getByText(/^Continue$/i).first(),
  ];

  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      const beforeUrl = page.url();
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
        locator.click({ timeout: 10000 }),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      return { success: true, beforeUrl, afterUrl: page.url() };
    } catch (_) {}
  }

  return { success: false, error: 'Continue submit not found', url: page.url() };
}

async function clickSignIn(page) {
  const candidates = [
    page.getByRole('button', { name: /^Sign in$/i }).first(),
    page.locator('button:has-text("Sign in")').first(),
    page.locator('a:has-text("Sign in")').first(),
    page.getByText(/^Sign in$/i).first(),
  ];

  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 8000 });
      const beforeUrl = page.url();
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
        locator.click({ timeout: 10000 }),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      return { success: true, beforeUrl, afterUrl: page.url() };
    } catch (_) {}
  }

  return { success: false, error: 'Sign in button not found', url: page.url() };
}

async function waitForLoginReady(page, timeoutMs = 120000, browserBlockedTracker = createBrowserBlockedTracker(3)) {
  const startedAt = Date.now();
  let tryAgainClicks = 0;
  let lastLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const title = await page.title().catch(() => '');
    const url = page.url();
    const hasEmail = await hasVisibleEmailInput(page, 500);

    if (hasEmail) {
      return {
        success: true,
        reason: 'email input visible',
        title,
        url,
        waitedMs: Date.now() - startedAt,
        tryAgainClicks,
      };
    }

    const tryAgainResult = await clickTryAgainIfPresent(page);
    if (tryAgainResult.success) {
      tryAgainClicks += 1;
      console.log(`[IDme] Try again while waiting login ready: ${JSON.stringify(tryAgainResult)}`);
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      continue;
    }

    const waitingTitle = /^(just a moment|please wait)/i.test(title.trim());
    const waitingUrl = /\/oauth\/authorize|qitrt=Safetynet/i.test(url);
    const blockedUrl = /\/message\/browser_blocked/i.test(url);
    if (blockedUrl) await checkBrowserBlocked(page, browserBlockedTracker, 'waitForLoginReady');
    const now = Date.now();

    if (now - lastLogAt > 5000) {
      console.log(`[IDme] waiting for login ready: title=${title || '(empty title)'} url=${url} waitingTitle=${waitingTitle} waitingUrl=${waitingUrl} browserBlocked=${blockedUrl}`);
      lastLogAt = now;
    }

    await page.waitForTimeout(blockedUrl ? 2000 : 3000);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  const title = await page.title().catch(() => '');
  const url = page.url();
  const visibleInputs = await inspectEmailInputs(page).catch(error => [{ error: error.message }]);
  return {
    success: false,
    reason: 'timeout waiting for email input or Try again',
    title,
    url,
    waitedMs: Date.now() - startedAt,
    tryAgainClicks,
    visibleInputs,
  };
}

async function clickTryAgainIfPresent(page) {
  const candidates = [
    page.locator('a.cta-link[href*="/session/new"]:has-text("Try again")').first(),
    page.locator('a[href*="/session/new"]:has-text("Try again")').first(),
    page.getByRole('link', { name: /^Try again$/i }).first(),
  ];

  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 2500 });
      const beforeUrl = page.url();
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
        locator.click({ timeout: 10000 }),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      return { success: true, beforeUrl, afterUrl: page.url() };
    } catch (_) {}
  }

  return { success: false, url: page.url() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browserBlockedTracker = createBrowserBlockedTracker(args.browserBlockedLimit);
  const { context, page, profileDir, extensionDir } = await launchCloakBrowser(args);

  console.log(`[IDme] profile: ${profileDir}`);
  console.log(`[IDme] opening: ${args.clickSignInFirst ? (args.entryUrl || 'https://www.id.me/') : args.url}`);
  console.log(`[IDme] target login url: ${args.url}`);
  console.log(`[IDme] proxy: ${args.proxy ? args.proxy.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : 'disabled'}`);
  console.log(`[IDme] user agent: ${args.userAgent || 'cloak default'}`);
  console.log(`[IDme] extension: ${args.disableExtension ? 'disabled' : extensionDir}`);
  console.log(`[IDme] browser_blocked limit: ${browserBlockedTracker.limit}`);

  if (args.clickSignInFirst) {
    const entryUrl = args.entryUrl || 'https://www.id.me/';
    await gotoWithRetry(page, entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }, 'entry goto', 20);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    console.log(`[IDme] entry title: ${await page.title().catch(() => '')}`);
    console.log(`[IDme] entry url: ${page.url()}`);
    let signInResult = await clickSignIn(page);
    console.log(`[IDme] click Sign in: ${JSON.stringify(signInResult)}`);
    if (!signInResult.success) {
      console.log('[IDme] Sign in not found, refreshing entry page and retrying');
      await gotoWithRetry(page, page.url(), { waitUntil: 'domcontentloaded', timeout: 60000 }, 'entry reload', 20);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      console.log(`[IDme] refreshed title: ${await page.title().catch(() => '')}`);
      console.log(`[IDme] refreshed url: ${page.url()}`);
      signInResult = await clickSignIn(page);
      console.log(`[IDme] retry click Sign in: ${JSON.stringify(signInResult)}`);
    }
    const loginReadyResult = await waitForLoginReady(page, 120000, browserBlockedTracker);
    console.log(`[IDme] login ready wait: ${JSON.stringify(loginReadyResult)}`);
  } else {
    await gotoWithRetry(page, args.url, { waitUntil: 'domcontentloaded', timeout: 60000 }, 'direct login goto', 20);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await checkBrowserBlocked(page, browserBlockedTracker, 'direct login goto');
    const loginReadyResult = await waitForLoginReady(page, 120000, browserBlockedTracker);
    console.log(`[IDme] login ready wait: ${JSON.stringify(loginReadyResult)}`);
  }

  console.log(`[IDme] title: ${await page.title().catch(() => '')}`);
  console.log(`[IDme] url: ${page.url()}`);

  const emailInputs = await inspectEmailInputs(page).catch(error => [{ error: error.message }]);
  console.log(`[IDme] visible inputs: ${JSON.stringify(emailInputs)}`);

  if (args.email) {
    const emailResult = await fillEmail(page, args.email);
    console.log(`[IDme] fill email: ${JSON.stringify(emailResult)}`);
    const emailInputsAfterFill = await inspectEmailInputs(page).catch(error => [{ error: error.message }]);
    console.log(`[IDme] visible inputs after email fill: ${JSON.stringify(emailInputsAfterFill)}`);
    if (!emailResult.success) throw new Error(`Email fill failed: ${emailResult.error || 'unknown'}`);
    let continueResult = await clickContinue(page);
    let emailContinueAttempt = 1;
    while (true) {
      const label = emailContinueAttempt === 1 ? 'email Continue' : `retry email Continue ${emailContinueAttempt - 1}`;
      console.log(`[IDme] click Continue after ${label}: ${JSON.stringify(continueResult)}`);
      console.log(`[IDme] title after ${label}: ${await page.title().catch(() => '')}`);
      console.log(`[IDme] url after ${label}: ${page.url()}`);

      const blockedAfterEmail = /\/message\/browser_blocked/i.test(continueResult.afterUrl || continueResult.url || page.url());
      if (!blockedAfterEmail) {
        await checkBrowserBlocked(page, browserBlockedTracker, `after ${label}`);
        break;
      }

      await checkBrowserBlocked(page, browserBlockedTracker, `after ${label}`);
      const tryAgainResult = await clickTryAgainIfPresent(page);
      console.log(`[IDme] Try again after ${label}: ${JSON.stringify(tryAgainResult)}`);
      const retryReadyResult = await waitForLoginReady(page, 120000, browserBlockedTracker);
      console.log(`[IDme] retry login ready wait after ${label}: ${JSON.stringify(retryReadyResult)}`);
      const retryEmailResult = await fillEmail(page, args.email);
      console.log(`[IDme] retry fill email after ${label}: ${JSON.stringify(retryEmailResult)}`);
      if (!retryEmailResult.success) throw new Error(`Retry email fill failed: ${retryEmailResult.error || 'unknown'}`);
      continueResult = await clickContinue(page);
      emailContinueAttempt += 1;
    }
  }

  if (args.password) {
    const passwordInputsBeforeFill = await inspectEmailInputs(page).catch(error => [{ error: error.message }]);
    console.log(`[IDme] visible inputs before password fill: ${JSON.stringify(passwordInputsBeforeFill)}`);
    const passwordResult = await fillPassword(page, args.password);
    console.log(`[IDme] fill password: ${JSON.stringify(passwordResult)}`);
    const passwordInputsAfterFill = await inspectEmailInputs(page).catch(error => [{ error: error.message }]);
    console.log(`[IDme] visible inputs after password fill: ${JSON.stringify(passwordInputsAfterFill)}`);
    const continueResult = await clickContinue(page);
    console.log(`[IDme] click Continue after password: ${JSON.stringify(continueResult)}`);
    console.log(`[IDme] title after password Continue: ${await page.title().catch(() => '')}`);
    console.log(`[IDme] url after password Continue: ${page.url()}`);
    await checkBrowserBlocked(page, browserBlockedTracker, 'after password Continue');

    if (/https:\/\/api\.id\.me\/en\/session(?:\/authentication_options)?\b/.test(page.url())) {
      console.log('[IDme] password rejected: session page after password Continue');
      if (args.clickSignInFirst) {
        await gotoWithRetry(page, args.entryUrl || 'https://www.id.me/', { waitUntil: 'domcontentloaded', timeout: 60000 }, 'return entry after password rejected', 5).catch(error => {
          console.log(`[IDme] return entry after password rejected failed: ${error.message}`);
        });
      }
      if (args.headless || args.exitAfterRun) {
        await context.close();
        return;
      }
    }
  }
 
  const mfaChoices = await inspectMfaChoices(page).catch(error => [{ error: error.message }]);
  console.log(`[IDme] MFA choices: ${JSON.stringify(mfaChoices)}`);
  await saveMfaChoices(mfaChoices.filter(choice => !choice.error)).catch(error => {
    console.log(`[IDme] save MFA choices failed: ${error.message}`);
  });

  if (args.slow > 0) await sleep(args.slow);

  if (args.headless || args.exitAfterRun) {
    await context.close();
    return;
  }

  console.log('[IDme] headed mode is running. Press Ctrl+C in this terminal to stop.');
  await new Promise(() => {});
}

if (require.main === module) {
  main().catch(error => {
    const message = error && error.stack ? error.stack : String(error);
    if (/BROWSER_BLOCKED_LIMIT_REACHED/i.test(message)) {
      console.error('[IDme] browser_blocked_limit_reached:', message);
      process.exit(12);
    }
    console.error('[IDme] failed:', message);
    process.exit(1);
  });
}

module.exports = {
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
};
