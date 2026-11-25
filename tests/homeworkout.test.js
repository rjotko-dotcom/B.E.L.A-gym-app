/* 16.12, home workouts: a day he cannot get to the gym, or is too busy,
   still trains. Follow-along sessions with a timer (every move that runs
   out is a timed set) and his own YouTube videos, the 10-minute sixpack one
   already on the list. Both are saved as workouts like any other. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, {
    url: server.url, seed: build(),
    init: () => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; },
  });
  await page.route('**/i.ytimg.com/**', (r) => r.abort());
  await page.route('**/www.youtube.com/oembed**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ title: '15 MIN LOWER ABS // No Equipment', author_name: 'Some Coach' }) }));
  await page.clock.install();

  // the timeline itself
  t.equal('a ten-minute session is ten minutes', await page.evaluate(() => Math.round(BelaHome.totalSecs(BelaHome.SESSIONS[0]) / 60)), 10);
  t.equal('every YouTube spelling is read', await page.evaluate(() => [
    'https://youtu.be/Q-vuR4PJh2c?si=x', 'https://www.youtube.com/watch?v=Q-vuR4PJh2c&t=3', 'https://m.youtube.com/shorts/Q-vuR4PJh2c',
  ].map(BelaHome.youtubeId).join()), 'Q-vuR4PJh2c,Q-vuR4PJh2c,Q-vuR4PJh2c');
  t.check('every move has a name and a how-to', await page.evaluate(() =>
    BelaHome.SESSIONS.every((s) => s.moves.every((m) => EXERCISE_LIBRARY.some((e) => e.id === m) && EXERCISE_GUIDE[m] && EXERCISE_GUIDE[m].how))));

  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await page.waitForTimeout(400);
  t.check('Workouts has a Home workout card', !!(await page.$('#wkHome')));
  await page.click('#wkHome');
  await page.waitForTimeout(500);
  t.equal('five follow-along sessions', (await page.$$('[data-hs]')).length, 5);
  t.check('his sixpack video is on the list', /10 min sixpack/.test(await page.textContent('#hvList')) && /Pamela Reif/.test(await page.textContent('#hvList')));

  // run the abs session: get ready, two moves through, then end
  const before = (await readState(page)).workouts.length;
  await page.click('[data-hs="home-abs"]');
  await page.waitForTimeout(200);
  t.check('the player opens on "Get ready"', /Get ready/i.test(await page.textContent('#homeRun .hr-phase')));
  t.equal('the sheet is gone', await page.evaluate(() => document.querySelector('#sheetRoot').children.length), 0);
  await page.clock.runFor(10_500);
  t.check('then the first move', /Work/i.test(await page.textContent('#homeRun .hr-phase')) && /Crunch/.test(await page.textContent('#homeRun .hr-name')));
  t.check('with the next one named', /Next · Reverse Crunch/.test(await page.textContent('#homeRun .hr-next')));
  await page.click('#hrPause');
  await page.clock.runFor(60_000);
  t.check('pause holds the clock', /Work/i.test(await page.textContent('#homeRun .hr-phase')) && /Crunch/.test(await page.textContent('#homeRun .hr-name')));
  await page.click('#hrPause');
  await page.clock.runFor(45_000 + 15_000 + 45_500);
  t.check('two moves later it is resting', /Rest/i.test(await page.textContent('#homeRun .hr-phase')) && /Bicycle Crunch/.test(await page.textContent('#homeRun .hr-name')));
  await page.click('#hrNext');   // skipping a rest, then a move, counts nothing
  await page.click('#hrNext');
  await page.waitForTimeout(100);
  await page.click('#hrClose');
  await page.waitForTimeout(300);
  t.check('ending asks first, and says what is kept', /2 moves are done/.test(await page.textContent('#sheetRoot .confirm-msg')));
  await page.click('#cfYes');
  await page.waitForTimeout(500);
  t.check('the player is gone', !(await page.$('#homeRun')));
  let st = await readState(page);
  const w = st.workouts[0];
  t.check('saved as a workout at home', st.workouts.length === before + 1 && w.home && w.home.kind === 'timer' && w.name === 'Home · Abs', JSON.stringify(w).slice(0, 200));
  t.check('each finished move is a 45 s set', w.exercises.length === 2 && w.exercises[0].exerciseId === 'crunch' && w.exercises[1].sets[0].secs === 45 && w.exercises.every((e) => e.sets.every((s) => s.done)),
    JSON.stringify(w.exercises));
  t.check('the summary counts moves, not volume', /Workout complete/.test(await page.textContent('#sheetRoot h3')) && /Moves\s*2/.test(await page.textContent('#sheetRoot .sm-stats')) && /45 s/.test(await page.textContent('#sheetRoot .sm-list')));
  await page.click('#smDone');
  await page.waitForTimeout(400);

  // the back button mid-session asks too, and cancelling carries on
  await page.click('#wkHome');
  await page.waitForTimeout(400);
  await page.click('[data-hs="home-hiit"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  t.check('back asks before ending', !!(await page.$('#homeRun')) && /End the session/.test(await page.textContent('#sheetRoot h3')));
  await page.click('#cfNo');
  await page.waitForTimeout(400);
  t.check('cancel carries on', !!(await page.$('#homeRun')) && !(await page.evaluate(() => document.querySelector('#sheetRoot').children.length)));
  await page.click('#hrClose');
  await page.waitForTimeout(300);
  await page.click('#cfYes');
  await page.waitForTimeout(400);
  t.equal('nothing done, nothing saved', (await readState(page)).workouts.length, before + 1);

  // the video
  await page.click('#wkHome');
  await page.waitForTimeout(400);
  await page.click('[data-hv="v-sixpack"]');
  await page.waitForTimeout(400);
  await page.click('#hvPlay');
  t.equal('play opens YouTube outside the app', (await page.evaluate(() => window.__opened)).join(), 'https://youtu.be/Q-vuR4PJh2c');
  t.check('then logging it is the main button', await page.evaluate(() => document.querySelector('#hvLog').classList.contains('btn-primary')));
  await page.click('#hvLog');
  await page.waitForTimeout(500);
  st = await readState(page);
  const v = st.workouts[0];
  t.check('logged as ten minutes of core', v.home && v.home.kind === 'video' && v.home.min === 10 && v.home.focus === 'Core' && v.finishedAt - v.startedAt === 600000, JSON.stringify(v));
  t.check('its summary has no share and no empty body', !(await page.$('#smShare')) && !(await page.$('#sheetRoot .sm-map')));
  await page.click('#smDone');
  await page.waitForTimeout(300);

  // adding one: the name and minutes come from YouTube
  await page.click('#wkHome');
  await page.waitForTimeout(400);
  await page.click('#hvAdd');
  await page.waitForTimeout(400);
  await page.fill('#hvUrl', 'https://www.youtube.com/watch?v=abcdefghijk&si=zz');
  await page.dispatchEvent('#hvUrl', 'change');
  await page.waitForTimeout(400);
  t.equal('the title is filled in', await page.inputValue('#hvName'), '15 MIN LOWER ABS');
  t.equal('and its minutes', await page.inputValue('#hvMin'), '15');
  await page.click('#hvFocus [data-f="Legs"]');
  await page.click('#hvSave');
  await page.waitForTimeout(400);
  st = await readState(page);
  const added = st.settings.homeVideos.find((x) => x.url === 'https://youtu.be/abcdefghijk');
  t.check('saved in settings, so it syncs', !!added && added.by === 'Some Coach' && added.focus === 'Legs' && st.settings.homeVideos.length === 2, JSON.stringify(st.settings.homeVideos));
  t.check('and listed', /15 MIN LOWER ABS/.test(await page.textContent('#hvList')));

  // history reads both
  await page.evaluate(() => { document.querySelector('#sheetRoot').innerHTML = ''; });
  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await page.click('#wkLast');
  await page.waitForTimeout(500);
  const hist = await page.textContent('#view');
  t.check('history shows the video', /10 min sixpack/.test(hist) && /Video/.test(hist));
  t.check('and the timed session', /Home · Abs/.test(hist));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
