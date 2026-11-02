import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, validatePlan, TrainingSession } from '../app/js/training.js';
import { ShipGame, HALF_WIDTH } from '../app/js/ship.js';
import { validateBackup } from '../app/js/store.js';

const profile = { maxLeftKg: 40, maxRightKg: 60, maxBothKg: 100 };
const ship = (extra = {}) => ({ ...PRESETS.ship, ...extra });

// Feeds force in % of the target of the hand that is pulling.
function run(plan, force = () => 1, hand = 'left') {
  const s = new TrainingSession(plan, hand, profile, 0);
  for (let t = 0; !s.done && t < 900000; t += 50) {
    s.tick(t);
    if (s.done) break;
    s.reading(s.phase.kind === 'work' ? s.targetKg * force(s.phase.hand) : 0, t);
  }
  return s;
}

test('ship plan needs a starting hand and an even number of sets', () => {
  assert.ok(validatePlan(ship()));
  assert.throws(() => validatePlan(ship({ hand: 'both' })));
  assert.throws(() => validatePlan(ship({ sets: 3 })));
  assert.throws(() => new TrainingSession(ship(), 'both', profile, 0));
  assert.throws(() => new TrainingSession(ship({ unit: 'percent' }), 'left', { maxLeftKg: 40 }, 0), 'needs both maxima');
});

test('sets alternate hands and the change-over announces the next one', () => {
  const s = new TrainingSession(ship({ reps: 2, sets: 4 }), 'right', profile, 0);
  const work = s.phases.filter((p) => p.kind === 'work');
  assert.deepEqual(work.map((p) => p.hand), ['right', 'right', 'left', 'left', 'right', 'right', 'left', 'left']);
  const changes = s.phases.filter((p) => p.kind === 'setRest');
  assert.deepEqual(changes.map((p) => p.hand), ['left', 'right', 'left']);
  assert.equal(s.phases[0].hand, 'right');
});

test('target and zone follow the hand that is pulling', () => {
  const s = new TrainingSession(ship({ reps: 1, sets: 2, workS: 2, restS: 1, setRestS: 2 }), 'left', profile, 0);
  const seen = {};
  for (let t = 0; !s.done; t += 100) { s.tick(t); s.reading(10, t); seen[s.phase.hand] = s.targetKg; }
  assert.equal(seen.left, 40 * 0.3);
  assert.equal(seen.right, 60 * 0.3);
  assert.equal(s.summary().targetKg, 12, 'summary reports the starting hand');
  assert.deepEqual(s.summary().targets, { left: 12, right: 18 });
});

test('equal effort keeps the ship on course', () => {
  const s = run(ship());
  const g = s.summary().game;
  assert.equal(g.type, 'ship');
  assert.equal(g.hits, 0);
  assert.ok(g.distance > 30);
  assert.ok(g.asymmetryPct < 1);
  assert.ok(Math.abs(s.shipGame.y) < HALF_WIDTH);
  assert.equal(s.summary().points, Math.floor(g.distance));
  assert.equal(s.summary().completed, true);
  assert.equal(s.hand, 'both');
});

test('a weaker hand shows up as asymmetry and pushes the ship off course', () => {
  const s = run(ship({ sets: 8 }), (h) => (h === 'left' ? 0.5 : 1));
  const g = s.summary().game;
  assert.ok(Math.abs(g.leftThrust - 0.5) < 0.05, `left ${g.leftThrust}`);
  assert.ok(Math.abs(g.rightThrust - 1) < 0.05);
  assert.ok(Math.abs(g.asymmetryPct - 50) < 5);
  assert.ok(g.hits > 0, 'drift reaches the bank');
  assert.ok(g.distance < run(ship({ sets: 8 })).summary().game.distance, 'less thrust, shorter distance');
});

test('no pulling goes nowhere, and a stalled sensor only makes the ship glide', () => {
  assert.equal(run(ship(), () => 0).summary().game.distance, 0);
  const g = new ShipGame();
  g.advance(1000, 30, 'left', 30);
  const before = g.distance;
  g.advance(1000, NaN, 'left', 30); g.advance(-5, 30, 'left', 30); g.advance(1000, 30, 'up', 30); g.advance(1000, 30, 'left', 0);
  assert.equal(g.distance, before, 'invalid input is ignored');
  g.coast(5000);
  assert.ok(g.distance > before && g.speed < 0.2);
});

test('thrust is capped and the bank is a wall, not a place to leave the channel', () => {
  const g = new ShipGame();
  for (let i = 0; i < 100; i++) g.advance(1000, 1000, 'left', 10);
  assert.ok(Math.abs(g.y) <= HALF_WIDTH + 1e-9);
  assert.ok(g.speed <= 1.5 + 1e-9);
  assert.ok(g.hits >= 1 && g.hits < 5, `one hit per contact, got ${g.hits}`);
});

test('a ship result survives backup validation', () => {
  const s = run(ship());
  const m = { id: 'a', date: new Date().toISOString(), hand: s.hand, peakKg: s.peakKg, avgKg: 1, tulS: 1, durationS: 100, samples: s.samples, training: s.summary() };
  assert.equal(validateBackup({ app: 'climbross', measurements: [m] }).measurements.length, 1);
});
