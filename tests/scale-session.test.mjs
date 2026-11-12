import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingSession, PRESETS } from '../js/training.js';
test('scale alternates hands and compares paired repetitions', () => {
 const p={...PRESETS.scale, reps:1, sets:2, workS:3, restS:1, setRestS:1};
 const s=new TrainingSession(p,'left',{maxLeftKg:40,maxRightKg:60},0);
 for(let t=0;!s.done;t+=50) s.reading(s.phase.kind==='work'?s.targetKg:0,t);
 assert.equal(s.summary().game.weighed,2);
 assert.ok(s.summary().game.symmetry > 95);
});
