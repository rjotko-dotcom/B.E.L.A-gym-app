/* The workout screen, Hevy's way: a rest timer per exercise that starts when
   a set is logged and can be nudged or skipped, last time's numbers taken in
   a tap, sets swiped away, the next set marked, the session reordered, and a
   closing page once it is saved. */
const { openApp, readState, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });
  await page.click('#homeStart');
  await page.waitForTimeout(700);

  // ---- the rest timer: off until asked for ----
  t.equal('an exercise\'s rest starts off', (await page.textContent('.ex-block .ex-rest-line b')).trim(), 'Off');
  t.check('the first set is marked as next', await page.evaluate(() =>
    document.querySelector('.ex-block .set-row').classList.contains('is-next')));

  await page.click('.ex-block .ex-rest-line');
  await page.waitForTimeout(450);
  await page.click('#sheetRoot [data-v="90"]');
  await page.waitForTimeout(450);
  t.equal('picking a rest keeps it for the exercise', (await readState(page)).exPrefs['bench-press'].rest, 90);
  t.check('and the card says so', /1 min 30 s/.test(await page.textContent('.ex-block .ex-rest-line')));

  await page.click('.ex-block .set-done');
  await page.waitForTimeout(500);
  const left = async () => page.evaluate(() => {
    const el = document.querySelector('#restLeft');
    if (!el) return null;
    const [m, s] = el.textContent.split(':').map(Number);
    return m * 60 + s;
  });
  const l0 = await left();
  t.check('logging a set starts the rest', l0 != null && l0 > 80 && l0 <= 90, String(l0));
  t.check('the next set moves down a row', await page.evaluate(() =>
    document.querySelectorAll('.ex-block')[0].querySelectorAll('.set-row')[1].classList.contains('is-next')));
  t.check('the panel says what is next', /Set 2 ·/.test(await page.textContent('#restPanel')));

  await page.click('[data-rest="15"]');
  await page.waitForTimeout(300);
  t.check('+15 adds fifteen seconds', (await left()) >= l0 + 13, (await left()) + ' vs ' + l0);
  await page.click('[data-rest="-15"]');
  await page.click('[data-rest="-15"]');
  await page.waitForTimeout(300);
  t.check('−15 takes them off', (await left()) <= l0 - 13, String(await left()));

  // it is a time, not a counter: it survives a reload
  await page.reload();
  await page.waitForTimeout(700);
  t.check('the rest survives a reload', (await left()) > 60, String(await left()));

  await page.click('[data-rest="skip"]');
  await page.waitForTimeout(400);
  t.check('skip ends it', await page.evaluate(() => !document.querySelector('#restPanel')));
  t.check('and nothing is left in the session', !(await readState(page)).activeWorkout.rest);

  // folded away, the mini bar carries the countdown
  await page.click('#wkTimer');
  await page.waitForTimeout(450);
  await page.click('#sheetRoot [data-v="60"]');
  await page.waitForTimeout(400);
  t.check('the clock in the bar starts a rest by hand', (await left()) > 50);
  await page.click('#wkMin');
  await page.waitForTimeout(500);
  t.check('the mini bar counts the rest down', /^Rest \d:\d\d$/.test((await page.textContent('#miniSub')).trim()),
    await page.textContent('#miniSub'));
  await page.click('#miniExpand');
  await page.waitForTimeout(500);

  // a rest that runs out ends itself, with the long buzz and a word
  await page.evaluate(() => {
    window.__buzz = [];
    navigator.vibrate = (v) => { window.__buzz.push(JSON.stringify(v)); return true; };
    // the minute passes: the clock the app reads jumps past the end
    const real = Date.now;
    Date.now = () => real() + 70000;
  });
  await page.waitForTimeout(700);
  t.check('a finished rest takes itself away', await page.evaluate(() => !document.querySelector('#restPanel')));
  t.check('with the long buzz', await page.evaluate(() => window.__buzz.includes(JSON.stringify([200, 100, 200]))),
    await page.evaluate(() => window.__buzz.join(' ')));
  t.check('and says so', /Rest over/.test(await page.evaluate(() => document.querySelector('.toast')?.textContent || '')));

  // ---- last time's set, taken in a tap ----
  await page.evaluate(() => document.querySelectorAll('.ex-block')[0].querySelectorAll('.set-prev.can-copy')[0].click());
  await page.waitForTimeout(400);
  const copied = (await readState(page)).activeWorkout.exercises[0].sets[1];
  t.check('tapping last time copies it into the set', copied.weight === 80 && copied.reps === 8, JSON.stringify(copied));

  // ---- swipe a set away, with an undo ----
  const setCount = async () => (await readState(page)).activeWorkout.exercises[0].sets.length;
  const n0 = await setCount();
  await page.evaluate(() => {
    const row = document.querySelectorAll('.ex-block')[0].querySelectorAll('.set-row')[2];
    const r = row.getBoundingClientRect();
    const at = (x) => [new Touch({ identifier: 1, target: row, clientX: x, clientY: r.top + r.height / 2 })];
    row.dispatchEvent(new TouchEvent('touchstart', { touches: at(r.right - 20), changedTouches: at(r.right - 20), bubbles: true }));
    row.dispatchEvent(new TouchEvent('touchmove', { touches: at(r.right - 80), changedTouches: at(r.right - 80), bubbles: true }));
    row.dispatchEvent(new TouchEvent('touchmove', { touches: at(r.right - 180), changedTouches: at(r.right - 180), bubbles: true }));
    row.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: at(r.right - 180), bubbles: true }));
  });
  await page.waitForTimeout(500);
  t.equal('swiping a set left removes it', await setCount(), n0 - 1);
  t.check('and offers it back', await page.evaluate(() => /Undo/.test(document.querySelector('.toast-btn')?.textContent || '')));
  await page.click('.toast-btn');
  await page.waitForTimeout(400);
  t.equal('undo puts it back', await setCount(), n0);

  // ---- the menu: drawn icons, and the session reordered ----
  await page.click('.ex-block .ex-menu');
  await page.waitForTimeout(450);
  t.check('the exercise menu draws its icons', await page.evaluate(() =>
    document.querySelectorAll('#sheetRoot .menu-item .mi-ico').length >= 8));
  t.check('and carries no emoji', !EMOJI.test(await page.textContent('#sheetRoot')), await page.textContent('#sheetRoot'));
  const order = async () => (await readState(page)).activeWorkout.exercises.map((e) => e.exerciseId);
  const o0 = await order();
  await page.click('#sheetRoot [data-act="reorder"]');
  await page.waitForTimeout(450);
  await page.click('#sheetRoot [data-mv="1"][data-i="0"]');
  await page.waitForTimeout(250);
  const o1 = await order();
  t.check('reorder moves an exercise down', o1[0] === o0[1] && o1[1] === o0[0], o1.join(','));
  await page.click('#roDone');
  await page.waitForTimeout(400);

  // ---- a superset rests after the round, not between its partners ----
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.exPrefs = { 'bench-press': { rest: 90 }, 'db-fly': { rest: 90 } };
    st.activeWorkout = { id: 'ss', name: 'Push', startedAt: Date.now() - 600000, exercises: [
      { exerciseId: 'bench-press', sets: [{ weight: 60, reps: 8, done: false }], ss: 1 },
      { exerciseId: 'db-fly', sets: [{ weight: 14, reps: 12, done: false }], ss: 1 } ] };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('.ex-block')[0].querySelector('.set-done').click());
  await page.waitForTimeout(400);
  t.check('no rest between superset partners', await page.evaluate(() => !document.querySelector('#restPanel')));
  await page.evaluate(() => document.querySelectorAll('.ex-block')[1].querySelector('.set-done').click());
  await page.waitForTimeout(400);
  t.check('the rest comes after the round', await page.evaluate(() => !!document.querySelector('#restPanel')));

  // ---- the closing page ----
  const saved0 = (await readState(page)).workouts.length;
  await page.click('#wkFinishTop');
  await page.waitForTimeout(450);
  await page.click('#confirmFinish');
  await page.waitForTimeout(800);
  t.equal('the session is saved', (await readState(page)).workouts.length, saved0 + 1);
  t.check('saving opens the summary', /Workout complete/.test(await page.textContent('#sheetRoot')));
  t.check('which counts the sessions', new RegExp('Your ' + (saved0 + 1) + '(st|nd|rd|th) workout').test(await page.textContent('#sheetRoot')),
    await page.textContent('#sheetRoot .sm-sub'));
  t.check('and lists each exercise\'s best set', await page.evaluate(() => document.querySelectorAll('#sheetRoot .sm-row').length === 2));
  t.check('a rest does not follow the session into history', !('rest' in (await readState(page)).workouts[0]));
  await page.click('#smDone');
  await page.waitForTimeout(400);
  t.check('done closes it', await page.evaluate(() => !document.querySelector('#sheetRoot').children.length));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  /* ---- installed: the end of a rest is booked as a notification, and
     taken back when the rest is skipped ---- */
  {
    const p2 = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
    p2.errors = [];
    p2.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p2.errors.push(String(e)); });
    const seed = build();
    seed.exPrefs = { 'bench-press': { rest: 120 } };
    await p2.addInitScript((s) => {
      localStorage.setItem('bela-gym-v1', JSON.stringify(s));
      sessionStorage.setItem('bela-opened', '1');
      localStorage.setItem('bela-update-check', String(Date.now()));
      window.__LN = { scheduled: [], cancelled: [], channels: [] };
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          LocalNotifications: {
            createChannel: async (c) => { window.__LN.channels.push(c.id); },
            checkPermissions: async () => ({ display: 'granted' }),
            requestPermissions: async () => ({ display: 'granted' }),
            schedule: async ({ notifications }) => { window.__LN.scheduled.push(...notifications); },
            cancel: async ({ notifications }) => { window.__LN.cancelled.push(...notifications.map((n) => n.id)); },
            getDeliveredNotifications: async () => ({ notifications: [] }),
            removeDeliveredNotifications: async () => {},
          },
          App: { addListener: () => {} },
        },
      };
    }, seed);
    await p2.goto(server.url);
    await p2.waitForTimeout(500);
    t.check('installed: a channel of its own for the rest', await p2.evaluate(() => window.__LN.channels.includes('rest')));
    await p2.click('#homeStart');
    await p2.waitForTimeout(700);
    await p2.click('.ex-block .set-done');
    await p2.waitForTimeout(500);
    const booked = await p2.evaluate(() => window.__LN.scheduled.find((n) => n.id === 8802));
    t.check('installed: the end of the rest is booked', !!booked && booked.channelId === 'rest', JSON.stringify(booked));
    t.check('for the moment it ends', booked && Math.abs(new Date(booked.schedule.at).getTime() - (Date.now() + 120000)) < 5000);
    await p2.click('[data-rest="skip"]');
    await p2.waitForTimeout(400);
    t.check('installed: skipping takes the booking back', await p2.evaluate(() => window.__LN.cancelled.includes(8802)));
    t.equal('installed: no page errors', p2.errors.length, 0, p2.errors.join(' | '));
    await p2.close();
  }
  await server.close();
};
