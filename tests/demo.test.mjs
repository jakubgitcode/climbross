import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDemo } from '../js/ble.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('manual demo board follows setForce with a ramp and releases to zero', async () => {
  const readings = [];
  const board = connectDemo({ onReading: (r) => readings.push(r.kg) }, { manual: true });
  try {
    assert.equal(typeof board.setForce, 'function');
    await wait(150);
    assert.ok(readings.length > 3 && readings.every((kg) => kg === 0), 'idle board reads 0');
    board.setForce(20);
    await wait(120);
    const early = readings.at(-1);
    assert.ok(early > 2 && early < 19, `ramps instead of jumping (${early})`);
    await wait(700);
    assert.ok(Math.abs(readings.at(-1) - 20) < 1, `settles near the set force (${readings.at(-1)})`);
    board.setForce(0);
    await wait(1200);
    assert.equal(readings.at(-1), 0);
  } finally { board.disconnect(); }
});

test('automatic demo board has no manual controls', () => {
  const board = connectDemo({ onReading() {} });
  try { assert.equal(board.setForce, undefined); } finally { board.disconnect(); }
});
