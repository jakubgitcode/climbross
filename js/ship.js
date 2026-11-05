// Ship with two side engines. The board has one force channel, so the hands work in turns:
// the ship sails at a constant speed. The left hand drives the left engine, which turns the
// ship to the right; the right hand drives the right engine and turns it to the left. A
// weaker pull steers less. Thrust is force
// relative to the target of the hand that is pulling, so a plan in % of each hand's maximum
// rewards equal effort and a plan in kg exposes asymmetry.
// Pulling anywhere inside the tolerance zone counts as exactly on target, so staying in the
// zone is enough to hold the course.
export const HALF_WIDTH = 0.9;   // channel half-width, in distance units
export const BEND_HALF_WIDTH = 0.5; // a river with bends is narrower, or leaving its path would go unpunished
const V_MAX = 1.5;               // units/s, constant: the plan's phases always line up with the river
const THETA_MAX = 0.065;          // rad of yaw at thrust 1
// The current gently pulls the ship back toward the middle, so one weak or ragged pull does not
// leave it off course for good (a hand can only push to one side).
const RESTORE = 0.1;              // 1/s
const MAX_THRUST = 1.5;
const TAU_YAW = 0.5;              // s, how quickly the heading follows the engines
const TRAIL_STEP = 0.08;
const TRAIL_LENGTH = 90;
const SIM_STEP_MS = 50;

// Sideways drift of one steady work + rest cycle of an on-target pull; 100% wind cancels it.
function cycleDrift(workS, restS) {
  const g = new ShipGame({ walls: false, trail: false, restore: 0 });
  let before = 0;
  for (let i = 0; i < 5; i++) { before = g.y; g.advance(workS * 1000, 1, 'left', 1); g.coast(restS * 1000); }
  return Math.abs(g.y - before);
}

