/* ============================================================
   B.E.L.A Gym — app logic
   Workouts + nutrition. Data lives in localStorage ("bela-gym-v1").
   ============================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'bela-gym-v1';
  const APP_VERSION = '1.7';

  /* ---------------- state ---------------- */

  const defaultState = () => ({
    settings: { unit: 'kg', restSeconds: 90, appearance: 'system' },
    nutrition: {
      targets: { kcal: 2800, protein: 180, carbs: 300, fat: 70 },
      meals: [],   // { id, date:'YYYY-MM-DD', time, name, kcal, protein, carbs, fat }
      weights: [], // { date:'YYYY-MM-DD', value }
    },
    customExercises: [],
    templates: [],
    workouts: [],          // finished workouts, newest first
    activeWorkout: null,
  });

  let state = load();
  let currentTab = 'home';
  let progressSeg = 'trends';      // trends | history | library
  let expandedHistoryId = null;
  let progressExerciseId = null;
  let librarySearch = '';
  let mealDayOffset = 0;           // 0 = today, -1 = yesterday…

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const d = defaultState();
      // migrate the old theme setting: an explicit dark choice is kept,
      // the old implicit light default becomes "follow the device"
      if (parsed.settings && !parsed.settings.appearance) {
        parsed.settings.appearance = parsed.settings.theme === 'dark' ? 'dark' : 'system';
      }
      return {
        ...d, ...parsed,
        settings: { ...d.settings, ...(parsed.settings || {}) },
        nutrition: {
          ...d.nutrition, ...(parsed.nutrition || {}),
          targets: { ...d.nutrition.targets, ...(parsed.nutrition?.targets || {}) },
        },
      };
    } catch {
      return defaultState();
    }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function applyTheme() {
    const a = state.settings.appearance;
    if (a === 'dark' || a === 'light') document.documentElement.dataset.theme = a;
    else delete document.documentElement.dataset.theme;
    // set every theme-color variant so Android honors it in system dark mode
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const mediaDark = (m.getAttribute('media') || '').includes('dark');
      m.content = a === 'system' ? (mediaDark ? '#0d0d0d' : '#f7f7f6') : (a === 'dark' ? '#0d0d0d' : '#f7f7f6');
    });
  }
  applyTheme();

  /* ---------------- helpers ---------------- */

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function allExercises() { return [...EXERCISE_LIBRARY, ...state.customExercises]; }
  function exerciseById(id) { return allExercises().find((e) => e.id === id); }
  function unit() { return state.settings.unit; }

  function dateKey(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  function dayWithOffset(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtShortDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtClock(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function fmtDuration(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
  }
  function fmtNum(n) { return n % 1 === 0 ? String(n) : n.toFixed(1); }

  // Epley estimated 1RM; for reps === 1 it's just the weight.
  function est1RM(weight, reps) {
    if (!weight || !reps) return 0;
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }

  function loggedSets(workout) {
    return workout.exercises.flatMap((ex) => ex.sets.filter((s) => s.done));
  }
  function workoutVolume(workout) {
    return loggedSets(workout).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  }
  function bestSetFor(exerciseId) {
    let best = null;
    for (const w of state.workouts) {
      for (const ex of w.exercises) {
        if (ex.exerciseId !== exerciseId) continue;
        for (const s of ex.sets) {
          if (!s.done || !s.weight) continue;
          if (!best || est1RM(s.weight, s.reps) > est1RM(best.weight, best.reps)) best = s;
        }
      }
    }
    return best;
  }
  function previousSets(exerciseId) {
    for (const w of state.workouts) {
      const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (ex) {
        const done = ex.sets.filter((s) => s.done);
        if (done.length) return done;
      }
    }
    return [];
  }

  /* -------- nutrition helpers -------- */

  function mealsForDay(key) {
    return state.nutrition.meals.filter((m) => m.date === key);
  }
  function dayTotals(key) {
    return mealsForDay(key).reduce(
      (t, m) => ({
        kcal: t.kcal + (m.kcal || 0),
        protein: t.protein + (m.protein || 0),
        carbs: t.carbs + (m.carbs || 0),
        fat: t.fat + (m.fat || 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }
  function latestWeight() {
    const ws = [...state.nutrition.weights].sort((a, b) => a.date.localeCompare(b.date));
    return ws[ws.length - 1] ?? null;
  }
  function weightOn(key) {
    return state.nutrition.weights.find((w) => w.date === key) ?? null;
  }
  function weekDelta() {
    const ws = [...state.nutrition.weights].sort((a, b) => a.date.localeCompare(b.date));
    if (ws.length < 2) return null;
    const last = ws[ws.length - 1];
    const weekAgoKey = dateKey(dayWithOffset(-7));
    // closest entry at or before a week ago, else the oldest
    let ref = ws[0];
    for (const w of ws) if (w.date <= weekAgoKey) ref = w;
    if (ref === last) ref = ws[ws.length - 2];
    return Math.round((last.value - ref.value) * 10) / 10;
  }

  function toast(msg) {
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /* ---------------- bottom sheet ---------------- */

  function openSheet(title, bodyHtml, onMount) {
    const root = $('#sheetRoot');
    root.innerHTML = `
      <div class="sheet-backdrop">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="sheet-grab"></div>
          <div class="sheet-head">
            <h3>${esc(title)}</h3>
            <button class="icon-btn" data-close aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>
            </button>
          </div>
          <div class="sheet-body"></div>
        </div>
      </div>`;
    const body = $('.sheet-body', root);
    body.innerHTML = bodyHtml;
    const backdrop = $('.sheet-backdrop', root);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-close]')) closeSheet();
    });
    if (onMount) onMount(body);
  }
  function closeSheet() { $('#sheetRoot').innerHTML = ''; }

  /* ---------------- rest timer ---------------- */

  const rest = { remaining: 0, total: 0, timer: null };

  function startRest(seconds = state.settings.restSeconds) {
    stopRest();
    rest.total = seconds;
    rest.remaining = seconds;
    $('#restBar').hidden = false;
    renderRest();
    rest.timer = setInterval(() => {
      rest.remaining -= 1;
      if (rest.remaining <= 0) {
        stopRest();
        toast('Rest over — next set!');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        return;
      }
      renderRest();
    }, 1000);
  }
  function stopRest() {
    clearInterval(rest.timer);
    rest.timer = null;
    $('#restBar').hidden = true;
  }
  function renderRest() {
    $('#restTime').textContent = fmtClock(Math.max(0, rest.remaining));
    $('#restFill').style.width = `${(rest.remaining / rest.total) * 100}%`;
  }
  $('#restSkip').addEventListener('click', stopRest);
  $('#restPlus').addEventListener('click', () => { rest.remaining += 15; rest.total = Math.max(rest.total, rest.remaining); renderRest(); });
  $('#restMinus').addEventListener('click', () => {
    rest.remaining -= 15;
    if (rest.remaining <= 0) stopRest(); else renderRest();
  });

  /* ---------------- workout elapsed clock ---------------- */

  let elapsedTimer = null;
  function tickElapsed() {
    const el = $('#wkElapsed');
    if (el && state.activeWorkout) {
      el.textContent = fmtDuration(Date.now() - state.activeWorkout.startedAt);
    }
  }
  function ensureElapsedTimer() {
    if (state.activeWorkout && !elapsedTimer) elapsedTimer = setInterval(tickElapsed, 30000);
    if (!state.activeWorkout && elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  }

  /* ================= HOME TAB ================= */

  // SVG gauge: 270° arc open at the bottom, rounded caps
  function gaugeSVG(fraction, over) {
    const size = 120, cx = 60, cy = 60, r = 46, sw = 11;
    const start = 135, sweep = 270;
    const clamped = Math.min(1, Math.max(0, fraction));
    const polar = (deg) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    const arc = (from, to) => {
      const [x1, y1] = polar(from), [x2, y2] = polar(to);
      const large = to - from > 180 ? 1 : 0;
      return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
    };
    const end = start + Math.max(0.01, clamped * sweep);
    return `
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Calories: ${Math.round(fraction * 100)} percent of target">
      <path d="${arc(start, start + sweep)}" fill="none" stroke="var(--surface-2)" stroke-width="${sw}" stroke-linecap="round"/>
      ${clamped > 0 ? `<path d="${arc(start, end)}" fill="none" stroke="${over ? 'var(--critical)' : 'var(--ink-1)'}" stroke-width="${sw}" stroke-linecap="round"/>` : ''}
    </svg>`;
  }

  function macroRowsHTML(totals, targets) {
    const rows = [
      ['Protein', totals.protein, targets.protein],
      ['Carbs', totals.carbs, targets.carbs],
      ['Fat', totals.fat, targets.fat],
    ];
    return rows.map(([label, val, target]) => {
      const pct = target ? Math.min(100, (val / target) * 100) : 0;
      const over = target && val > target;
      return `
      <div class="macro-row">
        <div class="m-head">
          <span class="micro">${label}</span>
          <span class="m-val">${Math.round(val)}g / ${target}g</span>
        </div>
        <div class="macro-track"><div class="macro-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  function renderHome() {
    const v = $('#view');
    const today = new Date();
    const todayKey = dateKey(today);
    const totals = dayTotals(todayKey);
    const targets = state.nutrition.targets;
    const frac = targets.kcal ? totals.kcal / targets.kcal : 0;
    const over = totals.kcal > targets.kcal;

    // week strip: Monday-based current week
    const dow = (today.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
    const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const workoutDays = new Set(state.workouts.map((w) => dateKey(new Date(w.startedAt))));
    const mealDays = new Set(state.nutrition.meals.map((m) => m.date));

    const strip = letters.map((L, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      const key = dateKey(d);
      const isToday = key === todayKey;
      const active = key < todayKey || workoutDays.has(key) || mealDays.has(key);
      return `
        <div class="wd">
          <span class="wd-letter">${L}</span>
          <span class="wd-dot ${isToday ? 'today' : active ? 'active' : ''}">${d.getDate()}</span>
        </div>`;
    }).join('');

    // bodyweight mini bars for this week
    const weekWeights = letters.map((_, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      return { key: dateKey(d), letter: letters[i], entry: weightOn(dateKey(d)) };
    });
    const vals = weekWeights.filter((x) => x.entry).map((x) => x.entry.value);
    const lo = vals.length ? Math.min(...vals) - 1 : 0;
    const hi = vals.length ? Math.max(...vals) + 1 : 1;
    const barH = (val) => 22 + ((val - lo) / Math.max(0.1, hi - lo)) * 32; // 22–54 px
    const miniBars = weekWeights.map((x) => `
      <div class="col">
        <div class="bar ${x.entry ? (x.key === todayKey ? 'today' : 'has') : ''}"
             style="height:${x.entry ? barH(x.entry.value).toFixed(0) : 40}px"></div>
        <span class="lbl">${x.letter}</span>
      </div>`).join('');

    const lw = latestWeight();
    const delta = weekDelta();
    const active = state.activeWorkout;

    v.innerHTML = `
      <div class="home-top">
        <h2>Home</h2>
        <button class="icon-btn" id="homeSettings" aria-label="Settings">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>

      <div class="week-strip">${strip}</div>

      <div class="card bw-card" id="bwCard" role="button" tabindex="0" aria-label="Log bodyweight">
        <div>
          <span class="micro">Bodyweight</span>
          <div class="bw-value">${lw ? fmtNum(lw.value) : '—'}<span class="t-unit"> ${esc(unit())}</span></div>
          <div class="bw-delta">${
            delta == null ? 'Tap to log today' :
            `This week <b>${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${esc(unit())} ${delta > 0 ? '↑' : delta < 0 ? '↓' : '→'}</b>`
          }</div>
        </div>
        <div class="bw-mini">${miniBars}</div>
      </div>

      <div class="home-grid2 home-row">
        <div class="card kcal-card">
          <span class="micro">Calories</span>
          <div class="gauge-wrap">
            ${gaugeSVG(frac, over)}
            <div class="gauge-center">${Math.round(frac * 100)}%</div>
          </div>
          <div class="kcal-total"><b class="${over ? 'over' : ''}">${Math.round(totals.kcal)}</b> / ${targets.kcal.toLocaleString()}</div>
          <div class="kcal-unit">kcal</div>
        </div>
        <div class="card">
          <div class="macro-list">${macroRowsHTML(totals, targets)}</div>
        </div>
      </div>

      <div class="home-grid2">
        <div class="card shortcut-card">
          <h3>Workouts</h3>
          <p>${active ? 'Session in progress' : 'Track and improve'}</p>
          <button class="btn btn-primary" id="homeStart">${active ? 'Resume' : 'Start'}</button>
        </div>
        <div class="card shortcut-card">
          <h3>Meals</h3>
          <p>Log and track nutrition</p>
          <button class="btn btn-primary" id="homeLog">Log</button>
        </div>
      </div>`;

    $('#homeSettings').addEventListener('click', openSettings);
    $('#bwCard').addEventListener('click', openWeightSheet);
    $('#homeStart').addEventListener('click', () => { currentTab = 'workout'; render(); });
    $('#homeLog').addEventListener('click', () => { mealDayOffset = 0; openMealSheet(); });
  }

  function openWeightSheet() {
    const todayKey = dateKey();
    const existing = weightOn(todayKey);
    openSheet('Log bodyweight', `
      <div class="field">
        <label for="bwInput">Today's weight (${esc(unit())})</label>
        <input id="bwInput" type="number" inputmode="decimal" step="0.1" min="0"
               value="${existing ? existing.value : latestWeight()?.value ?? ''}" placeholder="e.g. 77.9">
      </div>
      <button class="btn btn-primary" id="bwSave">Save</button>
      ${existing ? '<button class="btn btn-danger" id="bwDelete" style="margin-top:10px">Remove today’s entry</button>' : ''}
    `, (body) => {
      const input = $('#bwInput', body);
      input.focus();
      $('#bwSave', body).addEventListener('click', () => {
        const val = Number(input.value);
        if (!val || val <= 0) { toast('Enter a weight'); return; }
        state.nutrition.weights = state.nutrition.weights.filter((w) => w.date !== todayKey);
        state.nutrition.weights.push({ date: todayKey, value: Math.round(val * 10) / 10 });
        save(); closeSheet(); render();
        toast('Bodyweight logged');
      });
      $('#bwDelete', body)?.addEventListener('click', () => {
        state.nutrition.weights = state.nutrition.weights.filter((w) => w.date !== todayKey);
        save(); closeSheet(); render();
      });
    });
  }

  /* ================= MEALS TAB ================= */

  function renderMeals() {
    const v = $('#view');
    const day = dayWithOffset(mealDayOffset);
    const key = dateKey(day);
    const meals = mealsForDay(key);
    const totals = dayTotals(key);
    const targets = state.nutrition.targets;
    const frac = targets.kcal ? totals.kcal / targets.kcal : 0;
    const over = totals.kcal > targets.kcal;
    const label = mealDayOffset === 0 ? 'Today' : mealDayOffset === -1 ? 'Yesterday' : fmtDate(day.getTime());

    v.innerHTML = `
      <h2>Meals</h2>
      <p class="subtitle">Log and track nutrition</p>

      <div class="day-nav">
        <button id="dayPrev" aria-label="Previous day">‹</button>
        <span class="dn-label">${esc(label)}</span>
        <button id="dayNext" aria-label="Next day" ${mealDayOffset >= 0 ? 'disabled style="opacity:0.35"' : ''}>›</button>
      </div>

      <div class="home-grid2 home-row">
        <div class="card kcal-card">
          <span class="micro">Calories</span>
          <div class="gauge-wrap">
            ${gaugeSVG(frac, over)}
            <div class="gauge-center">${Math.round(frac * 100)}%</div>
          </div>
          <div class="kcal-total"><b class="${over ? 'over' : ''}">${Math.round(totals.kcal)}</b> / ${targets.kcal.toLocaleString()}</div>
          <div class="kcal-unit">kcal</div>
        </div>
        <div class="card">
          <div class="macro-list">${macroRowsHTML(totals, targets)}</div>
        </div>
      </div>

      <button class="btn btn-primary" id="addMeal" style="margin-bottom:16px">+ Log a meal</button>

      ${meals.length ? meals.map((m) => `
        <div class="card meal-item">
          <div>
            <div class="mi-name">${esc(m.name)}</div>
            <div class="mi-sub">P ${Math.round(m.protein)}g · C ${Math.round(m.carbs)}g · F ${Math.round(m.fat)}g${m.time ? ' · ' + esc(m.time) : ''}</div>
          </div>
          <span class="mi-kcal">${Math.round(m.kcal)}<span class="t-unit"> kcal</span></span>
          <button class="meal-del" data-del="${esc(m.id)}" aria-label="Delete meal">
            <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>`).join('')
      : `<p class="empty-note">Nothing logged ${mealDayOffset === 0 ? 'today' : 'this day'} yet.</p>`}`;

    $('#dayPrev').addEventListener('click', () => { mealDayOffset -= 1; render(); });
    $('#dayNext').addEventListener('click', () => { if (mealDayOffset < 0) { mealDayOffset += 1; render(); } });
    $('#addMeal').addEventListener('click', () => openMealSheet(key));
    $$('.meal-del', v).forEach((b) => b.addEventListener('click', () => {
      state.nutrition.meals = state.nutrition.meals.filter((m) => m.id !== b.dataset.del);
      save(); render();
    }));
  }

  function openMealSheet(key = dateKey()) {
    // recent custom entries (not in the food library), newest first, unique by name
    const libNames = new Set(FOOD_LIBRARY.map((f) => f.name));
    const recents = [];
    for (const m of [...state.nutrition.meals].reverse()) {
      if (libNames.has(m.name) || recents.some((r) => r.name === m.name)) continue;
      recents.push(m);
      if (recents.length >= 6) break;
    }

    const foodRow = (f, tag) => `
      <div class="lib-item" data-food="${esc(JSON.stringify({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }))}" role="button" tabindex="0">
        <div>
          <div class="li-name">${esc(f.name)}</div>
          <div class="li-sub">${Math.round(f.kcal)} kcal · P ${Math.round(f.protein)} · C ${Math.round(f.carbs)} · F ${Math.round(f.fat)}${tag ? ' · ' + tag : ''}</div>
        </div>
        <span class="li-best">+</span>
      </div>`;

    const listHtml = (q) => {
      const query = q.trim().toLowerCase();
      const rec = recents.filter((f) => !query || f.name.toLowerCase().includes(query));
      const lib = FOOD_LIBRARY.filter((f) => !query || f.name.toLowerCase().includes(query));
      let html = '';
      if (rec.length) html += `<div class="lib-group-title">Recent</div>` + rec.map((f) => foodRow(f)).join('');
      if (lib.length) html += `<div class="lib-group-title">Common foods</div>` + lib.map((f) => foodRow(f)).join('');
      if (!html) html = `<p class="empty-note">No matches — use the custom entry below.</p>`;
      return html;
    };

    openSheet('Log a meal', `
      <input class="search-field" id="foodSearch" type="search" placeholder="Search foods…" autocomplete="off">
      <div id="foodList">${listHtml('')}</div>
      <div class="section-title">Custom entry</div>
      <div class="field"><label for="cmName">Name</label><input id="cmName" type="text" placeholder="e.g. Chicken bowl"></div>
      <div class="field-row">
        <div class="field"><label for="cmKcal">kcal</label><input id="cmKcal" type="number" inputmode="numeric" min="0" placeholder="0"></div>
        <div class="field"><label for="cmProtein">Protein g</label><input id="cmProtein" type="number" inputmode="numeric" min="0" placeholder="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="cmCarbs">Carbs g</label><input id="cmCarbs" type="number" inputmode="numeric" min="0" placeholder="0"></div>
        <div class="field"><label for="cmFat">Fat g</label><input id="cmFat" type="number" inputmode="numeric" min="0" placeholder="0"></div>
      </div>
      <button class="btn btn-primary" id="cmAdd">Add meal</button>
    `, (body) => {
      const addMeal = (f) => {
        state.nutrition.meals.push({
          id: uid(), date: key,
          time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          name: f.name, kcal: f.kcal || 0, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0,
        });
        save(); closeSheet();
        currentTab = 'meals';
        render();
        toast(`${f.name} logged`);
      };

      const search = $('#foodSearch', body);
      const list = $('#foodList', body);
      search.addEventListener('input', () => { list.innerHTML = listHtml(search.value); });
      list.addEventListener('click', (e) => {
        const item = e.target.closest('[data-food]');
        if (item) addMeal(JSON.parse(item.dataset.food));
      });
      $('#cmAdd', body).addEventListener('click', () => {
        const name = $('#cmName', body).value.trim();
        const kcal = Number($('#cmKcal', body).value) || 0;
        if (!name) { toast('Give the meal a name'); return; }
        if (!kcal) { toast('Enter calories'); return; }
        addMeal({
          name, kcal,
          protein: Number($('#cmProtein', body).value) || 0,
          carbs: Number($('#cmCarbs', body).value) || 0,
          fat: Number($('#cmFat', body).value) || 0,
        });
      });
    });
  }

  /* ================= WORKOUT TAB ================= */

  function renderWorkout() {
    const v = $('#view');
    if (!state.activeWorkout) {
      const templates = [...BUILTIN_TEMPLATES, ...state.templates];
      v.innerHTML = `
        <h2>Workouts</h2>
        <p class="subtitle">Track and improve</p>
        <button class="btn btn-primary" id="startEmpty">Start empty workout</button>
        <div class="section-title">Routines</div>
        <div class="tpl-list">
          ${templates.map((t) => `
            <div class="tpl-item" data-tpl="${esc(t.id)}" role="button" tabindex="0">
              <div>
                <div class="li-name">${esc(t.name)}</div>
                <div class="li-sub">${t.exercises.map((e) => exerciseById(e.exerciseId)?.name).filter(Boolean).slice(0, 3).join(' · ')}${t.exercises.length > 3 ? ' · …' : ''}</div>
              </div>
              ${t.builtin ? '' : `<button class="icon-btn" data-del-tpl="${esc(t.id)}" aria-label="Delete routine" style="width:36px;height:36px"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>`}
            </div>`).join('')}
        </div>`;
      $('#startEmpty').addEventListener('click', () => startWorkout());
      $$('.tpl-item', v).forEach((el) => {
        el.addEventListener('click', (e) => {
          const delBtn = e.target.closest('[data-del-tpl]');
          if (delBtn) {
            state.templates = state.templates.filter((t) => t.id !== delBtn.dataset.delTpl);
            save(); render();
            return;
          }
          startWorkout(el.dataset.tpl);
        });
      });
      return;
    }

    const w = state.activeWorkout;
    v.innerHTML = `
      <div class="wk-meta">
        <h2>${esc(w.name)}</h2>
        <span class="elapsed" id="wkElapsed">${fmtDuration(Date.now() - w.startedAt)}</span>
      </div>
      ${w.exercises.map((ex, exIdx) => renderExerciseBlock(ex, exIdx)).join('')}
      <button class="btn btn-ghost" id="addExercise" style="margin-bottom:12px">+ Add exercise</button>
      <div class="btn-row">
        <button class="btn btn-danger" id="cancelWorkout">Discard</button>
        <button class="btn btn-primary" id="finishWorkout">Finish</button>
      </div>`;

    ensureElapsedTimer();

    $('#addExercise').addEventListener('click', () => openExercisePicker((exId) => {
      w.exercises.push(newExerciseEntry(exId, 3));
      save(); render();
    }));
    $('#cancelWorkout').addEventListener('click', () => {
      if (confirm('Discard this workout? Logged sets will be lost.')) {
        state.activeWorkout = null;
        stopRest(); save(); render();
      }
    });
    $('#finishWorkout').addEventListener('click', finishWorkout);

    $$('.ex-block', v).forEach((block) => {
      const exIdx = Number(block.dataset.ex);
      const ex = w.exercises[exIdx];

      $('.ex-remove', block).addEventListener('click', () => {
        w.exercises.splice(exIdx, 1);
        save(); render();
      });
      $('.add-set', block).addEventListener('click', () => {
        const last = ex.sets[ex.sets.length - 1];
        ex.sets.push({ weight: last?.weight ?? null, reps: last?.reps ?? null, done: false });
        save(); render();
      });
      $$('.set-row', block).forEach((row) => {
        const setIdx = Number(row.dataset.set);
        const set = ex.sets[setIdx];
        $('.in-weight', row).addEventListener('input', (e) => {
          set.weight = e.target.value === '' ? null : Number(e.target.value);
          save();
        });
        $('.in-reps', row).addEventListener('input', (e) => {
          set.reps = e.target.value === '' ? null : Number(e.target.value);
          save();
        });
        $('.set-done', row).addEventListener('click', () => {
          if (!set.done) {
            if (set.weight == null) {
              const ph = Number($('.in-weight', row).placeholder);
              if (ph) set.weight = ph;
            }
            if (set.reps == null) {
              const ph = Number($('.in-reps', row).placeholder);
              if (ph) set.reps = ph;
            }
            if (set.reps == null) { toast('Enter reps first'); return; }
            set.done = true;
            save(); render();
            startRest();
          } else {
            set.done = false;
            save(); render();
          }
        });
      });
    });
  }

  function renderExerciseBlock(ex, exIdx) {
    const info = exerciseById(ex.exerciseId);
    const prev = previousSets(ex.exerciseId);
    const u = unit();
    return `
      <div class="card ex-block" data-ex="${exIdx}">
        <div class="ex-head">
          <h3>${esc(info?.name ?? 'Unknown exercise')}
            <span class="muscle">${esc(info?.muscle ?? '')}${info?.equipment ? ' · ' + esc(info.equipment) : ''}</span>
          </h3>
          <button class="ex-remove" aria-label="Remove exercise">
            <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
        <div class="set-grid">
          <span class="hdr">Set</span><span class="hdr">Prev</span><span class="hdr">${esc(u)}</span><span class="hdr">Reps</span><span class="hdr">✓</span>
          ${ex.sets.map((s, i) => {
            const p = prev[i];
            const prevTxt = p ? `${fmtNum(p.weight ?? 0)}×${p.reps}` : '—';
            return `
            <div class="set-row ${s.done ? 'logged' : ''}" data-set="${i}">
              <span class="set-num">${i + 1}</span>
              <span class="set-prev">${prevTxt}</span>
              <input class="set-input in-weight" type="number" inputmode="decimal" min="0" step="0.5"
                     value="${s.weight ?? ''}" placeholder="${p?.weight ?? ''}" aria-label="Weight, set ${i + 1}">
              <input class="set-input in-reps" type="number" inputmode="numeric" min="0" step="1"
                     value="${s.reps ?? ''}" placeholder="${p?.reps ?? ''}" aria-label="Reps, set ${i + 1}">
              <button class="set-done ${s.done ? 'logged' : ''}" aria-label="${s.done ? 'Undo set' : 'Log set'}" aria-pressed="${s.done}">
                <svg viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>
              </button>
            </div>`;
          }).join('')}
        </div>
        <button class="chip-btn add-set">+ Add set</button>
      </div>`;
  }

  function newExerciseEntry(exerciseId, setCount) {
    return {
      exerciseId,
      sets: Array.from({ length: setCount }, () => ({ weight: null, reps: null, done: false })),
    };
  }

  function startWorkout(templateId) {
    const tpl = templateId ? [...BUILTIN_TEMPLATES, ...state.templates].find((t) => t.id === templateId) : null;
    state.activeWorkout = {
      id: uid(),
      name: tpl ? tpl.name : 'Workout',
      startedAt: Date.now(),
      exercises: tpl ? tpl.exercises.map((e) => newExerciseEntry(e.exerciseId, e.sets)) : [],
    };
    save(); render();
    if (!tpl) {
      openExercisePicker((exId) => {
        state.activeWorkout.exercises.push(newExerciseEntry(exId, 3));
        save(); render();
      });
    }
  }

  function finishWorkout() {
    const w = state.activeWorkout;
    const done = loggedSets(w);
    if (!done.length) {
      toast('No sets logged yet');
      return;
    }
    openSheet('Finish workout', `
      <div class="field">
        <label for="wkName">Workout name</label>
        <input id="wkName" type="text" value="${esc(w.name)}">
      </div>
      <p class="muted" style="margin-bottom:14px">${done.length} sets · ${fmtNum(workoutVolume(w))} ${esc(unit())} total volume · ${fmtDuration(Date.now() - w.startedAt)}</p>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:0.9rem">
        <input type="checkbox" id="saveTpl" style="width:18px;height:18px"> Save as routine
      </label>
      <button class="btn btn-primary" id="confirmFinish">Save workout</button>
    `, (body) => {
      $('#confirmFinish', body).addEventListener('click', () => {
        w.name = $('#wkName', body).value.trim() || 'Workout';
        w.finishedAt = Date.now();
        w.exercises = w.exercises
          .map((ex) => ({ ...ex, sets: ex.sets.filter((s) => s.done) }))
          .filter((ex) => ex.sets.length);
        if ($('#saveTpl', body).checked) {
          state.templates.push({
            id: uid(),
            name: w.name,
            exercises: w.exercises.map((ex) => ({ exerciseId: ex.exerciseId, sets: ex.sets.length })),
          });
        }
        state.workouts.unshift(w);
        state.activeWorkout = null;
        stopRest();
        save(); closeSheet(); render();
        toast('Workout saved 💪');
      });
    });
  }

  /* -------- exercise picker sheet -------- */

  function openExercisePicker(onPick) {
    const listHtml = (q) => {
      const query = q.trim().toLowerCase();
      const items = allExercises().filter((e) => !query || e.name.toLowerCase().includes(query) || e.muscle.toLowerCase().includes(query));
      if (!items.length) return `<p class="empty-note">No matches. Add it as a custom exercise below.</p>`;
      return MUSCLE_GROUPS.map((g) => {
        const group = items.filter((e) => e.muscle === g);
        if (!group.length) return '';
        return `<div class="lib-group-title">${esc(g)}</div>` + group.map((e) => `
          <div class="lib-item" data-pick="${esc(e.id)}" role="button" tabindex="0">
            <div>
              <div class="li-name">${esc(e.name)}</div>
              <div class="li-sub">${esc(e.equipment)}</div>
            </div>
          </div>`).join('');
      }).join('');
    };

    openSheet('Add exercise', `
      <input class="search-field" id="pickSearch" type="search" placeholder="Search exercises…" autocomplete="off">
      <div id="pickList">${listHtml('')}</div>
      <button class="btn btn-quiet" id="newCustom" style="margin-top:8px">+ New custom exercise</button>
    `, (body) => {
      const search = $('#pickSearch', body);
      const list = $('#pickList', body);
      search.addEventListener('input', () => { list.innerHTML = listHtml(search.value); });
      body.addEventListener('click', (e) => {
        const item = e.target.closest('[data-pick]');
        if (item) { closeSheet(); onPick(item.dataset.pick); }
      });
      $('#newCustom', body).addEventListener('click', () => openCustomExerciseForm(onPick));
    });
  }

  function openCustomExerciseForm(onPick) {
    openSheet('New exercise', `
      <div class="field"><label for="ceName">Name</label><input id="ceName" type="text" placeholder="e.g. Landmine Press"></div>
      <div class="field"><label for="ceMuscle">Muscle group</label>
        <select id="ceMuscle">${MUSCLE_GROUPS.map((g) => `<option>${esc(g)}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="ceEquip">Equipment</label>
        <select id="ceEquip">${['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Other'].map((g) => `<option>${esc(g)}</option>`).join('')}</select>
      </div>
      <button class="btn btn-primary" id="ceSave">Add exercise</button>
    `, (body) => {
      $('#ceSave', body).addEventListener('click', () => {
        const name = $('#ceName', body).value.trim();
        if (!name) { toast('Give it a name'); return; }
        const ex = {
          id: 'custom-' + uid(),
          name,
          muscle: $('#ceMuscle', body).value,
          equipment: $('#ceEquip', body).value,
          custom: true,
        };
        state.customExercises.push(ex);
        save(); closeSheet();
        if (onPick) onPick(ex.id); else render();
        toast('Exercise added');
      });
    });
  }

  /* ================= PROGRESS TAB (trends / history / library) ================= */

  function renderProgress() {
    const v = $('#view');
    v.innerHTML = `
      <h2>Progress</h2>
      <p class="subtitle">Your training at a glance</p>
      <div class="seg" id="progSeg">
        <button data-seg="trends" class="${progressSeg === 'trends' ? 'on' : ''}">Trends</button>
        <button data-seg="history" class="${progressSeg === 'history' ? 'on' : ''}">History</button>
        <button data-seg="library" class="${progressSeg === 'library' ? 'on' : ''}">Exercises</button>
      </div>
      <div id="segBody"></div>`;

    $('#progSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-seg]');
      if (!b) return;
      progressSeg = b.dataset.seg;
      render();
    });

    const body = $('#segBody');
    if (progressSeg === 'trends') renderTrends(body);
    else if (progressSeg === 'history') renderHistory(body);
    else renderExerciseLibrary(body);
  }

  /* -------- trends (charts) -------- */

  function exercisesWithHistory() {
    const ids = new Set();
    for (const w of state.workouts) for (const ex of w.exercises) if (ex.sets.length) ids.add(ex.exerciseId);
    return [...ids].map(exerciseById).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  function strengthSeries(exerciseId) {
    const points = [];
    for (const w of [...state.workouts].sort((a, b) => a.startedAt - b.startedAt)) {
      const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (!ex) continue;
      let best = 0, bestSet = null;
      for (const s of ex.sets) {
        const val = est1RM(s.weight, s.reps);
        if (val > best) { best = val; bestSet = s; }
      }
      if (best > 0) points.push({ t: w.startedAt, v: Math.round(best * 10) / 10, set: bestSet });
    }
    return points;
  }

  function weeklyVolume() {
    const weeks = [];
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    for (let i = 7; i >= 0; i--) {
      const start = new Date(monday); start.setDate(start.getDate() - i * 7);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const vol = state.workouts
        .filter((w) => w.startedAt >= start.getTime() && w.startedAt < end.getTime())
        .reduce((s, w) => s + workoutVolume(w), 0);
      weeks.push({ label: fmtShortDate(start.getTime()), start: start.getTime(), v: Math.round(vol) });
    }
    return weeks;
  }

  function bodyweightSeries() {
    return [...state.nutrition.weights]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => ({ t: new Date(w.date + 'T12:00:00').getTime(), v: w.value }));
  }

  function renderTrends(v) {
    const options = exercisesWithHistory();
    const u = unit();
    if (!state.workouts.length && !state.nutrition.weights.length) {
      v.innerHTML = `<p class="empty-note">Finish a few workouts and log your bodyweight —<br>your trends will appear here.</p>`;
      return;
    }
    if (!progressExerciseId || !options.some((o) => o.id === progressExerciseId)) {
      progressExerciseId = options[0]?.id ?? null;
    }

    const series = progressExerciseId ? strengthSeries(progressExerciseId) : [];
    const best = progressExerciseId ? bestSetFor(progressExerciseId) : null;
    const totalWorkouts = state.workouts.length;
    const totalVolume = state.workouts.reduce((s, w) => s + workoutVolume(w), 0);
    const weeks = weeklyVolume();
    const thisWeek = state.workouts.filter((w) => w.startedAt >= weeks[weeks.length - 1].start).length;
    const bw = bodyweightSeries();

    v.innerHTML = `
      <div class="tile-row">
        <div class="tile"><span class="micro">Workouts</span><div class="t-value">${totalWorkouts}</div></div>
        <div class="tile"><span class="micro">Volume</span><div class="t-value">${totalVolume >= 10000 ? (totalVolume / 1000).toFixed(1) + 'k' : fmtNum(Math.round(totalVolume))}<span class="t-unit"> ${esc(u)}</span></div></div>
        <div class="tile"><span class="micro">This week</span><div class="t-value">${thisWeek}<span class="t-unit"> sessions</span></div></div>
      </div>

      ${options.length ? `
      <select class="select-field" id="progressExercise" aria-label="Choose exercise">
        ${options.map((o) => `<option value="${esc(o.id)}" ${o.id === progressExerciseId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>

      <div class="card chart-card">
        <h3>Estimated 1RM — ${esc(exerciseById(progressExerciseId)?.name ?? '')}</h3>
        <p class="muted">${best ? `Best set: ${fmtNum(best.weight)} ${esc(u)} × ${best.reps}` : 'Best set per session, Epley formula'}</p>
        <div class="chart-wrap" id="strengthChart">
          ${series.length >= 2 ? lineChartSVG(series, u, 'Estimated one rep max over time', 'var(--series-1)') : `<p class="empty-note">Log this exercise in at least two workouts to see a trend.</p>`}
        </div>
      </div>

      <div class="card chart-card">
        <h3>Weekly volume</h3>
        <p class="muted">Total ${esc(u)} lifted per week, last 8 weeks</p>
        <div class="chart-wrap" id="volumeChart">
          ${weeks.some((x) => x.v > 0) ? barChartSVG(weeks) : `<p class="empty-note">No volume in the last 8 weeks yet.</p>`}
        </div>
      </div>` : ''}

      <div class="card chart-card">
        <h3>Bodyweight</h3>
        <p class="muted">Logged from the Home screen</p>
        <div class="chart-wrap" id="bwChart">
          ${bw.length >= 2 ? lineChartSVG(bw, u, 'Bodyweight over time', 'var(--series-2)') : `<p class="empty-note">Log your bodyweight on at least two days to see a trend.</p>`}
        </div>
      </div>`;

    $('#progressExercise')?.addEventListener('change', (e) => {
      progressExerciseId = e.target.value;
      render();
    });

    attachLineHover($('#strengthChart'), series, u);
    attachBarHover($('#volumeChart'), weeks, u);
    attachLineHover($('#bwChart'), bw, u);
  }

  /* ---- charts: hand-built SVG, 2px line, hairline grid, hover tooltip ---- */

  const CH = { w: 360, h: 200, pad: { t: 16, r: 14, b: 28, l: 40 } };

  function niceTicks(max, min = 0) {
    const span = Math.max(0.001, max - min);
    const raw = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const lo = Math.floor(min / step) * step;
    const ticks = [];
    for (let t = lo; t <= max + step * 0.001; t += step) ticks.push(Math.round(t * 100) / 100);
    return ticks;
  }

  function lineChartSVG(series, u, ariaLabel, stroke) {
    const { w, h, pad } = CH;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const values = series.map((p) => p.v);
    const vMaxRaw = Math.max(...values), vMinRaw = Math.min(...values);
    // zoom the y-window for series that hover in a narrow band (e.g. bodyweight)
    const useMin = vMinRaw > 0 && (vMaxRaw - vMinRaw) < vMinRaw * 0.5;
    const ticks = useMin
      ? niceTicks(vMaxRaw + (vMaxRaw - vMinRaw || 1) * 0.15, Math.max(0, vMinRaw - (vMaxRaw - vMinRaw || 1) * 0.15))
      : niceTicks(vMaxRaw * 1.1);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const x = (i) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const y = (val) => pad.t + ih - ((val - yMin) / (yMax - yMin)) * ih;

    const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const lastIdx = series.length - 1;

    return `
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(ariaLabel)}">
      ${ticks.map((t) => `
        <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${pad.l - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="var(--ink-muted)" style="font-variant-numeric:tabular-nums">${fmtNum(t)}</text>`).join('')}
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="var(--baseline)" stroke-width="1"/>
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${series.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="4" fill="${stroke}" stroke="var(--surface-1)" stroke-width="2" data-i="${i}"/>`).join('')}
      <text x="${x(lastIdx) - 6}" y="${Math.max(pad.t + 10, y(series[lastIdx].v) - 9)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-1)">${fmtNum(series[lastIdx].v)} ${esc(u)}</text>
      <text x="${x(0)}" y="${h - 8}" text-anchor="start" font-size="10" fill="var(--ink-muted)">${fmtShortDate(series[0].t)}</text>
      <text x="${x(lastIdx)}" y="${h - 8}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${fmtShortDate(series[lastIdx].t)}</text>
      <line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--baseline)" stroke-width="1" opacity="0"/>
    </svg>`;
  }

  function attachLineHover(wrap, series, u) {
    const svg = wrap?.querySelector('svg');
    if (!svg || series.length < 2) return;
    const { w, pad } = CH;
    const iw = w - pad.l - pad.r;
    const cross = svg.querySelector('.crosshair');
    let tip = null;

    const showAt = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((clientX - rect.left) / rect.width) * w;
      const frac = Math.min(1, Math.max(0, (relX - pad.l) / iw));
      const i = Math.round(frac * (series.length - 1));
      const p = series[i];
      const px = pad.l + (i / (series.length - 1)) * iw;
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      cross.setAttribute('opacity', '1');
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        wrap.appendChild(tip);
      }
      tip.innerHTML = `<span class="tip-date">${fmtDate(p.t)}</span><b>${fmtNum(p.v)} ${esc(u)}</b>${p.set ? ` <span style="color:var(--ink-2)">(${fmtNum(p.set.weight)}×${p.set.reps})</span>` : ''}`;
      const wrapRect = wrap.getBoundingClientRect();
      const dot = svg.querySelector(`circle[data-i="${i}"]`)?.getBoundingClientRect();
      tip.style.left = `${(px / w) * wrapRect.width}px`;
      tip.style.top = `${dot ? Math.max(30, dot.top - wrapRect.top) : 30}px`;
    };
    const hide = () => { cross.setAttribute('opacity', '0'); tip?.remove(); tip = null; };

    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }

  function barChartSVG(weeks) {
    const { w, h, pad } = CH;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const vMax = Math.max(...weeks.map((x) => x.v), 1) * 1.1;
    const ticks = niceTicks(vMax);
    const yMax = ticks[ticks.length - 1];
    const n = weeks.length;
    const slot = iw / n;
    const barW = Math.max(6, slot - 2); // 2px surface gap between bars
    const y = (val) => pad.t + ih - (val / yMax) * ih;
    const fmtTick = (t) => (t >= 1000 ? `${t / 1000}k` : t);

    return `
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly training volume">
      ${ticks.map((t) => `
        <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${pad.l - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="var(--ink-muted)" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`).join('')}
      ${weeks.map((wk, i) => {
        const bx = pad.l + i * slot + (slot - barW) / 2;
        const by = y(wk.v);
        const bh = Math.max(0, pad.t + ih - by);
        if (!bh) return `<rect x="${bx}" y="${pad.t + ih - 1}" width="${barW}" height="1" fill="var(--grid)" data-i="${i}"/>`;
        const r = Math.min(4, barW / 2, bh);
        return `<path data-i="${i}" fill="var(--series-1)" d="M${bx},${pad.t + ih} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${pad.t + ih} Z"/>`;
      }).join('')}
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="var(--baseline)" stroke-width="1"/>
      <text x="${pad.l}" y="${h - 8}" text-anchor="start" font-size="10" fill="var(--ink-muted)">${esc(weeks[0].label)}</text>
      <text x="${w - pad.r}" y="${h - 8}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${esc(weeks[n - 1].label)}</text>
    </svg>`;
  }

  function attachBarHover(wrap, weeks, u) {
    const svg = wrap?.querySelector('svg');
    if (!svg) return;
    const { w, pad } = CH;
    const iw = w - pad.l - pad.r;
    const slot = iw / weeks.length;
    let tip = null;

    const showAt = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((clientX - rect.left) / rect.width) * w;
      const i = Math.min(weeks.length - 1, Math.max(0, Math.floor((relX - pad.l) / slot)));
      const wk = weeks[i];
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        wrap.appendChild(tip);
      }
      tip.innerHTML = `<span class="tip-date">Week of ${esc(wk.label)}</span><b>${wk.v.toLocaleString()} ${esc(u)}</b>`;
      const wrapRect = wrap.getBoundingClientRect();
      const cx = pad.l + i * slot + slot / 2;
      tip.style.left = `${(cx / w) * wrapRect.width}px`;
      tip.style.top = `28px`;
    };
    const hide = () => { tip?.remove(); tip = null; };
    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }

  /* -------- history segment -------- */

  function renderHistory(v) {
    if (!state.workouts.length) {
      v.innerHTML = `<p class="empty-note">No workouts yet.<br>Finish your first session and it will show up here.</p>`;
      return;
    }
    v.innerHTML = state.workouts.map((w) => {
      const sets = loggedSets(w);
      const open = expandedHistoryId === w.id;
      return `
      <div class="card hist-item" data-id="${esc(w.id)}">
        <div class="hist-top">
          <h3>${esc(w.name)}</h3>
          <span class="muted">${fmtDate(w.startedAt)}</span>
        </div>
        <div class="hist-stats">
          <span><b>${sets.length}</b> sets</span>
          <span><b>${fmtNum(workoutVolume(w))}</b> ${esc(unit())} volume</span>
          <span><b>${fmtDuration((w.finishedAt ?? w.startedAt) - w.startedAt)}</b></span>
        </div>
        ${open ? `
        <div class="hist-detail">
          <table>
            <thead><tr><th>Exercise</th><th>Sets</th><th>Best set</th></tr></thead>
            <tbody>
            ${w.exercises.map((ex) => {
              const info = exerciseById(ex.exerciseId);
              const best = ex.sets.reduce((b, s) => (!b || est1RM(s.weight, s.reps) > est1RM(b.weight, b.reps) ? s : b), null);
              return `<tr>
                <td>${esc(info?.name ?? '?')}</td>
                <td>${ex.sets.map((s) => `${fmtNum(s.weight ?? 0)}×${s.reps}`).join(', ')}</td>
                <td>${best ? `${fmtNum(best.weight ?? 0)} × ${best.reps}` : '—'}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn btn-quiet" data-repeat="${esc(w.id)}">Repeat</button>
            <button class="btn btn-danger" data-delete="${esc(w.id)}">Delete</button>
          </div>
        </div>` : ''}
      </div>`;
    }).join('');

    $$('.hist-item', v).forEach((card) => {
      card.addEventListener('click', (e) => {
        const del = e.target.closest('[data-delete]');
        if (del) {
          if (confirm('Delete this workout permanently?')) {
            state.workouts = state.workouts.filter((w) => w.id !== del.dataset.delete);
            save(); render();
          }
          return;
        }
        const rep = e.target.closest('[data-repeat]');
        if (rep) {
          const w = state.workouts.find((x) => x.id === rep.dataset.repeat);
          if (w) {
            if (state.activeWorkout && !confirm('A workout is in progress. Replace it?')) return;
            state.activeWorkout = {
              id: uid(), name: w.name, startedAt: Date.now(),
              exercises: w.exercises.map((ex) => newExerciseEntry(ex.exerciseId, ex.sets.length)),
            };
            currentTab = 'workout';
            save(); render();
          }
          return;
        }
        expandedHistoryId = expandedHistoryId === card.dataset.id ? null : card.dataset.id;
        render();
      });
    });
  }

  /* -------- exercise library segment -------- */

  function renderExerciseLibrary(v) {
    const query = librarySearch.trim().toLowerCase();
    const items = allExercises().filter((e) => !query || e.name.toLowerCase().includes(query) || e.muscle.toLowerCase().includes(query) || e.equipment.toLowerCase().includes(query));

    v.innerHTML = `
      <input class="search-field" id="libSearch" type="search" placeholder="Search by name, muscle, equipment…" value="${esc(librarySearch)}" autocomplete="off">
      <button class="btn btn-quiet" id="addCustomEx" style="margin-bottom:4px">+ New custom exercise</button>
      ${MUSCLE_GROUPS.map((g) => {
        const group = items.filter((e) => e.muscle === g);
        if (!group.length) return '';
        return `<div class="lib-group-title">${esc(g)}</div>` + group.map((e) => {
          const best = bestSetFor(e.id);
          return `
          <div class="lib-item" data-ex="${esc(e.id)}">
            <div>
              <div class="li-name">${esc(e.name)}${e.custom ? ' <span class="li-sub">(custom)</span>' : ''}</div>
              <div class="li-sub">${esc(e.equipment)}</div>
            </div>
            ${best ? `<span class="li-best">PR ${fmtNum(best.weight)}×${best.reps}</span>` : ''}
          </div>`;
        }).join('');
      }).join('') || '<p class="empty-note">No exercises match your search.</p>'}`;

    const search = $('#libSearch', v);
    search.addEventListener('input', () => {
      librarySearch = search.value;
      const pos = search.selectionStart;
      render();
      const s2 = $('#libSearch');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    });
    $('#addCustomEx', v).addEventListener('click', () => openCustomExerciseForm(null));
    $$('.lib-item', v).forEach((el) => {
      el.addEventListener('click', () => {
        progressExerciseId = el.dataset.ex;
        progressSeg = 'trends';
        render();
      });
    });
  }

  /* ================= SETTINGS ================= */

  function openSettings() {
    const s = state.settings;
    const t = state.nutrition.targets;
    openSheet('Settings', `
      <div class="field">
        <label>Appearance</label>
        <div class="seg" id="themeSeg" style="margin-bottom:0">
          <button data-t="system" class="${s.appearance === 'system' ? 'on' : ''}">Auto</button>
          <button data-t="light" class="${s.appearance === 'light' ? 'on' : ''}">Light</button>
          <button data-t="dark" class="${s.appearance === 'dark' ? 'on' : ''}">Dark</button>
        </div>
      </div>
      <div class="field">
        <label>Weight unit</label>
        <div class="seg" id="unitSeg" style="margin-bottom:0">
          <button data-u="kg" class="${s.unit === 'kg' ? 'on' : ''}">kg</button>
          <button data-u="lb" class="${s.unit === 'lb' ? 'on' : ''}">lb</button>
        </div>
      </div>
      <div class="field">
        <label for="restSecs">Default rest timer (seconds)</label>
        <input id="restSecs" type="number" inputmode="numeric" min="15" step="15" value="${s.restSeconds}">
      </div>
      <div class="section-title" style="margin-top:8px">Nutrition targets</div>
      <div class="field">
        <label for="tKcal">Calories (kcal / day)</label>
        <input id="tKcal" type="number" inputmode="numeric" min="0" value="${t.kcal}">
      </div>
      <div class="field-row-3">
        <div class="field"><label for="tProtein">Protein g</label><input id="tProtein" type="number" inputmode="numeric" min="0" value="${t.protein}"></div>
        <div class="field"><label for="tCarbs">Carbs g</label><input id="tCarbs" type="number" inputmode="numeric" min="0" value="${t.carbs}"></div>
        <div class="field"><label for="tFat">Fat g</label><input id="tFat" type="number" inputmode="numeric" min="0" value="${t.fat}"></div>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-quiet" id="exportBtn">Export data</button>
        <button class="btn btn-quiet" id="importBtn">Import data</button>
      </div>
      <input id="importFile" type="file" accept="application/json" hidden>
      <button class="btn btn-danger" id="wipeBtn" style="margin-top:12px">Erase all data</button>
      <p class="muted" style="margin-top:16px;text-align:center">B.E.L.A Gym v${APP_VERSION} · data stays on this device</p>
    `, (body) => {
      $('#themeSeg', body).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-t]');
        if (!b) return;
        state.settings.appearance = b.dataset.t;
        $$('#themeSeg button', body).forEach((x) => x.classList.toggle('on', x === b));
        save(); applyTheme(); render();
      });
      $('#unitSeg', body).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-u]');
        if (!b) return;
        state.settings.unit = b.dataset.u;
        $$('#unitSeg button', body).forEach((x) => x.classList.toggle('on', x === b));
        save(); render();
      });
      $('#restSecs', body).addEventListener('change', (e) => {
        state.settings.restSeconds = Math.max(15, Number(e.target.value) || 90);
        save();
      });
      const bindTarget = (id, keyName) => {
        $(id, body).addEventListener('change', (e) => {
          state.nutrition.targets[keyName] = Math.max(0, Number(e.target.value) || 0);
          save(); render();
        });
      };
      bindTarget('#tKcal', 'kcal');
      bindTarget('#tProtein', 'protein');
      bindTarget('#tCarbs', 'carbs');
      bindTarget('#tFat', 'fat');
      $('#exportBtn', body).addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bela-gym-backup-${dateKey()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
      $('#importBtn', body).addEventListener('click', () => $('#importFile', body).click());
      $('#importFile', body).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        file.text().then((text) => {
          try {
            const data = JSON.parse(text);
            if (!data || !Array.isArray(data.workouts)) throw new Error('bad file');
            const d = defaultState();
            state = {
              ...d, ...data,
              settings: { ...d.settings, ...(data.settings || {}) },
              nutrition: {
                ...d.nutrition, ...(data.nutrition || {}),
                targets: { ...d.nutrition.targets, ...(data.nutrition?.targets || {}) },
              },
            };
            save(); closeSheet(); render();
            toast('Data imported');
          } catch {
            toast('That file is not a valid backup');
          }
        });
      });
      $('#wipeBtn', body).addEventListener('click', () => {
        if (confirm('Erase ALL workouts, meals, routines and settings? This cannot be undone.')) {
          state = defaultState();
          save(); closeSheet(); render();
        }
      });
    });
  }

  /* ================= router ================= */

  function render() {
    ensureElapsedTimer();
    $('#view').classList.toggle('home-screen', currentTab === 'home');
    switch (currentTab) {
      case 'home': renderHome(); break;
      case 'workout': renderWorkout(); break;
      case 'meals': renderMeals(); break;
      case 'progress': renderProgress(); break;
    }
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    currentTab = t.dataset.tab;
    window.scrollTo(0, 0);
    render();
  }));

  render();
})();
