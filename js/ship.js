// Ship with two engines. The board has one force channel, so the hands work in turns:
// the left hand drives the left engine (the ship yaws to the right), the right hand the
// right engine (yaws to the left). Equal effort cancels out; a weaker hand pulls the ship
// off course. Thrust is force relative to the target of the hand that is pulling, so a
// plan in % of each hand's maximum rewards equal effort and a plan in kg exposes asymmetry.
export const HALF_WIDTH = 1.2;   // channel half-width, in distance units
const V_MAX = 1;                 // units/s at thrust 1
const THETA_MAX = 0.1;           // rad of yaw at thrust 1
const MAX_THRUST = 1.5;
const TAU_SPEED = { burn: 1.2, coast: 2.5 };
const TAU_YAW = { burn: 0.8, coast: 1.0 };
const TRAIL_STEP = 0.08;
const TRAIL_LENGTH = 90;

export class ShipGame {
  constructor() {
    this.distance = 0; this.hits = 0;
    this.y = 0; this.heading = 0; this.speed = 0; this.touching = false;
    this.engine = { left: { thrustMs: 0, ms: 0 }, right: { thrustMs: 0, ms: 0 } };
    this.trail = [];
  }
  /** Force is applied for `ms` by `hand` against that hand's target. */
  advance(ms, kg, hand, targetKg) {
    if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(kg) || !(targetKg > 0) || !(hand in this.engine)) return;
    const thrust = Math.min(MAX_THRUST, Math.max(0, kg / targetKg));
    const e = this.engine[hand];
    e.thrustMs += thrust * ms; e.ms += ms;
    this.#run(ms, thrust, hand === 'left' ? 1 : -1, 'burn');
  }
  /** Rest, preparation, or a stale sensor: the ship keeps gliding. */
  coast(ms) {
    if (Number.isFinite(ms) && ms > 0) this.#run(ms, 0, 0, 'coast');
  }
  #run(ms, thrust, side, mode) {
    for (let left = ms; left > 0;) {
      const dt = Math.min(10, left); left -= dt;
      const s = dt / 1000;
      this.speed += (thrust * V_MAX - this.speed) * (1 - Math.exp(-s / TAU_SPEED[mode]));
      this.heading += (side * thrust * THETA_MAX - this.heading) * (1 - Math.exp(-s / TAU_YAW[mode]));
      this.y += this.speed * Math.sin(this.heading) * s;
      this.distance += this.speed * s;
      if (Math.abs(this.y) > HALF_WIDTH) {
        if (!this.touching) { this.touching = true; this.hits++; this.speed *= 0.5; }
        if (Math.sign(this.heading) === Math.sign(this.y)) this.heading = 0;
        this.y = Math.sign(this.y) * HALF_WIDTH;
      } else this.touching = false;
      const last = this.trail.at(-1);
      if (!last || this.distance - last[0] >= TRAIL_STEP) {
        this.trail.push([this.distance, this.y]);
        if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
      }
    }
  }
  /** Average thrust of each engine as a share of its target (1 = exactly on target). */
  average(hand) { const e = this.engine[hand]; return e.ms ? e.thrustMs / e.ms : 0; }
  summary() {
    const left = this.average('left'), right = this.average('right');
    const stronger = Math.max(left, right);
    return {
      type: 'ship', distance: this.distance, hits: this.hits,
      leftThrust: left, rightThrust: right,
      asymmetryPct: stronger > 0 ? Math.abs(left - right) / stronger * 100 : 0,
    };
  }
}

export function drawShip(canvas, game, working, hand) {
  const ratio = devicePixelRatio || 1, width = canvas.clientWidth || 320;
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(210 * ratio); }
  const c = canvas.getContext('2d'); c.setTransform(canvas.width / 420, 0, 0, canvas.height / 210, 0, 0);
  const unit = 55, mid = 105, shipX = 100, top = mid - HALF_WIDTH * unit, bottom = mid + HALF_WIDTH * unit;
  const water = c.createLinearGradient(0, 0, 0, 210); water.addColorStop(0, '#0f3a55'); water.addColorStop(1, '#0b2a40');
  c.fillStyle = water; c.fillRect(0, 0, 420, 210);
  c.fillStyle = '#0d1f2b'; c.fillRect(0, 0, 420, top - 6); c.fillRect(0, bottom + 6, 420, 210 - bottom - 6);
  c.fillStyle = '#1f4b3a'; c.fillRect(0, top - 6, 420, 6); c.fillRect(0, bottom, 420, 6);
  // Buoys scroll past as the ship advances.
  for (let k = Math.floor(game.distance) - 2; k <= game.distance + 5; k++) {
    const x = shipX + (k - game.distance) * unit * 1.6;
    if (x < -10 || x > 430) continue;
    c.fillStyle = k % 2 ? '#ff7087' : '#ffcd75';
    c.beginPath(); c.arc(x, top - 2, 4, 0, Math.PI * 2); c.arc(x, bottom + 2, 4, 0, Math.PI * 2); c.fill();
  }
  // Centre line and wake.
  c.setLineDash([6, 8]); c.strokeStyle = '#ffffff33'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, mid); c.lineTo(420, mid); c.stroke(); c.setLineDash([]);
  if (game.trail.length > 1) {
    c.strokeStyle = '#b9e8ff88'; c.lineWidth = 2; c.beginPath();
    game.trail.forEach(([d, y], i) => { const x = shipX + (d - game.distance) * unit * 1.6; i ? c.lineTo(x, mid + y * unit) : c.moveTo(x, mid + y * unit); });
    c.stroke();
  }
  // Ship, pointing right. The port (left) engine is the upper one, so burning it yaws the ship down.
  c.save(); c.translate(shipX, mid + game.y * unit); c.rotate(game.heading * 3);
  c.fillStyle = '#7be6e5'; c.beginPath(); c.moveTo(24, 0); c.lineTo(-16, -11); c.lineTo(-16, 11); c.closePath(); c.fill();
  c.fillStyle = '#0c2740'; c.fillRect(-4, -4, 12, 8);
  for (const [side, y] of [['left', -9], ['right', 9]]) {
    const active = working && hand === side;
    c.fillStyle = active ? '#ffcd75' : '#41586a'; c.fillRect(-22, y - 3, 8, 6);
    if (active) { c.fillStyle = '#ff9a3c'; c.beginPath(); c.moveTo(-22, y - 3); c.lineTo(-34 - Math.random() * 6, y); c.lineTo(-22, y + 3); c.fill(); }
  }
  c.restore();
  c.font = 'bold 16px system-ui'; c.fillStyle = '#fff';
  c.fillText(`⚓ ${game.distance.toFixed(1)}    ⚠ ${game.hits}`, 16, 24);
  if (!working) { c.font = '16px system-ui'; c.fillStyle = '#ffffffcc'; c.fillText('Dryfujesz — rozluźnij chwyt', 120, 205); }
}
