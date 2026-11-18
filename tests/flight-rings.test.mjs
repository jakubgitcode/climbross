import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingSession, PRESETS } from '../js/training.js';
const plan={...PRESETS.flight,unit:'kg',target:20,tolerance:10,workS:6,restS:3,reps:2,sets:1};
function play(force) { const s=new TrainingSession(plan,'left',{},0); for(let t=0;!s.done;t+=50) s.reading(s.phase.kind==='work'?force:0,t); return s.summary(); }
test('rings count accurate crossings during work, with streak and existing time score preserved',()=>{
 const x=play(20); assert.equal(x.game.type,'flight'); assert.equal(x.game.hit,6); assert.equal(x.game.missed,0); assert.equal(x.game.bestStreak,6); assert.equal(x.points,Math.floor(x.zoneS)); assert.equal(x.points,11);
});
test('misses break a streak and rest never creates rings',()=>{
 const x=play(0); assert.equal(x.game.hit,0); assert.equal(x.game.missed,6); assert.equal(x.points,0);
});
test('precise center crossings are distinguished from edge crossings',()=>{
 assert.equal(play(20).game.perfect,6);
 assert.equal(play(21.8).game.perfect,0);
 assert.equal(play(21.8).game.hit,6);
});
test('a stale reading cannot score a ring and a later miss resets the streak', async()=>{
 const { FlightGame }=await import('../js/flight.js');
 const g=new FlightGame(.1); g.setPhase('work'); g.advance(2000,20,20); g.advance(2000,20,20,false);
 assert.deepEqual(g.summary(),{type:'flight',hit:1,perfect:1,missed:1,bestStreak:1});
 assert.equal(g.streak,0);
 g.setPhase('rest'); g.advance(10000,20,20); assert.equal(g.summary().missed,1);
});
