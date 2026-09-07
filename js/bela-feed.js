/* ============================================================
   B.E.L.A — feed
   What the PC has to say, inside this app.

   The desktop app posts one line whenever something happens that is
   worth interrupting a day for: the morning brief, a bill that changed
   price, an exam a week away with nothing studied, the Sunday review.
   It posts to a relay because a phone that has left the flat cannot be
   reached any other way — the PC has no address on the internet, and a
   phone will not hold a socket open to it.

   This file is the phone's half. It reads the same relay, keeps every
   message on the device (the relay forgets after about a day), and
   raises the app's own notification for anything new.

   THE HONEST LIMIT: this polls while the app is open, and Android
   suspends it when the app is not. Whatever the relay's own app is
   subscribed to still arrives at any hour; this is the copy that lives
   inside B.E.L.A, with B.E.L.A's own notification when it is running.

   Pure functions below the STYLE block, so the merge and the parsing
   are tested in node without a browser or a network.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BelaFeed = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================================================
     STYLE — edit freely, nothing below reads these for logic.
     `importance` is Android's own scale and is the one that decides
     whether a notification makes a sound or slides down over what you
     are doing: 5 heads-up banner + sound, 4 sound, 3 silent in the
     shade, 2 quiet and collapsed. It is fixed when the channel is
     first created, so after changing it, reinstall the app or clear
     its storage — Android will not let an app turn its own volume up
     after the fact.
     ============================================================ */
  const STYLE = {
    channelId: 'bela-feed',
    channelName: 'B.E.L.A',
    channelDescription: 'The brief, alerts and the weekly review from the PC',
    importance: 4,
    visibility: 1,
    sound: '',
    vibration: true,
    smallIcon: 'ic_stat_bela',
    iconColor: '#4ADE80',
    group: 'bela-feed',
    autoCancel: true,
    ongoing: false,
    /* Put something in front of every title, or leave it empty. The PC
       already sends "Morning brief", so "B.E.L.A · Morning brief" reads
       twice unless you want the reminder. */
    titlePrefix: '',
    /* Android shows two lines collapsed and the rest when pulled down.
       false keeps every notification to its two lines. */
    expandable: true,
    /* How the icon-shade summary line reads when several are waiting. */
    summary: (n) => `${n} from B.E.L.A`,
  };

  const PROTOCOL = 1;
  const KEEP = 300;                 // messages held on the phone
  const DEFAULT_SERVER = 'https://ntfy.sh';

  /* ---------- pure ---------- */

  /* The relay answers with one JSON object per line, not an array, and
     mixes housekeeping in with the real thing: `open` when the stream
     starts, `keepalive` every so often. Only `message` is news. A torn
     last line is normal when a stream is cut and must not lose the
     lines that arrived whole. */
  function parseStream(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let obj;
      try { obj = JSON.parse(s); } catch (e) { continue; }
      if (!obj || obj.event !== 'message' || !obj.id) continue;
      out.push({
        id: String(obj.id),
        at: Number(obj.time) * 1000 || Date.now(),
        title: typeof obj.title === 'string' ? obj.title : '',
        body: typeof obj.message === 'string' ? obj.message : '',
        priority: Number(obj.priority) || 3,
        tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === 'string') : [],
      });
    }
    return out;
  }

  /* Newest first, one entry per relay id, capped. The relay is polled
     with an overlap on purpose — a message seen twice is normal and a
     message seen twice must not appear twice. */
  function merge(existing, incoming, cap) {
    const byId = new Map();
    for (const m of existing || []) if (m && m.id) byId.set(String(m.id), m);
    for (const m of incoming || []) {
      if (!m || !m.id) continue;
      const prev = byId.get(String(m.id));
      byId.set(String(m.id), prev ? { ...m, read: prev.read } : m);
    }
    return [...byId.values()]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, cap || KEEP);
  }

  /* The relay keeps about a day. Asking for a fixed window rather than
     "since the last id I saw" means a phone that was off for a week
     still gets what is left instead of an empty answer. */
  function pollUrl(server, topic, sinceSeconds) {
    const base = String(server || DEFAULT_SERVER).replace(/\/+$/, '');
    const t = encodeURIComponent(String(topic || '').trim());
    const since = Math.max(60, Math.min(Number(sinceSeconds) || 86400, 86400 * 7));
    return `${base}/${t}/json?poll=1&since=${since}s`;
  }

  const unreadOf = (messages) => (messages || []).filter((m) => m && !m.read).length;

  /* The PC puts "B.E.L.A:" in front of every title for the relay's own app,
     where it names the sender among others. Inside B.E.L.A everything is
     from it, so the prefix would only repeat the brand down the page. */
  const displayTitle = (title) =>
    String(title || '').replace(/^\s*B\.?\s*E\.?\s*L\.?\s*A\.?\s*[:·—–-]\s*/i, '').trim() || 'B.E.L.A';

  /* The PC does not say what a message is; its title does. Read it, so the
     list can be scanned and filtered by kind without a protocol change. */
  function kindOf(title) {
    const t = displayTitle(title).toLowerCase();
    if (/\bbrief\b/.test(t)) return 'brief';
    if (/\bjob\b|\bfinished\b|\bdone\b|\bscheduled\b|\breport\b/.test(t)) return 'job';
    if (/\breview\b|\bweekly\b|\bweek\b/.test(t)) return 'review';
    if (/alert|changed|due|exam|halt|error|warning|overdue|missed|without|unusual|anomal|spike|drop|fail/.test(t)) return 'alert';
    return 'note';
  }

  /* Android wants a 32-bit id and the relay hands out strings, so the
     string decides the number. The same message therefore always lands
     on the same notification instead of stacking up a new one each poll. */
  function notificationId(id) {
    let h = 5381;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return (h % 2000000) + 9000;      // clear of the workout note at 8801
  }

  /* One message as Android will show it. Style comes from the block at
     the top; nothing here decides how it looks. */
  function notificationFor(msg, style) {
    const st = style || STYLE;
    const title = (st.titlePrefix || '') + (msg.title || 'B.E.L.A');
    const body = msg.body || '';
    const n = {
      id: notificationId(msg.id),
      title,
      body: st.expandable ? body : body.split('\n')[0],
      smallIcon: st.smallIcon,
      iconColor: st.iconColor,
      channelId: st.channelId,
      group: st.group,
      autoCancel: st.autoCancel,
      ongoing: st.ongoing,
      extra: { belaId: msg.id },
    };
    if (st.expandable && body.includes('\n')) n.largeBody = body;
    return n;
  }

  const channelFor = (style) => {
    const st = style || STYLE;
    return {
      id: st.channelId, name: st.channelName, description: st.channelDescription,
      importance: st.importance, visibility: st.visibility,
      sound: st.sound, vibration: st.vibration, lights: false,
    };
  };

  /* ---------- the stateful half ---------- */

  /* Everything it touches is injected: the network, where it keeps its
     copy, and the notifier. The tests hand it fakes; the app hands it
     fetch, localStorage and Capacitor. */
  function create(opts) {
    const o = opts || {};
    const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
    const store = o.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const key = o.key || 'bela-feed-v1';
    const now = o.now || (() => Date.now());
    const notifier = o.notifier || null;        // { schedule(payload), createChannel(ch), allowed() }
    const style = o.style || STYLE;
    const onChange = o.onChange || (() => {});
    const log = o.log || (() => {});

    let state = { protocol: PROTOCOL, messages: [], lastPollAt: 0, lastError: null };
    try {
      const raw = store && store.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.messages)) state = { ...state, ...p };
      }
    } catch (e) { log('feed: stored copy unreadable, starting fresh'); }

    const save = () => {
      try { if (store) store.setItem(key, JSON.stringify(state)); }
      catch (e) { log('feed: could not save'); }
    };

    let channelReady = false;
    async function ensureChannel() {
      if (channelReady || !notifier || !notifier.createChannel) return;
      try { await notifier.createChannel(channelFor(style)); channelReady = true; }
      catch (e) { /* channels are Android-only */ }
    }

    return {
      list: () => state.messages.slice(),
      unread: () => unreadOf(state.messages),
      lastPollAt: () => state.lastPollAt,
      lastError: () => state.lastError,

      markAllRead() {
        let touched = false;
        state.messages = state.messages.map((m) => (m.read ? m : (touched = true, { ...m, read: true })));
        if (touched) { save(); onChange(); }
        return touched;
      },

      clear() { state.messages = []; save(); onChange(); },

      /* One poll. `notify` is false on the very first one after a topic
         is entered: the relay hands back a day of history at once, and
         nobody wants nine notifications for things that already happened. */
      async poll(cfg, { notify = true, since = 86400 } = {}) {
        const topic = cfg && cfg.topic ? String(cfg.topic).trim() : '';
        if (!topic) return { ok: false, reason: 'no-topic' };
        if (!fetchImpl) return { ok: false, reason: 'no-network' };
        const url = pollUrl(cfg.server, topic, since);
        let text;
        try {
          const res = await fetchImpl(url, { method: 'GET' });
          if (!res || !res.ok) {
            state.lastError = res ? `http-${res.status}` : 'no-response';
            state.lastPollAt = now(); save(); onChange();
            return { ok: false, reason: state.lastError };
          }
          text = await res.text();
        } catch (e) {
          state.lastError = 'offline';
          state.lastPollAt = now(); save(); onChange();
          return { ok: false, reason: 'offline' };
        }

        const incoming = parseStream(text);
        const known = new Set(state.messages.map((m) => m.id));
        const fresh = incoming.filter((m) => !known.has(m.id));
        state.messages = merge(state.messages, incoming, KEEP);
        state.lastPollAt = now();
        state.lastError = null;
        /* The first sight of a topic is history, not news: keep it, mark
           it read, say nothing. */
        if (!notify) state.messages = state.messages.map((m) => ({ ...m, read: true }));
        save();
        onChange();

        if (notify && fresh.length && notifier && notifier.schedule) {
          const allowed = notifier.allowed ? await notifier.allowed() : true;
          if (allowed) {
            await ensureChannel();
            try {
              await notifier.schedule({
                notifications: fresh.slice(0, 5).map((m) => notificationFor(m, style)),
              });
            } catch (e) { log('feed: notification refused'); }
          }
        }
        return { ok: true, fresh: fresh.length, total: state.messages.length };
      },
    };
  }

  return {
    create, parseStream, merge, pollUrl, unreadOf, notificationFor, notificationId,
    channelFor, displayTitle, kindOf, STYLE, DEFAULT_SERVER, KEEP, PROTOCOL,
  };
}));
