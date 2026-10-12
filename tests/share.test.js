/* A session as a picture: 1080 × 1350, offered from the closing page and
   from history; through Android's share sheet when installed, a download
   in a browser that cannot share files. */
const { openApp, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });

  const size = await page.evaluate(async () => {
    const url = await window.__belaCard(0);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    return img.width + '×' + img.height;
  });
  t.equal('the card is 1080 × 1350', size, '1080×1350');

  // from history, in a browser: a download
  await page.evaluate(() => document.querySelector('#homeAvatar').click());
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('#progSeg [data-seg="history"]').click());
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.hist-item').click());
  await page.waitForTimeout(500);
  t.check('history offers to share a session', await page.evaluate(() => !!document.querySelector('[data-share]')));
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.evaluate(() => document.querySelector('[data-share]').click()),
  ]);
  t.check('a browser that cannot share gets the picture as a download', !!dl && /^bela-\d{4}-\d\d-\d\d\.png$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  // installed: written to the cache and handed to the share sheet
  const p2 = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p2.errors = [];
  p2.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p2.errors.push(String(e)); });
  await p2.addInitScript((s) => {
    localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__shared = null; window.__written = null;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Filesystem: { writeFile: async (o) => { window.__written = { path: o.path, dir: o.directory, bytes: o.data.length }; return { uri: 'file:///cache/' + o.path }; } },
        Share: { share: async (o) => { window.__shared = o; return {}; } },
        LocalNotifications: { createChannel: async () => {}, checkPermissions: async () => ({ display: 'denied' }) },
        App: { addListener: () => {} },
      },
    };
  }, build());
  await p2.goto(server.url);
  await p2.waitForTimeout(500);
  await p2.click('#homeStart');
  await p2.waitForTimeout(700);
  await p2.click('.ex-block .set-done');
  await p2.waitForTimeout(300);
  await p2.click('#wkFinishTop');
  await p2.waitForTimeout(450);
  await p2.click('#confirmFinish');
  await p2.waitForTimeout(800);
  await p2.click('#smShare');
  await p2.waitForTimeout(1500);
  const w = await p2.evaluate(() => window.__written);
  const sh = await p2.evaluate(() => window.__shared);
  t.check('installed: the picture is written to the cache', w && w.dir === 'CACHE' && w.bytes > 20000, JSON.stringify(w));
  t.check('installed: and handed to the share sheet', sh && sh.files && /bela-.*\.png$/.test(sh.files[0]), JSON.stringify(sh));
  t.equal('installed: no page errors', p2.errors.length, 0, p2.errors.join(' | '));
  await p2.close();
  await server.close();
};
