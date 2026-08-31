/* Shared plumbing for the test suite: a static server that behaves like the
   real host, a browser, and a page with a known starting state. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/* GitHub Pages serves everything with a ten minute max-age; the update tests
   depend on that, so it is the default here too. */
function serve({ root = ROOT, cacheSeconds = 600, serviceWorker = true } = {}) {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    if (!serviceWorker && p === '/sw.js') { res.statusCode = 404; return res.end(''); }
    try {
      res.setHeader('Content-Type', MIME[path.extname(p)] || 'text/plain');
      if (cacheSeconds) res.setHeader('Cache-Control', 'max-age=' + cacheSeconds);
      res.end(fs.readFileSync(path.join(root, p)));
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({
      url: 'http://localhost:' + server.address().port + '/',
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

let chromium = null;
function playwright() {
  if (chromium) return chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright is missing. Run "npm install" first, or set NODE_PATH to a global install.');
  }
  return chromium;
}

// a Galaxy S24+ in CSS pixels — the device this is actually used on
const PHONE = { width: 384, height: 832 };

async function openApp(browser, { url, seed, viewport = PHONE, theme = 'dark', touch = true, splash = false } = {}) {
  const page = await browser.newPage({
    viewport, colorScheme: theme, hasTouch: touch, deviceScaleFactor: 2,
  });
  // The opening mark plays on a cold start and covers the app for a second.
  // Suites that are not about it say they have already been opened; the one
  // that is passes splash: true.
  if (!splash) await page.addInitScript(() => sessionStorage.setItem('bela-opened', '1'));
  page.errors = [];
  page.on('pageerror', (e) => {
    // the service worker is deliberately absent in most suites
    if (!/ServiceWorker/.test(String(e))) page.errors.push(String(e));
  });
  if (seed) {
    await page.addInitScript((s) => {
      if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    }, seed);
  }
  await page.goto(url);
  await page.waitForTimeout(450);
  return page;
}

const readState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('bela-gym-v1')));

module.exports = { serve, playwright, openApp, readState, PHONE, ROOT };
