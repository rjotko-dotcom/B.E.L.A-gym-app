/* ============================================================
   B.E.L.A Gym — app logic
   Workouts + nutrition. Data lives in localStorage ("bela-gym-v1").
   ============================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'bela-gym-v1';
  const APP_VERSION = '14.4';

  /* ---------------- state ---------------- */

  const defaultState = () => ({
    settings: { unit: 'kg', appearance: 'system', name: '' },
    nutrition: {
      targets: { kcal: 2800, protein: 180, carbs: 300, fat: 70 },
      meals: [],        // { id, date:'YYYY-MM-DD', time, name, kcal, protein, carbs, fat }
      weights: [],      // { date:'YYYY-MM-DD', value }
      water: [],        // { date:'YYYY-MM-DD', glasses }
      measurements: [], // { date:'YYYY-MM-DD', key, value }  key: waist|chest|arm|thigh|hips
    },
    savedMeals: [],   // { id, name, slot, items:[{name,kcal,protein,carbs,fat}] }
    foods: [],        // your own foods: { id, name, unit:'g'|'ml'|'piece', per, serving, kcal, protein, carbs, fat, used }
    schedule: [null, null, null, null, null, null, null],  // Mon..Sun: template id, 'rest', or null
    habits: [],       // { id, name, icon, type:'check'|'count', target, unit, step }
    habitLog: {},     // { 'YYYY-MM-DD': { habitId: value } }
    customExercises: [],
    exPrefs: {},      // how you do a given exercise: { id: { wu, wt } }
    templates: [],
    tplHidden: [],    // built-in routines you removed
    tplOrder: [],     // the order you put them in, if you have
    planWeeks: {},    // a week moved around, kept under its Monday
    workouts: [],          // finished workouts, newest first
    activeWorkout: null,
  });

  /* A picture of the document as it was at the last save, so the next one
     can tell what moved. See js/sync.js. */
  let syncShadow = null;
  let state = load();
  if (window.BelaSync) syncShadow = BelaSync.snapshot(state);
  let currentTab = 'home';
  /* Pull-to-refresh reloads the page, and the app used to come back on Home.
     The tab is parked in sessionStorage instead: a refresh returns to the page
     you were on, while opening the app fresh still starts at Home. */
  const TAB_KEY = 'bela-gym-tab';
  const rememberTab = (tab) => { try { sessionStorage.setItem(TAB_KEY, tab); } catch (e) { /* private mode */ } };
  const lastTab = (() => { try { return sessionStorage.getItem(TAB_KEY); } catch (e) { return null; } })();
  let workoutOpen = !!state.activeWorkout;   // full-screen logger visible?

  /* ---------------- hardware back-button navigation ----------------
     We push one history entry per UI layer (tab, workout overlay, sheet)
     so the Android back button peels layers instead of exiting the app.
     skipPop swallows the popstate events our own history.back() calls fire. */
  let skipPop = 0;
  let tabHasEntry = false;
  let wkHasEntry = false;
  let sheetHasEntry = false;
  let scanHasEntry = false;

  function goTab(tab) {
    if (tab !== 'habits') habitReorder = false;
    if (tab !== 'workout') planWeekOffset = 0;
    currentTab = tab;
    rememberTab(tab);
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
    if (scanOpen) { scanHasEntry = false; closeScanner(false); return; }
    if ($('#sheetRoot').children.length) { sheetHasEntry = false; closeSheetNow(); return; }
    if (routineDraft) { rbHasEntry = false; closeRoutineBuilder(); return; }
    if (workoutOpen) { wkHasEntry = false; workoutOpen = false; render(); return; }
    if (currentTab !== 'home') { tabHasEntry = false; currentTab = 'home'; rememberTab('home'); render(); return; }
    // nothing left to close — the next back press exits normally
  });
  let progressSeg = 'trends';      // trends | history | library
  let expandedHistoryId = null;
  let progressExerciseId = null;
  let librarySearch = '';
  let mealDayOffset = 0;           // 0 = today, -1 = yesterday…
  let planWeekOffset = 0;          // the same, for the weekly plan card on workouts

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
      return normalize(parsed, d);
    } catch {
      return defaultState();
    }
  }
  /* A full storage box used to throw here and take the tap with it — the
     button simply did nothing. Say so instead, once, and keep the app usable
     with what is already saved. */
  let saveFailed = false;
  function save() {
    try {
      /* Before writing, note which rows changed since the last write. That
         record is what lets the PC copy tell an edit from something it has
         simply never seen. */
      if (window.BelaSync) syncShadow = BelaSync.stamp(state, syncShadow, Date.now()).shadow;
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      saveFailed = false;
      return true;
    } catch (e) {
      if (!saveFailed) {
        saveFailed = true;
        toast('Could not save — this phone is out of storage. Export a backup from Settings.');
      }
      return false;
    }
  }

  /* Brings a saved (or imported) document up to the current shape: fills in
     anything added since it was written, without touching what it already has. */
  function normalize(parsed, d = defaultState()) {
    if (!Array.isArray(parsed.savedMeals)) parsed.savedMeals = [];
    if (!Array.isArray(parsed.foods)) parsed.foods = [];
    if (!Array.isArray(parsed.tplHidden)) parsed.tplHidden = [];
    if (!Array.isArray(parsed.tplOrder)) parsed.tplOrder = [];
    if (!parsed.planWeeks || typeof parsed.planWeeks !== 'object') parsed.planWeeks = {};
    /* How an exercise is done — the machine's pounds, the belt you hang off
       it — used to be written on each copy of it, so an ad-hoc workout forgot
       what a routine knew. It belongs to the exercise. Anything a routine
       already carries is moved across once. */
    if (!parsed.exPrefs || typeof parsed.exPrefs !== 'object') parsed.exPrefs = {};
    (parsed.templates || []).forEach((t) => (t.exercises || []).forEach((e) => {
      if (!e.wu && !e.wt) return;
      const at = parsed.exPrefs[e.exerciseId] || (parsed.exPrefs[e.exerciseId] = {});
      if (e.wu && at.wu == null) at.wu = e.wu;
      if (e.wt && at.wt == null) at.wt = true;
    }));
    if (!Array.isArray(parsed.schedule) || parsed.schedule.length !== 7) parsed.schedule = [null, null, null, null, null, null, null];
    if (!parsed.habits) parsed.habits = starterHabits();
    /* Water is gone; a habit that filled itself from it becomes one you tick
       yourself, keeping its name, icon and target rather than disappearing. */
    (parsed.habits || []).forEach((h) => {
      if (h.source !== 'water') return;
      delete h.source;
      h.type = h.type || 'count';
      h.unit = h.unit || 'glasses';
      h.target = h.target || 8;
      h.step = h.step || 1;
    });
    if (!parsed.habitLog) parsed.habitLog = {};
    (parsed.nutrition?.meals || []).forEach((m) => { if (!m.slot) m.slot = slotFromTime(m.time); });
    return {
      ...d, ...parsed,
      settings: { ...d.settings, ...(parsed.settings || {}) },
      nutrition: {
        ...d.nutrition, ...(parsed.nutrition || {}),
        targets: { ...d.nutrition.targets, ...(parsed.nutrition?.targets || {}) },
      },
    };
  }

  function starterHabits() {
    return [
      { id: 'h_train', name: 'Train', icon: 'dumbbell', type: 'check', target: 1, unit: '', step: 1, source: 'workout' },
      { id: 'h_steps', name: 'Steps', icon: 'steps', type: 'count', target: 10000, unit: 'steps', step: 1000 },
      { id: 'h_read', name: 'Read', icon: 'book', type: 'count', target: 20, unit: 'pages', step: 5 },
      { id: 'h_sleep', name: 'Sleep 8h', icon: 'sleep', type: 'check', target: 1, unit: '', step: 1 },
    ];
  }
  // legacy meals carry only a clock time — place them in a sensible slot
  function slotFromTime(time) {
    const h = Number(String(time || '').slice(0, 2));
    if (!Number.isFinite(h)) return 'snack';
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'snack';
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

  const nowTime = () => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
  /* Two decimals at most, and never a trailing zero: 79 stays "79", 82.5 stays
     "82.5", and 78.95 is not quietly rounded up to "79". */
  function fmtNum(n) {
    if (!Number.isFinite(n)) return String(n);
    return String(Math.round(n * 100) / 100);
  }
  /* A bathroom scale reads in steps of 0.05, so that is what a bodyweight is
     kept to. Rounding to a tenth turned 78.95 into 79 — a whole number that
     was never on the scale. */
  const WEIGHT_STEP = 0.05;
  const roundWeight = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 20) / 20);

  // Epley estimated 1RM; for reps === 1 it's just the weight.
  function est1RM(weight, reps) {
    if (!weight || !reps) return 0;
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }

  function isCardio(exerciseId) {
    return exerciseById(exerciseId)?.muscle === 'Cardio';
  }
  /* A pull-up has no weight to write down, so it is not asked for. Some are
     done with a belt on, and the exercise's menu turns the column back on. */
  function isBodyweight(exerciseId) {
    return !isCardio(exerciseId) && exerciseById(exerciseId)?.equipment === 'Bodyweight';
  }
  const showsWeight = (ex) => !isBodyweight(ex.exerciseId) || !!(exPref(ex.exerciseId).wt ?? ex.wt);

  /* ---------------- cardio ----------------
     A treadmill is not a barbell. What you set on it is a time, a speed and
     an incline; the distance is what comes out of the other end. All four are
     kept per set — reps holds the minutes and weight the kilometres, as they
     always have, so nothing already logged has to change. */
  function cardioDistance(min, kmh) {
    if (!(min > 0) || !(kmh > 0)) return null;
    return Math.round((kmh * min / 60) * 100) / 100;
  }
  function cardioSpeed(min, km) {
    if (!(min > 0) || !(km > 0)) return null;
    return Math.round((km / (min / 60)) * 10) / 10;
  }
  // what a cardio set came to, in words
  function cardioText(s) {
    const bits = [];
    if (s.reps) bits.push(s.reps + ' min');
    if (s.kmh) bits.push(fmtNum(s.kmh) + ' km/h');
    if (s.incl) bits.push(fmtNum(s.incl) + '%');
    if (s.weight) bits.push(fmtNum(s.weight) + ' km');
    return bits.join(' · ');
  }
  function cardioLastLine(prev) {
    const last = [...prev].reverse().find((s) => s && (s.reps || s.weight));
    if (!last) return '';
    return '<div class="ex-line cardio-last">Last time · ' + esc(cardioText(last)) + '</div>';
  }
  // set.type: 'N' normal (default), 'W' warm-up, 'D' drop set, 'F' failure
  function isWorkingSet(s) {
    return s.done && (s.type || 'N') !== 'W';
  }
  function loggedSets(workout) {
    return workout.exercises.flatMap((ex) => ex.sets.filter((s) => s.done));
  }

  /* A session you walked away from without finishing. The clock keeps running,
     so by the next evening it reads 48:00:01 and the duration saved would be
     nonsense. Eight hours without a set is the line: nobody trains that long,
     and it is long enough not to catch a genuinely slow session. */
  const WORKOUT_STALE = 8 * 3600e3;
  function lastSetAt(w) {
    const stamps = loggedSets(w || { exercises: [] }).map((s) => s.at).filter(Boolean);
    return stamps.length ? Math.max(...stamps) : null;
  }
  function workoutIdle(w) {
    if (!w || w.editingId) return 0;
    return Date.now() - (lastSetAt(w) ?? w.startedAt);
  }
  const workoutStale = (w) => workoutIdle(w) > WORKOUT_STALE;
  // where it really ended: the last set, or an hour after it started
  const workoutEndedAt = (w) => lastSetAt(w) ?? Math.min(Date.now(), w.startedAt + 3600e3);
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
  /* What a record is: the most weight actually moved in one set — the bar
     times the reps. Estimated 1RM used to decide it, which let a light set
     with a lot of reps beat a heavy one and made the crown hard to believe. */
  /* Weight times reps, and where there is no weight, the reps themselves —
     otherwise a pull-up could never be a record, because every set of them
     scored nothing. A set with a belt on outscores one without, which is the
     right way round. */
  const setMass = (s) => {
    const w = Number(s.weight) || 0, r = Number(s.reps) || 0;
    return w > 0 ? w * r : r;
  };

  /* Some machines are marked in pounds even where everything else is in kilos.
     An exercise can be typed in the other unit: what you type is what the
     plate says, what is kept is the app's own unit, and the conversion sits
     under the box in small type so it is never a guess. */
  const exPref = (id) => (state.exPrefs && state.exPrefs[id]) || {};
  function setExPref(id, patch) {
    if (!state.exPrefs || typeof state.exPrefs !== 'object') state.exPrefs = {};
    const at = state.exPrefs[id] || (state.exPrefs[id] = {});
    Object.assign(at, patch);
    Object.keys(at).forEach((k) => { if (at[k] == null || at[k] === false) delete at[k]; });
    if (!Object.keys(at).length) delete state.exPrefs[id];
  }
  const exUnit = (ex) => {
    const wu = ex ? (exPref(ex.exerciseId).wu ?? ex.wu) : null;
    return (wu === 'lb' || wu === 'kg') ? wu : unit();
  };
  const OTHER_UNIT = () => (unit() === 'kg' ? 'lb' : 'kg');
  function toExUnit(v, ex) {
    if (v == null || v === '') return v;
    const from = unit(), to = exUnit(ex);
    if (from === to) return Number(v);
    return Math.round((to === 'lb' ? Number(v) * LB_PER_KG : Number(v) / LB_PER_KG) * 10) / 10;
  }
  function fromExUnit(v, ex) {
    if (v == null || v === '') return v;
    const to = unit(), from = exUnit(ex);
    if (from === to) return Number(v);
    return Math.round((from === 'lb' ? Number(v) / LB_PER_KG : Number(v) * LB_PER_KG) * 100) / 100;
  }

  function bestSetFor(exerciseId) {
    if (isCardio(exerciseId)) return null;
    let best = null;
    for (const w of state.workouts) {
      for (const ex of w.exercises) {
        if (ex.exerciseId !== exerciseId) continue;
        for (const s of ex.sets) {
          if (!isWorkingSet(s) || !(s.weight || s.reps)) continue;
          if (!best || setMass(s) > setMass(best)) best = s;
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

  /* What to aim for this session, from how the last one actually went:
     every working set hit the target -> add weight; otherwise chase a rep. */
  /* What to try today, read off what the plan asks for and what you managed
     last time. Working in a range is the whole point of one: reach the top of
     it on every set and the weight goes up and the reps go back to the
     bottom. Without a range it is the plain thing — hit the target on every
     set, add the smallest jump. */
  function overloadHint(ex) {
    if (isCardio(ex.exerciseId)) return null;
    const prev = previousSets(ex.exerciseId).filter((s) => (s.type || 'N') !== 'W' && s.weight);
    if (!prev.length) return null;

    // the plan for this exercise today, if it came from a routine
    const planned = ex.sets.filter((s) => (s.type || 'N') !== 'W');
    const lo = planned.find((s) => s.target)?.target ?? null;
    const hi = planned.find((s) => s.targetMax)?.targetMax ?? null;
    const goal = hi ?? lo ?? ex.targetReps ?? Math.max(...prev.map((s) => s.reps || 0)) ?? 8;

    // the heaviest thing you actually moved, judged the way records are
    const top = prev.reduce((a, b) => (setMass(b) > setMass(a) ? b : a));
    const allHit = prev.every((s) => (s.reps || 0) >= goal);
    const inc = unit() === 'kg' ? 2.5 : 5;
    return {
      allHit,
      ranged: !!(hi && lo && hi !== lo),
      low: lo, high: hi,
      prevWeight: top.weight,
      prevReps: prev.map((s) => s.reps || 0).join(','),
      weight: allHit ? Math.round((top.weight + inc) * 2) / 2 : top.weight,
      // back to the bottom of the range on a heavier bar; otherwise one more rep
      reps: allHit ? (hi && lo ? lo : goal) : Math.min(goal, (top.reps || 0) + 1),
    };
  }


  /* ---- switching kg <-> lb ----
     Changing the unit used to relabel every number, so 80 kg silently became
     "80 lb" across sets, records, volume, the goal and every chart. Switching
     now converts what is stored. Cardio rows keep km, and body measurements
     stay in cm. */

  const LB_PER_KG = 2.2046226218;
  function convertWeights(from, to) {
    if (from === to) return 0;
    const f = to === 'lb' ? LB_PER_KG : 1 / LB_PER_KG;
    const lift = (v) => (v == null ? v : Math.round(v * f * 2) / 2);     // nearest 0.5
    const body = (v) => (v == null ? v : roundWeight(v * f));            // nearest 0.05
    let touched = 0;

    const doWorkout = (w) => {
      if (!w) return;
      w.exercises.forEach((ex) => {
        if (isCardio(ex.exerciseId)) return;    // that column holds km, not weight
        ex.sets.forEach((st) => {
          if (st.weight == null) return;
          st.weight = lift(st.weight);
          touched++;
        });
      });
    };
    state.workouts.forEach(doWorkout);
    doWorkout(state.activeWorkout);

    state.nutrition.weights.forEach((w) => { w.value = body(w.value); touched++; });
    if (state.settings.goalWeight) state.settings.goalWeight = body(state.settings.goalWeight);

    // photos carry the bodyweight of the day they were taken
    if (typeof photoAll === 'function') {
      photoAll().then((list) => list.forEach((r) => {
        if (r.weight != null) photoPut({ ...r, weight: body(r.weight) });
      })).catch(() => {});
    }
    return touched;
  }

  /* -------- weekly plan -------- */

  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function todayIndex() { return (new Date().getDay() + 6) % 7; }   // 0 = Monday
  /* The four routines the app ships with are yours to change. Editing one
     keeps its id and saves your version alongside, which then stands in its
     place; deleting one puts its id here and the original steps aside. Nothing
     is lost either way — the originals are in the code, so they can come
     back. */
  const isBuiltinId = (id) => BUILTIN_TEMPLATES.some((b) => b.id === id);

  /* A routine used to say "3 sets" and one target for all of them. It now
     keeps a row per set, the way the logger does, so a routine can ask for
     12, 10, 8. Older routines — and the built-in ones — still say a number,
     and are read as that many identical rows. */
  function tplSets(e) {
    if (Array.isArray(e.sets)) return e.sets;
    const n = Math.max(1, Number(e.sets) || 1);
    return Array.from({ length: n }, () => (e.targetReps ? { reps: e.targetReps } : {}));
  }
  const tplSetCount = (e) => (Array.isArray(e.sets) ? e.sets.length : Math.max(1, Number(e.sets) || 1));
  function allTemplates() {
    const hidden = new Set(state.tplHidden || []);
    const mine = (state.templates || []).filter((t) => !hidden.has(t.id));
    const byId = new Map(mine.map((t) => [t.id, t]));
    const out = [];
    BUILTIN_TEMPLATES.forEach((t) => {
      if (hidden.has(t.id)) return;
      out.push(byId.get(t.id) || t);      // your version of it, if you changed one
      byId.delete(t.id);
    });
    mine.forEach((t) => { if (byId.has(t.id)) out.push(t); });
    // an order you arranged by hand wins; anything new falls in at the end
    const order = state.tplOrder || [];
    if (order.length) {
      out.sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
      });
    }
    return out;
  }
  /* Moving one is moving it within what is on screen, built-in or not. */
  function moveTemplate(id, dir) {
    const list = allTemplates().map((t) => t.id);
    const at = list.indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= list.length) return false;
    list.splice(to, 0, list.splice(at, 1)[0]);
    state.tplOrder = list;
    return true;
  }
  function duplicateTemplate(id) {
    const src = templateById(id);
    if (!src) return null;
    const { builtin, ...clean } = JSON.parse(JSON.stringify(src));
    clean.id = uid();
    clean.name = (src.name || 'Routine') + ' copy';
    if (!Array.isArray(state.templates)) state.templates = [];
    state.templates.push(clean);
    // sits straight under the one it came from
    const list = allTemplates().map((t) => t.id).filter((x) => x !== clean.id);
    const at = list.indexOf(id);
    list.splice(at < 0 ? list.length : at + 1, 0, clean.id);
    state.tplOrder = list;
    return clean;
  }
  const templateById = (id) => allTemplates().find((t) => t.id === id)
    || BUILTIN_TEMPLATES.find((t) => t.id === id)
    || (state.templates || []).find((t) => t.id === id)
    || null;
  /* The weekly plan is what you usually do. A week can also be moved around
     without changing the usual: get in late on Thursday, put a rest day there
     and push the rest along, and next Thursday is a Push day again. Those
     changes are kept per week, under the Monday they belong to. */
  const EMPTY_WEEK = () => [null, null, null, null, null, null, null];
  function weekMondayKey(offset = 0) {
    const n = new Date();
    const m = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7) + offset * 7);
    return dateKey(m);
  }
  const weekOverride = (offset = 0) => (state.planWeeks || {})[weekMondayKey(offset)] || null;
  function planFor(offset = 0) {
    const own = weekOverride(offset);
    return Array.isArray(own) ? own : (state.schedule || EMPTY_WEEK());
  }
  function setWeekPlan(offset, days) {
    if (!state.planWeeks || typeof state.planWeeks !== 'object') state.planWeeks = {};
    state.planWeeks[weekMondayKey(offset)] = days.slice(0, 7);
    prunePlanWeeks();
  }
  function clearWeekPlan(offset) {
    if (state.planWeeks) delete state.planWeeks[weekMondayKey(offset)];
  }
  /* A week that has been and gone is not worth carrying around. */
  function prunePlanWeeks() {
    if (!state.planWeeks) return;
    const cut = weekMondayKey(-8);
    Object.keys(state.planWeeks).forEach((k) => { if (k < cut) delete state.planWeeks[k]; });
  }

  function planEntry(id) {
    if (!id) return null;
    if (id === 'rest') return { rest: true, name: 'Rest' };
    return allTemplates().find((t) => t.id === id) || null;
  }
  function plannedOn(i, offset = 0) { return planEntry(planFor(offset)[i]); }
  function plannedFor(i) { return plannedOn(i, 0); }
  // a short label that survives a 48px column
  function planShort(t) {
    if (!t) return '—';
    if (t.rest) return 'Rest';
    const w = t.name.split(' ')[0];
    return w.length > 6 ? w.slice(0, 5) + '…' : w;
  }

  function openPlanPicker(dayIdx, offset = 0) {
    const current = planFor(offset)[dayIdx] || null;
    const moved = !!weekOverride(offset);
    /* Changing a day changes the usual week unless you say otherwise; moving
       one around is always just this week, because that is what moving means. */
    let justThis = moved;
    const rowFor = (id, name, sub) =>
      '<div class="lib-item ' + (current === id ? 'is-on' : '') + '" data-pick="' + esc(id) + '" role="button" tabindex="0">' +
        '<div><div class="li-name">' + esc(name) + '</div>' + (sub ? '<div class="li-sub">' + esc(sub) + '</div>' : '') + '</div>' +
        '<span class="li-best">' + (current === id ? '✓' : '') + '</span>' +
      '</div>';
    openSheet(DOW_LABELS[dayIdx] + (offset ? ' · ' + (offset > 0 ? 'in ' + offset + ' week' + (offset === 1 ? '' : 's') : Math.abs(offset) + ' week' + (offset === -1 ? '' : 's') + ' ago') : ''), '' +
      '<div class="seg" id="planScope">' +
        '<button data-scope="every" class="' + (justThis ? '' : 'is-on') + '">Every week</button>' +
        '<button data-scope="this" class="' + (justThis ? 'is-on' : '') + '">Just this week</button>' +
      '</div>' +
      '<div class="lib-group-title">Routine</div>' +
      allTemplates().map((t) => rowFor(t.id, t.name, t.exercises.length + ' exercises')).join('') +
      '<div class="lib-group-title">Other</div>' +
      rowFor('rest', 'Rest day', 'No session planned') +
      '<button class="btn btn-quiet" id="planClear" style="margin-top:10px">Leave empty</button>' +
      '<div class="lib-group-title">Move this week around</div>' +
      '<button class="btn btn-quiet" id="planPush">Rest here, push the rest back</button>' +
      '<button class="btn btn-quiet" id="planPull" style="margin-top:10px">Skip this day, pull the rest forward</button>' +
      (moved ? '<button class="btn btn-quiet" id="planReset" style="margin-top:10px">Back to the usual week</button>' : ''),
    (body) => {
      $$('#planScope button', body).forEach((b) => b.addEventListener('click', () => {
        justThis = b.dataset.scope === 'this';
        $$('#planScope button', body).forEach((x) => x.classList.toggle('is-on', x === b));
      }));
      const set = (val) => {
        if (justThis) {
          const days = planFor(offset).slice();
          days[dayIdx] = val;
          setWeekPlan(offset, days);
        } else {
          if (!Array.isArray(state.schedule)) state.schedule = EMPTY_WEEK();
          state.schedule[dayIdx] = val;
        }
        haptic('tick');
        save(); closeSheet(); render();
      };
      body.addEventListener('click', (e) => {
        const item = e.target.closest('[data-pick]');
        if (item) set(item.dataset.pick);
      });
      $('#planClear', body).addEventListener('click', () => set(null));

      /* Everything from here on slides a day later and a rest takes its place;
         whatever fell off the end of the week is gone, which is what happens
         when a week only has seven days in it. */
      $('#planPush', body).addEventListener('click', () => {
        const days = planFor(offset).slice();
        const dropped = days[6];
        for (let i = 6; i > dayIdx; i--) days[i] = days[i - 1];
        days[dayIdx] = 'rest';
        setWeekPlan(offset, days);
        haptic('tick');
        save(); closeSheet(); render();
        const name = planEntry(dropped);
        toast(name && !name.rest ? name.name + ' fell off the end of the week' : 'Pushed back — just this week');
      });
      $('#planPull', body).addEventListener('click', () => {
        const days = planFor(offset).slice();
        for (let i = dayIdx; i < 6; i++) days[i] = days[i + 1];
        days[6] = null;
        setWeekPlan(offset, days);
        haptic('tick');
        save(); closeSheet(); render();
        toast('Pulled forward — just this week');
      });
      $('#planReset', body)?.addEventListener('click', () => {
        clearWeekPlan(offset);
        haptic('tap');
        save(); closeSheet(); render();
        toast('Back to the usual week');
      });
    });
  }


  /* -------- quiet nudges: the app should notice when something slips -------- */
  function daysSince(ts) { return Math.floor((Date.now() - ts) / 864e5); }
  function lastWeighInDays() {
    const w = latestWeight();
    if (!w) return null;
    return daysSince(new Date(w.date + 'T12:00:00').getTime());
  }
  function lastSessionDays() {
    if (!state.workouts.length) return null;
    return daysSince(state.workouts[0].startedAt);
  }
  // a streak worth protecting that hasn't been kept today
  function streakAtRisk() {
    let best = null;
    for (const h of habitsList()) {
      if (!habitDueOn(h)) continue;
      if (habitDone(h, dateKey())) continue;
      const st = habitStreak(h);
      if (st >= 3 && (!best || st > best.streak)) best = { habit: h, streak: st };
    }
    return best;
  }

  /* -------- daily score, goal projection, day summary -------- */

  /* One number for a day: training 30, nutrition 30, habits 30, weigh-in 10.
     A planned rest day counts as training done — resting is part of the plan. */
  function dayScore(key) {
    const d = new Date(key + 'T12:00:00');
    const idx = (d.getDay() + 6) % 7;
    const planned = plannedFor(idx);
    const trained = state.workouts.some((w) => dateKey(new Date(w.startedAt)) === key);
    const t = state.nutrition.targets;
    const tot = dayTotals(key);
    const list = habitsList();
    const parts = {
      training: trained ? 30 : (planned && planned.rest ? 30 : 0),
      nutrition: 0,
      habits: (() => {
        const due = habitsDueOn(key);
        if (!due.length) return 30;                      // nothing was owed today
        return Math.round((due.filter((h) => habitDone(h, key)).length / due.length) * 30);
      })(),
      weight: weightOn(key) ? 10 : 0,
    };
    if (t.kcal && tot.kcal) {
      const ratio = tot.kcal / t.kcal;
      parts.nutrition += ratio >= 0.9 && ratio <= 1.1 ? 20 : ratio >= 0.75 && ratio <= 1.25 ? 10 : 0;
    }
    if (t.protein && tot.protein >= t.protein * 0.9) parts.nutrition += 10;
    const total = parts.training + parts.nutrition + parts.habits + parts.weight;
    return { total, parts, trained, planned };
  }

  /* What the ring is still waiting for. The score is out of 100 and the day
     rarely ends on a round number, so it helps to say which part is short
     rather than leave a gap in a circle. */
  function scoreGaps(key = dateKey()) {
    const sc = dayScore(key);
    const t = state.nutrition.targets;
    const tot = dayTotals(key);
    const gaps = [];
    if (sc.parts.training < 30) gaps.push(sc.planned && !sc.planned.rest ? esc(sc.planned.name) + ' not logged' : 'no session logged');
    if (t.kcal && !(tot.kcal / t.kcal >= 0.9 && tot.kcal / t.kcal <= 1.1)) {
      const off = Math.round(t.kcal - tot.kcal);
      gaps.push(off > 0 ? off.toLocaleString() + ' kcal short of the goal' : Math.abs(off).toLocaleString() + ' kcal past the goal');
    }
    if (t.protein && tot.protein < t.protein * 0.9) gaps.push(Math.round(t.protein - tot.protein) + ' g of protein to go');
    const due = habitsDueOn(key).filter((h) => !habitDone(h, key));
    if (due.length) gaps.push(due.length + ' habit' + (due.length === 1 ? '' : 's') + ' left');
    if (!weightOn(key)) gaps.push('no weigh-in today');
    return { score: sc, gaps };
  }

  /* where the goal weight lands at the current rate */
  function goalProjection() {
    const goal = state.settings.goalWeight;
    const lw = latestWeight();
    if (!goal || !lw) return null;
    const cutoff = dateKey(dayWithOffset(-30));
    const recent = state.nutrition.weights.filter((w) => w.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
    const togo = roundWeight(lw.value - goal);
    if (recent.length < 2) return { togo, rate: null };
    const first = recent[0], last = recent[recent.length - 1];
    const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 864e5);
    const rate = ((last.value - first.value) / days) * 7;         // kg per week
    const closing = (togo > 0 && rate < 0) || (togo < 0 && rate > 0);
    let eta = null;
    if (closing && Math.abs(rate) > 0.02) {
      const weeks = Math.abs(togo / rate);
      if (weeks < 130) {
        const d = new Date();
        d.setDate(d.getDate() + Math.round(weeks * 7));
        eta = d;
      }
    }
    return { togo, rate: Math.round(rate * 100) / 100, closing, eta };
  }

  /* everything that happened on one date */
  function openDaySummary(key) {
    const d = new Date(key + 'T12:00:00');
    const isToday = key === dateKey();
    const sc = dayScore(key);
    const sessions = state.workouts.filter((w) => dateKey(new Date(w.startedAt)) === key);
    const meals = mealsForDay(key);
    const tot = dayTotals(key);
    const t = state.nutrition.targets;
    const list = habitsList();
    const wt = weightOn(key);
    const line = (label, value) => '<div class="ds-line"><span>' + label + '</span><b>' + value + '</b></div>';

    openSheet(isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), '' +
      '<div class="ds-score"><div class="ds-num">' + sc.total + '<i>/100</i></div>' +
        '<div class="ds-bar"><div style="width:' + sc.total + '%"></div></div>' +
        '<div class="ds-parts">' +
          '<span>Training ' + sc.parts.training + '/30</span>' +
          '<span>Nutrition ' + sc.parts.nutrition + '/30</span>' +
          '<span>Habits ' + sc.parts.habits + '/30</span>' +
          '<span>Weigh-in ' + sc.parts.weight + '/10</span>' +
        '</div></div>' +

      '<div class="section-title">Training</div>' +
      (sessions.length
        ? sessions.map((w) => line(esc(w.name), loggedSets(w).length + ' sets · ' + Math.round(workoutVolume(w)).toLocaleString() + ' ' + esc(unit()))).join('')
        : '<p class="empty-note">' + (sc.planned && sc.planned.rest ? 'Planned rest day.' : sc.planned ? esc(sc.planned.name) + ' was planned.' : 'Nothing logged.') + '</p>') +

      '<div class="section-title">Nutrition</div>' +
      (meals.length
        ? line('Calories', Math.round(tot.kcal).toLocaleString() + ' / ' + t.kcal.toLocaleString()) +
          line('Protein', Math.round(tot.protein) + ' / ' + t.protein + ' g') +
          line('Carbs · Fat', Math.round(tot.carbs) + ' g · ' + Math.round(tot.fat) + ' g') +
          '<div class="ds-meals">' + meals.map((m) => '<span>' + esc(m.name) + '</span>').join('') + '</div>'
        : '<p class="empty-note">Nothing logged.</p>') +

      '<div class="section-title">Habits</div>' +
      (list.length
        ? list.map((h) => line(esc(h.name), habitDone(h, key) ? '✓' :
            (habitType(h) === 'check' ? '—' : habitShort(habitValue(h.id, key)) + ' / ' + habitShort(habitTarget(h))))).join('')
        : '<p class="empty-note">No habits yet.</p>') +

      (wt ? '<div class="section-title">Bodyweight</div>' + line('Logged', fmtNum(wt.value) + ' ' + esc(unit())) : ''));
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
    return roundWeight(last.value - ref.value);
  }

  const MEASURE_LABELS = { waist: 'Waist', chest: 'Chest', arm: 'Arm', thigh: 'Thigh', hips: 'Hips' };

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

  /* Where the week's work went. The app has always counted this and never
     said it: a muscle you have not touched in seven days is worth seeing
     before you plan the next session, not after. */
  function muscleBalanceHTML() {
    const counts = muscleSets7d();
    const groups = MUSCLE_GROUPS.filter((g) => g !== 'Cardio');
    const total = groups.reduce((t, g) => t + (counts[g] || 0), 0);
    if (!total) return '';
    const most = Math.max(...groups.map((g) => counts[g] || 0));
    return '<div class="card mb-card">' +
      '<div class="mb-head"><span class="micro">Sets this week</span>' +
        '<span class="wv-sub">' + total + ' working set' + (total === 1 ? '' : 's') + '</span></div>' +
      '<div class="mb-rows">' + groups.map((g) => {
        const n = counts[g] || 0;
        return '<div class="mb-row' + (n ? '' : ' is-none') + '">' +
          '<span class="mb-name">' + esc(g) + '</span>' +
          '<div class="mb-track"><div class="mb-fill" style="width:' + (most ? (n / most) * 100 : 0) + '%"></div></div>' +
          '<b class="mb-n">' + n + '</b></div>';
      }).join('') + '</div>' +
    '</div>';
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

  /* a record marker in the app's own line style, not a colour emoji */
  const prIcon = (cls = 'pr-mark') =>
    '<span class="' + cls + '" aria-label="Personal record">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M3.2 8.4l4.4 3.1L12 4.6l4.4 6.9 4.4-3.1-1.9 10.1H5.1Z"/>' +
      '</svg></span>';

  function toast(msg, html = false, action = null) {
    const root = $('#toastRoot');
    // one at a time: deleting a few things in a row used to stack a message
    // for each one until they filled the screen
    root.replaceChildren();
    const el = document.createElement('div');
    el.className = 'toast' + (html ? ' toast-rich' : '') + (action ? ' toast-action' : '');
    if (html) el.innerHTML = msg; else el.textContent = msg;
    let timer;
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-btn';
      b.textContent = action.label;
      b.addEventListener('click', () => { clearTimeout(timer); el.remove(); action.onClick(); });
      el.appendChild(b);
    }
    root.appendChild(el);
    timer = setTimeout(() => el.remove(), action ? 5200 : 2600);
  }

  /* Anything that throws work away offers it back for a few seconds. The
     snapshot is the whole document — it is small, and a partial one is how
     undo quietly restores half a thing. */
  function undoable(message, fn) {
    const before = JSON.stringify(state);
    fn();
    save();
    render();
    haptic('tap');
    toast(message, false, {
      label: 'Undo',
      onClick: () => {
        state = normalize(JSON.parse(before), defaultState());
        save();
        render();
        haptic('tick');
        toast('Put back');
      },
    });
  }

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
    armSheetDrag($('.sheet', root));
    if (!sheetHasEntry) { history.pushState({ t: 'sheet' }, ''); sheetHasEntry = true; }
    if (onMount) onMount(body);
  }

  /* The grab handle at the top of a sheet was decorative. It now drags: the
     sheet follows your thumb downwards and either flies out or springs back.
     Only the handle and the title bar start a drag, so a list inside the sheet
     still scrolls normally. */
  function armSheetDrag(sheet) {
    if (!sheet) return;
    const grip = [$('.sheet-grab', sheet), $('.sheet-head', sheet)].filter(Boolean);
    let startY = 0, dy = 0, dragging = false, startedAt = 0;
    const move = (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      claimGesture();
      sheet.style.transform = 'translateY(' + dy + 'px)';
      sheet.style.transition = 'none';
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      removeEventListener('touchmove', move);
      removeEventListener('touchend', end);
      const quick = Date.now() - startedAt < 350 && dy > 40;
      sheet.style.transition = '';
      if (dy > 110 || quick) {
        sheet.style.transform = 'translateY(110%)';
        haptic('tap');
        setTimeout(closeSheet, 130);
      } else {
        sheet.style.transform = '';
      }
    };
    grip.forEach((g) => g.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || e.target.closest('button')) return;
      dragging = true; startY = e.touches[0].clientY; dy = 0; startedAt = Date.now();
      addEventListener('touchmove', move, { passive: true });
      addEventListener('touchend', end, { passive: true });
    }, { passive: true }));
  }

  /* Press and hold. Cancels the moment the thumb travels, so it never fires
     while you are scrolling a list. */
  function longPress(el, fn) {
    let timer = null, sx = 0, sy = 0, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      fired = false;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(() => { fired = true; haptic('tick'); fn(e.target); }, 480);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!timer) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) cancel();
    }, { passive: true });
    el.addEventListener('touchend', cancel, { passive: true });
    el.addEventListener('touchcancel', cancel, { passive: true });
    // a hold with a mouse works too, and keeps the desktop tests honest
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); haptic('tick'); fn(e.target); });
    return () => fired;
  }

  /* Swipe a row to the left to delete it. The row follows the thumb, and the
     delete goes through the same undo as the button does. */
  function swipeToDelete(row, onDelete) {
    let sx = 0, sy = 0, dx = 0, live = false;
    row.dataset.swipeOwn = '';
    row.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; live = true;
      row.style.transition = 'none';
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (!live) return;
      const t = e.touches[0];
      const ax = t.clientX - sx, ay = t.clientY - sy;
      if (Math.abs(ay) > Math.abs(ax)) { live = false; row.style.transform = ''; return; }
      if (Math.abs(ax) > 8) claimGesture();     // this drag is the row's, not the tab bar's
      dx = Math.min(0, ax);
      row.style.transform = 'translateX(' + dx + 'px)';
      row.classList.toggle('swipe-armed', dx < -80);
    }, { passive: true });
    row.addEventListener('touchend', () => {
      if (!live) return;
      live = false;
      row.style.transition = '';
      row.classList.remove('swipe-armed');
      if (dx < -80) { row.style.transform = 'translateX(-110%)'; onDelete(); }
      else row.style.transform = '';
    }, { passive: true });
  }
  /* Every destructive action asks here rather than through window.confirm,
     which renders as an unstyled system box titled with the domain name.
     onCancel lets a caller restore the sheet this one replaced. */
  function confirmAction({ title, message, confirm: label, danger = true, onConfirm, onCancel }) {
    openSheet(title, '' +
      '<p class="confirm-msg">' + esc(message) + '</p>' +
      '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="cfYes">' + esc(label) + '</button>' +
      '<button class="btn btn-quiet" id="cfNo" style="margin-top:10px">Cancel</button>',
    (body) => {
      $('#cfYes', body).addEventListener('click', () => { haptic(danger ? 'warn' : 'tap'); closeSheet(); onConfirm(); });
      $('#cfNo', body).addEventListener('click', () => {
        if (onCancel) { closeSheetNow(); onCancel(); } else closeSheet();
      });
    });
  }

  function closeSheetNow() { $('#sheetRoot').innerHTML = ''; }
  function closeSheet() {
    closeSheetNow();
    /* history.back() lands asynchronously. If a caller closes one sheet and
       opens another in the same tick — a confirmation that reopens settings,
       say — the pushState would be swallowed by the pending back(), leaving
       the layer count one short and the next back press walking out of the
       app. So only give the entry back once nothing has reopened. */
    queueMicrotask(() => {
      if ($('#sheetRoot').children.length) return;
      if (sheetHasEntry) { sheetHasEntry = false; skipPop++; history.back(); }
    });
  }

  /* ---------------- screen wake lock ----------------
     Phones lock while you rest, and a locked screen freezes the timer. Hold a
     wake lock for as long as the logger is open. */

  let wakeLock = null;
  async function holdWakeLock() {
    if (state.settings.keepAwake === false || !('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { wakeLock = null; }
  }
  function dropWakeLock() {
    if (!wakeLock) return;
    const l = wakeLock; wakeLock = null;
    l.release().catch(() => {});
  }
  /* ---------- full screen ----------
     The thin grey line under the status bar is drawn by the browser between
     the system bar and the page — nothing the app paints reaches it. Going
     full screen removes the bar, and the line with it. Android only grants
     this off a gesture, so a stored preference is re-applied on the first
     touch after the app opens. */
  function requestFullBleed() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  function exitFullBleed() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
  function armFullBleed() {
    if (!state.settings.fullscreen) return;
    const go = () => { requestFullBleed(); removeEventListener('pointerdown', go); };
    addEventListener('pointerdown', go);
  }

  function syncWakeLock() {
    if (state.activeWorkout && workoutOpen) holdWakeLock(); else dropWakeLock();
  }
  // the browser drops the lock whenever the page is hidden, so take it again
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncWakeLock();
  });

  /* ---------------- haptics ----------------
     One place for every buzz, so they stay in the same family and can be
     turned off in one switch. Anything the phone does not support is a no-op. */
  const BUZZ = {
    tap: 10,                        // a value changed under your thumb
    tick: 18,                       // something was completed
    done: [14, 40, 24],             // a whole thing finished — workout, day
    warn: [30, 60, 30],             // something was deleted or discarded
    alert: [200, 100, 200],         // rest is over, look at me
    pr: [25, 45, 25, 45, 120],      // a record
  };
  function haptic(kind = 'tap') {
    if (state.settings.haptics === false || !navigator.vibrate) return;
    try { navigator.vibrate(BUZZ[kind] || BUZZ.tap); } catch (e) { /* some browsers refuse */ }
  }

  /* ---------------- CSV ----------------
     The JSON backup is for putting this app back together. A spreadsheet —
     or the B.E.L.A app on a PC — wants rows, so the same data comes out flat
     as well: one line per set, per meal, per habit and day. */

  function toCsv(header, rows) {
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  function downloadFile(name, text, type = 'text/csv') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function workoutsCsv() {
    const rows = [];
    [...state.workouts].reverse().forEach((w) => {
      const d = new Date(w.startedAt);
      w.exercises.forEach((ex) => {
        const info = exerciseById(ex.exerciseId);
        const cardio = isCardio(ex.exerciseId);
        ex.sets.forEach((s, i) => {
          if (!s.done) return;
          /* A treadmill set keeps minutes where a barbell keeps reps and
             kilometres where it keeps kilos. Writing those out under "weight
             (kg)" and calling their product volume was a lie in a file meant
             to be read by something else. */
          rows.push([
            dateKey(d), d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
            w.name, info?.name ?? ex.exerciseId, info?.muscle ?? '', info?.equipment ?? '',
            i + 1, s.type || 'N',
            cardio ? '' : (s.weight ?? ''), cardio ? '' : unit(),
            cardio ? '' : (s.reps ?? ''),
            cardio ? (s.reps ?? '') : '',
            cardio ? (s.weight ?? '') : '',
            cardio ? (s.kmh ?? '') : '',
            cardio ? (s.incl ?? '') : '',
            s.rpe ?? '', s.pr ? 'yes' : '',
            cardio ? '' : Math.round((Number(s.weight) || 0) * (Number(s.reps) || 0)),
            w.note || '',
          ]);
        });
      });
    });
    return toCsv(['date', 'time', 'workout', 'exercise', 'muscle', 'equipment', 'set', 'type',
      'weight', 'unit', 'reps', 'minutes', 'km', 'kmh', 'incline_pct', 'rpe', 'record', 'volume', 'note'], rows);
  }

  function mealsCsv() {
    const rows = [...state.nutrition.meals]
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
      .map((m) => [m.date, m.slot || '', m.time || '', m.name,
        Math.round(m.kcal || 0), round1(m.protein || 0), round1(m.carbs || 0), round1(m.fat || 0),
        m.amount ?? '', m.base ? m.base.unit : '']);
    return toCsv(['date', 'meal', 'time', 'food', 'kcal', 'protein', 'carbs', 'fat', 'amount', 'unit'], rows);
  }

  function bodyCsv() {
    const rows = [...state.nutrition.weights]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => [w.date, round1(w.value), unit()]);
    (state.nutrition.measurements || []).forEach((m) => rows.push([m.date, round1(m.value), m.name || 'measurement']));
    return toCsv(['date', 'value', 'what'], rows);
  }

  function habitsCsv() {
    const rows = [];
    const log = state.habitLog || {};
    Object.keys(log).sort().forEach((day) => {
      habitsList().forEach((h) => {
        const value = habitValue(h.id, day);
        if (!value && !habitDueOn(h, day)) return;
        rows.push([day, h.name, value, habitTarget(h), habitUnit(h) || '',
          habitDueOn(h, day) ? 'yes' : 'no', habitDone(h, day) ? 'yes' : 'no']);
      });
    });
    return toCsv(['date', 'habit', 'value', 'target', 'unit', 'due', 'done'], rows);
  }

  function openCsvSheet() {
    const files = [
      ['workouts', 'Workouts', 'one row per logged set', workoutsCsv],
      ['meals', 'Meals', 'one row per food logged', mealsCsv],
      ['bodyweight', 'Bodyweight', 'every weigh-in and measurement', bodyCsv],
      ['habits', 'Habits', 'one row per habit per day', habitsCsv],
    ];
    openSheet('Export as CSV', '' +
      '<p class="confirm-msg">Rows a spreadsheet can read. The JSON backup is still the one to use for restoring the app.</p>' +
      '<div class="menu-list">' +
        files.map(([id, name, sub]) => '<button class="menu-item csv-item" data-csv="' + id + '">' +
          '<span><b>' + name + '</b><i>' + sub + '</i></span></button>').join('') +
      '</div>',
    (body) => {
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-csv]');
        if (!b) return;
        const file = files.find((f) => f[0] === b.dataset.csv);
        if (!file) return;
        const text = file[3]();
        const lines = text.trim().split('\r\n').length - 1;
        if (!lines) { toast('Nothing logged there yet'); return; }
        downloadFile('bela-' + file[0] + '-' + dateKey() + '.csv', text);
        haptic('tick');
        toast(lines + (lines === 1 ? ' row saved' : ' rows saved'));
      });
    });
  }

  /* ---------------- first run ----------------
     A fresh install knows nothing: no name, no weight, no targets, no plan,
     and every screen shows zeroes. Three short steps fix that, and it never
     appears again — Settings keeps a way back to it. */

  let setupStep = 0;
  const setupDraft = {};

  function needsSetup() {
    const s = state.settings;
    if (s.setupDone) return false;
    // anything already logged means this is not a fresh install
    return !s.name && !state.workouts.length && !state.nutrition.meals.length && !state.nutrition.weights.length;
  }

  /* Rough, honest starting points rather than blanks: about 31 kcal per kg,
     2 g of protein and 0.9 g of fat per kg, carbohydrate takes the rest. */
  function suggestTargets(weightKg) {
    const w = Number(weightKg) || 75;
    const kcal = Math.round((w * 31) / 50) * 50;
    const protein = Math.round(w * 2);
    const fat = Math.round(w * 0.9);
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, carbs, fat };
  }

  const SETUP_SPLITS = [
    { id: 'none', name: 'Not yet', sub: 'Set it later', days: [] },
    { id: 'full', name: 'Full body', sub: '3 days · Mon, Wed, Fri', days: [['tpl-full', 0], ['tpl-full', 2], ['tpl-full', 4]] },
    { id: 'ppl', name: 'Push · Pull · Legs', sub: '3 days · Mon, Wed, Fri',
      days: [['tpl-push', 0], ['tpl-pull', 2], ['tpl-legs', 4]] },
    { id: 'ppl6', name: 'Push · Pull · Legs ×2', sub: '6 days · Mon to Sat',
      days: [['tpl-push', 0], ['tpl-pull', 1], ['tpl-legs', 2], ['tpl-push', 3], ['tpl-pull', 4], ['tpl-legs', 5]] },
    { id: 'ul', name: 'Upper · Lower', sub: '4 days · Mon, Tue, Thu, Fri',
      days: [['tpl-push', 0], ['tpl-legs', 1], ['tpl-pull', 3], ['tpl-legs', 4]] },
  ];

  function openSetup() {
    setupStep = 0;
    Object.assign(setupDraft, {
      name: state.settings.name || '',
      unit: state.settings.unit || 'kg',
      weight: '',
      goal: '',
      split: 'none',
      ...suggestTargets(75),
      touchedTargets: false,
    });
    paintSetup();
  }

  function setupSaveAndClose() {
    const s = state.settings;
    s.name = String(setupDraft.name || '').trim();
    s.unit = setupDraft.unit;
    s.setupDone = true;
    const w = Number(setupDraft.weight);
    if (w > 0) {
      const today = dateKey();
      state.nutrition.weights = state.nutrition.weights.filter((x) => x.date !== today);
      state.nutrition.weights.push({ date: today, value: roundWeight(w) });
    }
    const goal = Number(setupDraft.goal);
    if (goal > 0) s.goalWeight = roundWeight(goal);
    state.nutrition.targets = {
      kcal: Math.max(0, Math.round(Number(setupDraft.kcal) || 0)),
      protein: Math.max(0, Math.round(Number(setupDraft.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(setupDraft.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(setupDraft.fat) || 0)),
    };
    const split = SETUP_SPLITS.find((x) => x.id === setupDraft.split);
    if (split && split.days.length) {
      const week = [null, null, null, null, null, null, null];
      split.days.forEach(([tpl, i]) => { week[i] = tpl; });
      // the days it does not cover are rest days, so habits know the difference
      state.schedule = week.map((x) => x || 'rest');
    }
    save();
    closeSheet();
    render();
    haptic('done');
    toast(s.name ? 'Ready, ' + s.name : 'Ready');
  }

  function skipSetup() {
    state.settings.setupDone = true;
    save();
    closeSheet();
  }

  function paintSetup() {
    const u = setupDraft.unit;
    const dots = '<div class="su-dots">' + [0, 1, 2].map((i) =>
      '<span class="' + (i === setupStep ? 'on' : '') + '"></span>').join('') + '</div>';

    const step1 = '' +
      '<p class="confirm-msg">A few things and the app is yours. All of it can be changed later.</p>' +
      '<div class="field"><label for="suName">What should it call you?</label>' +
        '<input id="suName" type="text" autocomplete="given-name" placeholder="Your name" value="' + esc(setupDraft.name) + '"></div>' +
      '<div class="field"><label>Weights in</label>' +
        '<div class="seg" id="suUnit">' +
          ['kg', 'lb'].map((k) => '<button data-u="' + k + '" class="' + (k === u ? 'is-on' : '') + '">' + k + '</button>').join('') +
        '</div></div>' +
      '<div class="field"><label for="suWeight">What do you weigh now? (' + u + ')</label>' +
        '<input id="suWeight" type="number" inputmode="decimal" min="0" step="' + WEIGHT_STEP + '" placeholder="' + (u === 'kg' ? '78.5' : '173') + '" value="' + esc(setupDraft.weight) + '"></div>';

    const step2 = '' +
      '<p class="confirm-msg">Where you are heading, and what a day should look like.</p>' +
      '<div class="field"><label for="suGoal">Goal weight (' + u + ')</label>' +
        '<input id="suGoal" type="number" inputmode="decimal" min="0" step="' + WEIGHT_STEP + '" placeholder="optional" value="' + esc(setupDraft.goal) + '"></div>' +
      '<p class="su-note" id="suNote">Worked out from your weight — change anything that looks wrong.</p>' +
      '<div class="macro-fields">' +
        '<div class="field"><label for="suKcal">Calories</label><input id="suKcal" type="number" inputmode="numeric" min="0" value="' + setupDraft.kcal + '"></div>' +
        '<div class="field"><label for="suProtein">Protein</label><input id="suProtein" type="number" inputmode="numeric" min="0" value="' + setupDraft.protein + '"></div>' +
        '<div class="field"><label for="suCarbs">Carbs</label><input id="suCarbs" type="number" inputmode="numeric" min="0" value="' + setupDraft.carbs + '"></div>' +
        '<div class="field"><label for="suFat">Fat</label><input id="suFat" type="number" inputmode="numeric" min="0" value="' + setupDraft.fat + '"></div>' +
      '</div>';

    const step3 = '' +
      '<p class="confirm-msg">Pick a week and the plan fills itself in. Any day can be changed on the Workouts page.</p>' +
      '<div class="su-splits" id="suSplits">' +
        SETUP_SPLITS.map((s) => '<button class="su-split ' + (s.id === setupDraft.split ? 'is-on' : '') + '" data-split="' + s.id + '">' +
          '<b>' + esc(s.name) + '</b><i>' + esc(s.sub) + '</i></button>').join('') +
      '</div>';

    const body = [step1, step2, step3][setupStep] + dots +
      '<button class="btn btn-primary" id="suNext" style="margin-top:14px">' + (setupStep === 2 ? 'Start' : 'Next') + '</button>' +
      (setupStep === 0
        ? '<button class="btn btn-quiet" id="suSkip" style="margin-top:10px">Skip for now</button>'
        : '<button class="btn btn-quiet" id="suBack" style="margin-top:10px">Back</button>');

    openSheet(['Welcome', 'Your day', 'Your week'][setupStep], body, (el) => {
      if (setupStep === 0) {
        $('#suName', el).addEventListener('input', (e) => { setupDraft.name = e.target.value; });
        $('#suWeight', el).addEventListener('input', (e) => { setupDraft.weight = e.target.value; });
        $$('#suUnit button', el).forEach((b) => b.addEventListener('click', () => {
          setupDraft.unit = b.dataset.u;
          $$('#suUnit button', el).forEach((x) => x.classList.toggle('is-on', x === b));
          paintSetup();          // the labels carry the unit, so redraw the step
        }));
        $('#suSkip', el).addEventListener('click', skipSetup);
      } else if (setupStep === 1) {
        $('#suGoal', el).addEventListener('input', (e) => { setupDraft.goal = e.target.value; });
        ['kcal', 'protein', 'carbs', 'fat'].forEach((k) => {
          const id = '#su' + k.charAt(0).toUpperCase() + k.slice(1);
          $(id, el).addEventListener('input', (e) => { setupDraft[k] = e.target.value; setupDraft.touchedTargets = true; });
        });
      } else {
        $$('#suSplits .su-split', el).forEach((b) => b.addEventListener('click', () => {
          setupDraft.split = b.dataset.split;
          $$('#suSplits .su-split', el).forEach((x) => x.classList.toggle('is-on', x === b));
          haptic('tap');
        }));
      }
      const back = $('#suBack', el);
      if (back) back.addEventListener('click', () => { setupStep -= 1; paintSetup(); });
      $('#suNext', el).addEventListener('click', () => {
        if (setupStep === 0 && !setupDraft.touchedTargets) {
          // the suggestion follows the weight until it is edited by hand
          const kg = setupDraft.unit === 'kg' ? Number(setupDraft.weight) : Number(setupDraft.weight) / LB_PER_KG;
          Object.assign(setupDraft, suggestTargets(kg || 75));
        }
        if (setupStep === 2) { setupSaveAndClose(); return; }
        setupStep += 1;
        paintSetup();
      });
    });
  }

  /* ---------------- native shell ----------------
     The same code runs as a web app and, wrapped in Capacitor, as an installed
     Android app. Where the browser is limited — a notification that cannot be
     marked ongoing, and one that always carries the address it came from — the
     native build uses Android's own, and everything else is identical. */

  const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const nativePlugin = (name) => (window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null);
  const WK_NOTE_ID = 8801;

  async function nativeNotifyAllowed() {
    const LN = nativePlugin('LocalNotifications');
    if (!LN) return false;
    try {
      const now = await LN.checkPermissions();
      if (now.display === 'granted') return true;
      const asked = await LN.requestPermissions();
      return asked.display === 'granted';
    } catch (e) { return false; }
  }

  async function nativeShowWorkoutNote(lines) {
    const LN = nativePlugin('LocalNotifications');
    if (!LN) return;
    try {
      await LN.schedule({
        notifications: [{
          id: WK_NOTE_ID,
          title: lines.title,
          body: lines.body,
          ongoing: true,          // Android will not let it be swiped away
          autoCancel: false,
          smallIcon: 'ic_stat_bela',
          channelId: 'workout',
        }],
      });
    } catch (e) { /* the shell may be older than the plugin */ }
  }

  async function nativeClearWorkoutNote() {
    const LN = nativePlugin('LocalNotifications');
    if (!LN) return;
    try { await LN.cancel({ notifications: [{ id: WK_NOTE_ID }] }); } catch (e) { /* nothing posted */ }
  }

  /* A quiet channel, so the notification never makes a sound or a heads-up
     banner — it is a status line, not an alert. */
  async function nativeChannel() {
    const LN = nativePlugin('LocalNotifications');
    if (!LN || !LN.createChannel) return;
    try {
      await LN.createChannel({
        id: 'workout', name: 'Workout in progress',
        description: 'Shows the exercise and set while a session is running',
        importance: 2, visibility: 1, sound: '', vibration: false,
      });
    } catch (e) { /* channels are Android-only */ }
  }
  if (native()) nativeChannel();

  /* Android's back gesture. Without this the shell closes the app on the
     first swipe, which would end a session you are in the middle of. Instead
     it walks back through the layers the app already pushed, and at the top
     it puts the app in the background the way every other app does — the
     workout keeps running. */
  if (native()) {
    const App = nativePlugin('App');
    if (App && App.addListener) {
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) history.back();
        else if (App.minimizeApp) App.minimizeApp();
      });
    }
  }

  /* ---------------- sync with the PC app ----------------
     Both copies hold the whole document and both run the same merge (js/sync.js),
     so a sync is one round trip: send what this phone has, the PC merges it with
     what it has, and sends back the answer. Nothing is uploaded anywhere — it
     goes straight across your own network to your own machine.

     The address and the pairing code are deliberately kept out of the document:
     they belong to this device, and syncing them would mean the PC could
     overwrite the phone's idea of where the PC is. */

  const SYNC_CFG_KEY = 'bela-sync-pc';
  const SYNC_PORT = 8765;

  function pcCfg() {
    try { return { host: '', code: '', ...(JSON.parse(localStorage.getItem(SYNC_CFG_KEY)) || {}) }; }
    catch (e) { return { host: '', code: '' }; }
  }
  function pcCfgSave(patch) {
    const next = { ...pcCfg(), ...patch };
    try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(next)); } catch (e) { /* full */ }
    return next;
  }
  /* "192.168.1.20", "192.168.1.20:9000" and a full address all mean the same
     thing to someone typing it in a hurry. */
  function pcBase(host) {
    let h = String(host || '').trim().replace(/\/+$/, '');
    if (!h) return '';
    if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
    if (!/:\d+$/.test(h.replace(/^https?:\/\//i, ''))) h += ':' + SYNC_PORT;
    return h;
  }
  /* A page served over https cannot talk to a plain-http machine on your
     network — the browser blocks it before it leaves. The installed app can,
     which is the whole reason it exists. */
  function pcReachable() {
    if (native()) return true;
    return location.protocol !== 'https:';
  }

  async function pcFetch(path, init, ms = 12000) {
    const cfg = pcCfg();
    const base = pcBase(cfg.host);
    if (!base) throw new Error('No address set');
    const ctrl = new AbortController();
    const bell = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(base + path, {
        ...init,
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-bela-code': cfg.code || '', ...(init && init.headers) },
      });
    } finally { clearTimeout(bell); }
  }

  async function pcPing() {
    const res = await pcFetch('/bela/ping', { method: 'GET' }, 6000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.app !== 'bela') throw new Error('Something else is answering on that port');
    return data;
  }

  let syncing = false;
  let syncAt = 0;
  async function syncNow(opts = {}) {
    const quiet = !!opts.quiet;
    const cfg = pcCfg();
    if (!cfg.host) { if (!quiet) toast('Set the PC address first'); return false; }
    if (!pcReachable()) {
      if (!quiet) toast('The website cannot reach your PC — use the installed app');
      return false;
    }
    if (syncing) return false;
    syncing = true;
    renderSyncState();
    try {
      const res = await pcFetch('/bela/sync', {
        method: 'POST',
        body: JSON.stringify({
          protocol: BelaSync.PROTOCOL,
          device: BelaSync.meta(state).device,
          doc: BelaSync.outgoing(state),
        }),
      }, 20000);
      if (res.status === 401 || res.status === 403) throw new Error('The pairing code does not match');
      if (!res.ok) throw new Error('The PC answered ' + res.status);
      const data = await res.json();
      if (!data || !data.doc) throw new Error('The PC sent nothing back');

      const live = state.activeWorkout;
      const me = BelaSync.meta(state).device;
      state = normalize(data.doc, defaultState());
      state.activeWorkout = live;          // a session in your hand is not up for merging
      BelaSync.meta(state).device = me;    // the merged document arrives wearing the PC's name
      syncShadow = BelaSync.snapshot(state);
      save();
      syncAt = Date.now();
      const t = data.tally || {};
      pcCfgSave({ last: syncAt, lastNote: describeTally(t) });
      applyTheme();
      render();
      renderSyncState();
      if (!quiet) toast(describeTally(t));
      return true;
    } catch (err) {
      const raw = String(err && err.message || err);
      /* "Failed to fetch" is what a browser says for everything from the wrong
         address to the PC being asleep. Say the useful version of it. */
      const why = raw === 'Failed to fetch' || /abort|timed? ?out|network/i.test(raw)
        ? 'Could not reach the PC — is B.E.L.A open on it and on the same Wi-Fi?'
        : raw;
      pcCfgSave({ lastError: why, lastErrorAt: Date.now() });
      if (!quiet) toast(why);
      renderSyncState();
      return false;
    } finally {
      syncing = false;
      renderSyncState();
    }
  }
  function describeTally(t) {
    const bits = [];
    if (t.added) bits.push(t.added + ' new');
    if (t.updated) bits.push(t.updated + ' updated');
    if (t.removed) bits.push(t.removed + ' removed');
    return bits.length ? 'Synced — ' + bits.join(', ') : 'Synced — already the same';
  }

  /* Sync when the app comes back to the front, but not more than once a
     minute, and never while a set is being logged. */
  function syncIfIdle() {
    const cfg = pcCfg();
    if (!cfg.host || !cfg.auto) return;
    if (Date.now() - syncAt < 60000) return;
    if (state.activeWorkout) return;
    syncNow({ quiet: true });
  }
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncIfIdle();
  });

  /* The screen where you point the phone at the PC. */
  function openPcSync() {
    const cfg = pcCfg();
    openSheet('Sync with the PC app', `
      <p class="muted" style="margin-top:0">Your PC and your phone keep the same
      workouts, meals and habits. Nothing goes to the internet — the phone talks
      straight to your computer over your own Wi-Fi.</p>
      <div class="field">
        <label for="pcHost">PC address</label>
        <input id="pcHost" type="text" inputmode="url" autocapitalize="off" autocorrect="off"
               spellcheck="false" placeholder="192.168.1.20" value="${esc(cfg.host || '')}">
        <i class="field-hint">B.E.L.A on the PC shows this on its sync screen. Port ${SYNC_PORT} unless you say otherwise.</i>
      </div>
      <div class="field">
        <label for="pcCode">Pairing code</label>
        <input id="pcCode" type="text" inputmode="numeric" autocapitalize="off" autocorrect="off"
               spellcheck="false" placeholder="6 digits" value="${esc(cfg.code || '')}">
      </div>
      <label class="switch-row">
        <span><b>Sync on its own</b><i>Whenever you open the app, if the PC is there</i></span>
        <input type="checkbox" id="pcAuto" ${cfg.auto ? 'checked' : ''}>
      </label>
      <div class="note-state" id="pcState"><span id="pcWhy">…</span></div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-quiet" id="pcTest">Test connection</button>
        <button class="btn btn-primary" id="pcSync">Sync now</button>
      </div>
      <p class="muted" style="margin-top:14px">If a workout is running it stays on
      this phone until you finish it — nothing half-logged gets sent.</p>
    `, (body) => {
      const host = $('#pcHost', body), code = $('#pcCode', body);
      host.addEventListener('change', () => { pcCfgSave({ host: host.value.trim() }); renderSyncState(); });
      code.addEventListener('change', () => { pcCfgSave({ code: code.value.trim() }); renderSyncState(); });
      $('#pcAuto', body).addEventListener('change', (e) => pcCfgSave({ auto: e.target.checked }));
      $('#pcTest', body).addEventListener('click', async () => {
        pcCfgSave({ host: host.value.trim(), code: code.value.trim() });
        const why = $('#pcWhy', body);
        why.textContent = 'Looking for it…';
        try {
          const info = await pcPing();
          why.textContent = 'Found ' + (info.name || 'your PC') + '.';
          haptic('tick');
        } catch (err) {
          why.textContent = !pcReachable()
            ? 'The website cannot reach your PC. Install the app (see BUILD-ANDROID.md) and it will.'
            : 'No answer. Check B.E.L.A is open on the PC, that its sync is on, and that both are on the same Wi-Fi.';
        }
      });
      $('#pcSync', body).addEventListener('click', () => {
        pcCfgSave({ host: host.value.trim(), code: code.value.trim() });
        syncNow();
      });
      renderSyncState();
    });
  }
  /* The one line under the buttons that says where things stand. */
  function renderSyncState() {
    const why = document.querySelector('#pcWhy');
    if (!why) return;
    const cfg = pcCfg();
    if (syncing) { why.textContent = 'Syncing…'; return; }
    if (!cfg.host) { why.textContent = 'No PC set yet.'; return; }
    if (!pcReachable()) { why.textContent = 'The website cannot reach your PC — the installed app can.'; return; }
    if (cfg.lastError && (!cfg.last || cfg.lastErrorAt > cfg.last)) { why.textContent = 'Last try: ' + cfg.lastError; return; }
    if (cfg.last) { why.textContent = 'Last synced ' + fmtAgo(cfg.last) + (cfg.lastNote ? ' · ' + cfg.lastNote.replace(/^Synced — /, '') : '') + '.'; return; }
    why.textContent = 'Never synced yet.';
  }
  function fmtAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return fmtShortDate(ts);
  }

  /* ---------------- workout notification ----------------
     A live session posts a notification that says where you are, the way a
     gym app should — it survives switching apps and taps back into the
     logger. A browser cannot hold a foreground service, so it is a normal
     silent notification kept up to date while the app is alive, and cleared
     the moment the workout ends. */

  const WK_NOTE_TAG = 'bela-workout';
  let wkNoteAt = 0;
  let wkNoteText = '';

  function wkNoteReady() {
    if (!state.settings.wkNotify) return false;
    if (native()) return !!nativePlugin('LocalNotifications');
    return 'Notification' in window && Notification.permission === 'granted' && !!navigator.serviceWorker;
  }
  /* Android's collapsed notification gives you one line of title and one of
     body, so the exercise leads and everything else fits on the second line.
     A title like "Workout · 0 min" spent the whole line saying nothing and
     still got cut off. */
  function wkNoteLines() {
    const w = state.activeWorkout;
    if (!w) return null;
    const current = w.exercises.find((ex) => ex.sets.some((s) => !s.done));
    if (!current) {
      const done = loggedSets(w).length;
      return {
        title: w.name,
        body: done ? done + (done === 1 ? ' set done' : ' sets done') : 'Nothing logged yet',
      };
    }
    const idx = current.sets.findIndex((s) => !s.done);
    const set = current.sets[idx];
    const bits = ['Set ' + (idx + 1) + '/' + current.sets.length];
    // whatever is in the box, typed or carried over from last time
    const weight = set.weight ?? previousSets(current.exerciseId)[idx]?.weight;
    const reps = set.reps ?? previousSets(current.exerciseId)[idx]?.reps;
    if (weight) bits.push(fmtNum(weight) + ' ' + unit() + (reps ? ' × ' + reps : ''));
    return {
      title: exerciseById(current.exerciseId)?.name ?? w.name,
      body: bits.join('  ·  '),
    };
  }
  function showWorkoutNote(force = false) {
    if (!wkNoteReady() || !state.activeWorkout) return;
    const lines = wkNoteLines();
    if (!lines) return;
    // rewrite it whenever anything it shows changes — the clock included, so
    // the minute on it keeps up rather than freezing where you left the app
    const text = lines.title + '|' + lines.body;
    const changed = text !== wkNoteText;
    if (!force && !changed) { restoreWorkoutNote(); return; }
    if (!force && Date.now() - wkNoteAt < 600) return;
    wkNoteAt = Date.now();
    wkNoteText = text;
    if (native()) { nativeShowWorkoutNote(lines); return; }
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(lines.title, {
      body: lines.body,
      tag: WK_NOTE_TAG,
      renotify: false,
      silent: true,
      requireInteraction: true,
      /* The large icon is the picture on One UI's right-hand side. Leaving it
         out does not leave it empty — Android draws a letter avatar from the
         address instead — so it is a transparent image, which draws nothing.
         The mark is on the left, as the badge. */
      icon: 'icons/blank-192.png?v=' + APP_VERSION,
      badge: 'icons/badge-96.png?v=' + APP_VERSION,
      data: { kind: 'workout' },
    })).catch(() => { /* the browser may refuse: nothing else to do */ });
  }
  /* A web notification cannot be marked ongoing the way a native one can, so
     it can always be swiped away. If it goes while a session is still running,
     put it back — checked on the same beat that moves the clock, and no more
     often than every few seconds. */
  let wkNoteChecked = 0;
  function restoreWorkoutNote() {
    if (!wkNoteReady() || !state.activeWorkout) return;
    if (native()) return;      // Android keeps an ongoing notification itself
    if (Date.now() - wkNoteChecked < 4000) return;
    wkNoteChecked = Date.now();
    navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications({ tag: WK_NOTE_TAG }))
      .then((list) => { if (!list.length) showWorkoutNote(true); })
      .catch(() => { /* nothing to restore it from */ });
  }

  function clearWorkoutNote() {
    wkNoteText = '';
    if (native()) { nativeClearWorkoutNote(); return; }
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications({ tag: WK_NOTE_TAG }))
      .then((list) => list.forEach((n) => n.close()))
      .catch(() => { /* nothing to clear */ });
  }
  function syncWorkoutNote(force = false) {
    if (state.activeWorkout) showWorkoutNote(force); else clearWorkoutNote();
  }
  /* Nothing is running yet, so show what one looks like and take it away
     again — otherwise turning the switch on appears to do nothing at all. */
  function sampleWorkoutNote() {
    if (native()) {
      nativeShowWorkoutNote({ title: 'Barbell Bench Press', body: 'Set 1/3  ·  80 kg × 8' });
      toast('That is how a session will look');
      setTimeout(nativeClearWorkoutNote, 7000);
      return;
    }
    if (!('serviceWorker' in navigator)) { toast('This browser cannot show notifications'); return; }
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification('Barbell Bench Press', {
        body: 'Set 1/3  ·  80 kg × 8  ·  0 min',
        tag: 'bela-sample',
        silent: true,
        icon: 'icons/blank-192.png?v=' + APP_VERSION,
        badge: 'icons/badge-96.png?v=' + APP_VERSION,
      });
      toast('That is how a session will look');
      setTimeout(() => reg.getNotifications({ tag: 'bela-sample' }).then((l) => l.forEach((n) => n.close())), 7000);
    }).catch(() => toast('The browser would not show it'));
  }

  async function askWorkoutNotify() {
    if (native()) return nativeNotifyAllowed();
    if (!('Notification' in window)) { toast('This phone cannot show notifications'); return false; }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') { toast('Notifications are blocked for this app in Android settings'); return false; }
    const res = await Notification.requestPermission();
    if (res !== 'granted') { toast('Not allowed — nothing will be shown'); return false; }
    return true;
  }
  // going away is exactly when the notification earns its keep
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncWorkoutNote(true);
  });

  /* ---------------- workout elapsed clock ---------------- */

  let elapsedTimer = null;
  function tickElapsed() {
    if (!state.activeWorkout) return;
    // a notification's text is fixed once posted: the only way its clock moves
    // is to post it again, which happens as the minute turns over
    showWorkoutNote();
    const txt = fmtElapsed(Date.now() - state.activeWorkout.startedAt);
    const el = $('#wkDur');
    if (el) el.textContent = txt;
    const mini = $('#miniDur');
    if (mini) mini.textContent = txt;
  }
  function ensureElapsedTimer() {
    const want = !!state.activeWorkout && !state.activeWorkout.editingId;
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
      ${clamped > 0 ? `<path d="${arc(start, end)}" fill="none" stroke="${goalStroke(over === true ? 'over' : over || '')}" stroke-width="${sw}" stroke-linecap="round"/>` : ''}
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
      const st = goalState(val, target, macroKind(label));
      return `
      <div class="macro-row">
        <div class="m-head">
          <span class="micro">${label}</span>
          <span class="m-val ${st}">${Math.round(val)}g / ${target}g</span>
        </div>
        <div class="macro-track"><div class="macro-fill ${st}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  /* the original home, kept so it can be switched back on in settings */
  function renderHomeClassic() {
    const v = $('#view');
    const today = new Date();
    const todayKey = dateKey(today);
    const totals = dayTotals(todayKey);
    const targets = state.nutrition.targets;
    const frac = targets.kcal ? totals.kcal / targets.kcal : 0;
    const kSt = goalState(totals.kcal, targets.kcal, 'kcal');
    const over = kSt === 'over';

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
    // kept short: the sub-line is one line only, and an ellipsis there looks broken
    const subParts = [
      today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      `${weekCount} workout${weekCount === 1 ? '' : 's'}`,
    ];
    if (streak >= 2) subParts.push(`${streak}w streak 🔥`);

    const macros = [
      ['Protein', totals.protein, targets.protein, '<path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 6 2h4a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h1a3 3 0 0 0 2.235-1"/>'],
      ['Carbs', totals.carbs, targets.carbs, '<path d="M4 10.75h16a8 8 0 0 1-16 0Z"/><path d="M9.6 7.6c0-.9.8-1.4.8-2.4M14.2 7.6c0-.9.8-1.4.8-2.4"/>'],
      ['Fat', totals.fat, targets.fat, '<path d="M12 4.4c3.2 3.9 5 6.5 5 8.85a5 5 0 0 1-10 0c0-2.35 1.8-4.95 5-8.85Z"/>'],
    ];
    const stats = weightStats();
    const goal = state.settings.goalWeight;
    const initial = ((state.settings.name || '').trim().charAt(0) || 'B').toUpperCase();
    const kcalPct = Math.round(frac * 100);
    const { done: hbDone, total: hbTotal } = habitsDone(todayKey);
    const RING = 2 * Math.PI * 22;
    const ringOffset = RING * (1 - Math.min(1, frac));

    v.innerHTML = `
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
            <div class="bw-value"${lw ? ` data-roll="bw" data-roll-to="${lw.value}" data-roll-dec="2"` : ''}>${lw ? fmtNum(lw.value) : '—'}<span class="t-unit">${esc(unit())}</span></div>
            <div class="bw-delta">${
              stats && stats.week != null
                ? `<span class="bw-arrow">${stats.week > 0 ? '↑' : stats.week < 0 ? '↓' : '→'}</span> <b>${fmtNum(roundWeight(Math.abs(stats.week)))} ${esc(unit())}</b> this week`
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
              <circle cx="26" cy="26" r="22" fill="none" stroke="${goalStroke(kSt)}" stroke-width="4" stroke-linecap="round"
                stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}" transform="rotate(-90 26 26)"/>
            </svg>
            <span class="kl-pct">${kcalPct}%</span>
          </div>
          <div class="kl-right">
            <div class="macro-track kl-track"><div class="macro-fill ${kSt}" style="width:${Math.min(100, frac * 100)}%"></div></div>
            <div class="kl-total"><b class="${kSt}" data-roll="home-kcal" data-roll-to="${Math.round(totals.kcal)}">${Math.round(totals.kcal)}</b> / ${targets.kcal.toLocaleString()} <span>kcal</span></div>
            <div class="kl-left ${kSt}">${kSt === 'done' ? 'Goal reached' : kSt === 'over' ? `${Math.round(totals.kcal - targets.kcal)} kcal over` : `${Math.round(targets.kcal - totals.kcal)} kcal left`}</div>
          </div>
        </div>
        <div class="kl-macros">
          ${macros.map(([label, val, target]) => {
            const pct = target ? Math.min(100, (val / target) * 100) : 0;
            const mSt = goalState(val, target, macroKind(label));
            return `
            <div class="klm">
              <div class="klm-head"><span class="klm-name">${label}</span><span class="klm-val ${mSt}">${Math.round(val)}<i>/${target}g</i></span></div>
              <div class="mc-bar"><div class="mc-fill ${mSt}" style="width:${pct}%"></div></div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card hb-home">
        <div class="hbh-head">
          <span class="micro">Habits</span>
          <span class="hbh-count ${hbTotal && hbDone === hbTotal ? 'all-done' : ''}">${hbDone} / ${hbTotal} today</span>
        </div>
        ${hbTotal ? `<div class="hbh-row">${habitsList().slice(0, 6).map((h) => {
          const done = habitDone(h, todayKey);
          return `
          <button class="hbh-chip ${done ? 'is-done' : ''}" data-h="${esc(h.id)}">
            <span class="hbh-ico">${habitRing(h, todayKey)}<i>${habitIcon(h.icon)}</i></span>
            <span class="hbh-name">${esc(h.name)}</span>
          </button>`;
        }).join('')}</div>` : '<p class="hbh-empty">Add your first habit in the Habits tab.</p>'}
      </div>

      ${active ? '' : `
      <div class="home-actions">
        <button class="ha-btn ha-primary" id="homeStart">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5v9M3.5 9.5v5M17.5 7.5v9M20.5 9.5v5M6.5 12h11"/></svg>
          Start workout
        </button>
        <button class="ha-btn" id="homeLog">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.6 3.4v6.1a2 2 0 0 1-4 0V3.4M5.6 9.7V20.6"/><path d="M17.4 3.4c-1.5 1.6-2.2 3.2-2.2 5.2 0 1.6.7 2.6 2.2 2.9v9.1"/></svg>
          Log meal
        </button>
      </div>`}`;

    $('#homeAvatar').addEventListener('click', () => goTab('profile'));
    $('#bwGoal').addEventListener('click', (e) => { e.stopPropagation(); openWeightSheet(); });
    $('#bwCard').addEventListener('click', openWeightSheet);
    // both are absent while a workout is running — the mini bar resumes it
    if ($('#homeStart')) $('#homeStart').addEventListener('click', () => {
      if (state.activeWorkout) { workoutOpen = true; openWkEntry(); }
      goTab('workout');
    });
    if ($('#homeLog')) $('#homeLog').addEventListener('click', () => { mealDayOffset = 0; openMealSheet(); });
    $$('.hbh-chip', v).forEach((c) => c.addEventListener('click', () => {
      const h = habitById(c.dataset.h);
      if (!h) return;
      if (h.source) goHabitSource(h);
      else if (habitType(h) === 'check') toggleHabit(h);
      else openHabitPad(h, todayKey);
    }));
    const hbHome = $('.hb-home', v);
    if (hbHome) hbHome.addEventListener('click', (e) => { if (!e.target.closest('.hbh-chip')) goTab('habits'); });
  }


  /* Home, rebuilt in the same language as the other tabs: a page head, a
     stat pair like the workouts dashboard, the calories card from nutrition,
     and the habit cells from the habits calendar. */
  function renderHomeDash() {
    const v = $('#view');
    const today = new Date();
    const todayKey = dateKey(today);
    const totals = dayTotals(todayKey);
    const targets = state.nutrition.targets;
    const frac = targets.kcal ? totals.kcal / targets.kcal : 0;
    const kSt = goalState(totals.kcal, targets.kcal, 'kcal');
    const over = kSt === 'over';
    const kcalPct = Math.round(frac * 100);
    const RING = 2 * Math.PI * 22;
    const ringOffset = RING * (1 - Math.min(1, frac));

    const dow = (today.getDay() + 6) % 7;
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
    const workoutDays = new Set(state.workouts.map((w) => dateKey(new Date(w.startedAt))));
    const mealDays = new Set(state.nutrition.meals.map((m) => m.date));
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hasPlan = (state.schedule || []).some(Boolean);
    const strip = dayNames.map((L, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      const key = dateKey(d);
      const isToday = key === todayKey;
      const logged = workoutDays.has(key) || mealDays.has(key);
      const trained = workoutDays.has(key);
      const plan = plannedFor(i);
      return '<button class="wd ' + (isToday ? 'is-today' : key < todayKey ? 'is-past' : '') + '" data-day="' + key + '"' +
        (key > todayKey ? ' disabled' : '') + '>' +
        '<span class="wd-letter">' + L.slice(0, 1) + '</span>' +
        '<span class="wd-num">' + d.getDate() + '</span>' +
        (hasPlan ? '<span class="wd-plan' + (trained ? ' done' : '') + '">' +
          (plan ? esc(planShort(plan)) : '·') + '</span>' : '') +
        '<span class="wd-mark ' + (logged ? 'on' : '') + '"></span></button>';
    }).join('');

    const lw = latestWeight();
    const st = weightStats();
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      return weightOn(dateKey(d));
    });
    const list = habitsList();
    const { done: hbDone, total: hbTotal } = habitsDone(todayKey);
    const active = state.activeWorkout;
    const score = dayScore(todayKey);
    const SCORE_C = 2 * Math.PI * 26;
    const proj = goalProjection();
    const planned = plannedFor(todayIndex());
    const trainedToday = state.workouts.some((w) => dateKey(new Date(w.startedAt)) === todayKey);
    const startLabel = active ? 'Resume workout'
      : planned && planned.rest ? 'Rest day'
      : planned ? 'Start ' + planned.name
      : 'Start workout';
    const hour = today.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const weekCount = state.workouts.filter((x) => new Date(x.startedAt) >= monday).length;
    const streak = streakWeeks();
    const gap = lastSessionDays();
    const risk = streakAtRisk();
    const weighDays = lastWeighInDays();
    const sub = [
      today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      gap != null && gap >= 4 ? gap + ' days since training' : weekCount + ' workout' + (weekCount === 1 ? '' : 's'),
    ].concat(streak >= 2 && !(gap >= 4) ? [streak + 'w streak 🔥'] : []).join(' · ');

    v.innerHTML =
      '<div class="page-head home-head">' +
        '<div class="hh-text">' +
          '<span class="hh-greet">' + greeting + ',</span>' +
          '<h2 class="hh-name">' + esc(state.settings.name || 'Athlete') + '<span class="hh-dot">.</span></h2>' +
          '<p class="hh-sub">' + esc(sub) + '</p>' +
        '</div>' +
        '<button class="hh-avatar" id="homeAvatar" aria-label="Open profile">' +
          '<span class="hh-score" data-score="' + score.total + '">' +
            '<svg viewBox="0 0 56 56" aria-hidden="true">' +
              '<circle cx="28" cy="28" r="26" fill="none" stroke="var(--surface-2)" stroke-width="2.4"/>' +
              '<circle cx="28" cy="28" r="26" fill="none" stroke="' + (score.total >= 100 ? 'var(--done)' : 'var(--ink-1)') + '" stroke-width="2.4" stroke-linecap="round"' +
              ' stroke-dasharray="' + SCORE_C.toFixed(1) + '" stroke-dashoffset="' + (SCORE_C * (1 - score.total / 100)).toFixed(1) + '" transform="rotate(-90 28 28)"/>' +
            '</svg>' + avatarHTML('hh-initial') + '</span>' +
        '</button>' +
      '</div>' +

      '<div class="week-strip">' + strip + '</div>' +

      '<div class="home-pair">' +
        '<button class="card hstat" id="bwCard">' +
          '<span class="micro">Bodyweight</span>' +
          '<div class="hstat-val"' + (lw ? ' data-roll="bw" data-roll-to="' + lw.value + '" data-roll-dec="2"' : '') + '>' +
            (lw ? fmtNum(lw.value) : '—') + '<i>' + esc(unit()) + '</i></div>' +
          '<div class="hstat-sub">' + (st && st.week != null
            ? (st.week > 0 ? '↑' : st.week < 0 ? '↓' : '→') + ' ' + fmtNum(roundWeight(Math.abs(st.week))) + ' ' + esc(unit()) + ' this week'
            : 'Tap to log today') + '</div>' +
          '<div class="hstat-goalbox">' + goalProgressHTML() + '</div>' +
        '</button>' +
        '<button class="card hstat" id="hbCard">' +
          '<span class="micro">Habits</span>' +
          '<div class="hstat-val ' + (hbTotal && hbDone === hbTotal ? 'all-done' : '') + '">' + hbDone + '<i>/ ' + hbTotal + '</i></div>' +
          '<div class="hstat-sub' + (risk ? ' warn' : '') + '">' + (risk ? risk.streak + '-day streak at risk'
            : hbTotal ? (hbDone === hbTotal ? 'All done today' : (hbTotal - hbDone) + ' to go') : 'Add your first') + '</div>' +
          '<div class="hstat-cells">' + list.slice(0, 5).map((h) => {
            const val = habitValue(h.id, todayKey);
            const pct = Math.round(Math.min(1, val / habitTarget(h)) * 100);
            // a span, not a button: this sits inside the card button and nested
            // buttons get hoisted out of it by the parser
            return '<span class="hs-cell ' + (pct === 100 ? 'is-full' : pct ? 'is-part' : '') + '" data-h="' + esc(h.id) + '" role="button" tabindex="0" aria-label="' + esc(h.name) + '">' +
              '<i class="hs-fill" style="height:' + (pct === 100 ? 100 : pct) + '%"></i>' +
              '<span>' + habitIcon(h.icon) + '</span></span>';
          }).join('') + '</div>' +
        '</button>' +
      '</div>' +

      '<button class="card kcal-line kcal-dash" id="kcalCard" aria-label="Open nutrition">' +
        '<div class="kl-top">' +
          '<div class="kl-col">' +
            '<span class="micro">Calories</span>' +
            '<div class="kl-total"><b class="' + kSt + '" data-roll="home-kcal" data-roll-to="' + Math.round(totals.kcal) + '">' +
              Math.round(totals.kcal).toLocaleString() + '</b> / ' + targets.kcal.toLocaleString() + ' <span>kcal</span></div>' +
            '<div class="kl-left ' + kSt + '">' + (kSt === 'done' ? 'Goal reached'
              : kSt === 'over' ? Math.round(totals.kcal - targets.kcal).toLocaleString() + ' kcal over'
              : Math.round(targets.kcal - totals.kcal).toLocaleString() + ' kcal left') + '</div>' +
          '</div>' +
          '<div class="kl-ring"><svg viewBox="0 0 52 52" aria-hidden="true">' +
            '<circle cx="26" cy="26" r="22" fill="none" stroke="var(--surface-2)" stroke-width="4"/>' +
            '<circle cx="26" cy="26" r="22" fill="none" stroke="' + goalStroke(kSt) + '" stroke-width="4" stroke-linecap="round"' +
            ' stroke-dasharray="' + RING.toFixed(1) + '" stroke-dashoffset="' + ringOffset.toFixed(1) + '" transform="rotate(-90 26 26)"/>' +
          '</svg><span class="kl-pct">' + kcalPct + '%</span></div>' +
        '</div>' +
        '<div class="macro-track kl-track"><div class="macro-fill ' + kSt + '" style="width:' + Math.min(100, frac * 100) + '%"></div></div>' +
        '<div class="kl-macros">' +
          [['Protein', totals.protein, targets.protein], ['Carbs', totals.carbs, targets.carbs], ['Fat', totals.fat, targets.fat]].map(([label, val, target]) => {
            const pct = target ? Math.min(100, (val / target) * 100) : 0;
            const mSt = goalState(val, target, macroKind(label));
            return '<div class="klm">' +
              '<div class="klm-head"><span class="klm-name">' + label + '</span>' +
                '<span class="klm-val ' + mSt + '">' + Math.round(val) + '<i>/' + target + 'g</i></span></div>' +
              '<div class="mc-bar"><div class="mc-fill ' + mSt + '" style="width:' + pct + '%"></div></div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</button>' +

      (active ? '' :
        '<div class="home-actions">' +
          '<button class="ha-btn ha-primary" id="homeStart">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5v9M3.5 9.5v5M17.5 7.5v9M20.5 9.5v5M6.5 12h11"/></svg>' +
            esc(startLabel) + '</button>' +
          '<button class="ha-btn" id="homeLog">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.6 3.4v6.1a2 2 0 0 1-4 0V3.4M5.6 9.7V20.6"/><path d="M17.4 3.4c-1.5 1.6-2.2 3.2-2.2 5.2 0 1.6.7 2.6 2.2 2.9v9.1"/></svg>' +
            'Log meal</button>' +
        '</div>');

    $('#homeAvatar').addEventListener('click', () => goTab('profile'));
    $$('.wd[data-day]', v).forEach((b) => b.addEventListener('click', () => openDaySummary(b.dataset.day)));
    $('#kcalCard').addEventListener('click', () => { mealDayOffset = 0; goTab('meals'); });
    $('#bwCard').addEventListener('click', openWeightSheet);
    $('#hbCard').addEventListener('click', (e) => {
      const cell = e.target.closest('[data-h]');
      const h = cell && habitById(cell.dataset.h);
      if (!h) { goTab('habits'); return; }
      if (h.source) goHabitSource(h);
      else if (habitType(h) === 'check') toggleHabit(h);
      else openHabitPad(h, todayKey);
    });
    if ($('#homeStart')) $('#homeStart').addEventListener('click', () => {
      if (state.activeWorkout) { workoutOpen = true; openWkEntry(); goTab('workout'); return; }
      // a planned session starts straight from home; anything else goes to the tab
      if (planned && !planned.rest && !trainedToday) { startWorkout(planned.id); return; }
      goTab('workout');
    });
    if ($('#homeLog')) $('#homeLog').addEventListener('click', () => { mealDayOffset = 0; openMealSheet(); });
  }

  /* How far along the journey to the goal weight — the number that actually
     matters, instead of a line drawn through two noisy points. */
  function goalProgressHTML() {
    const goal = state.settings.goalWeight;
    const lw = latestWeight();
    const u = esc(unit());
    const stale = lastWeighInDays();
    if (!lw) return '<div class="gb-empty">Log your weight to start tracking</div>';
    if (stale != null && stale >= 7) return '<div class="gb-empty warn">No weigh-in for ' + stale + ' days</div>';
    if (!goal) return '<div class="gb-empty">Set a goal weight</div>';

    const all = [...state.nutrition.weights].sort((a, b) => a.date.localeCompare(b.date));
    const start = all.length ? all[0].value : lw.value;
    const togo = roundWeight(lw.value - goal);
    const span = Math.abs(start - goal);
    const done = Math.abs(start - lw.value);
    let pct = span > 0.05 ? Math.round(Math.min(100, Math.max(0, (done / span) * 100))) : 100;
    // moving away from the goal shouldn't read as progress
    const wrongWay = (goal < start && lw.value > start) || (goal > start && lw.value < start);
    if (wrongWay) pct = 0;
    const reached = Math.abs(togo) < 0.05 || (goal < start ? lw.value <= goal : lw.value >= goal);

    const proj = goalProjection();
    const note = reached ? 'Goal reached'
      : fmtNum(Math.abs(togo)) + ' ' + u + ' to ' + (togo > 0 ? 'go' : 'gain') +
        (proj && proj.eta ? ' · ' + proj.eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

    return '' +
      '<div class="gb-note' + (reached ? ' all-done' : '') + '">' + note + '</div>' +
      '<div class="gb-track"><div class="gb-fill' + (reached ? ' all-done' : '') + '" style="width:' + (reached ? 100 : pct) + '%"></div></div>' +
      '<div class="gb-ends"><span>' + fmtNum(roundWeight(start)) + '</span><span>' + fmtNum(goal) + ' ' + u + '</span></div>';
  }

  function renderHome() {
    if (state.settings.homeLayout === 'classic') renderHomeClassic();
    else renderHomeDash();
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
          ${cell('7d avg', st.avg7 != null ? fmtNum(roundWeight(st.avg7)) : '—', esc(unit()))}
          ${cell('Week', st.week != null ? (st.week > 0 ? '+' : '') + fmtNum(roundWeight(st.week)) : '—', esc(unit()))}
          ${cell('30d', st.month != null ? (st.month > 0 ? '+' : '') + fmtNum(roundWeight(st.month)) : '—', esc(unit()))}
        </div>`;
      })()}
      <div class="field">
        <label for="bwInput">Today's weight (${esc(unit())})</label>
        <input id="bwInput" type="number" inputmode="decimal" step="${WEIGHT_STEP}" min="0"
               value="${existing ? existing.value : latestWeight()?.value ?? ''}" placeholder="e.g. 77.9">
      </div>
      <div class="field">
        <label for="bwGoalInput">Goal weight (optional)</label>
        <input id="bwGoalInput" type="number" inputmode="decimal" step="${WEIGHT_STEP}" min="0"
               value="${state.settings.goalWeight ?? ''}" placeholder="e.g. 75">
      </div>
      <button class="btn btn-primary" id="bwSave">Save</button>
      ${existing ? '<button class="btn btn-danger" id="bwDelete" style="margin-top:10px">Remove today’s entry</button>' : ''}
    `, (body) => {
      const input = $('#bwInput', body);
      input.focus();
      $('#bwSave', body).addEventListener('click', () => {
        const goalVal = Number($('#bwGoalInput', body).value);
        if (goalVal > 0) state.settings.goalWeight = roundWeight(goalVal);
        else delete state.settings.goalWeight;
        const val = Number(input.value);
        if (!val || val <= 0) {
          // saving just a goal is fine
          if (goalVal > 0) { save(); closeSheet(); render(); toast('Goal saved'); return; }
          toast('Enter a weight'); return;
        }
        state.nutrition.weights = state.nutrition.weights.filter((w) => w.date !== todayKey);
        state.nutrition.weights.push({ date: todayKey, value: roundWeight(val) });
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

  const MEAL_SLOTS = [
    ['breakfast', 'Breakfast', '<path d="M12 6.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8ZM12 2.4v1.7M12 19.9v1.7M2.4 12h1.7M19.9 12h1.7M5.2 5.2l1.2 1.2M17.6 17.6l1.2 1.2M18.8 5.2l-1.2 1.2M6.4 17.6l-1.2 1.2"/>'],
    ['lunch', 'Lunch', '<path d="M4 11.5h16a8 8 0 0 1-16 0Z"/><path d="M2.8 15.6h18.4M6.4 8.2c0-1 .9-1.5.9-2.6M11.6 8.2c0-1 .9-1.5.9-2.6M16.8 8.2c0-1 .9-1.5.9-2.6"/>'],
    ['dinner', 'Dinner', '<path d="M6.5 3.2v7.2a2.2 2.2 0 0 0 4.4 0V3.2M8.7 10.4V20.8M17.5 3.2c-1.5 1.6-2 3.4-2 5.6 0 1.6.6 2.6 2 2.9V20.8"/>'],
    ['snack', 'Snacks', '<path d="M12.5 7.2c-2.6-1.6-6.6-.6-7.8 2.4-1.3 3.2 1.3 8.9 4.2 9.9 1.3.5 2.2-.3 3.6-.3s2.3.8 3.6.3c2.9-1 5.5-6.7 4.2-9.9-1.2-3-5.2-4-7.8-2.4Z"/><path d="M12.5 7.2c.2-1.6 1.3-2.9 3-3.2"/>'],
  ];
  const mealSlot = (m) => m.slot || slotFromTime(m.time);
  // what you actually eat for this meal, newest first — one tap to log again
  function recentForSlot(slot, exceptKey, limit = 3) {
    const out = [];
    for (let i = state.nutrition.meals.length - 1; i >= 0; i--) {
      const m = state.nutrition.meals[i];
      if (mealSlot(m) !== slot || m.date === exceptKey) continue;
      if (out.some((x) => x.name === m.name)) continue;
      out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  }
  function logMeal(src, slot, key) {
    const meal = {
      id: uid(), date: key, slot,
      time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      name: src.name, kcal: src.kcal || 0, protein: src.protein || 0, carbs: src.carbs || 0, fat: src.fat || 0,
    };
    // what it was made of, so the portion can be corrected without retyping
    if (src.base && src.amount) { meal.base = src.base; meal.amount = src.amount; }
    state.nutrition.meals.push(meal);
    return meal;
  }

  /* Where a number sits against its goal. Reaching a target is the point, so
     it reads as done rather than a warning — 181 g against a 180 g protein
     goal is a goal met, not a mistake, and no portion can land on it exactly.
     Only calories clearly past the goal (10% over) are still worth flagging. */
  const OVER_SLACK = 1.1;        // a day within 10% of the goal still counts as one you hit
  /* Calories: a little past the goal is a normal day, not a red number. Only
     properly past it is worth flagging. */
  const KCAL_SLACK = 500;
  /* Within touching distance of a goal is not the same as nowhere near it.
     Ten grams of protein short is a good day with a snack left in it, so it
     reads as most of the way there rather than as nothing. */
  const NEAR_G = 10;
  const NEAR_KCAL = 100;
  function goalState(val, target, kind) {
    if (!target) return '';
    if (val < target) {
      return (target - val) <= (kind === 'kcal' ? NEAR_KCAL : NEAR_G) ? 'near' : '';
    }
    // more protein is never the problem, so passing that goal is just met
    if (kind === 'protein') return 'done';
    if (kind === 'kcal') return val > target + KCAL_SLACK ? 'over' : 'done';
    /* Carbs and fat: judge by the numbers on screen, which are whole, so
       70.4 g against a 70 g goal reads as "70" and is not over anything. */
    if (Math.round(val) > Math.round(target)) return 'over';
    return 'done';
  }
  const macroKind = (label) => (String(label).toLowerCase() === 'protein' ? 'protein' : '');
  const goalStroke = (st) => (st === 'over' ? 'var(--critical)'
    : st === 'done' ? 'var(--done)'
    : st === 'near' ? 'var(--near)' : 'var(--ink-1)');

  function macroRing(label, val, target, size) {
    const frac = target ? Math.min(1, val / target) : 0;
    const st = goalState(val, target, macroKind(label));
    const r = 15.5, C = 2 * Math.PI * r;
    const left = Math.max(0, Math.round(target - val));
    return '' +
      '<div class="nm-card">' +
        '<div class="nm-ring">' +
          '<svg viewBox="0 0 36 36" style="width:' + size + 'px;height:' + size + 'px" aria-hidden="true">' +
            '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="3.4"/>' +
            '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="' + goalStroke(st) + '" stroke-width="3.4" stroke-linecap="round"' +
            ' stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '" transform="rotate(-90 18 18)"/>' +
          '</svg>' +
        '</div>' +
        '<div class="nm-text"><span class="nm-name">' + label + '</span>' +
          '<b class="nm-left ' + st + '">' + (st === 'over' ? Math.round(val - target) + 'g over'
            : st === 'done' ? 'goal hit' : left + 'g left') + '</b></div>' +
      '</div>';
  }

  function renderMeals() {
    const v = $('#view');
    const day = dayWithOffset(mealDayOffset);
    const key = dateKey(day);
    const meals = mealsForDay(key);
    const totals = dayTotals(key);
    const targets = state.nutrition.targets;
    const frac = targets.kcal ? totals.kcal / targets.kcal : 0;
    const kSt = goalState(totals.kcal, targets.kcal, 'kcal');
    const over = kSt === 'over';
    const left = Math.round(targets.kcal - totals.kcal);
    const label = mealDayOffset === 0 ? 'Today' : mealDayOffset === -1 ? 'Yesterday' : fmtDate(day.getTime());

    v.innerHTML =
      '<div class="page-head">' +
        '<div><h2>Nutrition</h2><p class="subtitle">Log meals and macros</p></div>' +
        '<div class="ph-actions">' +
          '<button class="icon-btn" id="editTargets" aria-label="Edit daily goals">' +
            '<svg viewBox="0 0 24 24"><path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2.1"/><circle cx="9" cy="16" r="2.1"/></svg></button>' +
          '<button class="icon-btn" id="addMeal" aria-label="Log a meal"><svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13"/></svg></button>' +
        '</div>' +
      '</div>' +

      '<div class="day-nav">' +
        '<button id="dayPrev" aria-label="Previous day">‹</button>' +
        '<span class="dn-label">' + esc(label) + '</span>' +
        '<button id="dayNext" aria-label="Next day" ' + (mealDayOffset >= 0 ? 'disabled style="opacity:0.35"' : '') + '>›</button>' +
      '</div>' +

      '<div class="nut-hero">' +
        (kSt === 'done'
          ? '<div class="nh-num done nh-hit">Goal reached</div>' +
            '<div class="nh-sub">' + Math.round(totals.kcal).toLocaleString() + ' of ' + targets.kcal.toLocaleString() + ' kcal</div>'
          : '<div class="nh-num ' + kSt + '" data-roll="nut-left" data-roll-to="' + Math.abs(left) + '">' +
              Math.abs(left).toLocaleString() + '<span>kcal</span></div>' +
            '<div class="nh-sub">' + (over ? 'over your goal' : 'left for today') + '</div>') +
      '</div>' +

      '<div class="card nut-consumed">' +
        '<div class="nc-head">' +
          '<span class="nc-l"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c.7 3.1 3.4 4.4 3.4 7.4 0 1-.4 2-1.2 2.8.5-1.7-.6-3.1-1.7-3.9.2 2.3-1.4 3.5-2.3 4.8-1.7 2.2.2 5.5 3.4 5.5 3.1 0 5.4-2.4 5.4-5.4 0-4.9-4.3-7.9-7-11.2Z"/></svg>' +
            'Consumed <i>(' + Math.round(frac * 100) + '%)</i></span>' +
          '<span class="nc-r ' + kSt + '">' + Math.round(totals.kcal).toLocaleString() + ' kcal</span>' +
        '</div>' +
        '<div class="macro-track"><div class="macro-fill ' + kSt + '" style="width:' + Math.min(100, frac * 100) + '%"></div></div>' +
        '<div class="nc-foot"><span>0</span><span>' + targets.kcal.toLocaleString() + ' kcal goal</span></div>' +
      '</div>' +

      '<div class="nut-macros">' +
        macroRing('Protein', totals.protein, targets.protein, 44) +
        macroRing('Carbs', totals.carbs, targets.carbs, 44) +
        macroRing('Fat', totals.fat, targets.fat, 44) +
      '</div>' +

      MEAL_SLOTS.map(([slot, title, icon]) => {
        const items = meals.filter((m) => mealSlot(m) === slot);
        const sum = (k) => items.reduce((t, m) => t + (Number(m[k]) || 0), 0);
        const kcal = sum('kcal');
        /* What the meal itself came to, not just its calories — the day's
           totals are at the top, but a meal is what you decide about. */
        const line = items.length
          ? Math.round(kcal) + ' kcal <i>· P ' + Math.round(sum('protein')) +
            ' · C ' + Math.round(sum('carbs')) + ' · F ' + Math.round(sum('fat')) + '</i>'
          : 'Nothing logged';
        return '<div class="card slot-card">' +
          '<div class="slot-head">' +
            '<span class="slot-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg></span>' +
            '<div class="slot-title"><b>' + title + '</b><span>' + line + '</span></div>' +
            (items.length > 1 ? '<button class="slot-save" data-save="' + slot + '" aria-label="Save ' + title + ' as a meal">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4.5h13v15l-6.5-4-6.5 4Z"/></svg></button>' : '') +
            '<button class="slot-add" data-slot="' + slot + '" aria-label="Add to ' + title + '">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg></button>' +
          '</div>' +
          (() => {
            const recents = recentForSlot(slot, key);
            if (!recents.length) return '';
            return '<div class="slot-quick">' + recents.map((m, i) =>
              '<button class="quick-chip" data-quick="' + slot + '" data-i="' + i + '">' +
                '<span>' + esc(m.name.length > 18 ? m.name.slice(0, 17) + '…' : m.name) + '</span>' +
                '<i>' + Math.round(m.kcal) + '</i></button>').join('') + '</div>';
          })() +
          (items.length ? '<div class="slot-items">' + items.map((m) =>
            '<div class="slot-item">' +
              '<div class="si-main"><div class="si-name">' + (() => {
                // the portion reads a shade quieter than the food it belongs to
                const head = baseName(m.name);
                const tail = m.name.length > head.length ? m.name.slice(head.length) : '';
                return esc(head) + (tail ? '<span class="si-portion">' + esc(tail) + '</span>' : '');
              })() + '</div>' +
                '<div class="si-sub">P ' + Math.round(m.protein) + ' · C ' + Math.round(m.carbs) + ' · F ' + Math.round(m.fat) + (m.time ? ' · ' + esc(m.time) : '') + '</div></div>' +
              '<span class="si-kcal">' + Math.round(m.kcal) + '</span>' +
              '<button class="si-del" data-del="' + esc(m.id) + '" aria-label="Delete ' + esc(m.name) + '">' +
                '<svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13M10 11v6M14 11v6"/></svg></button>' +
            '</div>').join('') + '</div>' : '') +
        '</div>';
      }).join('') +

      (() => {
        const prev = mealsForDay(dateKey(dayWithOffset(mealDayOffset - 1)));
        if (meals.length || !prev.length) return '';
        return '<button class="btn btn-quiet copy-yday" id="copyYday">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h9.5v11.5H9Z"/><path d="M15 9V3.5H5.5V15H9"/></svg>' +
          'Copy ' + (mealDayOffset === 0 ? 'yesterday' : 'the day before') + ' (' + prev.length + ' meals)</button>';
      })() +

      nutWeekHTML(key);

    $('#dayPrev').addEventListener('click', () => { mealDayOffset -= 1; render(); });
    $('#dayNext').addEventListener('click', () => { if (mealDayOffset < 0) { mealDayOffset += 1; render(); } });
    $('#addMeal').addEventListener('click', () => openMealSheet(key));
    $('#editTargets').addEventListener('click', openTargetsSheet);
    $$('.slot-add', v).forEach((b) => b.addEventListener('click', () => openMealSheet(key, b.dataset.slot)));
    $$('.slot-save', v).forEach((b) => b.addEventListener('click', () => openSaveMealSheet(b.dataset.save, key)));
    $$('.quick-chip', v).forEach((b) => b.addEventListener('click', () => {
      const src = recentForSlot(b.dataset.quick, key)[Number(b.dataset.i)];
      if (!src) return;
      logMeal(src, b.dataset.quick, key);
      save(); render();
      toast(src.name + ' logged');
    }));
    const copyBtn = $('#copyYday');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const prev = mealsForDay(dateKey(dayWithOffset(mealDayOffset - 1)));
      prev.forEach((m) => state.nutrition.meals.push({ ...m, id: uid(), date: key }));
      save(); render();
      toast(prev.length + ' meals copied');
    });
    const delMeal = (id) => {
      const meal = state.nutrition.meals.find((m) => m.id === id);
      undoable((meal ? meal.name : 'Meal') + ' deleted', () => {
        state.nutrition.meals = state.nutrition.meals.filter((m) => m.id !== id);
      });
    };
    $$('.si-del', v).forEach((b) => b.addEventListener('click', () => delMeal(b.dataset.del)));
    $$('.slot-item', v).forEach((row) => {
      const id = $('.si-del', row)?.dataset.del;
      if (!id) return;
      swipeToDelete(row, () => delMeal(id));
      longPress(row, () => openMealMenu(id));
      row.addEventListener('click', (e) => {
        if (e.target.closest('.si-del')) return;      // the bin is its own button
        openMealEdit(id);
      });
    });
  }

  /* The last seven days at a glance: what you averaged, and how often the
     goal was actually met. A single day says little; a week says whether the
     targets are the right ones. */
  function nutWeekHTML(endKey) {
    const t = state.nutrition.targets;
    const end = new Date(endKey + 'T12:00:00');
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(end);
      d.setDate(d.getDate() - (6 - i));
      const key = dateKey(d);
      return { key, letter: 'MTWTFSS'[(d.getDay() + 6) % 7], ...dayTotals(key) };
    });
    const logged = days.filter((d) => d.kcal > 0);
    if (logged.length < 2) return '';
    const avg = (pick) => Math.round(logged.reduce((s, d) => s + pick(d), 0) / logged.length);
    const onTarget = logged.filter((d) => t.kcal && d.kcal <= t.kcal * OVER_SLACK && d.kcal >= t.kcal * 0.85).length;
    const proteinHit = logged.filter((d) => t.protein && d.protein >= t.protein).length;
    const peak = Math.max(t.kcal || 0, ...days.map((d) => d.kcal));

    return '<div class="card nut-week">' +
      '<div class="nw-head"><span class="micro">Last 7 days</span>' +
        '<span class="nw-note">' + logged.length + (logged.length === 1 ? ' day logged' : ' days logged') + '</span></div>' +
      '<div class="nw-bars">' +
        days.map((d) => {
          const h = peak ? Math.max(3, Math.round((d.kcal / peak) * 100)) : 3;
          const st = d.kcal ? goalState(d.kcal, t.kcal, 'kcal') : '';
          return '<div class="nw-day">' +
            '<div class="nw-col"><span class="nw-fill ' + st + '" style="height:' + h + '%"></span></div>' +
            '<span class="nw-let">' + d.letter + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="nw-stats">' +
        '<div><span class="micro">Avg kcal</span><b>' + avg((d) => d.kcal).toLocaleString() + '</b></div>' +
        '<div><span class="micro">Avg protein</span><b>' + avg((d) => d.protein) + 'g</b></div>' +
        '<div><span class="micro">Kcal on target</span><b>' + onTarget + '<i>/' + logged.length + '</i></b></div>' +
        '<div><span class="micro">Protein hit</span><b>' + proteinHit + '<i>/' + logged.length + '</i></b></div>' +
      '</div>' +
    '</div>';
  }

  /* Correcting something already logged. A meal that came from a food carries
     what it was made of, so only the portion needs changing and the macros
     follow; anything else is edited as four numbers. */
  function openMealEdit(id) {
    const meal = state.nutrition.meals.find((m) => m.id === id);
    if (!meal) return;
    const base = meal.base;
    const unit = base ? base.unit : null;
    const piece = unit === 'piece';
    let slot = meal.slot;

    const quick = base
      ? [...new Set(piece ? [1, 2, 3, 4] : [50, 100, 150, 200, 250])].filter((n) => n > 0)
      : [];

    openSheet('Edit ' + (base ? base.name : meal.name), '' +
      '<div class="seg seg-slot" id="meSlot">' +
        MEAL_SLOTS.map(([k, title]) => '<button data-slot="' + k + '" class="' + (k === slot ? 'is-on' : '') + '">' + title + '</button>').join('') +
      '</div>' +
      (base
        ? '<p class="portion-per">' + macroLine(base) + ' per ' + (piece ? 'piece' : base.per + ' ' + unit) + '</p>' +
          stepperHTML(base, 'meStep') +
          '<div class="field"><label for="meAmt">' + (piece ? 'How many' : 'Portion (' + unit + ')') + '</label>' +
            '<input id="meAmt" type="number" inputmode="decimal" min="0" step="1" value="' + meal.amount + '"></div>' +
          '<div class="quick-amounts" id="meQuick">' +
            quick.map((n) => '<button class="qchip" data-amt="' + n + '">' + (piece ? n + '×' : n + ' ' + unit) + '</button>').join('') +
          '</div>' +
          '<div class="prod-macros" id="meOut"></div>'
        : '<div class="field"><label for="meName">Name</label>' +
            '<input id="meName" type="text" value="' + esc(meal.name) + '"></div>' +
          '<div class="macro-fields">' +
            '<div class="field"><label for="meKcal">kcal</label><input id="meKcal" type="number" inputmode="numeric" min="0" value="' + Math.round(meal.kcal) + '"></div>' +
            '<div class="field"><label for="meP">Protein</label><input id="meP" type="number" inputmode="decimal" min="0" value="' + round1(meal.protein) + '"></div>' +
            '<div class="field"><label for="meC">Carbs</label><input id="meC" type="number" inputmode="decimal" min="0" value="' + round1(meal.carbs) + '"></div>' +
            '<div class="field"><label for="meF">Fat</label><input id="meF" type="number" inputmode="decimal" min="0" value="' + round1(meal.fat) + '"></div>' +
          '</div>') +
      '<button class="btn btn-primary" id="meSave" style="margin-top:16px">Save</button>' +
      '<button class="btn btn-danger" id="meDel" style="margin-top:10px">Delete</button>',
    (body) => {
      $$('#meSlot button', body).forEach((b) => b.addEventListener('click', () => {
        slot = b.dataset.slot;
        $$('#meSlot button', body).forEach((x) => x.classList.toggle('is-on', x === b));
      }));

      const amtIn = base ? $('#meAmt', body) : null;
      const scaled = (amount) => {
        const k = (Number(amount) || 0) / (base.per || 1);
        return { kcal: Math.round(base.kcal * k), protein: round1(base.protein * k),
          carbs: round1(base.carbs * k), fat: round1(base.fat * k) };
      };
      if (base) {
        const out = $('#meOut', body);
        let showCount = null;
        const paint = () => {
          if (showCount) showCount();
          const v = scaled(amtIn.value);
          out.innerHTML =
            '<div><span class="micro">kcal</span><b>' + v.kcal + '</b></div>' +
            '<div><span class="micro">Protein</span><b>' + v.protein + 'g</b></div>' +
            '<div><span class="micro">Carbs</span><b>' + v.carbs + 'g</b></div>' +
            '<div><span class="micro">Fat</span><b>' + v.fat + 'g</b></div>';
          $$('#meQuick .qchip', body).forEach((c) => c.classList.toggle('is-on', Number(c.dataset.amt) === Number(amtIn.value)));
        };
        showCount = wireStepper(body, 'meStep', base, amtIn, paint);
        paint();
        amtIn.addEventListener('input', paint);
        $$('#meQuick .qchip', body).forEach((c) => c.addEventListener('click', () => { amtIn.value = c.dataset.amt; paint(); }));
      }

      $('#meSave', body).addEventListener('click', () => {
        if (base) {
          const amount = Number(amtIn.value) || 0;
          if (!amount) { toast(piece ? 'Enter how many' : 'Enter a portion size'); return; }
          Object.assign(meal, scaled(amount), {
            amount,
            name: portionName(base, amount),
          });
        } else {
          const name = $('#meName', body).value.trim();
          if (!name) { toast('Give it a name'); return; }
          Object.assign(meal, {
            name,
            kcal: Math.max(0, Number($('#meKcal', body).value) || 0),
            protein: Math.max(0, Number($('#meP', body).value) || 0),
            carbs: Math.max(0, Number($('#meC', body).value) || 0),
            fat: Math.max(0, Number($('#meF', body).value) || 0),
          });
        }
        meal.slot = slot;
        haptic('tick');
        save(); closeSheet(); render();
        toast('Updated');
      });

      $('#meDel', body).addEventListener('click', () => {
        closeSheet();
        undoable(meal.name + ' deleted', () => {
          state.nutrition.meals = state.nutrition.meals.filter((m) => m.id !== id);
        });
      });
    });
  }

  /* Holding a logged meal: the things you actually want from one that is
     already in the day. */
  function openMealMenu(id) {
    const meal = state.nutrition.meals.find((m) => m.id === id);
    if (!meal) return;
    const today = dateKey();
    openSheet(meal.name, '' +
      '<div class="menu-list">' +
        '<button class="menu-item" data-act="edit">✎ &nbsp;Edit</button>' +
        '<button class="menu-item" data-act="again">＋ &nbsp;Log it again</button>' +
        (meal.date !== today ? '<button class="menu-item" data-act="today">→ &nbsp;Copy to today</button>' : '') +
        '<button class="menu-item" data-act="save">☆ &nbsp;Save as a meal</button>' +
        '<button class="menu-item danger" data-act="del">🗑 &nbsp;Delete</button>' +
      '</div>',
    (body) => {
      body.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        closeSheet();
        if (act === 'edit') {
          queueMicrotask(() => openMealEdit(id));
        } else if (act === 'again') {
          state.nutrition.meals.push({ ...meal, id: uid(), time: nowTime() });
          haptic('tick'); save(); render(); toast(meal.name + ' logged again');
        } else if (act === 'today') {
          state.nutrition.meals.push({ ...meal, id: uid(), date: today, time: nowTime() });
          haptic('tick'); save(); render(); toast('Copied to today');
        } else if (act === 'save') {
          state.savedMeals = state.savedMeals || [];
          state.savedMeals.push({ id: uid(), name: meal.name, items: [{ ...meal, id: uid() }] });
          haptic('tick'); save(); toast('Saved — it is in the ☆ list now');
        } else if (act === 'del') {
          const gone = meal;
          undoable(gone.name + ' deleted', () => {
            state.nutrition.meals = state.nutrition.meals.filter((m) => m.id !== id);
          });
        }
      });
    });
  }

  /* daily goals, editable straight from the nutrition page */
  function openTargetsSheet() {
    const t = state.nutrition.targets;
    const kcalFromMacros = (p, c, f) => Math.round(p * 4 + c * 4 + f * 9);
    openSheet('Daily goals', '' +
      '<div class="field"><label for="ngKcal">Calories (kcal)</label>' +
        '<input id="ngKcal" type="number" inputmode="numeric" min="0" value="' + t.kcal + '"></div>' +
      '<div class="field-row-3">' +
        '<div class="field"><label for="ngP">Protein g</label><input id="ngP" type="number" inputmode="numeric" min="0" value="' + t.protein + '"></div>' +
        '<div class="field"><label for="ngC">Carbs g</label><input id="ngC" type="number" inputmode="numeric" min="0" value="' + t.carbs + '"></div>' +
        '<div class="field"><label for="ngF">Fat g</label><input id="ngF" type="number" inputmode="numeric" min="0" value="' + t.fat + '"></div>' +
      '</div>' +
      '<p class="goal-note" id="ngNote"></p>' +
      '<button class="btn btn-quiet" id="ngMatch">Set calories from macros</button>' +
      '<button class="btn btn-primary" id="ngSave" style="margin-top:10px">Save goals</button>',
    (body) => {
      const get = (id) => Math.max(0, Number($(id, body).value) || 0);
      const note = $('#ngNote', body);
      const paint = () => {
        const fromMacros = kcalFromMacros(get('#ngP'), get('#ngC'), get('#ngF'));
        const diff = fromMacros - get('#ngKcal');
        note.textContent = 'Your macros add up to ' + fromMacros.toLocaleString() + ' kcal' +
          (Math.abs(diff) > 50 ? ' — ' + Math.abs(diff) + ' ' + (diff > 0 ? 'more' : 'less') + ' than your calorie goal' : ' — that matches your calorie goal');
        note.classList.toggle('off', Math.abs(diff) > 50);
      };
      paint();
      $$('input', body).forEach((i) => i.addEventListener('input', paint));
      $('#ngMatch', body).addEventListener('click', () => {
        $('#ngKcal', body).value = kcalFromMacros(get('#ngP'), get('#ngC'), get('#ngF'));
        paint();
      });
      $('#ngSave', body).addEventListener('click', () => {
        state.nutrition.targets = { kcal: get('#ngKcal'), protein: get('#ngP'), carbs: get('#ngC'), fat: get('#ngF') };
        save(); closeSheet(); render();
        toast('Goals updated');
      });
    });
  }

  /* a whole meal saved under one name, logged again in a single tap */
  function openSaveMealSheet(slot, key) {
    const items = mealsForDay(key).filter((m) => mealSlot(m) === slot);
    if (!items.length) return;
    const kcal = Math.round(items.reduce((t, m) => t + (m.kcal || 0), 0));
    openSheet('Save this meal', '' +
      '<p class="confirm-msg">' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' · ' + kcal + ' kcal. Saved meals show up at the top of the log sheet.</p>' +
      '<div class="field"><label for="smName">Name</label>' +
        '<input id="smName" type="text" placeholder="e.g. Usual breakfast" value="' + esc(items.map((m) => m.name)[0] || '') + '"></div>' +
      '<button class="btn btn-primary" id="smSave">Save meal</button>',
    (body) => {
      $('#smSave', body).addEventListener('click', () => {
        const name = $('#smName', body).value.trim();
        if (!name) { toast('Give it a name'); return; }
        if (!state.savedMeals) state.savedMeals = [];
        state.savedMeals.push({
          id: uid(), name, slot,
          items: items.map((m) => ({ name: m.name, kcal: m.kcal || 0, protein: m.protein || 0, carbs: m.carbs || 0, fat: m.fat || 0 })),
        });
        save(); closeSheet(); render();
        toast('Saved as "' + name + '"');
      });
    });
  }

  /* ---------- foods and portions ----------
     Every food carries the amount its numbers describe (100 g, 100 ml or one
     piece), so any portion is just arithmetic. Foods you type in yourself are
     kept in state.foods and offered back the next time. */

  const foodUnit = (f) => (f.unit === 'piece' ? 'piece' : f.unit === 'ml' ? 'ml' : 'g');
  const foodBase = (f) => Number(f.per) || (foodUnit(f) === 'piece' ? 1 : 100);
  const foodServing = (f) => Number(f.serving) || foodBase(f);

  // macros for `amount` of a food — one decimal, so 30 g of oats still counts
  function scaleFood(f, amount) {
    const k = (Number(amount) || 0) / foodBase(f);
    const r = (v) => Math.round((Number(v) || 0) * k * 10) / 10;
    return { kcal: Math.round((Number(f.kcal) || 0) * k), protein: r(f.protein), carbs: r(f.carbs), fat: r(f.fat) };
  }

  const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
  const amountLabel = (f, amount) => (foodUnit(f) === 'piece' ? round1(amount) + '×' : round1(amount) + ' ' + foodUnit(f));

  /* A portion you can count. Bread is weighed in grams, but nobody eats
     "112 g of bread" — they eat four slices. A food that knows how big one
     of them is, and what to call it, can be logged either way. */
  const foodPortion = (f) => (Number(f.serving) > 0 ? Number(f.serving) : 0);
  const foodSName = (f) => String(f.sname || '').trim();
  /* Whatever you called it — slice, scoop, bowl, riekė — is the word that is
     used. More than one only gets an -s when the word is plainly English and
     is not already plural; guessing a plural in someone else's language gets
     it wrong, so those are left exactly as typed. */
  const pluralise = (n, word) => {
    if (Number(n) === 1) return word;
    // "piece of bread" pluralises its first word, the way English does
    const parts = String(word).split(' ');
    const head = parts[0];
    if (!/^[a-z]+$/i.test(head)) return word;          // not English — leave it alone
    let out;
    if (/ss$|x$|z$|ch$|sh$/i.test(head)) out = head + 'es';
    else if (/s$/i.test(head)) out = head;             // already reads as plural
    else if (/[^aeiou]y$/i.test(head)) out = head.slice(0, -1) + 'ies';
    else out = head + 's';
    parts[0] = out;
    return parts.join(' ');
  };
  const servingWord = (f, n) => pluralise(n, foodSName(f) || 'portion');

  // one bar reads "Protein bar", two read "Protein bar · 2×", four slices
  // of a food that calls its portion a slice read "Bread · 4 slices"
  const portionName = (f, amount) => {
    if (foodUnit(f) === 'piece' && Number(amount) === 1) return f.name;
    const sname = foodSName(f), serv = foodPortion(f);
    if (sname && serv > 0 && foodUnit(f) !== 'piece') {
      const n = (Number(amount) || 0) / serv;
      const whole = Math.round(n);
      if (whole >= 1 && Math.abs(n - whole) < 0.01) return f.name + ' · ' + whole + ' ' + pluralise(whole, sname);
    }
    return f.name + ' · ' + amountLabel(f, amount);
  };

  /* The counter that sits above the amount box. Both show the same number:
     nudge the counter and the grams follow, type the grams and the count
     catches up. */
  function stepperHTML(f, id) {
    const serv = foodPortion(f);
    if (!serv || foodUnit(f) === 'piece') return '';
    return '<div class="portion-step" id="' + id + '">' +
      '<button class="chip-btn" data-step="-1" aria-label="One less">−</button>' +
      '<div class="ps-mid"><b class="ps-n">1</b> <i class="ps-lbl">' + esc(servingWord(f, 1)) + '</i>' +
        '<span class="ps-each">' + round1(serv) + ' ' + foodUnit(f) + ' each</span></div>' +
      '<button class="chip-btn chip-strong" data-step="1" aria-label="One more">+</button>' +
    '</div>';
  }
  function wireStepper(body, id, f, amtIn, onChange) {
    const box = $('#' + id, body);
    if (!box) return null;
    const serv = foodPortion(f);
    const nEl = $('.ps-n', box), lblEl = $('.ps-lbl', box);
    const show = () => {
      const n = round1((Number(amtIn.value) || 0) / serv);
      nEl.textContent = n;
      lblEl.textContent = servingWord(f, n);
    };
    $$('button[data-step]', box).forEach((b) => b.addEventListener('click', () => {
      const now = (Number(amtIn.value) || 0) / serv;
      // a half portion steps up to one and down to nothing below it
      const next = Number(b.dataset.step) > 0
        ? Math.floor(now + 0.0001) + 1
        : Math.max(1, Math.ceil(now - 0.0001) - 1);
      amtIn.value = round1(next * serv);
      show();
      haptic('tick');
      if (onChange) onChange();
    }));
    return show;
  }
  const perLabel = (f) => (foodUnit(f) === 'piece' ? 'each' : 'per ' + foodBase(f) + ' ' + foodUnit(f));
  const macroLine = (v) => Math.round(v.kcal) + ' kcal · P ' + round1(v.protein) + ' · C ' + round1(v.carbs) + ' · F ' + round1(v.fat);
  const baseName = (n) => String(n || '').split(' · ')[0];

  function myFoods() { return [...(state.foods || [])].sort((a, b) => (b.used || 0) - (a.used || 0)); }

  /* Adds a food to My foods, or refreshes one already there under that name. */
  function rememberFood(f) {
    if (!Array.isArray(state.foods)) state.foods = [];
    const name = String(f.name || '').trim();
    const same = state.foods.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const rec = {
      ...f, name,
      unit: foodUnit(f), per: foodBase(f), serving: foodServing(f),
      id: same ? same.id : uid(), used: Date.now(),
    };
    if (same) Object.assign(same, rec); else state.foods.push(rec);
    return rec;
  }
  /* One of your own foods, corrected: the numbers a scan got wrong, a better
     name, or the portion the "+" should log. Built-in foods are read-only. */
  function openFoodEditor(id, after) {
    const f = (state.foods || []).find((x) => x.id === id);
    if (!f) return;
    const u = foodUnit(f);
    const per = foodBase(f);
    const piece = u === 'piece';
    openSheet('Edit ' + f.name, '' +
      '<div class="field"><label for="feName">Name</label>' +
        '<input id="feName" type="text" value="' + esc(f.name) + '"></div>' +
      '<div class="seg" id="feUnit">' +
        [['g', 'Grams'], ['ml', 'Millilitres'], ['piece', 'Per piece']].map(([k, label]) =>
          '<button data-u="' + k + '" class="' + (k === u ? 'is-on' : '') + '">' + label + '</button>').join('') +
      '</div>' +
      '<p class="confirm-msg" id="feBasis">The numbers below are for ' + (piece ? 'one piece' : per + ' ' + u) + '.</p>' +
      '<div class="macro-fields">' +
        '<div class="field"><label for="feKcal">kcal</label><input id="feKcal" type="number" inputmode="decimal" min="0" value="' + round1(f.kcal) + '"></div>' +
        '<div class="field"><label for="feP">Protein</label><input id="feP" type="number" inputmode="decimal" min="0" value="' + round1(f.protein) + '"></div>' +
        '<div class="field"><label for="feC">Carbs</label><input id="feC" type="number" inputmode="decimal" min="0" value="' + round1(f.carbs) + '"></div>' +
        '<div class="field"><label for="feF">Fat</label><input id="feF" type="number" inputmode="decimal" min="0" value="' + round1(f.fat) + '"></div>' +
      '</div>' +
      '<div class="field"><label for="feServing">Usual portion</label>' +
        '<input id="feServing" type="number" inputmode="decimal" min="0" value="' + foodServing(f) + '"></div>' +
      '<div class="field" id="feSNameWrap"' + (piece ? ' hidden' : '') + '>' +
        '<label for="feSName">Call one of those… <span class="lbl-opt">optional</span></label>' +
        '<input id="feSName" type="text" placeholder="e.g. slice, scoop, bowl, handful" autocomplete="off" value="' + esc(foodSName(f)) + '">' +
        '<i class="field-hint">Then you can log four of them at once instead of one at a time.</i></div>' +
      '<button class="btn btn-primary" id="feSave" style="margin-top:14px">Save</button>' +
      '<button class="btn btn-danger" id="feDel" style="margin-top:10px">Forget this food</button>',
    (body) => {
      let unitNow = u;
      $$('#feUnit button', body).forEach((b) => b.addEventListener('click', () => {
        unitNow = b.dataset.u;
        $$('#feUnit button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        $('#feBasis', body).textContent = 'The numbers below are for ' +
          (unitNow === 'piece' ? 'one piece' : '100 ' + unitNow) + '.';
        $('#feSNameWrap', body).hidden = unitNow === 'piece';
      }));
      $('#feSave', body).addEventListener('click', () => {
        const name = $('#feName', body).value.trim();
        if (!name) { toast('Give it a name'); return; }
        const num = (sel) => Math.max(0, Number($(sel, body).value) || 0);
        Object.assign(f, {
          name,
          unit: unitNow,
          per: unitNow === 'piece' ? 1 : 100,
          serving: Math.max(0, Number($('#feServing', body).value) || (unitNow === 'piece' ? 1 : 100)),
          sname: unitNow === 'piece' ? '' : $('#feSName', body).value.trim(),
          kcal: num('#feKcal'), protein: num('#feP'), carbs: num('#feC'), fat: num('#feF'),
        });
        haptic('tick');
        save(); closeSheet();
        toast('Saved');
        if (after) queueMicrotask(after);
      });
      $('#feDel', body).addEventListener('click', () => {
        const gone = JSON.stringify(state.foods);
        state.foods = state.foods.filter((x) => x.id !== id);
        save(); closeSheet(); haptic('tap');
        if (after) queueMicrotask(after);
        toast(f.name + ' forgotten', false, {
          label: 'Undo',
          onClick: () => { state.foods = JSON.parse(gone); save(); haptic('tick'); if (after) after(); },
        });
      });
    });
  }

  function touchFood(id) {
    const mine = (state.foods || []).find((x) => x.id === id);
    if (mine) mine.used = Date.now();
  }

  /* One food, any portion: type the grams (or the count) and the macros follow. */
  function openPortionSheet(food, startSlot, key, opts = {}) {
    const date = key || dateKey();
    let slot = startSlot || slotFromTime(new Date().toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' }));
    const piece = foodUnit(food) === 'piece';
    /* A food that counts in slices has the counter above; a row of gram chips
       under it would only say the same thing twice. */
    const named = !piece && !!foodSName(food) && foodPortion(food) > 0;
    const quick = named ? []
      : [...new Set([foodServing(food), ...(piece ? [1, 2, 3] : [50, 100, 150, 200])])]
        .filter((n) => n > 0).sort((a, b) => a - b).slice(0, 5);

    openSheet(food.name, '' +
      '<div class="seg seg-slot" id="slotPick">' +
        MEAL_SLOTS.map(([k, title]) => '<button data-slot="' + k + '" class="' + (k === slot ? 'is-on' : '') + '">' + title + '</button>').join('') +
      '</div>' +
      '<p class="portion-per">' + macroLine(scaleFood(food, foodBase(food))) + ' ' + perLabel(food) + '</p>' +
      stepperHTML(food, 'pdStep') +
      '<div class="field"><label for="pdAmt">' + (piece ? 'How many' : 'Portion (' + foodUnit(food) + ')') + '</label>' +
        '<input id="pdAmt" type="number" inputmode="decimal" min="0" step="1" value="' + foodServing(food) + '"></div>' +
      (quick.length
        ? '<div class="quick-amounts" id="pdQuick">' +
            quick.map((n) => '<button class="qchip" data-amt="' + n + '">' + amountLabel(food, n) + '</button>').join('') +
          '</div>'
        : '') +
      '<div class="prod-macros" id="pdOut"></div>' +
      (opts.offerSave
        ? '<label class="switch-row" style="margin-top:14px"><span><b>Remember this food</b>' +
          '<i>Keeps it under My foods, with these numbers per ' + (piece ? 'piece' : foodBase(food) + ' ' + foodUnit(food)) + '</i></span>' +
          '<input type="checkbox" id="pdSave" checked></label>'
        : '') +
      '<button class="btn btn-primary" id="pdAdd" style="margin-top:16px">Add to log</button>',
    (body) => {
      const amtIn = $('#pdAmt', body), out = $('#pdOut', body);
      let showCount = null;
      const paint = () => {
        if (showCount) showCount();
        const v = scaleFood(food, amtIn.value);
        out.innerHTML =
          '<div><span class="micro">kcal</span><b>' + v.kcal + '</b></div>' +
          '<div><span class="micro">Protein</span><b>' + round1(v.protein) + 'g</b></div>' +
          '<div><span class="micro">Carbs</span><b>' + round1(v.carbs) + 'g</b></div>' +
          '<div><span class="micro">Fat</span><b>' + round1(v.fat) + 'g</b></div>';
        $$('#pdQuick .qchip', body).forEach((c) => c.classList.toggle('is-on', Number(c.dataset.amt) === Number(amtIn.value)));
      };
      showCount = wireStepper(body, 'pdStep', food, amtIn, paint);
      paint();
      amtIn.addEventListener('input', paint);
      $$('#pdQuick .qchip', body).forEach((c) => c.addEventListener('click', () => { amtIn.value = c.dataset.amt; paint(); }));
      $$('#slotPick button', body).forEach((b) => b.addEventListener('click', () => {
        slot = b.dataset.slot;
        $$('#slotPick button', body).forEach((x) => x.classList.toggle('is-on', x === b));
      }));
      $('#pdAdd', body).addEventListener('click', () => {
        const amount = Number(amtIn.value) || 0;
        if (!amount) { toast(piece ? 'Enter how many' : 'Enter a portion size'); return; }
        const v = scaleFood(food, amount);
        logMeal({
          name: portionName(food, amount), ...v,
          base: {
            name: food.name, unit: foodUnit(food), per: foodBase(food),
            serving: foodPortion(food) || undefined, sname: foodSName(food) || undefined,
            ...scaleFood(food, foodBase(food)),
          },
          amount,
        }, slot, date);
        haptic('tick');
        if (opts.offerSave && $('#pdSave', body) && $('#pdSave', body).checked) {
          // a food that already knows its portion keeps it — logging four
          // slices must not turn four slices into one
          rememberFood({ ...food, serving: foodPortion(food) || amount });
        }
        else if (food.id) touchFood(food.id);
        save(); closeSheet(); mealDayOffset = 0; goTab('meals');
        toast('Logged ' + v.kcal + ' kcal');
      });
    });
  }

  function openMealSheet(key = dateKey(), slot = null) {
    if (!slot) slot = slotFromTime(new Date().toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' }));
    // one-off entries logged before, newest first — anything already in a food
    // list is skipped, since those can be logged at any portion instead
    const known = new Set([...FOOD_LIBRARY, ...(state.foods || [])].map((f) => f.name.toLowerCase()));
    const recents = [];
    for (const m of [...state.nutrition.meals].reverse()) {
      const b = baseName(m.name);
      if (known.has(b.toLowerCase()) || recents.some((r) => baseName(r.name) === b)) continue;
      recents.push(m);
      if (recents.length >= 5) break;
    }

    // a food with a per-100 (or per-piece) basis: the row opens portions, + logs the usual serving
    const basisRow = (f, mine) => {
      const data = esc(JSON.stringify({
        id: f.id, name: f.name, unit: foodUnit(f), per: foodBase(f), serving: foodServing(f),
        sname: foodSName(f),
        kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat,
      }));
      return '<div class="lib-item" data-food="' + data + '" role="button" tabindex="0">' +
        '<div><div class="li-name">' + esc(f.name) + '</div>' +
          '<div class="li-sub">' + Math.round(f.kcal) + ' kcal ' + perLabel(f) + ' · P ' + round1(f.protein) + ' C ' + round1(f.carbs) + ' F ' + round1(f.fat) + '</div></div>' +
        '<div class="li-actions">' +
          (mine ? '<button class="saved-edit" data-editfood="' + esc(f.id) + '" aria-label="Edit ' + esc(f.name) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/></svg></button>' : '') +
          (() => {
            const one = foodSName(f) && foodUnit(f) !== 'piece'
              ? '1 ' + foodSName(f) : amountLabel(f, foodServing(f));
            return '<button class="li-add" data-quick="' + data + '" aria-label="Log ' + esc(one) + '">+ ' + esc(one) + '</button>';
          })() +
        '</div></div>';
    };

    // something logged by hand once — no basis to scale, so it goes in as it was
    const recentRow = (m) => '<div class="lib-item" data-recent="' +
      esc(JSON.stringify({ name: m.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat })) + '" role="button" tabindex="0">' +
      '<div><div class="li-name">' + esc(m.name) + '</div>' +
        '<div class="li-sub">' + macroLine(m) + '</div></div>' +
      '<span class="li-best">+</span></div>';

    const savedHtml = () => {
      const mine = (state.savedMeals || []).filter((m) => !m.slot || m.slot === slot);
      if (!mine.length) return '';
      return '<div class="lib-group-title">Saved meals</div>' + mine.map((m) => {
        const kcal = Math.round(m.items.reduce((t, x) => t + (x.kcal || 0), 0));
        return '<div class="lib-item" data-saved="' + esc(m.id) + '" role="button" tabindex="0">' +
          '<div><div class="li-name">' + esc(m.name) + '</div>' +
            '<div class="li-sub">' + m.items.length + ' items · ' + kcal + ' kcal</div></div>' +
          '<button class="saved-del" data-delsaved="' + esc(m.id) + '" aria-label="Forget this meal">×</button></div>';
      }).join('');
    };

    const listHtml = (q) => {
      const query = q.trim().toLowerCase();
      const hit = (f) => !query || f.name.toLowerCase().includes(query);
      const mine = myFoods().filter(hit);
      const rec = recents.filter(hit);
      const lib = FOOD_LIBRARY.filter(hit);
      let html = '';
      if (mine.length) html += '<div class="lib-group-title">My foods</div>' + mine.map((f) => basisRow(f, true)).join('');
      if (rec.length) html += '<div class="lib-group-title">Logged before</div>' + rec.map(recentRow).join('');
      if (lib.length) html += '<div class="lib-group-title">Common foods</div>' + lib.map((f) => basisRow(f, false)).join('');
      if (!html) html = '<p class="empty-note">No matches — add it under Custom entry and it will be waiting here next time.</p>';
      return html;
    };

    openSheet('Log a meal', `
      <div class="seg seg-slot" id="slotPick">
        ${MEAL_SLOTS.map(([k, title]) => `<button data-slot="${k}" class="${k === slot ? 'is-on' : ''}">${title}</button>`).join('')}
      </div>
      <div class="search-row">
        <input class="search-field" id="foodSearch" type="search" placeholder="Search foods…" autocomplete="off">
        <button class="scan-btn" id="scanBtn" aria-label="Scan a barcode">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5M7.5 12h9"/></svg>
        </button>
      </div>
      <p class="portion-per">Tap a food to set the grams, or + to log the usual portion.</p>
      <div id="savedList">${savedHtml()}</div>
      <div id="foodList">${listHtml('')}</div>
      <div class="section-title">Custom entry</div>
      <div class="field"><label for="cmName">Name</label><input id="cmName" type="text" placeholder="e.g. Chicken bowl"></div>
      <div class="field" id="cmUnitWrap">
        <label>The numbers are for</label>
        <div class="seg seg-unit" id="cmUnit">
          <button data-u="whole" class="is-on">whole</button>
          <button data-u="g">g</button>
          <button data-u="ml">ml</button>
          <button data-u="piece">item</button>
        </div>
      </div>
      <div class="amount-row" id="cmAmtWrap" hidden>
        <div class="field"><label for="cmAmt">Amount</label><input id="cmAmt" type="number" inputmode="decimal" min="0" value="100"></div>
      </div>
      <p class="portion-per" id="cmHint">Enter what the whole thing has — no weighing.</p>
      <div class="field" id="cmSNameWrap">
        <label for="cmSName">Call one of those… <span class="lbl-opt">optional</span></label>
        <input id="cmSName" type="text" placeholder="e.g. slice, scoop, bowl, handful" autocomplete="off">
        <i class="field-hint">Then you can log four of them at once instead of one at a time.</i>
      </div>
      <div class="field-row">
        <div class="field"><label for="cmKcal">kcal</label><input id="cmKcal" type="number" inputmode="decimal" min="0" placeholder="0"></div>
        <div class="field"><label for="cmProtein">Protein g</label><input id="cmProtein" type="number" inputmode="decimal" min="0" placeholder="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="cmCarbs">Carbs g</label><input id="cmCarbs" type="number" inputmode="decimal" min="0" placeholder="0"></div>
        <div class="field"><label for="cmFat">Fat g</label><input id="cmFat" type="number" inputmode="decimal" min="0" placeholder="0"></div>
      </div>
      <label class="switch-row">
        <span><b>Remember this food</b><i id="cmSaveWhy">Keeps it under My foods, so next time it is one tap</i></span>
        <input type="checkbox" id="cmSave" checked>
      </label>
      <button class="btn btn-primary" id="cmAdd" style="margin-top:16px">Add meal</button>
    `, (body) => {
      const addMeal = (f) => {
        logMeal(f, slot, key);
        haptic('tick');
        save(); closeSheet();
        mealDayOffset = 0;
        goTab('meals');
        toast(`${f.name} logged`);
      };

      $$('#slotPick button', body).forEach((b) => b.addEventListener('click', () => {
        slot = b.dataset.slot;
        $$('#slotPick button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        $('#savedList', body).innerHTML = savedHtml();
      }));

      $('#scanBtn', body).addEventListener('click', () => openScanner((code) => lookupBarcode(code, slot, key)));

      const search = $('#foodSearch', body);
      const list = $('#foodList', body);
      search.addEventListener('input', () => { list.innerHTML = listHtml(search.value); });
      list.addEventListener('click', (e) => {
        const edit = e.target.closest('[data-editfood]');
        if (edit) {
          const id = edit.dataset.editfood;
          closeSheetNow();
          queueMicrotask(() => openFoodEditor(id, () => { closeSheetNow(); openMealSheet(key, slot); }));
          return;
        }
        const quick = e.target.closest('[data-quick]');
        if (quick) {
          const f = JSON.parse(quick.dataset.quick);
          const amount = foodServing(f);
          if (f.id) touchFood(f.id);
          addMeal({ name: portionName(f, amount), ...scaleFood(f, amount) });
          return;
        }
        const again = e.target.closest('[data-recent]');
        if (again) { addMeal(JSON.parse(again.dataset.recent)); return; }
        const item = e.target.closest('[data-food]');
        if (item) { closeSheetNow(); openPortionSheet(JSON.parse(item.dataset.food), slot, key); }
      });

      const savedBox = $('#savedList', body);
      savedBox.addEventListener('click', (e) => {
        const del = e.target.closest('[data-delsaved]');
        if (del) {
          const gone = JSON.stringify(state.savedMeals);
          const meal = state.savedMeals.find((m) => m.id === del.dataset.delsaved);
          state.savedMeals = state.savedMeals.filter((m) => m.id !== del.dataset.delsaved);
          save(); savedBox.innerHTML = savedHtml(); haptic('tap');
          toast((meal ? meal.name : 'Meal') + ' forgotten', false, {
            label: 'Undo',
            onClick: () => {
              state.savedMeals = JSON.parse(gone);
              save(); savedBox.innerHTML = savedHtml(); haptic('tick');
            },
          });
          return;
        }
        const pick = e.target.closest('[data-saved]');
        if (!pick) return;
        const meal = state.savedMeals.find((m) => m.id === pick.dataset.saved);
        if (!meal) return;
        meal.items.forEach((it) => logMeal(it, slot, key));
        save(); closeSheet(); goTab('meals');
        toast(meal.name + ' logged');
      });

      /* Custom entry. A plate in a restaurant has no gram figure on it — you
         know what the whole thing came to and nothing else — so that is what
         it asks for by default, and the amount box only appears when the
         numbers really do describe some quantity of something. Underneath,
         "the lot" is one item you had one of, so it can still be logged
         twice, or edited, like anything else. */
      let cUnit = 'whole';
      const hint = $('#cmHint', body), amt = $('#cmAmt', body);
      const whole = () => cUnit === 'whole';
      const paintHint = () => {
        const n = Number(amt.value) || 0;
        hint.textContent = whole()
          ? 'Enter what the whole thing has — no weighing.'
          : cUnit === 'piece'
            ? (n === 1 ? 'Enter what is in one of them.' : 'Enter what is in ' + round1(n) + ' of them.')
            : 'Enter what is in ' + round1(n) + ' ' + cUnit + ' of it.';
        $('#cmAmtWrap', body).hidden = whole();
        // counting pieces is already counting; naming the portion adds nothing
        $('#cmSNameWrap', body).hidden = whole() || cUnit === 'piece';
        $('#cmSaveWhy', body).textContent = whole()
          ? 'Keeps it under My foods, so next time it is one tap'
          : 'Keeps it under My foods so you never type it twice — any portion works from then on';
        $('#cmAdd', body).textContent = whole() ? 'Add meal' : 'Add ' + round1(n) + (cUnit === 'piece' ? '×' : ' ' + cUnit);
      };
      paintHint();
      amt.addEventListener('input', paintHint);
      $$('#cmUnit button', body).forEach((b) => b.addEventListener('click', () => {
        cUnit = b.dataset.u;
        $$('#cmUnit button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        if (cUnit === 'piece' && Number(amt.value) === 100) amt.value = 1;
        if (cUnit !== 'piece' && Number(amt.value) === 1) amt.value = 100;
        paintHint();
      }));

      $('#cmAdd', body).addEventListener('click', () => {
        const name = $('#cmName', body).value.trim();
        const num = (sel) => Number($(sel, body).value) || 0;
        // one whole thing, of which you had one
        const unit = whole() ? 'piece' : cUnit;
        const amount = whole() ? 1 : Number(amt.value) || 0;
        const macros = { kcal: num('#cmKcal'), protein: num('#cmProtein'), carbs: num('#cmCarbs'), fat: num('#cmFat') };
        if (!name) { toast('Give the meal a name'); return; }
        if (!macros.kcal) { toast('Enter calories'); return; }
        if (!amount) { toast('Enter an amount'); return; }
        const sname = whole() ? '' : $('#cmSName', body).value.trim();
        const basis = { name, unit, per: unit === 'piece' ? 1 : 100, serving: amount, sname };
        if ($('#cmSave', body).checked) {
          const factor = (unit === 'piece' ? 1 : 100) / amount;
          rememberFood({
            ...basis,
            kcal: round1(macros.kcal * factor), protein: round1(macros.protein * factor),
            carbs: round1(macros.carbs * factor), fat: round1(macros.fat * factor),
          });
        }
        addMeal({
          name: portionName(basis, amount), ...macros,
          base: { name, unit, per: unit === 'piece' ? 1 : 100, serving: amount, sname: sname || undefined,
            ...(() => { const k = (unit === 'piece' ? 1 : 100) / amount;
              return { kcal: Math.round(macros.kcal * k), protein: round1(macros.protein * k),
                carbs: round1(macros.carbs * k), fat: round1(macros.fat * k) }; })() },
          amount,
        });
      });
    });
  }

  /* ================= WORKOUT TAB ================= */

  // month of dots — one per day, filled when the day is in \`days\`
  function monthDots(monthDate, days) {
    const y = monthDate.getFullYear(), m = monthDate.getMonth();
    const total = new Date(y, m + 1, 0).getDate();
    const todayK = dateKey();
    let out = '';
    for (let i = 1; i <= total; i++) {
      const k = dateKey(new Date(y, m, i));
      out += '<span class="dot ' + (days.has(k) ? 'on' : '') + (k === todayK ? ' today' : '') + '"></span>';
    }
    // how many sessions that month, next to its name
    let count = 0;
    for (let i = 1; i <= total; i++) if (days.has(dateKey(new Date(y, m, i)))) count++;
    return '<div class="dot-month"><span class="dm-label">' +
      monthDate.toLocaleDateString(undefined, { month: 'short' }) +
      (count ? ' · <b class="dm-count">' + count + '</b>' : '') +
      '</span><div class="dm-grid">' + out + '</div></div>';
  }

  /* what a session actually contained, for the card that stands in for it */
  function sessionExercises(w, max = 3) {
    const names = (w.exercises || []).map((e) => exerciseById(e.exerciseId)?.name).filter(Boolean);
    if (!names.length) return 'No exercises';
    const short = names.slice(0, max).map((n) => n.replace(/^(Barbell|Dumbbell|Cable|Machine|Seated) /, ''));
    return short.join(' · ') + (names.length > max ? ' +' + (names.length - max) : '');
  }

  function renderWorkout() {
    const v = $('#view');
    const templates = allTemplates();
    const active = state.activeWorkout;
    const last = state.workouts[0];
    const lw = latestWeight();
    const workoutDays = new Set(state.workouts.map((w) => dateKey(new Date(w.startedAt))));
    const now = new Date();
    // the plan card carries dates, and can be dragged back and forth a week
    // at a time — the plan itself repeats, what changes is which days it hit
    const planMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + planWeekOffset * 7);
    const planThu = new Date(planMonday); planThu.setDate(planThu.getDate() + 3);
    const planWeekLabel = 'Week ' + (Math.floor((planThu.getDate() - 1) / 7) + 1) + ' · ' +
      planThu.toLocaleDateString(undefined, { month: 'long' });
    const weekAgo = Date.now() - 7 * 864e5;
    const vol7 = state.workouts.filter((w) => w.startedAt >= weekAgo).reduce((t, w) => t + workoutVolume(w), 0);
    const count7 = state.workouts.filter((w) => w.startedAt >= weekAgo).length;
    const streak = streakWeeks();
    const ago = (ts) => {
      const min = Math.round((Date.now() - ts) / 60000);
      if (min < 60) return min + ' min ago';
      const h = Math.round(min / 60);
      if (h < 24) return h + ' h ago';
      const d = Math.round(h / 24);
      return d === 1 ? 'yesterday' : d + ' days ago';
    };

    v.innerHTML =
      '<div class="page-head">' +
        '<div><h2>Workouts</h2><p class="subtitle">' + (active ? 'Session in progress' : 'Track and improve') + '</p></div>' +
        '<button class="icon-btn" id="newRoutine" aria-label="New routine"><svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13"/></svg></button>' +
      '</div>' +

      (active ?
      '<div class="card wk-active">' +
        '<div class="wa-top"><span class="wa-live"></span><span class="micro">Active session</span></div>' +
        '<h3>' + esc(active.name) + '</h3>' +
        '<p class="muted">' + loggedSets(active).length + ' sets logged · started ' + fmtDuration(Date.now() - active.startedAt) + ' ago</p>' +
        '<button class="btn btn-primary" id="resumeWorkout">Resume workout</button>' +
      '</div>' : '') +

      '<div class="wk-grid2">' +
        '<button class="card wk-stat wk-last" id="wkLast">' +
          '<span class="micro">Last session</span>' +
          '<div class="ws-name">' + (last ? esc(last.name) : 'No sessions yet') + '</div>' +
          (last
            ? '<div class="ws-ex">' + esc(sessionExercises(last)) + '</div>' +
              '<div class="ws-sub">' + esc(fmtShortDate(last.startedAt)) + ' · ' + loggedSets(last).length + ' sets' +
                (last.endedAt ? ' · ' + esc(fmtDuration(last.endedAt - last.startedAt)) : '') + '</div>'
            : '<div class="ws-sub">Start your first workout</div>') +
        '</button>' +
        '<button class="card wk-stat" id="wkWeight">' +
          '<span class="micro">Body weight</span>' +
          '<div class="ws-big">' + (lw ? fmtNum(lw.value) : '—') + '<i>' + esc(unit()) + '</i></div>' +
          '<div class="ws-sub">' + (lw ? esc(fmtShortDate(new Date(lw.date + 'T12:00:00').getTime())) : 'Tap to log') + '</div>' +
        '</button>' +
      '</div>' +

      '<div class="card wk-cons">' +
        '<div class="wc-head"><span class="micro">Consistency</span>' +
          '<span class="wc-note">' + state.workouts.length + ' total' + (streak >= 2 ? ' · ' + streak + '-week streak' : '') + '</span></div>' +
        '<div class="dot-months">' +
          monthDots(new Date(now.getFullYear(), now.getMonth() - 2, 1), workoutDays) +
          monthDots(new Date(now.getFullYear(), now.getMonth() - 1, 1), workoutDays) +
          monthDots(new Date(now.getFullYear(), now.getMonth(), 1), workoutDays) +
        '</div>' +
      '</div>' +

      '<div class="card wk-vol">' +
        '<div><span class="micro">Volume lifted</span><span class="wv-sub">Last 7 days · ' + count7 + ' session' + (count7 === 1 ? '' : 's') + '</span></div>' +
        '<div class="wv-num" data-roll="vol7" data-roll-to="' + Math.round(vol7) + '">' + Math.round(vol7).toLocaleString() + '<i>' + esc(unit()) + '</i></div>' +
      '</div>' +

      muscleBalanceHTML() +

      '<div class="card wk-plan week-wrap">' +
        '<div class="wc-head"><span class="micro">Weekly plan</span><span class="wc-note">' +
          (weekOverride(planWeekOffset) ? 'Moved for this week' : 'Tap a day to set it') + '</span></div>' +
        '<div class="ws-head">' +
          '<button class="ws-nav" id="plPrev" aria-label="Earlier week">‹</button>' +
          '<button class="ws-label' + (planWeekOffset ? ' is-off' : '') + '" id="plLabel">' + planWeekLabel +
            (planWeekOffset ? '<i>back to this week</i>' : '') + '</button>' +
          '<button class="ws-nav" id="plNext" aria-label="Later week"' + (planWeekOffset >= 4 ? ' disabled' : '') + '>›</button>' +
        '</div>' +
        '<div class="plan-row">' +
          DOW_LABELS.map((L, i) => {
            const t = plannedOn(i, planWeekOffset);
            const d = new Date(planMonday); d.setDate(d.getDate() + i);
            const key = dateKey(d);
            const trained = workoutDays.has(key);
            return '<button class="plan-day ' + (key === dateKey() ? 'is-today' : '') + (t && t.rest ? ' is-rest' : t ? ' is-set' : '') +
              (trained ? ' is-done' : '') + '" data-plan="' + i + '">' +
              '<span>' + L.slice(0, 1) + ' ' + d.getDate() + '</span><b>' + esc(planShort(t)) + '</b></button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<button class="btn btn-primary wk-start" id="startEmpty">Start empty workout</button>' +

      '<div class="section-title">Routines</div>' +
      '<div class="tpl-list">' +
        templates.map((t) =>
          '<div class="tpl-item" data-tpl="' + esc(t.id) + '" role="button" tabindex="0">' +
            '<div>' +
              '<div class="li-name">' + esc(t.name) + '</div>' +
              '<div class="li-sub">' + t.exercises.length + ' exercise' + (t.exercises.length === 1 ? '' : 's') + ' · ' +
                t.exercises.map((e) => exerciseById(e.exerciseId)?.name).filter(Boolean).slice(0, 3).join(' · ') +
                (t.exercises.length > 3 ? ' · …' : '') + '</div>' +
            '</div>' +
            '<div class="tpl-acts">' +
              '<button class="icon-btn" data-edit-tpl="' + esc(t.id) + '" aria-label="Edit routine">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/></svg></button>' +
              '<button class="icon-btn" data-del-tpl="' + esc(t.id) + '" aria-label="Delete routine">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13M10 11v6M14 11v6"/></svg></button>' +
            '</div>' +
          '</div>').join('') +
        (templates.length ? '' : '<p class="empty-note" style="padding:14px">No routines. Add one, or bring the originals back.</p>') +
        '<button class="tpl-add" id="newRoutine2">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>New routine</button>' +
      '</div>' +


      '';

    if (active) $('#resumeWorkout').addEventListener('click', () => { workoutOpen = true; openWkEntry(); render(); });
    $('#startEmpty').addEventListener('click', () => startWorkout());
    $('#newRoutine').addEventListener('click', () => openRoutineBuilder());
    $('#newRoutine2').addEventListener('click', () => openRoutineBuilder());

    $('#wkWeight').addEventListener('click', openWeightSheet);
    $$('.plan-day', v).forEach((b) => b.addEventListener('click', () => openPlanPicker(Number(b.dataset.plan), planWeekOffset)));
    const showPlanWeek = (off) => { planWeekOffset = Math.max(-52, Math.min(4, off)); render(); };
    $('#plPrev', v).addEventListener('click', () => showPlanWeek(planWeekOffset - 1));
    $('#plNext', v).addEventListener('click', () => showPlanWeek(planWeekOffset + 1));
    $('#plLabel', v).addEventListener('click', () => showPlanWeek(0));
    const planCard = $('.wk-plan', v);
    let planTouch = null;
    planCard.addEventListener('touchstart', (e) => {
      planTouch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() } : null;
    }, { passive: true });
    planCard.addEventListener('touchend', (e) => {
      if (!planTouch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - planTouch.x, dy = t.clientY - planTouch.y;
      const quick = Date.now() - planTouch.at < 700;
      planTouch = null;
      if (!quick || Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      claimGesture();
      showPlanWeek(planWeekOffset + (dx < 0 ? 1 : -1));
    }, { passive: true });
    $('#wkLast').addEventListener('click', () => { if (last) { progressSeg = 'history'; expandedHistoryId = last.id; goTab('profile'); } });
    $$('.tpl-item', v).forEach((el) => {
      el.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-del-tpl]');
        if (delBtn) {
          const id = delBtn.dataset.delTpl;
          const tpl = templateById(id);
          const planned = (state.schedule || []).filter((x) => x === id).length;
          confirmAction({
            title: 'Delete routine',
            message: 'Delete "' + esc(tpl ? tpl.name : 'this routine') + '"? Workouts you already logged from it stay in your history.' +
              (planned ? ' ' + planned + ' day' + (planned === 1 ? '' : 's') + ' in your weekly plan will be cleared.' : '') +
              (isBuiltinId(id) ? ' It came with the app, so you can bring it back later.' : ''),
            confirm: 'Delete routine',
            onConfirm: () => undoable('Routine deleted', () => {
              state.templates = (state.templates || []).filter((t) => t.id !== id);
              if (isBuiltinId(id)) state.tplHidden = [...new Set([...(state.tplHidden || []), id])];
              state.schedule = (state.schedule || []).map((x) => (x === id ? null : x));
            }),
          });
          return;
        }
        const editBtn = e.target.closest('[data-edit-tpl]');
        if (editBtn) { openRoutineBuilder(editBtn.dataset.editTpl); return; }
        startWorkout(el.dataset.tpl);
      });
      longPress(el, () => openTemplateMenu(el.dataset.tpl));
    });
  }

  /* Hold a routine for the things you do to one now and then: copy it as the
     start of the next one, or move it up the list. */
  function openTemplateMenu(id) {
    const tpl = templateById(id);
    if (!tpl) return;
    const list = allTemplates().map((t) => t.id);
    const at = list.indexOf(id);
    haptic('tap');
    openSheet(tpl.name, `
      <div class="menu-list">
        <button class="menu-item" data-act="up" ${at <= 0 ? 'disabled' : ''}>↑ &nbsp;Move up</button>
        <button class="menu-item" data-act="down" ${at >= list.length - 1 ? 'disabled' : ''}>↓ &nbsp;Move down</button>
        <button class="menu-item" data-act="copy">⧉ &nbsp;Duplicate</button>
        <button class="menu-item" data-act="edit">✎ &nbsp;Edit</button>
      </div>`, (body) => {
      body.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b || b.disabled) return;
        const act = b.dataset.act;
        if (act === 'edit') { closeSheetNow(); openRoutineBuilder(id); return; }
        if (act === 'copy') {
          const made = duplicateTemplate(id);
          haptic('tick');
          closeSheet(); save(); render();
          toast('Copied as "' + made.name + '"');
          return;
        }
        if (moveTemplate(id, act === 'up' ? -1 : 1)) { haptic('tick'); save(); }
        closeSheet(); render();
      });
    });
  }

  function confirmDiscard(fromLogger) {
    const w = state.activeWorkout;
    const sets = w ? loggedSets(w).length : 0;
    confirmAction({
      title: w && w.editingId ? 'Discard changes' : 'Discard workout',
      message: w && w.editingId
        ? 'Your edits are thrown away. The saved workout stays exactly as it was.'
        : sets
          ? sets + ' logged set' + (sets === 1 ? '' : 's') + ' will be deleted. This cannot be undone.'
          : 'Nothing has been logged yet, so nothing will be lost.',
      confirm: w && w.editingId ? 'Discard changes' : 'Discard workout',
      onConfirm: () => {
        state.activeWorkout = null;
        workoutOpen = false;
        if (fromLogger) closeWkEntry();
        save(); render();
      },
    });
  }

  /* Opening the app on a session you walked away from. Saying nothing and
     letting the clock run to 48:00:01 is the one thing that is certainly
     wrong, so it asks — and offers the time you actually stopped. */
  function checkStaleWorkout() {
    const w = state.activeWorkout;
    if (!workoutStale(w)) return;
    const sets = loggedSets(w).length;
    const ended = workoutEndedAt(w);
    const idle = fmtDuration(workoutIdle(w));
    openSheet('Still running', `
      <p class="confirm-msg">"${esc(w.name)}" has been open for ${esc(idle)} without a set.
      ${sets ? 'It looks like you finished and forgot to say so.' : 'Nothing was ever logged in it.'}</p>
      ${sets ? `<button class="btn btn-primary" id="swFinish">Finish it — ${sets} set${sets === 1 ? '' : 's'}, ended ${esc(new Date(ended).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</button>` : ''}
      <button class="btn btn-danger" id="swDrop" style="margin-top:10px">Throw it away</button>
      <button class="btn btn-quiet" id="swKeep" style="margin-top:10px">Still doing it</button>
    `, (body) => {
      $('#swFinish', body)?.addEventListener('click', () => {
        closeSheetNow();
        workoutOpen = true;
        openWkEntry();
        render();
        queueMicrotask(finishWorkout);
      });
      $('#swDrop', body).addEventListener('click', () => {
        closeSheetNow();
        confirmDiscard(false);
      });
      $('#swKeep', body).addEventListener('click', () => {
        /* Carrying on means carrying on from now — otherwise the duration
           still counts the hours it sat there. */
        const gap = Date.now() - (lastSetAt(w) ?? w.startedAt);
        w.startedAt += gap;
        closeSheet();
        save(); render();
      });
    });
  }

  /* -------- full-screen workout logger (Hevy-style) -------- */

  let wkScrollTo = null;   // index of an exercise to bring into view after a rebuild
  let flashSet = null;     // 'exIdx:setIdx' of a set just logged, so its row can light up

  function renderWorkoutOverlay() {
    const root = $('#workoutRoot');
    const w = state.activeWorkout;
    document.body.classList.toggle('has-mini', !!w && !workoutOpen);
    document.body.classList.toggle('wk-open', !!w && workoutOpen);
    syncWorkoutNote();
    // every tick, every added set rebuilds this overlay — remember where the
    // list was so logging a set does not throw you back to the first exercise
    const openBody = $('.wk-body', root);
    const keptScroll = openBody ? openBody.scrollTop : null;
    // the overlay is rebuilt on every tick, so its entrance must only play the
    // first time — replaying it on each logged set is what made the screen jump
    const wasShowing = !!openBody;
    syncWakeLock();
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
          confirmDiscard(false);
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
      <div class="wk-overlay${wasShowing ? '' : ' wk-enter'}">
        <div class="wk-bar">
          <button class="icon-btn" id="wkMin" aria-label="Minimize workout">
            <svg viewBox="0 0 24 24"><path d="m5 9 7 7 7-7"/></svg>
          </button>
          <b class="wk-title">${w.editingId ? 'Editing · ' : ''}${esc(w.name)}</b>
          <button class="chip-btn chip-strong" id="wkFinishTop">${w.editingId ? 'Save' : 'Finish'}</button>
        </div>
        <div class="wk-stats">
          <div><span class="micro">Duration</span><b id="wkDur">${w.editingId ? fmtDuration((w.finishedAt || w.startedAt) - w.startedAt) : fmtElapsed(Date.now() - w.startedAt)}</b></div>
          <div class="wk-vol-cell"><span class="micro">Volume</span><b>${fmtNum(Math.round(vol))} ${esc(unit())}</b></div>
          <div><span class="micro">Sets</span><b>${done.length}</b></div>
        </div>
        <div class="wk-body">
          ${w.exercises.map((ex, exIdx) => renderExerciseBlock(ex, exIdx, ssPos(w.exercises, exIdx))).join('')}
          <button class="btn btn-ghost" id="addExercise" style="margin-bottom:12px">+ Add exercise</button>
          <button class="btn btn-danger" id="cancelWorkout" style="margin-bottom:8px">Discard workout</button>
        </div>
      </div>`;

    ensureElapsedTimer();

    const wkBody = $('.wk-body', root);
    if (keptScroll != null && wkBody) wkBody.scrollTop = keptScroll;
    if (flashSet) {
      // the row is rebuilt by the time we get here, so the class goes on the
      // fresh one; it only drives a one-shot animation
      const [ei, si] = flashSet.split(':');
      const row = $('.ex-block[data-ex="' + ei + '"] .set-row[data-set="' + si + '"]', root);
      if (row) row.classList.add('just-logged');
      flashSet = null;
    }
    if (wkScrollTo != null && wkBody) {
      // a brand new exercise: bring it into view instead of holding the old spot
      const block = $$('.ex-block', root)[wkScrollTo];
      if (block) wkBody.scrollTop = Math.max(0, block.offsetTop - 12);
      wkScrollTo = null;
    }

    $('#wkMin', root).addEventListener('click', () => { workoutOpen = false; closeWkEntry(); render(); });
    $('#wkFinishTop', root).addEventListener('click', finishWorkout);
    $('#addExercise', root).addEventListener('click', () => openExercisePicker((exId) => {
      w.exercises.push(newExerciseEntry(exId, isCardio(exId) ? 1 : 3));
      wkScrollTo = w.exercises.length - 1;
      save(); render();
    }));
    $('#cancelWorkout', root).addEventListener('click', () => confirmDiscard(true));

    $$('.ex-block', root).forEach((block) => {
      const exIdx = Number(block.dataset.ex);
      const ex = w.exercises[exIdx];
      const cardio = isCardio(ex.exerciseId);
      const prev = previousSets(ex.exerciseId);

      $('.ex-name', block).addEventListener('click', () => openExerciseDetail(ex.exerciseId));
      $('.ex-menu', block).addEventListener('click', () => openExerciseMenu(exIdx));
      $('.ex-note-line', block).addEventListener('click', () => openNoteSheet(ex));
      const hintBtn = $('.ex-hint', block);
      if (hintBtn) hintBtn.addEventListener('click', () => {
        const h = overloadHint(ex);
        if (!h) return;
        let filled = 0;
        ex.sets.forEach((st) => {
          if (st.done || (st.type || 'N') === 'W') return;
          st.weight = h.weight; st.reps = h.reps; filled++;
        });
        if (!filled) { toast('Every set is already logged'); return; }
        save(); render();
        toast('Filled in ' + fmtNum(h.weight) + ' ' + unit() + ' × ' + h.reps);
      });
      $('.add-set', block).addEventListener('click', () => {
        ex.sets.push({ weight: null, reps: null, done: false });
        save(); render();
      });
      $$('.set-row', block).forEach((row) => {
        const setIdx = Number(row.dataset.set);
        const set = ex.sets[setIdx];
        $('.set-num', row).addEventListener('click', () => openSetSheet(ex, setIdx));
        const rpeBtn = $('.set-rpe', row);
        if (rpeBtn) rpeBtn.addEventListener('click', () => openRpeSheet(set));
        /* On a machine you set two of the three and the third follows: give it
           a time and a speed and the distance appears, give it a time and a
           distance and the speed does. Only ever into an empty box, so a
           number you typed is never rewritten. */
        const fillCardio = () => {
          if (!cardio) return;
          if (set.weight == null && set.reps && set.kmh) {
            const km = cardioDistance(set.reps, set.kmh);
            if (km) { set.weight = km; const b = $('.in-weight', row); if (b && b.value === '') b.value = km; }
          } else if (set.kmh == null && set.reps && set.weight) {
            const kmh = cardioSpeed(set.reps, set.weight);
            if (kmh) { set.kmh = kmh; const b = $('.in-kmh', row); if (b && b.value === '') b.value = kmh; }
          }
        };
        $('.in-weight', row)?.addEventListener('input', (e) => {
          set.weight = e.target.value === '' ? null
            : (cardio ? Number(e.target.value) : fromExUnit(e.target.value, ex));
          fillCardio();
          save();
        });
        $('.in-reps', row).addEventListener('input', (e) => {
          set.reps = e.target.value === '' ? null : Number(e.target.value);
          fillCardio();
          save();
        });
        $('.in-kmh', row)?.addEventListener('input', (e) => {
          set.kmh = e.target.value === '' ? null : Number(e.target.value);
          fillCardio();
          save();
        });
        $('.in-incl', row)?.addEventListener('input', (e) => {
          set.incl = e.target.value === '' ? null : Number(e.target.value);
          save();
        });
        $('.set-done', row).addEventListener('click', () => {
          if (!set.done) {
            if (set.weight == null) {
              const ph = Number($('.in-weight', row)?.placeholder);
              if (ph) set.weight = cardio ? ph : fromExUnit(ph, ex);
            }
            if (set.reps == null) {
              const ph = Number($('.in-reps', row).placeholder);
              if (ph) set.reps = ph;
            }
            if (cardio) {
              const grab = (sel, field) => {
                if (set[field] != null) return;
                const ph = Number($(sel, row)?.placeholder);
                if (ph) set[field] = ph;
              };
              grab('.in-kmh', 'kmh');
              grab('.in-incl', 'incl');
              if (set.weight == null && set.reps && set.kmh) set.weight = cardioDistance(set.reps, set.kmh);
              if (set.kmh == null && set.reps && set.weight) set.kmh = cardioSpeed(set.reps, set.weight);
              if (set.reps == null && !set.weight) { toast('Enter the minutes first'); return; }
            }
            if (!cardio && set.reps == null) { toast('Enter reps first'); return; }
            set.done = true;
            set.at = Date.now();          // so a forgotten session can end where it really did
            haptic('tick');
            flashSet = exIdx + ':' + setIdx;
            /* Most sets repeat the one before them, so once a set is logged
               the ones under it can be filled from it in a tap rather than
               typed out again. Only offered while there is something empty
               left to fill. */
            const restEmpty = ex.sets.slice(setIdx + 1)
              .filter((o) => !o.done && o.weight == null && o.reps == null);
            let prMsg = null;
            /* A record is the biggest set you have ever done for this
               exercise, and today's sets count. Beating your own set from ten
               minutes ago moves the crown rather than handing out a second
               one — "how was the second set also a record" had a fair answer
               before, which was that nothing was comparing them. */
            if (!cardio && (set.type || 'N') !== 'W' && (set.weight || set.reps)) {
              const history = bestSetFor(ex.exerciseId);
              const today = w.exercises
                .filter((x) => x.exerciseId === ex.exerciseId)
                .flatMap((x) => x.sets.filter((o) => o !== set && isWorkingSet(o) && o.weight));
              const beat = Math.max(history ? setMass(history) : 0, ...today.map(setMass), 0);
              if (setMass(set) > beat) {
                w.exercises.forEach((x) => {
                  if (x.exerciseId === ex.exerciseId) x.sets.forEach((o) => { if (o !== set) delete o.pr; });
                });
                set.pr = true;
                // a longer, rhythmic buzz so a record feels different from
                // the plain tick of an ordinary set
                haptic('pr');
                // a pull-up has no weight to name, so the reps are the record
                prMsg = prIcon('pr-mark toast-pr') + (set.weight
                  ? ` New record — ${fmtNum(set.weight)} ${unit()} × ${set.reps}`
                  : ` New record — ${set.reps} reps`);
              }
            }
            save(); render();

            const canFill = restEmpty.length && (set.weight != null || set.reps != null);
            const copy = { weight: set.weight, reps: set.reps, kmh: set.kmh, incl: set.incl };
            const fill = canFill ? {
              label: 'Fill rest',
              onClick: () => {
                ex.sets.forEach((o, j) => {
                  if (j <= setIdx || o.done) return;
                  if (o.weight != null || o.reps != null) return;
                  if (copy.weight != null) o.weight = copy.weight;
                  if (copy.reps != null) o.reps = copy.reps;
                  if (copy.kmh != null) o.kmh = copy.kmh;
                  if (copy.incl != null) o.incl = copy.incl;
                });
                haptic('tick');
                save(); render();
              },
            } : null;
            if (prMsg) toast(prMsg, true, fill);
            else if (fill) toast('Set ' + numbersFor(ex)[setIdx] + ' logged', false, fill);
          } else {
            set.done = false;
            delete set.pr;
            haptic('tap');
            save(); render();
          }
        });
      });
    });
  }

  /* -------- exercise options menu (Hevy-style) -------- */

  const SET_TYPES = [
    ['N', 'Normal set', 'Counts toward your working sets and records'],
    ['W', 'Warm-up', 'Ignored in volume, records and set numbering'],
    ['D', 'Drop set', 'A lighter drop straight after a working set'],
    ['F', 'To failure', 'Taken to failure — kept out of PR detection'],
  ];

  /* Used by the logger and by the routine builder, which holds the same kind
     of rows — `after` is where each one goes once the choice is made. */
  function openSetSheet(ex, setIdx, after) {
    const done = after || (() => { save(); render(); });
    const set = ex.sets[setIdx];
    const cur = set.type || 'N';
    openSheet('Set type', '' +
      SET_TYPES.map(([code, name, note]) =>
        '<div class="lib-item ' + (cur === code ? 'is-on' : '') + '" data-type="' + code + '" role="button" tabindex="0">' +
          '<div><div class="li-name">' + name + '</div><div class="li-sub">' + note + '</div></div>' +
          '<span class="set-tag t-' + code.toLowerCase() + '">' + code + '</span>' +
        '</div>').join('') +
      '<button class="btn btn-danger" id="setDel" style="margin-top:16px">Remove this set</button>',
    (body) => {
      body.addEventListener('click', (e) => {
        const item = e.target.closest('[data-type]');
        if (!item) return;
        if (item.dataset.type === 'N') delete set.type; else set.type = item.dataset.type;
        haptic('tap');
        closeSheet(); done();
      });
      $('#setDel', body).addEventListener('click', () => {
        if (ex.sets.length <= 1) { toast('An exercise needs at least one set'); return; }
        ex.sets.splice(setIdx, 1);
        closeSheet(); done();
      });
    });
  }

  /* RPE: how hard the set was, 6 (easy) to 10 (nothing left) */
  function openRpeSheet(set) {
    const opts = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6];
    const notes = { 10: 'Nothing left', 9.5: 'Maybe half a rep', 9: '1 rep left', 8.5: '1–2 reps left', 8: '2 reps left', 7.5: '2–3 reps left', 7: '3 reps left', 6: '4+ reps left' };
    openSheet('Effort (RPE)', '' +
      opts.map((v) => '<div class="lib-item ' + (set.rpe === v ? 'is-on' : '') + '" data-rpe="' + v + '" role="button" tabindex="0">' +
        '<div><div class="li-name">RPE ' + fmtNum(v) + '</div><div class="li-sub">' + notes[v] + '</div></div>' +
        '<span class="li-best">' + (set.rpe === v ? '✓' : '') + '</span></div>').join('') +
      (set.rpe ? '<button class="btn btn-quiet" id="rpeClear" style="margin-top:14px">Clear</button>' : ''),
    (body) => {
      body.addEventListener('click', (e) => {
        const item = e.target.closest('[data-rpe]');
        if (!item) return;
        set.rpe = Number(item.dataset.rpe);
        haptic('tap');
        save(); closeSheet(); render();
      });
      const clr = $('#rpeClear', body);
      if (clr) clr.addEventListener('click', () => { delete set.rpe; save(); closeSheet(); render(); });
    });
  }

  function openExerciseMenu(exIdx) {
    const w = state.activeWorkout;
    const ex = w.exercises[exIdx];
    const info = exerciseById(ex.exerciseId);
    const cardioEx = isCardio(ex.exerciseId);
    openSheet(info?.name ?? 'Exercise', `
      <div class="menu-list">
        <button class="menu-item" data-act="up" ${exIdx === 0 ? 'disabled' : ''}>↑ &nbsp;Move up</button>
        <button class="menu-item" data-act="down" ${exIdx === w.exercises.length - 1 ? 'disabled' : ''}>↓ &nbsp;Move down</button>
        <button class="menu-item" data-act="note">📝 &nbsp;${ex.note ? 'Edit note' : 'Add note'}</button>
        ${isBodyweight(ex.exerciseId) ? `<button class="menu-item" data-act="wt">🏋️ &nbsp;${showsWeight(ex) ? 'No added weight' : 'I add weight to this'}</button>` : ''}
        ${showsWeight(ex) && !cardioEx ? `<button class="menu-item" data-act="unit">⚖ &nbsp;${exUnit(ex) === unit() ? 'This machine is in ' + OTHER_UNIT() : 'Back to ' + unit()}</button>` : ''}
        ${ex.ss ? `<button class="menu-item" data-act="ssbreak">⛓ &nbsp;Remove from superset</button>`
          : exIdx < w.exercises.length - 1 ? `<button class="menu-item" data-act="ss">⛓ &nbsp;Superset with next exercise</button>` : ''}
        <button class="menu-item" data-act="replace">⇄ &nbsp;Replace exercise</button>
        ${showsWeight(ex) && !cardioEx ? '<button class="menu-item" data-act="warmup">🔥 &nbsp;Add warm-up sets</button>' : ''}
        ${showsWeight(ex) && !cardioEx ? '<button class="menu-item" data-act="plates">🏋️ &nbsp;Plate calculator</button>' : ''}
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
        } else if (act === 'wt') {
          const on = showsWeight(ex);
          delete ex.wt;
          setExPref(ex.exerciseId, { wt: !on });
          if (on) ex.sets.forEach((st) => { if (!st.done) st.weight = null; });
          save(); closeSheet(); render();
        } else if (act === 'unit') {
          const other = exUnit(ex) === unit() ? OTHER_UNIT() : unit();
          delete ex.wu;
          setExPref(ex.exerciseId, { wu: other === unit() ? null : other });
          save(); closeSheet(); render();
        } else if (act === 'ssbreak') {
          delete ex.ss;
          save(); closeSheet(); render();
        } else if (act === 'replace') {
          closeSheetNow();
          openExercisePicker((newId) => {
            const was = ex.exerciseId;
            ex.exerciseId = newId;
            /* A different movement takes a different weight. The sets and reps
               are the shape of the work and stay; what you were lifting does
               not carry across to a machine you have not tried. */
            if (was !== newId) {
              ex.sets.forEach((st) => {
                if (st.done) return;
                st.weight = null;
                delete st.targetW;
                if (isCardio(newId) !== isCardio(was)) { st.reps = null; delete st.target; delete st.targetMax; }
                delete st.kmh; delete st.incl;
              });
            }
            save(); render();
          });
        } else if (act === 'note') {
          closeSheetNow();
          openNoteSheet(ex);
        } else if (act === 'warmup') {
          closeSheetNow();
          openWarmupSheet(ex);
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


  function openNoteSheet(ex, after) {
    const done = after || (() => { save(); render(); });
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
        closeSheet(); done();
      });
    });
  }

  /* -------- warm-up ramp --------
     The sets before the sets: a light one, then the bar creeping up to what
     you came to lift. Rounded to something you can actually load, and marked
     as warm-ups so they stay out of volume, records and the set numbering. */
  const WARMUP_STEPS = [
    [0.4, 8],
    [0.6, 5],
    [0.8, 3],
  ];
  function warmupSets(working) {
    const step = unit() === 'kg' ? 2.5 : 5;
    const round = (v) => Math.max(step, Math.round(v / step) * step);
    const out = [];
    for (const [frac, reps] of WARMUP_STEPS) {
      const w = round(working * frac);
      if (w >= working) break;                       // nothing to warm up to
      if (out.length && out[out.length - 1].weight === w) continue;   // no repeats
      out.push({ weight: w, reps, type: 'W', done: false });
    }
    return out;
  }
  function openWarmupSheet(ex, after) {
    const done = after || (() => { save(); render(); });
    // what you are working up to: the plan, then what you last did
    const planned = ex.sets.find((s) => (s.type || 'N') !== 'W' && (s.weight ?? s.targetW));
    const prevTop = previousSets(ex.exerciseId)
      .filter((s) => (s.type || 'N') !== 'W' && s.weight)
      .reduce((a, b) => (!a || b.weight > a.weight ? b : a), null);
    const guess = planned?.weight ?? planned?.targetW ?? prevTop?.weight ?? '';
    openSheet('Warm-up sets', `
      <p class="portion-per">Sets working up to your first real one, added in front of it and marked W.</p>
      <div class="field">
        <label for="wuTarget">Working weight (${esc(exUnit(ex))})</label>
        <input id="wuTarget" type="number" inputmode="decimal" min="0" step="0.5"
               value="${guess === '' ? '' : toExUnit(guess, ex)}" placeholder="e.g. 80">
      </div>
      <div id="wuPreview" class="wu-preview"></div>
      <button class="btn btn-primary" id="wuAdd" style="margin-top:14px">Add them</button>
    `, (body) => {
      const box = $('#wuTarget', body), out = $('#wuPreview', body);
      const rows = () => warmupSets(fromExUnit(Number(box.value) || 0, ex));
      const paint = () => {
        const list = rows();
        out.innerHTML = list.length
          ? list.map((r, i) => '<div class="wu-row"><span class="set-num t-w">W</span>' +
              '<b>' + fmtNum(toExUnit(r.weight, ex)) + ' ' + esc(exUnit(ex)) + '</b>' +
              '<i>× ' + r.reps + '</i></div>').join('')
          : '<p class="empty-note" style="padding:12px">Enter what you are working up to.</p>';
      };
      paint();
      box.addEventListener('input', paint);
      if (guess === '') box.focus();
      $('#wuAdd', body).addEventListener('click', () => {
        const list = rows();
        if (!list.length) { toast('Enter what you are working up to'); return; }
        // in front of the first set that is not already a warm-up
        const at = ex.sets.findIndex((s) => (s.type || 'N') !== 'W');
        ex.sets.splice(at < 0 ? ex.sets.length : at, 0, ...list);
        haptic('tick');
        closeSheet();
        done();
        toast(list.length + ' warm-up set' + (list.length === 1 ? '' : 's') + ' added');
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
    const fmtSet = (s) => cardio ? cardioText(s) : `${fmtNum(s.weight ?? 0)}×${s.reps}${s.pr ? ' ' + prIcon('pr-mark pr-inline') : ''}`;
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
      <button class="btn btn-quiet" id="detTrend">${cardio ? 'View distance trend' : 'View 1RM trend'}</button>` : ''}
    `, (body) => {
      $('#detTrend', body)?.addEventListener('click', () => {
        progressExerciseId = exerciseId;
        progressSeg = 'trends';
        closeSheet(); goTab('profile');
      });
    });
  }

  /* Marking two exercises a superset should look like something. Where a card
     has a neighbour in the same group, they are drawn as one block with a rail
     down the side rather than two cards that happen to share a chip. */
  function ssPos(list, i) {
    const cur = list[i].ss;
    if (!cur) return '';
    const prev = i > 0 && list[i - 1].ss === cur;
    const next = i < list.length - 1 && list[i + 1].ss === cur;
    if (!prev && !next) return '';         // a group of one is not a superset
    return ' ss-in' + (prev ? '' : ' ss-first') + (next ? '' : ' ss-last');
  }

  /* Warm-ups are lettered and do not take a number; the rest count up. */
  function numbersFor(ex) {
    let n = 0;
    return ex.sets.map((s) => ((s.type || 'N') === 'N' ? String(++n) : (s.type || 'N')));
  }

  function renderExerciseBlock(ex, exIdx, ss = '') {
    const info = exerciseById(ex.exerciseId);
    const prev = previousSets(ex.exerciseId);
    const cardio = isCardio(ex.exerciseId);
    const weighted = showsWeight(ex);
    const u = unit();
    // only working sets are numbered — a warm-up shouldn't push set 1 to set 2
    const numbers = numbersFor(ex);
    const rpeOn = state.settings.trackRpe !== false;
    return `
      <div class="card ex-block${ss}" data-ex="${exIdx}">
        <div class="ex-head">
          <h3 class="ex-name" role="button" tabindex="0">${ex.ss ? `<span class="ss-chip">SS${ex.ss}</span> ` : ''}${esc(info?.name ?? 'Unknown exercise')}
            <span class="muscle">${esc(info?.muscle ?? '')}${info?.equipment ? ' · ' + esc(info.equipment) : ''}</span>
          </h3>
          <button class="ex-remove ex-menu" aria-label="Exercise options">
            <svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
          </button>
        </div>
        <button class="ex-line ex-note-line ${ex.note ? 'has' : ''}">${ex.note ? esc(ex.note) : 'Add notes here…'}</button>
        ${(() => {
          const h = overloadHint(ex);
          if (!h) return '';
          const aim = h.ranged && !h.allHit ? h.low + '-' + h.high : h.reps;
          return `<button class="ex-line ex-hint ${h.allHit ? 'up' : ''}">${h.allHit ? '↑' : '→'} Last ${fmtNum(h.prevWeight)} ${esc(u)} × ${h.prevReps} — try <b>${fmtNum(h.weight)} ${esc(u)} × ${aim}</b>${h.allHit && h.ranged ? ' <i>(top of the range — go up)</i>' : ''}</button>`;
        })()}
        ${cardio ? cardioLastLine(prev) : ''}
        <div class="set-grid${cardio ? ' cardio-grid' : ((rpeOn ? ' has-rpe' : '') + (weighted ? '' : ' no-weight'))}">
          ${cardio
            ? '<span class="hdr">Set</span><span class="hdr">Min</span><span class="hdr">km/h</span><span class="hdr">%</span><span class="hdr">km</span><span class="hdr">✓</span>'
            : `<span class="hdr">Set</span><span class="hdr">Prev</span>${weighted ? `<span class="hdr">${esc(isBodyweight(ex.exerciseId) ? '+' + exUnit(ex) : exUnit(ex))}</span>` : ''}<span class="hdr">Reps</span>${rpeOn ? '<span class="hdr">RPE</span>' : ''}<span class="hdr">✓</span>`}
          ${ex.sets.map((s, i) => {
            // past the sets you did last time, the faint number carries on
            // from the last one rather than leaving the box blank
            const p = prev[i] || prev[prev.length - 1];
            const t = s.type || 'N';
            const numBtn = `<button class="set-num t-${t.toLowerCase()}" aria-label="Set ${numbers[i]} — change type">${numbers[i]}</button>`;
            const tick = `<button class="set-done ${s.done ? 'logged' : ''}" aria-label="${s.done ? 'Undo set' : 'Log set'}" aria-pressed="${s.done}">
                <svg viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>
              </button>`;
            if (cardio) {
              const box = (cls, val, ph, step, label) =>
                `<input class="set-input ${cls}" type="number" inputmode="decimal" min="0" step="${step}"
                        value="${val ?? ''}" placeholder="${ph ?? ''}" aria-label="${label}, set ${i + 1}">`;
              return `
            <div class="set-row ${s.done ? 'logged' : ''}" data-set="${i}">
              ${numBtn}
              ${box('in-reps', s.reps, s.target ?? p?.reps ?? '', '1', 'Minutes')}
              ${box('in-kmh', s.kmh, s.targetKmh ?? p?.kmh ?? '', '0.1', 'Speed km/h')}
              ${box('in-incl', s.incl, s.targetIncl ?? p?.incl ?? '', '0.5', 'Incline percent')}
              ${box('in-weight', s.weight, s.targetW ?? p?.weight ?? '', '0.1', 'Distance km')}
              ${tick}
            </div>`;
            }
            const prevTxt = p ? (p.weight ? `${fmtNum(p.weight)}×${p.reps}` : `${p.reps}`) : '—';
            return `
            <div class="set-row ${s.done ? 'logged' : ''}" data-set="${i}">
              ${numBtn}
              <span class="set-prev">${s.pr ? prIcon('pr-mark pr-inline') + ' ' : ''}${prevTxt}</span>
              ${weighted ? `<div class="w-cell">
                <input class="set-input in-weight" type="number" inputmode="decimal" min="0" step="0.5"
                       value="${toExUnit(s.weight, ex) ?? ''}"
                       placeholder="${toExUnit(s.targetW ?? p?.weight ?? '', ex) ?? ''}"
                       aria-label="Weight in ${exUnit(ex)}, set ${i + 1}">
                ${exUnit(ex) !== unit() && s.weight != null
                  ? `<i class="w-conv">${fmtNum(s.weight)} ${esc(unit())}</i>` : ''}
              </div>` : ''}
              <input class="set-input in-reps" type="number" inputmode="numeric" min="0" step="1"
                     value="${s.reps ?? ''}" placeholder="${s.targetMax && s.target ? s.target + '-' + s.targetMax : (s.target ?? p?.reps ?? ex.targetReps ?? '')}" aria-label="Reps, set ${i + 1}">
              ${rpeOn ? `<button class="set-rpe ${s.rpe ? 'has' : ''}" aria-label="Effort for set ${numbers[i]}">${s.rpe ? fmtNum(s.rpe) : '–'}</button>` : ''}
              ${tick}
            </div>`;
          }).join('')}
        </div>
        <button class="chip-btn add-set">+ Add set</button>
      </div>`;
  }

  /* Sets start empty. What you did last time shows behind the box as a faint
     number: start typing and it is gone, tick it and it becomes the real one. */
  function newExerciseEntry(exerciseId, setCount, targetReps) {
    // a number of blank sets, or the rows a routine asked for
    const rows = Array.isArray(setCount)
      ? setCount.map((r) => ({
          weight: null, reps: null, done: false,
          ...(r && r.reps ? { target: Number(r.reps) } : {}),
          ...(r && r.repsMax ? { targetMax: Number(r.repsMax) } : {}),
          ...(r && r.weight ? { targetW: Number(r.weight) } : {}),
          ...(r && r.kmh ? { targetKmh: Number(r.kmh) } : {}),
          ...(r && r.incl ? { targetIncl: Number(r.incl) } : {}),
          ...(r && r.type && r.type !== 'N' ? { type: r.type } : {}),   // warm-ups and drops travel with the plan
        }))
      : Array.from({ length: Math.max(1, Number(setCount) || 1) }, () => ({ weight: null, reps: null, done: false }));
    const entry = { exerciseId, sets: rows };
    if (targetReps) entry.targetReps = targetReps;
    return entry;
  }

  function startWorkout(templateId) {
    const tpl = templateId ? templateById(templateId) : null;
    state.activeWorkout = {
      id: uid(),
      name: tpl ? tpl.name : 'Workout',
      startedAt: Date.now(),
      exercises: tpl ? tpl.exercises.map((e) => ({
        ...newExerciseEntry(e.exerciseId, tplSets(e), e.targetReps),
        ...(e.note ? { note: e.note } : {}),
        ...(e.ss ? { ss: e.ss } : {}),
      })) : [],
    };
    workoutOpen = true;
    openWkEntry();
    save(); render();
    if (!tpl) {
      openExercisePicker((exId) => {
        state.activeWorkout.exercises.push(newExerciseEntry(exId, isCardio(exId) ? 1 : 3));
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
    // a session left running all night ended when you stopped logging, not now
    const endAt = w.editingId ? (w.finishedAt || w.startedAt)
      : workoutStale(w) ? workoutEndedAt(w) : Date.now();
    openSheet(w.editingId ? 'Save changes' : 'Finish workout', `
      <div class="field">
        <label for="wkName">Workout name</label>
        <input id="wkName" type="text" value="${esc(w.name)}">
      </div>
      <p class="muted" style="margin-bottom:10px">${done.length} sets · ${fmtNum(workoutVolume(w))} ${esc(unit())} total volume · ${esc(fmtDuration(endAt - w.startedAt))}</p>
      <div class="field">
        <label for="wkDate">Day</label>
        <input id="wkDate" type="date" value="${dateKey(new Date(w.startedAt))}" max="${dateKey()}">
        <i class="field-hint">Logged the morning after? Put it on the day you trained.</i>
      </div>
      ${prs.length ? `<p class="finish-prs">${prIcon()} ${prs.length} new record${prs.length === 1 ? '' : 's'}: <span class="muted">${prs.map((p) => `${esc(exerciseById(p.exerciseId)?.name ?? '?')} ${fmtNum(p.weight)}×${p.reps}`).join(', ')}</span></p>` : ''}
      <div class="field">
        <label for="wkNote">Workout notes (optional)</label>
        <textarea id="wkNote" rows="2">${esc(w.note ?? '')}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:0.9rem">
        <input type="checkbox" id="saveTpl" style="width:18px;height:18px"> Save as routine
      </label>
      <button class="btn btn-primary" id="confirmFinish">${w.editingId ? 'Save changes' : 'Save workout'}</button>
    `, (body) => {
      $('#confirmFinish', body).addEventListener('click', () => {
        w.name = $('#wkName', body).value.trim() || 'Workout';
        const note = $('#wkNote', body).value.trim();
        if (note) w.note = note;
        w.finishedAt = endAt;
        /* Moved to another day: the clock times stay, the date changes, so a
           session logged the next morning still reads 18:00 to 19:10. */
        const picked = $('#wkDate', body)?.value;
        if (picked && picked !== dateKey(new Date(w.startedAt))) {
          const [y, mo, dd] = picked.split('-').map(Number);
          const from = new Date(w.startedAt);
          const to = new Date(y, mo - 1, dd, from.getHours(), from.getMinutes(), from.getSeconds());
          const shift = to.getTime() - w.startedAt;
          w.startedAt += shift;
          w.finishedAt += shift;
        }
        w.exercises = w.exercises
          .map((ex) => ({ ...ex, sets: ex.sets.filter((s) => s.done) }))
          .filter((ex) => ex.sets.length);
        if ($('#saveTpl', body).checked) {
          state.templates.push({
            id: uid(),
            name: w.name,
            exercises: w.exercises.map((ex) => ({
              exerciseId: ex.exerciseId,
              sets: ex.sets.map((st) => ({
                ...(st.reps ? { reps: Number(st.reps) } : {}),
                ...(st.weight ? { weight: Number(st.weight) } : {}),
                ...(st.kmh ? { kmh: Number(st.kmh) } : {}),
                ...(st.incl ? { incl: Number(st.incl) } : {}),
                ...(st.type && st.type !== 'N' ? { type: st.type } : {}),
              })),
              ...(ex.note ? { note: ex.note } : {}),
              ...(ex.ss ? { ss: ex.ss } : {}),
            })),
          });
        }
        if (w.editingId) {
          // put it back where it was, keeping its place in history
          const at = state.workouts.findIndex((x) => x.id === w.editingId);
          const { editingId, ...clean } = w;
          if (at >= 0) state.workouts[at] = clean; else state.workouts.unshift(clean);
        } else {
          state.workouts.unshift(w);
        }
        state.activeWorkout = null;
        workoutOpen = false;
        haptic('done');
        save(); closeSheet(); closeWkEntry(); render();
        toast(w.editingId ? 'Changes saved'
          : prs.length ? prIcon('pr-mark toast-pr') + ` Workout saved — ${prs.length} record${prs.length === 1 ? '' : 's'}`
          : 'Workout saved', prs.length > 0);
      });
    });
  }

  /* -------- routine builder -------- */

  let routineDraft = null;
  let rbScrollTo = null;
  let rbHasEntry = false;

  function openRoutineBuilder(templateId) {
    const existing = templateId ? templateById(templateId) : null;
    if (existing) {
      // your copy keeps the original's id, so it stands in the same place
      const { builtin, ...clean } = JSON.parse(JSON.stringify(existing));
      routineDraft = clean;
      routineDraft.exercises = (routineDraft.exercises || []).map((e) => ({ ...e, sets: tplSets(e) }));
    } else {
      routineDraft = { id: uid(), name: '', exercises: [] };
    }
    if (!rbHasEntry) { history.pushState({ t: 'rb' }, ''); rbHasEntry = true; }
    showRoutineBuilder();
  }

  /* Backing out of a half-built routine should not lose it without a word. */
  function closeRoutineBuilder(saved) {
    const d = routineDraft;
    const started = !saved && d && (d.name.trim() || d.exercises.length);
    const shut = () => {
      routineDraft = null;
      if (rbHasEntry) { rbHasEntry = false; skipPop++; history.back(); }
      showRoutineBuilder();
      render();
    };
    if (!started) { shut(); return; }
    confirmAction({
      title: 'Leave without saving',
      message: 'This routine has not been saved. Leave it?',
      confirm: 'Leave',
      onConfirm: shut,
    });
  }

  /* The builder is the logger, standing still. Same bar, same stats strip,
     same exercise cards with the same numbered set rows — because a routine
     is a workout you have not done yet, and having it look like something
     else was the whole problem. */
  function showRoutineBuilder() {
    const d = routineDraft;
    if (!d) { $('#routineRoot').innerHTML = ''; document.body.classList.remove('rb-open'); return; }
    const root = $('#routineRoot');
    const isEdit = allTemplates().some((t) => t.id === d.id);
    // a built-in you have already changed can be put back the way it was
    const changed = isBuiltinId(d.id) && (state.templates || []).some((t) => t.id === d.id);
    const wasShowing = !!$('.wk-body', root);
    const keptScroll = wasShowing ? $('.wk-body', root).scrollTop : null;
    const totalSets = d.exercises.reduce((n, e) => n + tplSetCount(e), 0);
    document.body.classList.add('rb-open');

    root.innerHTML = `
      <div class="wk-overlay${wasShowing ? '' : ' wk-enter'}">
        <div class="wk-bar">
          <button class="icon-btn" id="rbClose" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
          <b class="wk-title">${isEdit ? 'Edit routine' : 'New routine'}</b>
          <button class="chip-btn chip-strong" id="rbSave">Save</button>
        </div>
        <div class="wk-stats rb-stats">
          <div><span class="micro">Exercises</span><b>${d.exercises.length}</b></div>
          <div><span class="micro">Sets</span><b>${totalSets}</b></div>
        </div>
        <div class="wk-body">
          <div class="field rb-name-field">
            <label for="rbName">Routine name</label>
            <input id="rbName" type="text" placeholder="e.g. Upper Body A" value="${esc(d.name)}"
                   autocomplete="off" enterkeyhint="done">
          </div>
          ${d.exercises.map((e, i) => renderRoutineBlock(e, i, d.exercises.length, ssPos(d.exercises, i))).join('')}
          ${d.exercises.length ? '' : '<p class="empty-note" style="padding:22px 16px">Nothing in it yet. Add the first exercise below.</p>'}
          <button class="btn btn-ghost" id="rbAdd" style="margin-bottom:12px">+ Add exercise</button>
          ${isEdit ? '<button class="btn btn-quiet" id="rbCopy" style="margin-bottom:8px">Duplicate this routine</button>' : ''}
      ${changed ? '<button class="btn btn-quiet" id="rbReset" style="margin-bottom:8px">Restore the original</button>' : ''}
        </div>
      </div>`;

    const body = $('.wk-body', root);
    if (keptScroll != null) body.scrollTop = keptScroll;
    if (rbScrollTo != null) {
      const block = $$('.ex-block', root)[rbScrollTo];
      if (block) body.scrollTop = Math.max(0, block.offsetTop - 12);
      rbScrollTo = null;
    }

    $('#rbName', root).addEventListener('input', (e) => { d.name = e.target.value; });
    // never hand the click event straight in — it would arrive as `saved`
    $('#rbClose', root).addEventListener('click', () => closeRoutineBuilder());

    /* The two boxes for one set of one exercise. A weight is optional — leave
       it empty and the routine says nothing about it, which is the right
       answer for anything you pick by feel on the day. */
    body.addEventListener('input', (e) => {
      const box = e.target.closest('.rb-rep, .rb-repmax, .rb-w, .rb-min, .rb-kmh, .rb-incl, .rb-km');
      if (!box) return;
      const ex = d.exercises[Number(box.dataset.ex)];
      const rows = tplSets(ex);
      const row = rows[Number(box.dataset.set)] || {};
      const val = Number(box.value);
      const cls = box.classList;
      const field = cls.contains('rb-w') || cls.contains('rb-km') ? 'weight'
        : cls.contains('rb-repmax') ? 'repsMax'
        : cls.contains('rb-kmh') ? 'kmh'
        : cls.contains('rb-incl') ? 'incl' : 'reps';
      const kept = field === 'weight' && !isCardio(ex.exerciseId) ? fromExUnit(val, ex) : val;
      if (box.value !== '' && val > 0) row[field] = kept; else delete row[field];
      // plan a time and a speed and the distance is not a thing to work out
      if (isCardio(ex.exerciseId) && row.weight == null && row.reps && row.kmh) {
        const km = cardioDistance(row.reps, row.kmh);
        if (km) {
          row.weight = km;
          const b = $('.rb-km[data-ex="' + box.dataset.ex + '"][data-set="' + box.dataset.set + '"]', body);
          if (b && b.value === '') b.value = km;
        }
      }
      rows[Number(box.dataset.set)] = row;
      ex.sets = rows;
      delete ex.targetReps;             // the rows carry it now
    });

    body.addEventListener('click', (e) => {
      const add = e.target.closest('.rb-add-set');
      if (add) {
        const ex = d.exercises[Number(add.dataset.ex)];
        const rows = tplSets(ex);
        rows.push({ ...(rows[rows.length - 1] || {}) });   // same target and type as the one above
        ex.sets = rows;
        delete ex.targetReps;
        haptic('tick');
        showRoutineBuilder();
        return;
      }
      const drop = e.target.closest('.rb-drop-set');
      if (drop) {
        const ex = d.exercises[Number(drop.dataset.ex)];
        const rows = tplSets(ex);
        if (rows.length <= 1) { toast('An exercise needs at least one set'); return; }
        rows.splice(Number(drop.dataset.set), 1);
        ex.sets = rows;
        delete ex.targetReps;
        haptic('tap');
        showRoutineBuilder();
        return;
      }
      const num = e.target.closest('.rb-set-num');
      if (num) {
        const ex = d.exercises[Number(num.dataset.ex)];
        ex.sets = tplSets(ex);
        delete ex.targetReps;
        openSetSheet(ex, Number(num.dataset.set), () => showRoutineBuilder());
        return;
      }
      const note = e.target.closest('.rb-note');
      if (note) { openNoteSheet(d.exercises[Number(note.dataset.ex)], () => showRoutineBuilder()); return; }
      const menu = e.target.closest('.rb-ex-menu');
      if (menu) { openRoutineExMenu(Number(menu.dataset.ex)); return; }
    });

    $('#rbAdd', root).addEventListener('click', () => openExercisePicker((exId) => {
      // nobody does three sets of a treadmill: one go, twenty minutes
      d.exercises.push({
        exerciseId: exId,
        sets: isCardio(exId) ? [{ reps: 20 }] : [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
      });
      rbScrollTo = d.exercises.length - 1;
      showRoutineBuilder();
    }));

    $('#rbCopy', root)?.addEventListener('click', () => {
      // save what is on screen first, so the copy is of what you can see
      if (!d.name.trim()) { toast('Give the routine a name first'); return; }
      d.exercises.forEach((x) => { x.sets = tplSets(x); delete x.targetReps; });
      if (!Array.isArray(state.templates)) state.templates = [];
      const idx = state.templates.findIndex((t) => t.id === d.id);
      if (idx >= 0) state.templates[idx] = d; else state.templates.push(d);
      const made = duplicateTemplate(d.id);
      haptic('tick');
      routineDraft = null;
      closeRoutineBuilder(true);
      save(); render();
      toast('Copied as "' + made.name + '"');
    });
    $('#rbReset', root)?.addEventListener('click', () => {
      confirmAction({
        title: 'Restore the original',
        message: 'Put "' + esc(d.name || 'this routine') + '" back the way it came with the app? Your changes to it are dropped.',
        confirm: 'Restore',
        onConfirm: () => {
          undoable('Original restored', () => {
            state.templates = (state.templates || []).filter((t) => t.id !== d.id);
          });
          closeRoutineBuilder(true);
        },
      });
    });

    $('#rbSave', root).addEventListener('click', () => {
      if (!d.name.trim()) { toast('Give the routine a name'); $('#rbName', root).focus(); return; }
      if (!d.exercises.length) { toast('Add at least one exercise'); return; }
      d.name = d.name.trim();
      d.exercises.forEach((e) => {
        e.sets = tplSets(e);
        delete e.targetReps;
        /* "8 to 6" means the same as "6 to 8", and "6 to 6" is just 6. An
           exercise switched back to a single number keeps none of it. */
        e.sets.forEach((r) => {
          if (!e.range) { delete r.repsMax; return; }
          if (r.repsMax == null) return;
          if (r.reps == null) { r.reps = r.repsMax; delete r.repsMax; return; }
          if (r.repsMax < r.reps) { const lo = r.repsMax; r.repsMax = r.reps; r.reps = lo; }
          if (r.repsMax === r.reps) delete r.repsMax;
        });
      });
      if (!Array.isArray(state.templates)) state.templates = [];
      const idx = state.templates.findIndex((t) => t.id === d.id);
      if (idx >= 0) state.templates[idx] = d; else state.templates.push(d);
      state.tplHidden = (state.tplHidden || []).filter((x) => x !== d.id);
      haptic('done');
      closeRoutineBuilder(true);
      save(); render();
      toast('Routine saved');
    });
  }

  /* One exercise, laid out exactly like the logger's card: the name and its
     muscle, then a numbered row per set. What is missing is the part you can
     only fill in on the day — the weight, and the tick. */
  function renderRoutineBlock(e, exIdx, total, ss = '') {
    const info = exerciseById(e.exerciseId);
    const prev = previousSets(e.exerciseId);
    const cardio = isCardio(e.exerciseId);
    const weighted = showsWeight(e);
    const rows = tplSets(e);
    // "8" or "8 to 10" — a choice per exercise, since it is a way of training
    // rather than something that changes set by set
    const ranged = !!e.range;
    // warm-ups are lettered, not numbered — the same rule the logger follows
    let workingNo = 0;
    const numbers = rows.map((r) => ((r.type || 'N') === 'N' ? String(++workingNo) : (r.type || 'N')));
    return `
      <div class="card ex-block rb-block${ranged ? ' is-ranged' : ''}${ss}" data-ex="${exIdx}">
        <div class="ex-head">
          <h3 class="ex-name">${e.ss ? `<span class="ss-chip">SS${e.ss}</span> ` : ''}${esc(info?.name ?? 'Unknown exercise')}
            <span class="muscle">${esc(info?.muscle ?? '')}${info?.equipment ? ' · ' + esc(info.equipment) : ''}</span>
          </h3>
          <button class="ex-remove rb-ex-menu" data-ex="${exIdx}" aria-label="Options for ${esc(info?.name ?? 'this exercise')}">
            <svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
          </button>
        </div>
        <button class="ex-line ex-note-line rb-note ${e.note ? 'has' : ''}" data-ex="${exIdx}">${e.note ? esc(e.note) : 'Add notes here…'}</button>
        ${cardio ? cardioLastLine(prev) : ''}
        <div class="set-grid ${cardio ? 'rb-cardio-grid' : 'rb-grid'}${!cardio && !weighted ? ' no-weight' : ''}">
          ${cardio
            ? '<span class="hdr">Set</span><span class="hdr">Min</span><span class="hdr">km/h</span><span class="hdr">%</span><span class="hdr">km</span><span class="hdr"></span>'
            : `<span class="hdr">Set</span><span class="hdr">Prev</span>${weighted ? `<span class="hdr">${esc(isBodyweight(e.exerciseId) ? '+' + exUnit(e) : exUnit(e))}</span>` : ''}<span class="hdr">Reps</span><span class="hdr"></span>`}
          ${rows.map((r, i) => {
            const p = prev[i] || prev[prev.length - 1];
            const prevTxt = p ? (p.weight ? `${fmtNum(p.weight)}×${p.reps}` : `${p.reps}`) : '—';
            const t = r.type || 'N';
            const numBtn = `<button class="set-num rb-set-num t-${t.toLowerCase()}" data-ex="${exIdx}" data-set="${i}"
                      aria-label="Set ${numbers[i]} — change type">${numbers[i]}</button>`;
            const dropBtn = `<button class="rb-drop-set" data-ex="${exIdx}" data-set="${i}" aria-label="Remove set ${i + 1}">
                <svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>
              </button>`;
            if (cardio) {
              const box = (cls, val, ph, step, label) =>
                `<input class="set-input ${cls}" type="number" inputmode="decimal" min="0" step="${step}"
                        data-ex="${exIdx}" data-set="${i}" value="${val ?? ''}"
                        placeholder="${ph ?? '—'}" aria-label="${label}, set ${i + 1}">`;
              return `
            <div class="set-row" data-set="${i}">
              ${numBtn}
              ${box('rb-min', r.reps, p?.reps, '1', 'Minutes')}
              ${box('rb-kmh', r.kmh, p?.kmh, '0.1', 'Speed km/h')}
              ${box('rb-incl', r.incl, p?.incl, '0.5', 'Incline percent')}
              ${box('rb-km', r.weight, p?.weight != null ? fmtNum(p.weight) : null, '0.1', 'Distance km')}
              ${dropBtn}
            </div>`;
            }
            return `
            <div class="set-row" data-set="${i}">
              ${numBtn}
              <span class="set-prev">${prevTxt}</span>
              ${weighted ? `<div class="w-cell">
                <input class="set-input rb-w" type="number" inputmode="decimal" min="0" step="0.5"
                       data-ex="${exIdx}" data-set="${i}" value="${toExUnit(r.weight, e) ?? ''}"
                       placeholder="${p?.weight != null ? fmtNum(toExUnit(p.weight, e)) : '—'}"
                       aria-label="Planned weight in ${exUnit(e)}, set ${i + 1} — optional">
                ${exUnit(e) !== unit() && r.weight != null
                  ? `<i class="w-conv">${fmtNum(r.weight)} ${esc(unit())}</i>` : ''}
              </div>` : ''}
              <div class="rb-reps-cell">
                <input class="set-input rb-rep" type="number" inputmode="numeric" min="1" max="100"
                       data-ex="${exIdx}" data-set="${i}" value="${r.reps ?? ''}"
                       placeholder="${p?.reps ?? '—'}" aria-label="Target ${cardio ? 'minutes' : 'reps'}, set ${i + 1}">
                ${ranged ? `<span class="rb-dash" aria-hidden="true">–</span>
                <input class="set-input rb-repmax" type="number" inputmode="numeric" min="1" max="100"
                       data-ex="${exIdx}" data-set="${i}" value="${r.repsMax ?? ''}"
                       placeholder="+" aria-label="Up to how many ${cardio ? 'minutes' : 'reps'}, set ${i + 1}">` : ''}
              </div>
              ${dropBtn}
            </div>`;
          }).join('')}
        </div>
        <button class="chip-btn rb-add-set" data-ex="${exIdx}">+ Add set</button>
      </div>`;
  }

  /* Same menu the logger gives an exercise, minus the parts that only mean
     something once you are lifting. */
  function openRoutineExMenu(exIdx) {
    const d = routineDraft;
    const ex = d.exercises[exIdx];
    if (!ex) return;
    const name = exerciseById(ex.exerciseId)?.name ?? 'Exercise';
    openSheet(name, `
      <div class="menu-list">
        <button class="menu-item" data-act="up" ${exIdx === 0 ? 'disabled' : ''}>↑ &nbsp;Move up</button>
        <button class="menu-item" data-act="down" ${exIdx === d.exercises.length - 1 ? 'disabled' : ''}>↓ &nbsp;Move down</button>
        <button class="menu-item" data-act="note">📝 &nbsp;${ex.note ? 'Edit note' : 'Add note'}</button>
        ${isCardio(ex.exerciseId) ? '' : `<button class="menu-item" data-act="range">↔ &nbsp;${ex.range ? 'Just one rep number' : 'Aim for a rep range (6–8)'}</button>`}
        ${isBodyweight(ex.exerciseId) ? `<button class="menu-item" data-act="wt">🏋️ &nbsp;${showsWeight(ex) ? 'No added weight' : 'I add weight to this'}</button>` : ''}
        ${showsWeight(ex) && !isCardio(ex.exerciseId) ? `<button class="menu-item" data-act="unit">⚖ &nbsp;${exUnit(ex) === unit() ? 'This machine is in ' + OTHER_UNIT() : 'Back to ' + unit()}</button>` : ''}
        ${ex.ss ? '<button class="menu-item" data-act="ssbreak">⛓ &nbsp;Remove from superset</button>'
          : exIdx < d.exercises.length - 1 ? '<button class="menu-item" data-act="ss">⛓ &nbsp;Superset with next exercise</button>' : ''}
        <button class="menu-item" data-act="replace">⇄ &nbsp;Replace exercise</button>
        ${showsWeight(ex) && !isCardio(ex.exerciseId) ? '<button class="menu-item" data-act="warmup">🔥 &nbsp;Add warm-up sets</button>' : ''}
        ${showsWeight(ex) && !isCardio(ex.exerciseId) ? '<button class="menu-item" data-act="plates">🏋️ &nbsp;Plate calculator</button>' : ''}
        <button class="menu-item" data-act="detail">📈 &nbsp;Records &amp; history</button>
        <button class="menu-item danger" data-act="remove">🗑 &nbsp;Remove from routine</button>
      </div>`, (body) => {
      body.addEventListener('click', (evt) => {
        const b = evt.target.closest('button[data-act]');
        if (!b || b.disabled) return;
        const act = b.dataset.act;
        if (act === 'replace') {
          closeSheetNow();
          openExercisePicker((exId) => {
            const was = ex.exerciseId;
            ex.exerciseId = exId;
            if (was !== exId) {
              ex.sets = tplSets(ex).map((r) => {
                const { weight, kmh, incl, ...rest } = r;
                return isCardio(exId) !== isCardio(was) ? {} : rest;
              });
              delete ex.targetReps;
            }
            showRoutineBuilder();
          });
          return;
        }
        if (act === 'note') { closeSheetNow(); openNoteSheet(ex, () => showRoutineBuilder()); return; }
        if (act === 'warmup') {
          closeSheetNow();
          ex.sets = tplSets(ex);
          delete ex.targetReps;
          openWarmupSheet(ex, () => showRoutineBuilder());
          return;
        }
        if (act === 'plates') { closeSheetNow(); openPlateCalc(); return; }
        if (act === 'detail') { closeSheetNow(); openExerciseDetail(ex.exerciseId); return; }
        if (act === 'ss') {
          const next = d.exercises[exIdx + 1];
          ex.ss = next.ss ?? (Math.max(0, ...d.exercises.map((x) => x.ss || 0)) + 1);
          next.ss = ex.ss;
        }
        if (act === 'ssbreak') delete ex.ss;
        if (act === 'range') { if (ex.range) delete ex.range; else ex.range = true; }
        if (act === 'unit') {
          const other = exUnit(ex) === unit() ? OTHER_UNIT() : unit();
          delete ex.wu;
          setExPref(ex.exerciseId, { wu: other === unit() ? null : other });
          save();
        }
        if (act === 'wt') {
          const on = showsWeight(ex);
          delete ex.wt;
          setExPref(ex.exerciseId, { wt: !on });
          if (on) { tplSets(ex).forEach((r) => delete r.weight); ex.sets = tplSets(ex); }
          save();
        }
        if (act === 'up' && exIdx > 0) d.exercises.splice(exIdx - 1, 0, d.exercises.splice(exIdx, 1)[0]);
        if (act === 'down' && exIdx < d.exercises.length - 1) d.exercises.splice(exIdx + 1, 0, d.exercises.splice(exIdx, 1)[0]);
        if (act === 'remove') d.exercises.splice(exIdx, 1);
        haptic('tap');
        closeSheet();
        showRoutineBuilder();
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



  /* ================= BARCODE SCANNING ================= */
  /* Camera -> BarcodeDetector -> Open Food Facts. Needs a connection; every
     other part of the app keeps working offline. */

  let scanOpen = false;
  let scanStream = null;
  let scanTimer = null;

  function closeScanner(pop = true) {
    scanOpen = false;
    clearInterval(scanTimer); scanTimer = null;
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    $('#scanRoot').innerHTML = '';
    if (pop && scanHasEntry) { scanHasEntry = false; skipPop++; history.back(); }
  }

  function openScanner(onCode) {
    const root = $('#scanRoot');
    root.innerHTML = '' +
      '<div class="scan-overlay">' +
        '<video id="scanVideo" playsinline muted autoplay></video>' +
        '<div class="scan-frame"><span></span><span></span><span></span><span></span></div>' +
        '<div class="scan-bar">' +
          '<button class="icon-btn" id="scanClose" aria-label="Close scanner"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
          '<p id="scanMsg">Point the camera at a barcode</p>' +
          '<button class="chip-btn" id="scanManual">Type it</button>' +
        '</div>' +
      '</div>';
    scanOpen = true;
    if (!scanHasEntry) { history.pushState({ t: 'scan' }, ''); scanHasEntry = true; }
    $('#scanClose').addEventListener('click', () => closeScanner());
    $('#scanManual').addEventListener('click', () => {
      closeScanner();
      openSheet('Enter barcode', '' +
        '<div class="field"><label for="bcNum">Barcode number</label>' +
          '<input id="bcNum" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 5711953068881"></div>' +
        '<button class="btn btn-primary" id="bcGo">Look it up</button>',
      (body) => {
        const input = $('#bcNum', body);
        input.focus();
        const go = () => {
          const code = input.value.trim();
          if (!/^\d{6,14}$/.test(code)) { toast('That does not look like a barcode'); return; }
          onCode(code);
        };
        $('#bcGo', body).addEventListener('click', go);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      });
    });

    const msg = $('#scanMsg');
    if (!('BarcodeDetector' in window)) {
      msg.textContent = 'This browser can’t scan — tap “Type it”';
      return;
    }
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    const video = $('#scanVideo');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (!scanOpen) { stream.getTracks().forEach((t) => t.stop()); return; }
        scanStream = stream;
        video.srcObject = stream;
        scanTimer = setInterval(async () => {
          if (!scanOpen || video.readyState < 2) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) {
              const code = codes[0].rawValue;
              haptic('tap');
              closeScanner();
              onCode(code);
            }
          } catch (e) { /* a dropped frame is not worth reporting */ }
        }, 350);
      })
      .catch(() => { msg.textContent = 'No camera access — tap “Type it”'; });
  }

  function lookupBarcode(code, slot, key) {
    toast('Looking up ' + code + '…');
    const url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) +
      '.json?fields=product_name,brands,serving_size,nutriments';
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const pr = data && data.product;
        if (!pr || (data.status !== undefined && data.status !== 1)) { notFound(code, slot, key); return; }
        const nut = pr.nutriments || {};
        const per100 = {
          kcal: Number(nut['energy-kcal_100g']) || (Number(nut.energy_100g) ? Number(nut.energy_100g) / 4.184 : 0),
          protein: Number(nut.proteins_100g) || 0,
          carbs: Number(nut.carbohydrates_100g) || 0,
          fat: Number(nut.fat_100g) || 0,
        };
        if (!per100.kcal) { toast('No nutrition data for that product'); notFound(code, slot, key); return; }
        const servMatch = String(pr.serving_size || '').match(/([\d.]+)\s*g/i);
        // a scanned product is a per-100 g food like any other, and worth keeping
        openPortionSheet({
          name: [pr.brands ? String(pr.brands).split(',')[0].trim() : '', pr.product_name || 'Scanned product'].filter(Boolean).join(' — '),
          unit: 'g', per: 100, serving: servMatch ? Math.round(Number(servMatch[1])) : 100,
          kcal: per100.kcal, protein: per100.protein, carbs: per100.carbs, fat: per100.fat,
        }, slot, key, { offerSave: true });
      })
      .catch(() => toast('Lookup failed — check your connection'));
  }

  function notFound(code, slot, key) {
    openSheet('Not found', '' +
      '<p class="empty-note">Barcode ' + esc(code) + ' isn’t in the food database yet.</p>' +
      '<button class="btn btn-primary" id="nfManual">Enter it by hand</button>',
      (body) => { $('#nfManual', body).addEventListener('click', () => { closeSheetNow(); openMealSheet(key || dateKey(), slot); }); });
  }

  /* ================= HABITS TAB ================= */

  const HABIT_ICONS = {
    dumbbell: '<path d="M6.5 7.5v9M3.5 9.5v5M17.5 7.5v9M20.5 9.5v5M6.5 12h11"/>',
    steps: '<path d="M3.5 12.4h3.6l2.3-5.8 3.9 11.2 2.2-5.4h4.9"/>',
    book: '<path d="M12 7.6C10.8 6 8.9 5.2 6 5.2H4v13h2.6c2.4 0 4.2.6 5.4 1.6 1.2-1 3-1.6 5.4-1.6H20v-13h-2c-2.9 0-4.8.8-6 2.4ZM12 7.6v12.2"/>',
    sleep: '<path d="M19.6 14.4A7.6 7.6 0 0 1 9.6 4.4a7.6 7.6 0 1 0 10 10Z"/>',
    water: '<path d="M12 3.6c3.1 3.6 5.3 6.1 5.3 8.8a5.3 5.3 0 1 1-10.6 0c0-2.7 2.2-5.2 5.3-8.8Z"/>',
    toothbrush: '<g transform="rotate(-30 12 12.4)"><path d="M8.4 8.2h7.2v2.8a1.8 1.8 0 0 1-1.8 1.8h-3.6a1.8 1.8 0 0 1-1.8-1.8Z"/><path d="M9.3 8.2V4.6M12 8.2V4.2M14.7 8.2V4.6"/><path d="M12 12.8v7.2"/></g>',
    run: '<path d="M14.2 5.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8ZM10.2 21l2.3-5.2-2.6-2.4.9-4.6-3.1 1.9-1.9 2.4M13.9 9.9l2.3 2.2 3.1-.6M10.7 7.4l3.4-1.2 2.1 2.6"/>',
    sun: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 2.6v1.8M12 19.6v1.8M2.6 12h1.8M19.6 12h1.8M5.3 5.3l1.3 1.3M17.4 17.4l1.3 1.3M18.7 5.3l-1.3 1.3M6.6 17.4l-1.3 1.3"/>',
    heart: '<path d="M12 20.2C8.4 17.6 4.4 14.4 4.4 10.6a3.9 3.9 0 0 1 7.6-1.4 3.9 3.9 0 0 1 7.6 1.4c0 3.8-4 7-7.6 9.6Z"/>',
    timer: '<path d="M12 21.2a8.1 8.1 0 1 0 0-16.2 8.1 8.1 0 0 0 0 16.2ZM12 9.2v4l2.6 1.6M9.4 2.6h5.2"/>',
    flame: '<path d="M12 3.2c.7 3.1 3.4 4.4 3.4 7.4 0 1-.4 2-1.2 2.8.5-1.7-.6-3.1-1.7-3.9.2 2.3-1.4 3.5-2.3 4.8-1.7 2.2.2 5.5 3.4 5.5 3.1 0 5.4-2.4 5.4-5.4 0-4.9-4.3-7.9-7-11.2Z"/>',
    pen: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/>',
    check: '<path d="M5 12.6 10 17.6 19 6.8"/>',
    brain: '<path d="M9.5 4.5A2.6 2.6 0 0 0 7 7.1a2.5 2.5 0 0 0-1.4 4.4A2.6 2.6 0 0 0 7.3 16c.2 1.6 1.3 2.7 2.9 2.7.9 0 1.6-.4 1.8-1V5.9c-.4-.9-1.3-1.4-2.5-1.4ZM14.5 4.5A2.6 2.6 0 0 1 17 7.1a2.5 2.5 0 0 1 1.4 4.4A2.6 2.6 0 0 1 16.7 16c-.2 1.6-1.3 2.7-2.9 2.7-.9 0-1.6-.4-1.8-1"/>',
    money: '<path d="M12 4v16M15.6 8c-.6-1.1-1.9-1.8-3.6-1.8-2.1 0-3.5 1-3.5 2.6 0 3.7 7.2 2.1 7.2 5.8 0 1.7-1.6 2.8-3.8 2.8-1.9 0-3.3-.7-3.9-2"/>',
  };
  const HABIT_ICON_KEYS = Object.keys(HABIT_ICONS);
  const habitIcon = (key) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (HABIT_ICONS[key] || HABIT_ICONS.check) + '</svg>';

  let habitMonthOffset = 0;   // 0 = this month
  let habitReorder = false;   // rows show move handles instead of their action

  /* Swap a habit with its neighbour. habitsList() hides archived ones, so the
     move works on the visible order and writes back to the real array. */
  function moveHabit(id, dir) {
    const visible = habitsList();
    const at = visible.findIndex((h) => h.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= visible.length) return;
    const a = state.habits.indexOf(visible[at]);
    const b = state.habits.indexOf(visible[to]);
    [state.habits[a], state.habits[b]] = [state.habits[b], state.habits[a]];
    save(); render();
  }

  /* a habit can fill itself in from what the app already knows — a workout you
     finished, a weigh-in, the protein you ate — instead of a manual tick */
  const HABIT_SOURCES = {
    workout: { label: 'A workout is logged', type: 'check', unit: '', tab: 'workout' },
    weight:  { label: 'Bodyweight is logged', type: 'check', unit: '', tab: 'weight' },
    protein: { label: 'Protein eaten', type: 'count', unit: 'g', tab: 'meals' },
    kcal:    { label: 'Calories eaten', type: 'count', unit: 'kcal', tab: 'meals' },
  };
  function habitAuto(h, key) {
    switch (h.source) {
      case 'workout': return state.workouts.some((w) => dateKey(new Date(w.startedAt)) === key) ? 1 : 0;
      case 'weight': return weightOn(key) ? 1 : 0;
      case 'protein': return Math.round(dayTotals(key).protein);
      case 'kcal': return Math.round(dayTotals(key).kcal);
      default: return null;
    }
  }
  function habitsList() { return (state.habits || []).filter((h) => !h.archived); }
  function habitById(id) { return (state.habits || []).find((h) => h.id === id); }
  function habitType(h) { return (h.source && HABIT_SOURCES[h.source]) ? HABIT_SOURCES[h.source].type : h.type; }
  function habitUnit(h) { return (h.source && HABIT_SOURCES[h.source]) ? HABIT_SOURCES[h.source].unit : (h.unit || ''); }
  function habitValue(id, key = dateKey()) {
    const h = habitById(id);
    if (h && h.source) {
      const v = habitAuto(h, key);
      if (v != null) return v;
    }
    return ((state.habitLog || {})[key] || {})[id] || 0;
  }
  function habitTarget(h) {
    // linked habits follow the goal they mirror, so changing it in one place is enough
    if (h.source === 'protein') return state.nutrition.targets.protein || 1;
    if (h.source === 'kcal') return state.nutrition.targets.kcal || 1;
    return habitType(h) === 'check' ? 1 : (h.target || 1);
  }
  function habitDone(h, key = dateKey()) { return habitValue(h.id, key) >= habitTarget(h); }
  /* Almost there is worth saying here too. A habit that mirrors a macro uses
     the same margin the nutrition page does, so 166 of 170 g reads the same
     in both places; anything else is within a twentieth of its target. */
  function habitNear(h, key = dateKey()) {
    if (habitType(h) === 'check') return false;
    const target = habitTarget(h);
    const val = habitValue(h.id, key);
    if (!target || val >= target || val <= 0) return false;
    const margin = h.source === 'kcal' ? NEAR_KCAL
      : h.source === 'protein' ? NEAR_G
      : Math.max(1, target * 0.05);
    return target - val <= margin;
  }
  function setHabitValue(id, val, key = dateKey()) {
    if (!state.habitLog) state.habitLog = {};
    const day = state.habitLog[key] || (state.habitLog[key] = {});
    if (val > 0) day[id] = val; else delete day[id];
    if (!Object.keys(day).length) delete state.habitLog[key];
  }
  // consecutive days ending today (or yesterday, if today isn't logged yet)
  /* A habit is not owed every day. 'daily' is every day, 'plan' follows the
     weekly workout plan (so rest days are excused), and 'days' is whichever
     weekdays you pick. A day a habit isn't due can never break its streak. */
  function habitDueOn(h, key = dateKey()) {
    const idx = (new Date(key + 'T12:00:00').getDay() + 6) % 7;   // 0 = Monday
    const mode = h.due || 'daily';
    if (mode === 'plan') {
      if (!(state.schedule || []).some(Boolean)) return true;     // no plan yet
      const planned = plannedFor(idx);
      return !!planned && !planned.rest;
    }
    if (mode === 'days') return !(Array.isArray(h.days) && h.days[idx] === false);
    return true;
  }
  const habitsDueOn = (key = dateKey()) => habitsList().filter((h) => habitDueOn(h, key));

  function habitStreak(h) {
    const d = new Date();
    // today only ends the streak once it is actually due and still undone
    if (habitDueOn(h, dateKey(d)) && !habitDone(h, dateKey(d))) d.setDate(d.getDate() - 1);
    let count = 0;
    for (let i = 0; i < 400; i++) {
      const key = dateKey(d);
      if (habitDueOn(h, key)) {
        if (!habitDone(h, key)) break;
        count++;
      }
      d.setDate(d.getDate() - 1);
    }
    return count;
  }
  function habitsDone(key = dateKey()) {
    const due = habitsDueOn(key);
    return { done: due.filter((h) => habitDone(h, key)).length, total: due.length };
  }
  // compact cell text: 10000 -> 10k, 6400 -> 6.4k
  function habitShort(v) {
    if (v >= 10000) return Math.round(v / 1000) + 'k';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v * 10) / 10);
  }
  function habitRing(h, key) {
    const frac = Math.min(1, habitValue(h.id, key) / habitTarget(h));
    const near = frac < 1 && habitNear(h, key);
    const r = 15.5, C = 2 * Math.PI * r;
    // a full ring goes green, the same as everywhere else a day is finished;
    // one nearly full takes the held-back green the macros use
    return '<svg class="hb-ring-svg' + (frac >= 1 ? ' is-full' : near ? ' is-near' : '') + '" viewBox="0 0 36 36" aria-hidden="true">' +
      '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="2.6"/>' +
      '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="' + (frac >= 1 ? 'var(--done)' : near ? 'var(--near)' : 'var(--ink-1)') + '" stroke-width="2.6" stroke-linecap="round"' +
      ' stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '" transform="rotate(-90 18 18)"/></svg>';
  }
  // the tick that sits inside a finished ring, so a counted habit reads as
  // done at a glance rather than as a circle that happens to be full
  const habitTick = '<svg class="hb-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.6 10 17.6 19 6.8"/></svg>';

  function renderHabits() {
    const v = $('#view');
    const list = habitsList();
    const todayKey = dateKey();
    const today = new Date();
    const { done, total } = habitsDone();

    // ---- month calendar: one cell per day, filled by how much of that day
    //      was completed, so a whole month fits without scrolling ----
    const gridMonth = new Date(today.getFullYear(), today.getMonth() + habitMonthOffset, 1);
    const daysInMonth = new Date(gridMonth.getFullYear(), gridMonth.getMonth() + 1, 0).getDate();
    const firstDow = (new Date(gridMonth.getFullYear(), gridMonth.getMonth(), 1).getDay() + 6) % 7;
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<span class="hc-pad"></span>';
    for (let dnum = 1; dnum <= daysInMonth; dnum++) {
      const d = new Date(gridMonth.getFullYear(), gridMonth.getMonth(), dnum);
      const key = dateKey(d);
      const due = habitsDueOn(key);
      const doneCount = due.filter((h) => habitDone(h, key)).length;
      const pct = due.length ? Math.round((doneCount / due.length) * 100) : 0;
      const state = !due.length ? 'is-off' : pct === 100 ? 'is-full' : doneCount ? 'is-part' : '';
      cells += '<button class="hc-day ' + state + (key === todayKey ? ' is-today' : '') + (key > todayKey ? ' is-future' : '') +
        '" data-day="' + key + '" aria-label="' + dnum + ': ' + (due.length ? doneCount + ' of ' + due.length + ' done' : 'nothing due') + '">' +
        (state === 'is-part' ? '<i class="hc-fill" style="height:' + pct + '%"></i>' : '') +
        '<span>' + dnum + '</span></button>';
    }

    // ---- list view: a column per habit, values in the cells ----
    const cols = list.slice(0, 5);
    const dowLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    let rows = '';
    for (let dnum = 1; dnum <= daysInMonth; dnum++) {
      const d = new Date(gridMonth.getFullYear(), gridMonth.getMonth(), dnum);
      const key = dateKey(d);
      const dueToday = habitsDueOn(key);
      const doneCount = dueToday.filter((h) => habitDone(h, key)).length;
      const pct = dueToday.length ? Math.round((doneCount / dueToday.length) * 100) : 0;
      rows += '<tr class="' + (dueToday.length && pct === 100 ? 'is-all ' : '') + (key === todayKey ? 'is-today' : key > todayKey ? 'is-future' : '') + '">' +
        '<th scope="row" data-day="' + key + '"><span class="hg-d">' + dnum + '</span><span class="hg-w">' + dowLetters[d.getDay()] + '</span>' +
          '<i class="hg-bar"><b style="width:' + pct + '%"></b></i></th>' +
        cols.map((h) => {
          const val = habitValue(h.id, key);
          const ok = val >= habitTarget(h);
          const off = !habitDueOn(h, key);
          const txt = val ? (habitType(h) === 'check' ? '✓' : habitShort(val)) : off ? '–' : '·';
          return '<td class="' + (ok ? 'is-on' : val ? 'is-part' : off ? 'is-off' : '') + '" data-cell="' + esc(h.id) + '" data-day="' + key + '">' + txt + '</td>';
        }).join('') + '</tr>';
    }

    const monthLabel = gridMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const hView = state.settings.habitView === 'list' ? 'list' : 'calendar';

    v.innerHTML =
      '<div class="page-head">' +
        '<div><h2>Habits</h2><p class="subtitle' + (total && done === total ? ' all-done' : '') + '">' + done + ' of ' + total + ' done today</p></div>' +
        '<div class="ph-actions">' +
          '<button class="icon-btn" id="hbViewBtn" aria-label="' + (hView === 'calendar' ? 'Switch to list view' : 'Switch to calendar view') + '">' +
            (hView === 'calendar'
              ? '<svg viewBox="0 0 24 24"><path d="M4 6.5h3M10 6.5h10M4 12h3M10 12h10M4 17.5h3M10 17.5h10"/></svg>'
              : '<svg viewBox="0 0 24 24"><path d="M4.5 5.5h15v13h-15Z"/><path d="M4.5 10h15M9.5 10v8.5M14.5 10v8.5"/></svg>') +
          '</button>' +
          '<button class="icon-btn" id="hbAdd" aria-label="New habit"><svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13"/></svg></button>' +
        '</div>' +
      '</div>' +

      (list.length ? (
      '<div class="card hb-today-card">' +
        '<div class="hb-th"><span class="micro">' + (habitReorder ? 'Reorder' : 'Today') + '</span>' +
          (list.length > 1
            ? '<button class="hb-reorder" id="hbReorder">' + (habitReorder ? 'Done' : '⇅ Reorder') + '</button>'
            : '<span class="hb-th-date">' + today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '</span>') +
        '</div>' +
        list.map((h, i) => {
          const val = habitValue(h.id, todayKey);
          const ok = val >= habitTarget(h);
          const streak = habitStreak(h);
          const off = !habitDueOn(h, todayKey);
          const sub = off
            ? 'Rest day' + (streak > 1 ? ' · ' + streak + ' day streak kept' : '')
            : habitType(h) === 'check'
            ? (ok ? 'Done' : 'Not yet') + (streak > 1 ? ' · ' + streak + ' day streak' : '')
            : habitShort(val) + ' / ' + habitShort(habitTarget(h)) + (habitUnit(h) ? ' ' + esc(habitUnit(h)) : '') + (streak > 1 ? ' · ' + streak + ' day streak' : '');
          return '<div class="hb-row ' + (ok ? 'is-done' : '') + (h.source ? ' is-auto' : '') + (off ? ' is-off' : '') + '" data-habit="' + esc(h.id) + '" role="button" tabindex="0">' +
            '<span class="hb-ico">' + habitIcon(h.icon) + '</span>' +
            '<div class="hb-body"><div class="hb-name">' + esc(h.name) + '</div><div class="hb-sub">' + sub + '</div></div>' +
            (habitReorder ? '' : h.source ? '<span class="hb-auto" title="Fills in automatically"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5.5 13.5H11l-1 7.5L18.5 10H13Z"/></svg></span>' : '') +
            (habitReorder
              ? '<span class="hb-moves">' +
                  '<button class="hb-move" data-move="-1" data-habit="' + esc(h.id) + '" aria-label="Move ' + esc(h.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' +
                    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>' +
                  '<button class="hb-move" data-move="1" data-habit="' + esc(h.id) + '" aria-label="Move ' + esc(h.name) + ' down"' + (i === list.length - 1 ? ' disabled' : '') + '>' +
                    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>' +
                '</span>'
              : habitType(h) === 'check'
              ? '<span class="hb-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.6 10 17.6 19 6.8"/></svg></span>'
              : '<span class="hb-mini">' + habitRing(h, todayKey) + (ok ? habitTick : '') + '</span>' +
                (h.source ? '' : '<button class="hb-plus" data-step="' + esc(h.id) + '" aria-label="Add ' + (h.step || 1) + ' ' + esc(habitUnit(h)) + '">+</button>')) +
          '</div>';
        }).join('') +
      '</div>' +

      '<div class="card hb-grid-card">' +
        '<div class="hb-month">' +
          '<button class="hb-nav" id="hbPrev" aria-label="Previous month">‹</button>' +
          '<span>' + esc(monthLabel) + '</span>' +
          '<button class="hb-nav" id="hbNext" aria-label="Next month" ' + (habitMonthOffset >= 0 ? 'disabled' : '') + '>›</button>' +
        '</div>' +
        (hView === 'calendar'
          ? '<div class="hc-dow">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l) => '<span>' + l + '</span>').join('') + '</div>' +
            '<div class="hc-grid">' + cells + '</div>'
          : '<div class="hb-grid-scroll" id="hbScroll">' +
              '<table class="hb-grid"><thead><tr><th></th>' +
                cols.map((h) => '<th><span>' + esc(h.name.length > 7 ? h.name.slice(0, 7) : h.name) + '</span></th>').join('') +
              '</tr></thead><tbody>' + rows + '</tbody></table>' +
            '</div>' +
            (list.length > 5 ? '<p class="hb-note">Showing the first 5 habits — tap a date for the rest.</p>' : '')) +
      '</div>'
      ) : '<p class="empty-note">No habits yet. Tap + to add your first one.</p>');

    $('#hbAdd').addEventListener('click', () => openHabitEditor());
    const prev = $('#hbPrev'); if (prev) prev.addEventListener('click', () => { habitMonthOffset -= 1; render(); });
    const next = $('#hbNext'); if (next) next.addEventListener('click', () => { if (habitMonthOffset < 0) { habitMonthOffset += 1; render(); } });

    const reorderBtn = $('#hbReorder');
    if (reorderBtn) reorderBtn.addEventListener('click', () => { habitReorder = !habitReorder; render(); });
    $$('.hb-move', v).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      moveHabit(b.dataset.habit, Number(b.dataset.move));
    }));

    $$('.hb-row', v).forEach((row) => {
      // hold a habit to see how it has been going, rather than logging it
      longPress(row, () => {
        if (habitReorder) return;
        const h = habitById(row.dataset.habit);
        if (h) openHabitDetail(h.id);
      });
      row.addEventListener('click', (e) => {
        if (habitReorder) return;
        const h = habitById(row.dataset.habit);
        if (!h) return;
        if (h.source) { goHabitSource(h); return; }
        if (e.target.closest('[data-step]')) {
          e.stopPropagation();
          setHabitValue(h.id, habitValue(h.id) + (h.step || 1));
          save(); render();
          return;
        }
        if (habitType(h) === 'check') { toggleHabit(h); return; }
        openHabitPad(h, todayKey);
      });
    });
    $$('.hc-day', v).forEach((cell) => cell.addEventListener('click', () => openDaySheet(cell.dataset.day)));
    $('#hbViewBtn').addEventListener('click', () => {
      state.settings.habitView = hView === 'calendar' ? 'list' : 'calendar';
      save(); render();
    });
    $$('.hb-grid th[data-day]', v).forEach((th) => th.addEventListener('click', () => openDaySheet(th.dataset.day)));
    $$('.hb-grid td[data-cell]', v).forEach((cell) => cell.addEventListener('click', () => {
      const h = habitById(cell.dataset.cell);
      if (!h) return;
      if (h.source) { toast(esc(h.name) + ' fills in automatically'); return; }
      if (habitType(h) === 'check') { toggleHabit(h, cell.dataset.day); return; }
      openHabitPad(h, cell.dataset.day);
    }));
    // in list view, start on today rather than the 1st
    const scroll = $('#hbScroll');
    const todayRow = scroll && $('tr.is-today', scroll);
    if (scroll && todayRow) scroll.scrollTop = Math.max(0, todayRow.offsetTop - scroll.clientHeight / 2);
    // long-press a today row to edit the habit itself
    $$('.hb-row', v).forEach((row) => {
      let t = null;
      const start = () => { t = setTimeout(() => openHabitEditor(row.dataset.habit), 550); };
      const stop = () => clearTimeout(t);
      row.addEventListener('touchstart', start, { passive: true });
      row.addEventListener('touchend', stop);
      row.addEventListener('touchmove', stop, { passive: true });
    });


  }

  // tapping a linked habit takes you to wherever it gets filled in
  function goHabitSource(h) {
    const tab = HABIT_SOURCES[h.source]?.tab;
    if (tab === 'weight') { openWeightSheet(); return; }
    if (tab === 'meals') { mealDayOffset = 0; goTab('meals'); return; }
    if (tab === 'workout') { goTab('workout'); return; }
  }

  /* everything logged on one date, opened from the calendar */
  function openDaySheet(key) {
    const d = new Date(key + 'T00:00:00');
    const list = habitsList();
    const paint = () => habitsList().map((h) => {
      const val = habitValue(h.id, key);
      const ok = val >= habitTarget(h);
      const sub = habitType(h) === 'check'
        ? (ok ? 'Done' : 'Not yet')
        : habitShort(val) + ' / ' + habitShort(habitTarget(h)) + (habitUnit(h) ? ' ' + esc(habitUnit(h)) : '');
      return '<div class="hb-row ' + (ok ? 'is-done' : '') + (h.source ? ' is-auto' : '') + '" data-habit="' + esc(h.id) + '" role="button" tabindex="0">' +
        '<span class="hb-ico">' + habitIcon(h.icon) + '</span>' +
        '<div class="hb-body"><div class="hb-name">' + esc(h.name) + '</div><div class="hb-sub">' + sub + '</div></div>' +
        (h.source ? '<span class="hb-auto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5.5 13.5H11l-1 7.5L18.5 10H13Z"/></svg></span>' : '') +
        (habitType(h) === 'check'
          ? '<span class="hb-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.6 10 17.6 19 6.8"/></svg></span>'
          : '<span class="hb-mini">' + habitRing(h, key) + (ok ? habitTick : '') + '</span>') +
      '</div>';
    }).join('');

    const mount = (body) => {
      $$('.hb-row', body).forEach((row) => row.addEventListener('click', () => {
        const h = habitById(row.dataset.habit);
        if (!h) return;
        if (h.source) { toast(esc(h.name) + ' fills in automatically'); return; }
        if (habitType(h) === 'check') {
          setHabitValue(h.id, habitDone(h, key) ? 0 : 1, key);
          save(); render();
          openSheet(title, paint(), mount);   // repaint in place
          return;
        }
        openHabitPad(h, key);
      }));
    };
    const title = key === dateKey() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    if (!list.length) { toast('No habits yet'); return; }
    openSheet(title, paint(), mount);
  }

  function toggleHabit(h, key = dateKey()) {
    const on = habitDone(h, key);
    setHabitValue(h.id, on ? 0 : 1, key);
    haptic(on ? 'tap' : 'tick');
    save(); render();
  }

  /* numeric pad for count habits (tap a value, then Track) */
  function openHabitPad(h, key = dateKey()) {
    const d = new Date(key + 'T00:00:00');
    const label = (key === dateKey() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })) +
      ' · ' + d.getDate() + ' ' + d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
    openSheet(h.name, '' +
      '<div class="pad-wrap">' +
        '<div class="pad-top"><span class="micro">' + esc(label) + '</span>' +
          '<span class="pad-target">Goal ' + habitShort(habitTarget(h)) + (h.unit ? ' ' + esc(h.unit) : '') + '</span></div>' +
        '<div class="pad-display"><span class="micro">' + esc((h.unit || 'amount').toUpperCase()) + '</span>' +
          '<div class="pad-value" id="padVal">' + (habitValue(h.id, key) || 0) + '</div></div>' +
        '<div class="pad-keys">' +
          keys.map((k) => '<button class="pad-key' + (k === 'del' ? ' pad-del' : '') + '" data-k="' + k + '">' +
            (k === 'del' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10.5v12H9L3.5 12Z"/><path d="M12.5 10l4 4M16.5 10l-4 4"/></svg>' : k) + '</button>').join('') +
        '</div>' +
        '<div class="pad-actions">' +
          '<button class="btn btn-ghost" id="padClear">Clear</button>' +
          '<button class="btn btn-primary" id="padSave">Track</button>' +
        '</div>' +
      '</div>', (body) => {
      // the current value is shown, but typing starts a fresh number
      let buf = String(habitValue(h.id, key) || '');
      let fresh = true;
      const disp = $('#padVal', body);
      const paint = () => { disp.textContent = buf === '' ? '0' : buf; };
      $$('.pad-key', body).forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.k;
        if (fresh && k !== 'del') { buf = ''; fresh = false; }
        if (k === 'del') { fresh = false; buf = buf.slice(0, -1); }
        else if (k === '.') { if (!buf.includes('.')) buf = (buf || '0') + '.'; }
        else buf = (buf === '0' ? '' : buf) + k;
        if (buf.replace('.', '').length > 7) buf = buf.slice(0, 8);
        paint();
      }));
      $('#padClear', body).addEventListener('click', () => { buf = ''; paint(); });
      $('#padSave', body).addEventListener('click', () => {
        setHabitValue(h.id, Number(buf) || 0, key);
        haptic(habitDone(h, key) ? 'tick' : 'tap');
        save(); closeSheet(); render();
      });
    });
  }


  /* ---- importing a habit's history from an exported file ----
     Samsung Health has no web API — nothing in a browser can read it live.
     What it does have is "Download personal data", which produces CSVs, and
     those we can read. The parser is deliberately loose so a Google Fit or
     Health Connect export works too. */

  function splitCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseDayValue(raw) {
    const v = String(raw).trim();
    if (!v) return null;
    if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000);        // epoch seconds
    if (/^\d{13}$/.test(v)) return new Date(Number(v));               // epoch millis
    const d = new Date(v.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }

  // -> { days: {key: value}, count, span } or { error }
  function parseHabitCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { error: 'That file is empty.' };
    let headerAt = -1, cols = null;
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const c = splitCsvLine(lines[i]).map((x) => x.trim().toLowerCase());
      const hasValue = c.some((x) => /(^|_)(step_count|steps|count|value|total)($|_)/.test(x));
      const hasDate = c.some((x) => /(time|date)/.test(x));
      if (hasValue && hasDate) { headerAt = i; cols = c; break; }
    }
    if (headerAt < 0) return { error: 'Could not find a date and a value column in that file.' };

    const pick = (patterns) => {
      for (const p of patterns) {
        const i = cols.findIndex((c) => p.test(c));
        if (i >= 0) return i;
      }
      return -1;
    };
    const valueIdx = pick([/^step_count$/, /^steps$/, /step/, /^count$/, /^value$/, /^total$/, /count/]);
    const dateIdx = pick([/^day_time$/, /^date$/, /^start_time$/, /^create_time$/, /date/, /time/]);
    if (valueIdx < 0 || dateIdx < 0) return { error: 'Could not find a date and a value column in that file.' };

    const days = {};
    for (let i = headerAt + 1; i < lines.length; i++) {
      const row = splitCsvLine(lines[i]);
      if (row.length <= Math.max(valueIdx, dateIdx)) continue;
      const d = parseDayValue(row[dateIdx]);
      const val = Number(String(row[valueIdx]).trim());
      if (!d || !Number.isFinite(val) || val <= 0) continue;
      const key = dateKey(d);
      days[key] = Math.max(days[key] || 0, Math.round(val));   // one row per day wins
    }
    const keys = Object.keys(days).sort();
    if (!keys.length) return { error: 'No usable rows in that file.' };
    return { days, count: keys.length, from: keys[0], to: keys[keys.length - 1] };
  }

  /* A file shared into the app lands in the cache; on the next load we read it
     out, ask which habit it belongs to, and import it. */
  function checkSharedImport() {
    const q = new URLSearchParams(location.search);
    if (!q.has('shared')) return;
    history.replaceState({}, '', location.pathname);
    if (q.get('shared') === 'error' || !('caches' in window)) { toast('Could not read the shared file'); return; }
    // search every cache: during an update the worker that stashed the file may
    // be a version ahead of this page
    caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.open(n).then((c) => c.match('shared-import').then((r) => (r ? { c, r } : null))))))
      .then((hits) => hits.find(Boolean))
      .then((hit) => (hit ? hit.r.text().then((t) => { hit.c.delete('shared-import'); return t; }) : null))
      .then((text) => {
        if (!text) { toast('Nothing came through'); return; }
        const parsed = parseHabitCsv(text);
        if (parsed.error) { toast(parsed.error); return; }
        const targets = habitsList().filter((x) => habitType(x) === 'count' && !x.source);
        if (!targets.length) { toast('No amount-based habit to import into'); return; }
        openSheet('Imported file', '' +
          '<div class="imp-ok"><b>' + parsed.count + ' days</b> found, ' +
            esc(fmtShortDate(new Date(parsed.from + 'T12:00:00').getTime())) + ' – ' +
            esc(fmtShortDate(new Date(parsed.to + 'T12:00:00').getTime())) + '</div>' +
          '<div class="lib-group-title">Import into</div>' +
          targets.map((x) => '<div class="lib-item" data-into="' + esc(x.id) + '" role="button" tabindex="0">' +
            '<div><div class="li-name">' + esc(x.name) + '</div>' +
            '<div class="li-sub">goal ' + habitShort(habitTarget(x)) + ' ' + esc(habitUnit(x)) + '</div></div>' +
            '<span class="li-best">+</span></div>').join(''),
        (body) => {
          body.addEventListener('click', (e) => {
            const item = e.target.closest('[data-into]');
            if (!item) return;
            Object.entries(parsed.days).forEach(([key, val]) => setHabitValue(item.dataset.into, val, key));
            save(); closeSheet(); goTab('habits');
            toast(parsed.count + ' days imported');
          });
        });
      })
      .catch(() => toast('Could not read the shared file'));
  }

  function openHabitImport(h) {
    openSheet('Import ' + h.name, '' +
      '<p class="confirm-msg">Nothing in a browser can read Samsung Health directly — it has no web API. What works is its export:</p>' +
      '<ol class="how-list">' +
        '<li>Samsung Health → <b>⋮</b> → Settings → <b>Download personal data</b></li>' +
        '<li>Unzip the file it gives you</li>' +
        '<li>Pick the file with <b>pedometer_day_summary</b> in its name</li>' +
      '</ol>' +
      '<button class="btn btn-primary" id="impPick">Choose a CSV file</button>' +
      '<input id="impFile" type="file" accept=".csv,text/csv,text/plain" hidden>' +
      '<div id="impOut"></div>',
    (body) => {
      const out = $('#impOut', body);
      $('#impPick', body).addEventListener('click', () => $('#impFile', body).click());
      $('#impFile', body).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        file.text().then((text) => {
          const res = parseHabitCsv(text);
          if (res.error) { out.innerHTML = '<p class="imp-err">' + esc(res.error) + '</p>'; return; }
          out.innerHTML =
            '<div class="imp-ok"><b>' + res.count + ' days</b> found, ' +
              esc(fmtShortDate(new Date(res.from + 'T12:00:00').getTime())) + ' – ' +
              esc(fmtShortDate(new Date(res.to + 'T12:00:00').getTime())) + '</div>' +
            '<button class="btn btn-primary" id="impGo">Import into ' + esc(h.name) + '</button>';
          $('#impGo', out).addEventListener('click', () => {
            Object.entries(res.days).forEach(([key, val]) => setHabitValue(h.id, val, key));
            save(); closeSheet(); render();
            toast(res.count + ' days imported');
          });
        }).catch(() => { out.innerHTML = '<p class="imp-err">Could not read that file.</p>'; });
      });
    });
  }

  /* One habit's own record: how it is going now, how it has gone, and every
     day of the last few weeks. Reached by holding the habit. */
  function openHabitDetail(id) {
    const h = habitById(id);
    if (!h) return;
    const today = new Date();
    const streak = habitStreak(h);

    // the last 28 days, oldest first, in rows of seven
    const days = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (27 - i));
      const key = dateKey(d);
      const due = habitDueOn(h, key);
      return { key, n: d.getDate(), due, done: due && habitDone(h, key), value: habitValue(h.id, key) };
    });
    const due = days.filter((d) => d.due);
    const doneCount = due.filter((d) => d.done).length;
    const rate = due.length ? Math.round((doneCount / due.length) * 100) : 0;

    // the best run there has ever been, over everything logged
    const keys = Object.keys(state.habitLog || {}).sort();
    let best = 0, run = 0;
    if (keys.length) {
      const from = new Date(keys[0] + 'T12:00:00');
      for (const d = new Date(from); d <= today; d.setDate(d.getDate() + 1)) {
        const key = dateKey(d);
        if (!habitDueOn(h, key)) continue;
        if (habitDone(h, key)) { run++; best = Math.max(best, run); } else run = 0;
      }
    }
    best = Math.max(best, streak);
    const unitTxt = habitUnit(h) ? ' ' + habitUnit(h) : '';

    openSheet(h.name, '' +
      '<div class="hd-stats">' +
        '<div><span class="micro">Streak</span><b>' + streak + '<i>' + (streak === 1 ? 'day' : 'days') + '</i></b></div>' +
        '<div><span class="micro">Best</span><b>' + best + '<i>' + (best === 1 ? 'day' : 'days') + '</i></b></div>' +
        '<div><span class="micro">28 days</span><b>' + rate + '<i>%</i></b></div>' +
        '<div><span class="micro">Done</span><b>' + doneCount + '<i>/' + due.length + '</i></b></div>' +
      '</div>' +
      '<div class="hd-grid">' +
        days.map((d) => '<span class="hd-cell' + (d.done ? ' is-done' : d.due ? '' : ' is-off') + '"' +
          ' title="' + d.key + '">' + d.n + '</span>').join('') +
      '</div>' +
      '<p class="hd-legend">Green is done · faint is a day it was not due</p>' +
      (habitType(h) === 'count'
        ? '<p class="hd-target">Target ' + habitShort(habitTarget(h)) + esc(unitTxt) + ' a day</p>'
        : '') +
      '<button class="btn btn-quiet" id="hdEdit" style="margin-top:14px">Edit habit</button>',
    (body) => {
      $('#hdEdit', body).addEventListener('click', () => {
        closeSheetNow();
        queueMicrotask(() => openHabitEditor(h.id));
      });
    });
  }

  function openHabitEditor(id) {
    const h = id ? habitById(id) : null;
    const draft = h ? { ...h } : { id: uid(), name: '', icon: 'check', type: 'check', target: 1, unit: '', step: 1 };
    openSheet(h ? 'Edit habit' : 'New habit', '' +
      '<div class="field"><label for="hbName">Name</label>' +
        '<input id="hbName" type="text" placeholder="e.g. Read" value="' + esc(draft.name) + '"></div>' +
      '<span class="micro" style="margin-bottom:8px">Icon</span>' +
      '<div class="icon-pick" id="hbIcons">' +
        HABIT_ICON_KEYS.map((k) => '<button class="ip-btn ' + (k === draft.icon ? 'is-on' : '') + '" data-icon="' + k + '" aria-label="' + k + '">' + habitIcon(k) + '</button>').join('') +
      '</div>' +
      '<span class="micro" style="margin:14px 0 8px">Due on</span>' +
      '<div class="src-pick" id="hbDue">' +
        '<button data-due="daily" class="' + ((draft.due || 'daily') === 'daily' ? 'is-on' : '') + '">Every day</button>' +
        '<button data-due="plan" class="' + (draft.due === 'plan' ? 'is-on' : '') + '">Training days</button>' +
        '<button data-due="days" class="' + (draft.due === 'days' ? 'is-on' : '') + '">Pick days</button>' +
      '</div>' +
      '<p class="due-note" id="dueNote"></p>' +
      '<div class="day-pick" id="hbDays" ' + (draft.due === 'days' ? '' : 'hidden') + '>' +
        ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) =>
          '<button data-day="' + i + '" class="' + (draft.days && draft.days[i] === false ? '' : 'is-on') + '">' + l + '</button>').join('') +
      '</div>' +
      '<span class="micro" style="margin:14px 0 8px">Fills in</span>' +
      '<div class="src-pick" id="hbSource">' +
        '<button data-src="" class="' + (!draft.source ? 'is-on' : '') + '">By hand</button>' +
        Object.entries(HABIT_SOURCES).map(([k, v]) =>
          '<button data-src="' + k + '" class="' + (draft.source === k ? 'is-on' : '') + '">' + v.label + '</button>').join('') +
      '</div>' +
      '<div id="hbManual" ' + (draft.source ? 'hidden' : '') + '>' +
      '<span class="micro" style="margin:14px 0 8px">Type</span>' +
      '<div class="seg" id="hbType">' +
        '<button data-type="check" class="' + (draft.type === 'check' ? 'is-on' : '') + '">Done / not done</button>' +
        '<button data-type="count" class="' + (draft.type === 'count' ? 'is-on' : '') + '">Amount</button>' +
      '</div>' +
      '<div id="hbCountFields" ' + (draft.type === 'count' ? '' : 'hidden') + '>' +
        '<div class="field-row" style="margin-top:14px">' +
          '<div class="field"><label for="hbTarget">Daily goal</label><input id="hbTarget" type="number" inputmode="decimal" min="0" value="' + (draft.target || '') + '"></div>' +
          '<div class="field"><label for="hbUnit">Unit</label><input id="hbUnit" type="text" placeholder="pages" value="' + esc(draft.unit || '') + '"></div>' +
        '</div>' +
        '<div class="field"><label for="hbStep">+ button adds</label><input id="hbStep" type="number" inputmode="decimal" min="0" value="' + (draft.step || 1) + '"></div>' +
      '</div>' +
      '</div>' +
      (h && habitType(h) === 'count' && !h.source
        ? '<button class="btn btn-quiet" id="hbImport" style="margin-top:16px">Import history from a file</button>' : '') +
      '<button class="btn btn-primary" id="hbSave" style="margin-top:' + (h && habitType(h) === 'count' && !h.source ? '10px' : '16px') + '">' + (h ? 'Save habit' : 'Add habit') + '</button>' +
      (h ? '<button class="btn btn-danger" id="hbDel" style="margin-top:10px">Delete habit</button>' : ''),
    (body) => {
      $$('.ip-btn', body).forEach((b) => b.addEventListener('click', () => {
        draft.icon = b.dataset.icon;
        $$('.ip-btn', body).forEach((x) => x.classList.toggle('is-on', x === b));
      }));
      const note = $('#dueNote', body);
      const paintNote = () => {
        const mode = draft.due || 'daily';
        note.textContent = mode === 'plan'
          ? 'Only on days your weekly plan has a session. Rest days are skipped, and skipping one never breaks the streak.'
          : mode === 'days'
          ? 'Only on the days you pick below. The others are skipped rather than missed.'
          : 'Owed every day.';
      };
      paintNote();
      $$('#hbDue button', body).forEach((b) => b.addEventListener('click', () => {
        draft.due = b.dataset.due;
        if (draft.due === 'days' && !Array.isArray(draft.days)) draft.days = [true, true, true, true, true, true, true];
        $$('#hbDue button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        $('#hbDays', body).hidden = draft.due !== 'days';
        paintNote();
      }));
      $$('#hbDays button', body).forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.day);
        if (!Array.isArray(draft.days)) draft.days = [true, true, true, true, true, true, true];
        draft.days[i] = !(draft.days[i] !== false);
        b.classList.toggle('is-on', draft.days[i] !== false);
      }));

      $$('#hbSource button', body).forEach((b) => b.addEventListener('click', () => {
        draft.source = b.dataset.src || null;
        $$('#hbSource button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        $('#hbManual', body).hidden = !!draft.source;
      }));
      $$('#hbType button', body).forEach((b) => b.addEventListener('click', () => {
        draft.type = b.dataset.type;
        $$('#hbType button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        $('#hbCountFields', body).hidden = draft.type !== 'count';
      }));
      const imp = $('#hbImport', body);
      if (imp) imp.addEventListener('click', () => { closeSheetNow(); openHabitImport(h); });

      $('#hbSave', body).addEventListener('click', () => {
        const name = $('#hbName', body).value.trim();
        if (!name) { toast('Give the habit a name'); return; }
        draft.name = name;
        if (draft.due !== 'days') delete draft.days;
        if (draft.source) {
          draft.type = HABIT_SOURCES[draft.source].type;
          draft.unit = HABIT_SOURCES[draft.source].unit;
          draft.step = 1;
        } else if (draft.type === 'count') {
          draft.target = Number($('#hbTarget', body).value) || 1;
          draft.unit = $('#hbUnit', body).value.trim();
          draft.step = Number($('#hbStep', body).value) || 1;
        } else { draft.target = 1; draft.unit = ''; draft.step = 1; }
        if (!state.habits) state.habits = [];
        const i = state.habits.findIndex((x) => x.id === draft.id);
        if (i >= 0) state.habits[i] = draft; else state.habits.push(draft);
        save(); closeSheet(); goTab('habits');
        toast(h ? 'Habit saved' : 'Habit added');
      });
      const del = $('#hbDel', body);
      if (del) del.addEventListener('click', () => {
        closeSheetNow();
        confirmAction({
          title: 'Delete habit',
          message: 'Delete "' + draft.name + '" and everything logged against it?',
          confirm: 'Delete habit',
          onCancel: () => openHabitEditor(draft.id),
          onConfirm: () => undoable('Habit deleted', () => {
            state.habits = state.habits.filter((x) => x.id !== draft.id);
            Object.keys(state.habitLog || {}).forEach((k) => {
              delete state.habitLog[k][draft.id];
              if (!Object.keys(state.habitLog[k]).length) delete state.habitLog[k];
            });
          }),
        });
      });
    });
  }

  /* ================= PROFILE TAB (trends / history / library / settings) ================= */

  // localStorage is the only copy of all this — nudge for a backup now and then
  function backupOverdue() {
    const last = state.settings.lastExport || 0;
    const hasData = state.workouts.length > 3 || state.nutrition.meals.length > 10;
    return hasData && Date.now() - last > 30 * 864e5;
  }

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
      ${backupOverdue() ? `
      <button class="card backup-nudge" id="backupNudge">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5V4.5M8 8.5 12 4.5l4 4M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/></svg>
        <span><b>Back up your data</b>${state.settings.lastExport ? 'Last export ' + fmtShortDate(state.settings.lastExport) : 'Never exported'} — everything lives only on this phone.</span>
      </button>` : ''}
      ${(() => {
        const { score, gaps } = scoreGaps();
        return `
      <button class="card score-card" id="scoreCard">
        <div class="sc-ring">
          <svg viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="26" fill="none" stroke="var(--surface-2)" stroke-width="3.4"/>
            <circle cx="28" cy="28" r="26" fill="none" stroke="${score.total >= 100 ? 'var(--done)' : 'var(--ink-1)'}" stroke-width="3.4" stroke-linecap="round"
              stroke-dasharray="163.4" stroke-dashoffset="${(163.4 * (1 - score.total / 100)).toFixed(1)}" transform="rotate(-90 28 28)"/>
          </svg>
          <b>${score.total}</b>
        </div>
        <div class="sc-body">
          <div class="sc-title">Today${score.total >= 100 ? ' · perfect day' : ''}</div>
          <div class="sc-parts">
            <span>Training ${score.parts.training}/30</span>
            <span>Nutrition ${score.parts.nutrition}/30</span>
            <span>Habits ${score.parts.habits}/30</span>
            <span>Weigh-in ${score.parts.weight}/10</span>
          </div>
          <div class="sc-gap">${gaps.length ? 'Still open: ' + gaps.join(' · ') : 'Everything done — nothing left today.'}</div>
        </div>
      </button>`;
      })()}
      <div class="seg" id="progSeg">
        <button data-seg="week" class="${progressSeg === 'week' ? 'on' : ''}">Week</button>
        <button data-seg="trends" class="${progressSeg === 'trends' ? 'on' : ''}">Trends</button>
        <button data-seg="history" class="${progressSeg === 'history' ? 'on' : ''}">History</button>
        <button data-seg="library" class="${progressSeg === 'library' ? 'on' : ''}">Exercises</button>
      </div>
      <div id="segBody"></div>`;

    $('#profileSettings').addEventListener('click', openSettings);
    $('#scoreCard').addEventListener('click', () => openDaySummary(dateKey()));
    const nudge = $('#backupNudge');
    if (nudge) nudge.addEventListener('click', openSettings);
    $('#progSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-seg]');
      if (!b) return;
      progressSeg = b.dataset.seg;
      render();
    });

    const body = $('#segBody');
    if (progressSeg === 'week') renderWeekReview(body);
    else if (progressSeg === 'trends') renderTrends(body);
    else if (progressSeg === 'history') renderHistory(body);
    else renderExerciseLibrary(body);
  }

  /* -------- trends (charts) -------- */

  function exercisesWithHistory() {
    const ids = new Set();
    for (const w of state.workouts) for (const ex of w.exercises) if (ex.sets.length) ids.add(ex.exerciseId);
    return [...ids].map(exerciseById).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* A treadmill has no one-rep max. What it has is how far you went and how
     fast, so that is what is drawn: distance per session where there is any,
     minutes where there is not, with the pace on the tooltip. */
  function cardioSeries(exerciseId) {
    const points = [];
    for (const w of [...state.workouts].sort((a, b) => a.startedAt - b.startedAt)) {
      const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (!ex) continue;
      const sets = ex.sets.filter((s) => (s.type || 'N') !== 'W' && (s.reps || s.weight));
      if (!sets.length) continue;
      const min = sets.reduce((t, s) => t + (Number(s.reps) || 0), 0);
      const km = sets.reduce((t, s) => t + (Number(s.weight) || 0), 0);
      const kmh = km && min ? Math.round((km / (min / 60)) * 10) / 10 : null;
      points.push({
        t: w.startedAt,
        v: km ? Math.round(km * 100) / 100 : min,
        note: cardioText({ reps: min, weight: km, kmh }),
      });
    }
    return points;
  }
  const cardioPlotsKm = (pts) => pts.some((p) => p.note && / km/.test(p.note));

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


  /* ---- weekly review: the week in one screen ---- */
  let reviewOffset = 0;   // 0 = this week, -1 = last week…

  function renderWeekReview(el) {
    const today = new Date();
    const dow = (today.getDay() + 6) % 7;
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + reviewOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      return dateKey(d);
    });
    const todayKey = dateKey();
    const past = days.filter((k) => k <= todayKey);
    const t = state.nutrition.targets;
    const list = habitsList();

    const scores = past.map((k) => dayScore(k).total);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const sessions = state.workouts.filter((w) => days.includes(dateKey(new Date(w.startedAt))));
    const volume = sessions.reduce((sum, w) => sum + workoutVolume(w), 0);
    const daysWithMeals = past.filter((k) => mealsForDay(k).length);
    const avgKcal = daysWithMeals.length
      ? Math.round(daysWithMeals.reduce((sum, k) => sum + dayTotals(k).kcal, 0) / daysWithMeals.length) : 0;
    const avgProtein = daysWithMeals.length
      ? Math.round(daysWithMeals.reduce((sum, k) => sum + dayTotals(k).protein, 0) / daysWithMeals.length) : 0;
    const habitSlots = list.length * past.length;
    const habitHits = list.reduce((sum, h) => sum + past.filter((k) => habitDone(h, k)).length, 0);
    const habitPct = habitSlots ? Math.round((habitHits / habitSlots) * 100) : 0;
    const wStart = past.map((k) => weightOn(k)).find(Boolean);
    const wEndArr = past.map((k) => weightOn(k)).filter(Boolean);
    const wEnd = wEndArr[wEndArr.length - 1];
    const wDelta = wStart && wEnd && wStart !== wEnd ? wEnd.value - wStart.value : null;
    const label = reviewOffset === 0 ? 'This week' : reviewOffset === -1 ? 'Last week'
      : monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    /* The same figures for the week before. A week on its own says what you
       did; next to the one before it, it says whether that is more or less.
       Only the days that had run their course by this point last week count,
       so a Tuesday is not measured against a whole week. */
    const prevMonday = new Date(monday); prevMonday.setDate(prevMonday.getDate() - 7);
    const prevDays = Array.from({ length: past.length }, (_, i) => {
      const d = new Date(prevMonday); d.setDate(d.getDate() + i);
      return dateKey(d);
    });
    const prevSessions = state.workouts.filter((w) => prevDays.includes(dateKey(new Date(w.startedAt))));
    const prevVolume = prevSessions.reduce((sum, w) => sum + workoutVolume(w), 0);
    const prevMealDays = prevDays.filter((k) => mealsForDay(k).length);
    const prevKcal = prevMealDays.length
      ? Math.round(prevMealDays.reduce((sum, k) => sum + dayTotals(k).kcal, 0) / prevMealDays.length) : 0;
    const prevProtein = prevMealDays.length
      ? Math.round(prevMealDays.reduce((sum, k) => sum + dayTotals(k).protein, 0) / prevMealDays.length) : 0;
    const prevHabitSlots = list.length * prevDays.length;
    const prevHabitHits = list.reduce((sum, h) => sum + prevDays.filter((k) => habitDone(h, k)).length, 0);
    const prevHabitPct = prevHabitSlots ? Math.round((prevHabitHits / prevHabitSlots) * 100) : 0;

    /* Records set this week, which is the part of a week worth remembering. */
    const prs = sessions.flatMap((w) => workoutPRs(w).map((set) => ({
      name: exerciseById(set.exerciseId)?.name ?? 'Exercise', weight: set.weight, reps: set.reps,
    })));

    // "+3 sessions", "−120 kcal a day": the change, in the unit it belongs to
    const delta = (now, before, opts = {}) => {
      if (!before && !now) return opts.none || '';
      if (!before) return opts.first || 'first week';
      const diff = now - before;
      if (!diff) return 'same as last week';
      const n = opts.round ? Math.round(Math.abs(diff)).toLocaleString() : fmtNum(roundWeight(Math.abs(diff)));
      return (diff > 0 ? '↑ ' : '↓ ') + n + (opts.suffix || '') + ' vs last week';
    };

    const stat = (label2, value, sub, trend) =>
      '<div class="rv-stat"><span class="micro">' + label2 + '</span><b>' + value + '</b>' +
        (sub ? '<i>' + sub + '</i>' : '') +
        (trend ? '<u class="' + (/↑/.test(trend) ? 'up' : /↓/.test(trend) ? 'down' : '') + '">' + trend + '</u>' : '') +
      '</div>';

    el.innerHTML =
      '<div class="day-nav rv-nav">' +
        '<button id="rvPrev" aria-label="Previous week">‹</button>' +
        '<span class="dn-label">' + esc(label) + '</span>' +
        '<button id="rvNext" aria-label="Next week" ' + (reviewOffset >= 0 ? 'disabled style="opacity:0.35"' : '') + '>›</button>' +
      '</div>' +

      '<div class="card rv-score">' +
        '<div class="rv-head"><span class="micro">Average score</span><span class="rv-big ' + (avgScore >= 80 ? 'all-done' : '') + '">' + avgScore + '<i>/100</i></span></div>' +
        '<div class="rv-days">' + days.map((k, i) => {
          const future = k > todayKey;
          const sc = future ? 0 : dayScore(k).total;
          return '<button class="rv-day' + (k === todayKey ? ' is-today' : '') + (future ? ' is-future' : '') + '" data-day="' + k + '"' + (future ? ' disabled' : '') + '>' +
            '<i style="height:' + (future ? 0 : Math.max(4, sc)) + '%"></i>' +
            '<span>' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i] + '</span></button>';
        }).join('') + '</div>' +
      '</div>' +

      '<div class="rv-grid">' +
        stat('Sessions', sessions.length,
          sessions.length ? sessions.map((w) => w.name).slice(0, 2).join(' · ') + (sessions.length > 2 ? ' …' : '') : 'None yet',
          delta(sessions.length, prevSessions.length, { none: '' })) +
        stat('Volume', Math.round(volume).toLocaleString(), esc(unit()) + ' lifted',
          delta(volume, prevVolume, { round: true, suffix: ' ' + unit() })) +
        stat('Habits', habitPct + '%', habitHits + ' of ' + habitSlots,
          delta(habitPct, prevHabitPct, { suffix: ' points' })) +
        stat('Avg calories', avgKcal ? avgKcal.toLocaleString() : '—', t.kcal ? 'target ' + t.kcal.toLocaleString() : '',
          delta(avgKcal, prevKcal, { round: true, suffix: ' kcal a day' })) +
        stat('Avg protein', avgProtein ? avgProtein + 'g' : '—', t.protein ? 'target ' + t.protein + 'g' : '',
          delta(avgProtein, prevProtein, { suffix: 'g a day' })) +
        stat('Bodyweight', wEnd ? fmtNum(wEnd.value) + ' ' + esc(unit()) : '—',
          wDelta != null ? (wDelta > 0 ? '+' : '') + fmtNum(roundWeight(wDelta)) + ' ' + esc(unit()) + ' this week' : 'Log twice to compare') +
        stat('Days logged', past.filter((k) => mealsForDay(k).length || weightOn(k) ||
          state.workouts.some((w) => dateKey(new Date(w.startedAt)) === k)).length + ' / ' + past.length, 'so far') +
      '</div>' +

      (prs.length
        ? '<div class="card rv-prs">' +
            '<div class="rv-head"><span class="micro">Records this week</span>' +
              '<span class="rv-pr-count">' + prIcon('pr-mark pr-inline') + ' ' + prs.length + '</span></div>' +
            '<ul class="rv-pr-list">' + prs.slice(0, 6).map((p) =>
              '<li><span>' + esc(p.name) + '</span><b>' + fmtNum(p.weight) + ' ' + esc(unit()) + ' × ' + p.reps + '</b></li>').join('') +
            (prs.length > 6 ? '<li class="rv-pr-more">and ' + (prs.length - 6) + ' more</li>' : '') +
            '</ul>' +
          '</div>'
        : '');

    $('#rvPrev', el).addEventListener('click', () => { reviewOffset -= 1; render(); });
    $('#rvNext', el).addEventListener('click', () => { if (reviewOffset < 0) { reviewOffset += 1; render(); } });
    $$('.rv-day[data-day]', el).forEach((b) => b.addEventListener('click', () => openDaySummary(b.dataset.day)));
  }


  /* ================= PROGRESS PHOTOS =================
     Photos live in IndexedDB, not in the main save: localStorage caps out
     around 5MB and a handful of pictures would take the whole document with
     it. They stay on the device and are not part of the JSON backup. */

  const PHOTO_DB = 'bela-photos';
  let photoDbPromise = null;
  function photoDb() {
    if (photoDbPromise) return photoDbPromise;
    photoDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(PHOTO_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'date' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return photoDbPromise;
  }
  function photoTx(mode, fn) {
    return photoDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    }));
  }
  const photoAll = () => photoTx('readonly', (st) => st.getAll());
  const photoPut = (rec) => photoTx('readwrite', (st) => st.put(rec));
  const photoDel = (date) => photoTx('readwrite', (st) => st.delete(date));

  // shrink to something sane before storing — a phone photo is 3–8MB raw
  function readPhotoFile(file, done) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1080;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => done(blob), 'image/jpeg', 0.82);
      };
      img.onerror = () => done(null);
      img.src = reader.result;
    };
    reader.onerror = () => done(null);
    reader.readAsDataURL(file);
  }

  let photoUrls = [];
  function freePhotoUrls() {
    photoUrls.forEach((u) => URL.revokeObjectURL(u));
    photoUrls = [];
  }
  function photoUrl(blob) {
    const u = URL.createObjectURL(blob);
    photoUrls.push(u);
    return u;
  }

  function openPhotoGallery(preselect) {
    photoAll().then((list) => {
      list.sort((a, b) => b.date.localeCompare(a.date));
      freePhotoUrls();
      const picked = [];
      openSheet('Progress photos', '' +
        '<p class="confirm-msg">Kept on this phone only — photos are not in the JSON backup.</p>' +
        '<button class="btn btn-primary" id="phAdd">Add a photo</button>' +
        '<input id="phFile" type="file" accept="image/*" capture="environment" hidden>' +
        (list.length
          ? '<p class="ph-hint" id="phHint">Tap two photos to compare them.</p><div class="ph-grid">' +
            list.map((r) => '<button class="ph-cell" data-date="' + r.date + '">' +
              '<img src="' + photoUrl(r.blob) + '" alt="">' +
              '<span>' + esc(fmtShortDate(new Date(r.date + 'T12:00:00').getTime())) +
                (r.weight ? ' · ' + fmtNum(r.weight) + ' ' + esc(unit()) : '') + '</span></button>').join('') + '</div>'
          : '<p class="empty-note">No photos yet. One a month is plenty to see a change.</p>'),
      (body) => {
        $('#phAdd', body).addEventListener('click', () => $('#phFile', body).click());
        $('#phFile', body).addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;
          toast('Saving photo…');
          readPhotoFile(file, (blob) => {
            if (!blob) { toast('Could not read that image'); return; }
            const lw = latestWeight();
            photoPut({ date: dateKey(), blob, weight: lw ? lw.value : null })
              .then(() => { closeSheetNow(); render(); openPhotoGallery(); toast('Photo saved'); })
              .catch(() => toast('Could not save that photo'));
          });
        });
        const hint = $('#phHint', body);
        $$('.ph-cell', body).forEach((cell) => cell.addEventListener('click', () => {
          const d = cell.dataset.date;
          const at = picked.indexOf(d);
          if (at >= 0) picked.splice(at, 1); else picked.push(d);
          if (picked.length > 2) picked.shift();
          $$('.ph-cell', body).forEach((c) => c.classList.toggle('is-picked', picked.includes(c.dataset.date)));
          if (hint) hint.textContent = picked.length === 2 ? 'Comparing…' : picked.length === 1 ? 'Pick one more to compare' : 'Tap two photos to compare them.';
          if (picked.length === 2) {
            const [a, b] = picked.map((x) => list.find((r) => r.date === x));
            openPhotoCompare(a, b);
          }
        }));
      });
      if (preselect) toast('Pick two photos to compare');
    }).catch(() => toast('Photos are not available on this device'));
  }

  function openPhotoCompare(a, b) {
    const [older, newer] = [a, b].sort((x, y) => x.date.localeCompare(y.date));
    const gap = Math.round((new Date(newer.date) - new Date(older.date)) / 864e5);
    const dw = older.weight && newer.weight ? roundWeight(newer.weight - older.weight) : null;
    openSheet('Compare', '' +
      '<div class="ph-compare">' +
        [older, newer].map((r) => '<figure><img src="' + photoUrl(r.blob) + '" alt="">' +
          '<figcaption>' + esc(fmtShortDate(new Date(r.date + 'T12:00:00').getTime())) +
          (r.weight ? '<b>' + fmtNum(r.weight) + ' ' + esc(unit()) + '</b>' : '') + '</figcaption></figure>').join('') +
      '</div>' +
      '<p class="ph-summary">' + gap + ' days apart' + (dw != null ? ' · ' + (dw > 0 ? '+' : '') + fmtNum(dw) + ' ' + esc(unit()) : '') + '</p>' +
      '<button class="btn btn-quiet" id="phBack">Back to photos</button>' +
      '<button class="btn btn-danger" id="phDel" style="margin-top:10px">Delete the newer photo</button>',
    (body) => {
      $('#phBack', body).addEventListener('click', () => { closeSheetNow(); openPhotoGallery(); });
      $('#phDel', body).addEventListener('click', () => {
        photoDel(newer.date).then(() => { closeSheetNow(); render(); openPhotoGallery(); toast('Photo deleted'); });
      });
    });
  }

  // a small strip at the top of Trends
  function photoStripHTML() {
    return '<button class="card photo-strip" id="photoStrip">' +
      '<div><span class="micro">Progress photos</span>' +
        '<div class="ps-sub" id="psSub">Tap to add or compare</div></div>' +
      '<div class="ps-thumbs" id="psThumbs"></div>' +
    '</button>';
  }
  function fillPhotoStrip(el) {
    const strip = $('#photoStrip', el);
    if (!strip) return;
    strip.addEventListener('click', () => openPhotoGallery());
    photoAll().then((list) => {
      if (!list.length) return;
      list.sort((a, b) => b.date.localeCompare(a.date));
      const sub = $('#psSub', el), thumbs = $('#psThumbs', el);
      if (sub) sub.textContent = list.length + ' photo' + (list.length === 1 ? '' : 's') + ' · newest ' + fmtShortDate(new Date(list[0].date + 'T12:00:00').getTime());
      if (thumbs) thumbs.innerHTML = list.slice(0, 3).map((r) => '<img src="' + photoUrl(r.blob) + '" alt="">').join('');
    }).catch(() => {});
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

    const cardioPick = progressExerciseId ? isCardio(progressExerciseId) : false;
    const series = !progressExerciseId ? []
      : cardioPick ? cardioSeries(progressExerciseId) : strengthSeries(progressExerciseId);
    const chartUnit = cardioPick ? (cardioPlotsKm(series) ? 'km' : 'min') : u;
    const best = progressExerciseId && !cardioPick ? bestSetFor(progressExerciseId) : null;
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
      ${photoStripHTML()}
      <div class="tile-row">
        <div class="tile"><span class="micro">Workouts</span><div class="t-value">${totalWorkouts}</div></div>
        <div class="tile"><span class="micro">Volume</span><div class="t-value">${totalVolume >= 10000 ? (totalVolume / 1000).toFixed(1) + 'k' : fmtNum(Math.round(totalVolume))}<span class="t-unit"> ${esc(u)}</span></div></div>
        <div class="tile"><span class="micro">This week</span><div class="t-value">${thisWeek}<span class="t-unit"> sessions</span></div></div>
      </div>
      <div class="tile-row">
        <div class="tile"><span class="micro">Streak</span><div class="t-value">${streak}<span class="t-unit"> wk${streak === 1 ? '' : 's'}</span></div></div>
        <div class="tile"><span class="micro">Time trained</span><div class="t-value">${Math.floor(totalTimeMs / 3600000)}<span class="t-unit"> h ${Math.round((totalTimeMs % 3600000) / 60000)} m</span></div></div>
        <div class="tile"><span class="micro">Records</span><div class="t-value">${totalPRs}${prIcon('pr-mark pr-tile')}</div></div>
      </div>

      ${options.length ? `
      <select class="select-field" id="progressExercise" aria-label="Choose exercise">
        ${options.map((o) => `<option value="${esc(o.id)}" ${o.id === progressExerciseId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>

      <div class="card chart-card">
        <h3>${cardioPick ? 'Distance' : 'Estimated 1RM'} — ${esc(exerciseById(progressExerciseId)?.name ?? '')}</h3>
        <p class="muted">${cardioPick
          ? (series.length ? esc(series[series.length - 1].note) + ' last time' : 'Per session')
          : (best ? `Best set: ${fmtNum(best.weight)} ${esc(u)} × ${best.reps}` : 'Best set per session, Epley formula')}</p>
        <div class="chart-wrap" id="strengthChart">
          ${series.length >= 2 ? lineChartSVG(series, chartUnit, cardioPick ? 'Distance per session' : 'Estimated one rep max over time', 'var(--series-1)') : `<p class="empty-note">Log this exercise in at least two workouts to see a trend.</p>`}
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
    fillPhotoStrip(v);

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
      tip.innerHTML = `<span class="tip-date">${fmtDate(p.t)}</span>` + (p.note
        ? `<b>${esc(p.note)}</b>`
        : `<b>${fmtNum(p.v)} ${esc(u)}</b>${p.set ? ` <span style="color:var(--ink-2)">(${fmtNum(p.set.weight)}×${p.set.reps})</span>` : ''}`);
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
  let histQuery = '';        // what the history list is filtered by

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
      return cardio ? cardioText(s) : `${tag}${fmtNum(s.weight ?? 0)}×${s.reps}${s.pr ? ' ' + prIcon('pr-mark pr-inline') : ''}`;
    };
    const q = histQuery.trim().toLowerCase();
    const matches = (w) => !q || esc(w.name).toLowerCase().includes(q) ||
      (w.note || '').toLowerCase().includes(q) ||
      w.exercises.some((ex) => (exerciseById(ex.exerciseId)?.name || '').toLowerCase().includes(q)) ||
      fmtDate(w.startedAt).toLowerCase().includes(q);
    const shown = state.workouts.filter(matches);
    v.innerHTML =
      '<div class="hist-search">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>' +
        '<input id="histQ" type="search" placeholder="Search sessions or exercises…" value="' + esc(histQuery) + '" autocomplete="off">' +
        (q ? '<button id="histClear" aria-label="Clear search">×</button>' : '') +
      '</div>' +
      (q
        ? '<p class="hist-count">' + shown.length + (shown.length === 1 ? ' session' : ' sessions') + ' found</p>'
        : calendarHTML()) +
      (shown.length ? '' : '<p class="empty-note">Nothing matches “' + esc(histQuery) + '”.</p>') +
      shown.map((w) => {
      const sets = loggedSets(w);
      const prCount = workoutPRs(w).length;
      const open = expandedHistoryId === w.id;
      return `
      <div class="card hist-item" data-id="${esc(w.id)}">
        <div class="hist-top">
          <h3>${esc(w.name)}${prCount ? ` <span class="pr-count">${prIcon('pr-mark pr-inline')}${prCount > 1 ? prCount : ''}</span>` : ''}</h3>
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
            <button class="btn btn-quiet" data-edit="${esc(w.id)}">Edit</button>
            <button class="btn btn-quiet" data-repeat="${esc(w.id)}">Repeat</button>
            <button class="btn btn-danger" data-delete="${esc(w.id)}">Delete</button>
          </div>
        </div>` : ''}
      </div>`;
    }).join('');

    const qIn = $('#histQ', v);
    qIn.addEventListener('input', () => {
      histQuery = qIn.value;
      const at = qIn.selectionStart;
      render();
      // the list is rebuilt under the cursor, so put it back where it was
      const again = $('#histQ');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) { /* number-ish inputs */ } }
    });
    const clear = $('#histClear', v);
    if (clear) clear.addEventListener('click', () => { histQuery = ''; render(); });
    if ($('#calPrev', v)) {
      $('#calPrev', v).addEventListener('click', () => { histMonthOffset -= 1; render(); });
      $('#calNext', v).addEventListener('click', () => { if (histMonthOffset < 0) { histMonthOffset += 1; render(); } });
    }

    $$('.hist-item', v).forEach((card) => {
      card.addEventListener('click', (e) => {
        const del = e.target.closest('[data-delete]');
        if (del) {
          const w = state.workouts.find((x) => x.id === del.dataset.delete);
          confirmAction({
            title: 'Delete workout',
            message: w ? esc(w.name) + ' from ' + fmtDate(w.startedAt) + ' will be removed from your history for good.'
                       : 'This session will be removed from your history for good.',
            confirm: 'Delete workout',
            onConfirm: () => undoable('Workout deleted', () => {
              state.workouts = state.workouts.filter((x) => x.id !== del.dataset.delete);
            }),
          });
          return;
        }
        const ed = e.target.closest('[data-edit]');
        if (ed) {
          const w = state.workouts.find((x) => x.id === ed.dataset.edit);
          if (!w) return;
          const open = () => {
            state.activeWorkout = JSON.parse(JSON.stringify({ ...w, editingId: w.id }));
            workoutOpen = true;
            openWkEntry();
            save(); render();
          };
          if (state.activeWorkout) {
            confirmAction({
              title: 'Replace session',
              message: 'A workout is in progress. Editing "' + w.name + '" will discard it.',
              confirm: 'Discard and edit',
              onConfirm: () => { state.activeWorkout = null; save(); open(); },
            });
            return;
          }
          open();
          return;
        }
        const rep = e.target.closest('[data-repeat]');
        if (rep) {
          const w = state.workouts.find((x) => x.id === rep.dataset.repeat);
          if (w) {
            const begin = () => {
              state.activeWorkout = {
                id: uid(), name: w.name, startedAt: Date.now(),
                exercises: w.exercises.map((ex) => newExerciseEntry(ex.exerciseId, ex.sets.length)),
              };
              workoutOpen = true;
              openWkEntry();
              save(); goTab('workout');
            };
            if (state.activeWorkout) {
              confirmAction({
                title: 'Replace session',
                message: 'A workout is already in progress. Starting "' + w.name + '" again will discard it.',
                confirm: 'Replace it',
                onConfirm: begin,
              });
              return;
            }
            begin();
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
      <label class="switch-row">
        <span><b>Keep the screen on while logging</b><i>Stops the phone locking between sets</i></span>
        <input type="checkbox" id="keepAwake" ${s.keepAwake === false ? '' : 'checked'}>
      </label>
      <label class="switch-row">
        <span><b>Vibration</b><i>A short buzz when a set is logged, a habit is ticked or a record falls</i></span>
        <input type="checkbox" id="hapticSw" ${s.haptics === false ? '' : 'checked'}>
      </label>
      <label class="switch-row">
        <span><b>Workout notification</b><i>While a session is running, a notification shows where you are and taps back into it</i></span>
        <input type="checkbox" id="wkNotify" ${s.wkNotify ? 'checked' : ''}>
      </label>
      <div class="note-state" id="wkNoteState">
        <span id="wkNoteWhy">Checking…</span>
        <button class="chip-btn" id="wkNoteTest">Test it</button>
      </div>
      <label class="switch-row">
        <span><b>Full screen</b><i>Hides the Android status bar — and the grey hairline the browser draws under it</i></span>
        <input type="checkbox" id="fullBleed" ${s.fullscreen ? 'checked' : ''}>
      </label>
      <label class="switch-row">
        <span><b>Track effort (RPE)</b><i>An extra column on every set</i></span>
        <input type="checkbox" id="trackRpe" ${s.trackRpe === false ? '' : 'checked'}>
      </label>
      <div class="field">
        <label>Home layout</label>
        <div class="seg" id="homeLayoutSeg">
          <button data-hl="dash" class="${s.homeLayout === 'classic' ? '' : 'is-on'}">Dashboard</button>
          <button data-hl="classic" class="${s.homeLayout === 'classic' ? 'is-on' : ''}">Classic</button>
        </div>
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
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-quiet" id="exportBtn">Save backup</button>
        <button class="btn btn-quiet" id="shareBtn">Share backup</button>
      </div>
      <button class="btn btn-quiet" id="csvBtn" style="margin-top:10px">Export as CSV</button>
      <button class="btn btn-quiet" id="setupBtn" style="margin-top:10px">Run setup again</button>
      <button class="btn btn-quiet" id="snapBtn" style="margin-top:10px">Snapshots</button>
      <button class="btn btn-quiet" id="pcSyncBtn" style="margin-top:10px">Sync with the PC app</button>
      ${(state.tplHidden || []).length ? '<button class="btn btn-quiet" id="tplRestore" style="margin-top:10px">Bring back ' +
        (state.tplHidden.length === 1 ? 'the removed routine' : 'the ' + state.tplHidden.length + ' removed routines') + '</button>' : ''}
      <button class="btn btn-quiet" id="importBtn" style="margin-top:10px">Import a backup</button>
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
        const from = state.settings.unit, to = b.dataset.u;
        if (from === to) return;
        const hasData = state.workouts.length || state.nutrition.weights.length;
        const apply = () => {
          convertWeights(from, to);
          state.settings.unit = to;
          save(); closeSheetNow(); openSettings(); render();
          toast('Everything converted to ' + to);
        };
        if (!hasData) { state.settings.unit = to; save(); render();
          $$('#unitSeg button', body).forEach((x) => x.classList.toggle('on', x === b)); return; }
        closeSheetNow();
        confirmAction({
          title: 'Switch to ' + to,
          message: 'Every logged set, bodyweight and your goal will be converted from ' + from + ' to ' + to +
            '. Rounded to the nearest ' + (to === 'lb' ? '0.5 lb' : '0.5 kg') + ', so switching back and forth repeatedly can shift a value slightly.',
          confirm: 'Convert to ' + to,
          danger: false,
          onCancel: openSettings,
          onConfirm: apply,
        });
      });
      $$('#homeLayoutSeg button', body).forEach((b) => b.addEventListener('click', () => {
        state.settings.homeLayout = b.dataset.hl === 'classic' ? 'classic' : 'dash';
        $$('#homeLayoutSeg button', body).forEach((x) => x.classList.toggle('is-on', x === b));
        save(); render();
        toast(state.settings.homeLayout === 'classic' ? 'Classic home restored' : 'Dashboard home on');
      }));

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
        state.settings.lastExport = Date.now();
        save();
        toast('Backup saved');
      });
      $('#keepAwake', body).addEventListener('change', (e) => {
        state.settings.keepAwake = e.target.checked;
        save(); syncWakeLock();
      });
      $('#hapticSw', body).addEventListener('change', (e) => {
        state.settings.haptics = e.target.checked;
        save();
        if (e.target.checked) haptic('tick');
      });
      /* "It stopped working" has three quite different causes and no way to
         tell them apart from the outside, so the app says which one it is. */
      const sayNoteState = async () => {
        const why = $('#wkNoteWhy', body);
        const test = $('#wkNoteTest', body);
        if (!why) return;
        if (native()) {
          const LN = nativePlugin('LocalNotifications');
          let granted = false;
          try { granted = LN && (await LN.checkPermissions()).display === 'granted'; } catch (err) { /* older shell */ }
          why.textContent = !LN ? 'This build cannot show notifications.'
            : !granted ? 'Not allowed yet. Switching it on asks for permission.'
            : !state.settings.wkNotify ? 'Allowed, but this switch is off.'
            : state.activeWorkout ? 'On, and showing now — Android keeps it there until the workout ends.'
            : 'On. It appears when a workout is running.';
          test.hidden = !granted;
          return;
        }
        if (!('Notification' in window)) { why.textContent = 'This browser cannot show notifications.'; test.hidden = true; return; }
        if (Notification.permission === 'denied') {
          why.textContent = 'Blocked. Android has notifications off for this app — turn them back on there, then switch this on again.';
          test.hidden = true; return;
        }
        if (Notification.permission !== 'granted') {
          why.textContent = 'Not allowed yet. Switching it on asks for permission.';
          test.hidden = true; return;
        }
        if (!state.settings.wkNotify) { why.textContent = 'Allowed, but this switch is off.'; test.hidden = false; return; }
        let live = 0;
        try {
          const reg = await navigator.serviceWorker.ready;
          live = (await reg.getNotifications({ tag: WK_NOTE_TAG })).length;
        } catch (err) { /* nothing posted */ }
        why.textContent = state.activeWorkout
          ? (live ? 'On, and showing now.' : 'On, but Android is not showing it — check Chrome’s notification settings for this app.')
          : 'On. It appears when a workout is running.';
        test.hidden = false;
      };
      sayNoteState();
      $('#wkNoteTest', body).addEventListener('click', async () => {
        if (!(await askWorkoutNotify())) { sayNoteState(); return; }
        if (state.activeWorkout) syncWorkoutNote(true); else sampleWorkoutNote();
        setTimeout(sayNoteState, 600);
      });
      $('#wkNotify', body).addEventListener('change', async (e) => {
        if (e.target.checked && !(await askWorkoutNotify())) { e.target.checked = false; return; }
        state.settings.wkNotify = e.target.checked;
        save();
        if (!e.target.checked) { clearWorkoutNote(); toast('Workout notification off'); sayNoteState(); return; }
        // show something straight away, so it is obvious it worked — the real
        // one if a session is running, a sample of it if not
        if (state.activeWorkout) { syncWorkoutNote(true); toast('It will follow your session'); }
        else sampleWorkoutNote();
        setTimeout(sayNoteState, 600);
      });
      $('#fullBleed', body).addEventListener('change', (e) => {
        state.settings.fullscreen = e.target.checked;
        save();
        if (e.target.checked) requestFullBleed(); else exitFullBleed();
      });
      $('#trackRpe', body).addEventListener('change', (e) => {
        state.settings.trackRpe = e.target.checked;
        save(); render();
      });
      $('#shareBtn', body).addEventListener('click', async () => {
        // a copy on the same phone is not really a backup — hand it to Drive,
        // mail or a chat instead
        const file = new File([JSON.stringify(state, null, 2)], 'bela-gym-backup-' + dateKey() + '.json', { type: 'application/json' });
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'B.E.L.A Gym backup' });
            state.settings.lastExport = Date.now(); save();
            return;
          }
        } catch { return; }   // the user dismissed the share sheet
        toast('Sharing is not available here — use Save backup');
      });
      $('#csvBtn', body).addEventListener('click', () => { closeSheetNow(); queueMicrotask(openCsvSheet); });
      $('#setupBtn', body).addEventListener('click', () => { closeSheetNow(); queueMicrotask(openSetup); });
      $('#snapBtn', body).addEventListener('click', () => { closeSheetNow(); openBackups(); });
      $('#pcSyncBtn', body).addEventListener('click', () => { closeSheetNow(); queueMicrotask(openPcSync); });
      $('#tplRestore', body)?.addEventListener('click', () => {
        undoable('Routines restored', () => { state.tplHidden = []; });
        closeSheet();
      });
      $('#importBtn', body).addEventListener('click', () => $('#importFile', body).click());
      $('#importFile', body).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        file.text().then(async (text) => {
          try {
            const data = JSON.parse(text);
            if (!data || !Array.isArray(data.workouts)) throw new Error('bad file');
            await takeSnapshot('an import', dateKey() + ' pre-import');
            state = normalize(data);
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
        closeSheetNow();
        confirmAction({
          title: 'Erase everything',
          message: 'Every workout, meal, habit, weigh-in and setting on this device will be deleted. Export a backup first if you might want any of it back.',
          confirm: 'Erase all data',
          onCancel: openSettings,
          onConfirm: async () => {
            await takeSnapshot('erasing everything', dateKey() + ' pre-erase');
            state = defaultState(); save(); render(); toast('All data erased');
          },
        });
      });
    });
  }


  /* ---------------- automatic snapshots ----------------
     localStorage holds the only copy of everything, and a bad import or a
     tap in the wrong place can take it. Once a day the document is copied
     into IndexedDB — a week of them is kept, they cost nothing, and any one
     can be put back from Settings. Photos are not in them: they live in
     their own store and are far too big to keep seven copies of. */

  const SNAP_DB = 'bela-snapshots';
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  let snapDbPromise = null;
  function snapDb() {
    if (snapDbPromise) return snapDbPromise;
    snapDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(SNAP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return snapDbPromise;
  }
  function snapTx(mode, fn) {
    return snapDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction('snaps', mode);
      const req = fn(tx.objectStore('snaps'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    }));
  }
  const snapAll = () => snapTx('readonly', (st) => st.getAll()).then((r) => (r || []).sort((a, b) => b.key.localeCompare(a.key)));
  const snapDel = (key) => snapTx('readwrite', (st) => st.delete(key));

  const SNAP_KEEP = 10;   // a week of daily ones, with room for a few taken by hand
  function snapMeta(doc) {
    return {
      workouts: (doc.workouts || []).length,
      meals: ((doc.nutrition || {}).meals || []).length,
      habits: (doc.habits || []).length,
      weights: ((doc.nutrition || {}).weights || []).length,
    };
  }
  /* label: 'daily' for the automatic one, or what it was taken before */
  async function takeSnapshot(label = 'daily', key = dateKey()) {
    try {
      const json = JSON.stringify(state);
      await snapTx('readwrite', (st) => st.put({ key, at: Date.now(), label, size: json.length, meta: snapMeta(state), json }));
      const all = await snapAll();
      await Promise.all(all.slice(SNAP_KEEP).map((s) => snapDel(s.key)));
      return true;
    } catch (e) {
      return false;   // no IndexedDB, or no room — never worth breaking a tap over
    }
  }
  /* one a day, taken at the first launch of the day, before anything is
     changed — so the snapshot is yesterday as you left it */
  async function snapshotDaily() {
    if (!('indexedDB' in window)) return;
    try {
      const all = await snapAll();
      if (all.some((s) => s.key === dateKey())) return;
      await takeSnapshot('daily');
    } catch (e) { /* nothing to do */ }
  }

  async function openBackups() {
    const all = await snapAll().catch(() => []);
    const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    const when = (s) => {
      const d = new Date(s.at);
      const day = s.key === dateKey() ? 'Today' : s.key === dateKey(new Date(Date.now() - 864e5)) ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return day + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };
    const rows = all.length ? all.map((s) => '' +
      '<div class="snap-row">' +
        '<div class="snap-main">' +
          '<div class="snap-when">' + esc(when(s)) + (s.label !== 'daily' ? ' <i>before ' + esc(s.label) + '</i>' : '') + '</div>' +
          '<div class="snap-sub">' + plural(s.meta.workouts, 'workout') + ' · ' + plural(s.meta.meals, 'meal') + ' · ' +
            plural(s.meta.habits, 'habit') + ' · ' + kb(s.size) + '</div>' +
        '</div>' +
        '<button class="chip-btn" data-restore="' + esc(s.key) + '">Restore</button>' +
      '</div>').join('')
      : '<p class="empty-note">No snapshots yet — the first one is taken the next time you open the app on a new day.</p>';

    openSheet('Snapshots', '' +
      '<p class="confirm-msg">One a day, kept for a week, on this phone. Photos are not included.</p>' +
      '<div class="snap-list">' + rows + '</div>' +
      '<button class="btn btn-quiet" id="snapNow" style="margin-top:12px">Take one now</button>',
    (body) => {
      $('#snapNow', body).addEventListener('click', async () => {
        const stamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
        const ok = await takeSnapshot('a manual save', dateKey() + ' ' + stamp);
        haptic(ok ? 'tick' : 'warn');
        toast(ok ? 'Snapshot taken' : 'Could not take a snapshot');
        if (ok) { closeSheetNow(); openBackups(); }
      });
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-restore]');
        if (!b) return;
        const snap = all.find((s) => s.key === b.dataset.restore);
        if (!snap) return;
        closeSheetNow();
        confirmAction({
          title: 'Restore this snapshot',
          message: 'Everything on this phone goes back to ' + when(snap).toLowerCase() +
            '. What is here now is saved as a snapshot first, so this can be undone.',
          confirm: 'Restore',
          onCancel: openBackups,
          onConfirm: async () => {
            await takeSnapshot('a restore', dateKey() + ' pre-restore');
            try {
              state = normalize(JSON.parse(snap.json), defaultState());
              save(); render();
              haptic('done');
              toast('Restored');
            } catch (err) {
              toast('That snapshot could not be read');
            }
          },
        });
      });
    });
  }

  /* ================= router ================= */

  /* When the last habit of the day goes in, say so once — a green sweep over
     the card that carries them and a finishing buzz. Once a day, not once a
     render, and never for a day with nothing due. */
  let celebratedDay = null;
  function celebrateIfDue() {
    const key = dateKey();
    const { done, total } = habitsDone(key);
    if (!total || done < total) { if (celebratedDay === key) celebratedDay = null; return; }
    if (celebratedDay === key) return;
    celebratedDay = key;
    const card = $('.hb-home') || $('.hb-today-card');
    if (card && !reducedMotion()) {
      card.classList.remove('celebrate');
      void card.offsetWidth;
      card.classList.add('celebrate');
    }
    haptic('done');
  }

  /* Holding the app icon on Android offers these; each one lands here with a
     ?go= and is taken straight to the thing rather than to home. */
  function checkShortcut() {
    const go = new URLSearchParams(location.search).get('go');
    if (!go) return;
    history.replaceState(history.state, '', location.pathname);
    if (go === 'workout') {
      goTab('workout');
      if (!state.activeWorkout) setTimeout(() => $('#startEmpty')?.click(), 60);
    } else if (go === 'meal') {
      goTab('meals');
      setTimeout(() => $('#addMeal')?.click(), 60);
    } else if (go === 'weight') {
      goTab('home');
      setTimeout(() => openWeightSheet(), 60);
    }
  }

  /* ---------------- swipe between tabs ---------------- */

  const TAB_ORDER = ['home', 'workout', 'meals', 'habits'];
  let swipeStart = null;
  let slideDir = null;
  /* Anything that drags sideways on its own — a meal row, the plan card, a
     sheet — calls this, and the tab swipe stands down for that gesture. It is
     a flag rather than a list of selectors so it cannot go stale. */
  let gestureClaimed = false;
  function claimGesture() { gestureClaimed = true; swipeStart = null; }

  /* Whatever the touch lands on decides who owns the gesture, and the decision
     is made in the capture phase — before anything else sees the touch — so it
     cannot depend on which listener happens to run first. */
  const OWN_GESTURE = 'input, textarea, select, .chart-wrap, .cal-grid, .pad-keys,' +
    ' .hbh-row, .wk-plan, .slot-card, .snap-row, .sheet, [data-swipe-own]';

  addEventListener('touchstart', (e) => {
    swipeStart = null;
    gestureClaimed = false;
    if (e.touches.length !== 1) return;
    // never hijack gestures inside the logger, a sheet, inputs or charts
    if (workoutOpen || scanOpen || $('#sheetRoot').children.length) return;
    // a real swipe cancels the tap, so buttons are fine to start on —
    // only text fields and things that draw sideways must keep the gesture
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (el && el.closest(OWN_GESTURE)) { gestureClaimed = true; return; }
    const t = e.touches[0];
    swipeStart = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true, capture: true });

  addEventListener('touchend', (e) => {
    if (gestureClaimed) { gestureClaimed = false; swipeStart = null; return; }
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
    haptic('tap');
    goTab(TAB_ORDER[next]);
  }, { passive: true, capture: true });

  // Home must fit one screen on any device and font-scale setting: measure the
  // rendered result and step down through the compact tiers until it fits.
  function fitHome() {
    const v = $('#view');
    if (!v.classList.contains('home-screen')) { v.style.height = ''; v.style.gap = ''; return; }
    v.classList.remove('home-compact', 'home-tight');
    v.style.gap = '';
    // pin the container to the height actually visible right now
    const vpH = window.visualViewport?.height || document.documentElement.clientHeight;
    v.style.height = vpH + 'px';
    // measure the container against itself: comparing against the document
    // height gets fooled whenever the page is taller than the visible viewport,
    // which silently forced the smallest tier on tall phones
    const overflows = () => v.scrollHeight > v.clientHeight + 1;
    if (overflows()) v.classList.add('home-compact');
    if (overflows()) v.classList.add('home-tight');
    // spread whatever height is left over into the gaps (up to a limit) so the
    // screen fills evenly instead of leaving one dead block above the nav
    const kids = [...v.children].filter((k) => getComputedStyle(k).position !== 'absolute');
    if (kids.length > 1) {
      // scrollHeight can't report less than the box, so measure the real gap
      // between the last block and the bottom of the content area
      const cs = getComputedStyle(v);
      const floor = v.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom);
      const slack = floor - kids[kids.length - 1].getBoundingClientRect().bottom;
      if (slack > 6) {
        const base = parseFloat(cs.gap) || 12;
        v.style.gap = (base + Math.min(18, slack / (kids.length - 1))) + 'px';
      }
    }
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
    // rebuilding a view drops the page to the top: ticking a habit or adding a
    // tick of a habit should leave you looking at the same thing
    const pageY = window.scrollY;
    $('#view').classList.toggle('home-screen', currentTab === 'home');
    switch (currentTab) {
      case 'home': renderHome(); break;
      case 'workout': renderWorkout(); break;
      case 'meals': renderMeals(); break;
      case 'habits': renderHabits(); break;
      case 'profile': renderProfile(); break;
    }
    renderWorkoutOverlay();
    fitHome();
    if (pageY) window.scrollTo(0, pageY);
    if (slideDir) {
      const v = $('#view');
      v.classList.remove('slide-left', 'slide-right');
      void v.offsetWidth; // restart the animation
      v.classList.add(slideDir);
      slideDir = null;
    }
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));
    rollNumbers();
    celebrateIfDue();
    // a long page: the title is the way back up
    const head = $('#view h2');
    if (head) head.addEventListener('click', () => {
      if (window.scrollY > 200) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    window.scrollTo(0, 0);
    goTab(t.dataset.tab);
  }));

  if (lastTab && lastTab !== 'home' && TAB_ORDER.includes(lastTab)) goTab(lastTab);
  else render();
  snapshotDaily();
  if (needsSetup()) setTimeout(openSetup, 350);
  else if (workoutStale(state.activeWorkout)) setTimeout(checkStaleWorkout, 350);
  checkShortcut();
  checkSharedImport();
  armFullBleed();
})();
