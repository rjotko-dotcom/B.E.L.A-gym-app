/* B.E.L.A — motion. The view is rebuilt from a string on every action, so
   nothing in it can transition on its own; everything here works by
   remembering what was on screen last time and animating the fresh element
   from there. Also the confetti, the tab bar's marker and the segmented
   controls' sliding thumb. No app state: the only thing it is told is which
   tab is showing (scope), so each tab remembers its own bars. */
(function () {
  'use strict';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const { fmtNum } = window.BelaFormat;

  function create({ scope }) {
    /* A figure that changes rolls to its new value rather than jumping. The
       view is rebuilt wholesale on every action, so the last value is kept by
       name and the animation runs on the fresh element. */
    const rollLast = new Map();
    const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    function rollNumbers(root = $('#view')) {
      $$('[data-roll]', root).forEach((el) => {
        const name = el.dataset.roll;
        const to = Number(el.dataset.rollTo);
        const had = rollLast.has(name);
        const from = had ? rollLast.get(name) : to;
        rollLast.set(name, to);
        if (!had || from === to || !Number.isFinite(to) || reducedMotion()) return;
        const dec = Number(el.dataset.rollDec || 0);
        const fmt = (n) => (dec ? fmtNum(Number(n.toFixed(dec))) : Math.round(n).toLocaleString());
        const started = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - started) / 420);
          const eased = 1 - Math.pow(1 - k, 3);
          el.firstChild.textContent = fmt(from + (to - from) * eased);
          if (k < 1) requestAnimationFrame(step);
        };
        el.firstChild.textContent = fmt(from);
        requestAnimationFrame(step);
      });
    }

    /* ---------------- motion ----------------
       The view is rebuilt from a string on every action, so nothing in it can
       transition on its own — a bar that was 40% is simply a new bar at 60%.
       These put the movement back: each one remembers what was on screen last
       time and animates the fresh element from there.

       Arriving on a tab, the blocks rise in one after another and every bar and
       ring fills from empty. After that, only what changed moves. */

    /* Bars carry their value as an inline width; rings as a stroke-dashoffset
       on a circle with a dasharray. Both are matched by shape rather than by
       a list of class names, so a new card gets the motion without asking. */
    const BAR_SEL = '.macro-fill, .mc-fill, .gb-fill, .mb-fill, .ms-fill, .ds-bar > div, .hg-bar b';
    const RING_SEL = 'circle[stroke-dasharray][stroke-dashoffset]';
    const progressLast = new Map();
    function animateProgress(root, entering) {
      const bars = $$(BAR_SEL, root).filter((el) => el.style.width);
      const rings = $$(RING_SEL, root);
      const fills = $$('.hs-fill, .hc-fill', root).filter((el) => el.style.height);
      const plan = [];
      const remember = (kind, list, read, empty) => list.forEach((el, i) => {
        const key = scope() + kind + i;
        const to = read(el);
        const from = progressLast.has(key) && !entering ? progressLast.get(key) : entering ? empty(el) : null;
        progressLast.set(key, to);
        if (from != null && from !== to) plan.push([el, kind, from, to]);
      });
      remember('b', bars, (el) => el.style.width, () => '0%');
      remember('f', fills, (el) => el.style.height, () => '0%');
      remember('r', rings, (el) => el.getAttribute('stroke-dashoffset'), (el) => el.getAttribute('stroke-dasharray'));
      if (!plan.length || reducedMotion()) return;
      const prop = { b: 'width', f: 'height', r: 'strokeDashoffset' };
      // everything to its starting point, one layout, then everything goes
      plan.forEach(([el, k, from]) => { el.style.transition = 'none'; el.style[prop[k]] = k === 'r' ? from + 'px' : from; });
      void document.body.offsetWidth;
      plan.forEach(([el, k, , to], n) => {
        const delay = entering ? 120 + Math.min(n, 10) * 30 : 0;
        const css = k === 'r' ? 'stroke-dashoffset' : prop[k];
        el.style.transition = css + ' 0.75s var(--ease-out) ' + delay + 'ms';
        el.style[prop[k]] = k === 'r' ? to + 'px' : to;
        // hand the value back to the markup once it has arrived
        el.addEventListener('transitionend', () => { el.style.transition = ''; if (k === 'r') el.style.strokeDashoffset = ''; }, { once: true });
      });
    }

    /* Something you just finished — a habit ticked, a cell filled — gets a
       moment of its own: the tick draws itself in. Found by comparing what is
       done now with what was done in the last render of the same tab. */
    const doneLast = new Map();
    function markJustDone(root, entering) {
      [['.hb-row[data-habit]', 'habit', 'is-done'], ['.hs-cell[data-h]', 'h', 'is-full']].forEach(([sel, attr, cls]) => {
        const key = scope() + sel;
        const prev = doneLast.get(key);
        const now = new Set();
        $$(sel, root).forEach((el) => {
          if (!el.classList.contains(cls)) return;
          const id = el.dataset[attr];
          now.add(id);
          if (prev && !entering && !prev.has(id) && !reducedMotion()) el.classList.add('just-done');
        });
        doneLast.set(key, now);
      });
    }

    /* Arriving on a tab: the blocks come up one after the other. Only on
       arrival — a page that rose up again on every tick of a habit would read
       as slow, not alive. The index is a custom property so the CSS keeps the
       timing in one place. */
    function staggerIn(v) {
      if (reducedMotion()) return;
      [...v.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));
      v.classList.remove('view-enter');
      void v.offsetWidth;
      v.classList.add('view-enter');
      clearTimeout(staggerIn.t);
      staggerIn.t = setTimeout(() => v.classList.remove('view-enter'), 900);
    }

    /* The tab bar's marker is one pill that slides to the tab you picked, so
       the eye follows the move instead of seeing one dot vanish and another
       appear. */
    function moveTabIndicator(instant) {
      const bar = $('.tab-bar');
      if (!bar) return;
      const on = $('.tab.active', bar);
      let ind = $('.tab-ind', bar);
      if (!ind) {
        ind = document.createElement('span');
        ind.className = 'tab-ind';
        ind.setAttribute('aria-hidden', 'true');
        bar.prepend(ind);
        instant = true;
      }
      // profile has no tab of its own: the marker steps aside rather than lie
      ind.classList.toggle('is-off', !on);
      if (!on) return;
      const svg = $('svg', on);
      const b = bar.getBoundingClientRect();
      // a sidebar (wide screens) marks the whole row; a bottom bar, the icon
      const side = b.height > b.width;
      const r = (side ? on : svg || on).getBoundingClientRect();
      if (!r.width) return;
      const w = side ? r.width : 56, h = side ? r.height : 32;
      const x = r.left - b.left + r.width / 2 - w / 2;
      const y = r.top - b.top + r.height / 2 - h / 2;
      ind.style.width = w + 'px'; ind.style.height = h + 'px';
      if (instant || reducedMotion()) ind.style.transition = 'none';
      ind.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
    }
    addEventListener('resize', () => moveTabIndicator(true));

    /* Segmented controls get a thumb that slides to the picked option, the
       way a native control does. Some are switched in place and some are
       rebuilt with their view, so one observer watches for both: an option
       changing class, or a control arriving. The last position of each is kept
       by its id, so a rebuilt control slides from where the old one was. */
    const segLast = new Map();
    function syncSeg(seg) {
      const on = $(':scope > button.on, :scope > button.is-on', seg);
      let thumb = $(':scope > .seg-thumb', seg);
      if (!on || !on.offsetWidth) { if (thumb) thumb.style.opacity = '0'; return; }
      if (!thumb) {
        thumb = document.createElement('span');
        thumb.className = 'seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        seg.appendChild(thumb);      // last, so :first-child still means the first option
        seg.classList.add('has-thumb');
      }
      const box = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
      const key = seg.id || '';
      const prev = segLast.get(key);
      const place = (b) => {
        thumb.style.width = b.w + 'px'; thumb.style.height = b.h + 'px';
        thumb.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px)';
      };
      const fresh = !thumb.style.width;
      if (fresh && prev && prev.seg !== seg && !reducedMotion()) {
        // a rebuilt control: start where the old thumb stood
        thumb.style.transition = 'none'; place(prev); void thumb.offsetWidth; thumb.style.transition = '';
      } else if (fresh) {
        thumb.style.transition = 'none'; place(box); void thumb.offsetWidth; thumb.style.transition = '';
      }
      place(box);
      thumb.style.opacity = '';
      segLast.set(key, { ...box, seg });
    }
    let segQueued = new Set(), segFrame = 0;
    const queueSeg = (seg) => {
      if (!seg) return;
      segQueued.add(seg);
      if (!segFrame) segFrame = requestAnimationFrame(() => {
        const list = segQueued; segQueued = new Set(); segFrame = 0;
        list.forEach((s) => { if (s.isConnected) syncSeg(s); });
      });
    };
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') {
          if (m.target.parentElement && m.target.parentElement.classList.contains('seg')) queueSeg(m.target.parentElement);
        } else {
          m.addedNodes.forEach((n) => {
            if (n.nodeType !== 1 || n.classList.contains('seg-thumb')) return;
            if (n.classList.contains('seg')) queueSeg(n);
            n.querySelectorAll && n.querySelectorAll('.seg').forEach(queueSeg);
          });
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', () => $$('.seg').forEach(queueSeg));

    /* A burst of confetti from an element — for the moments that earn it: a day
       of habits closed, a session with a record in it. Monochrome with the one
       green, like everything else. Drawn on a canvas so it costs nothing once
       it has fallen. */
    function burst(fromEl, { count = 34, spread = 1 } = {}) {
      if (reducedMotion() || !fromEl) return;
      const r = fromEl.getBoundingClientRect();
      const cv = document.createElement('canvas');
      cv.className = 'burst';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      document.body.appendChild(cv);
      const cx = cv.getContext('2d');
      cx.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement);
      const colors = [css.getPropertyValue('--done').trim(), css.getPropertyValue('--ink-1').trim(), css.getPropertyValue('--ink-2').trim()];
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const bits = Array.from({ length: count }, (_, i) => {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25 * spread;
        const sp = 5 + Math.random() * 7;
        return {
          x: ox + (Math.random() - 0.5) * r.width * 0.4, y: oy,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
          w: 4 + Math.random() * 5, h: 2.5 + Math.random() * 3,
          c: colors[i % 3] || '#fff', round: Math.random() < 0.35,
        };
      });
      const t0 = performance.now();
      const frame = (now) => {
        const t = (now - t0) / 1000;
        cx.clearRect(0, 0, innerWidth, innerHeight);
        bits.forEach((p) => {
          p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          cx.save();
          cx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.7) / 0.6);
          cx.translate(p.x, p.y); cx.rotate(p.rot);
          cx.fillStyle = p.c;
          if (p.round) { cx.beginPath(); cx.arc(0, 0, p.h, 0, Math.PI * 2); cx.fill(); }
          else cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          cx.restore();
        });
        if (t < 1.35) requestAnimationFrame(frame); else cv.remove();
      };
      requestAnimationFrame(frame);
    }

    return { reducedMotion, rollNumbers, animateProgress, markJustDone, staggerIn, moveTabIndicator, burst };
  }

  window.BelaMotion = { create };
})();
