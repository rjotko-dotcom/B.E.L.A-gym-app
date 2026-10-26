/* 16.6, the trainer around the coach: what fits today (recovery), the body's
   Recovery view, how long a session takes and trimming it when short on
   time, same-muscle alternatives when replacing, and where the main lifts
   stand. The seed: bench pressed yesterday and five times before, nothing
   else; Push Day planned for today. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  seed.workouts[0].exercises[0].sets[0].pr = true;       // a record yesterday, for the timeline
  let page = await openApp(t.browser, { url: server.url, seed });

  // ---- what fits today ----
  const coach = await page.evaluate(() => document.querySelector('#coachToday')?.textContent || '');
  t.check('home says what fits better today', /Pull Day fits better today/.test(coach) && /chest/.test(coach), coach);
  t.equal('and leaves the plan on the big button', (await page.textContent('#homeStart')).trim(), 'Start Push Day');
  await page.click('#coachToday');
  await page.waitForTimeout(700);
  t.equal('a tap starts that routine', (await readState(page)).activeWorkout.name, 'Pull Day');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('bela-gym-v1')); s.activeWorkout = null; localStorage.setItem('bela-gym-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(600);

  // ---- the Recovery view ----
  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#mbView [data-v="recovery"]').click());
  await page.waitForTimeout(500);
  const cap = await page.evaluate(() => document.querySelector('.mb-card .mm-cap').textContent);
  t.check('Recovery names what is still recovering', /Chest is still recovering|muscles are still recovering/.test(cap), cap);
  t.check('with its own legend', /Ready/.test(await page.textContent('.mb-card .mm-legend')));
  t.check('the routine cards say how long they take', await page.evaluate(() =>
    [...document.querySelectorAll('.tpl-item .li-sub')].every((x) => /^~\d+ min · /.test(x.textContent))));

  // ---- short on time ----
  await page.evaluate(() => document.querySelector('[data-tpl="tpl-push"]').click());
  await page.waitForTimeout(800);
  const leftText = await page.getAttribute('#wkShort', 'aria-label');
  const before = Number((leftText.match(/about (\d+) min/) || [])[1]);
  t.check('Short on time sits in the bar beside the timer', await page.evaluate(() => document.querySelector('.wk-bar #wkShort')?.nextElementSibling?.id === 'wkTimer'));
  t.check('and knows how long is left', before >= 30, leftText);
  await page.click('#wkShort');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#sheetRoot [data-min="30"]').click());
  await page.waitForTimeout(500);
  const after = Number(((await page.getAttribute('#wkShort', 'aria-label')).match(/about (\d+) min/) || [])[1]);
  const w = (await readState(page)).activeWorkout;
  t.check('trimmed to about the time there is', after <= 35 && after < before, before + ' → ' + after);
  t.check('the heavy lift is left whole', w.exercises[0].exerciseId === 'bench-press' && w.exercises[0].sets.filter((x) => x.type !== 'W').length === 4);
  t.check('accessories paired or cut first', w.exercises.some((e) => e.ss) || w.exercises.length < 5);

  // ---- replace: the same muscles first ----
  await page.evaluate(() => document.querySelector('.ex-block .ex-menu').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#sheetRoot [data-act="replace"]').click());
  await page.waitForTimeout(500);
  t.check('the picker is for replacing', /Replace exercise/.test(await page.textContent('#sheetRoot h3')));
  const sims = await page.evaluate(() => [...document.querySelectorAll('#pickSim .lib-item')].map((x) => x.dataset.pick + ':' + x.querySelector('.li-sub').textContent));
  t.check('chest-first exercises come first', sims.length >= 3 && sims.slice(0, 3).every((x) => /· Chest/.test(x)), sims.join(' | '));
  t.check('a straight chest press before a triceps-heavy one', sims.findIndex((x) => x.startsWith('incline-db-press')) < sims.findIndex((x) => x.startsWith('dips') || x.startsWith('close-grip-bench')) ||
    !sims.some((x) => x.startsWith('dips') || x.startsWith('close-grip-bench')), sims.join(' | '));
  await page.evaluate(() => document.querySelector('#pickSim [data-eq="Dumbbell"]')?.click());
  await page.waitForTimeout(200);
  const dbOnly = await page.evaluate(() => [...document.querySelectorAll('#pickSim .lib-item .li-sub')].map((x) => x.textContent));
  t.check('and can be narrowed to the equipment that is free', dbOnly.length > 0 && dbOnly.every((x) => /^Dumbbell/.test(x)), dbOnly.join('|'));
  await page.evaluate(() => document.querySelector('#pickSim .lib-item').click());
  await page.waitForTimeout(500);
  t.check('a pick replaces the exercise', (await readState(page)).activeWorkout.exercises[0].exerciseId !== 'bench-press');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('bela-gym-v1')); s.activeWorkout = null; localStorage.setItem('bela-gym-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(600);

  // ---- strength levels and records ----
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#homeAvatar').click());
  await page.waitForTimeout(600);
  const sl = await page.evaluate(() => document.querySelector('.sl-card')?.textContent || '');
  // 80 × 8 → est. 1RM 101.3; bodyweight 78.3 → 1.29× → Intermediate; Advanced at 1.5× = 117.5
  t.check('the bench sits at Intermediate', /Barbell Bench Press\s*Intermediate/.test(sl), sl.slice(0, 160));
  t.check('with the weight for the next level', /Advanced at 117\.5 kg/.test(sl));
  const rec = await page.evaluate(() => document.querySelector('.rec-card')?.textContent || '');
  t.check('records are listed, newest first', /Barbell Bench Press\s*80 kg × 8/.test(rec), rec.slice(0, 120));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
