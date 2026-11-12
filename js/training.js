import { TugGame } from './tug.js';
import { JumpGame } from './jump.js';
import { ShipGame, BEND_HALF_WIDTH, KAYAK_HALF_WIDTH, KAYAK_THETA, KAYAK_RESTORE } from './ship.js';
// Kayak: each rep of a set asks for a different share of the target, so the bends differ.
export const KAYAK_POWERS = [1, 0.6, 1.4];
export const ALTERNATING = ['ship', 'kayak'];
// Pure training clock. Force is kg; percentages use the selected hand's saved max.
export const PRESETS = {
  tug: { name: 'Przeciąganie liny', mode: 'tug', unit: 'percent', target: 40, tolerance: 15, workS: 10, restS: 10, reps: 1, sets: 5, setRestS: 20, rival: 'medium' },
  endurance: { name: 'Endurance 20%', mode: 'training', unit: 'percent', target: 20, tolerance: 10, workS: 30, restS: 30, reps: 6, sets: 1, setRestS: 120 },
  repeaters: { name: 'Repeatery 20 kg', mode: 'training', unit: 'kg', target: 20, tolerance: 10, workS: 7, restS: 3, reps: 6, sets: 3, setRestS: 120 },
  jumps: { name: 'Skoki przez przeszkody', mode: 'jump', unit: 'percent', target: 20, tolerance: 10, workS: 30, restS: 30, reps: 3, sets: 1, setRestS: 60 },
  flight: { name: 'Lot przez kanion', mode: 'game', unit: 'percent', target: 20, tolerance: 15, workS: 20, restS: 20, reps: 3, sets: 1, setRestS: 60 },
  // Each set is one hand (they alternate); setRestS is the time to change hands.
  ship: { name: 'Okręt z dwoma silnikami', mode: 'ship', hand: 'left', unit: 'percent', target: 30, tolerance: 20, workS: 6, restS: 3, reps: 3, sets: 4, setRestS: 6, wind: 100, river: 'straight' },
  kayak: { name: 'Spływ kajakiem', mode: 'kayak', hand: 'left', unit: 'percent', target: 30, tolerance: 15, workS: 6, restS: 3, reps: 3, sets: 4, setRestS: 6 },
  shipBends: { name: 'Okręt: zakręty rzeki', mode: 'ship', hand: 'left', unit: 'percent', target: 30, tolerance: 20, workS: 6, restS: 3, reps: 3, sets: 4, setRestS: 6, wind: 0, river: 'bends' },
};
export const MAX_KEYS = { left: 'maxLeftKg', right: 'maxRightKg', both: 'maxBothKg' };
export function validatePlan(input) {
  const p = { ...input, name: String(input.name || 'Mój plan').trim().slice(0, 60) };
  if (!['training', 'game', 'jump', 'ship', 'kayak', 'tug'].includes(p.mode) || !['kg', 'percent'].includes(p.unit)) throw new Error('Nieprawidłowy tryb lub jednostka.');
  if (p.hand !== undefined && !Object.hasOwn(MAX_KEYS, p.hand)) throw new Error('Wybierz rękę.');
  if (ALTERNATING.includes(p.mode)) {
    const game = p.mode === 'kayak' ? 'Kajak' : 'Okręt';
    if (p.hand !== undefined && p.hand === 'both') throw new Error(`${game}: wybierz rękę startową, lewą albo prawą.`);
    if (!Number.isInteger(Number(input.sets)) || Number(input.sets) % 2) throw new Error(`${game}: liczba serii musi być parzysta, żeby obie ręce pracowały tyle samo.`);
  }
  const limits = { target: [0.1, p.unit === 'percent' ? 100 : 300], tolerance: [1, 50], workS: [1, 600], restS: [0, 600], reps: [1, 50], sets: [1, 10], setRestS: [0, 900] };
  for (const [k, [min, max]] of Object.entries(limits)) {
    p[k] = Number(input[k]);
    if (!Number.isFinite(p[k]) || p[k] < min || p[k] > max || (['reps', 'sets'].includes(k) && !Number.isInteger(p[k]))) throw new Error('Sprawdź wartości planu i dozwolone zakresy.');
  }
  // Wind (in % of the wind that on-target pulls cancel out) and the river shape only exist in ship mode.
  if (p.mode === 'ship') {
    p.wind = input.wind === undefined || input.wind === '' ? 0 : Number(input.wind);
    if (!Number.isFinite(p.wind) || p.wind < 0 || p.wind > 200) throw new Error('Wiatr: wpisz od 0 do 200%.');
    p.river = input.river === undefined || input.river === '' ? 'straight' : input.river;
    if (!['straight', 'bends'].includes(p.river)) throw new Error('Rzeka: wybierz prostą albo z zakrętami.');
  } else { delete p.wind; delete p.river; }
  if (p.mode === 'tug') {
    p.rival = input.rival === undefined ? 'medium' : input.rival;
    if (!['easy', 'medium', 'hard'].includes(p.rival)) throw new Error('Rywal: wybierz poziom.');
  } else delete p.rival;
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
    const p = this.plan, kayak = p.mode === 'kayak', ship = ALTERNATING.includes(p.mode);
    if (ship && hand !== 'left' && hand !== 'right') throw new Error(`${kayak ? 'Kajak' : 'Okręt'}: wybierz rękę startową, lewą albo prawą.`);
    this.firstHand = hand;
    // A ship session uses both hands, so it is stored like "both hands separately".
    this.hand = ship ? 'both' : hand;
    this.targets = ship
      ? { left: resolveTarget(p, 'left', profile), right: resolveTarget(p, 'right', profile) }
      : { [hand]: resolveTarget(p, hand, profile) };
    this.targetKg = this.targets[hand];
    this.jumpGame = p.mode === 'jump' ? new JumpGame(this.targetKg) : null;
    this.started = now;
    this.lastTick = now;
    this.lastReading = null;
    this.kg = 0;
    this.phaseIndex = 0;
    // Ship sets alternate hands, starting with the chosen one.
    const other = hand === 'left' ? 'right' : 'left';
    const handOf = (set) => (ship && set % 2 === 0 ? other : hand);
    this.phases = [{ kind: 'ready', ms: 5000, set: 1, rep: 1, hand }];
    for (let set = 1; set <= p.sets; set++) {
      for (let rep = 1; rep <= p.reps; rep++) {
        // Both hands of a pair of sets get the same sequence of bends.
        const power = kayak ? KAYAK_POWERS[(rep - 1 + Math.floor((set - 1) / 2)) % KAYAK_POWERS.length] : 1;
        this.phases.push({ kind: 'work', ms: p.workS * 1000, set, rep, hand: handOf(set), power });
        if (rep < p.reps && p.restS > 0) this.phases.push({ kind: 'rest', ms: p.restS * 1000, set, rep, hand: handOf(set) });
      }
      // The change-over announces the hand that works next.
      if (set < p.sets && p.setRestS > 0) this.phases.push({ kind: 'setRest', ms: p.setRestS * 1000, set, rep: p.reps, hand: handOf(set + 1) });
    }
    // The river is laid out from the schedule; wind would cancel the bends, so bends mean calm air.
    const schedule = this.phases.map(({ kind, ms, hand: h, power }) => ({ kind, ms, hand: h, power }));
    this.shipGame = kayak ? new ShipGame({ kayak: true, bends: true, halfWidth: KAYAK_HALF_WIDTH, theta: KAYAK_THETA, restore: KAYAK_RESTORE, tolerance: p.tolerance / 100, schedule })
      : ship ? new ShipGame({
        wind: p.river === 'bends' ? 0 : p.wind / 100, workS: p.workS, restS: p.restS, tolerance: p.tolerance / 100,
        bends: p.river === 'bends', ...(p.river === 'bends' ? { halfWidth: BEND_HALF_WIDTH } : {}), schedule,
      }) : null;
    this.tugGame = p.mode === 'tug' ? new TugGame({ rival: p.rival, tolerance: p.tolerance / 100, sets: p.sets }) : null;
    this.applyPhase();
    let offset = now;
    for (const phase of this.phases) { phase.start = offset; offset += phase.ms; phase.end = offset; }
    this.workMs = 0; this.zoneMs = 0; this.loadMs = 0; this.forceIntegral = 0; this.measuredMs = 0;
    this.peakKg = 0; this.samples = []; this.completedReps = 0; this.done = false; this.reason = '';
  }
  get phase() { return this.phases[Math.min(this.phaseIndex, this.phases.length - 1)]; }
  // The target and zone follow the hand of the current phase (they only differ in ship mode).
  applyPhase() {
    this.currentHand = this.phase.hand;
    this.shipGame?.setPhase(this.phase.kind, this.phase.hand);
    this.tugGame?.setPhase(this.phase);
    // Outside work the display already shows the target of the next pull.
    const next = this.phases.slice(this.phaseIndex).find((x) => x.kind === 'work');
    this.power = next?.power ?? 1;
    this.targetKg = (this.targets[this.currentHand] ?? this.targetKg) * this.power;
    this.minKg = this.targetKg * (1 - this.plan.tolerance / 100);
    this.maxKg = this.targetKg * (1 + this.plan.tolerance / 100);
  }
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
        this.jumpGame?.advance(measured, this.demo && !this.demoManual ? 0 : this.kg);
        if (this.shipGame) {
          this.shipGame.advance(measured, this.kg, phase.hand, this.targetKg / this.power, this.power);
          this.shipGame.coast(end - cursor - measured);
        }
        if (this.tugGame) { this.tugGame.advance(measured, this.kg, this.targetKg); this.tugGame.coast(end - cursor - measured); }
        this.measuredMs += measured;
        this.forceIntegral += measured * this.kg;
        if (this.kg >= 1) this.loadMs += measured;
        if (this.kg >= this.minKg && this.kg <= this.maxKg) this.zoneMs += measured;
      } else this.shipGame?.coast(end - cursor);
      cursor = end;
      if (end >= phase.end) {
        if (phase.kind === 'work') {
          this.completedReps++;
          if (phase.rep === this.plan.reps) this.tugGame?.endRound();
        }
        this.jumpGame?.rest();
        this.phaseIndex++;
        if (this.phaseIndex >= this.phases.length) this.finish('Ukończono', end);
        else this.applyPhase();
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
      plan: this.plan, targetKg: this.shipGame ? this.targets[this.firstHand] : this.targetKg, minKg: this.minKg, maxKg: this.maxKg,
      ...(this.shipGame ? { targets: this.targets } : {}),
      workS: this.workMs / 1000, zoneS: this.zoneMs / 1000,
      accuracy: this.workMs ? this.zoneMs / this.workMs * 100 : 0,
      points: this.tugGame ? this.tugGame.roundsWon : this.shipGame?.kayak ? this.shipGame.score : this.jumpGame ? this.jumpGame.cleared : Math.floor(this.zoneMs / 1000), completedReps: this.completedReps,
      ...(this.tugGame ? { game: this.tugGame.summary() } : {}),
      ...(this.jumpGame ? { game: this.jumpGame.summary() } : {}),
      ...(this.shipGame ? { game: this.shipGame.summary() } : {}),
      completed: this.reason === 'Ukończono', reason: this.reason,
    };
  }
}
