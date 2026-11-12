import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../js/store.js';
import { TrainingSession, PRESETS } from '../js/training.js';
test('new game plans and saved results survive JSON backup validation', () => {
 const plans = [PRESETS.climb, PRESETS.scale];
 const measurements = plans.map((p, i) => {
   const session = new TrainingSession({...p,unit:'kg',target:10},'left',{},0);
   for(let t=0;!session.done;t+=100) session.reading(session.phase.kind==='work'?session.targetKg:0,t);
   return { id:String(i), date:'2026-01-01T00:00:00.000Z', hand:session.hand, peakKg:session.peakKg, avgKg:1, tulS:1, durationS:1, samples:session.samples, training:session.summary() };
 });
 const original = {app:'climbross',version:2,trainingPlans:plans,measurements};
 const result = validateBackup(JSON.parse(JSON.stringify(original)));
 assert.deepEqual(result.measurements.map(m=>m.training.game.type), ['climb','scale']);
 assert.deepEqual(result.trainingPlans.map(p=>p.mode),['climb','scale']);
});
