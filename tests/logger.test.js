/* The workout logger: set numbering, the type picker, RPE, the rest timer's
   position, and editing a session that was already saved. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  const page = await openApp(t.browser, { url: server.url, seed });
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  const setNums = () => page.evaluate(() =>
    [...document.querySelector('.ex-block').querySelectorAll('.set-num')].map((b) => b.textContent));

  t.check('sets start numbered from one', (await setNums()).join(',').startsWith('1,2,3'));

  // the number opens a picker rather than cycling through types
  await page.click('.ex-block .set-num');
  await page.waitForTimeout(350);
  t.equal('set type picker offers all four types', await page.evaluate(() => document.querySelectorAll('[data-type]').length), 4);
  t.check('the picker can remove the set', await page.evaluate(() => !!document.querySelector('#setDel')));

  await page.click('[data-type="W"]');
  await page.waitForTimeout(400);
  t.equal('a warm-up does not take a set number', (await setNums()).join(','), 'W,1,2,3');

  await page.evaluate(() => document.querySelectorAll('.ex-block .set-num')[2].click());
  await page.waitForTimeout(300);
  await page.click('[data-type="D"]');
  await page.waitForTimeout(400);
  t.equal('a drop set does not take one either', (await setNums()).join(','), 'W,1,D,2');

  // RPE
  await page.click('.ex-block .set-rpe');
  await page.waitForTimeout(350);
  t.equal('RPE offers 6 to 10 in halves', await page.evaluate(() => document.querySelectorAll('[data-rpe]').length), 8);
  await page.click('[data-rpe="9"]');
  await page.waitForTimeout(400);
  t.equal('RPE is stored on the set', (await readState(page)).activeWorkout.exercises[0].sets[0].rpe, 9);

  // removing a set
  const before = (await readState(page)).activeWorkout.exercises[0].sets.length;
  await page.click('.ex-block .set-num');
  await page.waitForTimeout(300);
  await page.click('#setDel');
  await page.waitForTimeout(400);
  t.equal('a set can be removed', (await readState(page)).activeWorkout.exercises[0].sets.length, before - 1);

  // logging a set keeps the page where it was
  await page.fill('.ex-block .in-weight', '80');
  await page.fill('.ex-block .in-reps', '8');
  await page.click('.ex-block .set-done');
  await page.waitForTimeout(600);
  t.check('a logged set is marked', await page.evaluate(() =>
    !!document.querySelector('.set-row.logged, .set-done.logged')));
  t.check('and nothing is left counting down', await page.evaluate(() =>
    !document.querySelector('#restBar, .rest-bar')));

  // progressive overload hint
  const hint = await page.evaluate(() => document.querySelector('.ex-hint')?.textContent || '');
  t.check('an overload hint is offered from last session', /try/.test(hint), hint.trim());

  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('bela-gym-v1')); s.activeWorkout = null; localStorage.setItem('bela-gym-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(500);

  // editing a saved session
  await page.click('#homeAvatar');
  await page.waitForTimeout(400);
  await page.click('#progSeg button[data-seg="history"]');
  await page.waitForTimeout(450);
  await page.click('.hist-item');
  await page.waitForTimeout(350);
  t.check('history offers an edit action', await page.evaluate(() => !!document.querySelector('[data-edit]')));
  const historyBefore = (await readState(page)).workouts;
  await page.click('[data-edit]');
  await page.waitForTimeout(600);
  t.check('the logger says it is editing', /Editing/.test(await page.textContent('.wk-title')));
  await page.fill('.ex-block .in-weight', '92.5');
  await page.click('#wkFinishTop');
  await page.waitForTimeout(450);
  await page.click('#confirmFinish');
  await page.waitForTimeout(700);
  const after = (await readState(page)).workouts;
  t.equal('editing does not add a second session', after.length, historyBefore.length);
  t.equal('the edit is saved in place', after[0].id, historyBefore[0].id);
  t.equal('the changed weight is stored', after[0].exercises[0].sets[0].weight, 92.5);
  t.equal('the original date is kept', after[0].startedAt, historyBefore[0].startedAt);
  t.check('the edit marker is cleaned up', !('editingId' in after[0]));

  // records: a drawn marker, not an emoji, and a distinct buzz
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('bela-gym-v1')); st.activeWorkout = null; localStorage.setItem('bela-gym-v1', JSON.stringify(st)); });
  await page.reload();
  await page.waitForTimeout(500);
  const buzzes = [];
  await page.exposeFunction('__buzz', (v) => buzzes.push(v));
  await page.addInitScript(() => { navigator.vibrate = (v) => { window.__buzz(JSON.stringify(v)); return true; }; });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('#homeStart');
  await page.waitForTimeout(700);
  await page.fill('.ex-block .in-weight', '150');
  await page.fill('.ex-block .in-reps', '8');
  await page.click('.ex-block .set-done');
  await page.waitForTimeout(800);
  t.check('a record buzzes the phone', buzzes.some((b) => JSON.parse(b).length > 1), JSON.stringify(buzzes));
  t.check('the record marker is drawn, not an emoji', await page.evaluate(() => !!document.querySelector('.toast svg') && !/🏆/.test(document.body.innerHTML)));

  // logging a set must not throw the list back to the top
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    const ids = ['bench-press', 'incline-db-press', 'shoulder-press', 'lateral-raise', 'triceps-pushdown'];
    st.activeWorkout = {
      id: 'scroll', name: 'Push day', startedAt: Date.now() - 600000,
      exercises: ids.map((id) => ({ exerciseId: id, sets: [0, 1, 2].map(() => ({ weight: 40, reps: 10, done: false })) })),
    };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelector('.wk-body').scrollTop = 900; });
  await page.waitForTimeout(200);
  const wkY = () => page.evaluate(() => document.querySelector('.wk-body').scrollTop);
  const startY = await wkY();
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.set-row')];
    const seen = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top > 120 && b.bottom < innerHeight - 40; }) || rows[0];
    seen.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  t.equal('ticking a set holds the scroll position', await wkY(), startY);
  await page.evaluate(() => { document.querySelectorAll('.ex-block')[3].querySelector('.add-set').click(); });
  await page.waitForTimeout(450);
  t.equal('adding a set holds it too', await wkY(), startY);

  // a new exercise is worth scrolling to, though
  await page.click('#addExercise');
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelector('.lib-item').click());
  await page.waitForTimeout(550);
  const added = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.ex-block')];
    const r = blocks[blocks.length - 1].getBoundingClientRect();
    return { count: blocks.length, visible: r.top < innerHeight && r.bottom > 0 };
  });
  t.equal('the exercise is added', added.count, 6);
  t.check('and scrolled into view', added.visible);

  // a full storage box says so instead of swallowing the tap
  await page.evaluate(() => {
    window.__set = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.querySelector('.set-done').classList.contains('is-on')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  const warn = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  t.check('running out of storage is reported', /out of storage/.test(warn), warn);
  t.check('and the app keeps working', await page.evaluate(() => {
    document.querySelector('#wkMin').click();
    return !document.body.classList.contains('wk-open');
  }));
  await page.evaluate(() => { localStorage.setItem = window.__set; });

  // the feel: a buzz and a flash when a set lands, and a switch to silence it
  const openLogger = async () => {
    await page.evaluate(() => { const m = document.querySelector('#miniExpand'); if (m) m.click(); });
    await page.waitForTimeout(450);
  };
  await openLogger();
  await page.evaluate(() => { window.__buzz = []; navigator.vibrate = (v) => { window.__buzz.push(JSON.stringify(v)); return true; }; });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.classList.contains('logged')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  const feel = await page.evaluate(() => {
    const row = document.querySelector('.set-row.just-logged');
    return { buzz: window.__buzz.length, flash: !!row,
      anim: row ? getComputedStyle(row).animationName : '' };
  });
  t.check('logging a set buzzes', feel.buzz > 0, String(feel.buzz));
  t.check('and the row lights up', feel.flash && feel.anim === 'row-flash', feel.anim);

  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.settings.haptics = false;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await openLogger();
  await page.evaluate(() => { window.__buzz = []; navigator.vibrate = (v) => { window.__buzz.push(JSON.stringify(v)); return true; }; });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.set-row');
    const open = [...rows].find((r) => !r.classList.contains('logged')) || rows[0];
    open.querySelector('.set-done').click();
  });
  await page.waitForTimeout(450);
  t.equal('vibration can be switched off', await page.evaluate(() => window.__buzz.length), 0);

  // logging a set leaves the page and the keyboard alone
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.activeWorkout = { id: 'wq', name: 'Push day', startedAt: Date.now() - 6e5,
      exercises: [{ exerciseId: 'bench-press', sets: [
        { weight: 40, reps: 10, done: false, type: 'W' },
        { weight: 80, reps: 8, done: false },
        { weight: 80, reps: 8, done: false }] }] };
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(700);
  const scrollBefore = await page.evaluate(() => document.querySelector('.wk-body').scrollTop);
  await page.click('.set-row[data-set="1"] .in-weight');
  await page.waitForTimeout(200);
  await page.click('.set-row[data-set="1"] .set-done');
  await page.waitForTimeout(500);
  t.equal('logging a set does not move the page',
    await page.evaluate(() => document.querySelector('.wk-body').scrollTop), scrollBefore);
  t.check('and the logger does not replay its entrance', await page.evaluate(() =>
    !document.querySelector('.wk-overlay.wk-enter')));
  t.equal('and nothing takes the keyboard',
    await page.evaluate(() => document.activeElement?.closest?.('.set-row')?.dataset.set ?? 'none'), 'none');

  // an exercise comes back with last session's numbers already in the boxes
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
    st.workouts = [{ id: 'wp', name: 'Push day', startedAt: Date.now() - 3 * 864e5, finishedAt: Date.now() - 3 * 864e5 + 3.6e6,
      exercises: [{ exerciseId: 'bench-press', sets: [
        { weight: 90, reps: 8, done: true, type: 'N' },
        { weight: 90, reps: 7, done: true, type: 'N' },
        { weight: 85, reps: 8, done: true, type: 'N' }] }] }];
    st.activeWorkout = null;
    localStorage.setItem('bela-gym-v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForTimeout(700);
  await page.click('.tab[data-tab="workout"]');
  await page.waitForTimeout(450);
  await page.click('#startEmpty');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.lib-item')].find((x) => /Barbell Bench Press/.test(x.textContent));
    if (it) it.click();
  });
  await page.waitForTimeout(700);
  const boxes = () => page.evaluate(() => [...document.querySelectorAll('.set-row')]
    .map((r) => r.querySelector('.in-weight').value + 'x' + r.querySelector('.in-reps').value).join(' '));
  t.equal('the boxes stay empty', await boxes(), 'x x x');
  const ghosts = await page.evaluate(() => [...document.querySelectorAll('.set-row')]
    .map((r) => r.querySelector('.in-weight').placeholder + 'x' + r.querySelector('.in-reps').placeholder).join(' '));
  t.equal('with last session showing behind them', ghosts, '90x8 90x7 85x8');
  await page.click('.set-row[data-set="0"] .set-done');
  await page.waitForTimeout(500);
  const logged = await page.evaluate(() => JSON.parse(localStorage.getItem('bela-gym-v1')).activeWorkout.exercises[0].sets[0]);
  t.equal('ticking logs what is shown — weight', logged.weight, 90);
  t.equal('and reps', logged.reps, 8);
  await page.click('.set-row[data-set="1"] .in-weight');
  await page.waitForTimeout(250);
  await page.keyboard.type('95');
  await page.waitForTimeout(250);
  t.equal('typing gives just what you typed',
    await page.evaluate(() => document.querySelector('.set-row[data-set="1"] .in-weight').value), '95');
  t.check('and no selection box appears in a set field', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.set-input'), '::selection').backgroundColor === 'rgba(0, 0, 0, 0)'));
  await page.click('.add-set');
  await page.waitForTimeout(500);
  t.equal('an added set is empty too', await boxes(), '90x8 95x x x');
  t.check('and shows the last set behind it', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.set-row')];
    const last = rows[rows.length - 1];
    return last.querySelector('.in-weight').placeholder === '85';
  }));

  // the bolts on auto habits line up
  await page.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelector('.tab[data-tab="habits"]').click());
  await page.waitForTimeout(500);
  const bolts = await page.evaluate(() => [...document.querySelectorAll('.hb-auto')]
    .map((b) => Math.round(b.getBoundingClientRect().left)));
  t.check('every auto marker sits in the same column', new Set(bolts).size <= 1, JSON.stringify(bolts));

  /* The workout notification puts itself back when swiped away. Only checked
     where a service worker actually exists — most suites run without one, and
     navigator.serviceWorker.ready never settles there, which hangs the run. */
  if (await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))) {
    const notes = () => page.evaluate(() => navigator.serviceWorker.ready
      .then((r) => r.getNotifications({ tag: 'bela-workout' })).then((l) => l.length).catch(() => -1));
    if ((await notes()) > 0) {
      await page.evaluate(() => navigator.serviceWorker.ready
        .then((r) => r.getNotifications({ tag: 'bela-workout' })).then((l) => l.forEach((n) => n.close())));
      await page.waitForTimeout(300);
      t.equal('dismissing it takes it away', await notes(), 0);
      await page.waitForTimeout(6000);
      t.equal('and it puts itself back', await notes(), 1);
    }
  }

  /* ---- a record is the biggest set, and only one set can hold it ---- */
  {
    const clean = build();
    clean.workouts = [];                       // nothing to beat but yourself
    const p1 = await openApp(t.browser, { url: server.url, seed: clean });
    await p1.click('.tab[data-tab="workout"]');
    await p1.waitForTimeout(500);
    await p1.evaluate(() => document.querySelector('#startEmpty').click());
    await p1.waitForTimeout(700);
    await p1.evaluate(() => document.querySelector('#pickList [data-pick]').click());
    await p1.waitForTimeout(800);

    const logSet = async (i, w, r) => {
      await p1.evaluate(({ i, w, r }) => {
        const row = document.querySelectorAll('#workoutRoot .set-row')[i];
        const wi = row.querySelector('.in-weight'), ri = row.querySelector('.in-reps');
        wi.value = w; wi.dispatchEvent(new Event('input', { bubbles: true }));
        ri.value = r; ri.dispatchEvent(new Event('input', { bubbles: true }));
        row.querySelector('.set-done').click();
      }, { i, w, r });
      await p1.waitForTimeout(600);
    };
    const prs = () => p1.evaluate(() =>
      JSON.parse(localStorage.getItem('bela-gym-v1')).activeWorkout.exercises[0].sets.map((s) => !!s.pr));

    await logSet(0, '20', '9');
    t.equal('the first set of a new exercise is a record', (await prs()).join(), 'true,false,false');
    await logSet(1, '20', '10');
    t.equal('a bigger set takes the record off it', (await prs()).join(), 'false,true,false');
    t.equal('so only one crown is on the card', await p1.evaluate(() =>
      document.querySelectorAll('#workoutRoot .set-prev .pr-mark').length), 1);
    await logSet(2, '25', '5');
    t.check('and a set that moved less does not get one — 125 kg is under 200',
      (await prs()).join() === 'false,true,false', (await prs()).join());

    /* ---- a machine marked in pounds ---- */
    await p1.evaluate(() => document.querySelector('#workoutRoot .ex-menu').click());
    await p1.waitForTimeout(600);
    t.check('the menu offers the other unit', await p1.evaluate(() =>
      /This machine is in lb/.test(document.querySelector('[data-act="unit"]').textContent)));
    await p1.evaluate(() => document.querySelector('[data-act="unit"]').click());
    await p1.waitForTimeout(800);

    t.equal('the column says lb', await p1.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .set-grid .hdr')].map((h) => h.textContent)[2]), 'lb');
    t.equal('the sets read in pounds', await p1.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .in-weight')].slice(0, 2).map((i) => i.value).join()), '44.1,44.1');
    t.equal('with what they come to underneath', await p1.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .w-conv')].slice(0, 2).map((i) => i.textContent).join()), '20 kg,20 kg');

    await p1.evaluate(() => document.querySelector('#workoutRoot .set-row .set-done').click());
    await p1.waitForTimeout(500);
    await p1.evaluate(() => {
      const row = document.querySelectorAll('#workoutRoot .set-row')[0];
      const wi = row.querySelector('.in-weight');
      wi.value = '25'; wi.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p1.waitForTimeout(400);
    t.near('typing 25 lb keeps 11.34 kg', await p1.evaluate(() =>
      JSON.parse(localStorage.getItem('bela-gym-v1')).activeWorkout.exercises[0].sets[0].weight), 11.34, 0.01);

    t.check('the note line carries no picture', await p1.evaluate(() =>
      document.querySelector('#workoutRoot .ex-note-line').textContent.trim() === 'Add notes here…'));

    t.equal('no page errors', p1.errors.length, 0);
    await p1.close();
  }

  t.equal('no page errors', page.errors.length, 0);
  await page.close();

  /* ---- routines: the four the app came with are yours to change too ---- */
  {
    const p2 = await openApp(t.browser, { url: server.url, seed: build() });
    const names = () => p2.evaluate(() => [...document.querySelectorAll('.tpl-item .li-name')].map((e) => e.textContent));
    await p2.click('.tab[data-tab="workout"]');
    await p2.waitForTimeout(600);

    t.check('every routine can be edited and deleted', await p2.evaluate(() =>
      [...document.querySelectorAll('.tpl-item')].length > 0 &&
      [...document.querySelectorAll('.tpl-item')].every((el) =>
        el.querySelector('[data-edit-tpl]') && el.querySelector('[data-del-tpl]'))));

    /* The buttons form a column: a longer routine name must not push them
       along the row, and they must all be the same size. */
    const boxes = await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .map((el) => [...el.querySelectorAll('.icon-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.width), Math.round(r.height)].join();
      }).join('|')));
    t.check('the pencil and the bin line up down the list',
      boxes.length > 1 && boxes.every((b) => b === boxes[0]), boxes.join(' / '));
    t.check('and are square, not squeezed', await p2.evaluate(() => {
      const r = document.querySelector('.tpl-acts .icon-btn').getBoundingClientRect();
      return Math.round(r.width) === Math.round(r.height);
    }));

    // edit one of the built-ins
    await p2.evaluate(() => document.querySelector('[data-edit-tpl="tpl-push"]').click());
    await p2.waitForTimeout(600);
    t.equal('a built-in opens in the builder', await p2.evaluate(() => document.querySelector('#rbName').value), 'Push Day');
    t.equal('with its exercises', await p2.evaluate(() => document.querySelectorAll('#routineRoot .ex-block').length), 5);
    t.check('laid out like the logger — a card per exercise, a numbered row per set',
      await p2.evaluate(() => {
        const blocks = [...document.querySelectorAll('#routineRoot .ex-block')];
        return blocks.length > 0 && blocks.every((b) =>
          b.querySelector('.ex-head .ex-name') &&
          b.querySelectorAll('.set-grid .set-row').length > 0 &&
          b.querySelector('.rb-add-set'));
      }));
    t.check('and no offer to restore it yet', await p2.evaluate(() => !document.querySelector('#rbReset')));

    await p2.fill('#rbName', 'Push A');
    await p2.evaluate(() => document.querySelector('#rbName').dispatchEvent(new Event('input')));
    // drop the last exercise through its menu, the way the logger does it
    await p2.evaluate(() => [...document.querySelectorAll('#routineRoot .rb-ex-menu')].pop().click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.menu-item[data-act="remove"]').click());
    await p2.waitForTimeout(600);
    await p2.click('#rbSave');
    await p2.waitForTimeout(700);

    t.equal('the change shows, in the same place', (await names()).join(), 'Push A,Pull Day,Leg Day,Full Body');
    const st = await readState(p2);
    t.equal('saved as your own copy', st.templates.length, 1);
    t.equal('keeping the original id, so the weekly plan still points at it', st.templates[0].id, 'tpl-push');
    t.equal('with the exercise removed', st.templates[0].exercises.length, 4);

    // and it can be put back
    await p2.evaluate(() => document.querySelector('[data-edit-tpl="tpl-push"]').click());
    await p2.waitForTimeout(600);
    t.check('reopening offers the original back', await p2.evaluate(() => !!document.querySelector('#rbReset')));
    await p2.click('#rbReset');
    await p2.waitForTimeout(500);
    await p2.click('#cfYes');
    await p2.waitForTimeout(700);
    t.equal('which restores it', (await names()).join(), 'Push Day,Pull Day,Leg Day,Full Body');
    t.equal('and drops the copy', (await readState(p2)).templates.length, 0);

    // deleting one
    await p2.evaluate(() => document.querySelector('[data-del-tpl="tpl-pull"]').click());
    await p2.waitForTimeout(500);
    const msg = await p2.evaluate(() => document.querySelector('.confirm-msg')?.textContent || '');
    t.check('deleting warns about the plan days it clears', /weekly plan will be cleared/.test(msg), msg);
    t.check('and says it can come back', /bring it back later/.test(msg), msg);
    await p2.click('#cfYes');
    await p2.waitForTimeout(800);
    t.equal('it goes', (await names()).join(), 'Push Day,Leg Day,Full Body');
    const st2 = await readState(p2);
    t.check('remembered as removed', (st2.tplHidden || []).includes('tpl-pull'));
    t.check('and the plan no longer points at it', !st2.schedule.includes('tpl-pull'));

    t.check('the routine list is not cluttered with a way back', await p2.evaluate(() =>
      !document.querySelector('#tplRestore')));

    // it waits in Settings instead, so a removed built-in is never gone for good
    await p2.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
    await p2.waitForTimeout(450);
    await p2.click('#homeAvatar');
    await p2.waitForTimeout(400);
    await (await p2.$('.icon-btn[aria-label*="ettings"]')).click();
    await p2.waitForTimeout(500);
    t.equal('Settings has one', await p2.evaluate(() =>
      document.querySelector('#tplRestore')?.textContent.trim()), 'Bring back the removed routine');
    await p2.click('#tplRestore');
    await p2.waitForTimeout(700);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    t.equal('which does', (await names()).join(), 'Push Day,Pull Day,Leg Day,Full Body');

    // your own routines still behave
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Arms');
    await p2.evaluate(() => document.querySelector('#rbName').dispatchEvent(new Event('input')));
    await p2.evaluate(() => document.querySelector('#rbAdd').click());
    await p2.waitForTimeout(600);
    await p2.evaluate(() => document.querySelector('#pickList [data-pick]').click());
    await p2.waitForTimeout(600);
    await p2.click('#rbSave');
    await p2.waitForTimeout(700);
    t.check('a new routine joins the list', (await names()).includes('Arms'));
    t.check('and counts its one exercise in the singular', await p2.evaluate(() =>
      [...document.querySelectorAll('.tpl-item')].some((el) =>
        /Arms/.test(el.textContent) && /1 exercise · /.test(el.querySelector('.li-sub').textContent))));
    const mine = (await readState(p2)).templates.find((x) => x.name === 'Arms');
    await p2.evaluate((id) => document.querySelector('[data-del-tpl="' + id + '"]').click(), mine.id);
    await p2.waitForTimeout(500);
    await p2.click('#cfYes');
    await p2.waitForTimeout(800);
    t.check('and can be deleted again', !(await names()).includes('Arms'));
    t.check('without being remembered as a removed built-in',
      !((await readState(p2)).tplHidden || []).includes(mine.id));

    /* ---- building one from scratch, in the logger's own shape ---- */
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    t.check('a new routine opens full screen, not in a sheet',
      await p2.evaluate(() => !!document.querySelector('#routineRoot .wk-overlay')));
    t.check('with the tab bar out of the way',
      await p2.evaluate(() => getComputedStyle(document.querySelector('.tab-bar')).display === 'none'));
    t.equal('it counts what is in it', await p2.evaluate(() =>
      [...document.querySelectorAll('#routineRoot .wk-stats b')].map((b) => b.textContent).join()), '0,0');

    await p2.fill('#rbName', 'Upper A');
    await p2.click('#rbAdd');
    await p2.waitForTimeout(600);
    await p2.evaluate(() => document.querySelector('#pickList [data-pick]').click());
    await p2.waitForTimeout(700);
    t.equal('an exercise arrives with three sets', await p2.evaluate(() =>
      document.querySelectorAll('#routineRoot .ex-block[data-ex="0"] .set-row').length), 3);
    t.equal('and the count keeps up', await p2.evaluate(() =>
      [...document.querySelectorAll('#routineRoot .wk-stats b')].map((b) => b.textContent).join()), '1,3');

    // a set per row means a routine can ask for 12, 10, 8
    await p2.evaluate(() => {
      const boxes = document.querySelectorAll('.ex-block[data-ex="0"] .rb-rep');
      [12, 10, 8].forEach((v, i) => { boxes[i].value = v; boxes[i].dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await p2.waitForTimeout(300);
    await p2.evaluate(() => document.querySelector('.ex-block[data-ex="0"] .rb-add-set').click());
    await p2.waitForTimeout(500);
    t.equal('adding a set copies the one above it', await p2.evaluate(() =>
      [...document.querySelectorAll('.ex-block[data-ex="0"] .rb-rep')].map((i) => i.value).join()), '12,10,8,8');
    await p2.evaluate(() => document.querySelector('.ex-block[data-ex="0"] .rb-drop-set').click());
    await p2.waitForTimeout(500);
    t.equal('and taking one away leaves the rest', await p2.evaluate(() =>
      [...document.querySelectorAll('.ex-block[data-ex="0"] .rb-rep')].map((i) => i.value).join()), '10,8,8');

    await p2.click('#rbSave');
    await p2.waitForTimeout(800);
    t.check('saving comes back to the list',
      await p2.evaluate(() => !document.querySelector('#routineRoot .wk-overlay')));
    t.check('and the tab bar is back',
      await p2.evaluate(() => getComputedStyle(document.querySelector('.tab-bar')).display !== 'none'));
    const built = (await readState(p2)).templates.find((x) => x.name === 'Upper A');
    t.equal('the reps are kept per set', JSON.stringify(built.exercises[0].sets), '[{"reps":10},{"reps":8},{"reps":8}]');

    /* ---- and those targets show when you actually do it ---- */
    await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .find((e) => /Upper A/.test(e.textContent)).click());
    await p2.waitForTimeout(800);
    t.equal('starting it opens the workout', await p2.evaluate(() =>
      document.querySelector('#workoutRoot .wk-title').textContent), 'Upper A');
    t.equal('with a set per row', await p2.evaluate(() =>
      document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .set-row').length), 3);
    await p2.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('bela-gym-v1'));
      return st.activeWorkout.exercises[0].sets.map((s) => s.target).join();
    });
    t.equal('carrying the routine’s targets', await p2.evaluate(() =>
      JSON.parse(localStorage.getItem('bela-gym-v1')).activeWorkout.exercises[0].sets.map((s) => s.target).join()), '10,8,8');

    /* ---- a routine may name the weight, and may keep quiet about it ---- */
    await p2.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Weighted');
    await p2.click('#rbAdd');
    await p2.waitForTimeout(600);
    await p2.evaluate(() => document.querySelector('#pickList [data-pick]').click());
    await p2.waitForTimeout(700);

    t.equal('the plan has a column for the weight', await p2.evaluate(() =>
      [...document.querySelectorAll('.rb-grid .hdr')].map((h) => h.textContent).join()), 'Set,Prev,kg,Reps,');
    await p2.evaluate(() => {
      const ws = document.querySelectorAll('.ex-block[data-ex="0"] .rb-w');
      ['80', '82.5'].forEach((v, i) => { ws[i].value = v; ws[i].dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await p2.waitForTimeout(400);
    await p2.click('#rbSave');
    await p2.waitForTimeout(800);
    const weighted = (await readState(p2)).templates.find((x) => x.name === 'Weighted');
    t.equal('a weight is kept where it was typed and nowhere else',
      JSON.stringify(weighted.exercises[0].sets),
      '[{"reps":10,"weight":80},{"reps":10,"weight":82.5},{"reps":10}]');

    await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .find((e) => /Weighted/.test(e.textContent)).click());
    await p2.waitForTimeout(800);
    t.equal('the planned weight is the faint number in the box', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .in-weight')]
        .map((i) => i.placeholder).join()), '80,82.5,80');
    t.check('and none of it is filled in for you', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .in-weight')].every((i) => i.value === '')));
    await p2.evaluate(() => { const b = document.querySelector('#cancelWorkout'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => { const b = document.querySelector('#cfYes'); if (b) b.click(); });
    await p2.waitForTimeout(700);

    /* ---- a pull-up has no weight to write down ---- */
    await p2.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Core');
    for (const name of ['Hanging Leg Raise', 'Barbell Bench Press']) {
      await p2.click('#rbAdd');
      await p2.waitForTimeout(600);
      await p2.fill('#pickSearch', name);
      await p2.waitForTimeout(400);
      await p2.evaluate(() => document.querySelector('#pickList [data-pick]').click());
      await p2.waitForTimeout(700);
    }
    t.equal('bodyweight loses the kg column, the barbell keeps it', await p2.evaluate(() =>
      [...document.querySelectorAll('#routineRoot .ex-block')]
        .map((b) => [...b.querySelectorAll('.hdr')].map((h) => h.textContent).join('|')).join(' / ')),
      'Set|Prev|Reps| / Set|Prev|kg|Reps|');

    await p2.evaluate(() => document.querySelectorAll('.rb-ex-menu')[0].click());
    await p2.waitForTimeout(600);
    t.check('but it can be told you use a belt', await p2.evaluate(() =>
      /I add weight to this/.test(document.querySelector('[data-act="wt"]').textContent)));
    t.check('and it is not offered a plate calculator meanwhile', await p2.evaluate(() =>
      !document.querySelector('[data-act="plates"]')));
    await p2.evaluate(() => document.querySelector('[data-act="wt"]').click());
    await p2.waitForTimeout(700);
    t.equal('which brings the column back, as added weight', await p2.evaluate(() =>
      [...document.querySelectorAll('#routineRoot .ex-block[data-ex="0"] .hdr')].map((h) => h.textContent).join('|')),
      'Set|Prev|+kg|Reps|');
    await p2.evaluate(() => document.querySelectorAll('.rb-ex-menu')[0].click());
    await p2.waitForTimeout(600);
    await p2.evaluate(() => document.querySelector('[data-act="wt"]').click());
    await p2.waitForTimeout(700);
    await p2.click('#rbSave');
    await p2.waitForTimeout(800);

    await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .find((e) => /Core/.test(e.textContent)).click());
    await p2.waitForTimeout(900);
    t.equal('the logger drops it too', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .hdr')].map((h) => h.textContent).join('|')),
      'Set|Prev|Reps|RPE|✓');

    // and reps alone can be a record, which they never could before
    const bwSet = async (i, r) => {
      await p2.evaluate(({ i, r }) => {
        const row = document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .set-row')[i];
        const ri = row.querySelector('.in-reps');
        ri.value = r; ri.dispatchEvent(new Event('input', { bubbles: true }));
        row.querySelector('.set-done').click();
      }, { i, r });
      await p2.waitForTimeout(600);
    };
    await bwSet(0, '12');
    await bwSet(1, '15');
    t.equal('the better set of pull-ups holds the record', await p2.evaluate(() =>
      JSON.parse(localStorage.getItem('bela-gym-v1')).activeWorkout.exercises[0].sets
        .map((x) => !!x.pr).join()), 'false,true,false');
    t.check('and it is announced in reps, not in null kilos', await p2.evaluate(() =>
      !/null/.test(document.querySelector('.toast')?.textContent || '')),
      await p2.evaluate(() => document.querySelector('.toast')?.textContent || ''));

    await p2.evaluate(() => { const b = document.querySelector('#cancelWorkout'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => { const b = document.querySelector('#cfYes'); if (b) b.click(); });
    await p2.waitForTimeout(700);

    /* ---- cardio has its own shape: time, speed, incline, distance ---- */
    await p2.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Treadmill');
    await p2.click('#rbAdd');
    await p2.waitForTimeout(600);
    await p2.fill('#pickSearch', 'Treadmill');
    await p2.waitForTimeout(400);
    await p2.evaluate(() => document.querySelector('#pickList [data-pick]').click());
    await p2.waitForTimeout(700);

    t.equal('a treadmill asks for minutes, speed, incline and distance', await p2.evaluate(() =>
      [...document.querySelectorAll('#routineRoot .set-grid .hdr')].map((h) => h.textContent).join()),
      'Set,Min,km/h,%,km,');
    t.equal('and comes as one go, not three sets', await p2.evaluate(() =>
      document.querySelectorAll('#routineRoot .ex-block[data-ex="0"] .set-row').length), 1);

    await p2.evaluate(() => {
      const set = (sel, v) => {
        const el = document.querySelector('.ex-block[data-ex="0"] ' + sel);
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('.rb-min', '20'); set('.rb-kmh', '10'); set('.rb-incl', '3');
    });
    await p2.waitForTimeout(400);
    t.equal('twenty minutes at ten works the distance out for you', await p2.evaluate(() =>
      document.querySelector('.ex-block[data-ex="0"] .rb-km').value), '3.33');

    await p2.click('#rbSave');
    await p2.waitForTimeout(800);
    t.equal('the machine settings are the routine', JSON.stringify(
      (await readState(p2)).templates.find((x) => x.name === 'Treadmill').exercises[0].sets),
      '[{"reps":20,"kmh":10,"weight":3.33,"incl":3}]');

    await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .find((e) => /Treadmill/.test(e.textContent)).click());
    await p2.waitForTimeout(900);
    t.equal('the logger asks the same four things', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .set-grid .hdr')].map((h) => h.textContent).join()),
      'Set,Min,km/h,%,km,✓');
    t.equal('with the plan behind each box', await p2.evaluate(() => {
      const row = document.querySelector('#workoutRoot .set-row');
      return ['.in-reps', '.in-kmh', '.in-incl', '.in-weight'].map((s) => row.querySelector(s).placeholder).join();
    }), '20,10,3,3.33');

    await p2.evaluate(() => document.querySelector('#workoutRoot .set-done').click());
    await p2.waitForTimeout(600);
    const cSet = await p2.evaluate(() =>
      JSON.parse(localStorage.getItem('bela-gym-v1')).activeWorkout.exercises[0].sets[0]);
    t.equal('ticking it takes all four', [cSet.reps, cSet.kmh, cSet.incl, cSet.weight].join(), '20,10,3,3.33');

    // and typing time + speed on a fresh set fills the distance in
    await p2.evaluate(() => document.querySelector('#workoutRoot .add-set').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => {
      const row = document.querySelectorAll('#workoutRoot .set-row')[1];
      const t2 = row.querySelector('.in-reps'), sp = row.querySelector('.in-kmh');
      t2.value = '30'; t2.dispatchEvent(new Event('input', { bubbles: true }));
      sp.value = '8'; sp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p2.waitForTimeout(400);
    t.equal('thirty minutes at eight is four kilometres', await p2.evaluate(() =>
      document.querySelectorAll('#workoutRoot .set-row')[1].querySelector('.in-weight').value), '4');
    t.check('and cardio is still kept out of the volume', await p2.evaluate(() =>
      /^0 /.test([...document.querySelectorAll('#workoutRoot .wk-stats b')][1].textContent)));

    await p2.evaluate(() => { const b = document.querySelector('#cancelWorkout'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => { const b = document.querySelector('#cfYes'); if (b) b.click(); });
    await p2.waitForTimeout(700);

    /* ---- a rep range, when you want one ---- */
    await p2.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Ranged');
    for (const n of [0, 2]) {
      await p2.click('#rbAdd');
      await p2.waitForTimeout(600);
      await p2.evaluate((i) => document.querySelectorAll('#pickList [data-pick]')[i].click(), n);
      await p2.waitForTimeout(700);
    }
    t.equal('a plain reps box until you ask for a range', await p2.evaluate(() =>
      document.querySelectorAll('.ex-block[data-ex="0"] .rb-repmax').length), 0);

    await p2.evaluate(() => document.querySelectorAll('.rb-ex-menu')[0].click());
    await p2.waitForTimeout(600);
    t.check('the menu offers one', await p2.evaluate(() =>
      /rep range/i.test(document.querySelector('[data-act="range"]').textContent)));
    await p2.evaluate(() => document.querySelector('[data-act="range"]').click());
    await p2.waitForTimeout(700);
    t.equal('which gives that exercise an upper box per set', await p2.evaluate(() =>
      document.querySelectorAll('.ex-block[data-ex="0"] .rb-repmax').length), 3);
    t.equal('and leaves the other exercise alone', await p2.evaluate(() =>
      document.querySelectorAll('.ex-block[data-ex="1"] .rb-repmax').length), 0);

    await p2.evaluate(() => {
      const set = (sel, i, v) => {
        const el = document.querySelectorAll('.ex-block[data-ex="0"] ' + sel)[i];
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      [0, 1, 2].forEach((i) => { set('.rb-rep', i, '6'); set('.rb-repmax', i, '8'); });
      // the last one backwards, to check it is turned round
      set('.rb-rep', 2, '10'); set('.rb-repmax', 2, '8');
    });
    await p2.waitForTimeout(400);
    await p2.evaluate(() => document.querySelectorAll('.rb-ex-menu')[0].click());
    await p2.waitForTimeout(600);
    t.check('and offers to go back to one number', await p2.evaluate(() =>
      /one rep number/i.test(document.querySelector('[data-act="range"]').textContent)));
    await p2.evaluate(() => document.querySelector('[data-close]').click());
    await p2.waitForTimeout(400);

    await p2.click('#rbSave');
    await p2.waitForTimeout(800);
    const ranged = (await readState(p2)).templates.find((x) => x.name === 'Ranged');
    t.equal('the range is saved, the wrong way round put right',
      JSON.stringify(ranged.exercises[0].sets),
      '[{"reps":6,"repsMax":8},{"reps":6,"repsMax":8},{"reps":8,"repsMax":10}]');
    t.equal('the other exercise keeps a single number',
      JSON.stringify(ranged.exercises[1].sets), '[{"reps":10},{"reps":10},{"reps":10}]');

    await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .find((e) => /Ranged/.test(e.textContent)).click());
    await p2.waitForTimeout(800);
    t.equal('the logger shows the range behind the box', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .in-reps')]
        .map((i) => i.placeholder).join()), '6-8,6-8,8-10');
    t.equal('and a plain number where there is no range', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ex-block[data-ex="1"] .in-reps')]
        .map((i) => i.placeholder).join()), '10,10,10');
    await p2.evaluate(() => { const b = document.querySelector('#cancelWorkout'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => { const b = document.querySelector('#cfYes'); if (b) b.click(); });
    await p2.waitForTimeout(700);

    /* ---- everything the logger offers a set, the plan offers too ---- */
    await p2.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Types');
    for (const n of [0, 2]) {
      await p2.click('#rbAdd');
      await p2.waitForTimeout(600);
      await p2.evaluate((i) => document.querySelectorAll('#pickList [data-pick]')[i].click(), n);
      await p2.waitForTimeout(700);
    }

    await p2.evaluate(() => document.querySelectorAll('.ex-block[data-ex="0"] .rb-set-num')[0].click());
    await p2.waitForTimeout(600);
    t.equal('the set number opens the same type picker', await p2.evaluate(() =>
      [...document.querySelectorAll('[data-type]')].map((e) => e.dataset.type).join()), 'N,W,D,F');
    await p2.evaluate(() => document.querySelector('[data-type="W"]').click());
    await p2.waitForTimeout(700);
    await p2.evaluate(() => document.querySelectorAll('.ex-block[data-ex="0"] .rb-set-num')[2].click());
    await p2.waitForTimeout(600);
    await p2.evaluate(() => document.querySelector('[data-type="F"]').click());
    await p2.waitForTimeout(700);
    t.equal('a warm-up is lettered and the working sets renumber', await p2.evaluate(() =>
      [...document.querySelectorAll('.ex-block[data-ex="0"] .rb-set-num')]
        .map((b) => b.textContent + [...b.classList].filter((c) => c.startsWith('t-')).join('')).join(' ')),
      'Wt-w 1t-n Ft-f');

    // a note, and a superset with the next exercise
    await p2.evaluate(() => document.querySelector('.rb-note').click());
    await p2.waitForTimeout(600);
    await p2.fill('#exNote', 'Pause on the chest');
    await p2.click('#noteSave');
    await p2.waitForTimeout(700);
    t.check('an exercise can carry a note', await p2.evaluate(() =>
      /Pause on the chest/.test(document.querySelector('.rb-note').textContent)));

    await p2.evaluate(() => document.querySelectorAll('.rb-ex-menu')[0].click());
    await p2.waitForTimeout(600);
    t.equal('the menu offers what the logger offers, plus the rep range', await p2.evaluate(() =>
      [...document.querySelectorAll('.menu-item')].map((b) => b.dataset.act).join()),
      'up,down,note,range,unit,ss,replace,plates,detail,remove');
    await p2.evaluate(() => document.querySelector('[data-act="ss"]').click());
    await p2.waitForTimeout(700);
    t.equal('two exercises can be a superset', await p2.evaluate(() =>
      [...document.querySelectorAll('#routineRoot .ss-chip')].map((c) => c.textContent).join()), 'SS1,SS1');

    await p2.click('#rbSave');
    await p2.waitForTimeout(800);
    const typed = (await readState(p2)).templates.find((x) => x.name === 'Types');
    t.equal('the types are saved with the routine', JSON.stringify(typed.exercises[0].sets),
      '[{"reps":10,"type":"W"},{"reps":10},{"reps":10,"type":"F"}]');
    t.equal('and the note', typed.exercises[0].note, 'Pause on the chest');
    t.equal('and the superset', [typed.exercises[0].ss, typed.exercises[1].ss].join(), '1,1');

    /* ---- and all of it is there when you actually do the workout ---- */
    await p2.evaluate(() => [...document.querySelectorAll('.tpl-item')]
      .find((e) => /Types/.test(e.textContent)).click());
    await p2.waitForTimeout(800);
    t.equal('the warm-up and the failure set start already marked', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ex-block[data-ex="0"] .set-num')]
        .map((b) => b.textContent).join()), 'W,1,F');
    t.equal('the note comes with it', await p2.evaluate(() =>
      document.querySelector('#workoutRoot .ex-note-line').textContent.trim()), 'Pause on the chest');
    t.equal('and the superset', await p2.evaluate(() =>
      [...document.querySelectorAll('#workoutRoot .ss-chip')].map((c) => c.textContent).join()), 'SS1,SS1');
    await p2.evaluate(() => { const b = document.querySelector('#cancelWorkout'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => { const b = document.querySelector('#cfYes'); if (b) b.click(); });
    await p2.waitForTimeout(700);

    /* ---- backing out of an unsaved one asks first ---- */
    await p2.evaluate(() => { const b = document.querySelector('#wkMin'); if (b) b.click(); });
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
    await p2.waitForTimeout(500);
    await p2.evaluate(() => document.querySelector('#newRoutine2').click());
    await p2.waitForTimeout(600);
    await p2.fill('#rbName', 'Half built');
    await p2.click('#rbClose');
    await p2.waitForTimeout(500);
    t.check('leaving a half-built routine asks first', await p2.evaluate(() =>
      /not been saved/.test(document.querySelector('.confirm-msg')?.textContent || '')));
    await p2.click('#cfYes');
    await p2.waitForTimeout(700);
    t.check('and then lets it go', await p2.evaluate(() =>
      !document.querySelector('#routineRoot .wk-overlay')));
    t.check('without keeping it', !(await readState(p2)).templates.some((x) => x.name === 'Half built'));

    t.equal('no page errors', p2.errors.length, 0);
    await p2.close();
  }

  await server.close();
};
