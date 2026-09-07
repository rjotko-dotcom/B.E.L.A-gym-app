/* The professional-standards pass: finger-sized targets, one nutrition
   summary, opt-in RPE, real switches, no Classic home — and the workout
   notification actually leaving when the workout does. */
const { serve, openApp, readState, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });

  /* --- every small control offers finger room beyond its drawn box --- */
  {
    const page = await openApp(t.browser, { url: server.url, seed: build() });
    await page.click('.tab[data-tab="meals"]');
    await page.waitForTimeout(400);
    const halo = await page.evaluate(() => {
      const el = document.querySelector('.icon-btn');
      const after = getComputedStyle(el, '::after');
      return { content: after.content, top: after.top };
    });
    t.check('small buttons grow an invisible tap halo', halo.content !== 'none', JSON.stringify(halo));
    t.equal('the halo reaches out', halo.top, '-7px');
    await page.close();
  }

  /* --- nutrition says its number once --- */
  {
    const page = await openApp(t.browser, { url: server.url, seed: build() });
    await page.click('.tab[data-tab="meals"]');
    await page.waitForTimeout(400);
    t.equal('the Consumed card is gone', await page.evaluate(() => document.querySelectorAll('.nut-consumed').length), 0);
    t.check('the hero carries the progress bar instead', await page.evaluate(() =>
      !!document.querySelector('.nut-hero .nh-track .macro-fill')));
    t.check('and says what was eaten against the goal', await page.evaluate(() =>
      /eaten/.test(document.querySelector('.nh-foot')?.textContent || '')));
    const mealTop = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#view .card')].find((c) => /Breakfast/.test(c.textContent));
      return el ? Math.round(el.getBoundingClientRect().top) : 9999;
    });
    t.check('the meals start on the first screen', mealTop < 832, 'top ' + mealTop);
    await page.close();
  }

  /* --- settings: switches, no Home layout, RPE off by default --- */
  {
    const page = await openApp(t.browser, { url: server.url, seed: build() });
    await page.click('#homeAvatar');
    await page.waitForTimeout(400);
    await (await page.$('.icon-btn[aria-label*="ettings"]')).click();
    await page.waitForTimeout(450);
    t.check('the Home layout option is gone', await page.evaluate(() =>
      !/Home layout/.test(document.querySelector('.sheet')?.textContent || document.body.textContent)));
    const sw = await page.evaluate(() => {
      const el = document.querySelector('#trackRpe');
      return { look: getComputedStyle(el).appearance, on: el.checked };
    });
    t.equal('the on/off rows are drawn as switches', sw.look, 'none');
    t.check('RPE starts switched off', !sw.on);
    await page.close();
  }

  /* --- installed, the workout notification leaves with the workout --- */
  {
    const page = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
    page.errors = [];
    page.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) page.errors.push(String(e)); });
    const seed = build();
    seed.settings.wkNotify = true;
    await page.addInitScript((s) => {
      localStorage.setItem('bela-gym-v1', JSON.stringify(s));
      sessionStorage.setItem('bela-opened', '1');
      localStorage.setItem('bela-update-check', String(Date.now()));   // no GitHub call mid-test
      window.__LN = { scheduled: [], removed: [], delivered: [] };
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          LocalNotifications: {
            createChannel: async () => {},
            checkPermissions: async () => ({ display: 'granted' }),
            requestPermissions: async () => ({ display: 'granted' }),
            schedule: async ({ notifications }) => {
              window.__LN.scheduled.push(...notifications);
              window.__LN.delivered = notifications.map((n) => ({ id: n.id }));
            },
            cancel: async () => { /* only unschedules — a delivered one stays, like the real thing */ },
            getDeliveredNotifications: async () => ({ notifications: window.__LN.delivered.slice() }),
            removeDeliveredNotifications: async ({ notifications }) => {
              window.__LN.removed.push(...notifications);
              window.__LN.delivered = window.__LN.delivered.filter((d) => !notifications.some((n) => Number(n.id) === Number(d.id)));
            },
          },
          App: { addListener: () => {} },
        },
      };
    }, seed);
    await page.goto(server.url);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => /Start/i.test(x.textContent) && x.closest('#view'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(800);
    t.check('starting a session posts the ongoing notification', await page.evaluate(() => window.__LN.scheduled.length > 0));

    await page.click('.ex-block .set-done');
    await page.waitForTimeout(500);
    await page.click('#wkFinishTop');
    await page.waitForTimeout(500);
    await page.click('#confirmFinish');
    await page.waitForTimeout(900);

    t.check('the workout saved', !(await readState(page)).activeWorkout);
    const ln = await page.evaluate(() => window.__LN);
    t.check('finishing removes the delivered notification', ln.removed.some((n) => Number(n.id) === 8801),
      JSON.stringify(ln.removed));
    t.equal('nothing is left in the shade', ln.delivered.length, 0);
    t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
    await page.close();
  }

  /* --- the page must not slide once it is on screen --- */
  {
    const page = await openApp(t.browser, { url: server.url, seed: build() });

    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { top: cs.getPropertyValue('--safe-top').trim(), bot: cs.getPropertyValue('--safe-bot').trim() };
    });
    t.check('the window insets are latched into variables', /px$/.test(vars.top) && /px$/.test(vars.bot),
      JSON.stringify(vars));
    t.check('and the layout is measured from them', await page.evaluate(() =>
      [...document.styleSheets].some((sh) => {
        try { return [...sh.cssRules].some((r) => /var\(--safe-top/.test(r.cssText)); }
        catch (e) { return false; }
      })));

    /* Android can report a status-bar inset and then revise it away. Whatever
       it does, what is already on screen must stay where it is. */
    const topOf = () => page.evaluate(() => Math.round(document.querySelector('#view').getBoundingClientRect().top)
      + '|' + Math.round(document.querySelector('.home-head, #view > *').getBoundingClientRect().top));
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '40px'));
    await page.waitForTimeout(120);
    const settled = await topOf();
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(300);
    t.equal('an inset that shrinks does not drag the page up', await topOf(), settled);

    // and it is still allowed to grow, or a real notch would be sat on
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '0px'));
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(300);
    t.check('a larger inset is still taken', await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) >= 0));

    // scrolling must never re-tier home: that is what moved everything at once
    const tiers = () => page.evaluate(() => document.querySelector('#view').className);
    const was = await tiers();
    await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(250);
    t.equal('scrolling never re-fits home', await tiers(), was);

    /* But a height change must always be answered, however small. Skipping the
       small ones left home overflowing behind the nav bar, because the window
       it was first measured against was not the one it ended up in. */
    const fits = () => page.evaluate(() => {
      const v = document.querySelector('#view');
      const nav = document.querySelector('.tab-bar').getBoundingClientRect().top;
      const kids = [...v.children].filter((k) => getComputedStyle(k).position !== 'absolute');
      const last = kids[kids.length - 1].getBoundingClientRect().bottom;
      return Math.round(nav - last);
    });
    for (const h of [820, 812, 800, 744, 700]) {
      await page.setViewportSize({ width: 384, height: h });
      await page.waitForTimeout(320);
      t.check('home still fits after a ' + (832 - h) + 'px height change', (await fits()) >= 0,
        'overlap ' + -(await fits()) + 'px at ' + h);
    }
    await page.setViewportSize({ width: 384, height: 832 });
    await page.waitForTimeout(320);
    t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
    await page.close();
  }

  /* --- the one-tap strip scrolls sideways, and nothing else --- */
  {
    const seed = build();
    const d = new Date();
    const key = (back) => {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    };
    const names = ['"GARDĖSIS" sumuštinis su vištiena ir sūriu', 'Whole egg · 4×', 'Oats & whey',
      'Greek yoghurt 200 g', 'Banana', 'Rye bread 2 slices', 'Cottage cheese'];
    // pushed oldest first, so the long one is the most recent and leads the strip
    [...names].reverse().forEach((name, i) => seed.nutrition.meals.push({
      id: 'qc' + i, date: key(names.length - i), time: '08:00', slot: 'breakfast',
      name, kcal: 200 + i * 10, protein: 10, carbs: 20, fat: 5,
    }));
    const page = await openApp(t.browser, { url: server.url, seed });
    await page.click('.tab[data-tab="meals"]');
    await page.waitForTimeout(450);

    const strip = await page.evaluate(() => {
      const row = document.querySelector('.slot-quick');
      const cs = getComputedStyle(row);
      const span = row.querySelector('.quick-chip span');
      return {
        touch: cs.touchAction, over: cs.overscrollBehaviorX,
        chips: row.querySelectorAll('.quick-chip').length,
        overflows: row.scrollWidth > row.clientWidth + 2,
        more: row.classList.contains('has-more'),
        fullName: span.textContent, clipped: span.scrollWidth > span.clientWidth,
      };
    });
    t.equal('a drag on the strip pans sideways only', strip.touch, 'pan-x');
    t.equal('and its end is the end', strip.over, 'contain');
    t.equal('it holds six one-tap foods', strip.chips, 6);
    t.check('and overflows on this phone', strip.overflows);
    t.check('so it says there is more', strip.more);
    t.check('a long name is kept whole and clipped by the chip, not cut to 18 letters',
      /GARDĖSIS/.test(strip.fullName) && strip.fullName.length > 18 && strip.clipped, strip.fullName);

    await page.evaluate(() => {
      const r = document.querySelector('.slot-quick');
      r.scrollLeft = r.scrollWidth; r.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(150);
    t.check('and stops saying so at the end',
      !(await page.evaluate(() => document.querySelector('.slot-quick').classList.contains('has-more'))));

    // a sideways swipe on the chips scrolls them; it must never change the tab
    await page.evaluate(() => {
      const chip = document.querySelector('.slot-quick .quick-chip');
      const touch = (x) => new Touch({ identifier: 1, target: chip, clientX: x, clientY: 600 });
      chip.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(300)], changedTouches: [touch(300)] }));
      chip.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(60)] }));
    });
    await page.waitForTimeout(350);
    t.equal('a sideways swipe on the strip does not change the tab',
      await page.evaluate(() => document.querySelector('.tab.active').dataset.tab), 'meals');
    t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'bela-quick-strip.png') });
    await page.close();
  }

  await server.close();
};
