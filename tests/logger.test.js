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

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
