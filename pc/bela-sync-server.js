/* ============================================================
   B.E.L.A — the PC half of sync
   Drop this into your Electron app. No dependencies, no framework;
   it is the http module and js/sync.js, which is the same merge the
   phone runs, so the two copies always agree on the answer.

     const { startBelaSync } = require('./bela-sync-server');

     const sync = startBelaSync({
       load: () => JSON.parse(fs.readFileSync(FILE, 'utf8')),
       save: (doc) => fs.writeFileSync(FILE, JSON.stringify(doc)),
       name: 'Rimvydas PC',
     });

     console.log(sync.address, sync.code);   // show these on your sync screen

   Then type that address and code into the phone: Settings → Sync with the
   PC app. Call sync.stop() when the window closes.
   ============================================================ */
'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const Sync = require(path.join(__dirname, 'sync.js'));

const DEFAULT_PORT = 8765;
const MAX_BODY = 32 * 1024 * 1024;      // a very long history is still only a few MB

/* The address to show on screen: the machine's own place on the LAN, not
   127.0.0.1, which means nothing to the phone. */
function lanAddress() {
  const nets = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      found.push(net.address);
    }
  }
  // a 192.168.x / 10.x address is the one a phone on the same Wi-Fi can reach
  const home = found.find((a) => /^192\.168\./.test(a)) || found.find((a) => /^10\./.test(a));
  return home || found[0] || '127.0.0.1';
}

const sixDigits = () => String(Math.floor(Math.random() * 900000) + 100000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {object} opts
 * @param {() => object} opts.load      read the PC's document
 * @param {(doc: object) => void} opts.save   write it back
 * @param {number} [opts.port]          8765 by default
 * @param {string} [opts.code]          pairing code; one is made up if you leave it out
 * @param {string} [opts.name]          what the phone calls this machine
 * @param {(info: object) => void} [opts.onSync]   called after each successful sync
 */
function startBelaSync(opts) {
  if (!opts || typeof opts.load !== 'function' || typeof opts.save !== 'function') {
    throw new Error('startBelaSync needs a load() and a save()');
  }
  const port = opts.port || DEFAULT_PORT;
  const code = String(opts.code || sixDigits());
  const name = opts.name || os.hostname();

  const send = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      /* The phone's page is served from inside the app, so it is a different
         origin to this server and needs saying so out loud. */
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-bela-code',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'no-store',
    });
    res.end(text);
  };

  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];

    if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

    if (url === '/bela/ping' && req.method === 'GET') {
      send(res, 200, { app: 'bela', protocol: Sync.PROTOCOL, name });
      return;
    }

    if (url === '/bela/sync' && req.method === 'POST') {
      if (String(req.headers['x-bela-code'] || '') !== code) {
        send(res, 403, { error: 'The pairing code does not match' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (e) {
        send(res, 400, { error: 'Could not read that' });
        return;
      }
      if (!payload || !payload.doc) { send(res, 400, { error: 'No document' }); return; }
      if (payload.protocol !== Sync.PROTOCOL) {
        send(res, 409, { error: 'One of the two is out of date (protocol ' + payload.protocol + ' vs ' + Sync.PROTOCOL + ')' });
        return;
      }

      let mine;
      try { mine = opts.load() || {}; } catch (e) { mine = {}; }
      let result;
      try {
        result = Sync.merge(mine, payload.doc, Date.now());
      } catch (e) {
        send(res, 500, { error: 'The merge failed: ' + e.message });
        return;
      }
      try { opts.save(result.doc); } catch (e) {
        send(res, 500, { error: 'Could not save on the PC: ' + e.message });
        return;
      }
      if (opts.onSync) {
        try { opts.onSync({ device: payload.device, tally: result.tally, summary: Sync.summary(result.doc) }); }
        catch (e) { /* the app's own listener, not our problem */ }
      }
      send(res, 200, { protocol: Sync.PROTOCOL, doc: result.doc, tally: result.tally });
      return;
    }

    send(res, 404, { error: 'Not here' });
  });

  server.on('error', (err) => {
    if (opts.onError) opts.onError(err);
    else console.error('[bela-sync]', err.message);
  });
  server.listen(port, '0.0.0.0');

  return {
    code,
    name,
    port,
    get address() { return lanAddress() + ':' + port; },
    get host() { return lanAddress(); },
    stop: () => new Promise((done) => server.close(done)),
    server,
  };
}

module.exports = { startBelaSync, lanAddress, DEFAULT_PORT, PROTOCOL: Sync.PROTOCOL };
