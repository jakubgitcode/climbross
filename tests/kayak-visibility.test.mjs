import test from 'node:test';
import assert from 'node:assert/strict';
import { ShipGame, drawShip } from '../js/ship.js';

test('a missed star remains clearly visible after the kayak passes it', () => {
  globalThis.devicePixelRatio = 1;
  const alphas = [];
  const ctx = new Proxy({ globalAlpha: 1, createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
    set(target, key, value) { target[key] = value; if (key === 'globalAlpha') alphas.push(value); return true; },
  });
  const g = new ShipGame({ kayak: true });
  g.items = [{ type: 'star', d: 0, off: 0, state: 'missed' }];
  drawShip({ clientWidth: 420, width: 420, height: 210, getContext: () => ctx }, g, false, 'left');
  assert.ok(!alphas.some(a => a < 0.7), `missed star opacity: ${alphas}`);
});
