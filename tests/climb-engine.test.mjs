import test from 'node:test';
import assert from 'node:assert/strict';
import { ClimbGame } from '../js/climb.js';
test('holding target completes a hold and weak force leads to a fall', () => {
 const g = new ClimbGame({ tolerance: .15 });
 g.setPhase({kind:'work',ms:3000,set:1,rep:1}); g.advance(3000, 10, 10); g.endWork();
 assert.equal(g.summary().clean, 1); assert.equal(g.summary().height, 1);
 g.setPhase({kind:'work',ms:3000,set:1,rep:2}); g.advance(3000, 0, 10); g.endWork();
 assert.equal(g.summary().falls, 1); assert.equal(g.summary().height, 0);
});
test('interrupted work does not score a hold', () => {
 const g = new ClimbGame({}); g.setPhase({kind:'work',ms:3000,set:1,rep:1}); g.advance(1000,10,10);
 assert.equal(g.summary().clean, 0);
});
