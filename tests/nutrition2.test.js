/* Nutrition, read over a week and a meal: the week's average against the
   goal, the eating window, protein per main meal, and recipes. The seed has
   yesterday's three meals at 08:10, 13:00 and 19:30. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  // a second logged day so the week has an average
  const d2 = new Date(Date.now() - 2 * 864e5);
  const k2 = d2.getFullYear() + '-' + String(d2.getMonth() + 1).padStart(2, '0') + '-' + String(d2.getDate()).padStart(2, '0');
  seed.nutrition.meals.push({ id: 'z1', date: k2, slot: 'lunch', time: '12:00', name: 'Pasta', kcal: 3400, protein: 90, carbs: 400, fat: 120 });
  const page = await openApp(t.browser, { url: server.url, seed });
  await page.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
  await page.waitForTimeout(500);
  await page.click('#dayPrev');
  await page.waitForTimeout(500);

  t.equal('the eating window is told', (await page.textContent('.nh-window')).trim(), 'Eating window 08:10 – 19:30 · 11 h 20 min');
  const pro = await page.$$eval('.slot-pro', (els) => els.map((e) => e.textContent));
  // target 180 g → 45 g a meal: breakfast 42 short, lunch 58 hit, dinner 46 hit
  t.equal('protein per meal is a quarter of the day\'s', pro.join(' | '), '42 / 45 g protein | 58 g protein ✓ | 46 g protein ✓');
  const avg = await page.textContent('.nw-avg');
  // (1990 + 3400) / 2 = 2695 against 2800
  t.check('the week is read as an average', /2,695/.test(avg) && /2,800/.test(avg), avg);
  t.check('and a big day does not make it a bad week', /On track on average, even with a big day/.test(avg), avg);

  // a recipe: two ingredients, four servings
  await page.click('#addMeal');
  await page.waitForTimeout(500);
  await page.click('#recipeOpen');
  await page.waitForTimeout(500);
  await page.fill('#rcName', 'Chicken rice pot');
  await page.fill('#rcSearch', 'chicken breast');
  await page.waitForTimeout(200);
  await page.click('#rcFound [data-name="Chicken breast"]');
  await page.fill('.rc-amt[data-i="0"]', '600');
  await page.fill('#rcSearch', 'rice');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#rcFound [data-name]').click());
  await page.waitForTimeout(200);
  t.check('the serving is worked out as it is built', /One serving/.test(await page.textContent('#rcSum')));
  await page.click('#rcSave');
  await page.waitForTimeout(500);
  const food = (await readState(page)).foods.find((f) => f.name === 'Chicken rice pot');
  t.check('a recipe is saved as one of your foods', !!food && food.unit === 'piece' && food.recipe.servings === 4 && food.recipe.items.length === 2, JSON.stringify(food));
  // 600 g of chicken breast at 165 kcal / 31 g per 100 g, over four servings
  t.check('per serving', food.kcal > 247 && food.protein > 46.4, food.kcal + ' kcal, ' + food.protein + ' g');
  t.check('and it is back in the meal sheet to log', await page.evaluate(() => /Chicken rice pot/.test(document.querySelector('#sheetRoot').textContent)));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
