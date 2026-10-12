/* The 16.0 design pass: the typeface, the calendar's columns, the sliding
   markers, sheets that leave rather than vanish, the logger's progress line,
   and that none of the motion runs for someone who asked for less of it. */
const { openApp } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });

  t.check('Inter is loaded and set', await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 16px Inter') && /Inter/.test(getComputedStyle(document.body).fontFamily);
  }));
  t.check('buttons set the same face as the page', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.tab')).fontFamily === getComputedStyle(document.body).fontFamily));

  t.check('the calories card reads from the left', await page.evaluate(() =>
    getComputedStyle(document.querySelector('#kcalCard')).textAlign === 'left'));

  // the tab marker: one pill, and it moves to the tab you pick
  const indX = () => page.evaluate(() => {
    const i = document.querySelector('.tab-ind');
    return i ? Math.round(i.getBoundingClientRect().left) : null;
  });
  const homeX = await indX();
  t.check('the tab bar has one marker', homeX != null && await page.evaluate(() => document.querySelectorAll('.tab-ind').length === 1));
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(700);
  const habitsX = await indX();
  t.check('and it slides to the tab picked', habitsX > homeX + 100, homeX + ' → ' + habitsX);
  t.check('it sits under that tab\'s icon', await page.evaluate(() => {
    const i = document.querySelector('.tab-ind').getBoundingClientRect();
    const s = document.querySelector('.tab[data-tab="habits"] svg').getBoundingClientRect();
    return Math.abs((i.left + i.width / 2) - (s.left + s.width / 2)) < 2;
  }));

  // every column of the habits calendar is the same width
  const cols = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.hc-grid > *')].slice(0, 14);
    return [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().width)))];
  });
  t.equal('the habits calendar has equal columns', cols.length, 1);

  // the page rises in on arrival, and lets go of it afterwards
  t.check('arriving on a tab plays the entrance', await page.evaluate(() => {
    document.querySelector('.tab[data-tab="meals"]').click();
    return document.querySelector('#view').classList.contains('view-enter');
  }));
  await page.waitForTimeout(1000);
  t.check('and the entrance is cleared once played', await page.evaluate(() =>
    !document.querySelector('#view').classList.contains('view-enter')));

  // sheets: closed at once for the app, the exit plays in a layer of its own
  await page.click('#addMeal');
  await page.waitForTimeout(500);
  const segThumb = await page.evaluate(() => {
    const seg = document.querySelector('#sheetRoot .seg');
    const th = seg && seg.querySelector('.seg-thumb');
    const on = seg && seg.querySelector('button.is-on, button.on');
    if (!th || !on) return null;
    const a = th.getBoundingClientRect(), b = on.getBoundingClientRect();
    return Math.abs(a.left - b.left) < 2 && Math.abs(a.width - b.width) < 2;
  });
  t.check('a segmented control draws its thumb under the picked option', segThumb);
  t.check('the thumb comes after the options, so :first-child is still the first', await page.evaluate(() =>
    document.querySelector('#sheetRoot .seg > :first-child').tagName === 'BUTTON'));
  await page.evaluate(() => document.querySelector('#sheetRoot [data-close]').click());
  t.check('closing empties the sheet root at once', await page.evaluate(() => !document.querySelector('#sheetRoot').children.length));
  t.check('while the old sheet leaves without ids or focus', await page.evaluate(() => {
    const g = document.querySelector('#sheetGhost .sheet-backdrop');
    return !!g && g.inert && !g.querySelector('[id]');
  }));
  await page.waitForTimeout(400);
  t.check('and is gone a moment later', await page.evaluate(() => !document.querySelector('#sheetGhost .sheet-backdrop')));

  // the logger's progress line
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  const width = () => page.evaluate(() => document.querySelector('.wk-progress i')?.style.width);
  t.equal('the logger starts with nothing done', await width(), '0%');
  await page.click('.ex-block .set-done');
  await page.waitForTimeout(300);
  t.check('and fills as sets are logged', parseFloat(await width()) > 0, await width());
  t.equal('no page errors', page.errors.length, 0);
  await page.close();

  // someone who asked for less motion gets none of it
  const calm = await t.browser.newPage({ viewport: { width: 384, height: 832 }, reducedMotion: 'reduce' });
  await calm.addInitScript((s) => {
    sessionStorage.setItem('bela-opened', '1');
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
  }, build());
  await calm.goto(server.url);
  await calm.waitForTimeout(450);
  t.check('reduced motion: no entrance on arrival', await calm.evaluate(() => {
    document.querySelector('.tab[data-tab="habits"]').click();
    return !document.querySelector('#view').classList.contains('view-enter');
  }));
  t.check('reduced motion: a closed sheet just goes', await calm.evaluate(async () => {
    document.querySelector('.tab[data-tab="meals"]').click();
    document.querySelector('#addMeal').click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('#sheetRoot [data-close]').click();
    return !document.querySelector('#sheetGhost .sheet-backdrop');
  }));
  await calm.close();

  // a wide screen: the bar is a sidebar, the page is centred, a sheet is a dialog
  const wide = await openApp(t.browser, { url: server.url, seed: build(), viewport: { width: 1366, height: 820 }, touch: false });
  const bar = await wide.evaluate(() => { const r = document.querySelector('.tab-bar').getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left }; });
  t.check('wide: the tab bar is a sidebar on the left', bar.left === 0 && bar.h > bar.w && bar.w < 300, JSON.stringify(bar));
  t.check('wide: the page clears it', await wide.evaluate(() => document.querySelector('#view').getBoundingClientRect().left >= document.querySelector('.tab-bar').getBoundingClientRect().right));
  await wide.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
  await wide.waitForTimeout(500);
  await wide.click('#addMeal');
  await wide.waitForTimeout(600);
  const sh = await wide.evaluate(() => { const r = document.querySelector('#sheetRoot .sheet').getBoundingClientRect(); return { top: r.top, bottom: innerHeight - r.bottom }; });
  t.check('wide: a sheet opens as a dialog, off the bottom edge', sh.top > 10 && sh.bottom > 10, JSON.stringify(sh));
  t.equal('wide: no page errors', wide.errors.length, 0);
  await wide.close();
  await server.close();
};
