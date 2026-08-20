/* Home has one hard rule: it must fit on the screen without scrolling, on any
   phone, with even gaps. These checks exist because it has broken twice. */
const { openApp, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

const SIZES = [
  { width: 384, height: 832, label: 'S24+' },
  { width: 412, height: 915, label: 'large' },
  { width: 360, height: 740, label: 'compact' },
  { width: 375, height: 667, label: 'small' },
];

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();

  for (const size of SIZES) {
    const page = await openApp(t.browser, { url: server.url, seed, viewport: size });
    const m = await page.evaluate(() => {
      const v = document.querySelector('#view');
      const kids = [...v.children].filter((k) => getComputedStyle(k).position !== 'absolute');
      const navTop = document.querySelector('.tab-bar').getBoundingClientRect().top;
      const last = kids[kids.length - 1].getBoundingClientRect();
      const gaps = [];
      for (let i = 1; i < kids.length; i++) {
        gaps.push(Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom));
      }
      return {
        clearsNav: Math.round(navTop - last.bottom),
        gaps,
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tabs: document.querySelectorAll('.tab-bar .tab').length,
      };
    });
    t.check(size.label + ': nothing is cut off by the nav', m.clearsNav >= 0, 'overlap ' + -m.clearsNav + 'px');
    t.check(size.label + ': every gap is the same', new Set(m.gaps).size === 1, 'gaps ' + m.gaps.join(','));
    t.equal(size.label + ': no sideways scroll', m.horizontal, 0);
    t.equal(size.label + ': four tabs', m.tabs, 4);
    await page.close();
  }

  // the plan drives the main action
  const page = await openApp(t.browser, { url: server.url, seed });
  const label = await page.textContent('#homeStart');
  t.check('start button names the planned session', /Start .+ Day|Rest day|Resume/.test(label.trim()), label.trim());
  t.check('week strip carries the plan', await page.evaluate(() => document.querySelectorAll('.wd-plan').length) === 7);

  // a day opens its summary
  await page.click('.wd[data-day]:not([disabled])');
  await page.waitForTimeout(400);
  t.check('tapping a day opens its summary', await page.evaluate(() => !!document.querySelector('.ds-score')));
  // the week strip is browsable, and names the week of the month
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);
  const wk0 = await page.textContent('#wkLabel');
  t.check('the strip names the week of the month', /^Week [1-5] · \w+/.test(wk0.trim()), wk0.trim());
  const firstDay = () => page.evaluate(() => document.querySelector('.wd .wd-num').textContent);
  const day0 = await firstDay();
  await page.click('#wkPrev');
  await page.waitForTimeout(400);
  const day1 = await firstDay();
  t.equal('stepping back moves the strip a week', Number(day1), Number(day0) - 7 > 0 ? Number(day0) - 7 : Number(day1));
  t.check('and the label follows', (await page.textContent('#wkLabel')) !== wk0);
  await page.click('#wkLabel');
  await page.waitForTimeout(400);
  t.equal('tapping the label returns to this week', (await page.textContent('#wkLabel')).trim(), wk0.trim());

  // dragging the strip walks weeks without changing tab
  await page.evaluate(() => {
    const w = document.querySelector('.week-wrap');
    const r = w.getBoundingClientRect(), y = r.top + r.height / 2;
    const t = (x) => new Touch({ identifier: 1, target: w, clientX: x, clientY: y });
    w.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }));
    w.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(120)], bubbles: true }));
  });
  await page.waitForTimeout(400);
  t.check('a drag moves the week', (await page.textContent('#wkLabel')) !== wk0);
  t.equal('and stays on home', await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'home');
  await page.click('#wkLabel');
  await page.waitForTimeout(350);

  // the calories card is a way into nutrition
  await page.click('#kcalCard');
  await page.waitForTimeout(450);
  t.equal('the calories card opens nutrition', await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'meals');
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);

  // a refresh (pull-to-refresh included) comes back where you were
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);
  await page.click('.tab[data-tab="habits"]');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(600);
  t.equal('a refresh stays on the tab you were on',
    await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'habits');
  await page.goBack();
  await page.waitForTimeout(450);
  t.equal('back still walks out to home',
    await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'home');
  await page.reload();
  await page.waitForTimeout(600);
  t.equal('refreshing on home stays on home',
    await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'home');

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
