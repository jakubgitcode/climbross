// Pure tug-of-war simulation. The training clock owns phases and round boundaries.
export const RIVALS = {
  easy: { label: 'Łatwy', force: 0.8 },
  medium: { label: 'Średni', force: 0.9 },
  hard: { label: 'Trudny', force: 1 },
  ghost: { label: 'Cień', force: 0 },
};
const PULL_RATE = 0.65; // rope units per second per target-force difference
const CYCLE_MS = 8000;
const hash = (set, rep) => (Math.imul(set, 73856093) ^ Math.imul(rep, 19349663)) >>> 0;

export class TugGame {
  constructor({ rival = 'medium', tolerance = 0, sets = 1, ghost = null } = {}) {
    this.rival = Object.hasOwn(RIVALS, rival) ? rival : 'medium';
    this.ghost = ghost || [];
    this.tolerance = Number.isFinite(tolerance) ? Math.max(0, Math.min(.5, tolerance)) : 0;
    this.sets = sets;
    this.x = 0; this.finalX = 0; this.round = 0; this.roundResult = null;
    this.roundsWon = 0; this.roundsLost = 0; this.roundsDrawn = 0;
    this.phase = { kind: 'ready', set: 1, rep: 1, ms: 0 };
    this.elapsed = 0; this.playerForce = 0;
    this.playerIntegral = 0; this.rivalIntegral = 0; this.measuredMs = 0;
  }
  setPhase(phase) {
    if (phase.kind === 'work' && phase.set !== this.round) {
      this.round = phase.set; this.x = 0; this.roundResult = null;
    }
    this.phase = phase;
    this.elapsed = 0;
    this.playerForce = 0;
  }
  // Events use integer milliseconds, with integration split exactly at each transition.
  // A surge and an equally long recovery balance around the selected difficulty.
  eventAt(ms) {
    if (this.rival === 'ghost') {
      const t = (this.phase.offset || 0) + ms;
      let lo = 0, hi = this.ghost.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.ghost[mid][0] <= t) lo = mid + 1; else hi = mid; }
      const sample = this.ghost[lo - 1], next = this.ghost[lo]?.[0] ?? Infinity;
      const fresh = sample && t < sample[0] + 250;
      const boundary = Math.min(next, fresh ? sample[0] + 250 : Infinity);
      return { force: fresh ? Math.min(1.5, Math.max(0, sample[1])) : 0, state: 'ghost', next: boundary - (this.phase.offset || 0) };
    }
    const base = RIVALS[this.rival].force;
    const seed = hash(this.phase.set, this.phase.rep);
    const cycle = Math.floor(ms / CYCLE_MS) * CYCLE_MS;
    const surgeAt = cycle + 2000 + (seed % 21) * 50;
    const surgeMs = 1000 + ((seed >>> 8) % 21) * 50;
    if (surgeAt + 2 * surgeMs > this.phase.ms) return { force: base, state: 'steady', next: Infinity };
    if (ms < surgeAt - 1000) return { force: base, state: 'steady', next: surgeAt - 1000 };
    if (ms < surgeAt) return { force: base, state: 'warning', next: surgeAt };
    if (ms < surgeAt + surgeMs) return { force: base + .3, state: 'surge', next: surgeAt + surgeMs };
    if (ms < surgeAt + 2 * surgeMs) return { force: base - .3, state: 'fatigue', next: surgeAt + 2 * surgeMs };
    return { force: base, state: 'steady', next: cycle + CYCLE_MS };
  }
  get active() { return this.phase.kind === 'work' && this.roundResult === null; }
  get rivalForce() { return this.active ? this.eventAt(this.elapsed).force : 0; }
  get rivalState() { return this.active ? this.eventAt(this.elapsed).state : 'rest'; }
  get warning() { return this.rivalState === 'warning'; }
  advance(ms, kg, targetKg) {
    if (!this.active || !Number.isFinite(ms) || ms <= 0 || !Number.isFinite(kg) || !Number.isFinite(targetKg) || targetKg <= 0) return;
    const raw = Math.max(0, kg / targetKg);
    const force = Math.abs(raw - 1) <= this.tolerance + 1e-12 ? 1 : Math.min(1.5, raw);
    this.playerForce = Math.min(1.5, raw);
    let left = Math.min(ms, Math.max(0, this.phase.ms - this.elapsed));
    while (left > 0 && this.active) {
      const event = this.eventAt(this.elapsed);
      let step = Math.min(left, event.next - this.elapsed);
      const speed = PULL_RATE * (force - event.force) / 1000;
      const boundaryMs = speed > 0 ? (1 - this.x) / speed : speed < 0 ? (-1 - this.x) / speed : Infinity;
      const reached = boundaryMs <= step;
      if (reached) step = Math.max(0, boundaryMs);
      this.x = Math.max(-1, Math.min(1, this.x + speed * step));
      this.finalX = this.x;
      this.playerIntegral += raw * step;
      this.rivalIntegral += event.force * step;
      this.measuredMs += step;
      this.elapsed += step;
      left -= step;
      if (reached) { this.x = Math.sign(speed); this.endRound(); }
    }
  }
  // During work a stale sensor counts as no pull; in rest both sides release.
  coast(ms) { if (this.active) this.advance(ms, 0, 1); }
  endRound() {
    if (!this.round || this.roundResult !== null) return;
    this.finalX = this.x;
    this.roundResult = Math.abs(this.x) < 1e-9 ? 'remis' : this.x > 0 ? 'wygrana' : 'przegrana';
    if (this.roundResult === 'wygrana') this.roundsWon++;
    else if (this.roundResult === 'przegrana') this.roundsLost++;
    else this.roundsDrawn++;
    this.x = 0; this.playerForce = 0;
  }
  summary() {
    return {
      type: 'tug', roundsWon: this.roundsWon, roundsLost: this.roundsLost, roundsDrawn: this.roundsDrawn,
      finalX: this.finalX, rival: this.rival,
      avgPlayer: this.measuredMs ? this.playerIntegral / this.measuredMs : 0,
      avgRival: this.measuredMs ? this.rivalIntegral / this.measuredMs : 0,
      result: this.roundsWon === this.roundsLost ? 'remis' : this.roundsWon > this.roundsLost ? 'wygrana' : 'przegrana',
    };
  }
}

