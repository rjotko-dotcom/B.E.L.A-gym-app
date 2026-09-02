/* The mark shown when the app is opened. It has to be on screen at the first
   paint, fully drawn and motionless, it has to get out of the way on its own,
   and it must not come back every time the page reloads — "opened" means
   opened, not refreshed. */
const { openApp } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();

  const page = await openApp(t.browser, { url: server.url, seed, splash: true });

  // openApp has already waited 450ms, so the mark is mid-play here
  const early = await page.evaluate(() => {
    const el = document.getElementById('splash');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const mark = el.querySelector('.splash-mark');
    return {
      covers: r.width >= window.innerWidth && r.height >= window.innerHeight,
      black: cs.backgroundColor,
      visible: cs.visibility === 'visible' && Number(cs.opacity) > 0,
      overEverything: Number(cs.zIndex) >= 100,
      paths: el.querySelectorAll('path').length,
      markWide: mark ? Math.round(mark.getBoundingClientRect().width) : 0,
      pathsSolid: [...el.querySelectorAll('path')].every((p) => Number(getComputedStyle(p).opacity) === 1),
      pathsStill: [...el.querySelectorAll('path')].every((p) => getComputedStyle(p).animationName === 'none'),
      markStill: mark ? getComputedStyle(mark).animationName === 'none' : false,
    };
  });
  t.check('the mark is up while the app opens', !!early);
  t.check('it is fully drawn from the start', early && early.pathsSolid, JSON.stringify(early));
  t.check('and nothing about it is animated', early && early.markStill && early.pathsStill,
    JSON.stringify(early));
  t.check('it covers the screen', early && early.covers);
  t.check('on black', early && /rgb\(0, 0, 0\)/.test(early.black));
  t.check('above everything else', early && early.overEverything);
  t.equal('both halves of the mark are drawn', early && early.paths, 2);
  t.check('the mark is a sensible size', early && early.markWide > 100 && early.markWide < 200,
    'width ' + (early && early.markWide));

  await page.waitForTimeout(1400);
  const gone = await page.evaluate(() => !document.getElementById('splash'));
  t.check('it takes itself away', gone);

  // and the app underneath is usable, not left behind a dead overlay
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(250);
  t.check('the app underneath still works',
    await page.locator('#view').innerText().then((x) => /Calories|kcal/i.test(x)));

  // a reload is not a fresh open
  await page.reload();
  await page.waitForTimeout(120);
  t.check('a reload does not replay it',
    await page.evaluate(() => !document.getElementById('splash')));
  await page.close();

  // a tap says "get on with it"
  const p2 = await openApp(t.browser, { url: server.url, seed, splash: true });
  await p2.evaluate(() => document.getElementById('splash')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await p2.waitForTimeout(320);
  t.check('a tap skips it', await p2.evaluate(() => !document.getElementById('splash')));
  t.equal('no page errors', p2.errors.length, 0, p2.errors.join(' | '));
  await p2.close();

  // a fresh session gets it again
  const p3 = await openApp(t.browser, { url: server.url, seed, splash: true });
  t.check('opening it again plays it again',
    await p3.evaluate(() => !!document.getElementById('splash')));
  await p3.close();

  /* Installed, Android draws its own launch screen from the same logo. The
     page must not draw a second one — that was the jump: two copies at two
     sizes, one replacing the other. */
  const asSystem = async (setup) => {
    const p4 = await t.browser.newPage({ viewport: { width: 384, height: 832 }, colorScheme: 'dark', deviceScaleFactor: 2 });
    p4.errors = [];
    p4.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p4.errors.push(String(e)); });
    await p4.addInitScript(setup, seed);
    await p4.goto(server.url);
    return p4;
  };

  const native = await asSystem((s) => {
    localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  });
  t.check('the installed app draws no mark of its own',
    await native.evaluate(() => !document.getElementById('splash')));
  t.check('and goes straight to the app', await native.locator('#view').innerText().then((x) => /kcal|Good/i.test(x)));
  t.equal('no page errors', native.errors.length, 0, native.errors.join(' | '));
  await native.close();

  // a home-screen shortcut gets a launch screen from Android too
  const pinned = await asSystem((s) => {
    localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    localStorage.setItem('bela-update-check', String(Date.now()));
    matchMedia = ((real) => (q) => (/display-mode: standalone/.test(q)
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : real(q)))(matchMedia.bind(window));
  });
  t.check('a pinned shortcut draws no mark either',
    await pinned.evaluate(() => !document.getElementById('splash')));
  await pinned.close();

  // but a plain browser tab, where nothing came before, still shows it
  const tab = await asSystem((s) => {
    localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    localStorage.setItem('bela-update-check', String(Date.now()));
  });
  t.check('a browser tab still gets the mark',
    await tab.evaluate(() => !!document.getElementById('splash')));
  await tab.close();

  await server.close();
};
