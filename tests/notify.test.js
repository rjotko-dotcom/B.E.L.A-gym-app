/* The workout and rest notifications, installed: while resting the ongoing
   notification says when the rest ends and what is next, and its buttons
   work without opening the app — +15 s, Skip, Log next set. */
const { readState, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const p = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p.errors = [];
  p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p.errors.push(String(e)); });
  const seed = build();
  seed.settings.wkNotify = true;
  seed.exPrefs = { 'bench-press': { rest: 120 } };
  await p.addInitScript((s) => {
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__LN = { posted: {}, types: [], listeners: {} };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LocalNotifications: {
          createChannel: async () => {},
          registerActionTypes: async ({ types }) => { window.__LN.types = types; },
          addListener: (ev, fn) => { window.__LN.listeners[ev] = fn; },
          checkPermissions: async () => ({ display: 'granted' }),
          requestPermissions: async () => ({ display: 'granted' }),
          schedule: async ({ notifications }) => { notifications.forEach((n) => { window.__LN.posted[n.id] = n; }); },
          cancel: async () => {},
          getDeliveredNotifications: async () => ({ notifications: [] }),
          removeDeliveredNotifications: async () => {},
        },
        App: { addListener: () => {} },
      },
    };
  }, seed);
  await p.goto(server.url);
  await p.waitForTimeout(500);
  const types = await p.evaluate(() => window.__LN.types.map((x) => x.id + ':' + x.actions.map((a) => a.id).join('/')));
  t.equal('the buttons are registered', types.join(' '), 'bela-rest:plus15/skip/log bela-set:log');

  await p.click('#homeStart');
  await p.waitForTimeout(900);
  let note = await p.evaluate(() => window.__LN.posted[8801]);
  t.check('a running set shows a Log set button', note && note.actionTypeId === 'bela-set', JSON.stringify(note));
  await p.click('.ex-block .set-done');
  await p.waitForTimeout(900);
  note = await p.evaluate(() => window.__LN.posted[8801]);
  t.check('resting, it says when the rest ends', note && /^Resting · ends /.test(note.title), note && note.title);
  t.check('and what is next', note && /^Next: Set 2 · Barbell Bench Press 80 kg × 8$/.test(note.body), note && note.body);
  t.equal('with +15 / Skip / Log next set', note && note.actionTypeId, 'bela-rest');
  t.equal('and the rest-over alert can log the set too', await p.evaluate(() => window.__LN.posted[8802]?.actionTypeId), 'bela-set');

  const press = (actionId, id = 8801) => p.evaluate(([a, n]) => window.__LN.listeners.localNotificationActionPerformed({ actionId: a, notification: { id: n } }), [actionId, id]);
  const endAt = async () => (await readState(p)).activeWorkout.rest?.endAt;
  const e0 = await endAt();
  await press('plus15');
  await p.waitForTimeout(700);
  t.check('+15 s from the notification', (await endAt()) - e0 === 15000);
  await press('log');
  await p.waitForTimeout(700);
  let w = (await readState(p)).activeWorkout;
  t.check('Log next set logs set 2 with its numbers', w.exercises[0].sets[1].done && w.exercises[0].sets[1].weight === 80 && w.exercises[0].sets[1].reps === 8,
    JSON.stringify(w.exercises[0].sets[1]));
  t.check('and starts its rest', !!w.rest && w.rest.total === 120000);
  await press('skip', 8802);
  await p.waitForTimeout(700);
  t.check('Skip on the alert ends the rest', !(await readState(p)).activeWorkout.rest);
  note = await p.evaluate(() => window.__LN.posted[8801]);
  t.check('and the notification goes back to the next set', note && note.actionTypeId === 'bela-set' && !/Resting/.test(note.title), note && note.title);
  t.equal('no page errors', p.errors.length, 0, p.errors.join(' | '));
  await p.close();
  await server.close();
};
