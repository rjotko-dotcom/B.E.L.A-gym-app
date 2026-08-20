/* B.E.L.A Gym — common foods.
   Macros are stored per 100 g / 100 ml, or per piece for things you count
   (eggs, slices, bars), so any portion can be worked out from them.
     unit    'g' | 'ml' | 'piece'
     per     what the numbers below describe (100, or 1 for a piece)
     serving the portion the "+" button logs, in the same unit          */
const FOOD_LIBRARY = [
  { name: 'Chicken breast', unit: 'g', per: 100, serving: 150, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'Beef mince 10% fat', unit: 'g', per: 100, serving: 150, kcal: 176, protein: 20, carbs: 0, fat: 10 },
  { name: 'Salmon', unit: 'g', per: 100, serving: 150, kcal: 208, protein: 20, carbs: 0, fat: 13 },
  { name: 'Tuna, canned in water', unit: 'g', per: 100, serving: 100, kcal: 116, protein: 26, carbs: 0, fat: 1 },
  { name: 'Whole egg', unit: 'piece', per: 1, serving: 2, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  { name: 'Whey protein', unit: 'g', per: 100, serving: 30, kcal: 400, protein: 80, carbs: 8, fat: 5 },
  { name: 'Greek yogurt 0%', unit: 'g', per: 100, serving: 170, kcal: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  { name: 'Cottage cheese', unit: 'g', per: 100, serving: 150, kcal: 98, protein: 11, carbs: 3.4, fat: 4.3 },
  { name: 'Cheddar cheese', unit: 'g', per: 100, serving: 30, kcal: 403, protein: 25, carbs: 1.3, fat: 33 },
  { name: 'Milk 2%', unit: 'ml', per: 100, serving: 250, kcal: 50, protein: 3.4, carbs: 4.8, fat: 2 },
  { name: 'White rice, cooked', unit: 'g', per: 100, serving: 200, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { name: 'Pasta, cooked', unit: 'g', per: 100, serving: 200, kcal: 158, protein: 5.8, carbs: 31, fat: 0.9 },
  { name: 'Potato, boiled', unit: 'g', per: 100, serving: 300, kcal: 87, protein: 2, carbs: 20, fat: 0.1 },
  { name: 'Sweet potato, baked', unit: 'g', per: 100, serving: 200, kcal: 90, protein: 2, carbs: 21, fat: 0.1 },
  { name: 'Oats, dry', unit: 'g', per: 100, serving: 60, kcal: 380, protein: 13, carbs: 67, fat: 7 },
  { name: 'Bread slice', unit: 'piece', per: 1, serving: 2, kcal: 92, protein: 3.2, carbs: 17, fat: 1.1 },
  { name: 'Banana', unit: 'g', per: 100, serving: 120, kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { name: 'Apple', unit: 'g', per: 100, serving: 180, kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 },
  { name: 'Avocado', unit: 'g', per: 100, serving: 100, kcal: 160, protein: 2, carbs: 9, fat: 15 },
  { name: 'Broccoli', unit: 'g', per: 100, serving: 200, kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { name: 'Almonds', unit: 'g', per: 100, serving: 30, kcal: 579, protein: 21, carbs: 22, fat: 50 },
  { name: 'Peanut butter', unit: 'g', per: 100, serving: 30, kcal: 588, protein: 25, carbs: 20, fat: 50 },
  { name: 'Olive oil', unit: 'ml', per: 100, serving: 15, kcal: 884, protein: 0, carbs: 0, fat: 100 },
  { name: 'Butter', unit: 'g', per: 100, serving: 10, kcal: 717, protein: 0.9, carbs: 0.1, fat: 81 },
  { name: 'Protein bar', unit: 'piece', per: 1, serving: 1, kcal: 210, protein: 20, carbs: 22, fat: 7 },
];
