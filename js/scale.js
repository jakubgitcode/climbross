// One set per hand; compare the same repetition against the preceding set.
export class ScaleGame {
  constructor({ tolerance = .15 } = {}) { this.tolerance = tolerance; this.weighed = 0; this.hold = 0; this.elapsed = 0; this.samples = new Map(); this.error = 0; this.comparedMs = 0; this.ratio = 0; this.reference = null; }
  setPhase(phase) { this.phase = phase; this.elapsed = 0; this.hold = 0; this.scored = false; this.reference = null; }
  advance(ms, kg, target) {
    if (this.phase?.kind !== 'work' || !(ms > 0) || !(target > 0) || !Number.isFinite(kg)) return;
    const ratio = Math.max(0, kg / target), phase = this.phase, key = `${Math.floor((phase.set - 1) / 2)}:${phase.rep}`, first = phase.set % 2 === 1;
    if (first) {
      if (!this.samples.has(key)) this.samples.set(key, []);
      this.samples.get(key).push([this.elapsed, this.elapsed + ms, ratio]);
    } else {
      const samples = this.samples.get(key) || [];
      const end = this.elapsed + ms;
      let lo = 0, hi = samples.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid][1] <= this.elapsed) lo = mid + 1; else hi = mid; }
      this.reference = null;
      for (let i = lo; i < samples.length && samples[i][0] < end; i++) {
        const [start, stop, ref] = samples[i];
        const overlap = Math.max(0, Math.min(end, stop) - Math.max(this.elapsed, start));
        if (overlap) {
          this.reference = ref;
          if (ratio > 0 || ref > 0) { this.error += Math.min(1, Math.abs(ratio - ref)) * overlap; this.comparedMs += overlap; }
        }
      }
    }
    this.ratio = ratio; this.elapsed += ms;
    this.hold = Math.abs(ratio - 1) <= this.tolerance + 1e-12 ? this.hold + ms : 0;
    if (!this.scored && this.hold >= 2000) { this.weighed++; this.scored = true; }
  }
  coast(ms) { if (this.phase?.kind === 'work' && Number.isFinite(ms) && ms > 0) { this.elapsed += ms; this.hold = 0; this.ratio = 0; this.reference = null; } }
  summary() { return { type:'scale', weighed:this.weighed, symmetry:this.comparedMs ? Math.max(0, 100 * (1 - this.error / this.comparedMs)) : null }; }
}

export function drawScale(canvas, game) {
  const c = canvas.getContext('2d'); if (!c) return;
  if (canvas.width !== 420) canvas.width = 420;
  if (canvas.height !== 210) canvas.height = 210;
  const working = game.phase?.kind === 'work';
  const balanced = working && Math.abs(game.ratio - 1) <= game.tolerance + 1e-12;
  const success = working && game.scored && balanced;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pulse = reduced ? 0 : Math.sin((globalThis.performance?.now() ?? 0) / 250) * 3;
  c.fillStyle = '#132637'; c.fillRect(0, 0, 420, 210);
  c.fillStyle = success ? '#174c45' : '#1c3645'; c.fillRect(8, 8, 404, 194);
  c.fillStyle = '#f6f7eb'; c.font = 'bold 15px system-ui'; c.textAlign = 'left';
  c.fillText(`ZWAŻONE  ★ ${game.weighed}`, 18, 28);
  c.textAlign = 'right'; c.fillStyle = success ? '#a9ffcd' : '#d8e8eb';
  c.fillText(success ? 'RÓWNOWAGA! +1 ★' : balanced ? 'TRZYMAJ RÓWNO…' : working ? 'ZNAJDŹ RÓWNOWAGĘ' : 'ODPOCZYNEK', 402, 28);
  const angle = Math.max(-.25, Math.min(.25, (game.ratio - (game.reference ?? 1)) * .3));
  c.strokeStyle = '#aabcc0'; c.lineWidth = 3; c.beginPath(); c.moveTo(210, 103); c.lineTo(210, 154); c.moveTo(180, 154); c.lineTo(240, 154); c.stroke();
  c.save(); c.translate(210, 103); c.rotate(-angle);
  c.strokeStyle = success ? '#9bffd0' : '#f6d58f'; c.lineWidth = 6; c.beginPath(); c.moveTo(-110, 0); c.lineTo(110, 0); c.stroke();
  c.lineWidth = 2; c.beginPath(); c.moveTo(-100, 0); c.lineTo(-100, 26); c.moveTo(100, 0); c.lineTo(100, 26); c.stroke();
  c.fillStyle = '#d8b983'; c.fillRect(-127, 26, 54, 7); c.fillRect(73, 26, 54, 7);
  c.fillStyle = '#9aaab0'; c.beginPath(); c.arc(-100, 17, 13, 0, Math.PI * 2); c.fill();
  const effort = Math.max(0, Math.min(1.5, game.ratio)); c.fillStyle = balanced ? '#78e6bd' : '#ffa971';
  c.fillRect(78, 24 - 24 * effort, 44, 24 * effort); c.restore();
  if (success) { c.fillStyle = '#fff3a4'; c.font = 'bold 19px system-ui'; c.textAlign = 'center'; c.fillText('✦', 210, 78 - pulse); c.fillText('✦', 55, 96 + pulse); c.fillText('✦', 365, 96 - pulse); }
  c.textAlign = 'left'; c.fillStyle = '#e6f1ed'; c.font = '13px system-ui';
  const ref = game.reference == null ? (game.phase?.kind !== 'work' ? 'Przygotuj się do ważenia' : game.phase.set % 2 ? 'Pierwsza ręka: zapamiętuję siłę' : 'Brak danych wzorcowych dla tej chwili') : `Wzór pierwszej ręki: ${Math.round(game.reference * 100)}% celu`;
  c.fillText(ref, 18, 177); c.textAlign = 'right'; c.fillText(`Siła ${Math.round(game.ratio * 100)}%`, 402, 177);
  c.fillStyle = '#10202a'; c.fillRect(18, 187, 384, 9); c.fillStyle = success ? '#ffda76' : '#7be5bd'; c.fillRect(18, 187, 384 * Math.min(1, game.hold / 2000), 9);
}
