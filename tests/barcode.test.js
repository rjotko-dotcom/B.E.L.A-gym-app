/* 16.9, barcode scanning that works: the installed app hands the scan to
   Google's scanner (faked here as the plugin answers), fetching the scanner
   module first when it is missing; the code is looked up in his own foods,
   then Open Food Facts (faked); an unknown product is entered once from its
   label and found by its code after that, offline. The website types the
   code instead. */
const { openApp, readState, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

const DVARO = { status: 1, product: { code: '4770275047548', product_name: 'Kefyras 2.5', brands: 'Dvaro', countries_tags: ['en:lithuania'],
  serving_size: '300 g', serving_quantity: 300, nutriments: { 'energy-kcal_100g': 52, proteins_100g: 3.2, carbohydrates_100g: 4.1, fat_100g: 2.5 } } };

async function installed(t, url, scans) {
  const p = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p.errors = [];
  p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p.errors.push(String(e)); });
  await p.addInitScript(([s, list]) => {
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__bs = { installed: false, installs: 0, scans: list.slice(), formats: null };
    let progress = null;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        BarcodeScanner: {
          isGoogleBarcodeScannerModuleAvailable: async () => ({ available: window.__bs.installed }),
          addListener: async (ev, fn) => { if (ev === 'googleBarcodeScannerModuleInstallProgress') progress = fn; return { remove: () => { progress = null; } }; },
          installGoogleBarcodeScannerModule: async () => {
            window.__bs.installs++;
            setTimeout(() => { if (progress) progress({ state: 2 }); }, 20);
            setTimeout(() => { window.__bs.installed = true; if (progress) progress({ state: 4 }); }, 60);
          },
          scan: async (o) => {
            window.__bs.formats = o && o.formats;
            const next = window.__bs.scans.shift();
            if (next === 'cancel') throw new Error('scan canceled.');
            return { barcodes: [{ rawValue: next, format: 'EAN_13' }] };
          },
        },
        LocalNotifications: { createChannel: async () => {}, checkPermissions: async () => ({ display: 'denied' }) },
        App: { addListener: () => {} },
      },
    };
  }, [build(), scans]);
  await p.goto(url);
  await p.waitForTimeout(500);
  return p;
}
const openLog = async (p) => {
  await p.evaluate(() => document.querySelector('.tab[data-tab="meals"]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#addMeal').click());
  await p.waitForTimeout(500);
};

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });

  // ---- installed: the scanner module is fetched, then the scan finds a product ----
  const p = await installed(t, server.url, ['4770275047548', 'cancel', '4770275047548', '2000000000015', '2000000000015']);
  let offUp = true, offAsked = 0;
  await p.route('**/world.openfoodfacts.org/api/v2/product/**', (r) => {
    offAsked++;
    if (!offUp) return r.abort();
    const known = /4770275047548/.test(r.request().url());
    r.fulfill({ status: known ? 200 : 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(known ? DVARO : { status: 0 }) });
  });
  await openLog(p);
  t.check('the search has a scan button', await p.evaluate(() => !!document.querySelector('#scanBtn')));
  await p.click('#scanBtn');
  await p.waitForTimeout(900);
  const bs = await p.evaluate(() => window.__bs);
  t.equal('a missing scanner module is installed first', bs.installs, 1);
  t.check('Google\'s scanner is asked for food barcodes', JSON.stringify(bs.formats) === JSON.stringify(['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E']));
  const head = await p.textContent('#sheetRoot h3'), per = await p.textContent('#sheetRoot .portion-per');
  t.check('the product opens with its label numbers', /Kefyras 2.5 · Dvaro/.test(head) && /^52 kcal .* per 100 g · Open Food Facts/.test(per), head + ' / ' + per);
  t.equal('and its own serving filled in', await p.inputValue('#pdAmt'), '300');
  await p.click('#pdAdd');
  await p.waitForTimeout(500);
  let st = await readState(p);
  const m = st.nutrition.meals.find((x) => /Kefyras/.test(x.name));
  t.check('logged: 300 g → 156 kcal', m && m.kcal === 156, JSON.stringify(m));
  t.check('and kept with its barcode', (st.foods || []).some((f) => f.code === '4770275047548'));

  // closing the scanner just returns to the meal sheet
  await openLog(p);
  await p.click('#scanBtn');
  await p.waitForTimeout(500);
  t.check('a cancelled scan goes back to logging, quietly', await p.evaluate(() => !!document.querySelector('#sheetRoot #foodSearch')));
  t.equal('the module is not installed twice', await p.evaluate(() => window.__bs.installs), 1);

  // the same product again, offline: found in his own foods
  offUp = false;
  const asked = offAsked;
  await p.click('#scanBtn');
  await p.waitForTimeout(600);
  t.check('scanned again with no connection: found from his foods', /Kefyras/.test(await p.textContent('#sheetRoot h3')) && offAsked === asked);
  await p.evaluate(() => document.querySelector('#sheetRoot [data-close]').click());
  await p.waitForTimeout(400);

  // a product Open Food Facts does not know: the label, once
  offUp = true;
  await openLog(p);
  await p.click('#scanBtn');
  await p.waitForTimeout(700);
  t.check('an unknown product asks for its label', /New product/.test(await p.textContent('#sheetRoot h3')) && /2000000000015/.test(await p.textContent('#sheetRoot')));
  await p.fill('#lbName', 'Pieno baltymų batonėlis');
  await p.fill('#lbKcal', '380'); await p.fill('#lbP', '30'); await p.fill('#lbC', '35'); await p.fill('#lbF', '12');
  await p.fill('#lbServing', '50');
  await p.click('#lbSave');
  await p.waitForTimeout(500);
  t.equal('then logs it at its portion', await p.inputValue('#pdAmt'), '50');
  await p.click('#pdAdd');
  await p.waitForTimeout(400);
  offUp = false;
  await openLog(p);
  await p.click('#scanBtn');
  await p.waitForTimeout(600);
  t.check('next time the scan finds it by its code, offline', /Pieno baltymų batonėlis/.test(await p.textContent('#sheetRoot h3')));
  t.equal('installed: no page errors', p.errors.length, 0, p.errors.join(' | '));
  await p.close();

  // ---- the website: no camera scanner, the code is typed ----
  const web = await openApp(t.browser, { url: server.url, seed: build() });
  await web.route('**/world.openfoodfacts.org/api/v2/product/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(DVARO) }));
  await openLog(web);
  await web.click('#scanBtn');
  await web.waitForTimeout(500);
  t.check('the website offers to type the code', /Barcode/.test(await web.textContent('#sheetRoot h3')) && /installed app scans/.test(await web.textContent('#sheetRoot')));
  await web.fill('#bcCode', '4770 2750 47548');
  await web.click('#bcGo');
  await web.waitForTimeout(700);
  t.check('a typed code finds the product', /Kefyras 2.5 · Dvaro/.test(await web.textContent('#sheetRoot h3')));
  t.equal('web: no page errors', web.errors.length, 0, web.errors.join(' | '));
  await web.close();
  await server.close();
};
