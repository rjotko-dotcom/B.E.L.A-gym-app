/* ============================================================
   B.E.L.A — sync
   The same file runs in the phone app and in the PC app, because the
   merge has to agree on both ends or the two copies drift apart.

   Nothing here touches the app's records. Every change is remembered
   next to them, in doc.sync, so a document written by an older build
   still merges and an exported backup is still just the data.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BelaSync = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROTOCOL = 1;
  /* How long a deletion is remembered. A copy that has been offline longer
     than this and still holds the record will bring it back — the price of
     not keeping every deletion forever. */
  const GRAVE_DAYS = 180;

  const get = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
  function put(obj, path, value) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (typeof o[path[i]] !== 'object' || o[path[i]] === null) o[path[i]] = {};
      o = o[path[i]];
    }
    o[path[path.length - 1]] = value;
  }

  /* Every list the two copies can both add to, and what makes a row itself.
     Rows with an id use it; the ones written once per day are the day. */
  const LISTS = [
    { name: 'workouts', path: ['workouts'], key: (r) => r.id, sort: (r) => -(r.finishedAt || r.startedAt || 0) },
    { name: 'templates', path: ['templates'], key: (r) => r.id },
    { name: 'customExercises', path: ['customExercises'], key: (r) => r.id },
    { name: 'foods', path: ['foods'], key: (r) => r.id },
    { name: 'savedMeals', path: ['savedMeals'], key: (r) => r.id },
    { name: 'habits', path: ['habits'], key: (r) => r.id },
    { name: 'meals', path: ['nutrition', 'meals'], key: (r) => r.id },
    { name: 'weights', path: ['nutrition', 'weights'], key: (r) => r.date },
    { name: 'water', path: ['nutrition', 'water'], key: (r) => r.date },
    { name: 'measurements', path: ['nutrition', 'measurements'], key: (r) => r.date + '|' + r.key },
  ];

  /* Settings, targets and the weekly plan are one thing each, not a list, so
     the copy that touched them last wins outright. */
  const SINGLES = [
    { name: 'settings', path: ['settings'] },
    { name: 'targets', path: ['nutrition', 'targets'] },
    { name: 'schedule', path: ['schedule'] },
    { name: 'habitOrder', path: ['habits'], derive: (v) => (v || []).map((h) => h.id) },
  ];

  const fingerprint = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };

  function meta(doc) {
    if (!doc.sync || typeof doc.sync !== 'object') doc.sync = {};
    const s = doc.sync;
    s.v = PROTOCOL;
    if (!s.stamps || typeof s.stamps !== 'object') s.stamps = {};
    if (!s.graves || typeof s.graves !== 'object') s.graves = {};
    if (!s.singles || typeof s.singles !== 'object') s.singles = {};
    if (!s.device) s.device = 'dev_' + Math.random().toString(36).slice(2, 10);
    return s;
  }

  /* habitLog is a day holding a value per habit. Flattened to day|habit so
     ticking one habit here and another there on the same day keeps both. */
  function habitPairs(doc) {
    const out = {};
    const log = doc.habitLog || {};
    Object.keys(log).forEach((day) => {
      const row = log[day];
      if (!row || typeof row !== 'object') return;
      Object.keys(row).forEach((id) => { out[day + '|' + id] = row[id]; });
    });
    return out;
  }
  function habitFromPairs(pairs) {
    const log = {};
    Object.keys(pairs).forEach((k) => {
      const cut = k.indexOf('|');
      const day = k.slice(0, cut), id = k.slice(cut + 1);
      if (!log[day]) log[day] = {};
      log[day][id] = pairs[k];
    });
    return log;
  }

  /* ---------------- stamping ----------------
     Called on every save. It compares the document with the shape it had at
     the last save and writes down when each row last changed — which is what
     lets a merge tell an edit from a copy that simply never saw it. The very
     first pass only takes the picture: nothing is marked as changed, because
     nothing has been. */
  function stamp(doc, shadow, now) {
    now = now || Date.now();
    const s = meta(doc);
    const first = !shadow;
    const next = {};
    let touched = 0;

    LISTS.forEach((list) => {
      const rows = get(doc, list.path) || [];
      const seen = {};
      const was = (shadow && shadow[list.name]) || {};
      const stamps = s.stamps[list.name] || (s.stamps[list.name] = {});
      rows.forEach((r) => {
        const k = list.key(r);
        if (k == null) return;
        const fp = fingerprint(r);
        seen[k] = fp;
        if (first) { if (stamps[k] == null) stamps[k] = 0; return; }
        if (was[k] !== fp) { stamps[k] = now; touched++; }
        if (s.graves[list.name]) delete s.graves[list.name][k];
      });
      if (!first) {
        Object.keys(was).forEach((k) => {
          if (seen[k] === undefined) {
            const graves = s.graves[list.name] || (s.graves[list.name] = {});
            graves[k] = now;
            delete stamps[k];
            touched++;
          }
        });
      }
      next[list.name] = seen;
    });

    // the habit log, as day|habit pairs
    {
      const pairs = habitPairs(doc);
      const was = (shadow && shadow.habitLog) || {};
      const stamps = s.stamps.habitLog || (s.stamps.habitLog = {});
      const seen = {};
      Object.keys(pairs).forEach((k) => {
        const fp = fingerprint(pairs[k]);
        seen[k] = fp;
        if (first) { if (stamps[k] == null) stamps[k] = 0; return; }
        if (was[k] !== fp) { stamps[k] = now; touched++; }
        if (s.graves.habitLog) delete s.graves.habitLog[k];
      });
      if (!first) {
        Object.keys(was).forEach((k) => {
          if (seen[k] === undefined) {
            const graves = s.graves.habitLog || (s.graves.habitLog = {});
            graves[k] = now;
            delete stamps[k];
            touched++;
          }
        });
      }
      next.habitLog = seen;
    }

    SINGLES.forEach((one) => {
      const raw = get(doc, one.path);
      const fp = fingerprint(one.derive ? one.derive(raw) : raw);
      const was = shadow && shadow.singles ? shadow.singles[one.name] : undefined;
      if (first) { if (s.singles[one.name] == null) s.singles[one.name] = 0; }
      else if (was !== fp) { s.singles[one.name] = now; touched++; }
      if (!next.singles) next.singles = {};
      next.singles[one.name] = fp;
    });
    if (!next.singles) next.singles = {};

    return { shadow: next, touched };
  }

  /* A picture of the document as it is, with nothing marked changed. Used
     when the app starts and after adopting a merge. */
  const snapshot = (doc) => stamp(doc, null, 0).shadow;

  /* ---------------- merging ----------------
     Row by row, the copy that touched it last wins, and a deletion is just
     another kind of touch. `mine` breaks ties, so the side running the merge
     keeps what it has when two edits land in the same millisecond. */
  function merge(mine, theirs, now) {
    now = now || Date.now();
    const a = meta(mine), b = meta(theirs);
    const out = JSON.parse(JSON.stringify(mine));
    const s = meta(out);
    const tally = { added: 0, updated: 0, removed: 0 };

    LISTS.forEach((list) => {
      const rowsA = get(mine, list.path) || [];
      const rowsB = get(theirs, list.path) || [];
      const byKey = {};
      const order = [];
      const keep = (r, from) => {
        const k = list.key(r);
        if (k == null) return;
        if (!(k in byKey)) order.push(k);
        byKey[k] = { row: r, from };
      };
      rowsA.forEach((r) => keep(r, 'a'));

      const stampsA = (a.stamps[list.name]) || {};
      const stampsB = (b.stamps[list.name]) || {};
      const gravesA = (a.graves[list.name]) || {};
      const gravesB = (b.graves[list.name]) || {};

      rowsB.forEach((r) => {
        const k = list.key(r);
        if (k == null) return;
        const mineHas = k in byKey;
        const tA = stampsA[k] ?? -1;
        const tB = stampsB[k] ?? -1;
        if (!mineHas) {
          // did I delete it, more recently than they changed it?
          if ((gravesA[k] ?? -1) > tB) return;
          keep(r, 'b');
          tally.added++;
          return;
        }
        if (tB > tA) { byKey[k] = { row: r, from: 'b' }; tally.updated++; }
      });

      // deletions from the other side
      Object.keys(gravesB).forEach((k) => {
        if (!(k in byKey)) return;
        const tA = stampsA[k] ?? -1;
        if (gravesB[k] > tA) { delete byKey[k]; tally.removed++; }
      });

      let rows = order.filter((k) => k in byKey).map((k) => byKey[k].row);
      if (list.sort) rows = rows.slice().sort((x, y) => list.sort(x) - list.sort(y));

      const stamps = {};
      Object.keys(byKey).forEach((k) => {
        const t = Math.max(stampsA[k] ?? 0, stampsB[k] ?? 0);
        stamps[k] = t;
      });
      const graves = {};
      Object.keys(gravesA).concat(Object.keys(gravesB)).forEach((k) => {
        if (k in byKey) return;
        graves[k] = Math.max(gravesA[k] ?? 0, gravesB[k] ?? 0);
      });
      put(out, list.path, rows);
      s.stamps[list.name] = stamps;
      s.graves[list.name] = graves;
    });

    // the habit log
    {
      const pa = habitPairs(mine), pb = habitPairs(theirs);
      const stampsA = a.stamps.habitLog || {}, stampsB = b.stamps.habitLog || {};
      const gravesA = a.graves.habitLog || {}, gravesB = b.graves.habitLog || {};
      const outPairs = {};
      Object.keys(pa).forEach((k) => { outPairs[k] = pa[k]; });
      Object.keys(pb).forEach((k) => {
        const tA = stampsA[k] ?? -1, tB = stampsB[k] ?? -1;
        if (!(k in outPairs)) {
          if ((gravesA[k] ?? -1) > tB) return;
          outPairs[k] = pb[k]; tally.added++;
          return;
        }
        if (tB > tA) { outPairs[k] = pb[k]; tally.updated++; }
      });
      Object.keys(gravesB).forEach((k) => {
        if (!(k in outPairs)) return;
        if (gravesB[k] > (stampsA[k] ?? -1)) { delete outPairs[k]; tally.removed++; }
      });
      out.habitLog = habitFromPairs(outPairs);
      const stamps = {}, graves = {};
      Object.keys(outPairs).forEach((k) => { stamps[k] = Math.max(stampsA[k] ?? 0, stampsB[k] ?? 0); });
      Object.keys(gravesA).concat(Object.keys(gravesB)).forEach((k) => {
        if (k in outPairs) return;
        graves[k] = Math.max(gravesA[k] ?? 0, gravesB[k] ?? 0);
      });
      s.stamps.habitLog = stamps;
      s.graves.habitLog = graves;
    }

    SINGLES.forEach((one) => {
      if (one.derive) return;      // ordering is carried by the list itself
      const tA = a.singles[one.name] ?? -1;
      const tB = b.singles[one.name] ?? -1;
      if (tB > tA) { put(out, one.path, JSON.parse(JSON.stringify(get(theirs, one.path)))); tally.updated++; }
      s.singles[one.name] = Math.max(tA, tB, 0);
    });

    /* Habits are a list you arrange by hand, so the arrangement travels with
       whichever copy last changed it rather than with the rows. */
    {
      const tA = a.singles.habitOrder ?? -1;
      const tB = b.singles.habitOrder ?? -1;
      const wanted = tB > tA ? (theirs.habits || []).map((h) => h.id) : (mine.habits || []).map((h) => h.id);
      const have = out.habits || [];
      const rank = {};
      wanted.forEach((id, i) => { rank[id] = i; });
      out.habits = have.slice().sort((x, y) => (rank[x.id] ?? 1e6) - (rank[y.id] ?? 1e6));
      s.singles.habitOrder = Math.max(tA, tB, 0);
    }

    /* A session in progress belongs to the phone in your hand. It is never
       sent anywhere and never overwritten. */
    out.activeWorkout = mine.activeWorkout ?? null;

    s.device = a.device;
    s.lastSync = now;
    prune(out, now);
    return { doc: out, tally };
  }

  /* Deletions older than GRAVE_DAYS stop being carried around. */
  function prune(doc, now) {
    const s = meta(doc);
    const cut = (now || Date.now()) - GRAVE_DAYS * 86400000;
    Object.keys(s.graves).forEach((name) => {
      const g = s.graves[name];
      Object.keys(g).forEach((k) => { if (g[k] < cut) delete g[k]; });
    });
  }

  /* What a document holds, for the "last synced" line. */
  function summary(doc) {
    return {
      workouts: (doc.workouts || []).length,
      meals: ((doc.nutrition || {}).meals || []).length,
      habits: (doc.habits || []).length,
      days: Object.keys(doc.habitLog || {}).length,
    };
  }

  /* The phone sends everything except the live session. */
  function outgoing(doc) {
    const copy = JSON.parse(JSON.stringify(doc));
    delete copy.activeWorkout;
    return copy;
  }

  return { PROTOCOL, GRAVE_DAYS, LISTS, SINGLES, meta, stamp, snapshot, merge, prune, summary, outgoing };
}));
