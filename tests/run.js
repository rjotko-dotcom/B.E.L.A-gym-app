#!/usr/bin/env node
/* Runs every *.test.js in this folder against a local copy of the app.
   Usage: node tests/run.js [name…]   (e.g. node tests/run.js logger habits) */
const fs = require('fs');
const path = require('path');
const { serve, playwright } = require('./lib/harness');

const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();

(async () => {
  if (!files.length) { console.error('No matching tests.'); process.exit(1); }
  // CHROMIUM_PATH lets a sandbox point at a browser Playwright did not download
  const browser = await playwright().launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let passed = 0, failed = 0;
  const failures = [];

  for (const file of files) {
    const name = file.replace('.test.js', '');
    const suite = require(path.join(__dirname, file));
    const checks = [];
    const t = {
      browser,
      serve,
      check(label, condition, detail) {
        checks.push({ label, ok: !!condition, detail });
      },
      equal(label, actual, expected) {
        checks.push({ label, ok: actual === expected, detail: 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) });
      },
      near(label, actual, expected, tolerance) {
        const ok = Math.abs(actual - expected) <= tolerance;
        checks.push({ label, ok, detail: 'expected ~' + expected + ' (±' + tolerance + '), got ' + actual });
      },
    };
    process.stdout.write('\n' + name + '\n');
    try {
      await suite(t);
    } catch (err) {
      checks.push({ label: 'suite threw', ok: false, detail: String(err && err.message || err) });
    }
    for (const c of checks) {
      if (c.ok) { passed++; console.log('  ✓ ' + c.label); }
      else {
        failed++;
        failures.push(name + ' › ' + c.label + (c.detail ? '  (' + c.detail + ')' : ''));
        console.log('  ✗ ' + c.label + (c.detail ? '  (' + c.detail + ')' : ''));
      }
    }
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
