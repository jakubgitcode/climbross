// Minimal force/time line chart on a canvas. samples: [[t_ms, kg], ...]

export function drawChart(canvas, samples, { hand = 'right', maxKg = 0, peak = null, fixedSpanMs = 0 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const line = color(`--${hand}`);
  const grid = color('--chart-grid');
  const muted = color('--muted');

  const pad = { l: 34, r: 8, t: 10, b: 18 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const lastT = samples.length ? samples[samples.length - 1][0] : 0;
  const span = Math.max(fixedSpanMs || lastT, 1000);
  let top = Math.max(10, maxKg * 1.1);
  for (const [, kg] of samples) if (kg > top) top = kg;
  top = niceCeil(top * 1.05);

  const x = (t) => pad.l + (t / span) * pw;
  const y = (kg) => pad.t + ph - (Math.max(0, kg) / top) * ph;

  // grid + y labels
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const step = niceStep(top / 4);
  for (let v = 0; v <= top + 1e-6; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(v)), pad.l - 6, yy);
  }
  // x label
  if (!fixedSpanMs) {
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${(span / 1000).toFixed(1)} s`, w - pad.r, h - 4);
  }

  // profile max reference
  if (maxKg > 0) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = muted;
    const yy = Math.round(y(maxKg)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = muted;
    ctx.fillText('max', pad.l + 4, yy - 2);
  }

  // force line
  if (samples.length > 1) {
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach(([t, kg], i) => (i ? ctx.lineTo(x(t), y(kg)) : ctx.moveTo(x(t), y(kg))));
    ctx.stroke();
  }

  // peak marker
  if (peak && peak[1] > 0) {
    const px = x(peak[0]);
    const py = y(peak[1]);
    ctx.fillStyle = line;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = px > w - 60 ? 'right' : 'left';
    ctx.fillText(`${peak[1].toFixed(1)}`, px + (ctx.textAlign === 'left' ? 6 : -6), Math.max(py - 4, 14));
  }
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function niceCeil(v) {
  const s = niceStep(v / 4);
  return Math.ceil(v / s) * s;
}
