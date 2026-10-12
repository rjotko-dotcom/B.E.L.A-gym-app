/* The 3D body: the PC app's hologram, drawn from models/anatomy.glb. It
   replaces the flat map once loaded, shows the model's credit, answers a tap
   on a muscle the app counts, turns to the nearest front or back (never the
   long way round), keeps its turn across a re-render, and leaves the flat
   map in place on a device that cannot draw it. */
const { openApp } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });
  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  const mounted = await page.waitForFunction(() => document.querySelector('.mb-card .mm-wrap.is-3d canvas'), null, { timeout: 30000 }).then(() => true, () => false);
  t.check('the 3D body replaces the flat map', mounted);
  if (!mounted) { await page.close(); await server.close(); return; }
  t.check('the flat map is gone from under it', await page.evaluate(() => !document.querySelector('.mb-card .mm-wrap .mm-svg')));
  t.equal('the model\'s credit is on screen', await page.evaluate(() => {
    const c = document.querySelector('.mb-card .mm-credit');
    return c && !c.hidden && c.offsetHeight > 0 ? c.textContent : null;
  }), 'model: z-anatomy · bodyparts3d, cc by-sa 4.0');
  t.check('every muscle the app counts is in the model', await page.evaluate(() => {
    const keys = BelaBody3D.keys();
    return ['chest', 'front-delt', 'side-delt', 'rear-delt', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'traps',
      'lats', 'upper-back', 'lower-back', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves'].every((k) => keys.includes(k));
  }));

  // the canvas actually has a figure on it (lit pixels in the middle)
  t.check('something is drawn', await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => {
    // read in the frame it was drawn in: WebGL clears the buffer once shown
    const c = document.querySelector('.mb-card canvas');
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
    const x = g.getContext('2d'); x.drawImage(c, 0, 0);
    const d = x.getImageData(c.width / 2 - 20, c.height * 0.3, 40, 40).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    done(lit > 50);
  }))));

  // a tap on the chest names it
  await page.evaluate(() => document.querySelector('.mb-card .mm-stage').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const r = document.querySelector('.mb-card .mm-stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.touchscreen.tap(box.x + box.w / 2 + 16, box.y + box.h * 0.27);
  await page.waitForTimeout(250);
  const cap = await page.textContent('.mb-card .mm-cap');
  t.check('a tap on the chest names it and its sets', /^Chest · 9 sets this week/.test(cap), cap);
  t.equal('and lights it as picked', (await page.evaluate(() => BelaBody3D.inspect('week').selected)), 'chest');

  // back, then front, from a figure dragged a full turn and a bit: the nearest way
  await page.evaluate(() => document.querySelector('.mm-face [data-face="back"]').click());
  await page.waitForFunction(() => BelaBody3D.inspect('week').target == null, null, { timeout: 6000 }).catch(() => {});
  // π or −π (or any turn of it): whichever was nearer
  const backAt = await page.evaluate(() => BelaBody3D.inspect('week'));
  t.check('Back turns it to face away', Math.cos(backAt.rot) < -0.97, JSON.stringify(backAt));
  // drag it right round once more
  const from = await page.evaluate(() => BelaBody3D.inspect('week').rot);
  await page.mouse.move(box.x + 60, box.y + box.h / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 60 + i * 26, box.y + box.h / 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await page.evaluate(() => BelaBody3D.inspect('week').rot);
  t.check('dragging turns the figure', dragged - from > 4, from + ' → ' + dragged);
  t.check('a drag clears which face is showing', await page.evaluate(() => !document.querySelector('.mm-face button.on')));
  await page.evaluate(() => document.querySelector('.mm-face [data-face="front"]').click());
  await page.waitForTimeout(50);
  const target = await page.evaluate(() => BelaBody3D.inspect('week').target);
  t.check('Front goes to the nearest front, not back round', target != null && Math.abs(target - dragged) <= Math.PI && Math.abs(target / (2 * Math.PI) - Math.round(target / (2 * Math.PI))) < 1e-9, target + ' from ' + dragged);

  // a re-render keeps its turn
  await page.waitForFunction(() => BelaBody3D.inspect('week').target == null, null, { timeout: 6000 }).catch(() => {});
  const before = await page.evaluate(() => BelaBody3D.inspect('week').rot);
  await page.evaluate(() => { document.querySelector('.tab[data-tab="home"]').click(); document.querySelector('.tab[data-tab="workout"]').click(); });
  await page.waitForTimeout(300);
  t.check('it survives a re-render, still turned', await page.evaluate(() => !!document.querySelector('.mb-card .mm-wrap.is-3d canvas')) &&
    Math.abs((await page.evaluate(() => BelaBody3D.inspect('week').rot)) - before) < 0.5);
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  // a device without WebGL keeps the flat map, and no credit for a model it is not showing
  const flat = await openApp(t.browser, { url: server.url, seed: build(), init: () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/.test(k) ? null : orig.call(this, k, ...a); };
  } });
  await flat.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await flat.waitForTimeout(1500);
  t.check('no WebGL: the flat map stays', await flat.evaluate(() => !!document.querySelector('.mb-card .mm-svg') && !document.querySelector('.mm-wrap.is-3d')));
  t.check('no WebGL: no credit for a model not shown', await flat.evaluate(() => document.querySelector('.mb-card .mm-credit').hidden));
  t.equal('no WebGL: no page errors', flat.errors.length, 0, flat.errors.join(' | '));
  await flat.close();
  await server.close();
};