export class ShipGame {
  /**
   * wind: 0 = calm, 1 = the wind that on-target pulls exactly cancel on average over a
   * work + rest cycle, so the ship stays near the middle only if you hold the target force.
   * tolerance: the half-width of the zone (share of the target) that counts as on target.
   * schedule: [{ kind, ms, hand }] of the whole session. It lays the river out in distance:
   * rough water where the plan says "work", calm water for the rest, and with `bends` a
   * river that turns away from the working hand's engine (left hand: bend to the right) for exactly as long as it works.
   */
  constructor({ wind = 0, workS = 1, restS = 0, tolerance = 0, bends = false, schedule = null, walls = true, trail = true, halfWidth = HALF_WIDTH, restore = RESTORE } = {}) {
    this.restore = restore;
    this.halfWidth = halfWidth;
    this.wind = Number.isFinite(wind) && wind > 0 ? wind : 0;
    this.tolerance = Number.isFinite(tolerance) ? Math.min(0.5, Math.max(0, tolerance)) : 0;
    this.windSpeed = this.wind > 0 ? this.wind * cycleDrift(workS, restS) / (workS + restS) : 0;
    this.windDir = 0;
    this.walls = walls; this.keepTrail = trail;
    this.distance = 0; this.hits = 0;
    this.y = 0; this.heading = 0; this.speed = V_MAX; this.touching = false;
    this.engine = { left: { thrustMs: 0, ms: 0 }, right: { thrustMs: 0, ms: 0 } };
    this.trail = [];
    this.sections = [];
    this.path = null;
    if (schedule?.length) this.#lay(schedule, bends);
  }
  // Runs an ideal on-target session once to learn where each phase falls along the river.
  #lay(schedule, bends) {
    const ideal = new ShipGame({ tolerance: this.tolerance, walls: false, trail: false, restore: 0 });
    ideal.wind = this.wind; ideal.windSpeed = this.windSpeed;
    const path = [[0, 0]];
    for (const { kind, ms, hand } of schedule) {
      ideal.setPhase(kind, hand);
      const d0 = ideal.distance;
      for (let left = ms; left > 0; left -= SIM_STEP_MS) {
        const dt = Math.min(SIM_STEP_MS, left);
        if (kind === 'work') ideal.advance(dt, 1, hand, 1); else ideal.coast(dt);
        if (bends) path.push([ideal.distance, ideal.y]);
      }
      this.sections.push({ kind, hand, d0, d1: ideal.distance });
    }
    this.path = bends ? path : null;
  }
  /** Where the middle of the river is at `d`; it only moves in a river with bends. */
  centre(d) {
    const path = this.path;
    if (!path) return 0;
    if (d <= path[0][0]) return path[0][1];
    if (d >= path.at(-1)[0]) return path.at(-1)[1];
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid][0] <= d) lo = mid; else hi = mid; }
    const [d0, y0] = path[lo], [d1, y1] = path[hi];
    return d1 > d0 ? y0 + (y1 - y0) * (d - d0) / (d1 - d0) : y1;
  }
  /** Phase kind of the river section at `d` (null before the start or without a schedule). */
  sectionAt(d) {
    const s = this.sections;
    if (!s.length || d < s[0].d0) return null;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].d0 <= d) lo = mid; else hi = mid - 1; }
    return s[lo];
  }
  /**
   * The wind blows against the way the working hand steers, so the hand that is up has to
   * pull to hold the middle. It is calm during the countdown and while changing hands.
   */
  setPhase(kind, hand) {
    this.windDir = kind === 'work' || kind === 'rest' ? (hand === 'left' ? -1 : 1) : 0;
  }
  /** Force is applied for `ms` by `hand` against that hand's target. */
  advance(ms, kg, hand, targetKg) {
    if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(kg) || !(targetKg > 0) || !(hand in this.engine)) return;
    const ratio = Math.max(0, kg / targetKg), tol = this.tolerance;
    // Inside the zone the engine counts as exactly on target; outside it the effect resumes smoothly.
    const effective = Math.abs(ratio - 1) <= tol ? 1 : ratio < 1 ? ratio / (1 - tol) : ratio - tol;
    const e = this.engine[hand];
    e.thrustMs += Math.min(MAX_THRUST, ratio) * ms; e.ms += ms;
    this.#run(ms, Math.min(MAX_THRUST, effective), hand === 'left' ? 1 : -1);
  }
  /** Rest, preparation, or a stale sensor: the ship keeps gliding. */
  coast(ms) {
    if (Number.isFinite(ms) && ms > 0) this.#run(ms, 0, 0);
  }
  // `side`: +1 turns the ship right, down on screen (left engine), -1 left, up (right engine).
  #run(ms, thrust, side) {
    for (let left = ms; left > 0;) {
      const dt = Math.min(10, left); left -= dt;
      const s = dt / 1000;
      this.heading += (side * thrust * THETA_MAX - this.heading) * (1 - Math.exp(-s / TAU_YAW));
      const middle = this.centre(this.distance);
      this.y += (this.speed * Math.sin(this.heading) + this.windDir * this.windSpeed - this.restore * (this.y - middle)) * s;
      this.distance += this.speed * s;
      if (this.walls) {
        const off = this.y - this.centre(this.distance);
        if (Math.abs(off) > this.halfWidth) {
          if (!this.touching) { this.touching = true; this.hits++; }
          if (Math.sign(this.heading) === Math.sign(off)) this.heading = 0;
          this.y = this.centre(this.distance) + Math.sign(off) * this.halfWidth;
        } else if (Math.abs(off) < this.halfWidth * 0.8) this.touching = false;
      }
      if (this.keepTrail) {
        const last = this.trail.at(-1);
        if (!last || this.distance - last[0] >= TRAIL_STEP) {
          this.trail.push([this.distance, this.y]);
          if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
        }
      }
    }
  }
  /** Average thrust of each engine as a share of its target (1 = exactly on target). */
  average(hand) { const e = this.engine[hand]; return e.ms ? e.thrustMs / e.ms : 0; }
  summary() {
    const left = this.average('left'), right = this.average('right');
    const stronger = Math.max(left, right);
    return {
      type: 'ship', distance: this.distance, hits: this.hits, wind: this.wind, bends: !!this.path,
      leftThrust: left, rightThrust: right,
      asymmetryPct: stronger > 0 ? Math.abs(left - right) / stronger * 100 : 0,
    };
  }
}

