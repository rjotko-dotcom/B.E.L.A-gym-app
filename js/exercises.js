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

  // Chest — more of the room
  { id: 'incline-bench-press', name: 'Incline Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'decline-bench-press', name: 'Decline Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'db-bench-press', name: 'Flat Dumbbell Press', muscle: 'Chest', equipment: 'Dumbbell' },
  { id: 'machine-chest-press', name: 'Machine Chest Press', muscle: 'Chest', equipment: 'Machine' },
  { id: 'pec-deck', name: 'Pec Deck', muscle: 'Chest', equipment: 'Machine' },
  { id: 'incline-cable-fly', name: 'Incline Cable Fly', muscle: 'Chest', equipment: 'Cable' },
  { id: 'low-cable-fly', name: 'Low Cable Fly', muscle: 'Chest', equipment: 'Cable' },
  { id: 'smith-bench-press', name: 'Smith Machine Bench Press', muscle: 'Chest', equipment: 'Machine' },
  { id: 'incline-db-fly', name: 'Incline Dumbbell Fly', muscle: 'Chest', equipment: 'Dumbbell' },
  { id: 'incline-push-up', name: 'Incline Push-Up', muscle: 'Chest', equipment: 'Bodyweight' },
  { id: 'decline-push-up', name: 'Decline Push-Up', muscle: 'Chest', equipment: 'Bodyweight' },

  // Back — more of the room
  { id: 'chin-up', name: 'Chin-Up', muscle: 'Back', equipment: 'Bodyweight' },
  { id: 't-bar-row', name: 'T-Bar Row', muscle: 'Back', equipment: 'Barbell' },
  { id: 'pendlay-row', name: 'Pendlay Row', muscle: 'Back', equipment: 'Barbell' },
  { id: 'rack-pull', name: 'Rack Pull', muscle: 'Back', equipment: 'Barbell' },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift', muscle: 'Back', equipment: 'Barbell' },
  { id: 'chest-supported-row', name: 'Chest-Supported Row', muscle: 'Back', equipment: 'Machine' },
  { id: 'machine-row', name: 'Seated Machine Row', muscle: 'Back', equipment: 'Machine' },
  { id: 'close-grip-pulldown', name: 'Close-Grip Pulldown', muscle: 'Back', equipment: 'Cable' },
  { id: 'neutral-pulldown', name: 'Neutral-Grip Pulldown', muscle: 'Back', equipment: 'Cable' },
  { id: 'single-arm-pulldown', name: 'Single-Arm Pulldown', muscle: 'Back', equipment: 'Cable' },
  { id: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown', muscle: 'Back', equipment: 'Cable' },
  { id: 'cable-pullover', name: 'Cable Pullover', muscle: 'Back', equipment: 'Cable' },
  { id: 'single-arm-db-row', name: 'Single-Arm Dumbbell Row', muscle: 'Back', equipment: 'Dumbbell' },
  { id: 'inverted-row', name: 'Inverted Row', muscle: 'Back', equipment: 'Bodyweight' },
  { id: 'barbell-shrug', name: 'Barbell Shrug', muscle: 'Back', equipment: 'Barbell' },
  { id: 'db-shrug', name: 'Dumbbell Shrug', muscle: 'Back', equipment: 'Dumbbell' },

  // Legs — more of the room
  { id: 'hack-squat', name: 'Hack Squat', muscle: 'Legs', equipment: 'Machine' },
  { id: 'smith-squat', name: 'Smith Machine Squat', muscle: 'Legs', equipment: 'Machine' },
  { id: 'belt-squat', name: 'Belt Squat', muscle: 'Legs', equipment: 'Machine' },
  { id: 'pause-squat', name: 'Pause Squat', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'box-squat', name: 'Box Squat', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'good-morning', name: 'Good Morning', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'stiff-leg-deadlift', name: 'Stiff-Leg Deadlift', muscle: 'Legs', equipment: 'Barbell' },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', muscle: 'Legs', equipment: 'Dumbbell' },
  { id: 'goblet-squat', name: 'Goblet Squat', muscle: 'Legs', equipment: 'Dumbbell' },
  { id: 'walking-lunge', name: 'Walking Lunge', muscle: 'Legs', equipment: 'Dumbbell' },
  { id: 'step-up', name: 'Step-Up', muscle: 'Legs', equipment: 'Dumbbell' },
  { id: 'db-rdl', name: 'Dumbbell Romanian Deadlift', muscle: 'Legs', equipment: 'Dumbbell' },
  { id: 'seated-leg-curl', name: 'Seated Leg Curl', muscle: 'Legs', equipment: 'Machine' },
  { id: 'lying-leg-curl', name: 'Lying Leg Curl', muscle: 'Legs', equipment: 'Machine' },
  { id: 'standing-calf-raise', name: 'Standing Calf Raise', muscle: 'Legs', equipment: 'Machine' },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise', muscle: 'Legs', equipment: 'Machine' },
  { id: 'hip-abduction', name: 'Hip Abduction Machine', muscle: 'Legs', equipment: 'Machine' },
  { id: 'hip-adduction', name: 'Hip Adduction Machine', muscle: 'Legs', equipment: 'Machine' },
  { id: 'glute-kickback', name: 'Cable Glute Kickback', muscle: 'Legs', equipment: 'Cable' },
  { id: 'nordic-curl', name: 'Nordic Hamstring Curl', muscle: 'Legs', equipment: 'Bodyweight' },
  { id: 'pistol-squat', name: 'Pistol Squat', muscle: 'Legs', equipment: 'Bodyweight' },
  { id: 'sissy-squat', name: 'Sissy Squat', muscle: 'Legs', equipment: 'Bodyweight' },

  // Shoulders — more of the room
  { id: 'arnold-press', name: 'Arnold Press', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', muscle: 'Shoulders', equipment: 'Machine' },
  { id: 'smith-overhead-press', name: 'Smith Machine Overhead Press', muscle: 'Shoulders', equipment: 'Machine' },
  { id: 'push-press', name: 'Push Press', muscle: 'Shoulders', equipment: 'Barbell' },
  { id: 'landmine-press', name: 'Landmine Press', muscle: 'Shoulders', equipment: 'Barbell' },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', muscle: 'Shoulders', equipment: 'Cable' },
  { id: 'front-raise', name: 'Front Raise', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'reverse-pec-deck', name: 'Reverse Pec Deck', muscle: 'Shoulders', equipment: 'Machine' },
  { id: 'plate-front-raise', name: 'Plate Front Raise', muscle: 'Shoulders', equipment: 'Barbell' },

  // Arms — more of the room
  { id: 'ez-bar-curl', name: 'EZ-Bar Curl', muscle: 'Arms', equipment: 'Barbell' },
  { id: 'cable-curl', name: 'Cable Curl', muscle: 'Arms', equipment: 'Cable' },
  { id: 'incline-db-curl', name: 'Incline Dumbbell Curl', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'concentration-curl', name: 'Concentration Curl', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'spider-curl', name: 'Spider Curl', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'reverse-curl', name: 'Reverse Curl', muscle: 'Arms', equipment: 'Barbell' },
  { id: 'wrist-curl', name: 'Wrist Curl', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'machine-curl', name: 'Machine Biceps Curl', muscle: 'Arms', equipment: 'Machine' },
  { id: 'rope-pushdown', name: 'Rope Pushdown', muscle: 'Arms', equipment: 'Cable' },
  { id: 'overhead-rope-extension', name: 'Overhead Rope Extension', muscle: 'Arms', equipment: 'Cable' },
  { id: 'db-overhead-extension', name: 'Dumbbell Overhead Extension', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'close-grip-bench', name: 'Close-Grip Bench Press', muscle: 'Arms', equipment: 'Barbell' },
  { id: 'triceps-kickback', name: 'Triceps Kickback', muscle: 'Arms', equipment: 'Dumbbell' },
  { id: 'bench-dip', name: 'Bench Dip', muscle: 'Arms', equipment: 'Bodyweight' },
  { id: 'machine-triceps-extension', name: 'Machine Triceps Extension', muscle: 'Arms', equipment: 'Machine' },
  { id: 'close-grip-push-up', name: 'Close-Grip Push-Up', muscle: 'Arms', equipment: 'Bodyweight' },

  // Core — more of the room
  { id: 'cable-crunch', name: 'Cable Crunch', muscle: 'Core', equipment: 'Cable' },
  { id: 'ab-wheel', name: 'Ab Wheel Rollout', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'sit-up', name: 'Sit-Up', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'decline-sit-up', name: 'Decline Sit-Up', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'bicycle-crunch', name: 'Bicycle Crunch', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'side-plank', name: 'Side Plank', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'mountain-climber', name: 'Mountain Climber', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'dead-bug', name: 'Dead Bug', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'hollow-hold', name: 'Hollow Hold', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'v-up', name: 'V-Up', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'toes-to-bar', name: 'Toes to Bar', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'pallof-press', name: 'Pallof Press', muscle: 'Core', equipment: 'Cable' },
  { id: 'captains-chair-raise', name: 'Captains Chair Leg Raise', muscle: 'Core', equipment: 'Machine' },

  // Cardio — more of the room
  { id: 'elliptical', name: 'Elliptical', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'stair-climber', name: 'Stair Climber', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'assault-bike', name: 'Assault Bike', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'ski-erg', name: 'Ski Erg', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'incline-walk', name: 'Incline Walk', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'walking', name: 'Walking', muscle: 'Cardio', equipment: 'Bodyweight' },
  { id: 'running', name: 'Running', muscle: 'Cardio', equipment: 'Bodyweight' },
  { id: 'swimming', name: 'Swimming', muscle: 'Cardio', equipment: 'Bodyweight' },
  { id: 'burpee', name: 'Burpee', muscle: 'Cardio', equipment: 'Bodyweight' },
  { id: 'sled-push', name: 'Sled Push', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'battle-ropes', name: 'Battle Ropes', muscle: 'Cardio', equipment: 'Machine' },
  { id: 'box-jump', name: 'Box Jump', muscle: 'Cardio', equipment: 'Bodyweight' },
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
