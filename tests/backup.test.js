/* The weekly backup file on the installed app: written on opening when a
   week has passed, into Documents/BELA, the newest eight kept, not again for
   a week, never when switched off. And a PC sync counts as a backup. */
const { openApp, readState, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

async function installed(t, url, seed, files) {
  const p = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p.errors = [];
  p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p.errors.push(String(e)); });
  await p.addInitScript(([s, existing]) => {
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__fs = { written: [], deleted: [], files: existing.slice() };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Filesystem: {
          writeFile: async (o) => { window.__fs.written.push(o); window.__fs.files.push(o.path.split('/').pop()); return { uri: 'file:///' + o.path }; },
          readdir: async () => ({ files: window.__fs.files.map((name) => ({ name })) }),
          deleteFile: async (o) => { window.__fs.deleted.push(o.path); },
        },
        LocalNotifications: { createChannel: async () => {}, checkPermissions: async () => ({ display: 'denied' }) },
        App: { addListener: () => {} },
      },
    };
  }, [seed, files]);
  await p.goto(url);
  await p.waitForTimeout(3300);
  return p;
}

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const old = Array.from({ length: 9 }, (_, i) => 'bela-backup-2026-0' + (1 + (i % 9)) + '-0' + (1 + i) + '.json');
  const p = await installed(t, server.url, build(), old);
  const fs = await p.evaluate(() => window.__fs);
  const w = fs.written[0];
  t.check('opening the app writes the week\'s backup', !!w && /^BELA\/bela-backup-\d{4}-\d\d-\d\d\.json$/.test(w.path), JSON.stringify(w && w.path));
  t.equal('into Documents', w && w.directory, 'DOCUMENTS');
  t.check('holding the whole app', w && JSON.parse(w.data).workouts.length === 6);
  t.equal('only the newest eight are kept', fs.deleted.length, 2);
  const st = await readState(p);
  t.check('and when it was made is kept', Date.now() - st.settings.lastAutoBackup < 60000);

  await p.reload();
  await p.waitForTimeout(3300);
  t.equal('not again within the week', (await p.evaluate(() => window.__fs.written.length)), 0);

  // switched off
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('bela-gym-v1'));
    s.settings.autoBackup = false; s.settings.lastAutoBackup = 0;
    localStorage.setItem('bela-gym-v1', JSON.stringify(s));
  });
  await p.reload();
  await p.waitForTimeout(3300);
  t.equal('switched off, nothing is written', (await p.evaluate(() => window.__fs.written.length)), 0);
  t.equal('no page errors', p.errors.length, 0, p.errors.join(' | '));
  await p.close();

  // the monthly nudge: an old export, but a PC sync this week
  const seed = build();
  seed.workouts = seed.workouts.concat(seed.workouts.map((x) => ({ ...x, id: x.id + 'b' })));
  seed.settings.lastExport = Date.now() - 60 * 864e5;
  const web = await openApp(t.browser, { url: server.url, seed });
  await web.evaluate(() => document.querySelector('#homeAvatar').click());
  await web.waitForTimeout(500);
  t.check('a backup two months old is nudged about', await web.evaluate(() => !!document.querySelector('#backupNudge')));
  await web.evaluate(() => localStorage.setItem('bela-sync-pc', JSON.stringify({ host: '192.168.1.20:8765', code: '1', last: Date.now() - 864e5 })));
  await web.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await web.waitForTimeout(300);
  await web.evaluate(() => document.querySelector('#homeAvatar').click());
  await web.waitForTimeout(500);
  t.check('a PC sync yesterday counts as a backup', await web.evaluate(() => !document.querySelector('#backupNudge')));
  await web.close();
  await server.close();
};
