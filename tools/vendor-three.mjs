/* Bundles the parts of three.js the 3D body uses into one file the app can
   load with a plain <script> — no build step for the app itself, and no CDN
   (it has to work offline). Run after changing the three.js version:
     node tools/vendor-three.mjs
   The output, js/vendor/three-body.js, is committed. */
import { build } from 'esbuild';

await build({
  stdin: {
    contents: `
      export {
        WebGLRenderer, Scene, PerspectiveCamera, Group, Box3, Vector3, Vector2, Color,
        ShaderMaterial, MeshBasicMaterial, AdditiveBlending, DoubleSide, Raycaster,
        SRGBColorSpace,
      } from 'three';
      export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
    `,
    resolveDir: new URL('..', import.meta.url).pathname,
    loader: 'js',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'BelaTHREE',
  target: 'es2020',
  legalComments: 'inline',
  outfile: new URL('../js/vendor/three-body.js', import.meta.url).pathname,
  banner: { js: '/* three.js r170 (MIT, https://threejs.org) — WebGLRenderer + GLTFLoader, bundled by tools/vendor-three.mjs */' },
});
console.log('wrote js/vendor/three-body.js');