const PX = 55;       // pixels per distance unit across the river
const XPX = 40;      // and along it, so about one work + rest cycle is in view
const SHIP_X = 90;
const MID = 105;
const hash = (i, j) => { const v = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return v - Math.floor(v); };
const WORK_COLOUR = '#ff6b6b', REST_COLOUR = '#69db7c';

export function drawShip(canvas, game, working, hand) {
  const ratio = devicePixelRatio || 1, width = canvas.clientWidth || 320;
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(210 * ratio); }
  const c = canvas.getContext('2d'); c.setTransform(canvas.width / 420, 0, 0, canvas.height / 210, 0, 0);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = still ? 0 : performance.now() / 1000;
  const hw = game.halfWidth * PX, dist = game.distance, cam = game.centre(dist);
  const worldX = (d) => SHIP_X + (d - dist) * XPX;
  const middleY = (x) => MID + (game.centre(dist + (x - SHIP_X) / XPX) - cam) * PX;
  const xs = []; for (let x = -6; x <= 426; x += 6) xs.push(x);
  const edge = (offset) => xs.map((x) => [x, middleY(x) + offset]);
  const trace = (points, join = false) => points.forEach(([x, y], i) => (i || join ? c.lineTo(x, y) : c.moveTo(x, y)));
  const strip = (from, to) => { c.beginPath(); trace(edge(from)); trace(edge(to).reverse(), true); c.closePath(); };

  c.fillStyle = '#0d1f2b'; c.fillRect(0, 0, 420, 210);
  c.save();
  strip(-hw, hw); c.clip();
  const water = c.createLinearGradient(0, 0, 0, 210); water.addColorStop(0, '#0f3a55'); water.addColorStop(1, '#0b2a40');
  c.fillStyle = water; c.fillRect(0, 0, 420, 210);
  // Sections: rough water where the plan says pull, calm water while resting.
  for (const s of game.sections) {
    const x0 = worldX(s.d0), x1 = worldX(s.d1);
    if (s.kind !== 'work' || x1 < 0 || x0 > 420) continue;
    c.fillStyle = '#9fd0ee24'; c.fillRect(x0, 0, x1 - x0, 210);
  }
  // Waves are fixed to the river, so they stream past at the ship's speed; they also keep bobbing.
  const step = 0.3;
  c.lineCap = 'round';
  for (let i = Math.floor((dist - SHIP_X / XPX) / step); i * step < dist + (440 - SHIP_X) / XPX; i++) {
    const d = i * step, x = worldX(d), section = game.sectionAt(d);
    if (x < -20 || x > 440) continue;
    const rough = section?.kind === 'work', cy = middleY(x);
    for (let j = 0; j < 6; j++) {
      const r = hash(i, j), lane = ((j + 0.15 + 0.7 * hash(j, i)) / 6) * 2 - 1;
      if (rough) {
        if (r < 0.35) continue;
        const bob = Math.sin(t * 5 + r * 40) * 3, y = cy + lane * hw * 0.92 + bob * 0.5;
        c.strokeStyle = `rgba(235,247,255,${0.35 + 0.35 * Math.abs(Math.sin(t * 3 + r * 20))})`; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - 8, y + 1); c.quadraticCurveTo(x - 3, y - 5 - Math.abs(bob), x + 1, y); c.quadraticCurveTo(x + 4, y - 3 - Math.abs(bob) / 2, x + 8, y + 1); c.stroke();
      } else {
        if (r < 0.72) continue;
        const y = cy + lane * hw * 0.92 + Math.sin(t * 0.9 + r * 30) * 0.8;
        c.strokeStyle = 'rgba(190,225,245,0.16)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.stroke();
      }
    }
  }
  // The middle of the river: stay in this lane.
  c.fillStyle = '#68dda01c'; strip(-0.25 * PX, 0.25 * PX); c.fill();
  c.setLineDash([6, 8]); c.strokeStyle = '#ffffff33'; c.lineWidth = 1; c.beginPath(); trace(edge(0)); c.stroke(); c.setLineDash([]);
  // Wind streaks blow toward the bank the wind pushes the ship to.
  if (game.wind > 0 && game.windDir) {
    const slide = (t * 70 * Math.min(1.5, game.wind)) % 70;
    c.strokeStyle = '#d3eaffaa'; c.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const x = 40 + i * 58, travel = (i * 23 + slide) % 70 - 35, y = MID + game.windDir * travel;
      c.beginPath(); c.moveTo(x, y - game.windDir * 9); c.lineTo(x, y + game.windDir * 9);
      c.moveTo(x - 4, y + game.windDir * 5); c.lineTo(x, y + game.windDir * 9); c.lineTo(x + 4, y + game.windDir * 5); c.stroke();
    }
  }
  if (game.trail.length > 1) {
    c.strokeStyle = '#b9e8ff88'; c.lineWidth = 2; c.beginPath();
    game.trail.forEach(([d, y], i) => { const x = worldX(d), py = MID + (y - cam) * PX; i ? c.lineTo(x, py) : c.moveTo(x, py); });
    c.stroke();
  }
  c.restore();
  // Banks, with a post every half unit that makes the speed visible.
  c.strokeStyle = '#1f4b3a'; c.lineWidth = 6;
  for (const side of [-1, 1]) { c.beginPath(); trace(edge(side * (hw + 3))); c.stroke(); }
  c.fillStyle = '#ffffff55';
  for (let k = Math.floor((dist - SHIP_X / XPX) * 2); k / 2 < dist + (430 - SHIP_X) / XPX; k++) {
    const x = worldX(k / 2);
    if (x < 0 || x > 420) continue;
    c.beginPath(); c.arc(x, middleY(x) - hw - 1, 1.6, 0, 7); c.arc(x, middleY(x) + hw + 1, 1.6, 0, 7); c.fill();
  }
  // Gates mark where the water turns rough (work, red) and where it calms down (rest, green).
  game.sections.forEach((s, i) => {
    const prev = game.sections[i - 1], toWork = s.kind === 'work';
    if (!prev || (prev.kind === 'work') === toWork) return;
    const x = worldX(s.d0);
    if (x < -6 || x > 426) return;
    const colour = toWork ? WORK_COLOUR : REST_COLOUR, m = middleY(x);
    c.strokeStyle = colour + '99'; c.lineWidth = 2; c.setLineDash([4, 5]);
    c.beginPath(); c.moveTo(x, m - hw); c.lineTo(x, m + hw); c.stroke(); c.setLineDash([]);
    c.fillStyle = colour;
    c.beginPath(); c.arc(x, m - hw - 2, 5, 0, 7); c.arc(x, m + hw + 2, 5, 0, 7); c.fill();
  });
  // Ship, pointing right. The left engine is the upper one; driving it turns the ship down (right).
  c.save(); c.translate(SHIP_X, MID + (game.y - cam) * PX); c.rotate(game.heading * 1.4);
  c.fillStyle = '#7be6e5'; c.beginPath(); c.moveTo(24, 0); c.lineTo(-16, -11); c.lineTo(-16, 11); c.closePath(); c.fill();
  c.fillStyle = '#0c2740'; c.fillRect(-4, -4, 12, 8);
  for (const [side, y] of [['left', -9], ['right', 9]]) {
    const active = working && hand === side;
    c.fillStyle = active ? '#ffcd75' : '#41586a'; c.fillRect(-22, y - 3, 8, 6);
    if (active) { c.fillStyle = '#ff9a3c'; c.beginPath(); c.moveTo(-22, y - 3); c.lineTo(-34 - (still ? 3 : Math.random() * 6), y); c.lineTo(-22, y + 3); c.fill(); }
  }
  c.restore();
  c.font = 'bold 16px system-ui'; c.fillStyle = '#fff';
  c.fillText(`⚠ ${game.hits}`, 16, 24);
  if (game.wind > 0) {
    c.font = '14px system-ui'; c.textAlign = 'right'; c.fillStyle = '#d3eaff';
    c.fillText(game.windDir ? `Wiatr ${Math.round(game.wind * 100)}% ${game.windDir < 0 ? '▲' : '▼'}` : 'Wiatr: cisza', 404, 24);
    c.textAlign = 'left';
  }
  if (!working) { c.font = '16px system-ui'; c.fillStyle = '#ffffffcc'; c.fillText('Rozluźnij chwyt', 150, 205); }
}
