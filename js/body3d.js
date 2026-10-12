/* B.E.L.A — the 3D body: the PC app's holographic figure, on the phone.

   The model is models/anatomy.glb (Z-Anatomy / BodyParts3D, CC BY-SA 4.0 —
   its credit line stays on screen wherever the figure is drawn). three.js is
   loaded the first time a body is shown, from js/vendor/three-body.js, so
   the app opens no slower for it.

   The look is one shader for every muscle, additive and rim-lit, with
   scanlines, a flicker, a slow breath for what is due and, now and then, a
   thin band that slips sideways. An additive hologram looks the same from
   the front and the back — the far side glows through — so an invisible copy
   of the body is drawn first, depth only, and hides it. That is what makes
   "back" show the back.

   Drag turns the figure itself (never the camera) and it keeps turning a
   little after you let go; left alone it sways. Front and Back snap to the
   nearest turn of that face, so it never spins the long way round. Only
   muscles the app counts answer a tap; bone, tendon and the rest are
   context.

   The view is rebuilt from a string on every action, so each figure is kept
   by a key and its canvas is moved into the fresh markup: the turn you left
   it at survives a habit tick. */
(function () {
  'use strict';

  const CREDIT = 'model: z-anatomy · bodyparts3d, cc by-sa 4.0';

  /* state → colour, intensity, base light, pulse. Exactly the desktop's. */
  const STATES = {
    rest:     ['#8a8f9b', 0.95, 0.40, 0],
    faint:    ['#9a9fab', 1.05, 0.46, 0],
    mid:      ['#c4c7cc', 1.10, 0.55, 0],
    bright:   ['#f9fbfb', 1.30, 0.72, 0],
    due:      ['#8fd6a8', 1.25, 0.62, 1],
    hover:    ['#ffffff', 1.70, 0.90, 0],
    selected: ['#b6f0c8', 1.90, 1.00, 1],
  };
  /* the app's levels (see weekLevel / sessionLevel) onto those states */
  const LEVEL_STATE = { l0: 'rest', l1: 'faint', l2: 'mid', l3: 'bright', l4: 'due' };

  /* The model's muscle groups onto the muscles the app counts. A group not
     listed here (neck, serratus, hip flexors, sartorius, lower legs) is
     drawn but is context: it does not answer the pointer. */
  const GROUP_KEY = {
    Chest: 'chest', Biceps: 'biceps', 'Upper arms': 'biceps', Triceps: 'triceps', Forearms: 'forearms',
    Abdominals: 'abs', Obliques: 'obliques', Trapezius: 'traps', Lats: 'lats', 'Teres major': 'lats',
    'Upper back': 'upper-back', 'Rotator cuff': 'upper-back', 'Lower back': 'lower-back',
    'Spinal extensors': 'lower-back', Glutes: 'glutes', 'Hip rotators': 'glutes', Quadriceps: 'quads',
    Hamstrings: 'hamstrings', Adductors: 'adductors', Calves: 'calves',
  };
  const DELT_KEY = { deltoid_anterior: 'front-delt', deltoid_lateral: 'side-delt', deltoid_posterior: 'rear-delt' };
  const keyOf = (d) => (d && (DELT_KEY[d.key] || GROUP_KEY[d.group])) || null;

  const VERT = `
    uniform float uGlitch;
    uniform float uBand;
    varying vec3 vN;
    varying vec3 vV;
    varying float vY;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      if (uGlitch > 0.0 && abs(wp.y - uBand) < 0.045) wp.x += uGlitch * 0.035;
      vN = normalize(mat3(modelMatrix) * normal);
      vV = cameraPosition - wp.xyz;
      vY = wp.y;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const FRAG = `
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uBase;
    uniform float uPulse;
    uniform float uTime;
    uniform float uScale;
    varying vec3 vN;
    varying vec3 vV;
    varying float vY;
    void main() {
      float fres  = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
      float scan  = 0.84 + 0.16 * sin(vY * uScale - uTime * 3.2);
      float flick = 0.94 + 0.06 * sin(uTime * 31.0);
      float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 3.0);
      float k     = (fres * 1.5 + uBase) * scan * flick * pulse * uIntensity;
      gl_FragColor = vec4(uColor * k, clamp(k, 0.0, 1.0));
    }`;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hex3 = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  /* ---- loading: the library, then the model, each once ---- */
  let version = '';
  let libP = null, modelP = null, model = null;
  function loadLib() {
    if (window.BelaTHREE) return Promise.resolve(window.BelaTHREE);
    if (!libP) libP = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/three-body.js' + (version ? '?v=' + version : '');
      s.onload = () => (window.BelaTHREE ? ok(window.BelaTHREE) : no(new Error('three.js did not load')));
      s.onerror = () => { libP = null; no(new Error('three.js did not load')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function loadModel() {
    if (!modelP) modelP = loadLib().then((T) => new T.GLTFLoader()
      .loadAsync('models/anatomy.glb' + (version ? '?v=' + version : ''))
      .then((gltf) => {
        /* The model's units are its own: measure it, make it two units
           tall, stand it in the middle. */
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(root);
        const size = box.getSize(new T.Vector3());
        const centre = box.getCenter(new T.Vector3());
        const s = 2 / size.y;
        root.scale.setScalar(s);
        root.position.set(-centre.x * s, -centre.y * s, -centre.z * s);
        root.updateMatrixWorld(true);
        model = { T, root };
        return model;
      })).catch((e) => { modelP = null; throw e; });
    return modelP;
  }

  let glOK = null;
  function supported() {
    if (glOK != null) return glOK;
    try {
      const c = document.createElement('canvas');
      glOK = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { glOK = false; }
    return glOK;
  }

  /* ---- one figure ---- */
  const figures = new Map();

  function createFigure() {
    const { T, root } = model;
    const canvas = document.createElement('canvas');
    canvas.className = 'mm3d-canvas';
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(26, 1, 0.1, 50);
    camera.position.set(0, 0, 1.1 / Math.tan((26 / 2) * Math.PI / 180));
    camera.lookAt(0, 0, 0);
    const pivot = new T.Group();
    scene.add(pivot);

    // uTime and the glitch are one set of uniforms shared by every material
    const shared = { uTime: { value: 0 }, uScale: { value: 110 }, uGlitch: { value: 0 }, uBand: { value: 0 } };
    const mats = {};
    for (const [name, [c, i, b, p]] of Object.entries(STATES)) {
      const rgb = hex3(c);
      mats[name] = new T.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          ...shared,
          uColor: { value: new T.Vector3(rgb[0], rgb[1], rgb[2]) },
          uIntensity: { value: i }, uBase: { value: b }, uPulse: { value: p },
        },
        transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      });
    }

    // the occluder: the same body, depth only, drawn first
    const occMat = new T.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const occ = root.clone(true);
    occ.traverse((o) => {
      if (!o.isMesh) return;
      o.material = occMat;
      o.renderOrder = -1;
      o.raycast = () => {};
    });
    pivot.add(occ);

    const holo = root.clone(true);
    const meshes = [], byKey = new Map();
    holo.traverse((o) => {
      if (!o.isMesh) return;
      const d = o.userData || {};
      const kind = d.contextType;                     // bone, connective, muscle (head/hands/feet)
      o.userData = { ...d, app: keyOf(d) };
      // bone and tendon never take the pointer; other muscle still blocks a
      // tap from reaching what is behind it
      if (kind === 'bone' || kind === 'connective') o.raycast = () => {};
      o.material = mats.rest;
      meshes.push(o);
      if (o.userData.app) {
        if (!byKey.has(o.userData.app)) byKey.set(o.userData.app, []);
        byKey.get(o.userData.app).push(o);
      }
    });
    pivot.add(holo);

    const f = {
      canvas, renderer, scene, camera, pivot, shared, mats, meshes, byKey,
      levels: {}, hover: null, selected: null,
      rot: 0, vel: 0, target: null, anchor: 0, swayT: 0, idleAt: 0, lastTouch: performance.now(),
      glitchNext: performance.now() + 2500, glitchEnd: 0,
      raf: 0, last: 0, visible: true, host: null, opts: {}, ray: new T.Raycaster(), ndc: new T.Vector2(),
    };
    wirePointer(f);
    return f;
  }

  function paint(f) {
    for (const m of f.meshes) {
      const k = m.userData.app;
      const st = k && k === f.selected ? 'selected' : k && k === f.hover ? 'hover' : LEVEL_STATE[(k && f.levels[k]) || 'l0'] || 'rest';
      m.material = f.mats[st];
    }
    kick(f);
  }

  function resize(f) {
    const w = f.host ? f.host.clientWidth : 0, h = f.host ? f.host.clientHeight : 0;
    if (!w || !h) return;
    f.renderer.setSize(w, h, false);
    f.camera.aspect = w / h;
    // a narrow box: step back so the shoulders still fit
    const dist = 1.1 / Math.tan((26 / 2) * Math.PI / 180);
    f.camera.position.z = dist * Math.max(1, 0.62 / f.camera.aspect);
    f.camera.updateProjectionMatrix();
    kick(f);
  }

  /* ---- motion ---- */
  const TAU = Math.PI * 2;
  function step(f, now) {
    const dt = Math.min(0.05, (now - (f.last || now)) / 1000);
    f.last = now;
    const calm = reduced();
    if (!calm) f.shared.uTime.value += dt;

    if (f.dragging) {
      // the finger owns it
    } else if (f.target != null) {
      const d = f.target - f.rot;
      f.rot += d * Math.min(1, dt * 9);
      if (Math.abs(d) < 0.002) { f.rot = f.target; f.target = null; f.anchor = f.rot; f.swayT = 0; }
    } else if (Math.abs(f.vel) > 0.0004 && !calm) {
      f.rot += f.vel * dt * 60;
      f.vel *= Math.pow(0.93, dt * 60);
      f.anchor = f.rot; f.swayT = 0;
    } else if (!calm && now - f.lastTouch > 2500) {
      // left alone: a slow sway about where it was left
      f.vel = 0;
      f.swayT += dt;
      f.rot = f.anchor + Math.sin(f.swayT * 0.55) * 0.2 * Math.min(1, f.swayT / 2);
    }
    f.pivot.rotation.y = f.rot;

    // now and then a thin band of the figure slips sideways
    if (!calm) {
      if (now > f.glitchNext) {
        f.shared.uBand.value = -0.9 + Math.random() * 1.8;
        f.shared.uGlitch.value = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8);
        f.glitchEnd = now + 90 + Math.random() * 110;
        f.glitchNext = now + 3200 + Math.random() * 4800;
      } else if (now > f.glitchEnd) f.shared.uGlitch.value = 0;
    }
    f.renderer.render(f.scene, f.camera);
  }

  function loop(f) {
    if (f.raf) return;
    const tick = (now) => {
      f.raf = 0;
      if (!f.canvas.isConnected || document.hidden || !f.visible) { f.last = 0; return; }
      step(f, now);
      // reduced motion: draw only when something moved
      if (reduced() && !f.dragging && f.target == null) return;
      f.raf = requestAnimationFrame(tick);
    };
    f.raf = requestAnimationFrame(tick);
  }
  function kick(f) { loop(f); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) figures.forEach(kick); });

  function face(f, which) {
    const base = which === 'back' ? Math.PI : 0;
    // the nearest turn of that face, never the long way round
    f.target = base + Math.round((f.rot - base) / TAU) * TAU;
    f.vel = 0;
    f.lastTouch = performance.now();
    kick(f);
  }

  /* ---- the pointer: drag to turn, tap to pick, hover to name ---- */
  function pick(f, x, y) {
    const r = f.canvas.getBoundingClientRect();
    f.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    f.ray.setFromCamera(f.ndc, f.camera);
    const hit = f.ray.intersectObjects(f.meshes, false)[0];
    return hit && hit.object.userData.app ? hit.object : null;
  }

  function wirePointer(f) {
    const c = f.canvas;
    let down = null, hoverT = 0;
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), rot: f.rot, id: e.pointerId, lx: e.clientX, lt: performance.now() };
      f.vel = 0; f.target = null;
      f.lastTouch = performance.now();
    });
    c.addEventListener('pointermove', (e) => {
      if (down && down.id === e.pointerId) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!f.dragging && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
          f.dragging = true;
          try { c.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
        }
        if (f.dragging) {
          const now = performance.now();
          f.rot = down.rot + dx * 0.012;
          const dtf = Math.max(1, (now - down.lt) / (1000 / 60));
          f.vel = ((e.clientX - down.lx) * 0.012) / dtf;
          down.lx = e.clientX; down.lt = now;
          f.lastTouch = now;
          f.opts.onTurn && f.opts.onTurn();
          kick(f);
        }
        return;
      }
      // a mouse over the figure names the muscle under it
      if (e.pointerType !== 'mouse') return;
      const now = performance.now();
      if (now - hoverT < 60) return;
      hoverT = now;
      const m = pick(f, e.clientX, e.clientY);
      const k = m ? m.userData.app : null;
      c.style.cursor = k ? 'pointer' : 'grab';
      if (k !== f.hover) { f.hover = k; paint(f); }
      f.opts.onHover && f.opts.onHover(m ? m.userData.label || null : null, k, e);
    });
    const up = (e) => {
      if (!down || down.id !== e.pointerId) return;
      const wasDrag = f.dragging;
      f.dragging = false;
      f.lastTouch = performance.now();
      if (!wasDrag && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
        const m = pick(f, e.clientX, e.clientY);
        const k = m ? m.userData.app : null;
        f.selected = k && k !== f.selected ? k : null;
        paint(f);
        f.opts.onPick && f.opts.onPick(f.selected, m ? m.userData.label : null);
      }
      // a slow release does not fling
      if (performance.now() - down.lt > 80) f.vel = 0;
      down = null;
      kick(f);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && f.hover) { f.hover = null; paint(f); f.opts.onHover && f.opts.onHover(null, null, e); }
    });
  }

  /* ---- the public part ---- */

  /* Put a figure into `host` (an element in the freshly rendered view).
     opts: key (which figure — kept across renders), levels (muscle → 'l0'…'l4'),
     onPick(key, label), onHover(label, key, event), onTurn().
     Resolves with a handle, or rejects if this device cannot draw it — the
     caller keeps its flat map then. */
  function mount(host, opts) {
    if (!supported()) return Promise.reject(new Error('no WebGL'));
    return loadModel().then(() => {
      if (!host.isConnected) throw new Error('gone');
      let f = figures.get(opts.key);
      if (!f) { f = createFigure(); figures.set(opts.key, f); }
      f.opts = opts;
      f.levels = opts.levels || {};
      f.selected = null; f.hover = null;
      if (f.host !== host) {
        if (f.ro) f.ro.disconnect();
        if (f.io) f.io.disconnect();
        f.host = host;
        host.appendChild(f.canvas);
        f.ro = new ResizeObserver(() => resize(f));
        f.ro.observe(host);
        f.io = new IntersectionObserver((es) => { f.visible = es[es.length - 1].isIntersecting; if (f.visible) kick(f); });
        f.io.observe(host);
      }
      resize(f);
      paint(f);
      return {
        face: (which) => face(f, which),
        select: (k) => { f.selected = k || null; paint(f); },
        get rotation() { return f.rot; },
        canvas: f.canvas,
      };
    });
  }

  window.BelaBody3D = {
    CREDIT,
    supported,
    mount,
    preload: () => (supported() ? loadModel().then(() => true, () => false) : Promise.resolve(false)),
    setVersion: (v) => { version = v; },
    // for tests: where a figure is turned to, and what is picked
    inspect: (key) => { const f = figures.get(key); return f ? { rot: f.rot, target: f.target, selected: f.selected } : null; },
    // for tests: which muscle keys the model answers for
    keys: () => (model ? [...new Set((() => { const s = []; model.root.traverse((o) => { const k = o.isMesh && keyOf(o.userData); if (k) s.push(k); }); return s; })())] : []),
  };
})();
