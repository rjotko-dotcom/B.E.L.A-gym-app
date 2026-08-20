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
  // one that actually has a session in it.
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date(st.workouts[0].startedAt);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
