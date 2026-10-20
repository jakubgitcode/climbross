import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, validatePlan, durationMs, resolveTarget, TrainingSession } from '../js/training.js';
const profile = { maxLeftKg: 50, maxRightKg: 80, maxBothKg: 120 };
const plan = (extra = {}) => ({ ...PRESETS.repeaters, workS: 1, restS: 1, reps: 2, sets: 2, setRestS: 2, ...extra });
function run(p, value) {
  const s = new TrainingSession(p, 'left', profile, 0);
  for (let t = 0; !s.done && t < 300000; t += 100) s.reading(value, t);
  return s;
}
test('percentage targets use the selected hand, including both', () => {
  assert.equal(resolveTarget(PRESETS.endurance, 'left', profile), 10);
  assert.equal(resolveTarget(PRESETS.endurance, 'right', profile), 16);
  assert.equal(resolveTarget(PRESETS.endurance, 'both', profile), 24);
});
test('kg targets do not require a profile max', () => {
  assert.equal(resolveTarget(PRESETS.repeaters, 'left', {}), 20);
  assert.throws(() => resolveTarget(PRESETS.endurance, 'right', {}));
  assert.throws(() => resolveTarget(PRESETS.endurance, 'both', { maxLeftKg: 20, maxRightKg: 20 }));
});
test('validation rejects invalid, non-finite, fractional counts and oversized sessions', () => {
  for (const extra of [{ target: 0 }, { target: Infinity }, { target: NaN }, { unit: 'watts' }, { hand: 'unknown' }, { mode: 'other' }, { reps: 1.2 }, { sets: 0 }, { workS: -2 }, { tolerance: 0 }, { workS: 600, reps: 50, sets: 10 }]) {
    assert.throws(() => validatePlan(plan(extra)));
  }
  assert.throws(() => validatePlan(plan({ unit: 'percent', target: 101 })));
});
test('clock includes preparation, inter-rep and set rests, without a final rest', () => {
  const s = run(plan(), 20);
  assert.equal(s.ended, durationMs(plan()));
  assert.equal(s.ended, 13000);
  assert.equal(s.workMs, 4000);
  assert.equal(s.zoneMs, 4000);
  assert.equal(s.completedReps, 4);
  assert.equal(s.summary().accuracy, 100);
  assert.equal(s.summary().points, 4);
  assert.equal(s.summary().completed, true);
});
test('zero rests do not skip or duplicate repetitions', () => {
  const s = run(plan({ restS: 0, setRestS: 0 }), 20);
  assert.equal(s.ended, 9000);
  assert.equal(s.zoneMs, 4000);
  assert.equal(s.completedReps, 4);
});
test('too high or too low force earns no points; band edges count', () => {
  assert.equal(run(plan(), 30).zoneMs, 0);
  assert.equal(run(plan(), 0).zoneMs, 0);
  assert.equal(run(plan(), 18).zoneMs, 4000);
  assert.equal(run(plan(), 22).zoneMs, 4000);
});
test('rest and preparation force cannot increase the recorded work peak', () => {
  const s = new TrainingSession(plan(), 'left', profile, 0);
  for (let t = 0; !s.done; t += 100) {
    s.tick(t);
    s.reading(s.phase.kind === 'work' ? 20 : 100, t);
  }
  assert.equal(s.peakKg, 20);
});
test('missing notifications stop the session and stale force cannot earn points', () => {
  const s = new TrainingSession(plan({ workS: 10, reps: 1, sets: 1 }), 'left', profile, 0);
  for (let t = 0; t <= 5500; t += 100) s.reading(20, t);
  for (let t = 5600; t <= 8000; t += 100) s.tick(t);
  assert.equal(s.done, true);
  assert.match(s.reason, /brak danych/);
  assert.equal(s.zoneMs, 750);
  assert.equal(s.summary().completed, false);
});
test('browser suspension never awards catch-up points', () => {
  const s = new TrainingSession(plan(), 'left', profile, 0);
  s.reading(20, 0);
  s.tick(20000);
  assert.equal(s.zoneMs, 0);
  assert.equal(s.summary().completed, false);
  assert.match(s.reason, /nieaktywna/);
});
test('manual stop is terminal and a new session starts at zero', () => {
  const s = new TrainingSession(plan(), 'left', profile, 0);
  s.finish('Stopped', 200);
  s.reading(500, 300); s.tick(50000);
  assert.equal(s.peakKg, 0);
  assert.equal(s.summary().completed, false);
  assert.equal(new TrainingSession(plan(), 'left', profile, 0).zoneMs, 0);
});
test('NaN sensor readings cannot poison score or peak', () => {
  const s = new TrainingSession(plan(), 'left', profile, 0);
  s.reading(NaN, 0);
  assert.equal(s.lastReading, null);
  assert.equal(s.peakKg, 0);
});
