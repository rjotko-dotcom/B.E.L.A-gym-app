/* Nothing on any screen overlaps, spills out of its box, or hides behind a
   bar — on a small phone, the S24+, a large one, and the S24+ with large
   text. Every readable or pressable thing is measured against every other
   one in the same layer; what is fixed at the bottom (tab bar, mini bar, rest
   panel) must clear the last of the content when it is scrolled to the end. */
const { openApp } = require('./lib/harness');
const { build } = require('./lib/seed');

const AUDIT = () => {
  const out = [];
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    for (let p = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (+c.opacity === 0 || c.display === 'none') return false; }
    return true;
  };
  // the box an element is actually seen in: clipped by scrolling/overflow ancestors and the viewport
  const clip = (el) => {
    let r = el.getBoundingClientRect();
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const c = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(c.overflow + c.overflowX + c.overflowY)) {
        const q = p.getBoundingClientRect();
        box = { l: Math.max(box.l, q.left), t: Math.max(box.t, q.top), r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) };
      }
    }
    box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, innerWidth), b: Math.min(box.b, innerHeight) };
    return box.r - box.l > 1 && box.b - box.t > 1 ? box : null;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (el.textContent || el.value || el.placeholder || '').trim().slice(0, 24) + '"';
  // what can be read or pressed
  const atoms = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('#sheetGhost, .burst, .splash, svg') && el.tagName !== 'svg') return false;
    if (el.tagName === 'svg') return !el.closest('#sheetGhost') && !el.parentElement.closest('svg');
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return own || /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName);
  }).filter(vis).map((el) => ({ el, box: clip(el) })).filter((a) => a.box);

  // which layer an atom lives in: overlays legitimately sit over the page
  const layer = (el) => el.closest('#sheetRoot') ? 'sheet' : el.closest('.rest-panel') ? 'rest' : el.closest('.mini-bar') ? 'mini'
    : el.closest('.tab-bar') ? 'tabs' : el.closest('.toast-root') ? 'toast' : el.closest('.wk-overlay') ? 'logger' : 'page';
  const top = (L) => document.querySelector('#sheetRoot').children.length ? 'sheet' : null;
  const sheetOpen = !!document.querySelector('#sheetRoot').children.length;
  const loggerOpen = !!document.querySelector('.wk-overlay');
  const live = atoms.filter((a) => {
    const L = layer(a.el);
    if (L === 'toast') return false;
    if (sheetOpen) return L === 'sheet';
    if (loggerOpen) return L === 'logger' || L === 'rest';
    return L === 'page' || L === 'tabs' || L === 'mini';
  });
  // 1. overlapping atoms (not one inside the other)
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], B = live[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    // a ring drawn behind its own figure is one picture, not a collision
    const deco = (x) => x.tagName === 'svg' && getComputedStyle(x).position === 'absolute';
    if (deco(A.el) || deco(B.el)) continue;
    const LA = layer(A.el), LB = layer(B.el);
    const w = Math.min(A.box.r, B.box.r) - Math.max(A.box.l, B.box.l);
    const h = Math.min(A.box.b, B.box.b) - Math.max(A.box.t, B.box.t);
    if (w > 2 && h > 2) {
      // a fixed bar over scrolling content is expected — reported separately below
      if (LA !== LB && ['tabs', 'mini', 'rest'].some((x) => x === LA || x === LB)) continue;
      out.push('OVERLAP ' + name(A.el) + '  ×  ' + name(B.el) + '  (' + Math.round(w) + '×' + Math.round(h) + ')');
    }
  }
  // 2. text spilling out of its own box: the glyphs' own rects against the
  //    element's (scrollWidth is fooled by the invisible tap halos)
  live.forEach(({ el }) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.tagName === 'svg') return;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) return;
    const r = el.getBoundingClientRect();
    [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).forEach((n) => {
      const rg = document.createRange(); rg.selectNodeContents(n);
      [...rg.getClientRects()].forEach((q) => {
        if (q.left < r.left - 1 || q.right > r.right + 1)
          out.push('SPILL ' + name(el) + ' text ' + Math.round(q.left) + '–' + Math.round(q.right) + ' in ' + Math.round(r.left) + '–' + Math.round(r.right));
      });
    });
  });
  // 3. the page must not scroll sideways
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('HSCROLL page ' + document.documentElement.scrollWidth);
  return out;
};

