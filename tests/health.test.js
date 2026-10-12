/* Health Connect, installed: connecting asks for steps, sleep and weight;
   the steps habit fills with each day's steps, the sleep habit ticks for a
   night long enough, a scale's weigh-in fills a day with no weight logged
   (never one logged by hand), and a weight logged here is written back. */
const { readState, PHONE } = require('./lib/harness');
const { build, dk } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const day = (back, h = 12) => { const d = new Date(); d.setDate(d.getDate() - back); d.setHours(h, 0, 0, 0); return d; };
  const seed = build();
  delete seed.habitLog[dk(day(1))].h_steps;
  delete seed.habitLog[dk(day(2))].h_sleep;
  // the seed's weights cover the last week; the scale has one on a day without
  seed.nutrition.weights = seed.nutrition.weights.filter((w) => w.date !== dk(day(3)));
  const p = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p.errors = [];
  p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p.errors.push(String(e)); });
  await p.addInitScript(([s, d]) => {
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__hc = { asked: null, saved: [] };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Health: {
          isAvailable: async () => ({ available: true, platform: 'android' }),
          requestAuthorization: async (o) => { window.__hc.asked = o; return { readAuthorized: o.read, readDenied: [], writeAuthorized: o.write, writeDenied: [] }; },
          queryAggregated: async () => ({ samples: [
            { startDate: d.d1, endDate: d.d1e, value: 12345, values: { sum: 12345 }, unit: 'count' },
          ] }),
          readSamples: async (o) => ({ samples: o.dataType === 'sleep'
            ? [{ dataType: 'sleep', value: 410, unit: 'minute', startDate: d.n0, endDate: d.n1, sleepState: 'asleep' },
               { dataType: 'sleep', value: 30, unit: 'minute', startDate: d.n1, endDate: d.n2, sleepState: 'awake' },
               { dataType: 'sleep', value: 80, unit: 'minute', startDate: d.n2, endDate: d.n3, sleepState: 'asleep' }]
            : [{ dataType: 'weight', value: 79.05, unit: 'kilogram', startDate: d.w3, endDate: d.w3 },
               { dataType: 'weight', value: 70, unit: 'kilogram', startDate: d.w0, endDate: d.w0 }] }),
          saveSample: async (o) => { window.__hc.saved.push(o); },
          openHealthConnectSettings: async () => {},
        },
        LocalNotifications: { createChannel: async () => {}, checkPermissions: async () => ({ display: 'denied' }) },
        App: { addListener: () => {} },
      },
    };
  }, [seed, {
    d1: day(1, 0).toISOString(), d1e: day(0, 0).toISOString(),
    // the night before two days ago: 23:00 → 06:50 asleep, 30 min awake, 07:20 → 08:40 asleep = 8 h 10 min
    n0: day(3, 23).toISOString(), n1: new Date(day(2, 6).getTime() + 50 * 60000).toISOString(),
    n2: new Date(day(2, 7).getTime() + 20 * 60000).toISOString(), n3: new Date(day(2, 8).getTime() + 40 * 60000).toISOString(),
    w3: day(3, 7).toISOString(), w0: day(0, 7).toISOString(),
  }]);
  await p.goto(server.url);
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('#homeAvatar').click());
  await p.waitForTimeout(400);
  await p.click('#profileSettings');
  await p.waitForTimeout(500);
  await p.click('#healthBtn');
  await p.waitForTimeout(700);
  t.equal('steps are offered to the steps habit', await p.inputValue('#hcSteps'), 'h_steps');
  t.equal('sleep to the sleep habit', await p.inputValue('#hcSleep'), 'h_sleep');
  await p.click('#hcGo');
  await p.waitForTimeout(1200);
  const asked = await p.evaluate(() => window.__hc.asked);
  t.equal('it asks to read steps, sleep and weight', asked && asked.read.join(','), 'steps,sleep,weight');
  const st = await readState(p);
  t.equal('yesterday\'s steps fill the steps habit', st.habitLog[dk(day(1))].h_steps, 12345);
  t.equal('a night of 8 h 10 min ticks "Sleep 8h" on the morning it ended', st.habitLog[dk(day(2))].h_sleep, 1);
  const w3 = st.nutrition.weights.find((w) => w.date === dk(day(3)));
  t.check('the scale fills a day with no weight', w3 && w3.value === 79.05 && w3.hc === 1, JSON.stringify(w3));
  const w0 = st.nutrition.weights.find((w) => w.date === dk(day(0)));
  t.equal('but never one logged by hand', w0.value, 78.3);
  t.check('it says what it read', st.settings.health.on && st.settings.health.lastNote.steps === 1);

  // a weight logged here is written back
  await p.evaluate(() => {
    document.querySelector('.tab[data-tab="home"]').click();
  });
  await p.waitForTimeout(400);
  await p.click('#bwCard');
  await p.waitForTimeout(500);
  const input = await p.$('#sheetRoot input[type="number"]');
  await input.fill('78.1');
  await p.evaluate(() => [...document.querySelectorAll('#sheetRoot button')].find((b) => /Save|Log/i.test(b.textContent)).click());
  await p.waitForTimeout(500);
  const saved = await p.evaluate(() => window.__hc.saved);
  t.check('a weight logged here goes to Health Connect', saved.length === 1 && saved[0].dataType === 'weight' && saved[0].value === 78.1, JSON.stringify(saved));
  t.equal('no page errors', p.errors.length, 0, p.errors.join(' | '));
  await p.close();
  await server.close();
};
