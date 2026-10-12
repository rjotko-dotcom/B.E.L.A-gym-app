/* B.E.L.A — charts. A line (bodyweight, a lift's best) and weekly bars
   (volume), drawn as SVG strings that animate themselves in CSS, with a
   touch crosshair and tooltip. Data in, markup out. */
(function () {
  'use strict';
  const { esc, fmtNum, fmtDate, fmtShortDate } = window.BelaFormat;

  const CH = { w: 360, h: 200, pad: { t: 16, r: 14, b: 28, l: 40 } };

  function niceTicks(max, min = 0) {
    const span = Math.max(0.001, max - min);
    const raw = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const lo = Math.floor(min / step) * step;
    const ticks = [];
    for (let t = lo; t <= max + step * 0.001; t += step) ticks.push(Math.round(t * 100) / 100);
    return ticks;
  }

  let chartSeq = 0;
  function lineChartSVG(series, u, ariaLabel, stroke) {
    const { w, h, pad } = CH;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const values = series.map((p) => p.v);
    const vMaxRaw = Math.max(...values), vMinRaw = Math.min(...values);
    // zoom the y-window for series that hover in a narrow band (e.g. bodyweight)
    const useMin = vMinRaw > 0 && (vMaxRaw - vMinRaw) < vMinRaw * 0.5;
    const ticks = useMin
      ? niceTicks(vMaxRaw + (vMaxRaw - vMinRaw || 1) * 0.15, Math.max(0, vMinRaw - (vMaxRaw - vMinRaw || 1) * 0.15))
      : niceTicks(vMaxRaw * 1.1);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const x = (i) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const y = (val) => pad.t + ih - ((val - yMin) / (yMax - yMin)) * ih;

    const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const lastIdx = series.length - 1;
    const gid = 'lcg' + (++chartSeq);

    return `
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(ariaLabel)}">
      ${ticks.map((t) => `
        <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${pad.l - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="var(--ink-muted)" style="font-variant-numeric:tabular-nums">${fmtNum(t)}</text>`).join('')}
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="var(--baseline)" stroke-width="1"/>
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${stroke}" stop-opacity="0.22"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient></defs>
      ${series.length > 1 ? `<path class="chart-area" d="${path} L${x(lastIdx).toFixed(1)},${pad.t + ih} L${x(0).toFixed(1)},${pad.t + ih} Z" fill="url(#${gid})"/>` : ''}
      <path class="chart-line" pathLength="1" d="${path}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${series.map((p, i) => `<circle class="chart-pt" style="--d:${Math.round((i / Math.max(1, lastIdx)) * 600)}ms" cx="${x(i)}" cy="${y(p.v)}" r="4" fill="${stroke}" stroke="var(--surface-1)" stroke-width="2" data-i="${i}"/>`).join('')}
      <text x="${x(lastIdx) - 6}" y="${Math.max(pad.t + 10, y(series[lastIdx].v) - 9)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-1)">${fmtNum(series[lastIdx].v)} ${esc(u)}</text>
      <text x="${x(0)}" y="${h - 8}" text-anchor="start" font-size="10" fill="var(--ink-muted)">${fmtShortDate(series[0].t)}</text>
      <text x="${x(lastIdx)}" y="${h - 8}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${fmtShortDate(series[lastIdx].t)}</text>
      <line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--baseline)" stroke-width="1" opacity="0"/>
    </svg>`;
  }

  function attachLineHover(wrap, series, u) {
    const svg = wrap?.querySelector('svg');
    if (!svg || series.length < 2) return;
    const { w, pad } = CH;
    const iw = w - pad.l - pad.r;
    const cross = svg.querySelector('.crosshair');
    let tip = null;

    const showAt = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((clientX - rect.left) / rect.width) * w;
      const frac = Math.min(1, Math.max(0, (relX - pad.l) / iw));
      const i = Math.round(frac * (series.length - 1));
      const p = series[i];
      const px = pad.l + (i / (series.length - 1)) * iw;
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      cross.setAttribute('opacity', '1');
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        wrap.appendChild(tip);
      }
      tip.innerHTML = `<span class="tip-date">${fmtDate(p.t)}</span>` + (p.note
        ? `<b>${esc(p.note)}</b>`
        : `<b>${fmtNum(p.v)} ${esc(u)}</b>${p.set ? ` <span style="color:var(--ink-2)">(${fmtNum(p.set.weight)}×${p.set.reps})</span>` : ''}`);
      const wrapRect = wrap.getBoundingClientRect();
      const dot = svg.querySelector(`circle[data-i="${i}"]`)?.getBoundingClientRect();
      tip.style.left = `${(px / w) * wrapRect.width}px`;
      tip.style.top = `${dot ? Math.max(30, dot.top - wrapRect.top) : 30}px`;
    };
    const hide = () => { cross.setAttribute('opacity', '0'); tip?.remove(); tip = null; };

    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }

  function barChartSVG(weeks) {
    const { w, h, pad } = CH;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const vMax = Math.max(...weeks.map((x) => x.v), 1) * 1.1;
    const ticks = niceTicks(vMax);
    const yMax = ticks[ticks.length - 1];
    const n = weeks.length;
    const slot = iw / n;
    // bars a little over half their slot: columns with air between them read
    // as weeks, a solid wall of white read as one block
    const barW = Math.max(6, slot * 0.62);
    const y = (val) => pad.t + ih - (val / yMax) * ih;
    const fmtTick = (t) => (t >= 1000 ? `${t / 1000}k` : t);

    return `
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly training volume">
      ${ticks.map((t) => `
        <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${pad.l - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="var(--ink-muted)" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`).join('')}
      ${weeks.map((wk, i) => {
        const bx = pad.l + i * slot + (slot - barW) / 2;
        const by = y(wk.v);
        const bh = Math.max(0, pad.t + ih - by);
        if (!bh) return `<rect x="${bx}" y="${pad.t + ih - 1}" width="${barW}" height="1" fill="var(--grid)" data-i="${i}"/>`;
        const r = Math.min(6, barW / 2, bh);
        // this week in full ink, the weeks behind it a step quieter
        return `<path class="chart-bar" style="--d:${i * 45}ms" data-i="${i}" fill="${i === n - 1 ? 'var(--series-1)' : 'color-mix(in srgb, var(--series-1) 55%, transparent)'}" d="M${bx},${pad.t + ih} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${pad.t + ih} Z"/>`;
      }).join('')}
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="var(--baseline)" stroke-width="1"/>
      <text x="${pad.l}" y="${h - 8}" text-anchor="start" font-size="10" fill="var(--ink-muted)">${esc(weeks[0].label)}</text>
      <text x="${w - pad.r}" y="${h - 8}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${esc(weeks[n - 1].label)}</text>
    </svg>`;
  }

  function attachBarHover(wrap, weeks, u) {
    const svg = wrap?.querySelector('svg');
    if (!svg) return;
    const { w, pad } = CH;
    const iw = w - pad.l - pad.r;
    const slot = iw / weeks.length;
    let tip = null;

    const showAt = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((clientX - rect.left) / rect.width) * w;
      const i = Math.min(weeks.length - 1, Math.max(0, Math.floor((relX - pad.l) / slot)));
      const wk = weeks[i];
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        wrap.appendChild(tip);
      }
      tip.innerHTML = `<span class="tip-date">Week of ${esc(wk.label)}</span><b>${wk.v.toLocaleString()} ${esc(u)}</b>`;
      const wrapRect = wrap.getBoundingClientRect();
      const cx = pad.l + i * slot + slot / 2;
      tip.style.left = `${(cx / w) * wrapRect.width}px`;
      tip.style.top = `28px`;
    };
    const hide = () => { tip?.remove(); tip = null; };
    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }

  window.BelaCharts = { CH, niceTicks, lineChartSVG, attachLineHover, barChartSVG, attachBarHover };
})();
