/* A deterministic app state: a week of weights, a fortnight of habits, six
   sessions, a plan and yesterday's meals. Dates are relative to today so the
   suite keeps working next month. */
const dk = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function build() {
  const today = new Date();
  const day = (back) => dk(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back));
  const weights = [79.9, 79.6, 79.4, 79.1, 78.9, 78.6, 78.3].map((v, i) => ({ date: day(6 - i), value: v }));
  const meals = [
    { id: 'y1', date: day(1), slot: 'breakfast', time: '08:10', name: 'Oats & whey', kcal: 520, protein: 42, carbs: 66, fat: 9 },
    { id: 'y2', date: day(1), slot: 'lunch', time: '13:00', name: 'Chicken, rice & veg', kcal: 780, protein: 58, carbs: 92, fat: 16 },
    { id: 'y3', date: day(1), slot: 'dinner', time: '19:30', name: 'Salmon & potatoes', kcal: 690, protein: 46, carbs: 54, fat: 28 },
  ];
  const habitLog = {};
  for (let i = 0; i < 30; i++) {
    const k = day(i);
    habitLog[k] = { h_steps: 5000 + ((i * 1373) % 8000) };
    if (i % 2 === 0) habitLog[k].h_read = 12 + (i % 14);
    if (i % 4 !== 1) habitLog[k].h_sleep = 1;
  }
  const workouts = [1, 4, 6, 8, 11, 13].map((back, i) => ({
    id: 'w' + i,
    name: i % 2 ? 'Pull Day' : 'Push Day',
    startedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 18, 0).getTime(),
    finishedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 19, 10).getTime(),
    exercises: [{
      exerciseId: 'bench-press', targetReps: 8,
      sets: [
        { weight: 80, reps: 8, done: true, type: 'N' },
        { weight: 80, reps: 8, done: true, type: 'N' },
        { weight: 80, reps: 7, done: true, type: 'N' },
      ],
    }],
  }));
  return {
    settings: { unit: 'kg', appearance: 'dark', name: 'Rimvydas', goalWeight: 75, restSeconds: 90 },
    nutrition: {
      targets: { kcal: 2800, protein: 180, carbs: 300, fat: 70 },
      meals, weights, water: [], measurements: [],
    },
    savedMeals: [],
    // today is always a training day, so the suite does not depend on which
    // weekday it runs: the plan is laid out from today backwards
    schedule: (() => {
      const week = ['tpl-push', 'tpl-pull', null, 'tpl-push', 'rest', 'tpl-legs', null];
      const today = (new Date().getDay() + 6) % 7;         // 0 = Monday
      return week.map((_, i) => week[(i - today + 7) % 7]);
    })(),
    habits: [
      { id: 'h_train', name: 'Train', icon: 'dumbbell', type: 'check', target: 1, source: 'workout' },
      { id: 'h_steps', name: 'Steps', icon: 'steps', type: 'count', target: 10000, unit: 'steps', step: 1000 },
      { id: 'h_read', name: 'Read', icon: 'book', type: 'count', target: 20, unit: 'pages', step: 5 },
      { id: 'h_sleep', name: 'Sleep 8h', icon: 'sleep', type: 'check', target: 1 },
    ],
    habitLog,
    customExercises: [], templates: [], workouts, activeWorkout: null,
  };
}

module.exports = { build, dk };
