#!/usr/bin/env node
/* ============================================================
   B.E.L.A sync — the PC end, on its own.

     node bela-sync.js

   That is the whole thing. It prints an address and a six-digit code; you
   type those into the phone once (Settings → Sync with the PC app) and from
   then on the two keep the same workouts, meals, habits and bodyweight.

   Everything lives in one file next to this script:

     bela.json        your data — the same shape as Settings → Save backup
     bela-code.txt    the pairing code, so it stays the same between runs

   Nothing goes to the internet. The phone talks straight to this machine over
   your own Wi-Fi, and there is no server anywhere else.

   Options:
     --dir <folder>   keep bela.json somewhere else
     --port <n>       listen on a different port (8765 by default)
     --code <n>       force a particular pairing code

   If you would rather have this inside your Electron app than as a separate
   window, see README.md — it is the same two files, wired in differently.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { startBelaSync, lanAddress, DEFAULT_PORT } = require('./bela-sync-server.js');
const Sync = require('./sync.js');

/* ---------- what was asked for ---------- */

function flag(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DIR = path.resolve(flag('dir', __dirname));
const PORT = Number(flag('port', DEFAULT_PORT)) || DEFAULT_PORT;
const FILE = path.join(DIR, 'bela.json');
const CODE_FILE = path.join(DIR, 'bela-code.txt');

fs.mkdirSync(DIR, { recursive: true });

/* ---------- the document ---------- */

/* The shadow is how the file looked the last time we saw it. Comparing against
   it is how an edit made by something else — your Electron app writing to the
   same bela.json — gets noticed and stamped, so the PC can win a conflict
   instead of always losing to the phone. */
let shadow = null;

function readDoc() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('\n  ' + path.basename(FILE) + ' could not be read: ' + e.message);
      console.error('  Move it aside and the next sync will start a fresh one.\n');
      process.exit(1);
    }
    return {};                    // first run: an empty document is fine
  }
}

function writeDoc(doc) {
  // via a temp file, so a crash mid-write cannot leave a half-written history
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, FILE);
}

function load() {
  const doc = readDoc();
  if (shadow) ({ shadow } = Sync.stamp(doc, shadow, Date.now()));
  else shadow = Sync.snapshot(doc);
  return doc;
}

function save(doc) {
  writeDoc(doc);
  shadow = Sync.snapshot(doc);
}

/* ---------- the pairing code ---------- */

/* Invented once and then kept, so you type it into the phone a single time
   rather than every time this starts. */
let code = flag('code', '');
if (!code) {
  try { code = fs.readFileSync(CODE_FILE, 'utf8').trim(); } catch (e) { /* first run */ }
}

/* ---------- go ---------- */

const stamp = () => new Date().toTimeString().slice(0, 5);

const sync = startBelaSync({
  load,
  save,
  port: PORT,
  code: code || undefined,
  name: require('os').hostname(),
  onSync: ({ tally, summary }) => {
    const bits = [];
    if (tally.added) bits.push(tally.added + ' added');
    if (tally.updated) bits.push(tally.updated + ' updated');
    if (tally.removed) bits.push(tally.removed + ' removed');
    console.log('  ' + stamp() + '  synced — ' + (bits.join(', ') || 'nothing had changed') +
      '  ·  now ' + summary.workouts + ' workouts, ' + summary.meals + ' meals');
  },
  onError: (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('\n  Port ' + PORT + ' is already taken — B.E.L.A sync may already be running.');
      console.error('  Close the other one, or start this with --port 8766 and put the');
      console.error('  same port on the phone after the address (192.168.x.x:8766).\n');
    } else {
      console.error('\n  ' + err.message + '\n');
    }
    process.exit(1);
  },
});

try { fs.writeFileSync(CODE_FILE, sync.code); } catch (e) { /* not fatal — it just changes next run */ }

const line = '  ' + '─'.repeat(46);
console.log('');
console.log('  B.E.L.A sync is running');
console.log(line);
console.log('  On the phone:  Settings → Sync with the PC app');
console.log('');
console.log('     PC address    ' + sync.address);
console.log('     Pairing code  ' + sync.code);
console.log('');
console.log(line);
console.log('  Data:  ' + FILE);
if (lanAddress() === '127.0.0.1') {
  console.log('');
  console.log('  No network address found — this machine does not look like it is');
  console.log('  on Wi-Fi or a LAN. The phone will not be able to reach it.');
}
console.log('  Leave this window open. Ctrl+C stops it.');
console.log('');

const bye = () => {
  console.log('\n  Stopped. Your data is in ' + path.basename(FILE) + '.\n');
  Promise.resolve(sync.stop()).then(() => process.exit(0));
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
