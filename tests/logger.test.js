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

    // edit one of the built-ins
    await p2.evaluate(() => document.querySelector('[data-edit-tpl="tpl-push"]').click());
    await p2.waitForTimeout(600);
    t.equal('a built-in opens in the builder', await p2.evaluate(() => document.querySelector('#rbName').value), 'Push Day');
    t.equal('with its exercises', await p2.evaluate(() => document.querySelectorAll('.rb-row').length), 5);
    t.check('and no offer to restore it yet', await p2.evaluate(() => !document.querySelector('#rbReset')));

    await p2.fill('#rbName', 'Push A');
    await p2.evaluate(() => document.querySelector('#rbName').dispatchEvent(new Event('input')));
    await p2.evaluate(() => document.querySelectorAll('.rb-del')[4].click());
    await p2.waitForTimeout(400);
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

    t.equal('with a way to bring it back', await p2.evaluate(() =>
      document.querySelector('#tplRestore')?.textContent.trim()), 'Bring back the removed routine');
    await p2.click('#tplRestore');
    await p2.waitForTimeout(700);
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
    const mine = (await readState(p2)).templates.find((x) => x.name === 'Arms');
    await p2.evaluate((id) => document.querySelector('[data-del-tpl="' + id + '"]').click(), mine.id);
    await p2.waitForTimeout(500);
    await p2.click('#cfYes');
    await p2.waitForTimeout(800);
    t.check('and can be deleted again', !(await names()).includes('Arms'));
    t.check('without being remembered as a removed built-in',
      !((await readState(p2)).tplHidden || []).includes(mine.id));

    t.equal('no page errors', p2.errors.length, 0);
    await p2.close();
  }

  await server.close();
};
