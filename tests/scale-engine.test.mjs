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
test('two unloaded hands do not claim perfect force symmetry', () => {
 const g = new ScaleGame({});
 g.setPhase({kind:'work',set:1,rep:1,hand:'left',ms:2000}); g.advance(2000,0,10);
 g.setPhase({kind:'work',set:2,rep:1,hand:'right',ms:2000}); g.advance(2000,0,10);
 assert.equal(g.summary().symmetry,null);
});
test('a pull compared with no pull still contributes to symmetry', () => {
 const g = new ScaleGame({});
 g.setPhase({kind:'work',set:1,rep:1,hand:'left',ms:2000}); g.advance(2000,10,10);
 g.setPhase({kind:'work',set:2,rep:1,hand:'right',ms:2000}); g.advance(2000,0,10);
 assert.equal(g.summary().symmetry,0);
});
test('second hand is not described as the first when reference data is missing', async () => {
 const { drawScale } = await import('../js/scale.js');
 const messages=[];
 const context = new Proxy({}, {get: (o,k) => k === 'fillText' ? (text) => messages.push(text) : () => {}});
 const g = new ScaleGame({});
 g.setPhase({kind:'work',set:2,rep:1,hand:'right',ms:2000});
 drawScale({getContext:()=>context},g);
 assert.ok(messages.some(x=>/brak.*wzorc/i.test(x)), messages.join(' | '));
 assert.ok(!messages.some(x=>/Pierwsza ręka: zapamiętuję/.test(x)));
});
test('scale shows effort and a success message when the weight is balanced', async () => {
 const {drawScale} = await import('../js/scale.js');
 const text=[]; const c=new Proxy({}, { get:(o,k)=>k==='fillText'?(s)=>text.push(s):()=>{} });
 const g=new ScaleGame({}); g.setPhase({kind:'work',set:1,rep:1,ms:3000}); g.advance(2000,10,10);
 drawScale({getContext:()=>c},g);
 assert.ok(text.some(s=>/równowaga/i.test(s)),text.join(' | '));
 assert.ok(text.some(s=>/100%/.test(s)),text.join(' | '));
});
test('success animation does not report balance after force leaves the target band', async () => {
 const {drawScale} = await import('../js/scale.js');
 const text=[]; const c=new Proxy({}, {get:(o,k)=>k==='fillText'?(s)=>text.push(s):()=>{}});
 const g=new ScaleGame({}); g.setPhase({kind:'work',set:1,rep:1,ms:4000}); g.advance(2000,10,10); g.advance(100,0,10);
 drawScale({getContext:()=>c},g);
 assert.ok(!text.some(s=>/RÓWNOWAGA!/.test(s)),text.join(' | '));
});
