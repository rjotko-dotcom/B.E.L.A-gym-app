/* The number pad in the logger: it opens on a tap (never on its own), types
   into the real box, steps by a plate or a rep, copies the set above, walks
   weight → reps → next set, and can be switched off for the keyboard. */
const { openApp, readState } = require('./lib/harness');
const seedLib = require('./lib/seed');
// the logger's own mechanics, without the coach's warm-ups and targets
// (tests/coach.test.js and tests/trainer.test.js have those)
const build = () => { const s = seedLib.build(); s.settings.autoProgress = false; return s; };

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  const isOpen = () => page.evaluate(() => !!document.querySelector('#numPad.is-open'));
  const key = (k) => page.evaluate((x) => document.querySelector('#numPad [data-k="' + x + '"]')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })), k);
  const sets = async () => (await readState(page)).activeWorkout.exercises[0].sets;

  t.check('the pad is closed until a box is tapped', !(await isOpen()));
  t.equal('the boxes do not raise the phone keyboard', await page.getAttribute('.ex-block .in-weight', 'inputmode'), 'none');
  await page.click('.ex-block .in-weight');
  await page.waitForTimeout(400);
  t.check('tapping a weight opens it', await isOpen());
  t.equal('it says what it is typing', await page.textContent('#npLabel'), 'Weight · kg · set 1');

  for (const k of ['1', '0', '0']) await key(k);
  t.equal('digits type into the box', await page.inputValue('.ex-block .in-weight'), '100');
  t.equal('and are saved like typing', (await sets())[0].weight, 100);
  await key('plus');
  t.equal('+ adds a plate step', (await sets())[0].weight, 102.5);
  await key('minus'); await key('minus');
  t.equal('− takes it off', (await sets())[0].weight, 97.5);
  await key('back');
  t.equal('delete takes the last figure', await page.inputValue('.ex-block .in-weight'), '97.');

  await key('next');
  t.equal('next goes on to the reps', await page.textContent('#npLabel'), 'Reps · set 1');
  await key('8');
  t.equal('a fresh box is replaced, not appended to', (await sets())[0].reps, 8);
  await key('.');
  t.equal('reps take no decimal point', (await sets())[0].reps, 8);
  await key('next');
  t.equal('then the next set\'s weight', await page.textContent('#npLabel'), 'Weight · kg · set 2');
  await key('same');
  t.equal('same copies the set above', (await sets())[1].weight, 97);
  await key('next');
  await key('plus');
  t.equal('+ on an empty reps box starts from the hint', (await sets())[1].reps, 9);

  await key('done');
  await page.waitForTimeout(350);
  t.check('done puts it away', !(await isOpen()));

  // filling a box any other way never summons it
  await page.fill('.ex-block .set-row:nth-of-type(3) .in-weight, .ex-block .in-weight >> nth=2', '60');
  await page.waitForTimeout(300);
  t.check('a value filled in without a tap leaves it closed', !(await isOpen()));

  // a tap elsewhere closes it
  await page.click('.ex-block .in-reps');
  await page.waitForTimeout(300);
  t.check('reps open it too', await isOpen());
  await page.click('.wk-title');
  await page.waitForTimeout(300);
  t.check('a tap elsewhere closes it', !(await isOpen()));

  // switched off: the keyboard is back
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.settings.numPad = false;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(700);
  t.check('switched off, the box raises the keyboard again', await page.getAttribute('.ex-block .in-weight', 'inputmode') !== 'none');
  await page.click('.ex-block .in-weight');
  await page.waitForTimeout(300);
  t.check('and no pad opens', !(await isOpen()));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();
  await server.close();
};
