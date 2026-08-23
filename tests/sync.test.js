/* The merge, on its own — no browser needed. Everything here is a pair of
   documents that drifted apart and a claim about what they should become. */
const Sync = require('../js/sync.js');
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startBelaSync } = require('../pc/bela-sync-server.js');

const base = () => ({
  settings: { unit: 'kg', appearance: 'dark', waterTarget: 8, name: '' },
  nutrition: {
    targets: { kcal: 2800, protein: 180, carbs: 300, fat: 70 },
    meals: [], weights: [], water: [], measurements: [],
  },
  savedMeals: [], foods: [], schedule: [null, null, null, null, null, null, null],
  habits: [{ id: 'h1', name: 'Train' }, { id: 'h2', name: 'Read' }],
  habitLog: {}, customExercises: [], templates: [], workouts: [], activeWorkout: null,
});

/* A device: holds a document, remembers its last shape, and stamps on save. */
function device(doc, clock) {
  const d = { doc, shadow: null, clock };
  d.shadow = Sync.snapshot(d.doc);
  d.save = (fn) => { fn(d.doc); d.clock += 10; d.shadow = Sync.stamp(d.doc, d.shadow, d.clock).shadow; };
  d.adopt = (next) => { d.doc = next; d.shadow = Sync.snapshot(d.doc); };
  return d;
}

