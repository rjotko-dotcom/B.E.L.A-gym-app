/* 16.11, my meals: he makes pancakes every morning (eggs, flour, whey, milk)
   and should not type them each time. A meal is made once — ingredients
   searched or typed in one line — and logged in one tap from "My meals";
   it can be opened and changed later; weighed, it logs by the gram. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });
  await page.route('**/world.openfoodfacts.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"products":[]}' }));
  const openLog = async () => {
    await page.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#addMeal').click());
    await page.waitForTimeout(600);
  };
  await openLog();
  t.check('"Create a meal" sits above the food list', await page.evaluate(() => {
    const a = document.querySelector('#recipeOpen'), b = document.querySelector('#foodList');
    return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  await page.click('#recipeOpen');
  await page.waitForTimeout(500);
  await page.fill('#rcName', 'Blynai');
  // the pancakes, typed in one line
  await page.click('#rcTypeOpen');
  await page.fill('#rcType', '3 eggs, 100 g oats, 30 g whey, 200 ml milk');
  await page.waitForTimeout(300);
  t.equal('typed ingredients are found', (await page.textContent('#rcTypeAdd')).trim(), 'Add 4 ingredients');
  await page.click('#rcTypeAdd');
  await page.waitForTimeout(300);
  const names = await page.evaluate(() => [...document.querySelectorAll('#rcItems .rc-item b')].map((b) => b.textContent));
  t.check('with their amounts', names.length === 4 && /egg/i.test(names[0]) && /Oats/.test(names[1]), names.join(' | '));
  const sum = await page.textContent('#rcSum');
  t.check('the whole meal is added up', /The whole meal/.test(sum) && /\d+ kcal/.test(sum), sum);
  const whole = Number((await page.textContent('#rcSum b')).match(/(\d+) kcal/)[1]);
  await page.click('#rcSave');
  await page.waitForTimeout(500);
  let st = await readState(page);
  let meal = st.foods.find((f) => f.name === 'Blynai');
  t.check('saved with each ingredient\'s numbers, so it can be changed later', meal && meal.recipe.items.every((x) => x.kcal != null && x.amount > 0) && meal.kcal === whole, JSON.stringify(meal && meal.recipe.items[0]));

  // back in the meal sheet: My meals, first, one tap
  t.check('it heads the list as My meals', await page.evaluate(() => {
    const first = document.querySelector('#foodList .lib-group-title');
    return !!first && first.textContent === 'My meals' && /Blynai/.test(first.nextElementSibling.textContent);
  }));
  const before = st.nutrition.meals.length;
  await page.evaluate(() => [...document.querySelectorAll('#foodList .lib-item')].find((r) => /Blynai/.test(r.textContent)).querySelector('[data-quick]').click());
  await page.waitForTimeout(500);
  st = await readState(page);
  const logged = st.nutrition.meals[st.nutrition.meals.length - 1];
  t.check('one tap logs the whole thing', st.nutrition.meals.length === before + 1 && /^Blynai/.test(logged.name) && logged.kcal === whole, JSON.stringify(logged));

  // change it: one egg less, the batch makes two, weighed at 400 g
  await openLog();
  await page.evaluate(() => [...document.querySelectorAll('#foodList .lib-item')].find((r) => /Blynai/.test(r.textContent)).querySelector('[data-editfood]').click());
  await page.waitForTimeout(600);
  t.check('the pencil opens the meal itself', /Edit Blynai/.test(await page.textContent('#sheetRoot h3')) && (await page.$$('#rcItems .rc-item')).length === 4);
  await page.fill('.rc-amt[data-i="0"]', '2');
  await page.click('#rcMore');
  await page.fill('#rcCooked', '400');
  await page.waitForTimeout(200);
  const newWhole = Number((await page.textContent('#rcSum b')).match(/(\d+) kcal/)[1]) * 2;
  await page.click('#rcSave');
  await page.waitForTimeout(500);
  st = await readState(page);
  meal = st.foods.filter((f) => f.name === 'Blynai');
  t.check('changed in place, not copied', meal.length === 1 && meal[0].recipe.servings === 2 && meal[0].recipe.items[0].amount === 2);
  t.check('weighed: it logs by the gram, a serving its share', meal[0].unit === 'g' && meal[0].serving === 200 && Math.abs(meal[0].kcal - newWhole / 4) <= 1,
    JSON.stringify({ u: meal[0].unit, k: meal[0].kcal, s: meal[0].serving, w: newWhole }));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
