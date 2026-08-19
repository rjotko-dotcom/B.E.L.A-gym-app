/* ============================================================
   B.E.L.A Gym — app logic
   Workouts + nutrition. Data lives in localStorage ("bela-gym-v1").
   ============================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'bela-gym-v1';
  const APP_VERSION = '6.4';

  /* ---------------- state ---------------- */

  const defaultState = () => ({
    settings: { unit: 'kg', restSeconds: 90, appearance: 'system', waterTarget: 8, name: '' },
    nutrition: {
      targets: { kcal: 2800, protein: 180, carbs: 300, fat: 70 },
      meals: [],        // { id, date:'YYYY-MM-DD', time, name, kcal, protein, carbs, fat }
      weights: [],      // { date:'YYYY-MM-DD', value }
      water: [],        // { date:'YYYY-MM-DD', glasses }
      measurements: [], // { date:'YYYY-MM-DD', key, value }  key: waist|chest|arm|thigh|hips
    },
    customExercises: [],
    templates: [],
    workouts: [],          // finished workouts, newest first
    activeWorkout: null,
  });

  let state = load();
  let currentTab = 'home';
  let workoutOpen = !!state.activeWorkout;   // full-screen logger visible?

  /* ---------------- hardware back-button navigation ----------------
     We push one history entry per UI layer (tab, workout overlay, sheet)
     so the Android back button peels layers instead of exiting the app.
     skipPop swallows the popstate events our own history.back() calls fire. */
  let skipPop = 0;
  let tabHasEntry = false;
  let wkHasEntry = false;
  let sheetHasEntry = false;

  function goTab(tab) {
    currentTab = tab;
    if (tab === 'home') {
      if (tabHasEntry) { tabHasEntry = false; skipPop++; history.back(); }
    } else if (!tabHasEntry) {
      history.pushState({ t: 'tab' }, '');
      tabHasEntry = true;
    }
    render();
  }
  function openWkEntry() {
    if (!wkHasEntry) { history.pushState({ t: 'wk' }, ''); wkHasEntry = true; }
  }
  function closeWkEntry() {
    if (wkHasEntry) { wkHasEntry = false; skipPop++; history.back(); }
  }
  addEventListener('popstate', () => {
    if (skipPop > 0) { skipPop--; return; }
    if ($('#sheetRoot').children.length) { sheetHasEntry = false; closeSheetNow(); return; }
    if (workoutOpen) { wkHasEntry = false; workoutOpen = false; render(); return; }
    if (currentTab !== 'home') { tabHasEntry = false; currentTab = 'home'; render(); return; }
    // nothing left to close — the next back press exits normally
  });
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
      m.content = a === 'system' ? (mediaDark ? '#000000' : '#f7f7f6') : (a === 'dark' ? '#000000' : '#f7f7f6');
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
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function fmtNum(n) { return n % 1 === 0 ? String(n) : n.toFixed(1); }

  // Epley estimated 1RM; for reps === 1 it's just the weight.
  function est1RM(weight, reps) {
    if (!weight || !reps) return 0;
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }

  function isCardio(exerciseId) {
    return exerciseById(exerciseId)?.muscle === 'Cardio';
  }
  // set.type: 'N' normal (default), 'W' warm-up, 'D' drop set, 'F' failure
  function isWorkingSet(s) {
    return s.done && (s.type || 'N') !== 'W';
  }
  function loggedSets(workout) {
    return workout.exercises.flatMap((ex) => ex.sets.filter((s) => s.done));
  }
  function workoutVolume(workout) {
    return workout.exercises.reduce((sum, ex) => {
      if (isCardio(ex.exerciseId)) return sum;
      return sum + ex.sets.filter(isWorkingSet).reduce((t, s) => t + (s.weight || 0) * (s.reps || 0), 0);
    }, 0);
  }
  function workoutPRs(workout) {
    return workout.exercises.flatMap((ex) =>
      ex.sets.filter((s) => s.done && s.pr).map((s) => ({ exerciseId: ex.exerciseId, weight: s.weight, reps: s.reps }))
    );
  }
  function bestSetFor(exerciseId) {
    if (isCardio(exerciseId)) return null;
    let best = null;
    for (const w of state.workouts) {
      for (const ex of w.exercises) {
        if (ex.exerciseId !== exerciseId) continue;
        for (const s of ex.sets) {
          if (!isWorkingSet(s) || !s.weight) continue;
          if (!best || est1RM(s.weight, s.reps) > est1RM(best.weight, best.reps)) best = s;
        }
      }
    }
    return best;
  }
  // weekly streak: consecutive weeks (counting back from this or last week) with >= 1 workout
  function streakWeeks() {
    const weekKey = (t) => {
      const d = new Date(t);
      const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      return dateKey(m);
    };
    const weeks = new Set(state.workouts.map((w) => weekKey(w.startedAt)));
    let streak = 0;
    const cur = new Date();
    cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
    if (!weeks.has(dateKey(cur))) cur.setDate(cur.getDate() - 7); // current week may still be in progress
    while (weeks.has(dateKey(cur))) {
      streak += 1;
      cur.setDate(cur.getDate() - 7);
    }
    return streak;
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

  const MEASURE_LABELS = { waist: 'Waist', chest: 'Chest', arm: 'Arm', thigh: 'Thigh', hips: 'Hips' };

  function waterFor(key) {
    return state.nutrition.water.find((x) => x.date === key)?.glasses ?? 0;
  }
  function setWater(key, glasses) {
    state.nutrition.water = state.nutrition.water.filter((x) => x.date !== key);
    if (glasses > 0) state.nutrition.water.push({ date: key, glasses });
  }
  // working sets per muscle group over the last 7 days
  function muscleSets7d() {
    const cutoff = Date.now() - 7 * 86400000;
    const counts = {};
    for (const w of state.workouts) {
      if (w.startedAt < cutoff) continue;
      for (const ex of w.exercises) {
        const info = exerciseById(ex.exerciseId);
        if (!info || info.muscle === 'Cardio') continue;
        counts[info.muscle] = (counts[info.muscle] || 0) + ex.sets.filter(isWorkingSet).length;
      }
    }
    return counts;
  }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      o.start(); o.stop(ctx.currentTime + 0.4);
    } catch { /* audio unavailable without user gesture — vibration still fires */ }
  }

  /* ---- bodyweight stats & weekly chart ---- */
  function weightStats() {
    const ws = [...state.nutrition.weights].sort((a, b) => a.date.localeCompare(b.date));
    if (!ws.length) return null;
    const latest = ws[ws.length - 1];
    const since = (days) => {
      const d = new Date(); d.setDate(d.getDate() - days);
      return dateKey(d);
    };
    const last7 = ws.filter((w) => w.date >= since(6));
    const avg7 = last7.length ? last7.reduce((t, w) => t + w.value, 0) / last7.length : null;
    const range = (days) => {
      const rows = ws.filter((w) => w.date >= since(days));
      return rows.length >= 2 ? latest.value - rows[0].value : null;
    };
    return { latest, avg7, week: range(6), month: range(29) };
  }

  // 7-day line chart for the bodyweight card
  function weightWeekChart(week, u) {
    const pts = week.map((x, i) => (x.entry ? { i, v: x.entry.value } : null)).filter(Boolean);
    if (pts.length < 2) {
      return '<p class="bw-chart-empty">Log two or more days to see your trend.</p>';
    }
    const W = 300, H = 150, padL = 38, padR = 8, padT = 14, padB = 30;
    const vals = pts.map((p) => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(0.8, hi - lo);
    lo = lo - span * 0.25; hi = hi + span * 0.25;
    const x = (i) => padL + (i / 6) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const ticks = [hi, (hi + lo) / 2, lo];
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts[pts.length - 1].i).toFixed(1)},${(H - padB).toFixed(1)} L${x(pts[0].i).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    const last = pts[pts.length - 1];
    return `
      <svg class="bw-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bodyweight this week">
        <defs><linearGradient id="bwFill" x1="0" y1="0" x2="0" y2="1">
          <stop class="bwf-a" offset="0%"/><stop class="bwf-b" offset="100%"/>
        </linearGradient></defs>
        ${ticks.map((t) => `
          <line class="bw-grid" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke-dasharray="3 4"/>
          <text class="bw-ytick" x="${padL - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t.toFixed(1)}</text>`).join('')}
        <path d="${area}" fill="url(#bwFill)"/>
        <path d="${line}" class="bw-line" fill="none"/>
        ${pts.slice(0, -1).map((p) => `<circle class="bw-pt" cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"/>`).join('')}
        <circle class="bw-pt-last-halo" cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="7"/>
        <circle class="bw-pt-last" cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="4"/>
        ${week.map((d, i) => `<text class="bw-xtick" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d.letter}</text>`).join('')}
      </svg>`;
  }

  // Profile picture: stored as a small square JPEG data URI in settings.avatar
  function avatarHTML(cls) {
    const name = (state.settings.name || '').trim();
    const initial = (name.charAt(0) || 'B').toUpperCase();
    return state.settings.avatar
      ? `<span class="${cls} has-photo"><img src="${esc(state.settings.avatar)}" alt="Profile picture"></span>`
      : `<span class="${cls}">${esc(initial)}</span>`;
  }
  function readAvatarFile(file, done) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 240;                       // square, plenty for a 46px circle
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        done(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => done(null);
      img.src = reader.result;
    };
    reader.onerror = () => done(null);
    reader.readAsDataURL(file);
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
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
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
    if (!sheetHasEntry) { history.pushState({ t: 'sheet' }, ''); sheetHasEntry = true; }
    if (onMount) onMount(body);
  }
  function closeSheetNow() { $('#sheetRoot').innerHTML = ''; }
  function closeSheet() {
    closeSheetNow();
    if (sheetHasEntry) { sheetHasEntry = false; skipPop++; history.back(); }
  }

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
        beep();
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
    if (!state.activeWorkout) return;
    const txt = fmtElapsed(Date.now() - state.activeWorkout.startedAt);
    const el = $('#wkDur');
    if (el) el.textContent = txt;
    const mini = $('#miniDur');
    if (mini) mini.textContent = txt;
  }
  function ensureElapsedTimer() {
    const want = !!state.activeWorkout;
    if (want && !elapsedTimer) elapsedTimer = setInterval(tickElapsed, 1000);
    if (!want && elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
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

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const strip = dayNames.map((L, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      const key = dateKey(d);
      const isToday = key === todayKey;
      const past = key < todayKey;
      const logged = workoutDays.has(key) || mealDays.has(key);
      return `
        <div class="wd ${isToday ? 'is-today' : past ? 'is-past' : ''}">
          <span class="wd-letter">${L}</span>
          <span class="wd-num">${d.getDate()}<span class="wd-inner ${logged ? 'on' : ''}"></span></span>
          <span class="wd-mark ${logged ? 'on' : ''}"></span>
        </div>`;
    }).join('');

    // bodyweight mini bars for this week
    const weekWeights = letters.map((_, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      return { key: dateKey(d), letter: letters[i], entry: weightOn(dateKey(d)) };
    });
    const lw = latestWeight();
    const active = state.activeWorkout;

    const hour = today.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const weekCount = state.workouts.filter((x) => {
      const d = new Date(x.startedAt);
      return d >= monday;
    }).length;
    const streak = streakWeeks();
    const subParts = [
      today.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      `${weekCount} workout${weekCount === 1 ? '' : 's'} this week`,
    ];
    if (streak >= 2) subParts.push(`${streak}-week streak 🔥`);

    const macros = [
      ['Protein', totals.protein, targets.protein, '<path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 6 2h4a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h1a3 3 0 0 0 2.235-1"/>'],
      ['Carbs', totals.carbs, targets.carbs, '<path d="M4 10.75h16a8 8 0 0 1-16 0Z"/><path d="M9.6 7.6c0-.9.8-1.4.8-2.4M14.2 7.6c0-.9.8-1.4.8-2.4"/>'],
      ['Fat', totals.fat, targets.fat, '<path d="M12 4.4c3.2 3.9 5 6.5 5 8.85a5 5 0 0 1-10 0c0-2.35 1.8-4.95 5-8.85Z"/>'],
    ];
    const stats = weightStats();
    const goal = state.settings.goalWeight;
    const initial = ((state.settings.name || '').trim().charAt(0) || 'B').toUpperCase();
    const kcalPct = Math.round(frac * 100);
    const RING = 2 * Math.PI * 22;
    const ringOffset = RING * (1 - Math.min(1, frac));

    v.innerHTML = `
      <svg class="home-wave" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop class="wave-a" offset="0%"/><stop class="wave-b" offset="100%"/>
        </linearGradient></defs>
        <path d="M0,0 H400 V74 C336,84 306,104 252,104 C192,104 150,72 92,79 C52,84 24,95 0,103 Z" fill="url(#waveGrad)"/>
      </svg>

      <div class="home-head">
        <div class="hh-text">
          <span class="hh-greet">${greeting},</span>
          <h2 class="hh-name">${esc(state.settings.name || 'Athlete')}<span class="hh-dot">.</span></h2>
          <p class="hh-sub">${subParts.join(' • ')}</p>
        </div>
        <button class="hh-avatar" id="homeAvatar" aria-label="Open profile">${avatarHTML('hh-initial')}</button>
      </div>

      <div class="week-strip">${strip}</div>

      <div class="card bw-card">
        <div class="bw-main">
          <div class="bw-left">
            <span class="micro">Bodyweight</span>
            <div class="bw-value">${lw ? fmtNum(lw.value) : '—'}<span class="t-unit">${esc(unit())}</span></div>
            <div class="bw-delta">${
              stats && stats.week != null
                ? `<span class="bw-arrow">${stats.week > 0 ? '↑' : stats.week < 0 ? '↓' : '→'}</span> <b>${Math.abs(stats.week).toFixed(1)} ${esc(unit())}</b> this week`
                : 'Tap to log today'
            }</div>
            <button class="bw-goal" id="bwGoal">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>
              ${goal ? `Goal ${fmtNum(goal)} ${esc(unit())}` : 'Set a goal'}
            </button>
            <button class="bw-log" id="bwCard">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>
              Log weight
            </button>
          </div>
          <div class="bw-right">
            <div class="bw-chart">${weightWeekChart(weekWeights, unit())}</div>
          </div>
        </div>
      </div>

      <div class="card kcal-line">
        <div class="kl-head">
          <span class="micro">Calories</span>
          <span class="kl-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c.7 3.1 3.4 4.4 3.4 7.4 0 1-.4 2-1.2 2.8.5-1.7-.6-3.1-1.7-3.9.2 2.3-1.4 3.5-2.3 4.8-1.7 2.2.2 5.5 3.4 5.5 3.1 0 5.4-2.4 5.4-5.4 0-4.9-4.3-7.9-7-11.2Z"/></svg></span>
        </div>
        <div class="kl-row">
          <div class="kl-ring">
            <svg viewBox="0 0 52 52" aria-hidden="true">
              <circle cx="26" cy="26" r="22" fill="none" stroke="var(--surface-2)" stroke-width="4"/>
              <circle cx="26" cy="26" r="22" fill="none" stroke="${over ? 'var(--critical)' : 'var(--ink-1)'}" stroke-width="4" stroke-linecap="round"
                stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}" transform="rotate(-90 26 26)"/>
            </svg>
            <span class="kl-pct">${kcalPct}%</span>
          </div>
          <div class="kl-right">
            <div class="macro-track kl-track"><div class="macro-fill ${over ? 'over' : ''}" style="width:${Math.min(100, frac * 100)}%"></div></div>
            <div class="kl-total"><b class="${over ? 'over' : ''}">${Math.round(totals.kcal)}</b> / ${targets.kcal.toLocaleString()} <span>kcal</span></div>
            <div class="kl-left">${over ? `${Math.round(totals.kcal - targets.kcal)} kcal over` : `${Math.round(targets.kcal - totals.kcal)} kcal left`}</div>
          </div>
        </div>
      </div>

      <div class="macro-cards">
        ${macros.map(([label, val, target, icon]) => {
          const pct = target ? Math.min(100, (val / target) * 100) : 0;
          const isOver = target && val > target;
          return `
          <div class="mc-card ${isOver ? 'over' : ''}">
            <div class="mc-top"><span class="mc-name">${label}</span><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></div>
            <div class="mc-val">${Math.round(val)}g</div>
            <div class="mc-target">/ ${target}g</div>
            <div class="mc-bar"><div class="mc-fill ${isOver ? 'over' : ''}" style="width:${pct}%"></div></div>
          </div>`;
        }).join('')}
      </div>

      <div class="home-grid2">
        <div class="card shortcut-card sc-workout">
          <h3>Workouts</h3>
          <p>${active ? 'Session in progress' : 'Track and improve'}</p>
          <div class="shortcut-foot">
            <button class="btn btn-white" id="homeStart">${active ? 'Resume' : 'Start'}</button>
            <span class="sc-badge sc-square"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5v9M3.5 9.5v5M17.5 7.5v9M20.5 9.5v5M6.5 12h11"/></svg></span>
          </div>
        </div>
        <div class="card shortcut-card sc-meals">
          <h3>Meals</h3>
          <p>Log and track nutrition</p>
          <div class="shortcut-foot">
            <button class="btn btn-white" id="homeLog">Log</button>
            <span class="sc-badge sc-square"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.75h16a8 8 0 0 1-16 0Z"/><path d="M9.6 7.6c0-.9.8-1.4.8-2.4M14.2 7.6c0-.9.8-1.4.8-2.4"/></svg></span>
          </div>
        </div>
      </div>`;

    $('#homeAvatar').addEventListener('click', () => goTab('profile'));
    $('#bwGoal').addEventListener('click', (e) => { e.stopPropagation(); openWeightSheet(); });
    $('#bwCard').addEventListener('click', openWeightSheet);
    $('#homeStart').addEventListener('click', () => {
      if (state.activeWorkout) { workoutOpen = true; openWkEntry(); }
      goTab('workout');
    });
    $('#homeLog').addEventListener('click', () => { mealDayOffset = 0; openMealSheet(); });
  }

  function openWeightSheet() {
    const todayKey = dateKey();
    const existing = weightOn(todayKey);
    openSheet('Log bodyweight', `
      ${(() => {
        const st = weightStats();
        if (!st) return '';
        const cell = (label, val, suffix) => `<div><span class="micro">${label}</span><b>${val}<i>${suffix}</i></b></div>`;
        return `<div class="bw-stats sheet-stats">
          ${cell('7d avg', st.avg7 != null ? fmtNum(Math.round(st.avg7 * 10) / 10) : '—', esc(unit()))}
          ${cell('Week', st.week != null ? (st.week > 0 ? '+' : '') + st.week.toFixed(1) : '—', esc(unit()))}
          ${cell('30d', st.month != null ? (st.month > 0 ? '+' : '') + st.month.toFixed(1) : '—', esc(unit()))}
        </div>`;
      })()}
      <div class="field">
        <label for="bwInput">Today's weight (${esc(unit())})</label>
        <input id="bwInput" type="number" inputmode="decimal" step="0.1" min="0"
               value="${existing ? existing.value : latestWeight()?.value ?? ''}" placeholder="e.g. 77.9">
      </div>
      <div class="field">
        <label for="bwGoalInput">Goal weight (optional)</label>
        <input id="bwGoalInput" type="number" inputmode="decimal" step="0.1" min="0"
               value="${state.settings.goalWeight ?? ''}" placeholder="e.g. 75">
      </div>
      <button class="btn btn-primary" id="bwSave">Save</button>
      ${existing ? '<button class="btn btn-danger" id="bwDelete" style="margin-top:10px">Remove today’s entry</button>' : ''}
    `, (body) => {
      const input = $('#bwInput', body);
      input.focus();
      $('#bwSave', body).addEventListener('click', () => {
        const goalVal = Number($('#bwGoalInput', body).value);
        if (goalVal > 0) state.settings.goalWeight = Math.round(goalVal * 10) / 10;
        else delete state.settings.goalWeight;
        const val = Number(input.value);
        if (!val || val <= 0) {
          // saving just a goal is fine
          if (goalVal > 0) { save(); closeSheet(); render(); toast('Goal saved'); return; }
          toast('Enter a weight'); return;
        }
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
      <h2>Nutrition</h2>
      <p class="subtitle">Log meals, macros and water</p>

      <div class="day-nav">
        <button id="dayPrev" aria-label="Previous day">‹</button>
        <span class="dn-label">${esc(label)}</span>
        <button id="dayNext" aria-label="Next day" ${mealDayOffset >= 0 ? 'disabled style="opacity:0.35"' : ''}>›</button>
      </div>

      <div class="card meal-summary">
        <div class="ms-left">
          <div class="gauge-wrap">
            ${gaugeSVG(frac, over)}
            <div class="gauge-center">${Math.round(frac * 100)}%</div>
          </div>
          <div class="kcal-total"><b class="${over ? 'over' : ''}">${Math.round(totals.kcal)}</b> / ${targets.kcal.toLocaleString()}</div>
          <div class="kcal-unit">kcal</div>
        </div>
        <div class="ms-right">${macroRowsHTML(totals, targets)}</div>
      </div>

      <div class="card water-card">
        <div>
          <span class="micro">Water</span>
          <div class="water-count">💧 ${waterFor(key)} / ${state.settings.waterTarget} glasses</div>
        </div>
        <div class="water-btns">
          <button class="chip-btn" id="waterMinus" aria-label="Remove a glass">−</button>
          <button class="chip-btn chip-strong" id="waterPlus" aria-label="Add a glass">+</button>
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
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13M10 11v6M14 11v6"/></svg>
          </button>
        </div>`).join('')
      : `<p class="empty-note">Nothing logged ${mealDayOffset === 0 ? 'today' : 'this day'} yet.</p>`}`;

    $('#dayPrev').addEventListener('click', () => { mealDayOffset -= 1; render(); });
    $('#dayNext').addEventListener('click', () => { if (mealDayOffset < 0) { mealDayOffset += 1; render(); } });
    $('#waterPlus').addEventListener('click', () => { setWater(key, waterFor(key) + 1); save(); render(); });
    $('#waterMinus').addEventListener('click', () => { setWater(key, Math.max(0, waterFor(key) - 1)); save(); render(); });
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
        goTab('meals');
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
        <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">Routines
          <button class="chip-btn" id="newRoutine">+ New routine</button>
        </div>
        <div class="tpl-list">
          ${templates.map((t) => `
            <div class="tpl-item" data-tpl="${esc(t.id)}" role="button" tabindex="0">
              <div>
                <div class="li-name">${esc(t.name)}</div>
                <div class="li-sub">${t.exercises.length} exercises · ${t.exercises.map((e) => exerciseById(e.exerciseId)?.name).filter(Boolean).slice(0, 3).join(' · ')}${t.exercises.length > 3 ? ' · …' : ''}</div>
              </div>
              ${t.builtin ? '' : `
              <button class="icon-btn" data-edit-tpl="${esc(t.id)}" aria-label="Edit routine" style="width:36px;height:36px"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/></svg></button>
              <button class="icon-btn" data-del-tpl="${esc(t.id)}" aria-label="Delete routine" style="width:36px;height:36px"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13M10 11v6M14 11v6"/></svg></button>`}
            </div>`).join('')}
        </div>`;
      $('#startEmpty').addEventListener('click', () => startWorkout());
      $('#newRoutine').addEventListener('click', () => openRoutineBuilder());
      $$('.tpl-item', v).forEach((el) => {
        el.addEventListener('click', (e) => {
          const delBtn = e.target.closest('[data-del-tpl]');
          if (delBtn) {
            if (confirm('Delete this routine?')) {
              state.templates = state.templates.filter((t) => t.id !== delBtn.dataset.delTpl);
              save(); render();
            }
            return;
          }
          const editBtn = e.target.closest('[data-edit-tpl]');
          if (editBtn) {
            openRoutineBuilder(editBtn.dataset.editTpl);
            return;
          }
          startWorkout(el.dataset.tpl);
        });
      });
      return;
    }

    // a workout is running but the logger is minimized — offer to resume
    const w = state.activeWorkout;
    v.innerHTML = `
      <h2>Workouts</h2>
      <p class="subtitle">Session in progress</p>
      <div class="card">
        <h3>${esc(w.name)}</h3>
        <p class="muted" style="margin-bottom:12px">${loggedSets(w).length} sets logged · started ${fmtDuration(Date.now() - w.startedAt)} ago</p>
        <button class="btn btn-primary" id="resumeWorkout">Resume workout</button>
      </div>`;
    $('#resumeWorkout').addEventListener('click', () => { workoutOpen = true; openWkEntry(); render(); });
  }

  /* -------- full-screen workout logger (Hevy-style) -------- */

  function renderWorkoutOverlay() {
    const root = $('#workoutRoot');
    const w = state.activeWorkout;
    document.body.classList.toggle('has-mini', !!w && !workoutOpen);
    if (!w) { root.innerHTML = ''; return; }
    if (!workoutOpen) {
      // Hevy-style persistent mini bar while the logger is minimized
      const current = w.exercises.find((ex) => ex.sets.some((s) => !s.done));
      const currentName = current ? (exerciseById(current.exerciseId)?.name ?? '') : 'All sets done 💪';
      root.innerHTML = `
        <div class="mini-bar" role="button" tabindex="0" aria-label="Resume workout">
          <button class="mini-btn" id="miniExpand" aria-label="Expand workout">
            <svg viewBox="0 0 24 24"><path d="m5 15 7-7 7 7"/></svg>
          </button>
          <div class="mini-info">
            <div class="mini-title"><span class="mini-dot"></span><b>Workout</b> <span id="miniDur">${fmtElapsed(Date.now() - w.startedAt)}</span></div>
            <div class="mini-sub">${esc(currentName)}</div>
          </div>
          <button class="mini-btn mini-danger" id="miniDiscard" aria-label="Discard workout">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13M10 11v6M14 11v6"/></svg>
          </button>
        </div>`;
      const expand = () => { workoutOpen = true; openWkEntry(); render(); };
      $('.mini-bar', root).addEventListener('click', (e) => {
        if (e.target.closest('#miniDiscard')) {
          if (confirm('Discard this workout? Logged sets will be lost.')) {
            state.activeWorkout = null;
            workoutOpen = false;
            stopRest(); save(); render();
          }
          return;
        }
        expand();
      });
      ensureElapsedTimer();
      return;
    }
    const done = loggedSets(w);
    const vol = workoutVolume(w);
    root.innerHTML = `
      <div class="wk-overlay">
        <div class="wk-bar">
          <button class="icon-btn" id="wkMin" aria-label="Minimize workout">
            <svg viewBox="0 0 24 24"><path d="m5 9 7 7 7-7"/></svg>
          </button>
          <b class="wk-title">${esc(w.name)}</b>
          <button class="chip-btn chip-strong" id="wkFinishTop">Finish</button>
        </div>
        <div class="wk-stats">
          <div><span class="micro">Duration</span><b id="wkDur">${fmtElapsed(Date.now() - w.startedAt)}</b></div>
          <div><span class="micro">Volume</span><b>${fmtNum(Math.round(vol))} ${esc(unit())}</b></div>
          <div><span class="micro">Sets</span><b>${done.length}</b></div>
        </div>
        <div class="wk-body">
          ${w.exercises.map((ex, exIdx) => renderExerciseBlock(ex, exIdx)).join('')}
          <button class="btn btn-ghost" id="addExercise" style="margin-bottom:12px">+ Add exercise</button>
          <button class="btn btn-danger" id="cancelWorkout" style="margin-bottom:8px">Discard workout</button>
        </div>
      </div>`;

    ensureElapsedTimer();

    $('#wkMin', root).addEventListener('click', () => { workoutOpen = false; closeWkEntry(); render(); });
    $('#wkFinishTop', root).addEventListener('click', finishWorkout);
    $('#addExercise', root).addEventListener('click', () => openExercisePicker((exId) => {
      w.exercises.push(newExerciseEntry(exId, 3));
      save(); render();
    }));
    $('#cancelWorkout', root).addEventListener('click', () => {
      if (confirm('Discard this workout? Logged sets will be lost.')) {
        state.activeWorkout = null;
        workoutOpen = false;
        closeWkEntry();
        stopRest(); save(); render();
      }
    });

    $$('.ex-block', root).forEach((block) => {
      const exIdx = Number(block.dataset.ex);
      const ex = w.exercises[exIdx];
      const cardio = isCardio(ex.exerciseId);

      $('.ex-name', block).addEventListener('click', () => openExerciseDetail(ex.exerciseId));
      $('.ex-menu', block).addEventListener('click', () => openExerciseMenu(exIdx));
      $('.ex-note-line', block).addEventListener('click', () => openNoteSheet(ex));
      $('.ex-rest', block).addEventListener('click', () => openRestSheet(ex));
      $('.add-set', block).addEventListener('click', () => {
        const last = ex.sets[ex.sets.length - 1];
        ex.sets.push({ weight: last?.weight ?? null, reps: last?.reps ?? null, done: false });
        save(); render();
      });
      $$('.set-row', block).forEach((row) => {
        const setIdx = Number(row.dataset.set);
        const set = ex.sets[setIdx];
        $('.set-num', row).addEventListener('click', () => {
          const order = ['N', 'W', 'D', 'F'];
          set.type = order[(order.indexOf(set.type || 'N') + 1) % order.length];
          save(); render();
        });
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
            if (set.reps == null) { toast(cardio ? 'Enter minutes first' : 'Enter reps first'); return; }
            set.done = true;
            // PR check against history (warm-ups and cardio excluded)
            if (!cardio && (set.type || 'N') !== 'W' && set.weight) {
              const prevBest = bestSetFor(ex.exerciseId);
              if (!prevBest || est1RM(set.weight, set.reps) > est1RM(prevBest.weight, prevBest.reps)) {
                set.pr = true;
                toast(`🏆 New PR — ${fmtNum(set.weight)} ${unit()} × ${set.reps}`);
              }
            }
            save(); render();
            const restSecs = ex.rest === 0 ? 0 : (ex.rest ?? state.settings.restSeconds);
            if (restSecs) startRest(restSecs);
          } else {
            set.done = false;
            delete set.pr;
            save(); render();
          }
        });
      });
    });
  }

  /* -------- exercise options menu (Hevy-style) -------- */

  function openExerciseMenu(exIdx) {
    const w = state.activeWorkout;
    const ex = w.exercises[exIdx];
    const info = exerciseById(ex.exerciseId);
    openSheet(info?.name ?? 'Exercise', `
      <div class="menu-list">
        <button class="menu-item" data-act="up" ${exIdx === 0 ? 'disabled' : ''}>↑ &nbsp;Move up</button>
        <button class="menu-item" data-act="down" ${exIdx === w.exercises.length - 1 ? 'disabled' : ''}>↓ &nbsp;Move down</button>
        <button class="menu-item" data-act="note">📝 &nbsp;${ex.note ? 'Edit note' : 'Add note'}</button>
        ${ex.ss ? `<button class="menu-item" data-act="ssbreak">⛓ &nbsp;Remove from superset</button>`
          : exIdx < w.exercises.length - 1 ? `<button class="menu-item" data-act="ss">⛓ &nbsp;Superset with next exercise</button>` : ''}
        <button class="menu-item" data-act="replace">⇄ &nbsp;Replace exercise</button>
        <button class="menu-item" data-act="plates">🏋️ &nbsp;Plate calculator</button>
        <button class="menu-item" data-act="detail">📈 &nbsp;Records &amp; history</button>
        <button class="menu-item danger" data-act="remove">🗑 &nbsp;Remove from workout</button>
      </div>
    `, (body) => {
      body.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b || b.disabled) return;
        const act = b.dataset.act;
        if (act === 'up' || act === 'down') {
          const j = act === 'up' ? exIdx - 1 : exIdx + 1;
          [w.exercises[exIdx], w.exercises[j]] = [w.exercises[j], w.exercises[exIdx]];
          save(); closeSheet(); render();
        } else if (act === 'remove') {
          w.exercises.splice(exIdx, 1);
          save(); closeSheet(); render();
        } else if (act === 'ss') {
          const next = w.exercises[exIdx + 1];
          const group = next.ss ?? (Math.max(0, ...w.exercises.map((x) => x.ss || 0)) + 1);
          ex.ss = group; next.ss = group;
          save(); closeSheet(); render();
        } else if (act === 'ssbreak') {
          delete ex.ss;
          save(); closeSheet(); render();
        } else if (act === 'replace') {
          closeSheetNow();
          openExercisePicker((newId) => {
            ex.exerciseId = newId;
            save(); render();
          });
        } else if (act === 'note') {
          closeSheetNow();
          openNoteSheet(ex);
        } else if (act === 'plates') {
          closeSheetNow();
          const lastWeight = [...ex.sets].reverse().find((s) => s.weight)?.weight;
          openPlateCalc(lastWeight);
        } else if (act === 'detail') {
          closeSheetNow();
          openExerciseDetail(ex.exerciseId);
        }
      });
    });
  }

  function openRestSheet(ex) {
    const current = ex.rest === 0 ? 0 : (ex.rest ?? null);
    const options = [
      [null, `Default (${state.settings.restSeconds}s)`],
      [0, 'Off'], [30, '30s'], [60, '60s'], [90, '90s'], [120, '2 min'], [180, '3 min'],
    ];
    openSheet('Rest timer for this exercise', `
      <div class="menu-list">
        ${options.map(([val, label]) => `
          <button class="menu-item ${val === current ? 'on' : ''}" data-rest="${val === null ? 'default' : val}">${esc(label)}${val === current ? ' ✓' : ''}</button>`).join('')}
      </div>
    `, (body) => {
      body.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-rest]');
        if (!b) return;
        if (b.dataset.rest === 'default') delete ex.rest;
        else ex.rest = Number(b.dataset.rest);
        save(); closeSheet(); render();
      });
    });
  }

  function openNoteSheet(ex) {
    openSheet('Exercise note', `
      <div class="field">
        <label for="exNote">Note (e.g. seat height, grip, cues)</label>
        <textarea id="exNote" rows="3">${esc(ex.note ?? '')}</textarea>
      </div>
      <button class="btn btn-primary" id="noteSave">Save note</button>
    `, (body) => {
      $('#exNote', body).focus();
      $('#noteSave', body).addEventListener('click', () => {
        const val = $('#exNote', body).value.trim();
        if (val) ex.note = val; else delete ex.note;
        save(); closeSheet(); render();
      });
    });
  }

  /* -------- plate calculator -------- */

  function openPlateCalc(startWeight) {
    const u = unit();
    const plates = u === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
    const bars = u === 'kg' ? [20, 15, 10] : [45, 35, 15];
    const calc = (target, bar) => {
      let perSide = (target - bar) / 2;
      if (perSide < 0) return { list: [], left: 0, invalid: true };
      const list = [];
      for (const p of plates) {
        const n = Math.floor(perSide / p + 1e-9);
        if (n > 0) { list.push([p, n]); perSide = Math.round((perSide - n * p) * 100) / 100; }
      }
      return { list, left: perSide, invalid: false };
    };
    openSheet('Plate calculator', `
      <div class="field-row">
        <div class="field"><label for="pcTarget">Target (${esc(u)})</label>
          <input id="pcTarget" type="number" inputmode="decimal" min="0" step="0.5" value="${startWeight ?? (u === 'kg' ? 60 : 135)}"></div>
        <div class="field"><label for="pcBar">Bar (${esc(u)})</label>
          <select id="pcBar">${bars.map((b, i) => `<option value="${b}" ${i === 0 ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      </div>
      <div class="card" style="text-align:center">
        <span class="micro">Per side</span>
        <div id="pcResult" class="pc-result">—</div>
      </div>
    `, (body) => {
      const update = () => {
        const target = Number($('#pcTarget', body).value) || 0;
        const bar = Number($('#pcBar', body).value);
        const r = calc(target, bar);
        $('#pcResult', body).innerHTML = r.invalid
          ? '<span class="muted">Target is below the bar weight</span>'
          : (r.list.map(([p, n]) => `<b>${fmtNum(p)}</b>×${n}`).join(' &nbsp; ') || '<span class="muted">Empty bar</span>')
            + (r.left > 0 ? ` <span class="muted">(+${fmtNum(r.left)} ${esc(u)}/side unmatched)</span>` : '');
      };
      $('#pcTarget', body).addEventListener('input', update);
      $('#pcBar', body).addEventListener('change', update);
      update();
    });
  }

  /* -------- exercise records & history -------- */

  function openExerciseDetail(exerciseId) {
    const info = exerciseById(exerciseId);
    const cardio = isCardio(exerciseId);
    const u = unit();
    const sessions = [];
    for (const w of state.workouts) {
      const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (!ex) continue;
      const done = ex.sets.filter((s) => s.done);
      if (done.length) sessions.push({ t: w.startedAt, sets: done });
    }
    let recordsHtml = '';
    if (!sessions.length) {
      recordsHtml = '<p class="empty-note">No logged sets yet.</p>';
    } else if (cardio) {
      const all = sessions.flatMap((s) => s.sets);
      const longest = Math.max(...all.map((s) => s.reps || 0));
      const totalMin = all.reduce((t, s) => t + (s.reps || 0), 0);
      recordsHtml = `
        <div class="tile-row">
          <div class="tile"><span class="micro">Longest</span><div class="t-value">${longest}<span class="t-unit"> min</span></div></div>
          <div class="tile"><span class="micro">Total</span><div class="t-value">${totalMin}<span class="t-unit"> min</span></div></div>
          <div class="tile"><span class="micro">Sessions</span><div class="t-value">${sessions.length}</div></div>
        </div>`;
    } else {
      const working = sessions.flatMap((s) => s.sets.filter((x) => (x.type || 'N') !== 'W' && x.weight));
      const bestW = working.length ? Math.max(...working.map((s) => s.weight)) : 0;
      const best1 = working.length ? Math.max(...working.map((s) => est1RM(s.weight, s.reps))) : 0;
      const bestVol = Math.max(...sessions.map((s) => s.sets.filter((x) => (x.type || 'N') !== 'W').reduce((t, x) => t + (x.weight || 0) * (x.reps || 0), 0)));
      recordsHtml = `
        <div class="tile-row">
          <div class="tile"><span class="micro">Best weight</span><div class="t-value">${fmtNum(bestW)}<span class="t-unit"> ${esc(u)}</span></div></div>
          <div class="tile"><span class="micro">Est. 1RM</span><div class="t-value">${fmtNum(Math.round(best1 * 10) / 10)}<span class="t-unit"> ${esc(u)}</span></div></div>
          <div class="tile"><span class="micro">Best volume</span><div class="t-value">${bestVol >= 10000 ? (bestVol / 1000).toFixed(1) + 'k' : fmtNum(bestVol)}<span class="t-unit"> ${esc(u)}</span></div></div>
        </div>`;
    }
    const fmtSet = (s) => cardio ? `${fmtNum(s.weight ?? 0)} km · ${s.reps} min` : `${fmtNum(s.weight ?? 0)}×${s.reps}${s.pr ? ' 🏆' : ''}`;
    openSheet(info?.name ?? 'Exercise', `
      <p class="muted" style="margin-bottom:12px">${esc(info?.muscle ?? '')}${info?.equipment ? ' · ' + esc(info.equipment) : ''} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}</p>
      ${recordsHtml}
      ${sessions.length ? `
      <div class="section-title">Recent sessions</div>
      ${sessions.slice(0, 6).map((s) => `
        <div class="card" style="padding:12px 16px;margin-bottom:8px">
          <div class="hist-top"><b style="font-size:0.88rem">${fmtDate(s.t)}</b></div>
          <p class="muted" style="margin-top:4px;font-variant-numeric:tabular-nums">${s.sets.map(fmtSet).join(', ')}</p>
        </div>`).join('')}
      ${!cardio ? '<button class="btn btn-quiet" id="detTrend">View 1RM trend</button>' : ''}` : ''}
    `, (body) => {
      $('#detTrend', body)?.addEventListener('click', () => {
        progressExerciseId = exerciseId;
        progressSeg = 'trends';
        closeSheet(); goTab('profile');
      });
    });
  }

  function renderExerciseBlock(ex, exIdx) {
    const info = exerciseById(ex.exerciseId);
    const prev = previousSets(ex.exerciseId);
    const cardio = isCardio(ex.exerciseId);
    const u = unit();
    const typeLabel = (s, i) => {
      const t = s.type || 'N';
      return t === 'N' ? String(i + 1) : t;
    };
    return `
      <div class="card ex-block" data-ex="${exIdx}">
        <div class="ex-head">
          <h3 class="ex-name" role="button" tabindex="0">${ex.ss ? `<span class="ss-chip">SS${ex.ss}</span> ` : ''}${esc(info?.name ?? 'Unknown exercise')}
            <span class="muscle">${esc(info?.muscle ?? '')}${info?.equipment ? ' · ' + esc(info.equipment) : ''}</span>
          </h3>
          <button class="ex-remove ex-menu" aria-label="Exercise options">
            <svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
          </button>
        </div>
        <button class="ex-line ex-note-line ${ex.note ? 'has' : ''}">${ex.note ? '📝 ' + esc(ex.note) : 'Add notes here…'}</button>
        <button class="ex-line ex-rest">⏱ Rest timer: <b>${ex.rest === 0 ? 'Off' : (ex.rest ?? state.settings.restSeconds) + 's'}</b></button>
        <div class="set-grid">
          <span class="hdr">Set</span><span class="hdr">Prev</span><span class="hdr">${cardio ? 'km' : esc(u)}</span><span class="hdr">${cardio ? 'min' : 'Reps'}</span><span class="hdr">✓</span>
          ${ex.sets.map((s, i) => {
            const p = prev[i];
            const prevTxt = p ? (cardio ? `${fmtNum(p.weight ?? 0)}·${p.reps}m` : `${fmtNum(p.weight ?? 0)}×${p.reps}`) : '—';
            const t = s.type || 'N';
            return `
            <div class="set-row ${s.done ? 'logged' : ''}" data-set="${i}">
              <button class="set-num t-${t.toLowerCase()}" title="Tap to change set type" aria-label="Set type: ${t === 'N' ? 'normal' : t === 'W' ? 'warm-up' : t === 'D' ? 'drop set' : 'failure'}">${typeLabel(s, i)}</button>
              <span class="set-prev">${s.pr ? '🏆 ' : ''}${prevTxt}</span>
              <input class="set-input in-weight" type="number" inputmode="decimal" min="0" step="${cardio ? '0.1' : '0.5'}"
                     value="${s.weight ?? ''}" placeholder="${p?.weight ?? ''}" aria-label="${cardio ? 'Distance km' : 'Weight'}, set ${i + 1}">
              <input class="set-input in-reps" type="number" inputmode="numeric" min="0" step="1"
                     value="${s.reps ?? ''}" placeholder="${p?.reps ?? ex.targetReps ?? ''}" aria-label="${cardio ? 'Minutes' : 'Reps'}, set ${i + 1}">
              <button class="set-done ${s.done ? 'logged' : ''}" aria-label="${s.done ? 'Undo set' : 'Log set'}" aria-pressed="${s.done}">
                <svg viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>
              </button>
            </div>`;
          }).join('')}
        </div>
        <button class="chip-btn add-set">+ Add set</button>
      </div>`;
  }

  function newExerciseEntry(exerciseId, setCount, targetReps) {
    const entry = {
      exerciseId,
      sets: Array.from({ length: setCount }, () => ({ weight: null, reps: null, done: false })),
    };
    if (targetReps) entry.targetReps = targetReps;
    return entry;
  }

  function startWorkout(templateId) {
    const tpl = templateId ? [...BUILTIN_TEMPLATES, ...state.templates].find((t) => t.id === templateId) : null;
    state.activeWorkout = {
      id: uid(),
      name: tpl ? tpl.name : 'Workout',
      startedAt: Date.now(),
      exercises: tpl ? tpl.exercises.map((e) => newExerciseEntry(e.exerciseId, e.sets, e.targetReps)) : [],
    };
    workoutOpen = true;
    openWkEntry();
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
    const prs = workoutPRs(w);
    openSheet('Finish workout', `
      <div class="field">
        <label for="wkName">Workout name</label>
        <input id="wkName" type="text" value="${esc(w.name)}">
      </div>
      <p class="muted" style="margin-bottom:10px">${done.length} sets · ${fmtNum(workoutVolume(w))} ${esc(unit())} total volume · ${fmtDuration(Date.now() - w.startedAt)}</p>
      ${prs.length ? `<p style="margin-bottom:10px;font-weight:700">🏆 ${prs.length} new PR${prs.length === 1 ? '' : 's'}: <span class="muted">${prs.map((p) => `${esc(exerciseById(p.exerciseId)?.name ?? '?')} ${fmtNum(p.weight)}×${p.reps}`).join(', ')}</span></p>` : ''}
      <div class="field">
        <label for="wkNote">Workout notes (optional)</label>
        <textarea id="wkNote" rows="2">${esc(w.note ?? '')}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:0.9rem">
        <input type="checkbox" id="saveTpl" style="width:18px;height:18px"> Save as routine
      </label>
      <button class="btn btn-primary" id="confirmFinish">Save workout</button>
    `, (body) => {
      $('#confirmFinish', body).addEventListener('click', () => {
        w.name = $('#wkName', body).value.trim() || 'Workout';
        const note = $('#wkNote', body).value.trim();
        if (note) w.note = note;
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
        workoutOpen = false;
        stopRest();
        save(); closeSheet(); closeWkEntry(); render();
        toast(prs.length ? `Workout saved — ${prs.length} PR${prs.length === 1 ? '' : 's'} 🏆` : 'Workout saved 💪');
      });
    });
  }

  /* -------- routine builder -------- */

  let routineDraft = null;

  function openRoutineBuilder(templateId) {
    const existing = templateId ? state.templates.find((t) => t.id === templateId) : null;
    routineDraft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: uid(), name: '', exercises: [] };
    showRoutineBuilder();
  }

  function showRoutineBuilder() {
    const d = routineDraft;
    const isEdit = state.templates.some((t) => t.id === d.id);
    openSheet(isEdit ? 'Edit routine' : 'New routine', `
      <div class="field"><label for="rbName">Routine name</label>
        <input id="rbName" type="text" placeholder="e.g. Upper Body A" value="${esc(d.name)}"></div>
      ${d.exercises.length ? `
      <div class="rb-list">
        ${d.exercises.map((e, i) => `
          <div class="rb-row" data-i="${i}">
            <div class="rb-name">${esc(exerciseById(e.exerciseId)?.name ?? '?')}</div>
            <input class="rb-sets" type="number" inputmode="numeric" min="1" max="10" value="${e.sets}" aria-label="Sets">
            <span class="rb-x">×</span>
            <input class="rb-reps" type="number" inputmode="numeric" min="1" max="100" value="${e.targetReps ?? ''}" placeholder="reps" aria-label="Target reps">
            <button class="rb-del" aria-label="Remove">✕</button>
          </div>`).join('')}
      </div>` : '<p class="empty-note" style="padding:16px">No exercises yet — add some below.</p>'}
      <button class="btn btn-quiet" id="rbAdd">+ Add exercise</button>
      <button class="btn btn-primary" id="rbSave" style="margin-top:10px">Save routine</button>
    `, (body) => {
      $('#rbName', body).addEventListener('input', (e) => { d.name = e.target.value; });
      body.addEventListener('input', (e) => {
        const row = e.target.closest('.rb-row');
        if (!row) return;
        const entry = d.exercises[Number(row.dataset.i)];
        if (e.target.classList.contains('rb-sets')) entry.sets = Math.max(1, Number(e.target.value) || 1);
        if (e.target.classList.contains('rb-reps')) {
          const val = Number(e.target.value);
          if (val > 0) entry.targetReps = val; else delete entry.targetReps;
        }
      });
      body.addEventListener('click', (e) => {
        const del = e.target.closest('.rb-del');
        if (del) {
          d.exercises.splice(Number(del.closest('.rb-row').dataset.i), 1);
          showRoutineBuilder();
        }
      });
      $('#rbAdd', body).addEventListener('click', () => {
        openExercisePicker((exId) => {
          d.exercises.push({ exerciseId: exId, sets: 3, targetReps: 10 });
          showRoutineBuilder();
        });
      });
      $('#rbSave', body).addEventListener('click', () => {
        if (!d.name.trim()) { toast('Give the routine a name'); return; }
        if (!d.exercises.length) { toast('Add at least one exercise'); return; }
        d.name = d.name.trim();
        const idx = state.templates.findIndex((t) => t.id === d.id);
        if (idx >= 0) state.templates[idx] = d; else state.templates.push(d);
        routineDraft = null;
        save(); closeSheet(); render();
        toast('Routine saved');
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
        if (item) {
          closeSheetNow();
          onPick(item.dataset.pick);
          // if the pick handler didn't open a follow-up sheet, release the history entry
          if (!document.querySelector('#sheetRoot').children.length) closeSheet();
        }
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

  /* ================= PROFILE TAB (trends / history / library / settings) ================= */

  function renderProfile() {
    const v = $('#view');
    v.innerHTML = `
      <div class="home-top" style="margin-bottom:2px">
        <h2 class="profile-title">${avatarHTML('pt-avatar')}${esc(state.settings.name || 'Profile')}</h2>
        <button class="icon-btn" id="profileSettings" aria-label="Settings">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
        </button>
      </div>
      <p class="subtitle">Your training at a glance</p>
      <div class="seg" id="progSeg">
        <button data-seg="trends" class="${progressSeg === 'trends' ? 'on' : ''}">Trends</button>
        <button data-seg="history" class="${progressSeg === 'history' ? 'on' : ''}">History</button>
        <button data-seg="library" class="${progressSeg === 'library' ? 'on' : ''}">Exercises</button>
      </div>
      <div id="segBody"></div>`;

    $('#profileSettings').addEventListener('click', openSettings);
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
    for (const w of state.workouts) for (const ex of w.exercises) if (ex.sets.length && !isCardio(ex.exerciseId)) ids.add(ex.exerciseId);
    return [...ids].map(exerciseById).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  function strengthSeries(exerciseId) {
    const points = [];
    for (const w of [...state.workouts].sort((a, b) => a.startedAt - b.startedAt)) {
      const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (!ex) continue;
      let best = 0, bestSet = null;
      for (const s of ex.sets) {
        if ((s.type || 'N') === 'W') continue;
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

  let bodyMetric = 'weight';

  function bodySeries(metric) {
    const src = metric === 'weight'
      ? state.nutrition.weights
      : state.nutrition.measurements.filter((m) => m.key === metric);
    return [...src]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => ({ t: new Date(w.date + 'T12:00:00').getTime(), v: w.value }));
  }

  function openMeasureSheet() {
    const todayKey = dateKey();
    const latest = (key) => {
      const rows = state.nutrition.measurements.filter((m) => m.key === key).sort((a, b) => a.date.localeCompare(b.date));
      return rows[rows.length - 1]?.value;
    };
    openSheet('Log measurement', `
      <div class="field-row">
        <div class="field"><label for="msKey">Measurement</label>
          <select id="msKey">${Object.entries(MEASURE_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="field"><label for="msVal">Value (cm)</label>
          <input id="msVal" type="number" inputmode="decimal" min="0" step="0.1" placeholder="${latest('waist') ?? ''}"></div>
      </div>
      <button class="btn btn-primary" id="msSave">Save</button>
      <p class="muted" style="margin-top:14px">${Object.entries(MEASURE_LABELS).map(([k, l]) => {
        const v = latest(k);
        return v ? `${l}: <b>${fmtNum(v)} cm</b>` : null;
      }).filter(Boolean).join(' · ') || 'No measurements yet.'}</p>
    `, (body) => {
      const keySel = $('#msKey', body), valIn = $('#msVal', body);
      keySel.addEventListener('change', () => { valIn.placeholder = latest(keySel.value) ?? ''; });
      $('#msSave', body).addEventListener('click', () => {
        const val = Number(valIn.value);
        if (!val || val <= 0) { toast('Enter a value'); return; }
        const key = keySel.value;
        state.nutrition.measurements = state.nutrition.measurements.filter((m) => !(m.date === todayKey && m.key === key));
        state.nutrition.measurements.push({ date: todayKey, key, value: Math.round(val * 10) / 10 });
        save(); closeSheet(); render();
        toast(`${MEASURE_LABELS[key]} logged`);
      });
    });
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
    const bw = bodySeries(bodyMetric);

    const streak = streakWeeks();
    const totalTimeMs = state.workouts.reduce((t, w) => t + ((w.finishedAt ?? w.startedAt) - w.startedAt), 0);
    const totalPRs = state.workouts.reduce((t, w) => t + workoutPRs(w).length, 0);
    const muscles = muscleSets7d();
    const muscleMax = Math.max(12, ...Object.values(muscles));
    const bodyUnit = bodyMetric === 'weight' ? u : 'cm';

    v.innerHTML = `
      <div class="tile-row">
        <div class="tile"><span class="micro">Workouts</span><div class="t-value">${totalWorkouts}</div></div>
        <div class="tile"><span class="micro">Volume</span><div class="t-value">${totalVolume >= 10000 ? (totalVolume / 1000).toFixed(1) + 'k' : fmtNum(Math.round(totalVolume))}<span class="t-unit"> ${esc(u)}</span></div></div>
        <div class="tile"><span class="micro">This week</span><div class="t-value">${thisWeek}<span class="t-unit"> sessions</span></div></div>
      </div>
      <div class="tile-row">
        <div class="tile"><span class="micro">Streak</span><div class="t-value">${streak}<span class="t-unit"> wk${streak === 1 ? '' : 's'}</span></div></div>
        <div class="tile"><span class="micro">Time trained</span><div class="t-value">${Math.floor(totalTimeMs / 3600000)}<span class="t-unit"> h ${Math.round((totalTimeMs % 3600000) / 60000)} m</span></div></div>
        <div class="tile"><span class="micro">PRs</span><div class="t-value">${totalPRs} 🏆</div></div>
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

      ${Object.keys(muscles).length ? `
      <div class="card">
        <h3>Weekly sets per muscle</h3>
        <p class="muted" style="margin-bottom:12px">Working sets, last 7 days</p>
        <div class="ms-bars">
          ${MUSCLE_GROUPS.filter((g) => g !== 'Cardio' && muscles[g]).map((g) => `
            <div class="ms-row">
              <span class="ms-label">${esc(g)}</span>
              <div class="ms-track"><div class="ms-fill" style="width:${Math.min(100, (muscles[g] / muscleMax) * 100)}%"></div></div>
              <b class="ms-count">${muscles[g]}</b>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="card chart-card">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0 8px">
          <h3 style="margin:0">Body</h3>
          <button class="chip-btn" id="addMeasure">+ Log</button>
        </div>
        <select class="select-field" id="bodyMetricSel" style="margin:10px 8px 4px;width:calc(100% - 16px)" aria-label="Choose body metric">
          <option value="weight" ${bodyMetric === 'weight' ? 'selected' : ''}>Bodyweight</option>
          ${Object.entries(MEASURE_LABELS).map(([k, l]) => `<option value="${k}" ${bodyMetric === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <div class="chart-wrap" id="bwChart">
          ${bw.length >= 2 ? lineChartSVG(bw, bodyUnit, 'Body metric over time', 'var(--series-2)') : `<p class="empty-note">Log this at least twice to see a trend.<br>Bodyweight is logged on Home, measurements via “+ Log”.</p>`}
        </div>
      </div>`;

    $('#progressExercise')?.addEventListener('change', (e) => {
      progressExerciseId = e.target.value;
      render();
    });
    $('#bodyMetricSel')?.addEventListener('change', (e) => {
      bodyMetric = e.target.value;
      render();
    });
    $('#addMeasure')?.addEventListener('click', openMeasureSheet);

    attachLineHover($('#strengthChart'), series, u);
    attachBarHover($('#volumeChart'), weeks, u);
    attachLineHover($('#bwChart'), bw, bodyUnit);
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

  let histMonthOffset = 0;

  function calendarHTML() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + histMonthOffset, 1);
    const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const workoutDays = new Set(state.workouts.map((w) => dateKey(new Date(w.startedAt))));
    const todayK = dateKey();
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l) => `<span class="cal-head">${l}</span>`).join('');
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(new Date(first.getFullYear(), first.getMonth(), d));
      cells += `<span class="cal-day ${workoutDays.has(key) ? 'has' : ''} ${key === todayK ? 'today' : ''}">${d}</span>`;
    }
    return `
      <div class="card" style="margin-bottom:12px">
        <div class="day-nav" style="margin:0 0 10px">
          <button id="calPrev" aria-label="Previous month">‹</button>
          <span class="dn-label" style="font-size:0.95rem">${esc(label)}</span>
          <button id="calNext" aria-label="Next month" ${histMonthOffset >= 0 ? 'disabled style="opacity:0.35"' : ''}>›</button>
        </div>
        <div class="cal-grid">${cells}</div>
      </div>`;
  }

  function renderHistory(v) {
    if (!state.workouts.length) {
      v.innerHTML = `<p class="empty-note">No workouts yet.<br>Finish your first session and it will show up here.</p>`;
      return;
    }
    const fmtHistSet = (s, cardio) => {
      const t = s.type || 'N';
      const tag = t === 'N' ? '' : t + ' ';
      return cardio ? `${fmtNum(s.weight ?? 0)}km·${s.reps}m` : `${tag}${fmtNum(s.weight ?? 0)}×${s.reps}${s.pr ? ' 🏆' : ''}`;
    };
    v.innerHTML = calendarHTML() + state.workouts.map((w) => {
      const sets = loggedSets(w);
      const prCount = workoutPRs(w).length;
      const open = expandedHistoryId === w.id;
      return `
      <div class="card hist-item" data-id="${esc(w.id)}">
        <div class="hist-top">
          <h3>${esc(w.name)}${prCount ? ` <span title="${prCount} PRs">🏆${prCount > 1 ? prCount : ''}</span>` : ''}</h3>
          <span class="muted">${fmtDate(w.startedAt)}</span>
        </div>
        <div class="hist-stats">
          <span><b>${sets.length}</b> sets</span>
          <span><b>${fmtNum(workoutVolume(w))}</b> ${esc(unit())} volume</span>
          <span><b>${fmtDuration((w.finishedAt ?? w.startedAt) - w.startedAt)}</b></span>
        </div>
        ${open ? `
        <div class="hist-detail">
          ${w.note ? `<p class="ex-note" style="margin-bottom:8px">${esc(w.note)}</p>` : ''}
          <table>
            <thead><tr><th>Exercise</th><th>Sets</th><th>Best set</th></tr></thead>
            <tbody>
            ${w.exercises.map((ex) => {
              const info = exerciseById(ex.exerciseId);
              const cardio = isCardio(ex.exerciseId);
              const working = ex.sets.filter((s) => (s.type || 'N') !== 'W');
              const best = cardio
                ? working.reduce((b, s) => (!b || (s.reps || 0) > (b.reps || 0) ? s : b), null)
                : working.reduce((b, s) => (!b || est1RM(s.weight, s.reps) > est1RM(b.weight, b.reps) ? s : b), null);
              return `<tr>
                <td>${esc(info?.name ?? '?')}${ex.note ? ' 📝' : ''}</td>
                <td>${ex.sets.map((s) => fmtHistSet(s, cardio)).join(', ')}</td>
                <td>${best ? (cardio ? `${best.reps} min` : `${fmtNum(best.weight ?? 0)} × ${best.reps}`) : '—'}</td>
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

    $('#calPrev', v).addEventListener('click', () => { histMonthOffset -= 1; render(); });
    $('#calNext', v).addEventListener('click', () => { if (histMonthOffset < 0) { histMonthOffset += 1; render(); } });

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
            workoutOpen = true;
            openWkEntry();
            save(); goTab('workout');
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
      el.addEventListener('click', () => openExerciseDetail(el.dataset.ex));
    });
  }

  /* ================= SETTINGS ================= */

  function openSettings() {
    const s = state.settings;
    const t = state.nutrition.targets;
    openSheet('Settings', `
      <div class="field">
        <label>Profile</label>
        <div class="avatar-row">
          <span class="av-preview">${avatarHTML('av-circle')}</span>
          <div class="avatar-actions">
            <button class="chip-btn" id="avPick">${s.avatar ? 'Change photo' : 'Add photo'}</button>
            ${s.avatar ? '<button class="chip-btn" id="avClear">Remove</button>' : ''}
          </div>
        </div>
        <input id="avFile" type="file" accept="image/*" hidden>
      </div>
      <div class="field">
        <label for="setName">Your name (for the greeting)</label>
        <input id="setName" type="text" placeholder="e.g. Alex" value="${esc(s.name ?? '')}">
      </div>
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
      <div class="field">
        <label for="tWater">Water target (glasses / day)</label>
        <input id="tWater" type="number" inputmode="numeric" min="1" value="${s.waterTarget}">
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-quiet" id="exportBtn">Export data</button>
        <button class="btn btn-quiet" id="importBtn">Import data</button>
      </div>
      <input id="importFile" type="file" accept="application/json" hidden>
      <button class="btn btn-danger" id="wipeBtn" style="margin-top:12px">Erase all data</button>
      <button class="btn btn-quiet" id="forceUpdate" style="margin-top:12px">Force update now</button>
      <p class="muted" style="margin-top:16px;text-align:center">B.E.L.A Gym v${APP_VERSION} · data stays on this device</p>
    `, (body) => {
      $('#avPick', body).addEventListener('click', () => $('#avFile', body).click());
      $('#avFile', body).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        readAvatarFile(file, (dataUri) => {
          if (!dataUri) { toast('Could not read that image'); return; }
          try {
            state.settings.avatar = dataUri;
            save();
          } catch {
            delete state.settings.avatar;
            toast('That image is too large');
            return;
          }
          closeSheetNow(); render(); openSettings();
          toast('Profile picture updated');
        });
      });
      $('#avClear', body)?.addEventListener('click', () => {
        delete state.settings.avatar;
        save(); closeSheetNow(); render(); openSettings();
        toast('Profile picture removed');
      });
      $('#setName', body).addEventListener('change', (e) => {
        state.settings.name = e.target.value.trim();
        save(); render();
      });
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
      $('#tWater', body).addEventListener('change', (e) => {
        state.settings.waterTarget = Math.max(1, Number(e.target.value) || 8);
        save(); render();
      });
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
      $('#forceUpdate', body).addEventListener('click', async () => {
        // clears every cached copy and re-registers, so the next load is fresh
        toast('Fetching the latest version…');
        try {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
          if (navigator.serviceWorker) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
          }
        } catch { /* falls through to a plain reload */ }
        location.replace(location.pathname + '?u=' + Date.now());
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

  /* ---------------- swipe between tabs ---------------- */

  const TAB_ORDER = ['home', 'workout', 'meals'];
  let swipeStart = null;
  let slideDir = null;

  addEventListener('touchstart', (e) => {
    swipeStart = null;
    if (e.touches.length !== 1) return;
    // never hijack gestures inside the logger, a sheet, inputs or charts
    if (workoutOpen || $('#sheetRoot').children.length) return;
    if (e.target.closest('input, textarea, select, button, .chart-wrap, .cal-grid')) return;
    const t = e.touches[0];
    swipeStart = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });

  addEventListener('touchend', (e) => {
    if (!swipeStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.x;
    const dy = t.clientY - swipeStart.y;
    const dt = Date.now() - swipeStart.at;
    swipeStart = null;
    // horizontal, long enough, and not a slow drag
    if (dt > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const i = TAB_ORDER.indexOf(currentTab);
    const next = dx < 0 ? i + 1 : i - 1;
    if (i < 0 || next < 0 || next >= TAB_ORDER.length) return;
    slideDir = dx < 0 ? 'slide-left' : 'slide-right';
    window.scrollTo(0, 0);
    goTab(TAB_ORDER[next]);
  }, { passive: true });

  // Home must fit one screen on any device and font-scale setting: measure the
  // rendered result and step down through the compact tiers until it fits.
  function fitHome() {
    const v = $('#view');
    if (!v.classList.contains('home-screen')) { v.style.height = ''; return; }
    v.classList.remove('home-compact', 'home-tight');
    // pin the home container to the height actually visible right now, so the
    // space-between layout can never distribute past the bottom of the screen
    const vpH = window.visualViewport?.height || document.documentElement.clientHeight;
    v.style.height = vpH + 'px';
    // measure against the *visible* viewport: during a pull-to-refresh the URL
    // bar is showing, so the usable height is smaller than the layout viewport
    const visible = () => (window.visualViewport?.height || document.documentElement.clientHeight);
    const overflows = () => {
      const kids = v.children;
      if (!kids.length) return false;
      const bottom = kids[kids.length - 1].getBoundingClientRect().bottom;
      const navTop = $('.tab-bar').getBoundingClientRect().top;
      return bottom > Math.min(navTop, visible()) - 2
        || document.documentElement.scrollHeight > visible() + 1;
    };
    if (overflows()) v.classList.add('home-compact');
    if (overflows()) v.classList.add('home-tight');
  }
  // browser chrome (URL bar) sliding in/out changes the usable height, so
  // re-fit whenever it moves as well as on rotation and load
  addEventListener('resize', fitHome);
  addEventListener('orientationchange', () => setTimeout(fitHome, 120));
  addEventListener('pageshow', () => setTimeout(fitHome, 60));
  window.visualViewport?.addEventListener('resize', fitHome);
  window.visualViewport?.addEventListener('scroll', fitHome);

  function render() {
    ensureElapsedTimer();
    $('#view').classList.toggle('home-screen', currentTab === 'home');
    switch (currentTab) {
      case 'home': renderHome(); break;
      case 'workout': renderWorkout(); break;
      case 'meals': renderMeals(); break;
      case 'profile': renderProfile(); break;
    }
    renderWorkoutOverlay();
    fitHome();
    if (slideDir) {
      const v = $('#view');
      v.classList.remove('slide-left', 'slide-right');
      void v.offsetWidth; // restart the animation
      v.classList.add(slideDir);
      slideDir = null;
    }
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    window.scrollTo(0, 0);
    goTab(t.dataset.tab);
  }));

  render();
})();