module.exports = async (t) => {
  /* --- one side adds, the other has never seen it --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    phone.save((d) => d.workouts.push({ id: 'w1', name: 'Push', finishedAt: 5 }));
    const { doc, tally } = Sync.merge(pc.doc, phone.doc, 2000);
    t.equal('a workout logged on the phone reaches the PC', doc.workouts.length, 1);
    t.equal('and is counted as added', tally.added, 1);
  }

  /* --- both sides add different things --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    pc.save((d) => d.workouts.push({ id: 'w_pc', name: 'Legs', finishedAt: 2 }));
    phone.save((d) => d.workouts.push({ id: 'w_ph', name: 'Push', finishedAt: 9 }));
    const { doc } = Sync.merge(pc.doc, phone.doc, 2000);
    t.equal('both sides keep both workouts', doc.workouts.length, 2);
    t.equal('newest first', doc.workouts[0].id, 'w_ph');
  }

  /* --- the same row edited on both sides --- */
  {
    const pc = device(base(), 1000);
    pc.save((d) => d.workouts.push({ id: 'w1', name: 'Push', finishedAt: 5 }));
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), pc.clock);
    pc.save((d) => { d.workouts[0].name = 'Push day'; });          // t = 1020
    phone.clock = 5000;
    phone.save((d) => { d.workouts[0].name = 'Chest'; });          // t = 5010
    const { doc } = Sync.merge(pc.doc, phone.doc, 6000);
    t.equal('the later edit wins', doc.workouts[0].name, 'Chest');
  }

  /* --- a deletion travels --- */
  {
    const pc = device(base(), 1000);
    pc.save((d) => d.workouts.push({ id: 'w1', name: 'Push', finishedAt: 5 }));
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 4000);
    phone.save((d) => { d.workouts = []; });
    const { doc, tally } = Sync.merge(pc.doc, phone.doc, 6000);
    t.equal('deleting on the phone deletes on the PC', doc.workouts.length, 0);
    t.equal('and is counted as removed', tally.removed, 1);
  }

  /* --- a deleted row that was edited afterwards comes back --- */
  {
    const pc = device(base(), 1000);
    pc.save((d) => d.workouts.push({ id: 'w1', name: 'Push', finishedAt: 5 }));
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 2000);
    phone.save((d) => { d.workouts = []; });                       // deleted at 2010
    pc.clock = 9000;
    pc.save((d) => { d.workouts[0].name = 'Push A'; });            // edited at 9010
    const { doc } = Sync.merge(pc.doc, phone.doc, 10000);
    t.equal('an edit after a deletion keeps the row', doc.workouts.length, 1);
    t.equal('with the newer name', doc.workouts[0].name, 'Push A');
  }

  /* --- deleting stays deleted through a second sync --- */
  {
    const pc = device(base(), 1000);
    pc.save((d) => d.workouts.push({ id: 'w1', name: 'Push', finishedAt: 5 }));
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 3000);
    phone.save((d) => { d.workouts = []; });
    const first = Sync.merge(pc.doc, phone.doc, 4000);
    pc.adopt(first.doc);
    const second = Sync.merge(pc.doc, phone.doc, 5000);
    t.equal('it does not come back on the next sync', second.doc.workouts.length, 0);
  }

  /* --- meals on the same day from both sides --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    pc.save((d) => d.nutrition.meals.push({ id: 'm1', date: '2026-08-20', name: 'Oats', kcal: 400 }));
    phone.save((d) => d.nutrition.meals.push({ id: 'm2', date: '2026-08-20', name: 'Rice', kcal: 600 }));
    const { doc } = Sync.merge(pc.doc, phone.doc, 2000);
    t.equal('both meals survive', doc.nutrition.meals.length, 2);
  }

  /* --- the same day's weight, written twice --- */
  {
    const pc = device(base(), 1000);
    pc.save((d) => d.nutrition.weights.push({ date: '2026-08-20', value: 80 }));
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 7000);
    phone.save((d) => { d.nutrition.weights[0].value = 81; });
    const { doc } = Sync.merge(pc.doc, phone.doc, 8000);
    t.equal('one row per day', doc.nutrition.weights.length, 1);
    t.equal('holding the later weight', doc.nutrition.weights[0].value, 81);
  }

  /* --- two habits ticked the same day on different devices --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    pc.save((d) => { d.habitLog['2026-08-20'] = { h1: 1 }; });
    phone.save((d) => { d.habitLog['2026-08-20'] = { h2: 30 }; });
    const { doc } = Sync.merge(pc.doc, phone.doc, 2000);
    t.equal('the day keeps the tick from the PC', doc.habitLog['2026-08-20'].h1, 1);
    t.equal('and the one from the phone', doc.habitLog['2026-08-20'].h2, 30);
  }

  /* --- settings are one thing, so the last change wins whole --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    pc.save((d) => { d.settings.unit = 'lb'; });
    phone.clock = 9000;
    phone.save((d) => { d.settings.waterTarget = 12; });
    const { doc } = Sync.merge(pc.doc, phone.doc, 9500);
    t.equal('the phone settings win outright', doc.settings.waterTarget, 12);
    t.equal('including dropping the older change', doc.settings.unit, 'kg');
  }

  /* --- reordering habits on one side --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 5000);
    phone.save((d) => { d.habits = [d.habits[1], d.habits[0]]; });
    const { doc } = Sync.merge(pc.doc, phone.doc, 6000);
    t.equal('the order follows the side that changed it', doc.habits.map((h) => h.id).join(), 'h2,h1');
  }

  /* --- merging is idempotent --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    pc.save((d) => d.workouts.push({ id: 'a', finishedAt: 1 }));
    phone.save((d) => d.workouts.push({ id: 'b', finishedAt: 2 }));
    const once = Sync.merge(pc.doc, phone.doc, 3000).doc;
    const twice = Sync.merge(once, phone.doc, 4000).doc;
    t.equal('syncing again changes nothing', twice.workouts.length, once.workouts.length);
    t.equal('the second pass adds nothing', Sync.merge(once, phone.doc, 4000).tally.added, 0);
  }

  /* --- a live session never leaves the phone --- */
  {
    const pc = device(base(), 1000);
    const phone = device(JSON.parse(JSON.stringify(pc.doc)), 1000);
    phone.doc.activeWorkout = { id: 'live', name: 'Push' };
    t.equal('it is stripped before sending', Sync.outgoing(phone.doc).activeWorkout, undefined);
    const { doc } = Sync.merge(phone.doc, pc.doc, 2000);
    t.equal('and a merge leaves the running one alone', doc.activeWorkout.id, 'live');
  }

  /* --- old deletions stop being carried --- */
  {
    const doc = base();
    Sync.meta(doc).graves.workouts = { old: 1000, recent: Date.now() };
    Sync.prune(doc, Date.now());
    t.equal('a deletion from long ago is forgotten', doc.sync.graves.workouts.old, undefined);
    t.check('a recent one is kept', doc.sync.graves.workouts.recent > 0);
  }

  /* --- the PC ships the same merge the phone runs --- */
  {
    const a = fs.readFileSync(path.join(__dirname, '../js/sync.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../pc/sync.js'), 'utf8');
    t.check('pc/sync.js is the same file as js/sync.js', a === b);
  }

  /* --- a real round trip against the PC server --- */
  {
    let pcDoc = base();
    pcDoc.workouts.push({ id: 'w_pc', name: 'Legs', finishedAt: 2 });
    pcDoc = (() => { const s = Sync.snapshot(pcDoc); return Sync.stamp(pcDoc, s, 1000) && pcDoc; })();

    const server = startBelaSync({
      port: 8791,
      code: '123456',
      name: 'Test PC',
      load: () => pcDoc,
      save: (d) => { pcDoc = d; },
    });

    const call = (path, body, code) => new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: '127.0.0.1', port: 8791, path, method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', 'x-bela-code': code ?? '123456' },
      }, (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }));
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });

    try {
      const ping = await call('/bela/ping');
      t.equal('the PC answers a ping', ping.body.app, 'bela');
      t.equal('and says which machine it is', ping.body.name, 'Test PC');

      const wrong = await call('/bela/sync', { protocol: 1, device: 'x', doc: base() }, '000000');
      t.equal('a wrong pairing code is refused', wrong.status, 403);

      const phone = device(base(), 4000);
      phone.save((d) => d.workouts.push({ id: 'w_ph', name: 'Push', finishedAt: 9 }));
      const res = await call('/bela/sync', { protocol: 1, device: 'phone', doc: Sync.outgoing(phone.doc) });
      t.equal('a sync succeeds', res.status, 200);
      t.equal('the phone gets both workouts back', res.body.doc.workouts.length, 2);
      t.equal('and the PC now holds both too', pcDoc.workouts.length, 2);

      const old = await call('/bela/sync', { protocol: 99, device: 'phone', doc: base() });
      t.equal('a mismatched protocol is refused', old.status, 409);
    } finally {
      await server.stop();
    }
  }

  /* --- the phone app, in a browser, syncing with the PC server --- */
  {
    let pcDoc = base();
    pcDoc.nutrition.meals.push({ id: 'm_pc', date: '2026-08-20', name: 'PC porridge', kcal: 400 });
    Sync.stamp(pcDoc, Sync.snapshot(base()), 1000);

    const pc = startBelaSync({
      port: 8792, code: '424242', name: 'Desk PC',
      load: () => pcDoc, save: (d) => { pcDoc = d; },
    });
    const server = await t.serve({ serviceWorker: false });
    const page = await openApp(t.browser, { url: server.url, seed: build() });
    try {
      await page.click('#homeAvatar');
      await page.waitForTimeout(400);
      await (await page.$('.icon-btn[aria-label*="ettings"]')).click();
      await page.waitForTimeout(450);
      await page.click('#pcSyncBtn');
      await page.waitForTimeout(500);
      t.check('Settings has a way into sync', await page.evaluate(() => !!document.querySelector('#pcHost')));

      await page.fill('#pcHost', '127.0.0.1:8792');
      await page.fill('#pcCode', '424242');
      await page.evaluate(() => {
        document.querySelector('#pcHost').dispatchEvent(new Event('change'));
        document.querySelector('#pcCode').dispatchEvent(new Event('change'));
      });
      await page.click('#pcTest');
      await page.waitForTimeout(900);
      t.equal('the phone finds the PC', await page.evaluate(() => document.querySelector('#pcWhy').textContent), 'Found Desk PC.');

      const mine = await readState(page);
      const workoutsBefore = mine.workouts.length;
      await page.click('#pcSync');
      await page.waitForTimeout(1600);

      const after = await readState(page);
      t.check('the meal logged on the PC lands on the phone',
        after.nutrition.meals.some((m) => m.id === 'm_pc'));
      t.check('and the phone keeps its own workouts', after.workouts.length >= workoutsBefore);
      t.check('the PC took the phone\'s workouts', pcDoc.workouts.length >= workoutsBefore);
      t.check('the line says when it last synced',
        /Last synced/.test(await page.evaluate(() => document.querySelector('#pcWhy').textContent)));

      // and again, with nothing new to say
      await page.click('#pcSync');
      await page.waitForTimeout(1400);
      t.check('syncing twice does not duplicate anything',
        (await readState(page)).nutrition.meals.filter((m) => m.id === 'm_pc').length === 1);

      // a wrong code is reported, not swallowed
      await page.fill('#pcCode', '000000');
      await page.evaluate(() => document.querySelector('#pcCode').dispatchEvent(new Event('change')));
      await page.click('#pcSync');
      await page.waitForTimeout(1400);
      t.check('a wrong pairing code says so',
        /pairing code/.test(await page.evaluate(() => document.querySelector('#pcWhy').textContent)));

      t.equal('no page errors', page.errors.length, 0);
    } finally {
      await page.close();
      await server.close();
      await pc.stop();
    }
  }

  /* --- the first stamp marks nothing as changed --- */
  {
    const doc = base();
    doc.workouts.push({ id: 'w1', finishedAt: 1 });
    const first = Sync.stamp(doc, null, 5000);
    t.equal('opening an old backup does not look like an edit', first.touched, 0);
    t.equal('but the row is known', doc.sync.stamps.workouts.w1, 0);
  }
};
