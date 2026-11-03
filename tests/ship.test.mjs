import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, validatePlan, TrainingSession } from '../js/training.js';
import { ShipGame, HALF_WIDTH, BEND_HALF_WIDTH } from '../js/ship.js';
import { validateBackup } from '../js/store.js';

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
  assert.equal(s.summary().points, Math.floor(s.zoneMs / 1000), 'points are seconds in the zone');
  assert.ok(s.summary().points > 40);
  assert.equal(s.summary().completed, true);
  assert.equal(s.hand, 'both');
});

test('a weaker hand shows up as asymmetry and pushes the ship off course', () => {
  const s = run(ship({ sets: 8, wind: 0 }), (h) => (h === 'left' ? 0.5 : 1));
  const g = s.summary().game;
  assert.ok(Math.abs(g.leftThrust - 0.5) < 0.05, `left ${g.leftThrust}`);
  assert.ok(Math.abs(g.rightThrust - 1) < 0.05);
  assert.ok(Math.abs(g.asymmetryPct - 50) < 5);
  assert.ok(g.hits > 0, 'drift reaches the bank');
});

test('the ship sails at a constant speed whatever the force, and invalid input is ignored', () => {
  const g = new ShipGame();
  g.advance(1000, 30, 'left', 30);
  assert.ok(Math.abs(g.distance - 1) < 1e-9 && g.speed === 1);
  const before = g.distance;
  g.advance(1000, NaN, 'left', 30); g.advance(-5, 30, 'left', 30); g.advance(1000, 30, 'up', 30); g.advance(1000, 30, 'left', 0);
  assert.equal(g.distance, before, 'invalid input is ignored');
  g.coast(2000);
  assert.ok(Math.abs(g.distance - before - 2) < 1e-9, 'a stalled sensor does not stop the ship');
  const idle = run(ship({ wind: 0 }), () => 0).summary().game;
  assert.ok(idle.distance > 100 && idle.hits === 0, 'not pulling steers nowhere');
  assert.ok(run(ship({ wind: 150 }), () => 0).summary().game.hits > 0, 'with wind, not pulling gets blown into the bank');
});

test('thrust is capped and the bank is a wall, not a place to leave the channel', () => {
  const g = new ShipGame();
  for (let i = 0; i < 100; i++) g.advance(1000, 1000, 'left', 10);
  assert.ok(Math.abs(g.y) <= HALF_WIDTH + 1e-9);
  assert.ok(g.hits >= 1 && g.hits < 5, `one hit per contact, got ${g.hits}`);
});

test('a ship result survives backup validation', () => {
  const s = run(ship());
  const m = { id: 'a', date: new Date().toISOString(), hand: s.hand, peakKg: s.peakKg, avgKg: 1, tulS: 1, durationS: 100, samples: s.samples, training: s.summary() };
  assert.equal(validateBackup({ app: 'climbross', measurements: [m] }).measurements.length, 1);
});

test('wind is a ship-only plan field with a sane range', () => {
  assert.equal(validatePlan(ship()).wind, 100);
  assert.equal(validatePlan(ship({ wind: undefined })).wind, 0, 'older saved plans have no wind');
  assert.equal(validatePlan(ship({ wind: '' })).wind, 0);
  for (const wind of [-1, 201, NaN, Infinity, 'strong']) assert.throws(() => validatePlan(ship({ wind })), /Wiatr/);
  assert.equal('wind' in validatePlan({ ...PRESETS.repeaters, wind: 80 }), false);
});

test('wind blows against the steering side of the working hand and is calm between hands', () => {
  const g = new ShipGame({ wind: 1, workS: 6, restS: 3 });
  const dir = (kind, hand) => { g.setPhase(kind, hand); return g.windDir; };
  assert.equal(dir('work', 'left'), 1);
  assert.equal(dir('rest', 'left'), 1);
  assert.equal(dir('work', 'right'), -1);
  assert.equal(dir('setRest', 'right'), 0);
  assert.equal(dir('ready', 'left'), 0);
});

test('an idle ship is pushed by the wind, and calm water leaves it where it is', () => {
  const windy = new ShipGame({ wind: 1, workS: 6, restS: 3 });
  windy.setPhase('rest', 'left'); windy.coast(5000);
  assert.ok(windy.y > 0.1, `drifted toward the lower bank, y=${windy.y}`);
  const calm = new ShipGame({ wind: 1, workS: 6, restS: 3 });
  calm.setPhase('setRest', 'left'); calm.coast(5000);
  assert.equal(calm.y, 0);
  assert.equal(new ShipGame().windSpeed, 0, 'no wind by default');
});

