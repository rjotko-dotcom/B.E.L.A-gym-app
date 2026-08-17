/* B.E.L.A Gym — built-in exercise library */
const EXERCISE_LIBRARY = [
  // Chest
  { id: 'bench-press', name: 'Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'incline-db-press', name: 'Incline Dumbbell Press', muscle: 'Chest', equipment: 'Dumbbell' },
  { id: 'db-fly', name: 'Dumbbell Fly', muscle: 'Chest', equipment: 'Dumbbell' },
  { id: 'cable-crossover', name: 'Cable Crossover', muscle: 'Chest', equipment: 'Cable' },
  { id: 'push-up', name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight' },
  { id: 'dips', name: 'Dips', muscle: 'Chest', equipment: 'Bodyweight' },

  // Back
  { id: 'deadlift', name: 'Deadlift', muscle: 'Back', equipment: 'Barbell' },
  { id: 'pull-up', name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscle: 'Back', equipment: 'Machine' },
  { id: 'barbell-row', name: 'Barbell Row', muscle: 'Back', equipment: 'Barbell' },
  { id: 'db-row', name: 'One-Arm Dumbbell Row', muscle: 'Back', equipment: 'Dumbbell' },
  { id: 'seated-cable-row', name: 'Seated Cable Row', muscle: 'Back', equipment: 'Cable' },
  { id: 'face-pull', name: 'Face Pull', muscle: 'Back', equipment: 'Cable' },

  // Legs
  { id: 'squat', name: 'Barbell Back Squat', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'front-squat', name: 'Front Squat', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'leg-press', name: 'Leg Press', muscle: 'Legs', equipment: 'Machine' },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'lunge', name: 'Walking Lunge', muscle: 'Legs', equipment: 'Dumbbell' },
  { id: 'leg-extension', name: 'Leg Extension', muscle: 'Legs', equipment: 'Machine' },
  { id: 'leg-curl', name: 'Lying Leg Curl', muscle: 'Legs', equipment: 'Machine' },
  { id: 'calf-raise', name: 'Standing Calf Raise', muscle: 'Legs', equipment: 'Machine' },
  { id: 'hip-thrust', name: 'Hip Thrust', muscle: 'Legs', equipment: 'Barbell' },

  // Shoulders
  { id: 'overhead-press', name: 'Overhead Press', muscle: 'Shoulders', equipment: 'Barbell' },
  { id: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'lateral-raise', name: 'Lateral Raise', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'rear-delt-fly', name: 'Rear Delt Fly', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'upright-row', name: 'Upright Row', muscle: 'Shoulders', equipment: 'Barbell' },

  // Arms
  { id: 'barbell-curl', name: 'Barbell Curl', muscle: 'Arms', equipment: 'Barbell' },
  { id: 'db-curl', name: 'Dumbbell Curl', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'hammer-curl', name: 'Hammer Curl', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'triceps-pushdown', name: 'Triceps Pushdown', muscle: 'Arms', equipment: 'Cable' },
  { id: 'skull-crusher', name: 'Skull Crusher', muscle: 'Arms', equipment: 'Barbell' },
  { id: 'preacher-curl', name: 'Preacher Curl', muscle: 'Arms', equipment: 'Machine' },

  // Core
  { id: 'plank', name: 'Plank', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'crunch', name: 'Crunch', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'russian-twist', name: 'Russian Twist', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'cable-woodchop', name: 'Cable Woodchop', muscle: 'Core', equipment: 'Cable' },

  // Cardio
  { id: 'treadmill', name: 'Treadmill Run', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'rowing-machine', name: 'Rowing Machine', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'cycling', name: 'Stationary Bike', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'jump-rope', name: 'Jump Rope', muscle: 'Cardio', equipment: 'Bodyweight' },
];

const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio'];

/* Built-in workout templates (exercise ids + default set count) */
const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-push', name: 'Push Day', builtin: true,
    exercises: [
      { exerciseId: 'bench-press', sets: 4 },
      { exerciseId: 'overhead-press', sets: 3 },
      { exerciseId: 'incline-db-press', sets: 3 },
      { exerciseId: 'lateral-raise', sets: 3 },
      { exerciseId: 'triceps-pushdown', sets: 3 },
    ],
  },
  {
    id: 'tpl-pull', name: 'Pull Day', builtin: true,
    exercises: [
      { exerciseId: 'deadlift', sets: 3 },
      { exerciseId: 'pull-up', sets: 4 },
      { exerciseId: 'barbell-row', sets: 3 },
      { exerciseId: 'face-pull', sets: 3 },
      { exerciseId: 'barbell-curl', sets: 3 },
    ],
  },
  {
    id: 'tpl-legs', name: 'Leg Day', builtin: true,
    exercises: [
      { exerciseId: 'squat', sets: 4 },
      { exerciseId: 'romanian-deadlift', sets: 3 },
      { exerciseId: 'leg-press', sets: 3 },
      { exerciseId: 'leg-curl', sets: 3 },
      { exerciseId: 'calf-raise', sets: 4 },
    ],
  },
  {
    id: 'tpl-full', name: 'Full Body', builtin: true,
    exercises: [
      { exerciseId: 'squat', sets: 3 },
      { exerciseId: 'bench-press', sets: 3 },
      { exerciseId: 'barbell-row', sets: 3 },
      { exerciseId: 'overhead-press', sets: 2 },
      { exerciseId: 'plank', sets: 3 },
    ],
  },
];
