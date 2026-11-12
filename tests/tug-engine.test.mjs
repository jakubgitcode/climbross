import test from 'node:test';
import assert from 'node:assert/strict';
import { TugGame } from '../js/tug.js';

function round(ratio, options = {}, step = 50) {
  const g = new TugGame(options);
  g.setPhase({ kind: 'work', set: 1, rep: 1, ms: 10000 });
  for (let t = 0; t < 10000; t += step) g.advance(Math.min(step, 10000 - t), ratio * 20, 20);
  g.endRound();
  return g;
}

test('target wins, 70% loses, no pull loses against medium rival', () => {
  for (const [ratio, result] of [[1, 'wygrana'], [.7, 'przegrana'], [0, 'przegrana']]) {
    const g = round(ratio).summary();
    assert.equal(g.result, result);
    assert.equal(g.roundsWon + g.roundsLost, 1);
    assert.ok(Math.abs(g.finalX) <= 1);
  }
});

test('all force in the tolerance band has identical motion, with actual force in averages', () => {
  const exact = round(1, { tolerance: .15 }).summary();
  for (const ratio of [.85, .95, 1.05, 1.15]) {
    const g = round(ratio, { tolerance: .15 }).summary();
    assert.equal(g.finalX, exact.finalX);
    assert.equal(g.roundsWon, exact.roundsWon);
    assert.ok(Math.abs(g.avgPlayer - ratio) < 1e-10);
  }
});

test('surges are deterministic and preceded by a full second of warning', () => {
  const games = [new TugGame(), new TugGame()];
  let warnedMs = 0, surges = 0, fatigue = false, wasSurging = false;
  for (const g of games) g.setPhase({ kind: 'work', set: 2, rep: 3, ms: 10000 });
  for (let t = 0; t < 10000; t += 50) {
    const [a, b] = games;
    assert.equal(a.rivalForce, b.rivalForce);
    assert.equal(a.warning, b.warning);
    if (a.warning) warnedMs += 50;
    if (a.rivalState === 'surge' && !wasSurging) { assert.ok(warnedMs >= 1000); surges++; }
    wasSurging = a.rivalState === 'surge';
    fatigue ||= a.rivalState === 'fatigue';
    for (const g of games) g.advance(50, g.rivalForce * 20, 20);
  }
  assert.ok(surges > 0);
  assert.equal(fatigue, true);
});

test('rest freezes the rope and stops the warning and both force bars', () => {
  const g = new TugGame();
  g.setPhase({ kind: 'work', set: 1, rep: 1, ms: 10000 });
  g.advance(1000, 20, 20);
  const x = g.x;
  g.setPhase({ kind: 'rest', set: 1, rep: 1, ms: 5000 });
  g.coast(5000);
  g.advance(5000, 30, 20);
  assert.equal(g.x, x);
  assert.equal(g.warning, false);
  assert.equal(g.rivalForce, 0);
  assert.equal(g.playerForce, 0);
});

test('early boundary gives one point, resets rope and leaves remaining repetitions resolved', () => {
  const g = round(0);
  assert.equal(g.summary().roundsLost, 1);
  assert.equal(g.summary().finalX, -1);
  assert.equal(g.x, 0);
  g.setPhase({ kind: 'work', set: 1, rep: 2, ms: 10000 });
  g.advance(10000, 1000, 20);
  g.endRound();
  assert.equal(g.summary().roundsLost, 1);
  assert.equal(g.summary().roundsWon, 0);
  g.setPhase({ kind: 'work', set: 2, rep: 1, ms: 10000 });
  assert.equal(g.roundResult, null);
  assert.equal(g.x, 0);
  g.advance(10000, 0, 20);
  g.endRound();
  assert.equal(g.summary().roundsLost, 2);
});

test('force is capped, invalid input ignored, integration independent of tick size', () => {
  assert.equal(round(1.5).summary().finalX, round(50).summary().finalX);
  for (const step of [20, 100, 250, 1000]) {
    assert.ok(Math.abs(round(1, {}, step).summary().finalX - round(1).summary().finalX) < 1e-9);
  }
  const g = new TugGame();
  g.setPhase({ kind: 'work', set: 1, rep: 1, ms: 10000 });
  const before = g.summary();
  for (const args of [[-1, 20, 20], [NaN, 20, 20], [100, NaN, 20], [100, 20, 0]]) g.advance(...args);
  assert.deepEqual(g.summary(), before);
});

test('missing readings let the rival pull during work but do not credit stale force', () => {
  const g = new TugGame();
  g.setPhase({ kind: 'work', set: 1, rep: 1, ms: 10000 });
  g.advance(100, 20, 20);
  const before = g.x;
  g.coast(500);
  assert.ok(g.x < before);
  assert.equal(g.playerForce, 0);
});

test('zero position at round end is a draw and difficulty changes opponent strength', () => {
  const draw = new TugGame({ rival: 'hard', tolerance: 0 });
  draw.setPhase({ kind: 'work', set: 1, rep: 1, ms: 1000 });
  draw.advance(1000, 20, 20); draw.endRound();
  assert.equal(draw.summary().roundsDrawn, 1);
  assert.equal(draw.summary().result, 'remis');
  assert.ok(round(1, { rival: 'easy' }).summary().avgRival < round(1, { rival: 'hard' }).summary().avgRival);
});

test('short repeated work never truncates a surge or makes target lose to medium', () => {
  for (const workMs of [1000, 3000, 3500, 4500, 5500, 6000, 10000, 11000]) for (const reps of [1, 3]) {
    const g = new TugGame({ tolerance: .15, sets: 3 });
    for (let set = 1; set <= 3; set++) {
      for (let rep = 1; rep <= reps; rep++) {
        g.setPhase({ kind: 'work', set, rep, ms: workMs });
        for (let t = 0; t < workMs; t += 50) g.advance(50, 20, 20);
        if (rep < reps) {
          g.setPhase({ kind: 'rest', set, rep, ms: 1000 });
          g.coast(1000);
        }
      }
      g.endRound();
    }
    assert.equal(g.summary().roundsWon, 3, `${workMs} ms at target wins every set`);
  }
});
