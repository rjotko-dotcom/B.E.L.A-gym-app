/* Habits: both views, the completion fills, linked habits that fill
   themselves, the keypad, and a day opened from the calendar. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  const page = await openApp(t.browser, { url: server.url, seed });

  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(450);

  const cal = await page.evaluate(() => ({
    days: document.querySelectorAll('.hc-day').length,
    fits: document.documentElement.scrollHeight <= window.innerHeight + 1,
    fills: [...document.querySelectorAll('.hc-fill')].map((f) => f.style.height).slice(0, 3),
  }));
  t.check('the calendar shows a whole month', cal.days >= 28);
  t.check('the habits page fits on one screen', cal.fits);
  t.check('partly-done days are filled proportionally', cal.fills.every((h) => /%$/.test(h)));

  // A perfect day is green. Train is linked to workouts, so the day has to be
  // one that actually has a session in it — and it has to be a day the calendar
  // is showing, which the newest seeded workout is not on the 1st of a month.
  // So give today a session of its own rather than hunting for one.
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    st.workouts.push({
      ...st.workouts[0],
      id: 'w_today',
      startedAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0).getTime(),
      finishedAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 19, 10).getTime(),
    });
    st.habitLog[key] = { h_steps: 12000, h_read: 30, h_sleep: 1 };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(400);
  const colour = await page.evaluate(() => {
    const cell = document.querySelector('.hc-day.is-full');
    return cell ? getComputedStyle(cell).backgroundColor : null;
  });
  t.check('a day with everything done turns green', colour && /134, 239, 172|52, 199, 89/.test(colour), String(colour));

  // switching views and remembering the choice
  await page.click('#hbViewBtn');
  await page.waitForTimeout(450);
  t.check('the list view shows a column per habit', await page.evaluate(() => !!document.querySelector('.hb-grid')));
  t.equal('the view choice is saved', (await readState(page)).settings.habitView, 'list');
  await page.reload();
  await page.waitForTimeout(450);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(400);
  t.check('and survives a reload', await page.evaluate(() => !!document.querySelector('.hb-grid')));
  await page.click('#hbViewBtn');
  await page.waitForTimeout(400);

  // linked habits fill themselves and cannot be ticked by hand
  const train = await page.evaluate(() => {
    const row = document.querySelector('.hb-row[data-habit="h_train"]');
    return row ? { auto: row.classList.contains('is-auto'), plus: !!row.querySelector('.hb-plus') } : null;
  });
  t.check('a linked habit is marked as automatic', train && train.auto);
  t.check('a linked habit has no manual + button', train && !train.plus);

  // the keypad
  await page.click('.hb-row[data-habit="h_read"]');
  await page.waitForTimeout(400);
  t.equal('the keypad opens for amount habits', await page.evaluate(() => document.querySelectorAll('.pad-key').length), 12);
  await page.click('.pad-key[data-k="1"]');
  await page.click('.pad-key[data-k="8"]');
  await page.click('#padSave');
  await page.waitForTimeout(450);
  const todayKey = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  t.equal('typing replaces rather than appends', (await readState(page)).habitLog[todayKey].h_read, 18);

  // a day from the calendar
  await page.click('.hc-day:not(.is-future)');
  await page.waitForTimeout(450);
  t.check('a calendar day opens its habits', await page.evaluate(() => document.querySelectorAll('.hb-row').length > 0));

  // ---- reordering ----
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(400);
  const habitNames = () => page.evaluate(() => [...document.querySelectorAll('.hb-row .hb-name')].map((n) => n.textContent));
  const originalOrder = await habitNames();
  await page.click('#hbReorder');
  await page.waitForTimeout(400);
  t.equal('reorder mode shows a handle pair per habit',
    await page.evaluate(() => document.querySelectorAll('.hb-move').length), originalOrder.length * 2);
  t.check('the first habit cannot move up',
    await page.evaluate(() => document.querySelector('.hb-move[data-move="-1"]').disabled));
  await page.evaluate(() => document.querySelectorAll('.hb-row')[2].querySelector('[data-move="-1"]').click());
  await page.waitForTimeout(350);
  const moved = await habitNames();
  t.equal('a habit moves up one place', moved[1], originalOrder[2]);
  t.equal('the order is saved', (await readState(page)).habits[1].name, originalOrder[2]);
  const logBefore = JSON.stringify((await readState(page)).habitLog);
  await page.click('.hb-row');
  await page.waitForTimeout(300);
  t.equal('tapping a row while reordering does not log anything',
    JSON.stringify((await readState(page)).habitLog), logBefore);
  await page.click('#hbReorder');
  await page.waitForTimeout(400);
  t.equal('leaving reorder mode restores the actions',
    await page.evaluate(() => document.querySelectorAll('.hb-move').length), 0);
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);
  t.equal('home follows the new order',
    await page.evaluate(() => document.querySelector('.hs-cell').getAttribute('aria-label')), moved[0]);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(400);

  // ---- rest days: a habit that is not due today must not count as missed ----
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const dk = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const read = st.habits.find((h) => h.id === 'h_read');
    // due only on the weekday two days ago and today's weekday, so we can be
    // sure at least one recent day is a skip
    const idx = (n) => (new Date(Date.now() - n * 86400000).getDay() + 6) % 7;
    read.due = 'days';
    read.days = [false, false, false, false, false, false, false];
    read.days[idx(0)] = true;
    read.days[idx(2)] = true;
    // done on every due day for the last three weeks, never on the others
    for (let i = 0; i <= 21; i++) {
      const key = dk(new Date(Date.now() - i * 86400000));
      st.habitLog[key] = st.habitLog[key] || {};
      if (read.days[idx(i)]) st.habitLog[key].h_read = 25; else delete st.habitLog[key].h_read;
    }
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(450);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(450);

  const dueState = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.hb-row')];
    const read = rows.find((r) => r.querySelector('.hb-name').textContent === 'Read');
    return {
      heading: document.querySelector('.page-head .subtitle').textContent,
      off: read.classList.contains('is-off'),
      sub: read.querySelector('.hb-sub').textContent,
      total: document.querySelectorAll('.hb-row').length,
    };
  });
  const dueToday = /^(\d+) of (\d+)/.exec(dueState.heading);
  t.check('a habit that is not due today is left out of the count',
    dueState.off ? Number(dueToday[2]) < dueState.total : Number(dueToday[2]) === dueState.total,
    dueState.heading + ' with ' + dueState.total + ' habits');
  if (dueState.off) t.check('and says it is a rest day', /Rest day/.test(dueState.sub), dueState.sub);

  const streakKept = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.hb-row')];
    const read = rows.find((r) => r.querySelector('.hb-name').textContent === 'Read');
    return read.querySelector('.hb-sub').textContent;
  });
  t.check('skipped days do not break the streak', /\d+ day streak/.test(streakKept), streakKept);

  // the editor exposes the three modes
  await page.evaluate(() => {
    const row = document.querySelector('.hb-row[data-habit="h_read"]');
    const touch = new Touch({ identifier: 1, target: row, clientX: 100, clientY: 100 });
    row.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true }));
  });
  await page.waitForTimeout(750);
  t.equal('the editor offers every day, training days and pick days',
    await page.evaluate(() => document.querySelectorAll('#hbDue button').length), 3);
  await page.click('#hbDue button[data-due="plan"]');
  await page.waitForTimeout(250);
  await page.click('#hbSave');
  await page.waitForTimeout(600);
  t.equal('the choice is saved', (await readState(page)).habits.find((h) => h.id === 'h_read').due, 'plan');

  // importing a Samsung Health export into a habit
  const fs = require('fs'), os = require('os'), path = require('path');
  const csvPath = path.join(os.tmpdir(), 'bela-pedometer-test.csv');
  const rows = ['com.samsung.shealth.tracker.pedometer_day_summary,1,',
    'create_time,update_time,day_time,step_count,distance,calorie'];
  const midnight = new Date(); midnight.setHours(12, 0, 0, 0);
  for (let i = 1; i <= 6; i++) {
    rows.push('"a","b",' + (midnight.getTime() - i * 86400000) + ',' + (7000 + i * 137) + ',1,1');
  }
  fs.writeFileSync(csvPath, rows.join('\n'));

  await page.evaluate(() => { const s = document.querySelector('[data-close]'); if (s) s.click(); });
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const row = document.querySelector('.hb-row[data-habit="h_steps"]');
    const touch = new Touch({ identifier: 1, target: row, clientX: 100, clientY: 100 });
    row.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true }));
  });
  await page.waitForTimeout(750);
  const canImport = await page.evaluate(() => !!document.querySelector('#hbImport'));
  t.check('an amount habit offers a file import', canImport);
  if (canImport) {
    await page.click('#hbImport');
    await page.waitForTimeout(400);
    await page.setInputFiles('#impFile', csvPath);
    await page.waitForTimeout(600);
    const preview = await page.evaluate(() => document.querySelector('.imp-ok')?.textContent || '');
    t.check('the export is parsed and previewed', /6 days/.test(preview), preview.trim());
    await page.click('#impGo');
    await page.waitForTimeout(600);
    const log = (await readState(page)).habitLog;
    const imported = Object.values(log).filter((d) => d.h_steps >= 7137).length;
    t.check('the days land in the habit', imported >= 6, 'found ' + imported);
  }
  fs.unlinkSync(csvPath);

  // a new habit can be given the toothbrush icon, and it renders as a drawing
  await page.evaluate(() => { const s = document.querySelector('[data-close]'); if (s) s.click(); });
  await page.waitForTimeout(350);
  await page.click('#hbAdd');
  await page.waitForTimeout(350);
  const hasTooth = await page.evaluate(() => !!document.querySelector('.ip-btn[data-icon="toothbrush"] svg path'));
  t.check('the icon picker offers a toothbrush', hasTooth);
  if (hasTooth) {
    await page.fill('#hbName', 'Brush teeth');
    await page.click('.ip-btn[data-icon="toothbrush"]');
    await page.click('#hbSave');
    await page.waitForTimeout(450);
    const saved = (await readState(page)).habits.find((h) => h.name === 'Brush teeth');
    t.equal('the habit keeps the icon it was given', saved && saved.icon, 'toothbrush');
    const drawn = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.hb-row')].find((r) => /Brush teeth/.test(r.textContent));
      const svg = row && row.querySelector('.hb-ico svg');
      return svg ? svg.getBBox().width : 0;
    });
    t.check('the row draws the icon inside the box', drawn > 8 && drawn < 24, String(drawn));
  }

  // a counted habit that reaches its goal is marked done, not left as a circle
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    st.nutrition.targets = { kcal: 2800, protein: 180, carbs: 300, fat: 70 };
    st.nutrition.meals = [{ id: 'p', date: key, slot: 'lunch', time: '13:00', name: 'Day', kcal: 2100, protein: 181, carbs: 200, fat: 50 }];
    st.habits = [
      { id: 'hp', name: 'Protein', icon: 'heart', type: 'count', target: 180, unit: 'g', step: 10, source: 'protein', due: 'daily' },
      { id: 'hk', name: 'Calories', icon: 'flame', type: 'count', target: 2800, unit: 'kcal', step: 100, source: 'kcal', due: 'daily' },
    ];
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(450);
  const autoRows = await page.evaluate(() => {
    const pick = (name) => {
      const r = [...document.querySelectorAll('.hb-row')].find((x) => x.textContent.includes(name));
      return { done: r.classList.contains('is-done'), tick: !!r.querySelector('.hb-tick'),
        full: /is-full/.test(r.querySelector('.hb-ring-svg')?.getAttribute('class') || '') };
    };
    return { protein: pick('Protein'), kcal: pick('Calories') };
  });
  t.check('181 g against a 180 g goal counts as done', autoRows.protein.done, JSON.stringify(autoRows.protein));
  t.check('the ring closes and takes a tick', autoRows.protein.tick && autoRows.protein.full);
  t.check('a habit still short of its goal keeps its open ring', !autoRows.kcal.done && !autoRows.kcal.tick);

  // holding a habit opens its settings instead of logging it
  await page.evaluate(() => document.querySelector('.hb-row').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  await page.waitForTimeout(450);
  const held = await page.evaluate(() => document.querySelector('#sheetRoot')?.textContent || '');
  t.check('a long press opens the habit\'s record', /Streak/.test(held) && /Best/.test(held), held.slice(0, 60));
  t.equal('with four weeks of days', await page.evaluate(() => document.querySelectorAll('.hd-cell').length), 28);
  await page.click('#hdEdit');
  await page.waitForTimeout(500);
  t.check('and a way through to its settings', /Edit habit/.test(await page.evaluate(() => document.querySelector('#sheetRoot')?.textContent || '')));
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);

  // closing the last habit of the day is marked once
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    st.habits = [
      { id: 'c1', name: 'Stretch', icon: 'heart', type: 'check', target: 1, step: 1, due: 'daily' },
      { id: 'c2', name: 'Sleep 8h', icon: 'sleep', type: 'check', target: 1, step: 1, due: 'daily' },
    ];
    st.habitLog = { [key]: { c1: 1 } };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(650);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(450);
  await page.click('.hb-row:not(.is-done)');
  await page.waitForTimeout(300);
  t.check('the last habit of the day is celebrated', await page.evaluate(() => !!document.querySelector('.celebrate')));
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);
  t.check('and only once', await page.evaluate(() => !document.querySelector('.celebrate')));

  t.equal('no page errors', page.errors.length, 0);
  await page.close();

  /* ---- a habit within reach of its target says so ----
     Four grams short of a protein goal read the same as none of it done. */
  {
    const near = build();
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    near.nutrition.targets = { kcal: 2100, protein: 170, carbs: 210, fat: 65 };
    near.nutrition.meals = [{ id: 'x', date: key, slot: 'breakfast', time: '08:00', name: 'Day',
      kcal: 2110, protein: 166, carbs: 199, fat: 68 }];
    near.habits = [
      { id: 'h_pro', name: 'Protein', icon: 'heart', source: 'protein' },
      { id: 'h_kcal', name: 'Calories', icon: 'flame', source: 'kcal' },
      { id: 'h_steps', name: 'Steps', icon: 'steps', type: 'count', target: 10000, unit: 'steps', step: 1000 },
      { id: 'h_read', name: 'Read', icon: 'book', type: 'count', target: 20, unit: 'pages', step: 5 },
    ];
    near.habitLog = { [key]: { h_steps: 9700, h_read: 5 } };
    const p2 = await openApp(t.browser, { url: server.url, seed: near });
    await p2.click('.tab[data-tab="habits"]');
    await p2.waitForTimeout(700);
    const rings = await p2.evaluate(() => {
      const out = {};
      document.querySelectorAll('.hb-row').forEach((r) => {
        const name = r.querySelector('.hb-name, b')?.textContent?.trim();
        const svg = r.querySelector('.hb-ring-svg');
        out[name] = [...(svg?.classList || [])].filter((c) => c.startsWith('is-')).join() || 'plain';
      });
      return out;
    });
    t.equal('four grams short reads as nearly there', rings.Protein, 'is-near');
    t.equal('a target met is still full', rings.Calories, 'is-full');
    t.equal('and three hundred steps short is near too', rings.Steps, 'is-near');
    t.equal('but a quarter of the way is plain', rings.Read, 'plain');
    t.check('nearly there is not a tick', await p2.evaluate(() => {
      const row = [...document.querySelectorAll('.hb-row')].find((r) => /Protein/.test(r.textContent));
      return !row.querySelector('.hb-tick');
    }));
    t.equal('no page errors', p2.errors.length, 0);
    await p2.close();
  }

  await server.close();
};
