/* Programs, progression and what the history says: a plan that fills in the
   weights, 5/3/1 off a training max, a stalled lift spotted and deloaded,
   and the insights card. The seed's bench press has six identical sessions
   (80 kg × 8, 8, 7) — a textbook stall. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });
  const tab = (x) => page.evaluate((k) => document.querySelector('.tab[data-tab="' + k + '"]').click(), x);
  await tab('workout');
  await page.waitForTimeout(900);

  // ---- insights ----
  const ins = await page.textContent('.ins-card');
  t.check('a stalled lift is spotted', /Barbell Bench Press has stalled/.test(ins), ins.slice(0, 120));
  t.check('the streak is told', /week streak/.test(ins));

  await page.click('[data-deload="bench-press"]');
  await page.waitForTimeout(500);
  const until = (await readState(page)).exPrefs['bench-press'].deloadUntil;
  t.check('deloading is set for a week', until > Date.now() + 6 * 864e5 && until < Date.now() + 8 * 864e5);
  t.check('and the stall stops being reported', !/Bench Press has stalled/.test(await page.evaluate(() => document.querySelector('.ins-card')?.textContent || '')));

  // a deload session: 90% of the last top weight, rounded to the bar
  await page.evaluate(() => document.querySelector('[data-tpl="tpl-push"]').click());
  await page.waitForTimeout(800);
  let w = (await readState(page)).activeWorkout;
  t.equal('the deloaded lift comes in at 90%', w.exercises[0].sets[0].targetW, 72.5);
  t.check('and says so on its card', /DELOAD/.test(await page.textContent('.ex-block')));
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.activeWorkout = null; delete st.exPrefs['bench-press'];
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(700);

  // ---- a double-progression program ----
  await tab('workout');
  await page.waitForTimeout(700);
  t.check('there is a way into programs', /Follow a program/.test(await page.textContent('#progOpen')));
  await page.click('#progOpen');
  await page.waitForTimeout(500);
  t.equal('four programs are offered', await page.evaluate(() => document.querySelectorAll('#sheetRoot .prog-item').length), 4);
  await page.click('[data-prog="ppl6"]');
  await page.waitForTimeout(500);
  await page.click('#cfYes');
  await page.waitForTimeout(700);
  let st = await readState(page);
  t.equal('starting it remembers the program', st.settings.program.id, 'ppl6');
  t.check('and writes its routines in', ['push', 'pull', 'legs'].every((k) => st.templates.some((x) => x.id === 'prog:ppl6:' + k)));
  t.equal('and lays out the week', st.schedule.join(','), 'prog:ppl6:push,prog:ppl6:pull,prog:ppl6:legs,prog:ppl6:push,prog:ppl6:pull,prog:ppl6:legs,rest');
  t.check('the card shows the week', /Push · Pull · Legs/.test(await page.textContent('#progOpen')) && /Week 1/.test(await page.textContent('#progOpen')));

  await page.evaluate(() => document.querySelector('[data-tpl="prog:ppl6:push"]').click());
  await page.waitForTimeout(800);
  w = (await readState(page)).activeWorkout;
  const bench = w.exercises.find((e) => e.exerciseId === 'bench-press');
  t.check('sets carry the rep range', bench.sets.every((x) => x.target === 6 && x.targetMax === 8));
  t.equal('and the weight to lift', bench.sets[0].targetW, 80);
  t.equal('the box shows it', await page.evaluate(() => document.querySelector('.ex-block .in-weight').placeholder), '80');

  // ---- 5/3/1 off a training max ----
  await page.evaluate(() => {
    const s2 = JSON.parse(localStorage.getItem('bela-gym-v1'));
    s2.activeWorkout = null;
    localStorage.setItem('bela-gym-v1', JSON.stringify(s2));
  });
  await page.reload();
  await page.waitForTimeout(700);
  await tab('workout');
  await page.waitForTimeout(600);
  await page.click('#progOpen');
  await page.waitForTimeout(500);
  await page.click('[data-prog="w531"]');
  await page.waitForTimeout(400);
  await page.click('#cfYes');
  await page.waitForTimeout(700);
  st = await readState(page);
  // best bench e1RM 80×8 → 101.3; 90% → 91.2 → 90 on the bar
  t.equal('the training max is 90% of the best, on the bar', st.settings.program.tm['bench-press'], 90);
  t.check('the old program\'s routines are gone', !st.templates.some((x) => String(x.id).startsWith('prog:ppl6')));
  await page.evaluate(() => document.querySelector('[data-tpl="prog:w531:bench"]').click());
  await page.waitForTimeout(800);
  w = (await readState(page)).activeWorkout;
  const main = w.exercises[0];
  t.equal('week one is 65 / 75 / 85%', main.sets.map((x) => x.targetW).join(','), '57.5,67.5,77.5');
  t.check('the last set is as many as you can', main.sets[2].plus && !main.sets[0].plus);
  t.equal('it reads 5+', await page.evaluate(() => document.querySelectorAll('.ex-block')[0].querySelectorAll('.in-reps')[2].placeholder), '5+');
  t.check('the session says which week', /5s week/.test(w.name), w.name);

  // ---- ending it ----
  await page.evaluate(() => {
    const s2 = JSON.parse(localStorage.getItem('bela-gym-v1'));
    s2.activeWorkout = null;
    localStorage.setItem('bela-gym-v1', JSON.stringify(s2));
  });
  await page.reload();
  await page.waitForTimeout(700);
  await tab('workout');
  await page.waitForTimeout(600);
  await page.click('#progOpen');
  await page.waitForTimeout(500);
  await page.click('#progEnd');
  await page.waitForTimeout(400);
  await page.click('#cfYes');
  await page.waitForTimeout(600);
  st = await readState(page);
  t.check('ending removes its routines', !st.templates.some((x) => String(x.id).startsWith('prog:')));
  t.check('and its days', !st.schedule.some((x) => x && String(x).startsWith('prog:')));
  t.check('and forgets it', !st.settings.program);
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
