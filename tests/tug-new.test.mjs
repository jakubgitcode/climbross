import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, TrainingSession, validatePlan, findGhost } from '../js/training.js';
import { TugGame } from '../js/tug.js';
const profile = { maxLeftKg: 40, maxRightKg: 60 };
const plan = { ...PRESETS.tug, handMode: 'alternating', sets: 4 };
test('alternating sets use both hands and their own targets', () => {
  const s = new TrainingSession(plan, 'left', profile, 0);
  assert.deepEqual(s.phases.filter(p => p.kind === 'work').map(p => p.hand), ['left','right','left','right']);
  assert.deepEqual(s.targets, { left: 16, right: 24 });
  assert.throws(() => validatePlan({ ...plan, sets: 3 }), /parzyst/);
});
test('ghost replays recorded relative force at sample times', () => {
  const g = new TugGame({ rival: 'ghost', ghost: [[0, .5], [500, 1.2]] });
  g.setPhase({ kind: 'work', set: 1, rep: 1, ms: 1000, offset: 0 });
  g.advance(500, 10, 10); assert.equal(g.rivalForce, 1.2);
  assert.ok(g.x > 0);
});
test('finds the latest completed compatible session and ignores other plans', () => {
  const item = { date: '2026-01-01', hand: 'left', samples: [[5000, 16]], training: { plan: { ...plan, rival: 'medium' }, completed: true, targets: { left: 16, right: 24 } } };
  assert.equal(findGhost([item], { ...plan, rival: 'ghost' }, 'left'), item);
  assert.equal(findGhost([item], { ...plan, workS: 3 }, 'left'), null);
});

test('session replays ghost relative to the recorded target and preserves missing-data gaps', () => {
  const p = { ...PRESETS.tug, unit: 'kg', target: 10, workS: 1, sets: 1, setRestS: 0, rival: 'ghost' };
  const ghost = { training: { targetKg: 20 }, samples: [[5000, 10], [5500, 20]] };
  const s = new TrainingSession(p, 'left', profile, 0, ghost);
  for (let t = 0; t <= 5000; t += 50) s.reading(10, t);
  assert.equal(s.tugGame.rivalForce, 0.5);
  for (let t = 5050; t <= 5300; t += 50) s.reading(10, t);
  assert.equal(s.tugGame.rivalForce, 0);
  for (let t = 5350; t <= 5500; t += 50) s.reading(10, t);
  assert.equal(s.tugGame.rivalForce, 1);
});