// scrolled to the very end, the last thing must clear whatever is fixed at the bottom
const END = () => {
  const out = [];
  const logger = document.querySelector('.wk-overlay');
  const scroller = logger ? logger.querySelector('.wk-body') : document.scrollingElement;
  if (logger) scroller.scrollTop = 1e6; else window.scrollTo(0, 1e6);
  const covers = [...document.querySelectorAll(logger ? '.rest-panel' : '.tab-bar, .mini-bar')].map((e) => e.getBoundingClientRect().top);
  const line = Math.min(...covers, innerHeight);
  const items = [...(logger ? scroller : document.querySelector('#view')).querySelectorAll('button, input, h3, b, p, span')]
    .filter((e) => e.offsetParent && e.getBoundingClientRect().height > 0);
  const last = items.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
  if (last > line + 1) out.push('HIDDEN at the end: content reaches ' + Math.round(last) + ' but the bar starts at ' + Math.round(line));
  return out;
};


module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const sizes = [
    { width: 360, height: 740, l: 'small phone' },
    { width: 384, height: 832, l: 'S24+' },
    { width: 412, height: 915, l: 'large phone' },
    { width: 384, height: 832, l: 'S24+ large text', big: true },
  ];
  for (const sz of sizes) {
    const seed = build();
    seed.exPrefs = { 'bench-press': { rest: 90 } };
    const page = await openApp(t.browser, { url: server.url, seed, viewport: { width: sz.width, height: sz.height } });
    if (sz.big) {
      await page.addStyleTag({ content: 'html { font-size: 115% !important; }' });
      await page.evaluate(() => dispatchEvent(new Event('resize')));
    }
    const problems = [];
    const look = async (label, end) => {
      await page.waitForTimeout(1000);
      const r = await page.evaluate(AUDIT);
      if (end) r.push(...await page.evaluate(END));
      r.forEach((x) => problems.push(label + ': ' + x));
    };
    const tab = (x) => page.evaluate((k) => document.querySelector('.tab[data-tab="' + k + '"]').click(), x);
    const sheet = async (label, open) => {
      await page.evaluate(open);
      await look('sheet ' + label);
      await page.evaluate(() => document.querySelector('#sheetRoot [data-close]')?.click());
      await page.waitForTimeout(400);
    };
    await look('home');
    for (const x of ['workout', 'meals', 'habits', 'plan', 'bela']) { await tab(x); await look(x, true); }
    await tab('meals'); await page.waitForTimeout(400);
    await sheet('log meal', () => document.querySelector('#addMeal').click());
    await tab('home'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#homeAvatar').click());
    for (const x of ['week', 'trends', 'history', 'library']) {
      await page.evaluate((k) => document.querySelector('#progSeg [data-seg="' + k + '"]').click(), x);
      await look('profile ' + x, true);
    }
    await sheet('settings', () => document.querySelector('#profileSettings').click());
    await tab('home'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#homeStart').click());
    await look('logger');
    await page.evaluate(() => document.querySelector('.ex-block .set-done').click());
    await look('logger resting', true);
    await page.evaluate(() => { document.querySelector('.wk-body').scrollTop = 0; });
    await sheet('exercise menu', () => document.querySelector('.ex-block .ex-menu').click());
    await sheet('rest picker', () => document.querySelector('.ex-block .ex-rest-line').click());
    await page.evaluate(() => document.querySelector('#wkMin').click());
    await look('home with the mini bar');
    await tab('workout'); await look('workouts with the mini bar', true);
    await page.evaluate(() => document.querySelector('#miniExpand').click());
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#wkFinishTop').click());
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#confirmFinish').click());
    await look('workout complete');
    t.check(sz.l + ': nothing overlaps, spills or hides', problems.length === 0, problems.slice(0, 6).join(' | '));
    t.equal(sz.l + ': no page errors', page.errors.length, 0);
    await page.close();
  }
  await server.close();
};
