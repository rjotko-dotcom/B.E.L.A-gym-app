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
  // home shows this week only — a sideways swipe there belongs to the tabs
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);
  t.check('the home strip carries no week header', await page.evaluate(() => !document.querySelector('#wkLabel')));
  await page.evaluate(() => {
    const w = document.querySelector('.week-strip');
    const r = w.getBoundingClientRect(), y = r.top + r.height / 2;
    const t = (x) => new Touch({ identifier: 1, target: w, clientX: x, clientY: y });
    w.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }));
    w.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(120)], bubbles: true }));
  });
  await page.waitForTimeout(400);
  t.equal('swiping the strip changes tab', await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'workout');
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);
  t.check('and the strip still shows this week', await page.evaluate(() => {
    const today = String(new Date().getDate());
    return [...document.querySelectorAll('.wd .wd-num')].some((n) => n.textContent.trim() === today);
  }));

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

  // the weekly plan card walks weeks the same way, and carries its dates
  await page.click('.tab[data-tab="workout"]');
  await page.waitForTimeout(450);
  const pl0 = (await page.textContent('#plLabel')).trim();
  t.check('the plan card names its week', /^Week [1-5] · \w+/.test(pl0), pl0);
  const planDay = () => page.evaluate(() => document.querySelector('.plan-day span').textContent.trim());
  const pd0 = await planDay();
  t.check('the plan days carry dates', /\d/.test(pd0), pd0);
  await page.click('#plPrev');
  await page.waitForTimeout(400);
  t.check('stepping back moves the plan week', (await planDay()) !== pd0, await planDay());
  await page.evaluate(() => {
    const w = document.querySelector('.wk-plan');
    const r = w.getBoundingClientRect(), y = r.top + r.height / 2;
    const t = (x) => new Touch({ identifier: 1, target: w, clientX: x, clientY: y });
    w.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }));
    w.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(120)], bubbles: true }));
  });
  await page.waitForTimeout(400);
  t.equal('dragging it comes back to this week', (await page.textContent('#plLabel')).trim(), pl0);
  t.equal('and never changes tab', await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'workout');
  await page.click('.plan-day');
  await page.waitForTimeout(400);
  t.check('tapping a day still sets the plan', await page.evaluate(() => !!document.querySelector('#sheetRoot .sheet')));
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);

  // the last-session card describes the session, not a bare number
  await page.click('.tab[data-tab="workout"]');
  await page.waitForTimeout(450);
  const lastCard = await page.evaluate(() => ({
    text: document.querySelector('#wkLast').textContent.replace(/\s+/g, ' ').trim(),
    ring: !!document.querySelector('#wkLast .ws-ring'),
  }));
  t.check('the card is labelled as the last session', /Last session/.test(lastCard.text), lastCard.text);
  t.check('it names what was in it', /·/.test(lastCard.text) && /sets/.test(lastCard.text), lastCard.text);
  t.check('and no longer shows a lone number in a ring', !lastCard.ring);

  // the score ring explains itself one tap away
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(400);
  await page.click('#homeAvatar');
  await page.waitForTimeout(500);
  const card = await page.evaluate(() => document.querySelector('#scoreCard')?.textContent.replace(/\s+/g, ' ').trim() || '');
  t.check('the profile breaks the day score down', /Training \d+\/30/.test(card) && /Weigh-in \d+\/10/.test(card), card);
  t.check('and says what is still open', /Still open|nothing left/.test(card), card);
  await page.click('#scoreCard');
  await page.waitForTimeout(450);
  t.check('tapping it opens the whole day', await page.evaluate(() => !!document.querySelector('.ds-score')));
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
