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

  const working = (b) => b.sets.filter((x) => (x.type || 'N') !== 'W');
  const workRow = (page, n = 0) => page.evaluate((k) => {
    const rows = [...document.querySelectorAll('.ex-block')][0].querySelectorAll('.set-row');
    return [...rows].filter((r) => !r.querySelector('.set-num.t-w')).map((r) => [...r.parentNode.children].indexOf(r))[k];
  }, n);
  const workPh = (page, sel) => page.evaluate((q) => {
    const row = [...[...document.querySelectorAll('.ex-block')][0].querySelectorAll('.set-row')].find((r) => !r.querySelector('.set-num.t-w'));
    return row.querySelector(q).placeholder;
  }, sel);

  // bench works in 5–8: every set reached 8, so more weight and back to 5
  let page = await openApp(t.browser, { url: server.url, seed: withSets([8, 8, 8], 2) });
  await startPush(page);
  let b = await bench(page);
  t.check('top of the range on every set: +2.5 kg, back to the bottom', working(b).every((s) => s.targetW === 82.5 && s.targetR === 5), JSON.stringify(working(b)[0]));
  t.equal('the box shows the new weight', await workPh(page, '.in-weight'), '82.5');
  t.equal('and the reps', await workPh(page, '.in-reps'), '5');
  const line = await page.textContent('.ex-block .ex-coach');
  t.check('the card says why', /Auto/.test(line) && /\+2\.5 kg/.test(line) && /every set reached 8/.test(line), line);
  t.check('the first heavy lift gets warm-ups by itself', b.sets.filter((x) => x.type === 'W').map((x) => x.weight).join(',') === '32.5,50,65', JSON.stringify(b.sets.filter((x) => x.type === 'W')));
  t.check('and the line says so', /3 warm-up sets added/.test(line));
  t.check('only the first heavy lift', (await readState(page)).activeWorkout.exercises.slice(1).every((e) => !e.sets.some((x) => x.type === 'W')));
  // ticking an empty working set logs the coach's numbers
  await page.evaluate(() => {
    const row = [...[...document.querySelectorAll('.ex-block')][0].querySelectorAll('.set-row')].find((r) => !r.querySelector('.set-num.t-w'));
    row.querySelector('.set-done').click();
  });
  await page.waitForTimeout(300);
  b = await bench(page);
  t.check('ticking an empty set logs the coach\'s numbers', working(b)[0].done && working(b)[0].weight === 82.5 && working(b)[0].reps === 5, JSON.stringify(working(b)[0]));
  // the rest of the working sets: the question appears
  t.check('no question before the last set', await page.evaluate(() => !document.querySelector('.feel-row')));
  await page.evaluate(() => { const w = JSON.parse(localStorage.getItem('bela-gym-v1')); w.activeWorkout.exercises[0].sets.forEach((x) => { if (x.type !== 'W') { x.done = true; x.weight = 82.5; x.reps = 5; } }); localStorage.setItem('bela-gym-v1', JSON.stringify(w)); });
  await page.reload();
  await page.waitForTimeout(700);
  t.check('every working set in: "How did it feel?"', /How did it feel/.test(await page.evaluate(() => document.querySelector('.ex-block .feel-row')?.textContent || '')));
  await page.evaluate(() => document.querySelector('.ex-block .feel-btn[data-feel="e"]').click());
  await page.waitForTimeout(300);
  t.equal('a tap keeps it on the exercise', (await bench(page)).feel, 'e');
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  // it felt easy: a double step
  let seed = withSets([8, 8, 8], 2); seed.workouts[0].exercises[0].feel = 'e';
  page = await openApp(t.browser, { url: server.url, seed });
  await startPush(page);
  t.check('easy last time: +5 kg', working(await bench(page)).every((s) => s.targetW === 85), JSON.stringify(working(await bench(page))[0]));
  await page.close();
  // it felt hard: hold the weight even though the reps were there
  seed = withSets([8, 8, 8], 2); seed.workouts[0].exercises[0].feel = 'h';
  page = await openApp(t.browser, { url: server.url, seed });
  await startPush(page);
  b = await bench(page);
  t.check('hard last time: stay and own it', working(b).every((s) => s.targetW === 80 && s.targetR === 8) && /felt hard/.test(await page.textContent('.ex-block .ex-coach')), JSON.stringify(working(b)[0]));
  await page.close();
  // far under the range: down a step
  page = await openApp(t.browser, { url: server.url, seed: withSets([3, 3, 3], 2) });
  await startPush(page);
  t.check('every set well under the range: down a step', working(await bench(page)).every((s) => s.targetW === 77.5 && s.targetR === 5));
  await page.close();

  // missed a rep: same weight, the rep to get back
  page = await openApp(t.browser, { url: server.url, seed: withSets([8, 8, 7], 2) });
  await startPush(page);
  b = await bench(page);
  t.check('missed a rep: the same weight', working(b).every((s) => s.targetW === 80 && s.targetR === 8), JSON.stringify(working(b)[0]));
  t.check('and says so', /Same 80 kg, aim for 8 reps/.test(await page.textContent('.ex-block .ex-coach')));
  // a range of his own from the ⋯ menu re-plans what is not logged
  await page.evaluate(() => document.querySelector('.ex-block .ex-menu').click());
  await page.waitForTimeout(400);
  t.check('the menu shows the range', /Rep range · 5–8/.test(await page.textContent('#sheetRoot')));
  await page.evaluate(() => document.querySelector('#sheetRoot [data-act="range"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#sheetRoot [data-r="8-12"]').click());
  await page.waitForTimeout(400);
  const st = await readState(page);
  t.equal('kept against the exercise', JSON.stringify(st.exPrefs['bench-press'].range), '[8,12]');
  b = st.activeWorkout.exercises[0];
  t.check('and re-plans: same 80 kg, one more rep', working(b).every((s) => s.targetW === 80 && s.targetR === 8), JSON.stringify(working(b)[0]));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  // stalled for three sessions: a lighter week, without being asked
  page = await openApp(t.browser, { url: server.url, seed: build() });
  await startPush(page);
  b = await bench(page);
  t.check('a stalled lift starts its lighter week by itself', b.deload && working(b)[0].targetW === 72.5, JSON.stringify(working(b)[0]));
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

  // ---- weekly volume: a muscle behind gets a set ----
  // the history moved back past this week, and a target no week can meet,
  // so "behind" holds whatever day the suite runs on
  const vol = build();
  vol.settings.volumeAssist = true;
  vol.settings.weeklySets = 100;
  vol.workouts.forEach((w, i) => { w.startedAt -= 8 * 864e5; w.finishedAt -= 8 * 864e5; });
  page = await openApp(t.browser, { url: server.url, seed: vol });
  await startPush(page);
  let aw = (await readState(page)).activeWorkout;
  const extra = aw.exercises.filter((e) => e.extraSet);
  t.equal('muscles behind get one set more — two at most', extra.length, 2);
  t.check('on an exercise that trains them, said on the card', await page.evaluate(() =>
    [...document.querySelectorAll('.ex-coach')].some((x) => /\+1 set: .* of 100 this week/.test(x.textContent))));
  await page.close();
  vol.settings.volumeAssist = false;
  page = await openApp(t.browser, { url: server.url, seed: vol });
  await startPush(page);
  aw = (await readState(page)).activeWorkout;
  t.check('switched off: no sets added', !aw.exercises.some((e) => e.extraSet));
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
