import test from 'node:test';
import assert from 'node:assert/strict';
import { ScaleGame } from '../js/scale.js';
test('two seconds in the target band weighs one stone', () => {
 const g = new ScaleGame({ tolerance:.15 }); g.setPhase({kind:'work',set:1,rep:1,hand:'left',ms:3000});
 g.advance(1999,10,10); assert.equal(g.summary().weighed,0); g.advance(1,10,10); assert.equal(g.summary().weighed,1);
});
test('second hand receives first-hand reference and symmetry compares relative force', () => {
 const g = new ScaleGame({ tolerance:.15 });
 g.setPhase({kind:'work',set:1,rep:1,hand:'left',ms:2000}); g.advance(2000,10,10);
 g.setPhase({kind:'work',set:2,rep:1,hand:'right',ms:2000}); g.advance(2000,20,20);
 assert.equal(g.summary().symmetry,100);
});
test('missing sensor data resets the hold without inventing a reference sample', () => {
 const g = new ScaleGame({tolerance:.15});
 g.setPhase({kind:'work',set:1,rep:1,hand:'left',ms:3000}); g.coast(3000);
 g.setPhase({kind:'work',set:2,rep:1,hand:'right',ms:3000}); g.advance(3000,10,10);
 assert.equal(g.summary().symmetry,null);
});
