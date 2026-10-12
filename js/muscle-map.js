/* B.E.L.A Gym — the body, front and back, as a map of where the work went.

   Each figure is drawn from its left half (centre line x = 50) and mirrored,
   so the two sides can never disagree. A part named after a muscle in
   MUSCLE_NAMES (js/exercise-guide.js) is shaded by how much that muscle did;
   an unnamed part (head, hands, knees…) is the neutral body underneath.

   BelaMuscleMap.svg(level, opts) — level(muscle) returns the class to paint
   it with ('l0'…'l4', or anything the stylesheet knows). */
(function () {
  const FRONT = [
    ['', 'M50 4c-5.6 0-9.4 4.6-9.4 11.2 0 6.4 3.9 11.8 9.4 11.8z'],
    ['', 'M45.2 25.5h4.8v7h-6z'],
    ['traps', 'M44.2 28.8c-3.4 1.6-6.6 2.8-9.6 3.6l9.8 1.4z'],
    ['front-delt', 'M34 32.6c-4.6.4-7.6 3.4-8.4 8.6-.3 2 .1 3.6.6 4.6 2.6-3.2 6-5 9.6-5.4.8-2.8.4-5.6-1.8-7.8z'],
    ['side-delt', 'M25.6 41.6c-1.8 1.8-2.6 4.6-2.4 8l2.8 1.8c-.2-2.4.2-4.4 1-5.6-.8-1.2-1.2-2.6-1.4-4.2z'],
    ['chest', 'M49.2 34.4l-13 .2c-2.2 1.6-2.8 5-2.4 8.6.6 4.4 3.6 7.2 7.8 7.8 3 .4 5.6 0 7.6-.8z'],
    ['biceps', 'M26.8 47.4c-2.6 2.6-3.6 7-3.4 11.6.2 3.2 1.2 5.6 2.6 7 2.4-.4 4.2-2 5-4.6 1-3.4.8-7.6-.6-11.2-1-1.8-2.2-2.6-3.6-2.8z'],
    ['forearms', 'M24.6 67.2c-2.8 2.4-4.4 6.8-5 11.6-.4 4 .2 8.4 1.2 11.4h3.6c.8-4 2.2-8.2 3.8-12 1.2-3.2 1.6-6.4 1-9.2-1.4-.6-3-1.2-4.6-1.8z'],
    ['', 'M20.6 90.6h3.6l.4 7.6-2.4 1.8-2.6-2z'],
    ['abs', 'M43.6 52.8h5.6v8.6h-5.6zM43.6 62.6h5.6v8.4h-5.6zM43.6 72.2h5.6v9.6c-2.2-.2-4-1-5.6-2.2z'],
    ['obliques', 'M42.4 52.4c-3 1-4.6 3.2-5 6.4-.6 6.4.2 13.8 2.8 20.2l2.2 1.6z'],
    ['', 'M40 81.6c2.8 2.4 6.2 3.6 10 3.8v9.4c-4.4-.2-8-1.6-10.6-4.4z'],
    ['quads', 'M39.2 91c-2.4 6.2-3.2 14.4-2.4 23.4.6 7.4 2 14.4 4.2 20.6h5.6c.8-6.6 1.4-13.6 1.4-20.8 0-7.8-.8-14.6-2.6-19.8-2-1.4-4-2.6-6.2-3.4z'],
    ['adductors', 'M46.8 96.2c1 5 1.4 10.6 1.2 16.4l1.6 4.2v-20.4c-1-.2-1.8-.2-2.8-.2z'],
    ['', 'M41.2 136.4h5.4l.4 6.2h-5.8z'],
    ['calves', 'M40.6 144.2c-1.8 5.4-2.2 12.4-1.2 19.4.6 4.2 1.4 8.4 2.2 12h3.6c.8-4.8 1.2-10 1-15 0-6-.8-11.6-1.8-16.4z'],
    ['', 'M41.4 176.6h4l.6 5.6c-1.6.8-3.6 1-5.6.6z'],
  ];
  const BACK = [
    ['', 'M50 4c-5.6 0-9.4 4.6-9.4 11.2 0 6.4 3.9 11.8 9.4 11.8z'],
    ['', 'M45.2 25.5h4.8v4h-4.8z'],
    ['traps', 'M50 27.4l-5 1.4c-3.4 1.6-6.8 2.8-10 3.6l7.6 4.4 4.4 13 3 3.4z'],
    ['rear-delt', 'M34.2 32.8c-4.6.4-7.6 3.4-8.4 8.6-.2 1.4 0 2.6.4 3.6 2.8-2.6 6.4-4 10-4.2.8-2.8.4-5.8-2-8z'],
    ['side-delt', 'M25.6 41.6c-1.8 1.8-2.6 4.6-2.4 8l2.8 1.8c-.2-2.4.2-4.4 1-5.6-.8-1.2-1.2-2.6-1.4-4.2z'],
    ['triceps', 'M27 46.6c-2.8 2.6-3.8 7.2-3.6 12 .2 3 1.2 5.4 2.6 6.8 2.6-.6 4.4-2.4 5.2-5.2.8-3.2.6-7-.8-10.6-.8-1.6-2-2.6-3.4-3z'],
    ['forearms', 'M24.6 67.2c-2.8 2.4-4.4 6.8-5 11.6-.4 4 .2 8.4 1.2 11.4h3.6c.8-4 2.2-8.2 3.8-12 1.2-3.2 1.6-6.4 1-9.2-1.4-.6-3-1.2-4.6-1.8z'],
    ['', 'M20.6 90.6h3.6l.4 7.6-2.4 1.8-2.6-2z'],
    ['upper-back', 'M42.4 37.4l-5.4 3.2c-.6 3.2-.2 6.4 1.2 9.2l7.8 2.4z'],
    ['lats', 'M37.8 51.6c-1.2 5.6-.4 11.8 2.2 17.4 1.6 3.4 3.8 6.2 6.4 8.4l1.4-7.6-.6-15.4z'],
    ['lower-back', 'M47.2 56.8h2.8v26.4c-1.6 0-3-.4-4.2-1z'],
    ['glutes', 'M40.4 81.6c-2.4 3.4-3.4 7.6-2.8 12 .6 4.2 2.8 7.6 6.6 9 2.2.8 4.2.8 5.8.4v-19.6c-3.6-.4-6.8-.8-9.6-1.8z'],
    ['hamstrings', 'M38.8 104.4c-1.6 5.4-2 11.4-1.2 17.6.8 5.2 2.2 9.8 4 13.8h5.2c.8-5.2 1.4-10.6 1.4-16 0-5.6-.6-10.6-1.8-14.6-2.6.2-5.2-.2-7.6-.8z'],
    ['', 'M41.2 136.4h5.4l.4 6.2h-5.8z'],
    ['calves', 'M40.4 143.2c-2.6 4.8-3.4 10.8-2.6 16.8.6 4.8 2 9.6 3.6 13.6l4 .6c.6-4.6.8-9.4.4-14-.4-6.2-1.6-12-3.2-16.6z'],
    ['', 'M41.4 176.6h4l.6 5.6c-1.6.8-3.6 1-5.6.6z'],
  ];

  function half(parts, level) {
    return parts.map(([m, d]) => m
      ? '<path d="' + d + '" data-m="' + m + '" class="mm-m ' + level(m) + '"/>'
      : '<path d="' + d + '" class="mm-n"/>').join('');
  }
  function figure(parts, dx, label, level) {
    return '<g transform="translate(' + dx + ' 0)">' + half(parts, level) +
      '<g transform="translate(100 0) scale(-1 1)">' + half(parts, level) + '</g>' +
      (label ? '<text x="50" y="197" class="mm-lbl">' + label + '</text>' : '') + '</g>';
  }
  function svg(level, opts = {}) {
    return '<svg class="mm-svg' + (opts.cls ? ' ' + opts.cls : '') + '" viewBox="0 0 210 ' + (opts.labels === false ? 186 : 202) +
      '" role="img" aria-label="' + (opts.label || 'Muscle map') + '">' +
      figure(FRONT, 0, opts.labels === false ? '' : 'Front', level) +
      figure(BACK, 110, opts.labels === false ? '' : 'Back', level) + '</svg>';
  }
  window.BelaMuscleMap = { svg, FRONT, BACK };
})();