test('with full wind only holding the target force keeps the ship in the middle', () => {
  const track = (force, wind) => {
    const s = new TrainingSession(ship({ wind }), 'left', profile, 0);
    let max = 0;
    for (let t = 0; !s.done && t < 900000; t += 50) {
      s.tick(t); if (s.done) break;
      s.reading(s.phase.kind === 'work' ? s.targetKg * force(s.phase.hand) : 0, t);
      max = Math.max(max, Math.abs(s.shipGame.y));
    }
    return max;
  };
  assert.ok(track(() => 1, 100) < 0.3, 'on target stays centred');
  assert.ok(track(() => 0.3, 100) > 0.5, 'too weak drifts off');
  assert.ok(track(() => 1, 100) < track(() => 1, 0), 'wind makes on-target pulling easier than drifting alone');
});

test('the engines spin the ship up faster than the hull slows down', () => {
  const g = new ShipGame();
  g.advance(3000, 30, 'left', 30);
  const top = g.speed;
  assert.ok(top > 0.85, `speed after 3 s of pulling: ${top}`);
  g.coast(3000);
  assert.ok(g.speed > top * 0.55, `still moving after a 3 s rest: ${g.speed} of ${top}`);
});

test('anywhere inside the tolerance zone steers and drives like exactly on target', () => {
  const at = (ratio) => { const g = new ShipGame({ tolerance: 0.2 }); g.advance(4000, 30 * ratio, 'left', 30); return g; };
  const exact = at(1);
  for (const r of [0.8, 0.9, 1.1, 1.2]) {
    assert.equal(at(r).y, exact.y, `ratio ${r}`);
  }
  assert.ok(Math.abs(at(0.6).y) < Math.abs(exact.y) && Math.abs(at(1.4).y) > Math.abs(exact.y), 'outside the zone the pull matters again');
  assert.equal(at(0).y, 0);
  const g = new ShipGame({ tolerance: 0.2 }); g.advance(1000, 36, 'left', 30);
  assert.ok(Math.abs(g.average('left') - 1.2) < 1e-9, 'the statistics still see the real force');
});

test('plan: river is ship-only, defaults to straight', () => {
  assert.equal(validatePlan(ship()).river, 'straight');
  assert.equal(validatePlan(ship({ river: undefined })).river, 'straight');
  assert.equal(validatePlan(PRESETS.shipBends).river, 'bends');
  assert.throws(() => validatePlan(ship({ river: 'rapids' })), /Rzeka/);
  assert.equal('river' in validatePlan(PRESETS.repeaters), false);
});

test('rough water lies exactly where the plan says work, and the sections follow each other', () => {
  const s = new TrainingSession(ship({ reps: 2, sets: 2, workS: 4, restS: 2, setRestS: 3 }), 'left', profile, 0);
  const sec = s.shipGame.sections;
  assert.deepEqual(sec.map((x) => x.kind), s.phases.map((p) => p.kind));
  for (let i = 1; i < sec.length; i++) assert.ok(Math.abs(sec[i].d0 - sec[i - 1].d1) < 1e-9 && sec[i].d1 >= sec[i].d0);
  const work = sec.find((x) => x.kind === 'work');
  assert.equal(s.shipGame.sectionAt((work.d0 + work.d1) / 2).kind, 'work');
  const rest = sec.find((x) => x.kind === 'rest');
  assert.equal(s.shipGame.sectionAt((rest.d0 + rest.d1) / 2).kind, 'rest');
  assert.equal(s.shipGame.sectionAt(-1), null);
});

test('on-target pulling arrives at each section when its phase starts', () => {
  const s = new TrainingSession(ship({ wind: 0 }), 'left', profile, 0);
  const marks = [];
  for (let t = 0; !s.done && t < 900000; t += 50) {
    s.tick(t); if (s.done) break;
    const before = s.phaseIndex;
    s.reading(s.phase.kind === 'work' ? s.targetKg : 0, t);
    if (s.phaseIndex !== before || t === 0) marks.push([s.phaseIndex, s.shipGame.distance]);
  }
  const sec = s.shipGame.sections;
  for (const [i, d] of marks.slice(1)) if (sec[i]) assert.ok(Math.abs(d - sec[i].d0) < 0.1, `phase ${i}: ship at ${d}, section starts at ${sec[i].d0}`);
});

