import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, KAYAK_POWERS, validatePlan, TrainingSession } from '../js/training.js';

const profile = { maxLeftKg: 40, maxRightKg: 50, maxBothKg: 80 };
// Pulls `share(phase)` of the phase target through the whole session.
function play(share, plan = PRESETS.kayak) {
  const s = new TrainingSession(plan, 'left', profile, 0);
  for (let now = 20; !s.done; now += 20) {
    const p = s.phase;
    s.reading(p.kind === 'work' ? s.targetKg * share(p) : 0, now);
  }
  return s;
}

test('kayak preset validates and alternates hands with a different bend per rep', () => {
  const p = validatePlan(PRESETS.kayak);
  assert.equal(p.mode, 'kayak'); assert.equal(p.wind, undefined);
  assert.throws(() => validatePlan({ ...PRESETS.kayak, sets: 3 }), /parzysta/);
  const s = new TrainingSession(p, 'left', profile, 0);
  const work = s.phases.filter((x) => x.kind === 'work');
  assert.deepEqual(work.slice(0, 3).map((x) => x.power), KAYAK_POWERS);
  assert.deepEqual(work.slice(3, 6).map((x) => x.power), KAYAK_POWERS, 'the other hand gets the same bends');
  assert.equal(work[0].hand, 'left'); assert.equal(work[3].hand, 'right');
  // Target follows the hand and the bend: 30% of 40 kg, then the gentle bend at 70% of that.
  assert.ok(Math.abs(s.targetKg - 12) < 1e-9);
  const bends = s.shipGame.sections.filter((x) => x.kind === 'work').map((x) => Math.abs(s.shipGame.centre(x.d1) - s.shipGame.centre(x.d0)));
  assert.ok(bends[1] < bends[0] && bends[0] < bends[2], `gentle < medium < sharp (${bends.slice(0, 3)})`);
});

test('on-target paddling collects every star, builds the combo and earns gold', () => {
  const s = play(() => 1), g = s.summary().game;
  assert.equal(g.type, 'kayak');
  assert.ok(g.totalStars >= 60, `stars laid out (${g.totalStars})`);
  assert.equal(g.stars, g.totalStars); assert.equal(g.hits, 0);
  assert.equal(g.bestStreak, g.totalStars); assert.equal(g.medal, 'złoty');
  assert.ok(g.score > g.totalStars * 3, 'combo multiplies the score');
  assert.equal(s.summary().points, g.score);
});

test('anywhere inside the tolerance zone is as good as on target', () => {
  const g = play((p) => (p.rep % 2 ? 0.88 : 1.12)).summary().game;
  assert.equal(g.stars, g.totalStars);
});

test('weak pulls miss stars, break the combo and hit things', () => {
  const g = play(() => 0.4).summary().game;
  assert.ok(g.stars < g.totalStars * 0.5, `few stars (${g.stars}/${g.totalStars})`);
  assert.ok(g.hits > 0, 'hits a rock or the bank');
  assert.equal(g.medal, '');
  const none = play(() => 0).summary().game;
  assert.ok(none.score < 0.05 * 570, `not pulling earns next to nothing (${none.score})`);
});

test('ignoring the bend strength (always the base target) costs stars', () => {
  // Pull the plain target on every bend: right on the medium one, wrong on gentle and sharp.
  const s = new TrainingSession(PRESETS.kayak, 'left', profile, 0);
  for (let now = 20; !s.done; now += 20) s.reading(s.phase.kind === 'work' ? s.targets[s.phase.hand] : 0, now);
  const g = s.summary().game;
  assert.ok(g.stars < g.totalStars && g.stars > 0, `${g.stars}/${g.totalStars}`);
});

test('one missed star resets the multiplier', () => {
  const s = new TrainingSession(PRESETS.kayak, 'left', profile, 0), g = s.shipGame;
  let top = 0, dropped = false;
  for (let now = 20; !s.done; now += 20) {
    const p = s.phase, slack = p.set === 1 && p.rep === 3;
    s.reading(p.kind === 'work' ? (slack ? 0 : s.targetKg) : 0, now);
    top = Math.max(top, g.multiplier);
    if (top > 1 && g.streak === 0) dropped = true;
  }
  assert.ok(top > 1 && dropped);
});
