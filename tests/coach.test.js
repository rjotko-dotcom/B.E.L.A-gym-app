/* Automatic progression (the coach) and Start fresh. Every session from a
   routine comes out with its weights and reps decided; a stalled lift gets a
   lighter week on its own; switched off, only the hint line is left. Start
   fresh deletes the workout history and nothing else, keeps the days trained
   on the Train habit, and takes a snapshot first. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

const withSets = (reps, sessions) => {
  const s = build();
  s.workouts = s.workouts.slice(0, sessions);
  s.workouts.forEach((w) => { w.exercises[0].sets = reps.map((r) => ({ weight: 80, reps: r, done: true, type: 'N' })); });
  return s;
};
const startPush = async (page) => {
  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-tpl="tpl-push"]').click());
  await page.waitForTimeout(700);
};
const bench = async (page) => (await readState(page)).activeWorkout.exercises.find((e) => e.exerciseId === 'bench-press');
const openSettings = async (page) => {
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await page.waitForTimeout(300);
  await page.click('#homeAvatar');
  await page.waitForTimeout(400);
  await page.click('.icon-btn[aria-label*="ettings"]');
  await page.waitForTimeout(450);
};

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });

  // every set hit its reps: more weight, same reps
  let page = await openApp(t.browser, { url: server.url, seed: withSets([8, 8, 8], 2) });
  await startPush(page);
  let b = await bench(page);
  t.check('all reps hit last time: +2.5 kg on the bench', b.sets.every((s) => s.targetW === 82.5 && s.targetR === 8), JSON.stringify(b.sets[0]));
  t.equal('the box shows the new weight', await page.evaluate(() => document.querySelector('.ex-block .in-weight').placeholder), '82.5');
  t.equal('and the reps', await page.evaluate(() => document.querySelector('.ex-block .in-reps').placeholder), '8');
  const line = await page.textContent('.ex-block .ex-coach');
  t.check('the card says why', /Auto/.test(line) && /\+2\.5 kg/.test(line) && /every set hit/.test(line), line);
  await page.click('.ex-block .set-done');
  await page.waitForTimeout(300);
  b = await bench(page);
  t.check('ticking an empty set logs the coach\'s numbers', b.sets[0].done && b.sets[0].weight === 82.5 && b.sets[0].reps === 8, JSON.stringify(b.sets[0]));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  // missed a rep: same weight, the rep to get back
  page = await openApp(t.browser, { url: server.url, seed: withSets([8, 8, 7], 2) });
  await startPush(page);
  b = await bench(page);
  t.check('missed a rep: the same weight', b.sets.every((s) => s.targetW === 80 && s.targetR === 8), JSON.stringify(b.sets[0]));
  t.check('and says so', /Same 80 kg, aim for 8 reps/.test(await page.textContent('.ex-block .ex-coach')));
  await page.close();

  // stalled for three sessions: a lighter week, without being asked
  page = await openApp(t.browser, { url: server.url, seed: build() });
  await startPush(page);
  b = await bench(page);
  t.check('a stalled lift starts its lighter week by itself', b.deload && b.sets[0].targetW === 72.5, JSON.stringify(b.sets[0]));
  t.check('which lasts the week', ((await readState(page)).exPrefs['bench-press'] || {}).deloadUntil > Date.now() + 6 * 864e5);
  t.check('and the card says why', /Lighter week at 90%/.test(await page.textContent('.ex-block .ex-coach')));
  await page.close();

  // switched off: the old hint line, nothing decided
  const off = withSets([8, 8, 8], 2);
  off.settings.autoProgress = false;
  page = await openApp(t.browser, { url: server.url, seed: off });
  await startPush(page);
  b = await bench(page);
  t.check('off: no weights decided', b.sets.every((s) => s.targetW == null && s.targetR == null));
  t.check('off: no coach line, the hint is back', await page.evaluate(() => !document.querySelector('.ex-coach') && !!document.querySelector('.ex-hint')));
  await page.close();

  // ---- start fresh ----
  page = await openApp(t.browser, { url: server.url, seed: build() });
  const before = await readState(page);
  const trainedDay = new Date(before.workouts[0].startedAt);
  const tk = trainedDay.getFullYear() + '-' + String(trainedDay.getMonth() + 1).padStart(2, '0') + '-' + String(trainedDay.getDate()).padStart(2, '0');
  await openSettings(page);
  t.check('Settings has the switch, on', await page.evaluate(() => document.querySelector('#autoProgSw')?.checked === true));
  await page.click('#freshBtn');
  await page.waitForTimeout(450);
  t.check('it asks first, and says what stays', /Routines, meals, bodyweight and habits stay/.test(await page.textContent('#sheetRoot')));
  await page.click('#cfYes');
  await page.waitForTimeout(900);
  const after = await readState(page);
  t.equal('every workout is gone', after.workouts.length, 0);
  t.equal('meals stay', after.nutrition.meals.length, before.nutrition.meals.length);
  t.equal('bodyweight stays', after.nutrition.weights.length, before.nutrition.weights.length);
  t.equal('habits stay', after.habits.length, before.habits.length);
  t.equal('the days trained stay ticked on Train', ((after.habitLog || {})[tk] || {}).h_train, 1);
  t.check('a snapshot was taken first', await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('bela-snapshots');
    r.onsuccess = () => {
      try {
        const db = r.result, st = db.transaction(db.objectStoreNames[0]).objectStore(db.objectStoreNames[0]);
        const all = st.getAll();
        all.onsuccess = () => ok(all.result.some((x) => /fresh/.test(x.key) && x.meta.workouts === 6));
        all.onerror = () => ok(false);
      } catch (e) { ok(false); }
    };
    r.onerror = () => ok(false);
  })));
  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-tpl="tpl-push"]').click());
  await page.waitForTimeout(700);
  t.check('after it, no previous weights anywhere', await page.evaluate(() =>
    !document.querySelector('.ex-coach') && [...document.querySelectorAll('.ex-block .in-weight')].every((i) => !i.placeholder)));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
