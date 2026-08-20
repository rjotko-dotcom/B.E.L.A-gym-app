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
  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
