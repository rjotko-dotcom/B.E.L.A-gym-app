/* The feed from the PC. The relay hands back a day of history in one
   answer, mixes housekeeping in with the news, and repeats itself every
   poll — so what matters here is that nothing arrives twice, nothing
   already seen makes the phone buzz, and a message survives the app
   being closed. Runs without a browser: the module is plain CommonJS. */
const Feed = require('../js/bela-feed.js');

const line = (o) => JSON.stringify(o);
const msg = (id, at, title, body, extra) => line({
  id, time: at, event: 'message', topic: 't', title, message: body, ...(extra || {}),
});

function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    size: () => m.size,
  };
}

function fakeNotifier() {
  const sent = [];
  const channels = [];
  return {
    sent, channels,
    allowed: async () => true,
    createChannel: async (c) => { channels.push(c); },
    schedule: async (p) => { sent.push(...p.notifications); },
  };
}

module.exports = async (t) => {
  /* ---------------- parsing ---------------- */
  const stream = [
    line({ id: 'x1', event: 'open', topic: 't' }),
    msg('a', 1757000000, 'Morning brief', 'Today: 2 lectures\nDue soon: Lab 4'),
    line({ id: 'x2', event: 'keepalive', topic: 't' }),
    msg('b', 1757003600, 'Bill changed', 'Netflix €12.99 → €15.99', { priority: 4, tags: ['warning'] }),
    '{"id":"c","event":"message"',      // a torn last line, as a cut stream leaves
  ].join('\n');

  const parsed = Feed.parseStream(stream);
  t.equal('only real messages survive the stream', parsed.length, 2);
  t.equal('the newest is not assumed to be first', parsed[0].id, 'a');
  t.equal('the title comes through', parsed[1].title, 'Bill changed');
  t.equal('so does the body', parsed[0].body, 'Today: 2 lectures\nDue soon: Lab 4');
  t.equal('seconds become milliseconds', parsed[0].at, 1757000000000);
  t.equal('priority is kept', parsed[1].priority, 4);
  t.check('and tags', parsed[1].tags.length === 1 && parsed[1].tags[0] === 'warning');
  t.equal('a torn line loses only itself', Feed.parseStream('{"nope"').length, 0);
  t.equal('and empty input is not an error', Feed.parseStream('').length, 0);

  /* ---------------- merge ---------------- */
  const older = [{ id: 'a', at: 1000, title: 'A', body: '', read: true }];
  const merged = Feed.merge(older, [
    { id: 'a', at: 1000, title: 'A', body: '' },
    { id: 'z', at: 5000, title: 'Z', body: '' },
  ], 10);
  t.equal('a message seen twice is stored once', merged.length, 2);
  t.equal('newest first', merged[0].id, 'z');
  t.check('and having read it is not undone by the next poll', merged[1].read === true);
  const capped = Feed.merge([], Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, at: i })), 25);
  t.equal('the phone keeps a bounded copy', capped.length, 25);
  t.equal('and drops the oldest', capped[capped.length - 1].id, 'm15');

  /* ---------------- url ---------------- */
  const url = Feed.pollUrl('https://ntfy.sh/', 'bela rj', 3600);
  t.equal('the topic is escaped and the slash not doubled', url,
    'https://ntfy.sh/bela%20rj/json?poll=1&since=3600s');
  t.check('a self-hosted server is just a different base',
    Feed.pollUrl('http://192.168.1.50:8080', 'x', 60).startsWith('http://192.168.1.50:8080/x/'));
  t.check('an absurd window is clamped', /since=604800s/.test(Feed.pollUrl('https://ntfy.sh', 'x', 99999999)));

  /* ---------------- the notification ---------------- */
  const one = Feed.notificationFor({ id: 'a', title: 'Morning brief', body: 'Line one\nLine two' }, Feed.STYLE);
  t.check('the id is a stable 32-bit number', Number.isInteger(one.id) && one.id > 0);
  t.equal('the same message always lands on the same notification',
    Feed.notificationId('a'), Feed.notificationId('a'));
  t.check('different messages do not collide', Feed.notificationId('a') !== Feed.notificationId('b'));
  t.check('and none of them lands on the workout note', Feed.notificationId('a') !== 8801);
  t.equal('style decides the icon', one.smallIcon, Feed.STYLE.smallIcon);
  t.equal('and the channel', one.channelId, Feed.STYLE.channelId);
  t.check('a multi-line body is expandable', one.largeBody === 'Line one\nLine two');
  const flat = Feed.notificationFor({ id: 'b', title: 'T', body: 'One line' }, Feed.STYLE);
  t.check('a single line needs no expansion', flat.largeBody === undefined);
  const prefixed = Feed.notificationFor({ id: 'c', title: 'Brief', body: '' },
    { ...Feed.STYLE, titlePrefix: 'B.E.L.A · ' });
  t.equal('the prefix is style, not logic', prefixed.title, 'B.E.L.A · Brief');

  /* ---------------- polling ---------------- */
  const store = fakeStore();
  const notifier = fakeNotifier();
  let answer = stream;
  let calls = 0;
  const feed = Feed.create({
    storage: store, notifier, now: () => 1757007200000,
    fetch: async () => { calls++; return { ok: true, status: 200, text: async () => answer }; },
  });

  const first = await feed.poll({ topic: 'bela-test' }, { notify: false });
  t.check('the first poll succeeds', first.ok);
  t.equal('and takes the relay\'s history', feed.list().length, 2);
  t.equal('without buzzing about things that already happened', notifier.sent.length, 0);
  t.equal('so nothing is waiting to be read', feed.unread(), 0);

  answer = [stream, msg('c', 1757007000, 'Exam without study', 'DS egzaminas in 5 days')].join('\n');
  const second = await feed.poll({ topic: 'bela-test' });
  t.equal('a second poll brings back only what is new', second.fresh, 1);
  t.equal('the copy grows by one, not by three', feed.list().length, 3);
  t.equal('one notification for one new message', notifier.sent.length, 1);
  t.equal('and it is the new one', notifier.sent[0].title, 'Exam without study');
  t.equal('the channel is created once, on first use', notifier.channels.length, 1);
  t.equal('with the importance the style asked for', notifier.channels[0].importance, Feed.STYLE.importance);
  t.equal('it is now waiting to be read', feed.unread(), 1);

  await feed.poll({ topic: 'bela-test' });
  t.equal('polling again notifies about nothing', notifier.sent.length, 1);
  t.equal('and adds nothing', feed.list().length, 3);
  t.equal('the channel is not created again', notifier.channels.length, 1);

  t.check('marking read is remembered', feed.markAllRead() && feed.unread() === 0);

  /* ---------------- it survives the app closing ---------------- */
  const reopened = Feed.create({ storage: store, notifier, fetch: async () => ({ ok: false, status: 500 }) });
  t.equal('a fresh start finds the messages where it left them', reopened.list().length, 3);
  t.equal('still read', reopened.unread(), 0);
  const failed = await reopened.poll({ topic: 'bela-test' });
  t.check('a relay that answers badly is reported, not thrown', !failed.ok && failed.reason === 'http-500');
  t.equal('and nothing is lost when it does', reopened.list().length, 3);

  /* ---------------- refusals ---------------- */
  const offline = Feed.create({ storage: fakeStore(), fetch: async () => { throw new Error('no route'); } });
  const off = await offline.poll({ topic: 'x' });
  t.check('no network is "offline", not a crash', !off.ok && off.reason === 'offline');
  const noTopic = await offline.poll({ topic: '   ' });
  t.check('no topic means no request at all', !noTopic.ok && noTopic.reason === 'no-topic');
  t.equal('and the network was not touched for it', calls, 3);

  /* ---------------- a broken stored copy ---------------- */
  const bad = fakeStore();
  bad.setItem('bela-feed-v1', '{ this is not json');
  const recovered = Feed.create({ storage: bad });
  t.equal('an unreadable copy starts empty instead of killing the app', recovered.list().length, 0);
};
