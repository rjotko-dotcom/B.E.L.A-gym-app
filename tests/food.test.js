/* 16.8, the food search: one box over his foods, the common list, the
   offline USDA foods and Open Food Facts products (Lithuanian first);
   a food's real portions as chips; a whole meal typed in one line; and
   yesterday's meal again in one tap. Open Food Facts is answered by a
   fake here, so the suite does not need the internet. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');
const FS = require('../js/food-search.js');

const OFF_HITS = {
  products: [
    { code: '4770275047548', product_name: 'Kefyras 2,5 %', brands: 'Dvaro', countries_tags: ['en:lithuania'], quantity: '1 l',
      nutriments: { 'energy-kcal_100g': 52, proteins_100g: 3.1, carbohydrates_100g: 4.1, fat_100g: 2.5 } },
    { code: '123', product_name: 'Kefir drink', brands: 'Biotiful', countries_tags: ['en:united-kingdom'],
      nutriments: { 'energy-kcal_100g': 60, proteins_100g: 3.5, carbohydrates_100g: 4.5, fat_100g: 3 } },
  ],
};

module.exports = async (t) => {
  // ---- the pure parts, in Node ----
  const lines = FS.parseMeal('200 g chicken breast, 2 eggs, banana, ryžiai 150g, 1.5 kg potatoes and 250ml milk');
  t.equal('a typed meal splits into its items', lines.length, 6);
  t.check('with grams, counts and none', lines[0].amount === 200 && lines[0].unit === 'g' && lines[1].unit === 'n' && lines[2].amount === null);
  t.check('amount after the name, kilos and litres', lines[3].amount === 150 && lines[4].amount === 1500 && lines[5].unit === 'ml');
  t.equal('Lithuanian words are understood', FS.translate('vištienos krūtinėlė'), 'chicken breast');
  t.equal('diacritics do not matter', FS.fold('Varškė'), 'varske');
  const p = FS.fromOff(OFF_HITS.products[0]);
  t.check('a product comes with its brand, per 100, in ml when it is a drink', p.name === 'Kefyras 2,5 % · Dvaro' && p.unit === 'ml' && p.kcal === 52 && p.lt);

  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  // yesterday's breakfast, to repeat
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yk = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  const page = await openApp(t.browser, { url: server.url, seed });
  let offAsked = 0;
  await page.route('**/world.openfoodfacts.org/**', (r) => { offAsked++; r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(OFF_HITS) }); });
  await page.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#addMeal').click());
  await page.waitForTimeout(500);

  // ---- search ----
  await page.fill('#foodSearch', 'grikiai');
  await page.waitForTimeout(900);
  const usda = await page.evaluate(() => [...document.querySelectorAll('#foodList .lib-item .li-name')].map((x) => x.textContent));
  t.check('the offline foods answer a Lithuanian word', usda.some((n) => /Buckwheat/.test(n)), usda.slice(0, 4).join(' | '));
  await page.fill('#foodSearch', 'kefyras');
  await page.waitForTimeout(1600);
  const prods = await page.evaluate(() => [...document.querySelectorAll('#offList .lib-item .li-name')].map((x) => x.textContent));
  t.check('products come from Open Food Facts', offAsked >= 1 && prods.length === 2, prods.join(' | '));
  t.check('Lithuanian products first, marked', /Dvaro/.test(prods[0]) && /LT/.test(prods[0]));
  t.check('the source is credited', /Open Food Facts/.test(await page.textContent('#offList .lib-group-title')));

  // a product: its portion sheet, logged and remembered
  await page.evaluate(() => document.querySelector('#offList .lib-item').click());
  await page.waitForTimeout(500);
  t.check('the portion sheet names the source', /Open Food Facts/.test(await page.textContent('#sheetRoot .portion-per')));
  await page.fill('#pdAmt', '250');
  await page.click('#pdAdd');
  await page.waitForTimeout(500);
  let st = await readState(page);
  const kef = st.nutrition.meals.find((m) => /Kefyras/.test(m.name));
  t.check('250 ml of it is logged with the right numbers', kef && kef.kcal === 130 && kef.protein === 7.8, JSON.stringify(kef));
  t.check('and it is one of his foods now', (st.foods || []).some((f) => /Kefyras/.test(f.name) && f.src === 'off'));

  // ---- a USDA food's real portions ----
  await page.evaluate(() => document.querySelector('#addMeal').click());
  await page.waitForTimeout(500);
  await page.fill('#foodSearch', 'egg whole raw');
  await page.waitForTimeout(700);
  await page.evaluate(() => [...document.querySelectorAll('#foodList .lib-item')].find((x) => /^Egg, whole, raw, fresh/.test(x.querySelector('.li-name').textContent)).click());
  await page.waitForTimeout(500);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#pdQuick .qchip')].map((x) => x.textContent));
  t.check('its portions are chips: 1 large · 50 g', chips.some((c) => /1 large\s*50 g/.test(c)), chips.join(' | '));
  t.equal('and the first one is filled in', await page.inputValue('#pdAmt'), '50');
  await page.evaluate(() => document.querySelector('#sheetRoot [data-close]').click());
  await page.waitForTimeout(400);

  // ---- a whole meal typed ----
  await page.evaluate(() => document.querySelector('#addMeal').click());
  await page.waitForTimeout(600);
  await page.click('#qtOpen');
  await page.fill('#qtText', '200 g chicken breast, 2 eggs, banana, 3 xyzzy');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#qtPrev .qt-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  t.check('each item is matched with its amount', /200 g\s*Chicken breast/.test(rows[0]) && /2×\s*Whole egg/.test(rows[1]) && /Banana/.test(rows[2]), rows.join(' | '));
  t.check('and what is not found says so', /not found/.test(rows[3]));
  t.equal('the button counts what will be logged', (await page.textContent('#qtAdd')).trim(), 'Log 3 items');
  const before = (await readState(page)).nutrition.meals.length;
  await page.click('#qtAdd');
  await page.waitForTimeout(500);
  st = await readState(page);
  t.equal('three entries in one tap', st.nutrition.meals.length - before, 3);
  const ch = st.nutrition.meals.find((m) => /^Chicken breast · 200 g/.test(m.name));
  t.check('with the right numbers', ch && ch.kcal === 330 && ch.protein === 62, JSON.stringify(ch));

  // ---- same as yesterday ----
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem('bela-gym-v1'));
    s.nutrition.meals.push({ id: 'yb1', date: k, slot: 'breakfast', time: '08:00', name: 'Oats · 60 g', kcal: 228, protein: 7.8, carbs: 40.2, fat: 4.2 },
      { id: 'yb2', date: k, slot: 'breakfast', time: '08:00', name: 'Whey · 30 g', kcal: 120, protein: 24, carbs: 2.4, fat: 1.5 });
    localStorage.setItem('bela-gym-v1', JSON.stringify(s));
  }, yk);
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#addMeal').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#slotPick [data-slot="breakfast"]').click());
  await page.waitForTimeout(200);
  const repeat = await page.evaluate(() => document.querySelector('#savedList [data-repeat]')?.textContent || '');
  // the seed already has a breakfast yesterday (Oats & whey, 520 kcal): three items in all
  t.check('yesterday\'s breakfast is offered, with what was in it', /Same as yesterday's breakfast/.test(repeat) && /Oats, Whey/.test(repeat) && /868 kcal/.test(repeat), repeat);
  await page.evaluate(() => document.querySelector('#savedList [data-repeat]').click());
  await page.waitForTimeout(500);
  st = await readState(page);
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  t.equal('one tap logs all three again today', st.nutrition.meals.filter((m) => m.date === today && m.slot === 'breakfast' && /Oats|Whey/i.test(m.name)).length, 3);
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