test('a river with bends curves toward the working hand and an on-target pull follows it', () => {
  const plan = ship({ river: 'bends', wind: 0 });
  const s = run(plan);
  const g = s.shipGame;
  assert.equal(s.summary().game.bends, true);
  assert.equal(g.hits, 0);
  // Left hand pushes up (-), so the first set curves the river that way, and the next set brings it back.
  const first = g.sections.filter((x) => x.kind === 'work')[2], second = g.sections.filter((x) => x.kind === 'work')[3];
  assert.ok(g.centre(first.d1) < -0.6, `river bent ${g.centre(first.d1)}`);
  assert.ok(g.centre(second.d1) > g.centre(first.d1) + 0.1, 'the right hand bends it back');
  let max = 0;
  const t = new TrainingSession(plan, 'left', profile, 0);
  for (let now = 0; !t.done && now < 900000; now += 50) {
    t.tick(now); if (t.done) break;
    t.reading(t.phase.kind === 'work' ? t.targetKg : 0, now);
    max = Math.max(max, Math.abs(t.shipGame.y - t.shipGame.centre(t.shipGame.distance)));
  }
  assert.ok(max < 0.1, `on-target pull stays in the middle of the bends, off by ${max}`);
});

test('bends: wind is ignored, an off-target pull leaves the middle, a straight river does not move', () => {
  assert.equal(new TrainingSession(PRESETS.shipBends, 'left', profile, 0).shipGame.wind, 0);
  assert.equal(new TrainingSession(ship({ river: 'bends', wind: 150 }), 'left', profile, 0).shipGame.wind, 0);
  const weak = run(ship({ river: 'bends', wind: 0 }), () => 0.4);
  assert.ok(weak.shipGame.hits > 0, 'barely pulling falls out of the bends');
  const straight = new TrainingSession(ship({ wind: 0 }), 'left', profile, 0).shipGame;
  assert.equal(straight.centre(5), 0);
  assert.equal(straight.path, null);
});

test('with the calibrated wind, anywhere in the tolerance zone is enough to stay in the middle', () => {
  const track = (force, wind) => {
    const s = new TrainingSession(ship({ wind }), 'left', profile, 0);
    let max = 0;
    for (let t = 0; !s.done && t < 900000; t += 50) {
      s.tick(t); if (s.done) break;
      s.reading(s.phase.kind === 'work' ? s.targetKg * force : 0, t);
      max = Math.max(max, Math.abs(s.shipGame.y));
    }
    return max;
  };
  for (const force of [0.82, 1, 1.18]) assert.ok(track(force, 100) < 0.2, `force ${force}: off by ${track(force, 100)}`);
  assert.ok(track(0.3, 100) > 0.4, 'well below the zone drifts');
});

test('a river with bends is narrower than a straight one', () => {
  assert.equal(new TrainingSession(PRESETS.shipBends, 'left', profile, 0).shipGame.halfWidth, BEND_HALF_WIDTH);
  assert.equal(new TrainingSession(PRESETS.ship, 'left', profile, 0).shipGame.halfWidth, HALF_WIDTH);
  assert.ok(BEND_HALF_WIDTH < HALF_WIDTH);
});

test('every bend goes toward the hand that works it, over the length of that work and no longer', () => {
  const g = new TrainingSession(ship({ river: 'bends', wind: 0 }), 'left', profile, 0).shipGame;
  const works = g.sections.filter((x) => x.kind === 'work');
  for (const w of works) {
    const turn = g.centre(w.d1) - g.centre(w.d0);
    assert.ok(w.hand === 'left' ? turn < -0.3 : turn > 0.3, `${w.hand} hand bends ${turn}`);
  }
  for (const r of g.sections.filter((x) => x.kind === 'rest')) {
    assert.ok(Math.abs(g.centre(r.d1) - g.centre(r.d0)) < 0.1, 'rest is straight (apart from easing out of the bend)');
  }
  const w = works[0], len = w.d1 - w.d0;
  assert.ok(Math.abs(len - 6) < 1e-6, `bend length ${len} equals the work time at constant speed`);
});

test('the gates always line up with the phases, however hard you pull', () => {
  for (const force of [0, 0.5, 1, 2]) {
    const s = new TrainingSession(ship({ wind: 0 }), 'left', profile, 0);
    for (let t = 0; !s.done && t < 900000; t += 50) {
      s.tick(t); if (s.done) break;
      s.reading(s.phase.kind === 'work' ? s.targetKg * force : 0, t);
      const here = s.shipGame.sectionAt(s.shipGame.distance);
      if (here && s.phase.kind !== 'ready') assert.equal(here.kind, s.phase.kind, `force ${force} at ${t} ms`);
    }
  }
});
