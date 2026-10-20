// Pure training clock. Force is kg; percentages use the selected hand's saved max.
export const PRESETS = {
  endurance: { name: 'Endurance 20%', mode: 'training', unit: 'percent', target: 20, tolerance: 10, workS: 30, restS: 30, reps: 6, sets: 1, setRestS: 120 },
  repeaters: { name: 'Repeatery 20 kg', mode: 'training', unit: 'kg', target: 20, tolerance: 10, workS: 7, restS: 3, reps: 6, sets: 3, setRestS: 120 },
  flight: { name: 'Lot przez kanion', mode: 'game', unit: 'percent', target: 20, tolerance: 15, workS: 20, restS: 20, reps: 3, sets: 1, setRestS: 60 },
};
export const MAX_KEYS = { left: 'maxLeftKg', right: 'maxRightKg', both: 'maxBothKg' };
export function validatePlan(input) {
  const p = { ...input, name: String(input.name || 'Mój plan').trim().slice(0, 60) };
  if (!['training', 'game'].includes(p.mode) || !['kg', 'percent'].includes(p.unit)) throw new Error('Nieprawidłowy tryb lub jednostka.');
  if (p.hand !== undefined && !Object.hasOwn(MAX_KEYS, p.hand)) throw new Error('Wybierz rękę.');
  const limits = { target: [0.1, p.unit === 'percent' ? 100 : 300], tolerance: [1, 50], workS: [1, 600], restS: [0, 600], reps: [1, 50], sets: [1, 10], setRestS: [0, 900] };
  for (const [k, [min, max]] of Object.entries(limits)) {
    p[k] = Number(input[k]);
    if (!Number.isFinite(p[k]) || p[k] < min || p[k] > max || (['reps', 'sets'].includes(k) && !Number.isInteger(p[k]))) throw new Error('Sprawdź wartości planu i dozwolone zakresy.');
  }
  if (durationMs(p) > 2 * 60 * 60 * 1000) throw new Error('Plan może trwać najwyżej 2 godziny.');
  return p;
}
export function durationMs(p) {
  return 5000 + 1000 * (p.sets * (p.reps * p.workS + (p.reps - 1) * p.restS) + (p.sets - 1) * p.setRestS);
}
export function resolveTarget(plan, hand, profile) {
  if (!Object.hasOwn(MAX_KEYS, hand)) throw new Error('Wybierz rękę.');
  const max = Number(profile[MAX_KEYS[hand]]);
  if (plan.unit === 'percent' && !(Number.isFinite(max) && max > 0)) throw new Error('Najpierw zapisz maksimum wybranej ręki w Profile lub wybierz kg.');
  return plan.unit === 'percent' ? max * plan.target / 100 : plan.target;
}
export class TrainingSession {
  constructor(plan, hand, profile, now) {
    this.plan = validatePlan(plan);
    this.hand = hand;
    this.targetKg = resolveTarget(this.plan, hand, profile);
    this.minKg = this.targetKg * (1 - this.plan.tolerance / 100);
    this.maxKg = this.targetKg * (1 + this.plan.tolerance / 100);
    this.started = now;
    this.lastTick = now;
    this.lastReading = null;
    this.kg = 0;
    this.phaseIndex = 0;
    this.phases = [{ kind: 'ready', ms: 5000, set: 1, rep: 1 }];
    const p = this.plan;
    for (let set = 1; set <= p.sets; set++) {
      for (let rep = 1; rep <= p.reps; rep++) {
        this.phases.push({ kind: 'work', ms: p.workS * 1000, set, rep });
        if (rep < p.reps && p.restS > 0) this.phases.push({ kind: 'rest', ms: p.restS * 1000, set, rep });
      }
      if (set < p.sets && p.setRestS > 0) this.phases.push({ kind: 'setRest', ms: p.setRestS * 1000, set, rep: p.reps });
    }
    let offset = now;
    for (const phase of this.phases) { phase.start = offset; offset += phase.ms; phase.end = offset; }
    this.workMs = 0; this.zoneMs = 0; this.loadMs = 0; this.forceIntegral = 0; this.measuredMs = 0;
    this.peakKg = 0; this.samples = []; this.completedReps = 0; this.done = false; this.reason = '';
  }
  get phase() { return this.phases[Math.min(this.phaseIndex, this.phases.length - 1)]; }
  reading(kg, now) {
    if (!Number.isFinite(kg) || this.done) return;
    this.tick(now);
    if (this.done) return;
    this.kg = Math.max(0, kg); this.lastReading = now;
    if (this.phase.kind === 'work') {
      this.peakKg = Math.max(this.peakKg, this.kg);
      const t = now - this.started;
      if (!this.samples.length || t - this.samples.at(-1)[0] >= 100) this.samples.push([Math.round(t), this.kg]);
    }
  }
  tick(now) {
    if (this.done || now < this.lastTick) return;
    if (now - this.lastTick > 1500) { this.finish('Przerwano: aplikacja była nieaktywna.', this.lastTick); return; }
    if (now - (this.lastReading ?? this.started) > 1500) { this.finish('Przerwano: brak danych z deski.', this.lastTick); return; }
    let cursor = this.lastTick;
    while (!this.done && cursor < now) {
      const phase = this.phase;
      const end = Math.min(now, phase.end);
      if (phase.kind === 'work') {
        this.workMs += end - cursor;
        // Do not award points for old sensor values between notifications.
        const measured = this.lastReading === null ? 0 : Math.max(0, Math.min(end, this.lastReading + 250) - cursor);
        this.measuredMs += measured;
        this.forceIntegral += measured * this.kg;
        if (this.kg >= 1) this.loadMs += measured;
        if (this.kg >= this.minKg && this.kg <= this.maxKg) this.zoneMs += measured;
      }
      cursor = end;
      if (end >= phase.end) {
        if (phase.kind === 'work') this.completedReps++;
        this.phaseIndex++;
        if (this.phaseIndex >= this.phases.length) this.finish('Ukończono', end);
      }
    }
    this.lastTick = now;
  }
  finish(reason, now) {
    if (this.done) return;
    this.done = true; this.reason = reason; this.ended = now;
  }
  summary() {
    return {
      plan: this.plan, targetKg: this.targetKg, minKg: this.minKg, maxKg: this.maxKg,
      workS: this.workMs / 1000, zoneS: this.zoneMs / 1000,
      accuracy: this.workMs ? this.zoneMs / this.workMs * 100 : 0,
      points: Math.floor(this.zoneMs / 1000), completedReps: this.completedReps,
      completed: this.reason === 'Ukończono', reason: this.reason,
    };
  }
}
