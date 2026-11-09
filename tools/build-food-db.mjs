/* Builds js/data/foods-usda.json — the offline half of the food search —
   from the USDA FoodData Central "SR Legacy" download (public domain, CC0):
   about 7,800 generic foods with their macros per 100 g and their real
   portions ("1 cup, chopped = 160 g", "1 large = 50 g").

     curl -O https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
     unzip FoodData_Central_sr_legacy_food_csv_2018-04.zip
     node tools/build-food-db.mjs FoodData_Central_sr_legacy_food_csv_2018-04

   The output is committed; the app never talks to USDA. Packaged products
   come from Open Food Facts online instead (see js/food-search.js). */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-food-db.mjs <extracted SR Legacy csv folder>'); process.exit(1); }

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const rows = (file) => readFileSync(join(dir, file), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(parseLine);

// not for this app: baby food, the American Indian/Alaska Native table,
// branded products (Open Food Facts does those better), lab materials
const SKIP_CAT = new Set(['3', '24', '26', '27']);
const CATS = Object.fromEntries(rows('food_category.csv').map(([id, , d]) => [id, d]));
const foods = new Map();
for (const [id, , name, cat] of rows('food.csv')) {
  if (SKIP_CAT.has(cat)) continue;
  // "(Includes foods for USDA's Food Distribution Program)" says nothing to an eater
  const clean = name.replace(/\s*\((?:Includes|includes)[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  foods.set(id, { name: clean, cat: CATS[cat] || '', n: {}, portions: [] });
}

const WANT = { 1008: 'kcal', 1003: 'p', 1005: 'c', 1004: 'f', 1079: 'fib', 2000: 'sug' };
const rl = createInterface({ input: createReadStream(join(dir, 'food_nutrient.csv')), crlfDelay: Infinity });
let first = true;
for await (const line of rl) {
  if (first) { first = false; continue; }
  const [, fdc, nid, amount] = parseLine(line);
  const key = WANT[nid];
  if (!key) continue;
  const f = foods.get(fdc);
  if (f) f.n[key] = Number(amount);
}

const UNITS = Object.fromEntries(rows('measure_unit.csv').map(([id, name]) => [id, name]));
for (const [, fdc, , amount, unitId, desc, modifier, grams] of rows('food_portion.csv')) {
  const f = foods.get(fdc);
  const g = Number(grams);
  if (!f || !(g > 0)) continue;
  const unit = UNITS[unitId] && UNITS[unitId] !== 'undetermined' ? UNITS[unitId] : '';
  const words = [unit, desc, modifier].map((x) => String(x || '').trim()).filter(Boolean).join(', ').replace(/^, /, '');
  const amt = Number(amount) || 1;
  const label = (amt === 1 ? '1' : String(Math.round(amt * 100) / 100)) + ' ' + (words || 'serving');
  if (label.length > 48 || f.portions.some((p) => p[0] === label)) continue;
  f.portions.push([label, Math.round(g * 10) / 10]);
}

const r1 = (v) => (v == null || !Number.isFinite(v) ? 0 : Math.round(v * 10) / 10);
const out = [];
for (const f of foods.values()) {
  if (f.n.kcal == null) continue;
  // [name, category, kcal, protein, carbs, fat, fibre, sugar, portions] per 100 g
  out.push([f.name, f.cat, Math.round(f.n.kcal), r1(f.n.p), r1(f.n.c), r1(f.n.f), r1(f.n.fib), r1(f.n.sug), f.portions.slice(0, 6)]);
}
out.sort((a, b) => a[0].localeCompare(b[0]));
const json = JSON.stringify({ v: 1, source: 'USDA FoodData Central, SR Legacy (2018-04), public domain', per: '100 g', foods: out });
writeFileSync(new URL('../js/data/foods-usda.json', import.meta.url), json);
console.log(out.length + ' foods, ' + Math.round(json.length / 1024) + ' KB');
