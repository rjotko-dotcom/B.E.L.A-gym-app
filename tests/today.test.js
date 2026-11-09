/* 16.10, Today: he asked for Plan and Info (and the habits) on one page —
   the calendar first, kept fresh on its own, then the morning brief, today's
   habits and the rest of what the PC said. The tab bar is four tabs. */
const { openApp, readState } = require('./lib/harness');
const { build } = require('./lib/seed');

const dk = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const now = Date.now();
  const plan = { at: now - 10 * 60000, items: [
    { date: dk(0), time: '10:00', title: 'Verslo tyrimai', kind: 'seminar', area: 'university', label: 'seminaras' },
    { date: dk(2), time: '09:00', title: 'Įmonės veiklos vertinimas', kind: 'lecture', area: 'university' },
    { date: dk(12), time: '', title: 'Egzaminas: Mikroekonomika', kind: 'exam', area: 'university' } ] };
  const feedDoc = { protocol: 1, lastPollAt: now, lastError: null, messages: [
    { id: 'b1', at: now - 2 * 3600e3, title: 'B.E.L.A: Morning brief', body: 'Today: 1 seminaras.\nMoney: €352 spent.', read: false },
    { id: 'a1', at: now - 3 * 3600e3, title: 'B.E.L.A: Backup has not run', body: 'Five days.', read: false } ] };
  const page = await openApp(t.browser, { url: server.url, seed: build(), init: () => {} });
  let agendaAsked = 0;
  await page.route('**/bela/agenda', (r) => { agendaAsked++; r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ items: [...plan.items, { date: dk(1), time: '12:00', title: 'Naujas seminaras', kind: 'seminar', area: 'university' }] }) }); });
  await page.route('**/ntfy.sh/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.evaluate(([pl, fd]) => {
    localStorage.setItem('bela-sync-pc', JSON.stringify({ host: location.host, code: '1' }));
    localStorage.setItem('bela-plan-v1', JSON.stringify(pl));
    localStorage.setItem('bela-feed-v1', JSON.stringify(fd));
    localStorage.setItem('bela-feed-cfg', JSON.stringify({ topic: 'bela-test' }));
  }, [plan, feedDoc]);
  await page.reload();
  await page.waitForTimeout(600);

  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((x) => x.dataset.tab).join(','));
  t.equal('four tabs: Habits, Plan and Info are one', tabs, 'home,workout,meals,today');
  t.check('Today carries the unread count', await page.evaluate(() => !document.querySelector('.tab[data-tab="today"] #belaTabDot').hidden));

  await page.evaluate(() => document.querySelector('.tab[data-tab="today"]').click());
  await page.waitForTimeout(700);
  const order = await page.evaluate(() => [...document.querySelectorAll('#view > section')].map((s) => s.id || (s.classList.contains('td-brief') ? 'brief' : '?')).join(','));
  t.equal('the calendar first, then the brief, habits, the rest', order, 'tdCal,brief,tdHabits,tdFeed');
  t.check('the calendar shows this week', /Verslo tyrimai/.test(await page.textContent('#tdCal')) && /Įmonės veiklos/.test(await page.textContent('#tdCal')));
  t.check('and keeps the weeks after behind a tap', !/Mikroekonomika/.test(await page.textContent('#tdCal')) && !!(await page.$('#agdAll')));
  t.check('the morning brief is shown', /Morning brief/i.test(await page.textContent('.td-brief')) && /€352/.test(await page.textContent('.td-brief')));
  t.check('and not shown twice in the feed', !/Morning brief/.test(await page.textContent('#tdFeed')) && /Backup has not run/.test(await page.textContent('#tdFeed')));

  // a habit ticked right here
  const before = (await readState(page)).habitLog;
  await page.evaluate(() => document.querySelector('#tdHabits .hb-row[data-habit="h_sleep"]').click());
  await page.waitForTimeout(400);
  const after = (await readState(page)).habitLog;
  t.check('habits tick on Today', JSON.stringify(before) !== JSON.stringify(after));
  await page.evaluate(() => document.querySelector('#hbAll').click());
  await page.waitForTimeout(500);
  t.check('the full habit calendar is one tap in', !!(await page.$('.hc-grid')) && await page.evaluate(() => document.querySelector('.tab.active').dataset.tab === 'today'));
  await page.evaluate(() => document.querySelector('#hbBack').click());
  await page.waitForTimeout(400);
  t.check('and back again', !!(await page.$('#tdCal')));

  // the calendar refreshes on its own when it is old
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('bela-plan-v1')); c.at = Date.now() - 3600e3; localStorage.setItem('bela-plan-v1', JSON.stringify(c)); });
  await page.evaluate(() => { document.querySelector('.tab[data-tab="meals"]').click(); document.querySelector('.tab[data-tab="today"]').click(); });
  await page.waitForTimeout(1200);
  t.check('an old calendar is fetched again on its own', agendaAsked >= 1 && /Naujas seminaras/.test(await page.textContent('#tdCal')), String(agendaAsked));

  // leaving Today marks the feed read (to Workouts: Home steps back in history, which in a
  // test page would walk back across the reload above)
  await page.evaluate(() => document.querySelector('.tab[data-tab="workout"]').click());
  await page.waitForTimeout(300);
  t.check('leaving Today marks what was there read', await page.evaluate(() => document.querySelector('#belaTabDot').hidden));
  t.equal('no page errors', page.errors.length, 0, page.errors.join(' | '));
  await page.close();

  // old routes (a notification for the feed, a widget's habits button) land on Today
  const p2 = await openApp(t.browser, { url: server.url + '?go=habits', seed: build() });
  await p2.waitForTimeout(400);
  t.check('the old ways in land on Today', await p2.evaluate(() => document.querySelector('.tab.active')?.dataset.tab === 'today'));
  await p2.close();
  await server.close();
};
