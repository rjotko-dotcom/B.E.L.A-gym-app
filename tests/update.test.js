/* The service worker. Updates silently failed once already: the worker
   re-cached the previous deploy because it fetched through the HTTP cache.
   This deploys a new version over a running app and checks it lands. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { serve, openApp, ROOT } = require('./lib/harness');

function copyApp(to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(ROOT, f), path.join(to, f));
  for (const dir of ['js', 'css', 'icons']) {
    fs.mkdirSync(path.join(to, dir), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      const src = path.join(ROOT, dir, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(to, dir, f));
    }
  }
}

module.exports = async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bela-deploy-'));
  copyApp(dir);
  // served with a long max-age, exactly like GitHub Pages
  const server = await serve({ root: dir, cacheSeconds: 600 });
  const page = await openApp(t.browser, { url: server.url, viewport: { width: 412, height: 915 } });
  await page.waitForTimeout(1200);

  t.check('the service worker takes control', await page.evaluate(() => !!navigator.serviceWorker.controller));

  // every page must scroll — body was once turned into a dead scroll container
  for (const tab of ['workout', 'meals']) {
    await page.click('.tab[data-tab="' + tab + '"]');
    await page.waitForTimeout(400);
    const scrolls = await page.evaluate(() => {
      const el = document.scrollingElement;
      const before = el.scrollTop;
      el.scrollTop = 400;
      const moved = el.scrollTop > before;
      el.scrollTop = 0;
      return { moved, tall: document.documentElement.scrollHeight > window.innerHeight + 1 };
    });
    t.check(tab + ' scrolls when the content is taller than the screen', !scrolls.tall || scrolls.moved);
  }

  // publish a new build over the running one
  const current = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(/VERSION = '([\d.]+)'/)[1];
  const next = current + '1';
  for (const f of ['sw.js', 'index.html', 'js/app.js', 'css/style.css']) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split(current).join(next));
  }
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await page.waitForTimeout(2500);

  t.check('an update offer appears', await page.evaluate(() => !!document.querySelector('.update-toast')));
  const caches = await page.evaluate(() => caches.keys());
  t.check('the cache rotates to the new version', caches.some((c) => c.endsWith(next)), caches.join(','));

  await page.click('.update-toast');
  await page.waitForTimeout(1800);
  const served = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="app.js"]').getAttribute('src');
    const text = await (await fetch(src)).text();
    return (text.match(/APP_VERSION = '([\d.]+)'/) || [])[1];
  });
  t.equal('the new build is actually served after restarting', served, next);

  await page.close();
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
};
