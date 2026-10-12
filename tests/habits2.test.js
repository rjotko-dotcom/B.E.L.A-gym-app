/* Habits that forgive and remind: one miss a week does not break a streak,
   a second does, and a reminder is booked for the days a habit is due —
   but not today once it is done. */
const { openApp, readState, PHONE } = require('./lib/harness');
const { build, dk } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const day = (back) => { const d = new Date(); d.setDate(d.getDate() - back); return dk(d); };
  // a daily habit done every day for 20 days except one, and today
  const seed = build();
  seed.habits.push({ id: 'h_med', name: 'Meditate', icon: 'check', type: 'check', target: 1 });
  for (let i = 0; i <= 20; i++) { seed.habitLog[day(i)] = seed.habitLog[day(i)] || {}; if (i !== 9) seed.habitLog[day(i)].h_med = 1; }
  const page = await openApp(t.browser, { url: server.url, seed });
  const streak = () => page.evaluate(() => {
    document.querySelector('.tab[data-tab="habits"]').click();
    return new Promise((r) => setTimeout(() => {
      const row = document.querySelector('.hb-row[data-habit="h_med"]');
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      setTimeout(() => r(document.querySelector('#sheetRoot .hd-stats b')?.textContent || ''), 400);
    }, 400));
  });
  t.equal('one miss does not break the streak', await streak(), '20days');
  t.check('and the habit says which day was saved', /Streak protection kept it going/.test(await page.textContent('#sheetRoot')));
  t.check('the saved day is ringed', await page.evaluate(() => !!document.querySelector('#sheetRoot .hd-cell.is-saved')));
  await page.evaluate(() => document.querySelector('#sheetRoot [data-close]').click());
  await page.waitForTimeout(300);

  // a second miss in the same week breaks it
  await page.evaluate((k) => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d9 = new Date(k + 'T12:00:00');
    // the other days of the missed day's week (Mon–Sun)
    const mon = new Date(d9); mon.setDate(d9.getDate() - ((d9.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (key !== k && st.habitLog[key] && st.habitLog[key].h_med) { delete st.habitLog[key].h_med; break; }
    }
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  }, day(9));
  await page.reload();
  await page.waitForTimeout(600);
  // today back to the first miss is 9 days, then 4 more to the second miss,
  // which is in the same week and so ends it: 13, not 20
  t.equal('two misses in a week do', await streak(), '13days');
  await page.evaluate(() => document.querySelector('#sheetRoot [data-close]').click());

  // switched off, the first miss breaks it
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.settings.streakFreeze = false;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  t.check('without protection the first miss ends it', Number((await streak()).replace(/\D/g, '')) <= 9, await streak());
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  /* ---- reminders, installed ---- */
  const p2 = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p2.errors = [];
  p2.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p2.errors.push(String(e)); });
  const s2 = build();
  // Read is done today in the seed only if i % 2 === 0 for day 0 — make it explicit: not done
  delete s2.habitLog[day(0)].h_read;
  await p2.addInitScript((s) => {
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__LN = { scheduled: [], cancelled: 0, channels: [] };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LocalNotifications: {
          createChannel: async (c) => { window.__LN.channels.push(c.id); },
          checkPermissions: async () => ({ display: 'granted' }),
          requestPermissions: async () => ({ display: 'granted' }),
          schedule: async ({ notifications }) => { window.__LN.scheduled = notifications; },
          cancel: async ({ notifications }) => { window.__LN.cancelled += notifications.length; },
          getDeliveredNotifications: async () => ({ notifications: [] }),
          removeDeliveredNotifications: async () => {},
        },
        App: { addListener: () => {} },
      },
    };
  }, s2);
  await p2.goto(server.url);
  await p2.waitForTimeout(500);
  t.check('installed: habit reminders have a channel', await p2.evaluate(() => window.__LN.channels.includes('habits')));
  await p2.evaluate(() => document.querySelector('.tab[data-tab="habits"]').click());
  await p2.waitForTimeout(400);
  await p2.evaluate(() => document.querySelector('.hb-row[data-habit="h_read"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  await p2.waitForTimeout(400);
  await p2.click('#hdEdit');
  await p2.waitForTimeout(500);
  await p2.fill('#hbRemind', '23:59');
  await p2.click('#hbSave');
  await p2.waitForTimeout(1200);
  t.equal('the reminder is kept on the habit', (await readState(p2)).habits.find((h) => h.id === 'h_read').remind, '23:59');
  let booked = await p2.evaluate(() => window.__LN.scheduled);
  t.equal('a week of reminders is booked', booked.length, 7);
  t.check('on their own channel, at that time', booked.every((n) => n.channelId === 'habits' && /23:59/.test(new Date(n.schedule.at).toTimeString())));
  // done today: today's reminder is taken back
  await p2.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date();
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    st.habitLog[k].h_read = 25;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await p2.reload();
  await p2.waitForTimeout(1300);
  booked = await p2.evaluate(() => window.__LN.scheduled);
  t.equal('once it is done, today\'s reminder is not booked', booked.length, 6);
  t.equal('installed: no page errors', p2.errors.length, 0, p2.errors.join(' | '));
  await p2.close();
  await server.close();
};
