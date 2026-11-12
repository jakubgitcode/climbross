// The training clock owns work boundaries; unfinished work is never scored.
export class ClimbGame {
  constructor({ tolerance = .15 } = {}) { this.tolerance = tolerance; this.confidence = 0; this.height = 0; this.clean = 0; this.falls = 0; this.phase = null; }
  setPhase(phase) { this.phase = phase; if (phase.kind === 'work') this.confidence = 0; }
  advance(ms, kg, target) {
    if (this.phase?.kind !== 'work' || !(ms > 0) || !(target > 0) || !Number.isFinite(kg)) return;
    const inZone = Math.abs(kg / target - 1) <= this.tolerance + 1e-12;
    this.confidence = Math.max(0, Math.min(1, this.confidence + (inZone ? 1 : -1) * ms / Math.min(2000, this.phase.ms)));
  }
  coast(ms) { this.advance(ms, 0, 1); }
  endWork() { if (this.phase?.kind !== 'work') return; if (this.confidence >= .8) { this.clean++; this.height++; } else { this.falls++; this.height = Math.max(0, this.height - 1); } this.phase = null; }
  summary() { return { type:'climb', height:this.height, clean:this.clean, falls:this.falls }; }
}

export function drawClimb(canvas, game, hand) {
  const c = canvas.getContext('2d'); if (!c) return;
  canvas.width = 420; canvas.height = 210;
  c.fillStyle = '#273744'; c.fillRect(0, 0, 420, 210);
  for (let i = 0; i < 6; i++) { c.fillStyle = i === 1 ? '#ffd166' : '#72c2ae'; c.beginPath(); c.ellipse(90 + (i % 2) * 180, 185 - i * 30, 14, 6, 0, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#fff'; c.font = 'bold 16px system-ui'; c.fillText(`Wysokość: ${game.height} · chwyty: ${game.clean} · loty: ${game.falls}`, 12, 24);
  c.fillText(`Ręka: ${hand === 'left' ? 'lewa' : 'prawa'}`, 12, 48);
  c.fillStyle = '#16252c'; c.fillRect(125, 177, 170, 12); c.fillStyle = '#80d6ae'; c.fillRect(125, 177, 170 * game.confidence, 12);
}
