/* B.E.L.A Gym — programs: a few weeks of training laid out, and how the
   weight goes up.

   Most of them run on double progression: every working set has a rep range,
   and once every set reaches the top of it the next session starts heavier
   (+2.5 kg, +5 lb) at the bottom of the range. 5/3/1 runs on percentages of
   a training max — 90% of your best estimated one-rep max — in a four-week
   wave, the fourth week light.

   schedule: Monday → Sunday, a routine key or 'rest'.
   A set row: { reps, repsMax } (a range) or, on a 5/3/1 main lift, the lift
   is marked w531 and its sets come from the week's wave instead. */
const PROGRAMS = [
  {
    id: 'ppl6', name: 'Push · Pull · Legs', days: 6, level: 'Intermediate',
    blurb: 'Each muscle twice a week, six days on and one off. The classic for building size.',
    schedule: ['push', 'pull', 'legs', 'push', 'pull', 'legs', 'rest'],
    routines: {
      push: { name: 'Push', exercises: [
        { exerciseId: 'bench-press', sets: 4, reps: 6, repsMax: 8 },
        { exerciseId: 'overhead-press', sets: 3, reps: 8, repsMax: 10 },
        { exerciseId: 'incline-db-press', sets: 3, reps: 8, repsMax: 12 },
        { exerciseId: 'cable-lateral-raise', sets: 3, reps: 12, repsMax: 15 },
        { exerciseId: 'rope-pushdown', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'overhead-rope-extension', sets: 2, reps: 10, repsMax: 15 },
      ] },
      pull: { name: 'Pull', exercises: [
        { exerciseId: 'deadlift', sets: 3, reps: 5, repsMax: 6 },
        { exerciseId: 'pull-up', sets: 3, reps: 6, repsMax: 10 },
        { exerciseId: 'barbell-row', sets: 3, reps: 8, repsMax: 10 },
        { exerciseId: 'face-pull', sets: 3, reps: 12, repsMax: 15 },
        { exerciseId: 'ez-bar-curl', sets: 3, reps: 8, repsMax: 12 },
        { exerciseId: 'hammer-curl', sets: 2, reps: 10, repsMax: 15 },
      ] },
      legs: { name: 'Legs', exercises: [
        { exerciseId: 'squat', sets: 4, reps: 6, repsMax: 8 },
        { exerciseId: 'romanian-deadlift', sets: 3, reps: 8, repsMax: 10 },
        { exerciseId: 'leg-press', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'lying-leg-curl', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'standing-calf-raise', sets: 4, reps: 10, repsMax: 15 },
        { exerciseId: 'hanging-leg-raise', sets: 3, reps: 10, repsMax: 15 },
      ] },
    },
  },
  {
    id: 'ul4', name: 'Upper · Lower', days: 4, level: 'Beginner–intermediate',
    blurb: 'Four days, every muscle twice. One heavy and one lighter day for each half.',
    schedule: ['upperA', 'lowerA', 'rest', 'upperB', 'lowerB', 'rest', 'rest'],
    routines: {
      upperA: { name: 'Upper A — strength', exercises: [
        { exerciseId: 'bench-press', sets: 4, reps: 5, repsMax: 6 },
        { exerciseId: 'barbell-row', sets: 4, reps: 5, repsMax: 6 },
        { exerciseId: 'overhead-press', sets: 3, reps: 6, repsMax: 8 },
        { exerciseId: 'pull-up', sets: 3, reps: 6, repsMax: 10 },
        { exerciseId: 'barbell-curl', sets: 2, reps: 8, repsMax: 12 },
        { exerciseId: 'skull-crusher', sets: 2, reps: 8, repsMax: 12 },
      ] },
      lowerA: { name: 'Lower A — strength', exercises: [
        { exerciseId: 'squat', sets: 4, reps: 5, repsMax: 6 },
        { exerciseId: 'romanian-deadlift', sets: 3, reps: 6, repsMax: 8 },
        { exerciseId: 'leg-press', sets: 3, reps: 8, repsMax: 10 },
        { exerciseId: 'seated-calf-raise', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'plank', sets: 3, reps: 1 },
      ] },
      upperB: { name: 'Upper B — volume', exercises: [
        { exerciseId: 'incline-db-press', sets: 3, reps: 8, repsMax: 12 },
        { exerciseId: 'seated-cable-row', sets: 3, reps: 10, repsMax: 12 },
        { exerciseId: 'db-shoulder-press', sets: 3, reps: 8, repsMax: 12 },
        { exerciseId: 'lat-pulldown', sets: 3, reps: 10, repsMax: 12 },
        { exerciseId: 'lateral-raise', sets: 3, reps: 12, repsMax: 15 },
        { exerciseId: 'cable-curl', sets: 2, reps: 10, repsMax: 15 },
        { exerciseId: 'rope-pushdown', sets: 2, reps: 10, repsMax: 15 },
      ] },
      lowerB: { name: 'Lower B — volume', exercises: [
        { exerciseId: 'deadlift', sets: 3, reps: 5, repsMax: 6 },
        { exerciseId: 'bulgarian-split-squat', sets: 3, reps: 8, repsMax: 12 },
        { exerciseId: 'leg-extension', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'lying-leg-curl', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'standing-calf-raise', sets: 3, reps: 10, repsMax: 15 },
        { exerciseId: 'cable-crunch', sets: 3, reps: 10, repsMax: 15 },
      ] },
    },
  },
  {
    id: 'fb3', name: 'Full Body', days: 3, level: 'Beginner',
    blurb: 'Three whole-body sessions a week, alternating A and B. The fastest start.',
    schedule: ['fullA', 'rest', 'fullB', 'rest', 'fullA', 'rest', 'rest'],
    routines: {
      fullA: { name: 'Full Body A', exercises: [
        { exerciseId: 'squat', sets: 3, reps: 6, repsMax: 8 },
        { exerciseId: 'bench-press', sets: 3, reps: 6, repsMax: 8 },
        { exerciseId: 'barbell-row', sets: 3, reps: 8, repsMax: 10 },
        { exerciseId: 'lateral-raise', sets: 2, reps: 12, repsMax: 15 },
        { exerciseId: 'plank', sets: 2, reps: 1 },
      ] },
      fullB: { name: 'Full Body B', exercises: [
        { exerciseId: 'deadlift', sets: 3, reps: 5, repsMax: 6 },
        { exerciseId: 'overhead-press', sets: 3, reps: 6, repsMax: 8 },
        { exerciseId: 'lat-pulldown', sets: 3, reps: 8, repsMax: 12 },
        { exerciseId: 'goblet-squat', sets: 2, reps: 10, repsMax: 12 },
        { exerciseId: 'db-curl', sets: 2, reps: 10, repsMax: 12 },
      ] },
    },
  },
  {
    id: 'w531', name: '5/3/1', days: 4, level: 'Intermediate–advanced', kind: '531',
    blurb: 'Wendler\'s four-week wave on the big four — 5s, 3s, then 5/3/1, then a light week — with assistance after.',
    schedule: ['ohp', 'dl', 'rest', 'bench', 'squat', 'rest', 'rest'],
    routines: {
      ohp: { name: '5/3/1 Press', exercises: [
        { exerciseId: 'overhead-press', w531: true },
        { exerciseId: 'chin-up', sets: 5, reps: 8, repsMax: 10 },
        { exerciseId: 'db-shoulder-press', sets: 3, reps: 10, repsMax: 12 },
        { exerciseId: 'face-pull', sets: 3, reps: 12, repsMax: 15 },
      ] },
      dl: { name: '5/3/1 Deadlift', exercises: [
        { exerciseId: 'deadlift', w531: true },
        { exerciseId: 'leg-press', sets: 5, reps: 10, repsMax: 12 },
        { exerciseId: 'hanging-leg-raise', sets: 3, reps: 10, repsMax: 15 },
      ] },
      bench: { name: '5/3/1 Bench', exercises: [
        { exerciseId: 'bench-press', w531: true },
        { exerciseId: 'db-row', sets: 5, reps: 10, repsMax: 12 },
        { exerciseId: 'dips', sets: 3, reps: 8, repsMax: 12 },
      ] },
      squat: { name: '5/3/1 Squat', exercises: [
        { exerciseId: 'squat', w531: true },
        { exerciseId: 'romanian-deadlift', sets: 5, reps: 8, repsMax: 10 },
        { exerciseId: 'ab-wheel', sets: 3, reps: 8, repsMax: 12 },
      ] },
    },
  },
];

/* 5/3/1's wave: per week, three working sets as a share of the training max
   (the last one "+" — as many good reps as you have), and a light fourth. */
const WAVE_531 = [
  { label: '5s week', sets: [[0.65, 5], [0.75, 5], [0.85, 5, true]] },
  { label: '3s week', sets: [[0.70, 3], [0.80, 3], [0.90, 3, true]] },
  { label: '5/3/1 week', sets: [[0.75, 5], [0.85, 3], [0.95, 1, true]] },
  { label: 'Deload', sets: [[0.40, 5], [0.50, 5], [0.60, 5]] },
];
