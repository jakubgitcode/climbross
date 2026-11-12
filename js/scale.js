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
        if (overlap) { this.error += Math.min(1, Math.abs(ratio - ref)) * overlap; this.comparedMs += overlap; this.reference = ref; }
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
  canvas.width = 420; canvas.height = 210;
  c.fillStyle = '#20323b'; c.fillRect(0, 0, 420, 210);
  const angle = Math.max(-.3, Math.min(.3, (game.ratio - (game.reference ?? 1)) * .35));
  c.save(); c.translate(210, 110); c.rotate(-angle); c.strokeStyle = '#e8d3a8'; c.lineWidth = 5; c.beginPath(); c.moveTo(-130, 0); c.lineTo(130, 0); c.stroke(); c.restore();
  c.fillStyle = '#fff'; c.font = 'bold 16px system-ui'; c.fillText(`Zważone: ${game.weighed}`, 16, 24);
  c.fillText(game.reference == null ? 'Pierwsza ręka: zapamiętuję siłę' : `Wzór pierwszej ręki: ${Math.round(game.reference * 100)}% celu`, 16, 49);
  c.fillStyle = '#fff'; c.font = '13px system-ui'; c.fillText(`Twoja siła: ${Math.round(game.ratio * 100)}% celu`, 16, 70);
  c.fillStyle = '#0d2029'; c.fillRect(110, 175, 200, 12); c.fillStyle = '#80d6ae'; c.fillRect(110, 175, 200 * Math.min(1, game.hold / 2000), 12);
}
