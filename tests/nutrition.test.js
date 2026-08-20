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

  // and a remembered food can be forgotten again
  await page.click('.slot-add[data-slot="dinner"]');
  await page.waitForTimeout(450);
  await page.click('[data-delfood]');
  await page.waitForTimeout(400);
  t.equal('a food can be forgotten', (await readState(page)).foods.length, 0);
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); });
  await page.waitForTimeout(350);

  // reaching a target is a goal met, not a warning
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const key = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
    st.nutrition.targets = { kcal: 2800, protein: 180, carbs: 300, fat: 70 };
    st.nutrition.meals = [{ id: 'goal', date: key, slot: 'lunch', time: '13:00', name: 'Day', kcal: 2860, protein: 181, carbs: 280, fat: 60 }];
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  const hit = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.nm-card')].find((c) => /Protein/.test(c.textContent)).querySelector('.nm-left');
    return { text: p.textContent, cls: p.className, hero: document.querySelector('.nh-num').className,
      heroText: document.querySelector('.nut-hero').textContent.replace(/\s+/g, ' ') };
  });
  t.check('one gram past the protein goal reads as done', /done/.test(hit.cls) && !/over/.test(hit.cls), hit.cls);
  t.equal('and says so', hit.text.trim(), 'goal hit');
  t.check('calories just past the goal are not flagged', /done/.test(hit.hero) && !/over/.test(hit.hero), hit.hero);
  t.check('the hero says the goal was reached', /Goal reached/.test(hit.heroText), hit.heroText);

  // clearly past the calorie goal is still worth flagging
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.nutrition.meals[0].kcal = 3400;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  const blown = await page.evaluate(() => ({
    hero: document.querySelector('.nh-num').className,
    text: document.querySelector('.nut-hero').textContent.replace(/\s+/g, ' '),
    protein: [...document.querySelectorAll('.nm-card')].find((c) => /Protein/.test(c.textContent)).querySelector('.nm-left').className,
  }));
  t.check('600 kcal past the goal is marked over', /over/.test(blown.hero), blown.hero);
  t.check('and says how far over', /over your goal/.test(blown.text), blown.text);
  t.check('but protein stays done', /done/.test(blown.protein), blown.protein);

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
