/* ============================================================
   B.E.L.A — food search
   One search over everything there is to eat:
     · his own foods and the built-in common list (js/foods.js)
     · ~7,300 generic foods from USDA FoodData Central, bundled in
       js/data/foods-usda.json (public domain), so they work offline —
       loaded the first time anything is searched
     · packaged products from Open Food Facts (open data, ODbL), asked
       online: one query for products sold in Lithuania, one worldwide by
       popularity, Lithuanian ones first. Only the search words are sent.
   Matching ignores case and diacritics ("varske" finds "Varškė"), every
   word typed must start a word of the name, and the food's own name beats
   a word buried in its description.

   Also the reader for typed meals: "200 g chicken breast, 2 eggs, banana"
   becomes three lines with amounts, matched against the same foods.

   No DOM. Works in the app (window.BelaFoodSearch) and in Node for tests.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BelaFoodSearch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OFF = 'https://world.openfoodfacts.org/cgi/search.pl';
  const OFF_FIELDS = 'code,product_name,product_name_lt,product_name_en,brands,nutriments,serving_size,serving_quantity,countries_tags,quantity';

  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%.]+/g, ' ').trim();
  const words = (s) => fold(s).split(' ').filter(Boolean);

  /* How well a name answers the query, or 0 when it does not. Every query
     word must start some word of the name. The name's head (before the
     first comma, where USDA puts the food itself) counts most; shorter
     names win ties, so "Egg, whole, raw" beats "Egg custard, baked". */
  /* Somebody typing "egg" or "apple" means the food, not egg substitute or
     apple juice: plain states score up, processed forms and the ALL-CAPS
     brand rows USDA carries score down — unless those words were typed. */
  const PLAIN = ['raw', 'fresh', 'whole', 'plain', 'cooked', 'boiled', 'roasted', 'baked', 'grilled', 'lean', 'unsweetened', 'meat'];
  const PROCESSED = ['substitute', 'powder', 'dried', 'dehydrated', 'breaded', 'juice', 'nuggets', 'nugget', 'frozen', 'canned', 'concentrate',
    'sweetened', 'fried', 'flavored', 'flavor', 'with', 'mix', 'sliced', 'deli', 'seasoned', 'prepackaged', 'luncheon', 'imitation', 'formula', 'sauce', 'soup', 'pie', 'babyfood', 'tenders', 'patty', 'noodles', 'roll', 'cake'];
  const PARTS = ['white', 'whites', 'yolk', 'yolks', 'skin', 'peel', 'seeds', 'bran', 'germ'];
  function score(name, qWords) {
    if (!qWords.length) return 1;
    const head = words(String(name).split(',')[0]);
    const all = words(name);
    let s = 0;
    const used = new Set();
    for (let i = 0; i < qWords.length; i++) {
      const q = qWords[i];
      const inHead = head.findIndex((w) => w.startsWith(q));
      if (inHead >= 0) { used.add(head[inHead]); s += 10 + (inHead === 0 ? 4 : 0) + (head[inHead] === q ? 3 : 0); continue; }
      const inAll = all.findIndex((w) => w.startsWith(q));
      if (inAll < 0) return 0;
      used.add(all[inAll]);
      s += 4 + (all[inAll] === q ? 2 : 0);
    }
    const typed = (w) => qWords.some((q) => w.startsWith(q));
    s -= head.filter((w) => !used.has(w)).length * 1.5;               // words in its name nobody asked for
    s += Math.min(4, all.filter((w) => PLAIN.includes(w)).length * 2);
    s -= Math.min(9, all.filter((w) => PROCESSED.includes(w) && !typed(w)).length * 3);
    // a part of the food is not the food: "egg" is the whole egg, not the white
    s -= all.filter((w) => PARTS.includes(w) && !typed(w)).length * 3;
    if (/\b[A-Z]{3,}\b/.test(String(name).replace(/\b(USDA|NFS|NS|USA)\b/g, ''))) s -= 5;
    return s - Math.min(8, all.length * 0.35);
  }

  /* Lithuanian words for the everyday foods, so the offline search (which is
     in English) still answers "vištiena" or "grikiai". Stems, folded. */
  const LT = [
    ['kiausin', 'egg'], ['vistien', 'chicken'], ['krutinel', 'breast'], ['slaunel', 'thigh'], ['sparnel', 'wing'], ['jautien', 'beef'], ['kiaulien', 'pork'], ['kalakutien', 'turkey'],
    ['lasis', 'salmon'], ['lasisa', 'salmon'], ['tunas', 'tuna'], ['tuno', 'tuna'], ['silke', 'herring'], ['menke', 'cod'], ['krevet', 'shrimp'],
    ['ryz', 'rice'], ['grik', 'buckwheat'], ['aviz', 'oats'], ['dribsni', 'flakes'], ['makaron', 'pasta'], ['bulv', 'potato'], ['duon', 'bread'],
    ['varsk', 'cottage cheese'], ['suri', 'cheese'], ['suris', 'cheese'], ['pien', 'milk'], ['kefyr', 'kefir'], ['jogurt', 'yogurt'], ['grietin', 'sour cream'],
    ['sviest', 'butter'], ['aliej', 'oil'], ['alyvuog', 'olive'], ['banan', 'banana'], ['obuol', 'apple'], ['apelsin', 'orange'], ['brask', 'strawberries'],
    ['melyn', 'blueberries'], ['agurk', 'cucumber'], ['pomidor', 'tomato'], ['mork', 'carrot'], ['kopust', 'cabbage'], ['brokol', 'broccoli'],
    ['svogun', 'onion'], ['cesnak', 'garlic'], ['pupel', 'beans'], ['zirn', 'peas'], ['lesi', 'lentils'], ['riesut', 'nuts'], ['migdol', 'almonds'],
    ['zemes riesut', 'peanut'], ['medus', 'honey'], ['cukr', 'sugar'], ['saldainis', 'candy'], ['sokolad', 'chocolate'], ['kava', 'coffee'], ['arbat', 'tea'],
    ['sult', 'juice'], ['vanduo', 'water'], ['virt', 'cooked'], ['kept', 'fried'], ['zali', 'raw'], ['kumpis', 'ham'], ['desr', 'sausage'], ['desrel', 'frankfurter'],
  ];
  function translate(q) {
    const w = words(q);
    let changed = false;
    const out = w.map((x) => {
      const hit = LT.find(([stem]) => x.startsWith(stem));
      if (hit) { changed = true; return hit[1]; }
      return x;
    });
    return changed ? out.join(' ') : null;
  }
  function rank(list, query, limit = 20, nameOf = (f) => f.name) {
    const q = words(query);
    const lt = translate(query);
    const q2 = lt ? words(lt) : null;
    return list.map((f) => {
      const n = nameOf(f) + (f.aka ? ' ' + f.aka : '');
      return { f, s: Math.max(score(n, q), q2 ? score(n, q2) : 0) };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.f);
  }

  /* ---- USDA, offline ---- */
  let usda = null, usdaP = null;
  function fromUsda(r) {
    const portions = (r[8] || []).map(([label, g]) => ({ label, g }));
    return {
      name: r[0], cat: r[1], unit: 'g', per: 100,
      kcal: r[2], protein: r[3], carbs: r[4], fat: r[5], fiber: r[6], sugar: r[7],
      serving: portions.length ? portions[0].g : 100,
      portions, src: 'usda',
    };
  }
  function loadUsda(url, fetchFn) {
    if (usda) return Promise.resolve(usda);
    if (!usdaP) {
      usdaP = (fetchFn || fetch)(url).then((r) => { if (!r.ok) throw new Error('food data ' + r.status); return r.json(); })
        .then((d) => { usda = d.foods.map(fromUsda); return usda; })
        .catch((e) => { usdaP = null; throw e; });
    }
    return usdaP;
  }
  const usdaReady = () => !!usda;
  const searchUsda = (query, limit = 12) => (usda && fold(query).length >= 2 ? rank(usda, query, limit) : []);

  /* ---- Open Food Facts, online ---- */
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function fromOff(p) {
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal == null && num(n.energy_100g) != null) kcal = num(n.energy_100g) / 4.184;
    if (kcal == null) return null;
    const name = String(p.product_name || p.product_name_lt || p.product_name_en || '').trim();
    if (!name) return null;
    const brand = String(p.brands || '').split(',')[0].trim();
    const liquid = /\bml\b|\bl\b|cl\b/i.test(String(p.quantity || '') + ' ' + String(p.serving_size || ''));
    const sq = num(p.serving_quantity);
    const portions = sq && sq > 0 ? [{ label: '1 serving' + (p.serving_size ? ' (' + String(p.serving_size).trim() + ')' : ''), g: Math.round(sq * 10) / 10 }] : [];
    const r1 = (v) => Math.round((num(v) || 0) * 10) / 10;
    return {
      name: brand && !fold(name).includes(fold(brand)) ? name + ' · ' + brand : name,
      brand, code: p.code || '', unit: liquid ? 'ml' : 'g', per: 100,
      kcal: Math.round(kcal), protein: r1(n.proteins_100g), carbs: r1(n.carbohydrates_100g), fat: r1(n.fat_100g),
      fiber: r1(n.fiber_100g), sugar: r1(n.sugars_100g),
      serving: portions.length ? portions[0].g : 100, portions,
      lt: (p.countries_tags || []).includes('en:lithuania'), src: 'off',
    };
  }
  const offCache = new Map();
  async function searchOff(query, opts = {}) {
    const q = String(query || '').trim();
    if (fold(q).length < 3) return [];
    const key = fold(q);
    if (offCache.has(key)) return offCache.get(key);
    const fetchFn = opts.fetch || fetch;
    const base = OFF + '?search_terms=' + encodeURIComponent(q) + '&search_simple=1&action=process&json=1&fields=' + OFF_FIELDS;
    const ask = (extra, size) => fetchFn(base + '&page_size=' + size + extra, { signal: opts.signal })
      .then((r) => (r.ok ? r.json() : { products: [] })).then((d) => d.products || []).catch((e) => { if (e && e.name === 'AbortError') throw e; return []; });
    const [lt, world] = await Promise.all([
      ask('&tagtype_0=countries&tag_contains_0=contains&tag_0=lithuania', 15),
      ask('&sort_by=unique_scans_n', 20),
    ]);
    const seen = new Set();
    const out = [];
    for (const p of [...lt, ...world]) {
      if (!p || (p.code && seen.has(p.code))) continue;
      const f = fromOff(p);
      if (!f) continue;
      if (p.code) seen.add(p.code);
      out.push(f);
    }
    // Lithuanian products first; within each, the better name match
    const qw = words(q);
    out.sort((a, b) => (b.lt - a.lt) || (score(b.name, qw) - score(a.name, qw)));
    const top = out.slice(0, 20);
    offCache.set(key, top);
    return top;
  }

  /* ---- a barcode ----
     One product by its code (EAN-13, EAN-8, UPC). null when Open Food Facts
     does not know it — the app then asks for the label once and keeps it. */
  const PRODUCT = 'https://world.openfoodfacts.org/api/v2/product/';
  const codeCache = new Map();
  const cleanCode = (c) => String(c || '').replace(/\D+/g, '');
  async function lookupOff(code, opts = {}) {
    const c = cleanCode(code);
    if (c.length < 8) return null;
    if (codeCache.has(c)) return codeCache.get(c);
    const res = await (opts.fetch || fetch)(PRODUCT + c + '.json?fields=' + OFF_FIELDS, { signal: opts.signal });
    if (res.status === 404) { codeCache.set(c, null); return null; }
    if (!res.ok) throw new Error('Open Food Facts answered ' + res.status);
    const d = await res.json();
    const f = d && d.status === 1 && d.product ? fromOff({ ...d.product, code: d.product.code || c }) : null;
    codeCache.set(c, f);
    return f;
  }

  /* ---- typed meals ----
     "200 g chicken breast, 2 eggs, banana, ryžiai 150g" → lines of
     { query, amount, unit } where unit is 'g' | 'ml' | 'n' (a count) | null. */
  const UNIT_WORDS = [
    [/^(kg|kilo\w*)$/, 'kg'], [/^(g|gr|gram\w*|gramm?\w*)$/, 'g'], [/^(ml|mililit\w*|millilit\w*)$/, 'ml'],
    [/^(l|lit\w*)$/, 'l'], [/^(x|vnt|pcs?|pieces?|pc|units?|gab\w*)$/, 'n'],
  ];
  function unitOf(w) {
    for (const [re, u] of UNIT_WORDS) if (re.test(fold(w))) return u;
    return null;
  }
  function parseMeal(text) {
    return String(text || '').split(/[,;\n+]|\s+(?:and|ir|su)\s+/i).map((s) => s.trim()).filter(Boolean).map((raw) => {
      let rest = raw, amount = null, unit = null;
      // amount first: "200 g rice", "200g rice", "2 eggs", "1.5 kg …"
      let m = rest.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Ząčęėįšųūž]+\b)?\s*(.*)$/);
      if (m && m[3] !== undefined) {
        const u = m[2] && unitOf(m[2]);
        if (u) { amount = Number(m[1].replace(',', '.')); unit = u; rest = m[3]; }
        else { amount = Number(m[1].replace(',', '.')); unit = 'n'; rest = ((m[2] || '') + ' ' + m[3]).trim(); }
      } else {
        // amount last: "rice 200g", "kiaušiniai 2"
        m = rest.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/);
        if (m) {
          const u = m[3] && unitOf(m[3]);
          if (!m[3] || u) { rest = m[1]; amount = Number(m[2].replace(',', '.')); unit = u || 'n'; }
        }
      }
      if (unit === 'kg') { amount *= 1000; unit = 'g'; }
      if (unit === 'l') { amount *= 1000; unit = 'ml'; }
      rest = rest.replace(/^of\s+/i, '').trim();
      return { raw, query: rest, amount, unit };
    }).filter((x) => x.query);
  }
  /* singular/plural is the most common miss: "eggs" for "Egg", "bananas" */
  function queryVariants(q) {
    const w = words(q);
    const sing = w.map((x) => x.replace(/(ies)$/, 'y').replace(/(es)$/, '').replace(/s$/, ''));
    return [w.join(' '), sing.join(' ')].filter((v, i, a) => v && a.indexOf(v) === i);
  }
  /* his own foods first, then the common list, then the long tail — and
     within each, the word as typed or its singular ("eggs" → Whole egg,
     not USDA's "Eggs, scrambled, frozen mixture") */
  function bestMatch(query, lists) {
    for (const list of lists) {
      for (const v of queryVariants(query)) {
        const hit = rank(list, v, 1)[0];
        if (hit) return hit;
      }
    }
    return null;
  }

  const usdaList = () => usda || [];
  return { cleanCode, lookupOff, fold, score, rank, translate, loadUsda, usdaReady, usdaList, searchUsda, fromUsda, searchOff, fromOff, parseMeal, bestMatch };
}));
