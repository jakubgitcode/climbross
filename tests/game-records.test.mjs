import test from 'node:test';
import assert from 'node:assert/strict';
import { gameRecord } from '../js/game-records.js';
const plan = { mode:'kayak', unit:'kg', target:10, tolerance:15, workS:6, restS:3, reps:3, sets:4, setRestS:6 };
const item = (points, extra = {}) => ({ demo:false, training:{ plan, points, completed:true }, ...extra });
test('records compare matching gameplay parameters while excluding demo and unfinished sessions', () => {
 const other = item(99); other.training = { ...other.training, plan:{...plan, target:20} };
 const interrupted = item(80); interrupted.training = {...interrupted.training, completed:false};
 assert.equal(gameRecord([item(4), item(100,{demo:true}), interrupted, other, item(9)], plan), 9);
 assert.equal(gameRecord([], plan), null);
});
test('records distinguish the selected hand and starting side', () => {
 const left = {...plan, hand:'left'};
 const right = {...plan, hand:'right'};
 const entry = item(50); entry.training = {...entry.training, plan:left};
 assert.equal(gameRecord([entry],right),null);
});
