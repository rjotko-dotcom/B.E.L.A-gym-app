/* The workout logger: set numbering, the type picker, RPE, the rest timer's
   position, and editing a session that was already saved. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  const page = await openApp(t.browser, { url: server.url, seed });
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  const setNums = () => page.evaluate(() =>
    [...document.querySelector('.ex-block').querySelectorAll('.set-num')].map((b) => b.textContent));

  t.check('sets start numbered from one', (await setNums()).join(',').startsWith('1,2,3'));

  // the number opens a picker rather than cycling through types
  await page.click('.ex-block .set-num');
  await page.waitForTimeout(350);
  t.equal('set type picker offers all four types', await page.evaluate(() => document.querySelectorAll('[data-type]').length), 4);
  t.check('the picker can remove the set', await page.evaluate(() => !!document.querySelector('#setDel')));

  await page.click('[data-type="W"]');
  await page.waitForTimeout(400);
  t.equal('a warm-up does not take a set number', (await setNums()).join(','), 'W,1,2,3');

  await page.evaluate(() => document.querySelectorAll('.ex-block .set-num')[2].click());
  await page.waitForTimeout(300);
  await page.click('[data-type="D"]');
  await page.waitForTimeout(400);
  t.equal('a drop set does not take one either', (await setNums()).join(','), 'W,1,D,2');

  // RPE
  await page.click('.ex-block .set-rpe');
  await page.waitForTimeout(350);
  t.equal('RPE offers 6 to 10 in halves', await page.evaluate(() => document.querySelectorAll('[data-rpe]').length), 8);
  await page.click('[data-rpe="9"]');
  await page.waitForTimeout(400);
  t.equal('RPE is stored on the set', (await readState(page)).activeWorkout.exercises[0].sets[0].rpe, 9);

  // removing a set
  const before = (await readState(page)).activeWorkout.exercises[0].sets.length;
  await page.click('.ex-block .set-num');
  await page.waitForTimeout(300);
  await page.click('#setDel');
  await page.waitForTimeout(400);
  t.equal('a set can be removed', (await readState(page)).activeWorkout.exercises[0].sets.length, before - 1);

  // the rest timer belongs with the session stats, not over the sets
  await page.fill('.ex-block .in-weight', '80');
  await page.fill('.ex-block .in-reps', '8');
  await page.click('.ex-block .set-done');
  await page.waitForTimeout(600);
  const rest = await page.evaluate(() => {
    const rb = document.querySelector('#restBar');
    if (rb.hidden) return null;
    const r = rb.getBoundingClientRect();
    const stats = document.querySelector('.wk-stats').getBoundingClientRect();
    const firstCard = document.querySelector('.ex-block').getBoundingClientRect();
    return { gapUnderStats: Math.round(r.top - stats.bottom), coversCard: r.bottom - firstCard.top > 2 };
  });
  t.check('rest timer runs after a set is logged', !!rest);
  if (rest) {
    t.near('rest timer sits under the session stats', rest.gapUnderStats, 0, 4);
    t.check('rest timer does not cover the first exercise', !rest.coversCard);
  }
  await page.click('#restSkip');
  await page.waitForTimeout(300);

  // progressive overload hint
  const hint = await page.evaluate(() => document.querySelector('.ex-hint')?.textContent || '');
  t.check('an overload hint is offered from last session', /try/.test(hint), hint.trim());

  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('bela-gym-v1')); s.activeWorkout = null; localStorage.setItem('bela-gym-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(500);

  // editing a saved session
  await page.click('#homeAvatar');
  await page.waitForTimeout(400);
  await page.click('#progSeg button[data-seg="history"]');
  await page.waitForTimeout(450);
  await page.click('.hist-item');
  await page.waitForTimeout(350);
  t.check('history offers an edit action', await page.evaluate(() => !!document.querySelector('[data-edit]')));
  const historyBefore = (await readState(page)).workouts;
  await page.click('[data-edit]');
  await page.waitForTimeout(600);
  t.check('the logger says it is editing', /Editing/.test(await page.textContent('.wk-title')));
  await page.fill('.ex-block .in-weight', '92.5');
  await page.click('#wkFinishTop');
  await page.waitForTimeout(450);
  await page.click('#confirmFinish');
  await page.waitForTimeout(700);
  const after = (await readState(page)).workouts;
  t.equal('editing does not add a second session', after.length, historyBefore.length);
  t.equal('the edit is saved in place', after[0].id, historyBefore[0].id);
  t.equal('the changed weight is stored', after[0].exercises[0].sets[0].weight, 92.5);
  t.equal('the original date is kept', after[0].startedAt, historyBefore[0].startedAt);
  t.check('the edit marker is cleaned up', !('editingId' in after[0]));

  // records: a drawn marker, not an emoji, and a distinct buzz
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('bela-gym-v1')); st.activeWorkout = null; localStorage.setItem('bela-gym-v1', JSON.stringify(st)); });
  await page.reload();
  await page.waitForTimeout(500);
  const buzzes = [];
  await page.exposeFunction('__buzz', (v) => buzzes.push(v));
  await page.addInitScript(() => { navigator.vibrate = (v) => { window.__buzz(JSON.stringify(v)); return true; }; });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  await page.fill('.ex-block .in-weight', '150');
  await page.fill('.ex-block .in-reps', '8');
  await page.click('.ex-block .set-done');
  await page.waitForTimeout(800);
  t.check('a record buzzes the phone', buzzes.some((b) => JSON.parse(b).length > 1), JSON.stringify(buzzes));
  t.check('the record marker is drawn, not an emoji', await page.evaluate(() => !!document.querySelector('.toast svg') && !/🏆/.test(document.body.innerHTML)));

  // the rest timer belongs in the header, never over the sets
  const rest2 = await page.evaluate(() => {
    const rb = document.querySelector('#restBar');
    const stats = document.querySelector('.wk-stats').getBoundingClientRect();
    const card = document.querySelector('.ex-block').getBoundingClientRect();
    const r = rb.getBoundingClientRect();
    return { docked: rb.classList.contains('rest-docked'), inHeader: !!rb.closest('.wk-overlay'),
      under: Math.round(r.top - stats.bottom), covers: r.bottom > card.top + 2,
      countdown: document.querySelector('#wkRestMini')?.textContent };
  });
  t.check('the rest timer is docked into the header', rest2.docked && rest2.inHeader);
  t.near('directly under the session stats', rest2.under, 0, 4);
  t.check('and never covers the first exercise', !rest2.covers);
  t.check('the countdown shows next to the duration', /^\d+:\d\d$/.test(rest2.countdown || ''), rest2.countdown);

  // logging a set must not throw the list back to the top
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const ids = ['bench-press', 'incline-db-press', 'shoulder-press', 'lateral-raise', 'triceps-pushdown'];
    st.activeWorkout = {
      id: 'scroll', name: 'Push day', startedAt: Date.now() - 600000,
      exercises: ids.map((id) => ({ exerciseId: id, sets: [0, 1, 2].map(() => ({ weight: 40, reps: 10, done: false })) })),
    };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelector('.wk-body').scrollTop = 900; });
  await page.waitForTimeout(200);
  const wkY = () => page.evaluate(() => document.querySelector('.wk-body').scrollTop);
  const startY = await wkY();
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.set-row')];
    const seen = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top > 120 && b.bottom < innerHeight - 40; }) || rows[0];
    seen.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  t.equal('ticking a set holds the scroll position', await wkY(), startY);
  await page.evaluate(() => { document.querySelectorAll('.ex-block')[3].querySelector('.add-set').click(); });
  await page.waitForTimeout(450);
  t.equal('adding a set holds it too', await wkY(), startY);

  // a new exercise is worth scrolling to, though
  await page.click('#addExercise');
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelector('.lib-item').click());
  await page.waitForTimeout(550);
  const added = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.ex-block')];
    const r = blocks[blocks.length - 1].getBoundingClientRect();
    return { count: blocks.length, visible: r.top < innerHeight && r.bottom > 0 };
  });
  t.equal('the exercise is added', added.count, 6);
  t.check('and scrolled into view', added.visible);

  // the rest timer follows the clock, so a frozen phone cannot stall it
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.querySelector('.set-done').classList.contains('is-on')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(500);
  const started = await page.textContent('#restTime');
  t.check('logging a set starts the rest timer', /^\d+:\d\d$/.test(started.trim()), started);
  await page.evaluate(() => { const real = Date.now; window.__real = real; Date.now = () => real() + 60000; });
  await page.waitForTimeout(400);
  const jumped = await page.textContent('#restTime');
  t.check('a minute of frozen ticks still takes a minute off', jumped !== started, started + ' -> ' + jumped);
  await page.evaluate(() => { const real = window.__real; Date.now = () => real() + 600000; });
  await page.waitForTimeout(500);
  t.check('and the timer settles when its time is up', await page.evaluate(() => document.querySelector('#restBar').hidden));
  await page.evaluate(() => { Date.now = window.__real; });

  // a full storage box says so instead of swallowing the tap
  await page.evaluate(() => {
    window.__set = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.querySelector('.set-done').classList.contains('is-on')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  const warn = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  t.check('running out of storage is reported', /out of storage/.test(warn), warn);
  t.check('and the app keeps working', await page.evaluate(() => {
    document.querySelector('#wkMin').click();
    return !document.body.classList.contains('wk-open');
  }));
  await page.evaluate(() => { localStorage.setItem = window.__set; });

  // the feel: a buzz and a flash when a set lands, and a switch to silence it
  const openLogger = async () => {
    await page.evaluate(() => { const m = document.querySelector('#miniExpand'); if (m) m.click(); });
    await page.waitForTimeout(450);
  };
  await openLogger();
  await page.evaluate(() => { window.__buzz = []; navigator.vibrate = (v) => { window.__buzz.push(JSON.stringify(v)); return true; }; });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.classList.contains('logged')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  const feel = await page.evaluate(() => {
    const row = document.querySelector('.set-row.just-logged');
    return { buzz: window.__buzz.length, flash: !!row,
      anim: row ? getComputedStyle(row).animationName : '' };
  });
  t.check('logging a set buzzes', feel.buzz > 0, String(feel.buzz));
  t.check('and the row lights up', feel.flash && feel.anim === 'row-flash', feel.anim);

  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.settings.haptics = false;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await openLogger();
  await page.evaluate(() => { window.__buzz = []; navigator.vibrate = (v) => { window.__buzz.push(JSON.stringify(v)); return true; }; });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.classList.contains('logged')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  t.equal('vibration can be switched off', await page.evaluate(() => window.__buzz.length), 0);

  // a warm-up not earning a rest, and the cursor moving on
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.activeWorkout = { id: 'wq', name: 'Push day', startedAt: Date.now() - 6e5,
      exercises: [{ exerciseId: 'bench-press', sets: [
        { weight: 40, reps: 10, done: false, type: 'W' },
        { weight: 80, reps: 8, done: false },
        { weight: 80, reps: 8, done: false }] }] };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(700);
  await page.click('.set-row[data-set="0"] .set-done');
  await page.waitForTimeout(450);
  t.check('a warm-up does not start the rest timer', await page.evaluate(() => document.querySelector('#restBar').hidden));
  await page.click('.set-row[data-set="1"] .in-weight');
  await page.waitForTimeout(200);
  await page.click('.set-row[data-set="1"] .set-done');
  await page.waitForTimeout(500);
  t.check('a working set does', await page.evaluate(() => !document.querySelector('#restBar').hidden));
  t.equal('and nothing else takes the keyboard',
    await page.evaluate(() => document.activeElement?.closest?.('.set-row')?.dataset.set ?? 'none'), 'none');

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
