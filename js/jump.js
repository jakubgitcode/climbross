// Fixed-height jumps: crossing the chosen force threshold triggers one jump.
// Holding harder never makes a higher jump; release before the next one.
export class JumpGame {
  constructor(targetKg) {
    this.targetKg = targetKg;
    this.cleared = 0; this.missed = 0; this.jumps = 0;
    this.rest();
  }
  rest() {
    this.elapsed = 0; this.nextSpawn = 500; this.obstacles = [];
    this.height = 0; this.velocity = 0; this.armed = false; this.releaseMs = 0;
  }
  jump() {
    if (this.height > 0) return false;
    this.height = .1; this.velocity = 300; this.armed = false; this.releaseMs = 0; this.jumps++;
    return true;
  }
  advance(ms, kg) {
    if (!Number.isFinite(ms) || !Number.isFinite(kg) || ms < 0 || ms > 250) return;
    for (let left = ms; left > 0;) {
      const dt = Math.min(10, left); left -= dt; this.elapsed += dt;
      if (kg < this.targetKg * .5) {
        this.releaseMs += dt;
        if (this.releaseMs >= 120 && this.height === 0) this.armed = true;
      } else this.releaseMs = 0;
      if (this.armed && kg >= this.targetKg) this.jump();
      if (this.height > 0) {
        this.velocity -= 650 * dt / 1000;
        this.height = Math.max(0, this.height + this.velocity * dt / 1000);
      }
      if (this.elapsed >= this.nextSpawn) { this.obstacles.push({ x: 410, judged: false, hit: false }); this.nextSpawn += 2700; }
      for (const o of this.obstacles) {
        o.x -= 140 * dt / 1000;
        // Player occupies x=65..91, obstacle width=20 and height=30.
        if (!o.hit && o.x < 91 && o.x + 20 > 65 && this.height < 32) { o.hit = true; this.missed++; }
        if (!o.judged && o.x + 20 < 65) { o.judged = true; if (!o.hit) this.cleared++; }
      }
      this.obstacles = this.obstacles.filter(o => o.x > -30);
    }
  }
  summary() { return { type: 'jump', cleared: this.cleared, missed: this.missed, jumps: this.jumps }; }
}
export function drawRunner(canvas, game, working) {
  const ratio = devicePixelRatio || 1, width = canvas.clientWidth || 320;
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(210 * ratio); }
  const c = canvas.getContext('2d'); c.setTransform(canvas.width / 420, 0, 0, canvas.height / 210, 0, 0);
  const sky = c.createLinearGradient(0,0,0,210); sky.addColorStop(0,'#101e38'); sky.addColorStop(1,'#204d66'); c.fillStyle=sky; c.fillRect(0,0,420,210);
  c.fillStyle='#d3eaff'; c.beginPath(); c.arc(350,40,15,0,Math.PI*2); c.fill();
  c.fillStyle='#143149'; c.beginPath(); c.moveTo(0,176); for(let x=0;x<=420;x+=42)c.lineTo(x,x%84?90:148);c.lineTo(420,210);c.lineTo(0,210);c.fill();
  c.fillStyle='#65c6a7';c.fillRect(0,178,420,3); c.fillStyle='#122f38';c.fillRect(0,181,420,29);
  for (const o of game.obstacles) { c.fillStyle=o.hit?'#ff7087':'#ffcd75';c.fillRect(o.x,148,20,30);c.fillStyle='#ffe4b2';c.fillRect(o.x+3,152,4,20); }
  const y=150-game.height; c.fillStyle='#7be6e5';c.fillRect(65,y,26,28); c.fillStyle='#0c2740';c.fillRect(82,y+7,5,5);c.fillRect(69,y+24,7,7);c.fillRect(82,y+24,7,7);
  c.font='bold 16px system-ui';c.fillStyle='#fff';c.fillText(`★ ${game.cleared}    × ${game.missed}`,16,28);
  if(!working){ c.fillStyle='#ffffff';c.font='16px system-ui';c.fillText('Odpoczynek — rozluźnij chwyt',80,75); }
}
