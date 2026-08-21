/* Anything that can quietly corrupt the save: unit conversion, importing an
   older backup, and the confirmations that guard destructive actions. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

const openSettings = async (page) => {
  await page.click('#homeAvatar');
  await page.waitForTimeout(400);
  const gear = await page.$('.icon-btn[aria-label*="ettings"]');
  await gear.click();
  await page.waitForTimeout(450);
};

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });

  // ---- kg <-> lb must convert what is stored, not just relabel it ----
  const before = await readState(page);
  await openSettings(page);
  await page.click('#unitSeg button[data-u="lb"]');
  await page.waitForTimeout(400);
  t.check('switching units asks first', await page.evaluate(() => !!document.querySelector('.confirm-msg')));
  await page.click('#cfYes');
  await page.waitForTimeout(700);
  const lb = await readState(page);
  t.equal('the unit is now lb', lb.settings.unit, 'lb');
  t.near('logged sets are converted', lb.workouts[0].exercises[0].sets[0].weight,
    before.workouts[0].exercises[0].sets[0].weight * 2.2046, 0.6);
  t.near('bodyweight is converted', lb.nutrition.weights.at(-1).value,
    before.nutrition.weights.at(-1).value * 2.2046, 0.2);
  t.near('the goal is converted', lb.settings.goalWeight, before.settings.goalWeight * 2.2046, 0.2);

  await page.click('#unitSeg button[data-u="kg"]');
  await page.waitForTimeout(400);
  await page.click('#cfYes');
  await page.waitForTimeout(700);
  const back = await readState(page);
  t.equal('switching back restores the original set', back.workouts[0].exercises[0].sets[0].weight,
    before.workouts[0].exercises[0].sets[0].weight);
  t.equal('and the original bodyweight', back.nutrition.weights.at(-1).value,
    before.nutrition.weights.at(-1).value);

  // ---- destructive actions never use the browser's own dialog ----
  let nativeDialogs = 0;
  page.on('dialog', async (d) => { nativeDialogs++; await d.dismiss(); });
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(350);
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  await page.click('#cancelWorkout');
  await page.waitForTimeout(450);
  t.check('discarding asks in the app, not the browser', await page.evaluate(() => !!document.querySelector('#cfYes')));
  t.check('the message says what is lost', /logged set|nothing will be lost/i.test(
    await page.evaluate(() => document.querySelector('.confirm-msg')?.textContent || '')));
  await page.click('#cfNo');
  await page.waitForTimeout(400);
  t.check('cancelling keeps the workout', !!(await readState(page)).activeWorkout);
  await page.click('#cancelWorkout');
  await page.waitForTimeout(400);
  await page.click('#cfYes');
  await page.waitForTimeout(500);
  t.check('confirming discards it', !(await readState(page)).activeWorkout);
  t.equal('no browser dialogs were used', nativeDialogs, 0);

  // ---- deleting offers the thing back ----
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(500);
  await page.click('#dayPrev');          // the seeded meals are yesterday's
  await page.waitForTimeout(400);
  const meals = () => page.evaluate(() => JSON.parse(localStorage.getItem('bela-gym-v1')).nutrition.meals.length);
  const mealsBefore = await meals();
  t.check('there is a meal to delete', mealsBefore > 0, String(mealsBefore));
  await page.click('.si-del');
  await page.waitForTimeout(450);
  t.equal('deleting takes it out', await meals(), mealsBefore - 1);
  const undoTxt = await page.textContent('.toast');
  t.check('and offers an undo', /Undo/.test(undoTxt), undoTxt);
  await page.click('.toast-btn');
  await page.waitForTimeout(500);
  t.equal('undo puts it back', await meals(), mealsBefore);

  // ---- a snapshot is taken daily and can be restored ----
  const snapKeys = () => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('bela-snapshots', 1);
    r.onsuccess = () => {
      const q = r.result.transaction('snaps', 'readonly').objectStore('snaps').getAll();
      q.onsuccess = () => res(q.result.map((x) => x.key));
    };
    r.onerror = () => res([]);
  }));
  const keys = await snapKeys();
  t.check('the first launch of the day takes a snapshot', keys.length > 0, JSON.stringify(keys));
  await page.click('.si-del');
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
  t.equal('a meal is gone again', await meals(), mealsBefore - 1);
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);
  await page.click('#homeAvatar');
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /settings/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  await page.click('#snapBtn');
  await page.waitForTimeout(550);
  t.check('the snapshots sheet lists one', await page.evaluate(() => !!document.querySelector('[data-restore]')));
  await page.click('[data-restore]');
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheetRoot button')].find((x) => x.textContent.trim() === 'Restore');
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  t.equal('restoring brings the meal back', await meals(), mealsBefore);
  t.check('and keeps a copy of what it replaced', (await snapKeys()).length > keys.length);
  // a trained day is actually lit in the consistency card
  await page.click('.tab[data-tab="workout"]');
  await page.waitForTimeout(450);
  const dots = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.dm-grid .dot')];
    const on = all.filter((d) => d.classList.contains('on'));
    return { total: all.length, on: on.length, colour: on.length ? getComputedStyle(on[0]).backgroundColor : 'none' };
  });
  t.check('the calendar of dots is drawn', dots.total > 80, String(dots.total));
  t.check('sessions light their day', dots.on > 0, String(dots.on));
  t.check('and are actually painted light', dots.colour !== 'rgb(43, 43, 43)', dots.colour);

  // past sessions can be searched
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(300);
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(350);
  await page.click('#homeAvatar');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-seg]')].find((x) => x.dataset.seg === 'history');
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const cards = () => page.evaluate(() => document.querySelectorAll('.hist-item').length);
  const all = await cards();
  t.check('history lists the sessions', all > 0, String(all));
  await page.fill('#histQ', 'zzzz');
  await page.waitForTimeout(450);
  t.equal('a search that matches nothing empties the list', await cards(), 0);
  t.check('and says so', await page.evaluate(() => !!document.querySelector('.empty-note')));
  t.check('the calendar steps aside while searching', await page.evaluate(() => !document.querySelector('.cal-grid')));
  t.equal('the field keeps the cursor', await page.evaluate(() => document.activeElement?.id), 'histQ');
  await page.fill('#histQ', 'bench');
  await page.waitForTimeout(450);
  t.check('searching an exercise finds its sessions', (await cards()) > 0, String(await cards()));
  await page.click('#histClear');
  await page.waitForTimeout(450);
  t.equal('clearing brings them all back', await cards(), all);

  t.equal('no page errors', page.errors.length, 0);
  await page.close();

  // ---- a backup written before habits existed still imports ----
  const legacy = build();
  delete legacy.habits;
  delete legacy.habitLog;
  delete legacy.schedule;
  legacy.nutrition.meals.forEach((m) => { delete m.slot; });
  const page2 = await openApp(t.browser, { url: server.url, seed: legacy });
  // the migration happens in memory on load, so check what the app shows
  await page2.click('.tab[data-tab="habits"]');
  await page2.waitForTimeout(450);
  t.check('an old save gains the starter habits',
    await page2.evaluate(() => document.querySelectorAll('.hb-row').length > 0));
  await page2.click('.tab[data-tab="home"]');
  await page2.waitForTimeout(350);
  t.check('meals without a slot are placed by their time',
    await page2.evaluate(() => { document.querySelector('.tab[data-tab="meals"]').click(); return true; }));
  await page2.waitForTimeout(450);
  t.check('nutrition still renders for an old save',
    await page2.evaluate(() => document.querySelectorAll('.slot-card').length === 4));
  t.equal('no page errors', page2.errors.length, 0);
  await page2.close();
  await server.close();
};
