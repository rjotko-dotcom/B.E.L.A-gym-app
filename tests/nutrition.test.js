/* Nutrition: goals, one-tap logging, saved meals and the import parser. */
const { openApp, readState } = require('./lib/harness');
const { build, dk } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  const today = dk(new Date());
  seed.nutrition.meals.push(
    { id: 'a1', date: today, slot: 'breakfast', time: '08:00', name: 'Oats', kcal: 380, protein: 14, carbs: 60, fat: 7 },
    { id: 'a2', date: today, slot: 'breakfast', time: '08:05', name: 'Whey shake', kcal: 160, protein: 30, carbs: 4, fat: 2 },
  );
  const page = await openApp(t.browser, { url: server.url, seed });
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(450);

  // goals live on the page itself
  await page.click('#editTargets');
  await page.waitForTimeout(400);
  t.check('daily goals can be edited from nutrition', await page.evaluate(() => !!document.querySelector('#ngKcal')));
  await page.fill('#ngKcal', '3000');
  await page.click('#ngSave');
  await page.waitForTimeout(500);
  t.equal('the calorie goal is saved', (await readState(page)).nutrition.targets.kcal, 3000);

  // saving a whole meal and logging it again
  t.check('a slot with several items offers to save it', await page.evaluate(() => !!document.querySelector('.slot-save')));
  await page.click('.slot-save');
  await page.waitForTimeout(400);
  await page.fill('#smName', 'Usual breakfast');
  await page.click('#smSave');
  await page.waitForTimeout(500);
  t.equal('the meal is saved with both items', (await readState(page)).savedMeals[0].items.length, 2);

  const before = (await readState(page)).nutrition.meals.length;
  await page.click('.slot-add[data-slot="breakfast"]');
  await page.waitForTimeout(450);
  t.check('saved meals appear in the log sheet', await page.evaluate(() => !!document.querySelector('[data-saved]')));
  await page.click('[data-saved]');
  await page.waitForTimeout(600);
  t.equal('one tap logs every item', (await readState(page)).nutrition.meals.length, before + 2);

  // recent meals as one-tap chips
  await page.waitForTimeout(300);
  t.check('recent meals are offered as chips', await page.evaluate(() => document.querySelectorAll('.quick-chip').length > 0));

  // portions: a food's macros follow the grams you type
  await page.click('.slot-add[data-slot="lunch"]');
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.lib-item .li-name')].find((x) => x.textContent === 'Chicken breast');
    n.click();
  });
  await page.waitForTimeout(450);
  t.check('picking a food asks for the portion', await page.evaluate(() => !!document.querySelector('#pdAmt')));
  await page.fill('#pdAmt', '220');
  await page.waitForTimeout(250);
  const scaled = await page.evaluate(() => document.querySelector('#pdOut').textContent.replace(/\s+/g, ' '));
  t.check('the macros scale with the grams', /363/.test(scaled) && /68.2/.test(scaled), scaled);
  const beforeP = (await readState(page)).nutrition.meals.length;
  await page.click('#pdAdd');
  await page.waitForTimeout(550);
  const logged = (await readState(page)).nutrition.meals.slice(-1)[0];
  t.equal('the portion is logged', (await readState(page)).nutrition.meals.length, beforeP + 1);
  t.equal('the entry carries the amount', logged.name, 'Chicken breast · 220 g');
  t.equal('the calories match the portion', logged.kcal, 363);

  // the + on a row logs the usual serving without asking
  await page.click('.slot-add[data-slot="lunch"]');
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.lib-item')].find((r) => /Oats, dry/.test(r.textContent));
    row.querySelector('.li-add').click();
  });
  await page.waitForTimeout(550);
  const quick = (await readState(page)).nutrition.meals.slice(-1)[0];
  t.equal('the + button logs the usual serving', quick.name, 'Oats, dry · 60 g');

  // a custom food is remembered, and works at any portion afterwards
  await page.click('.slot-add[data-slot="dinner"]');
  await page.waitForTimeout(450);
  await page.fill('#cmName', 'Skyr vanilla');
  // the numbers describe the whole thing unless you pick a unit
  await page.evaluate(() => document.querySelector('#cmUnit button[data-u="g"]').click());
  await page.waitForTimeout(250);
  await page.fill('#cmAmt', '150');
  await page.fill('#cmKcal', '96');
  await page.fill('#cmProtein', '16.5');
  await page.fill('#cmCarbs', '6');
  await page.fill('#cmFat', '0.3');
  await page.click('#cmAdd');
  await page.waitForTimeout(600);
  const mine = (await readState(page)).foods;
  t.equal('the custom food is remembered', mine.length, 1);
  t.equal('it is stored per 100 g', mine[0] && mine[0].kcal, 64);

  await page.click('.slot-add[data-slot="dinner"]');
  await page.waitForTimeout(450);
  t.check('it comes back under My foods', await page.evaluate(() =>
    /My foods/.test(document.querySelector('#foodList').textContent)));
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.lib-item .li-name')].find((x) => x.textContent === 'Skyr vanilla');
    n.click();
  });
  await page.waitForTimeout(450);
  await page.fill('#pdAmt', '300');
  await page.waitForTimeout(200);
  await page.click('#pdAdd');
  await page.waitForTimeout(550);
  const again = (await readState(page)).nutrition.meals.slice(-1)[0];
  t.equal('a remembered food scales too', again.kcal, 192);
  t.equal('and keeps its protein', again.protein, 33);

  // pieces are counted, not weighed
  await page.click('.slot-add[data-slot="snack"]');
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.lib-item .li-name')].find((x) => x.textContent === 'Whole egg');
    n.click();
  });
  await page.waitForTimeout(450);
  await page.fill('#pdAmt', '3');
  await page.click('#pdAdd');
  await page.waitForTimeout(550);
  const eggs = (await readState(page)).nutrition.meals.slice(-1)[0];
  t.equal('a food sold by the piece is counted', eggs.name, 'Whole egg · 3×');
  t.equal('three eggs are three times one', eggs.kcal, 216);

  // and a remembered food can be forgotten again, from inside its editor
  await page.click('.slot-add[data-slot="dinner"]');
  await page.waitForTimeout(450);
  await page.click('[data-editfood]');
  await page.waitForTimeout(550);
  await page.click('#feDel');
  await page.waitForTimeout(500);
  t.equal('a food can be forgotten', (await readState(page)).foods.length, 0);
  await page.click('.toast-btn');
  await page.waitForTimeout(400);
  t.equal('and undone', (await readState(page)).foods.length, 1);
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);

  /* Reaching a target is a goal met; passing it is not. Under reads plain,
     exactly on reads as done, and anything that shows as more than the goal
     reads as over — every macro, calories included. */
  const setDay = async (day) => {
    await page.evaluate((d) => {
      const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
      const now = new Date();
      const key = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      st.nutrition.targets = { kcal: 2800, protein: 180, carbs: 300, fat: 70 };
      st.nutrition.meals = [{ id: 'goal', date: key, slot: 'lunch', time: '13:00', name: 'Day', ...d }];
      localStorage.setItem('bela-gym-v1', JSON.stringify(st));
    }, day);
    await page.reload();
    await page.waitForTimeout(600);
    return page.evaluate(() => {
      const out = { hero: document.querySelector('.nh-num').className.replace('nh-num', '').trim(),
        heroText: document.querySelector('.nut-hero').textContent.replace(/\s+/g, ' ') };
      document.querySelectorAll('.nm-card').forEach((c) => {
        const left = c.querySelector('.nm-left');
        const name = c.querySelector('.nm-name').textContent.toLowerCase();
        out[name] = left.className.replace('nm-left', '').trim();
        out[name + 'Text'] = left.textContent.trim();
      });
      return out;
    });
  };

  const exact = await setDay({ kcal: 2800, protein: 180, carbs: 300, fat: 70 });
  t.equal('landing exactly on the protein goal is done', exact.protein, 'done');
  t.equal('and says so', exact.proteinText, 'goal hit');
  t.equal('carbs too', exact.carbs, 'done');
  t.equal('and fat', exact.fat, 'done');
  t.check('and the calories', /\bdone\b/.test(exact.hero) && !/\bover\b/.test(exact.hero), exact.hero);
  t.check('the hero says the goal was reached', /Goal reached/.test(exact.heroText), exact.heroText);

  const past = await setDay({ kcal: 2860, protein: 181, carbs: 320, fat: 80 });
  t.equal('one gram past the protein goal is over it', past.protein, 'over');
  t.equal('and says how far', past.proteinText, '1g over');
  t.equal('carbs past their goal are over too', past.carbs, 'over');
  t.equal('so is fat', past.fat, 'over');
  t.check('and calories past theirs', /\bover\b/.test(past.hero), past.hero);
  t.check('with the hero saying how far over', /over your goal/.test(past.heroText), past.heroText);

  // the numbers on screen are whole, so a rounding hair is not "over"
  const hair = await setDay({ kcal: 2800.4, protein: 180.4, carbs: 300.2, fat: 70.3 });
  t.equal('a fraction that still reads as the goal is not over', hair.protein, 'done');
  t.equal('nor for carbs', hair.carbs, 'done');
  t.equal('nor fat', hair.fat, 'done');
  t.check('nor the calories', /\bdone\b/.test(hair.hero) && !/\bover\b/.test(hair.hero), hair.hero);

  const under = await setDay({ kcal: 1900, protein: 120, carbs: 200, fat: 40 });
  t.equal('short of the goal reads plain', under.protein, '');
  t.equal('with what is left to go', under.proteinText, '60g left');
  t.check('and the calories plain too', !/\b(done|over)\b/.test(under.hero), under.hero);

  // swiping a meal row deletes it, holding one offers what to do with it
  // the earlier checks leave the page on some day; step until one has meals
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => !!document.querySelector('.slot-item'))) break;
    await page.click('#dayPrev');
    await page.waitForTimeout(400);
  }
  const mealCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('bela-gym-v1')).nutrition.meals.length);
  const had = await mealCount();
  await page.evaluate(() => {
    const el = document.querySelector('.slot-item');
    const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
    const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(200)], changedTouches: [t(200)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(80)], changedTouches: [t(80)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(80)], bubbles: true }));
  });
  await page.waitForTimeout(450);
  t.equal('a swipe deletes the row', await mealCount(), had - 1);
  t.equal('and never carries the page to another tab',
    await page.evaluate(() => document.querySelector('.tab.active')?.dataset.tab), 'meals');
  await page.click('.toast-btn');
  await page.waitForTimeout(450);
  t.equal('and undo brings it back', await mealCount(), had);
  await page.evaluate(() => document.querySelector('.slot-item').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  await page.waitForTimeout(450);
  const held = await page.evaluate(() => document.querySelector('#sheetRoot')?.textContent || '');
  t.check('holding a meal offers to log it again', /Log it again/.test(held), held.slice(0, 60));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheetRoot button')].find((x) => /Log it again/.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  t.equal('and does it', await mealCount(), had + 1);

  // the glass that fills the day pours itself into the card
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    st.settings.waterTarget = 8;
    st.nutrition.water = [{ date: key, glasses: 7 }];
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(650);
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(450);
  await page.click('#waterPlus');
  await page.waitForTimeout(150);
  t.check('the last glass runs a wave across the dots', await page.evaluate(() =>
    [...document.querySelectorAll('.wdot')].some((d) => d.getAnimations().length > 0)));
  await page.waitForTimeout(1400);
  t.check('and the card takes the ripple', await page.evaluate(() => !!document.querySelector('.slot-ico.took-drop')));
  const dots = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.wdot')];
    return { count: d.length, on: d.filter((x) => x.classList.contains('on')).length,
      hidden: d.filter((x) => Number(getComputedStyle(x).opacity) < 0.9).length };
  });
  t.equal('and every dot comes back filled', dots.on, dots.count);
  t.equal('none left invisible', dots.hidden, 0);
  await page.evaluate(() => document.querySelector('.slot-ico').classList.remove('took-drop'));
  await page.click('#waterPlus');
  await page.waitForTimeout(700);
  t.check('a glass past the target does not run it again', await page.evaluate(() => !document.querySelector('.slot-ico.took-drop')));

  // deleting several things in a row leaves one message, not a pile
  for (let i = 0; i < 4; i++) {
    if (!(await page.evaluate(() => !!document.querySelector('.si-del')))) break;
    await page.click('.si-del');
    await page.waitForTimeout(160);
  }
  t.equal('only the latest message is on screen',
    await page.evaluate(() => document.querySelectorAll('.toast').length), 1);

  // a logged portion can be corrected instead of deleted and retyped
  await page.click('#addMeal');
  await page.waitForTimeout(450);
  await page.fill('#foodSearch', 'chicken breast');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.lib-item')].find((x) => /Chicken breast/.test(x.textContent));
    if (it) it.click();
  });
  await page.waitForTimeout(500);
  await page.fill('#pdAmt', '150');
  await page.click('#pdAdd');
  await page.waitForTimeout(600);
  const last = () => page.evaluate(() => JSON.parse(localStorage.getItem('bela-gym-v1')).nutrition.meals.at(-1));
  const portion = await last();
  t.check('a logged portion remembers what it was made of', !!portion.base && portion.amount === 150, JSON.stringify(portion.base || null));
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('.slot-item')].find((x) => /Chicken breast/.test(x.textContent));
    if (r) r.click();
  });
  await page.waitForTimeout(500);
  t.check('tapping it opens the editor', await page.evaluate(() => !!document.querySelector('#meAmt')));
  await page.fill('#meAmt', '200');
  await page.waitForTimeout(250);
  t.check('the macros follow the new portion', /330/.test(await page.textContent('#meOut')), await page.textContent('#meOut'));
  await page.click('.seg-slot button[data-slot="dinner"]');
  await page.click('#meSave');
  await page.waitForTimeout(600);
  const fixed = await last();
  t.equal('saving rewrites the portion', fixed.amount, 200);
  t.equal('and the calories', fixed.kcal, 330);
  t.equal('and it can move meal', fixed.slot, 'dinner');
  t.check('the name follows too', /200 g/.test(fixed.name), fixed.name);

  // the week behind you — earlier checks emptied some days, so give it a week
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const dk = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    for (let i = 1; i < 6; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      st.nutrition.meals.push({ id: 'wk' + i, date: dk(d), slot: 'lunch', time: '13:00',
        name: 'Day ' + i, kcal: 2400 + i * 90, protein: 160 + i * 5, carbs: 240, fat: 62 });
    }
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(650);
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(450);
  const week = await page.evaluate(() => document.querySelector('.nut-week')?.textContent.replace(/\s+/g, ' ') || '');
  t.check('the week card sums the last seven days', /Last 7 days/.test(week) && /Avg kcal/.test(week), week.slice(0, 70));
  t.equal('with a bar per day', await page.evaluate(() => document.querySelectorAll('.nw-day').length), 7);

  // past the target, extra glasses get their own hollow dashed dot
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    st.settings.waterTarget = 8;
    st.nutrition.water = [{ date: key, glasses: 10 }];
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(650);
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(450);
  const wd = await page.evaluate(() => ({
    total: document.querySelectorAll('.wdot').length,
    filled: document.querySelectorAll('.wdot.on').length,
    extra: document.querySelectorAll('.wdot.extra').length,
    dashed: getComputedStyle(document.querySelector('.wdot.extra')).borderStyle,
    hollow: getComputedStyle(document.querySelector('.wdot.extra')).backgroundColor,
  }));
  t.equal('ten glasses draw ten dots', wd.total, 10);
  t.equal('eight of them are the target', wd.filled, 8);
  t.equal('and two are extra', wd.extra, 2);
  t.equal('drawn dashed', wd.dashed, 'dashed');
  t.equal('and hollow', wd.hollow, 'rgba(0, 0, 0, 0)');
  await page.click('#waterMinus');
  await page.click('#waterMinus');
  await page.click('#waterMinus');
  await page.waitForTimeout(450);
  t.equal('dropping back to the target leaves eight', await page.evaluate(() => document.querySelectorAll('.wdot').length), 8);
  t.equal('with none extra', await page.evaluate(() => document.querySelectorAll('.wdot.extra').length), 0);

  // a food of your own can be corrected instead of forgotten and retyped
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.foods = [{ id: 'f1', name: 'Protein shake', unit: 'ml', per: 100, serving: 400,
      kcal: 52, protein: 9, carbs: 2, fat: 0.6, used: Date.now() }];
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(650);
  await page.click('.tab[data-tab="meals"]');
  await page.waitForTimeout(450);
  await page.click('#addMeal');
  await page.waitForTimeout(500);
  t.check('your own foods carry a pencil', await page.evaluate(() => !!document.querySelector('[data-editfood]')));
  await page.click('[data-editfood]');
  await page.waitForTimeout(600);
  t.check('which opens the food', await page.evaluate(() => !!document.querySelector('#feKcal')));
  await page.fill('#feKcal', '60');
  await page.fill('#feP', '11');
  await page.fill('#feServing', '500');
  await page.click('#feSave');
  await page.waitForTimeout(700);
  const food = await page.evaluate(() => JSON.parse(localStorage.getItem('bela-gym-v1')).foods[0]);
  t.equal('the calories are corrected', food.kcal, 60);
  t.equal('and the protein', food.protein, 11);
  t.equal('and the portion the + logs', food.serving, 500);

  // an improbable amount of water gets a question
  const askAt = async (glasses) => {
    await page.evaluate((g) => {
      const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
      const d = new Date();
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      st.settings.waterTarget = 8;
      st.nutrition.water = [{ date: key, glasses: g }];
      localStorage.setItem('bela-gym-v1', JSON.stringify(st));
    }, glasses);
    await page.reload();
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
    await page.waitForTimeout(450);
    return page.evaluate(() => document.querySelector('.water-joke')?.textContent || '');
  };
  t.equal('twelve glasses passes without comment', await askAt(12), '');
  t.equal('thirty-four asks after you', await askAt(34), 'u ok?');

  t.equal('no page errors', page.errors.length, 0);
  await page.close();

  /* ---- a food you eat in portions is counted, not weighed ----
     Four slices of bread used to mean tapping + four times. */
  {
    const seed2 = build();
    seed2.nutrition.meals = [];
    seed2.foods = [{ id: 'f_bread', name: 'Sandwich bread', unit: 'g', per: 100, serving: 28,
      sname: 'slice', kcal: 275, protein: 10.7, carbs: 46.4, fat: 3.6, used: Date.now() }];
    const p3 = await openApp(t.browser, { url: server.url, seed: seed2 });
    await p3.click('.tab[data-tab="meals"]');
    await p3.waitForTimeout(450);

    const openPicker = async (slot) => {
      await p3.evaluate((s) => document.querySelector('.slot-add[data-slot="' + s + '"]').click(), slot);
      await p3.waitForTimeout(550);
    };
    await openPicker('breakfast');
    t.equal('the + logs one of them by name', await p3.evaluate(() =>
      [...document.querySelectorAll('.li-add')].map((b) => b.textContent.trim()).find((x) => /slice/.test(x))), '+ 1 slice');

    await p3.evaluate(() => [...document.querySelectorAll('#foodList .lib-item')]
      .find((r) => /Sandwich bread/.test(r.textContent)).click());
    await p3.waitForTimeout(550);
    t.check('the portion sheet counts in slices', await p3.evaluate(() => !!document.querySelector('#pdStep')));
    t.equal('starting at one', await p3.evaluate(() =>
      document.querySelector('#pdStep .ps-n').textContent + ' ' + document.querySelector('#pdStep .ps-lbl').textContent), '1 slice');
    t.equal('and saying how big one is', await p3.evaluate(() =>
      document.querySelector('#pdStep .ps-each').textContent), '28 g each');
    t.check('the gram chips step aside for it', await p3.evaluate(() => !document.querySelector('#pdQuick')));

    for (let i = 0; i < 3; i++) { await p3.click('#pdStep button[data-step="1"]'); await p3.waitForTimeout(120); }
    t.equal('three taps make four slices', await p3.evaluate(() =>
      document.querySelector('#pdStep .ps-n').textContent + ' ' + document.querySelector('#pdStep .ps-lbl').textContent), '4 slices');
    t.equal('which is 112 g', await p3.evaluate(() => document.querySelector('#pdAmt').value), '112');
    t.equal('and the macros follow', await p3.evaluate(() =>
      document.querySelector('#pdOut b').textContent), '308');

    await p3.click('#pdStep button[data-step="-1"]');
    await p3.waitForTimeout(150);
    t.equal('minus takes one back off', await p3.evaluate(() => document.querySelector('#pdAmt').value), '84');
    await p3.click('#pdStep button[data-step="1"]');
    await p3.waitForTimeout(150);

    // typing grams moves the counter too — they are the same number
    await p3.fill('#pdAmt', '56');
    await p3.evaluate(() => document.querySelector('#pdAmt').dispatchEvent(new Event('input')));
    await p3.waitForTimeout(200);
    t.equal('typing the grams moves the counter', await p3.evaluate(() =>
      document.querySelector('#pdStep .ps-n').textContent), '2');

    await p3.fill('#pdAmt', '112');
    await p3.evaluate(() => document.querySelector('#pdAmt').dispatchEvent(new Event('input')));
    await p3.click('#pdAdd');
    await p3.waitForTimeout(800);
    const logged = (await readState(p3)).nutrition.meals.filter((m) => /Sandwich/.test(m.name));
    t.equal('one row, not four', logged.length, 1);
    t.equal('named for what you ate', logged[0].name, 'Sandwich bread · 4 slices');
    t.equal('with four slices of calories', logged[0].kcal, 308);

    /* ---- the meal says what it came to, not just its calories ---- */
    t.equal('the meal shows its own macros', await p3.evaluate(() => {
      const card = [...document.querySelectorAll('.slot-title')].find((s) => /Breakfast/.test(s.textContent));
      return card.querySelector('span').textContent.trim();
    }), '308 kcal · P 12 · C 52 · F 4');
    t.equal('an empty meal still says so', await p3.evaluate(() => {
      const card = [...document.querySelectorAll('.slot-title')].find((s) => /Lunch/.test(s.textContent));
      return card.querySelector('span').textContent.trim();
    }), 'Nothing logged');

    /* ---- editing it later still counts in slices ---- */
    await p3.evaluate(() => document.querySelector('.slot-item .si-main').click());
    await p3.waitForTimeout(600);
    t.check('editing a logged portion counts too', await p3.evaluate(() => !!document.querySelector('#meStep')));
    await p3.click('#meStep button[data-step="-1"]');
    await p3.waitForTimeout(150);
    await p3.click('#meSave');
    await p3.waitForTimeout(700);
    const after = (await readState(p3)).nutrition.meals.filter((m) => /Sandwich/.test(m.name));
    t.equal('three slices now', after[0].name, 'Sandwich bread · 3 slices');
    t.equal('and three slices of calories', after[0].kcal, 231);

    t.equal('no page errors', p3.errors.length, 0);
    await p3.close();
  }

  /* ---- a whole meal, with no grams to give ----
     A plate in a restaurant has no weight on it; you know what the whole
     thing came to and nothing else. */
  {
    const p5 = await openApp(t.browser, { url: server.url, seed: build() });
    await p5.click('.tab[data-tab="meals"]');
    await p5.waitForTimeout(450);
    await p5.evaluate(() => document.querySelector('.slot-add[data-slot="lunch"]').click());
    await p5.waitForTimeout(550);

    const look = () => p5.evaluate(() => ({
      on: document.querySelector('#cmUnit .is-on').textContent,
      amount: document.querySelector('#cmAmtWrap').hidden,
      portionName: document.querySelector('#cmSNameWrap').hidden,
      hint: document.querySelector('#cmHint').textContent,
      button: document.querySelector('#cmAdd').textContent,
    }));
    const first = await look();
    t.equal('typing a meal in starts on the whole thing', first.on, 'whole');
    t.check('so there is no amount to fill in', first.amount);
    t.check('and nothing to name a portion', first.portionName);
    t.equal('it says so', first.hint, 'Enter what the whole thing has — no weighing.');
    t.equal('and the button just adds the meal', first.button, 'Add meal');

    await p5.fill('#cmName', 'iLunch — vištiena, ryžiai, frī');
    await p5.fill('#cmKcal', '780');
    await p5.fill('#cmProtein', '46');
    await p5.fill('#cmCarbs', '88');
    await p5.fill('#cmFat', '22');
    await p5.click('#cmAdd');
    await p5.waitForTimeout(800);

    const st = await readState(p5);
    const meal = st.nutrition.meals[st.nutrition.meals.length - 1];
    t.equal('the meal goes in under its own name', meal.name, 'iLunch — vištiena, ryžiai, frī');
    t.equal('with the numbers exactly as typed', meal.kcal, 780);
    t.equal('and the protein', meal.protein, 46);
    const food = st.foods.find((f) => /iLunch/.test(f.name));
    t.check('it is remembered as one whole thing', !!food && food.unit === 'piece' && food.serving === 1);
    t.equal('holding the whole meal, not a per-100 g figure', food.kcal, 780);

    // picking a unit brings the amount back
    await p5.evaluate(() => document.querySelector('.slot-add[data-slot="dinner"]').click());
    await p5.waitForTimeout(550);
    await p5.evaluate(() => document.querySelector('#cmUnit button[data-u="g"]').click());
    await p5.waitForTimeout(250);
    const grams = await look();
    t.check('choosing grams brings the amount back', !grams.amount);
    t.equal('and says what it is for', grams.hint, 'Enter what is in 100 g of it.');
    t.equal('the button says what it will log', grams.button, 'Add 100 g');

    // eating it twice still works
    await p5.evaluate(() => document.querySelector('#cmUnit button[data-u="whole"]').click());
    await p5.waitForTimeout(250);
    await p5.evaluate(() => [...document.querySelectorAll('#foodList .lib-item')]
      .find((r) => /iLunch/.test(r.textContent)).click());
    await p5.waitForTimeout(600);
    await p5.fill('#pdAmt', '2');
    await p5.evaluate(() => document.querySelector('#pdAmt').dispatchEvent(new Event('input')));
    await p5.click('#pdAdd');
    await p5.waitForTimeout(800);
    const two = (await readState(p5)).nutrition.meals.slice(-1)[0];
    t.check('and a second helping doubles it', /2×/.test(two.name) && two.kcal === 1560, two.name + ' ' + two.kcal);

    t.equal('no page errors', p5.errors.length, 0);
    await p5.close();
  }

  /* ---- naming the portion when you type the food in ---- */
  {
    const p4 = await openApp(t.browser, { url: server.url, seed: build() });
    await p4.click('.tab[data-tab="meals"]');
    await p4.waitForTimeout(450);
    await p4.evaluate(() => document.querySelector('.slot-add[data-slot="breakfast"]').click());
    await p4.waitForTimeout(550);
    await p4.fill('#cmName', 'Rye bread');
    // the numbers are for the whole thing unless you say otherwise
    await p4.evaluate(() => document.querySelector('#cmUnit button[data-u="g"]').click());
    await p4.waitForTimeout(250);
    await p4.fill('#cmAmt', '28');
    await p4.fill('#cmSName', 'slice');
    await p4.fill('#cmKcal', '77');
    await p4.fill('#cmProtein', '3');
    await p4.fill('#cmCarbs', '13');
    await p4.fill('#cmFat', '1');
    await p4.click('#cmAdd');
    await p4.waitForTimeout(800);
    const st4 = await readState(p4);
    const mine = st4.foods.find((f) => f.name === 'Rye bread');
    t.equal('the food remembers what one is called', mine.sname, 'slice');
    t.equal('and how big it is', mine.serving, 28);
    t.equal('the first one logs as one slice',
      st4.nutrition.meals[st4.nutrition.meals.length - 1].name, 'Rye bread · 1 slice');

    // and it can be renamed afterwards
    await p4.evaluate(() => document.querySelector('.slot-add[data-slot="lunch"]').click());
    await p4.waitForTimeout(550);
    await p4.evaluate(() => document.querySelector('.saved-edit').click());
    await p4.waitForTimeout(550);
    t.equal('the editor shows the portion name', await p4.evaluate(() => document.querySelector('#feSName').value), 'slice');
    await p4.fill('#feSName', 'chunk');
    await p4.click('#feSave');
    await p4.waitForTimeout(700);
    t.equal('which can be changed', (await readState(p4)).foods.find((f) => f.name === 'Rye bread').sname, 'chunk');

    t.equal('no page errors', p4.errors.length, 0);
    await p4.close();
  }

  await server.close();
};
