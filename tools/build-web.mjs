/* Assembles dist/ — the files the app actually needs, nothing else.
   The PWA is served straight from the repo root; the native shell wants a
   folder it can copy into the APK, so this is the one place that lists what
   the app is made of. */
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const dist = new URL('dist/', ROOT);
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['css', 'js', 'icons'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const f of FILES) await cp(new URL(f, ROOT), new URL(f, dist));
for (const d of DIRS) await cp(new URL(d + '/', ROOT), new URL(d + '/', dist), { recursive: true });

/* Inside the APK the pages are served from the app itself, so the service
   worker has nothing to cache-bust and only gets in the way of updates. */
const indexUrl = new URL('index.html', dist);
let html = await readFile(indexUrl, 'utf8');
html = html.replace(/<script>\s*if \('serviceWorker' in navigator[\s\S]*?<\/script>/, (m) =>
  '<script>\n    // the native build ships its own files; no service worker needed\n    if (!window.Capacitor) {' + m.replace(/^<script>|<\/script>$/g, '') + '}\n  </script>');
await writeFile(indexUrl, html);

/* The PC app gets its own copy of the merge, because it is shipped as a folder
   you drop into an Electron project. Keeping it copied here means it can never
   be an older version than the phone's. */
await cp(new URL('js/sync.js', ROOT), new URL('pc/sync.js', ROOT));

const version = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8')).version;

/* One version to bump, not two: the Android shell takes its name and code
   from package.json. 12.2.0 becomes code 120200, which only ever goes up. */
const gradleUrl = new URL('android/app/build.gradle', ROOT);
if (existsSync(gradleUrl)) {
  const [maj, min, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
  const code = maj * 10000 + min * 100 + patch;
  let gradle = await readFile(gradleUrl, 'utf8');
  gradle = gradle
    .replace(/versionCode \d+/, 'versionCode ' + code)
    .replace(/versionName "[^"]*"/, 'versionName "' + version + '"');
  await writeFile(gradleUrl, gradle);
}

console.log('dist/ built for v' + version + (existsSync(new URL('android/', ROOT)) ? ' — run `npx cap sync android` next' : ''));
