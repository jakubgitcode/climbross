import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, validatePlan, TrainingSession } from '../js/training.js';

const profile = { maxLeftKg: 40, maxRightKg: 60, maxBothKg: 100 };
const plan = (extra = {}) => ({ name: 'Lina', mode: 'tug', unit: 'percent', target: 40, tolerance: 15, workS: 10, restS: 10, reps: 1, sets: 5, setRestS: 20, rival: 'medium', ...extra });
function run(force, extra = {}, hand = 'left') {
  const s = new TrainingSession(plan(extra), hand, profile, 0);
  for (let t = 0; !s.done && t < 900000; t += 50) {
    s.tick(t);
    if (!s.done) s.reading(s.phase.kind === 'work' ? s.targetKg * force : 0, t);
  }
  return s;
}

test('target wins, 70% loses, zero loses every round against medium rival', () => {
  for (const [force, result] of [[1, 'wygrana'], [.7, 'przegrana'], [0, 'przegrana']]) {
    const s = run(force), g = s.summary().game;
    assert.equal(g.type, 'tug');
    assert.equal(g.result, result);
    assert.equal(force === 1 ? g.roundsWon : g.roundsLost, 5);
    assert.equal(s.summary().points, g.roundsWon);
    assert.equal(s.summary().completed, true);
    assert.equal(s.workMs, 50000);
    assert.ok(Math.abs(g.finalX) <= 1);
  }
});

test('rival validates, defaults to medium and is removed from other modes', () => {
  assert.ok(PRESETS.tug);
  assert.equal(validatePlan(plan({ rival: undefined })).rival, 'medium');
  for (const rival of ['easy', 'medium', 'hard']) assert.equal(validatePlan(plan({ rival })).rival, rival);
  for (const rival of ['', 'ghost', 1, null]) assert.throws(() => validatePlan(plan({ rival })), /Rywal/);
  assert.equal('rival' in validatePlan({ ...PRESETS.flight, rival: 'easy' }), false);
});

test('tolerance gives the same rope motion as target; averages retain actual force', () => {
  const exact = run(1).summary().game;
  for (const force of [.85, .95, 1.05, 1.15]) {
    const g = run(force).summary().game;
    assert.equal(g.finalX, exact.finalX);
    assert.equal(g.roundsWon, exact.roundsWon);
    assert.ok(Math.abs(g.avgPlayer / exact.avgPlayer - force) < 1e-9);
  }
});

test('ordinary hand selection and many repetitions still produce one round per set', () => {
  for (const hand of ['left', 'right', 'both']) {
    const s = run(0, { sets: 3, reps: 3, workS: 1, restS: 0, setRestS: 0 }, hand);
    assert.equal(s.hand, hand);
    assert.equal(s.summary().game.roundsLost, 3);
    assert.equal(s.completedReps, 9);
    assert.equal(s.workMs, 9000);
  }
});

test('unfinished round is not scored when interrupted', () => {
  const s = new TrainingSession(plan(), 'left', profile, 0);
  for (let t = 0; t <= 5500; t += 50) s.reading(16, t);
  s.finish('Przerwano', 5500);
  const g = s.summary().game;
  assert.equal(g.roundsWon + g.roundsLost + g.roundsDrawn, 0);
  assert.equal(s.summary().completed, false);
});
