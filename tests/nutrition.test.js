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

  t.equal('no page errors', page.errors.length, 0);
  await page.close();
  await server.close();
};
