/* B.E.L.A — workouts for a day without the gym (16.12).

   Follow-along sessions: each move is done for `work` seconds, then `rest`,
   round after round, with nothing to equip. They are our own — written from
   the exercise library, not copied from any video. A session is pure data;
   phases() turns it into the timeline the player walks through.

   Videos are his: a YouTube link, a name, the minutes and what it works.
   The default list holds the one he asked for. */
(function () {
  const SESSIONS = [
    { id: 'home-abs', name: 'Abs', min: 10, focus: 'Core', work: 45, rest: 15, rounds: 1,
      blurb: 'Ten moves, 45 s on, 15 s off',
      moves: ['crunch', 'reverse-crunch', 'bicycle-crunch', 'leg-raise', 'plank', 'heel-touch', 'russian-twist', 'flutter-kick', 'plank-shoulder-tap', 'mountain-climber'] },
    { id: 'home-full', name: 'Full body', min: 20, focus: 'Full body', work: 40, rest: 20, rounds: 2,
      blurb: 'Ten moves, twice through',
      moves: ['jumping-jack', 'bw-squat', 'push-up', 'reverse-lunge', 'glute-bridge', 'plank', 'burpee', 'superman', 'mountain-climber', 'high-knees'] },
    { id: 'home-upper', name: 'Upper body', min: 15, focus: 'Upper', work: 40, rest: 20, rounds: 3,
      blurb: 'Push-ups, pikes and a chair, three rounds',
      moves: ['push-up', 'pike-push-up', 'bench-dip', 'close-grip-push-up', 'superman'] },
    { id: 'home-legs', name: 'Legs', min: 15, focus: 'Legs', work: 40, rest: 20, rounds: 3,
      blurb: 'Squats, lunges, bridges, three rounds',
      moves: ['bw-squat', 'reverse-lunge', 'glute-bridge', 'wall-sit', 'jump-squat'] },
    { id: 'home-hiit', name: 'HIIT', min: 12, focus: 'Cardio', work: 40, rest: 20, rounds: 3,
      blurb: 'Four hard moves, three rounds',
      moves: ['burpee', 'high-knees', 'jump-squat', 'mountain-climber'] },
  ];

  const FOCUS = ['Core', 'Full body', 'Upper', 'Legs', 'Cardio', 'Mobility'];

  const DEFAULT_VIDEOS = [
    { id: 'v-sixpack', name: '10 min sixpack', by: 'Pamela Reif', url: 'https://youtu.be/Q-vuR4PJh2c', min: 10, focus: 'Core' },
  ];

  const PREP = 10;

  /* The timeline: get ready, then work / rest for every move of every round.
     No rest after the very last move — the session is over. */
  function phases(s) {
    const out = [{ kind: 'prep', secs: PREP, ex: s.moves[0], round: 1, n: 0 }];
    const total = s.moves.length * s.rounds;
    let n = 0;
    for (let r = 1; r <= s.rounds; r++) {
      s.moves.forEach((ex, i) => {
        n += 1;
        out.push({ kind: 'work', secs: s.work, ex, round: r, n });
        if (n < total && s.rest > 0) {
          const next = i + 1 < s.moves.length ? s.moves[i + 1] : s.moves[0];
          out.push({ kind: 'rest', secs: s.rest, ex: next, round: i + 1 < s.moves.length ? r : r + 1, n });
        }
      });
    }
    return out;
  }
  const totalSecs = (s) => phases(s).reduce((t, p) => t + p.secs, 0);

  // a YouTube link in any of its spellings → the video id, else null
  function youtubeId(url) {
    const u = String(url || '').trim();
    const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/i);
    return m ? m[1] : null;
  }
  const cleanUrl = (url) => {
    const id = youtubeId(url);
    if (id) return 'https://youtu.be/' + id;
    return /^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : null;
  };

  window.BelaHome = { SESSIONS, FOCUS, DEFAULT_VIDEOS, PREP, phases, totalSecs, youtubeId, cleanUrl };
})();
