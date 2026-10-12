/* B.E.L.A — formatting. Pure functions, no state: what a date, a number, a
   duration or a piece of user text looks like on screen. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dateKey(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
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

  window.BelaFormat = { esc, dateKey, fmtDate, fmtShortDate, fmtClock, fmtDuration, fmtElapsed, fmtNum, WEIGHT_STEP, roundWeight };
})();
