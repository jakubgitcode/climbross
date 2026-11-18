// A ring arrives every two seconds of work. Rest never advances the course.
export class FlightGame {
  constructor(tolerance) { this.tolerance=tolerance; this.hit=0; this.perfect=0; this.missed=0; this.streak=0; this.bestStreak=0; this.elapsed=0; this.next=2000; this.phase='ready'; }
  setPhase(kind) { this.phase=kind; this.elapsed=0; this.next=2000; }
  advance(ms, kg, target, fresh=true) {
    if (this.phase !== 'work' || !(ms>0)) return;
    const end=this.elapsed+ms;
    while (this.next <= end) {
      const hit=fresh && target>0 && Math.abs(kg/target-1)<=this.tolerance+1e-12;
      if (hit) { if (Math.abs(kg/target-1)<=this.tolerance/3+1e-12) this.perfect++; this.hit++; this.streak++; this.bestStreak=Math.max(this.bestStreak,this.streak); }
      else { this.missed++; this.streak=0; }
      this.next+=2000;
    }
    this.elapsed=end;
  }
  get progress() { return this.phase === 'work' ? 1-(this.next-this.elapsed)/2000 : 0; }
  summary() { return {type:'flight',hit:this.hit,perfect:this.perfect,missed:this.missed,bestStreak:this.bestStreak}; }
}