/** Canvas is a view only: reduced motion never changes the simulation or its score. */
export function drawTug(canvas, game, working, hand) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.width !== 420) canvas.width = 420;
  if (canvas.height !== 210) canvas.height = 210;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const active = working && game.active;
  const player = active ? game.playerForce : 0, rival = active ? game.rivalForce : 0;
  const marker = 210 + game.x * 75;
  ctx.fillStyle = '#111e2e'; ctx.fillRect(0, 0, 420, 210);
  ctx.fillStyle = '#1b3040'; ctx.fillRect(0, 133, 420, 77);
  ctx.fillStyle = '#243e45'; ctx.fillRect(0, 145, 420, 3);
  ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillStyle = '#e9f1f7';
  ctx.fillText(`Runda ${game.round || 1}/${game.sets} · ${game.roundsWon} : ${game.roundsLost}`, 210, 22);
  const status = game.roundResult ? `Runda: ${game.roundResult}` : !working ? 'Puść i odpocznij' : game.warning ? 'Za chwilę szarpnięcie!' : game.rivalState === 'surge' ? 'Rywal szarpie!' : game.rivalState === 'fatigue' ? 'Rywal łapie oddech' : 'Przeciągnij chorągiewkę w prawo';
  ctx.font = '12px system-ui'; ctx.fillStyle = game.warning ? '#f8cf72' : '#b9cbd7';
  ctx.fillText(status, 210, 42);
  // The victory gates and centre stay fixed while the rope moves.
  ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
  for (const [x, color] of [[135, '#f78f85'], [210, '#758a98'], [285, '#7fe0b5']]) {
    ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x, 64); ctx.lineTo(x, 147); ctx.stroke();
  }
  ctx.setLineDash([]);
  const figure = (x, dir, force, color, warn) => {
    const lean = reduced ? 0 : force * 10 + (warn ? 7 : 0);
    const shoulder = x + dir * lean;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(shoulder, 78, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(shoulder, 92); ctx.lineTo(x, 117);
    ctx.lineTo(x - 13, 140); ctx.moveTo(x, 117); ctx.lineTo(x + 15, 140);
    ctx.moveTo(shoulder, 94); ctx.lineTo(x - dir * 24, 108); ctx.stroke();
    if (warn) { ctx.font = 'bold 22px system-ui'; ctx.fillStyle = '#f8cf72'; ctx.fillText('!', shoulder, 61); }
  };
  figure(79 + game.x * 12, -1, rival, '#f78f85', game.warning);
  figure(341 + game.x * 12, 1, player, '#7fe0b5', false);
  ctx.strokeStyle = '#c9a677'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(103 + game.x * 12, 108);
  ctx.quadraticCurveTo(marker, active ? 109 : 130, 317 + game.x * 12, 108); ctx.stroke();
  ctx.fillStyle = '#f8cf72'; ctx.beginPath(); ctx.moveTo(marker, active ? 109 : 119);
  ctx.lineTo(marker + 13, active ? 115 : 125); ctx.lineTo(marker, active ? 126 : 136); ctx.fill();
  ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#b9cbd7';
  ctx.fillText(`Rywal · ${Math.round(rival * 100)}% celu`, 18, 169);
  const label = { left: 'lewa', right: 'prawa', both: 'obie' }[hand] || '';
  ctx.textAlign = 'right'; ctx.fillText(`Ty (${label}) · ${Math.round(player * 100)}% celu`, 402, 169);
  for (const [x, value, color] of [[18, rival, '#f78f85'], [232, player, '#7fe0b5']]) {
    ctx.fillStyle = '#304553'; ctx.fillRect(x, 179, 170, 8);
    ctx.fillStyle = color; ctx.fillRect(x, 179, 170 * Math.min(1.5, value) / 1.5, 8);
    ctx.fillStyle = '#e9f1f7'; ctx.fillRect(x + 170 / 1.5, 177, 1, 12);
  }
}
