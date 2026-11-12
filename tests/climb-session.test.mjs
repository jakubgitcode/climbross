import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingSession, PRESETS } from '../js/training.js';
const profile = {maxLeftKg:40,maxRightKg:60};
test('climbing can alternate hands per repetition with hand-specific targets', () => {
 const s = new TrainingSession({...PRESETS.climb, handMode:'rep', sets:2, reps:2}, 'left', profile, 0);
 assert.deepEqual(s.phases.filter(p=>p.kind==='work').map(p=>p.hand), ['left','right','left','right']);
 for (let t=0; !s.done; t+=50) s.reading(s.phase.kind === 'work' ? s.targetKg : 0,t);
 assert.equal(s.summary().game.clean,4);
});
test('break between sets announces the next repetition hand', () => {
 const s = new TrainingSession({...PRESETS.climb, handMode:'rep', sets:2, reps:3}, 'left', profile, 0);
 const next = s.phases.findIndex(p=>p.kind==='setRest');
 assert.equal(s.phases[next].hand, s.phases[next+1].hand);
});
test('changing hand between sets requires time to release and switch', () => {
 assert.throws(() => new TrainingSession({...PRESETS.climb,handMode:'rep',sets:2,reps:1,setRestS:0}, 'left', profile, 0), /przerw/i);
});
