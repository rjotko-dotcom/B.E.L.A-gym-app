/* B.E.L.A Gym — the body, front and back, as a hologram of where the work went.

   Each figure is drawn from its left half (centre line x = 100) and mirrored,
   so the two sides can never disagree. A part named after a muscle in
   MUSCLE_NAMES (js/exercise-guide.js) is shaded by how much that muscle did;
   an unnamed part (head, hands, knees…) is the body underneath it. The fine
   lines (DETAIL) are fibres and separations: they make it read as anatomy
   and never take a tap.

   The look: outlines that glow, a faint fill, scanlines inside the body, a
   band of light that sweeps down it and a ring under the feet — a projection
   rather than a drawing. Trained muscles light up; ten sets in a week turns
   one green, the app's colour for "reached".

   BelaMuscleMap.svg(level, opts) — level(muscle) returns 'l0'…'l4'. */
(function () {
  const FRONT = [
        ['', 'M89 52c1 8 0 15-4 21l15 3V56z'],
    ['traps', 'M89 62c-5 7-14 11-26 14l9 4c8-1 15-3 20-5z'],
    ['front-delt', 'M64 77c-10 1-17 8-19 20-1 7 0 14 2 19 4-7 9-13 16-16 4-6 6-14 5-22z'],
    ['side-delt', 'M47 85c-5 6-7 15-6 24 1 6 3 10 6 12-2-9-2-18 0-27z'],
    ['chest', 'M98 81 70 79c-6 7-8 17-7 25 1 10 7 17 17 19 8 1 15-1 18-5z'],
    ['biceps', 'M49 119c-5 8-7 20-6 32 1 8 4 14 8 17 5-5 8-15 8-26 0-10-3-18-7-23z'],
    ['forearms', 'M45 168c-6 10-9 24-9 38 0 8 1 16 3 22h8c2-12 5-24 8-36 2-10 1-18-2-24z'],
    ['', 'M38 228c-4 6-5 15-3 23 1 4 4 7 7 7s5-3 6-7l1-23z'],
    ['obliques', 'M73 123c-4 4-6 11-5 18l5-3zM74 126c-4 10-4 24-2 36 2 10 6 20 12 28l3-4-1-58z'],
    ['abs', 'M87 124h11v14H87zM87 140h11v14H87zM87 156h11v14H87zM87 172h11v28c-5-2-9-6-11-12z'],
    ['', 'M84 190c6 8 11 14 16 16v8c-10-2-20-8-26-16z'],
    ['quads', 'M72 198c-8 14-12 38-11 60 1 18 5 32 11 42h14c4-16 7-34 7-54 0-18-2-32-5-40-5-2-11-4-16-8z'],
    ['adductors', 'M92 212c5 10 7 24 6 40-2-6-5-16-8-26z'],
    ['', 'M71 299c4-2 12-2 16 0 2 6 1 13-2 18-4 2-9 2-12 0-3-5-4-12-2-18z'],
    ['calves', 'M72 318c-5 16-6 34-3 52l7 14h6c3-16 4-34 3-50-1-8-3-14-5-16z'],
    ['', 'M73 383c4-1 9-1 12 0 2 6 3 12 2 17-1 2-3 3-6 3H70c-2 0-3-2-2-4 1-6 2-11 5-16z'],
  ];
  const FRONT_DETAIL = [
    'M96 85c-8 4-16 10-22 20M95 95c-7 4-13 10-17 18M94 105c-5 3-9 7-12 12',   // pec fibres
    'M98 81v37',                                                             // sternum
    'M60 84c-4 6-7 13-8 21M56 82c-5 5-8 12-9 19',                            // delt striations
    'M50 130c3 10 4 22 2 34',                                                // biceps split
    'M66 230c4 20 10 40 16 60M80 214c2 24 2 50-2 76',                        // rectus femoris / vastus lines
    'M84 280c4 6 6 12 4 18',                                                 // teardrop
    'M76 328c3 14 4 28 2 42',                                                // shin
    'M44 182c2 14 2 28 0 40',                                                // forearm
    'M91 66c3 4 6 7 9 8',                                                    // neck to the collarbone
    'M72 80c8-2 18-2 26 0',                                                  // collarbone
  ];
  const BACK = [
        ['', 'M89 52c1 6 0 10-2 13l13 1V56z'],
    ['traps', 'M100 56c-6 6-14 12-34 20 10 6 18 14 24 28 4 12 7 24 10 36z'],
    ['rear-delt', 'M64 77c-10 1-17 8-19 20-1 5 0 10 1 14 6-8 12-12 20-14 3-7 3-14-2-20z'],
    ['side-delt', 'M47 85c-5 6-7 15-6 24 1 6 3 10 6 12-2-9-2-18 0-27z'],
    ['triceps', 'M48 118c-6 10-8 24-7 36 1 8 4 13 9 15 5-5 8-15 8-27 0-10-3-18-7-24z'],
    ['forearms', 'M45 168c-6 10-9 24-9 38 0 8 1 16 3 22h8c2-12 5-24 8-36 2-10 1-18-2-24z'],
    ['', 'M38 228c-4 6-5 15-3 23 1 4 4 7 7 7s5-3 6-7l1-23z'],
    ['upper-back', 'M67 98c-5 6-6 14-4 22 7 4 17 6 25 2 0-10-2-18-6-24-5-2-11-2-15 0z'],
    ['lats', 'M63 122c-1 16 2 32 9 46 6 12 14 22 22 26l2-18c-6-14-8-30-8-52-8 3-17 2-25-2z'],
    ['lower-back', 'M92 140c-2 16-2 32 0 48l8 4v-50z'],
    ['glutes', 'M74 196c-8 10-10 26-6 40 4 10 14 16 24 16 4 0 7-2 8-4v-42c-8-2-18-6-26-10z'],
    ['hamstrings', 'M68 240c-4 18-4 36 0 52l6 10h10c4-12 8-26 9-40 1-6 1-10 0-12-9 2-18-2-25-10z'],
    ['', 'M73 301c4-2 9-2 12 0 2 4 1 9-2 12-3 1-6 1-9 0-2-4-2-8-1-12z'],
    ['calves', 'M70 312c-6 12-6 28-2 40 3 10 7 18 10 26h6c2-14 4-30 3-44-1-12-3-20-7-24z'],
    ['', 'M76 378c3-1 6-1 8 0l2 20c0 3-2 5-5 5h-9c-3 0-4-2-3-5 1-7 3-14 7-20z'],
  ];
  const BACK_DETAIL = [
    'M100 58v150',                                                           // spine
    'M90 104c-6 2-14 2-22-2',                                                // trap edge
    'M47 132c4 4 7 10 7 18M52 124c-3 10-3 22 0 32',                          // triceps horseshoe
    'M70 140c6 12 14 24 22 32',                                              // lat fibres
    'M80 252c-1 18-3 34-6 50',                                               // hamstring split
    'M77 324c0 16 1 30 3 44',                                                // calf heads
    'M76 214c6 8 14 14 22 16',                                               // glute fold
    'M84 18c5-6 11-8 16-8',                                                  // hairline
  ];

  let seq = 0;
  function figure(parts, detail, dx, label, level, uid) {
    const half = (withData) => parts.map(([m, d]) => m
      ? '<path d="' + d + '"' + (withData ? ' data-m="' + m + '"' : '') + ' class="mm-m ' + level(m) + '"/>'
      : '<path d="' + d + '" class="mm-n"/>').join('');
    const lines = detail.map((d) => '<path d="' + d + '"/>').join('');
    const both = (inner) => inner + '<g transform="translate(200 0) scale(-1 1)">' + inner + '</g>';
    const clip = 'mmc' + uid + dx;
    return '<g transform="translate(' + dx + ' 0)">' +
      '<clipPath id="' + clip + '">' + both(parts.map(([, d]) => '<path d="' + d + '"/>').join('')) +
        '<path d="M100 6c-12 0-20 10-20 25 0 9 4 17 9 22 3 3 7 5 11 5s8-2 11-5c5-5 9-13 9-22 0-15-8-25-20-25z"/></clipPath>' +
      // the ring the figure stands in
      '<ellipse class="mm-floor" cx="100" cy="404" rx="46" ry="7"/>' +
      '<ellipse class="mm-floor-ring" cx="100" cy="404" rx="34" ry="4.5"/>' +
      '<g class="mm-body">' + both(half(true)) +
        '<path class="mm-n" d="M100 6c-12 0-20 10-20 25 0 9 4 17 9 22 3 3 7 5 11 5s8-2 11-5c5-5 9-13 9-22 0-15-8-25-20-25z"/></g>' +
      '<g class="mm-detail">' + both(lines) + '</g>' +
      // light inside the body: scanlines and a sweep
      '<g clip-path="url(#' + clip + ')" class="mm-holo">' +
        '<rect x="0" y="0" width="200" height="410" fill="url(#mmScan' + uid + ')"/>' +
        '<rect class="mm-sweep" x="0" y="-60" width="200" height="60" fill="url(#mmSweep' + uid + ')"/>' +
      '</g>' +
      (label ? '<text x="100" y="430" class="mm-lbl">' + label + '</text>' : '') + '</g>';
  }
  function svg(level, opts = {}) {
    const uid = ++seq;
    const labels = opts.labels !== false;
    return '<svg class="mm-svg' + (opts.cls ? ' ' + opts.cls : '') + '" viewBox="0 0 420 ' + (labels ? 440 : 414) +
      '" role="img" aria-label="' + (opts.label || 'Muscle map') + '">' +
      '<defs>' +
        '<pattern id="mmScan' + uid + '" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.1" class="mm-scanline"/></pattern>' +
        '<linearGradient id="mmSweep' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" class="mm-sweep-a"/><stop offset="0.85" class="mm-sweep-b"/><stop offset="1" class="mm-sweep-a"/>' +
        '</linearGradient>' +
      '</defs>' +
      figure(FRONT, FRONT_DETAIL, 0, labels ? 'Front' : '', level, uid) +
      figure(BACK, BACK_DETAIL, 220, labels ? 'Back' : '', level, uid) + '</svg>';
  }
  window.BelaMuscleMap = { svg, FRONT, BACK };
})();
