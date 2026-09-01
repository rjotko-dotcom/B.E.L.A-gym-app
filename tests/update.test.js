/* The service worker. Updates silently failed once already: the worker
   re-cached the previous deploy because it fetched through the HTTP cache.
   This deploys a new version over a running app and checks it lands. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { serve, openApp, ROOT } = require('./lib/harness');
const { build } = require('./lib/seed');

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

  // a fresh install opens setup over everything; this suite is about updates
  if (await page.evaluate(() => !!document.querySelector('#suSkip'))) {
    await page.click('#suSkip');
    await page.waitForTimeout(400);
  }

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

  /* --- the installed app has no service worker, so it asks GitHub --- */
  {
    const plain = await serve({ serviceWorker: false });

    /* Pretend to be the APK, and answer for GitHub. Nothing here reaches the
       network: the release the app is told about is whatever we hand back. */
    const asNative = async (tag) => {
      const page = await openApp(t.browser, { url: plain.url, seed: build() });
      await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      await page.evaluate((t) => {
        window.Capacitor = { isNativePlatform: () => true };
        window.fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: t,
            html_url: 'https://example.invalid/releases/' + t,
            assets: [{ name: 'bela-' + t.replace(/^v/, '') + '.apk',
                       browser_download_url: 'https://example.invalid/bela.apk' }],
          }),
        });
      }, tag);
      await page.click('#homeAvatar');
      await page.waitForTimeout(400);
      await (await page.$('.icon-btn[aria-label*="ettings"]')).click();
      await page.waitForTimeout(450);
      return page;
    };

    const here = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')
      .match(/APP_VERSION = '([\d.]+)'/)[1];

    let page = await asNative('v99.9.9');
    t.equal('the installed app offers to check rather than to clear a cache',
      await page.evaluate(() => document.querySelector('#forceUpdate').textContent.trim()),
      'Check for updates');
    await page.click('#forceUpdate');
    await page.waitForTimeout(900);
    const offer = await page.evaluate(() => document.querySelector('.toast')?.textContent || '');
    t.check('a newer release is announced', /99\.9\.9/.test(offer), offer);
    t.check('and it offers to fetch it', /Get it/.test(offer), offer);
    await page.close();

    page = await asNative('v' + here);
    await page.click('#forceUpdate');
    await page.waitForTimeout(900);
    t.check('the current version is reported as current',
      /newest version/.test(await page.evaluate(() => document.querySelector('.toast')?.textContent || '')));
    await page.close();

    // an older tag must never be offered as an update
    page = await asNative('v0.1.0');
    await page.click('#forceUpdate');
    await page.waitForTimeout(900);
    t.check('an older release is not offered',
      !/Get it/.test(await page.evaluate(() => document.querySelector('.toast')?.textContent || '')));
    await page.close();

    // GitHub unreachable: say so, do not fail silently or throw
    const off = await openApp(t.browser, { url: plain.url, seed: build() });
    await off.evaluate(() => {
      window.Capacitor = { isNativePlatform: () => true };
      window.fetch = async () => { throw new Error('offline'); };
    });
    await off.click('#homeAvatar');
    await off.waitForTimeout(400);
    await (await off.$('.icon-btn[aria-label*="ettings"]')).click();
    await off.waitForTimeout(450);
    await off.click('#forceUpdate');
    await off.waitForTimeout(900);
    t.check('being offline is reported, not swallowed',
      /Could not reach/.test(await off.evaluate(() => document.querySelector('.toast')?.textContent || '')));
    t.equal('no page errors', off.errors.length, 0, off.errors.join(' | '));
    await off.close();

    // the website keeps the cache-clearing button it has always had
    const web = await openApp(t.browser, { url: plain.url, seed: build() });
    await web.click('#homeAvatar');
    await web.waitForTimeout(400);
    await (await web.$('.icon-btn[aria-label*="ettings"]')).click();
    await web.waitForTimeout(450);
    t.equal('the website still forces a reload instead',
      await web.evaluate(() => document.querySelector('#forceUpdate').textContent.trim()),
      'Force update now');
    await web.close();

    await plain.close();
  }
};
