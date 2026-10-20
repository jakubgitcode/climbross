import test from 'node:test';
import assert from 'node:assert/strict';
import { JumpGame } from '../js/jump.js';
import { parseSas, upload, download } from '../js/cloud.js';
import { TrainingSession, PRESETS } from '../js/training.js';
const expires = new Date(Date.now() + 86400000).toISOString();
const url = `https://testaccount.blob.core.windows.net/profiles/test.json?sr=b&sp=rcw&spr=https&se=${encodeURIComponent(expires)}&sig=FAKE_NOT_A_REAL_SECRET`;
const backup = { app:'climbross', version:2, profile:{name:'Test'}, measurements:[], trainingPlans:[] };
test('SAS is blob-only, HTTPS, short-lived and least-privilege', () => {
  assert.equal(parseSas(url).resource, 'https://testaccount.blob.core.windows.net/profiles/test.json');
  for (const invalid of [url.replace('sr=b','sr=c'), url.replace('sp=rcw','sp=racwdl'), url.replace('https:','http:'), url.replace('spr=https','spr=http'), url.replace('blob.core.windows.net','example.org'), url.replace('sp=rcw','sp=r'), url.replace(encodeURIComponent(expires), encodeURIComponent('2000-01-01T00:00:00Z'))]) assert.throws(() => parseSas(invalid));
  assert.throws(() => parseSas(url.replace(encodeURIComponent(expires), encodeURIComponent(new Date(Date.now()+40*86400000).toISOString()))));
});
test('first upload is create-only; repeat upload uses ETag', async () => {
  let request;
  const fake = async (u,o) => { request=o; return new Response('',{status:201,headers:{etag:'"v1"'}}); };
  assert.equal(await upload({url},backup,fake),'"v1"');
  assert.equal(request.headers['If-None-Match'],'*');
  assert.equal(request.credentials,'omit'); assert.equal(request.cache,'no-store'); assert.equal(request.redirect,'error');
  await upload({url,etag:'"v1"'},backup,fake);
  assert.equal(request.headers['If-Match'],'"v1"');
  assert.ok(!JSON.parse(request.body).cloud);
});
test('a concurrent update is not overwritten and SAS is never included in errors', async () => {
  await assert.rejects(upload({url,etag:'"old"'},backup,async()=>new Response('',{status:412})), /pobierz i połącz/);
  await assert.rejects(upload({url},backup,async()=>{throw new Error(url);}), e => !e.message.includes('FAKE') && !e.message.includes('sig='));
  await assert.rejects(upload({url},backup,async()=>new Response('',{status:403})), /odrzucił SAS/);
});
test('download requires exposed ETag and validates backup', async () => {
  const r=await download({url},async()=>new Response(JSON.stringify(backup),{headers:{etag:'"v2"'}}));
  assert.equal(r.etag,'"v2"'); assert.equal(r.backup.profile.name,'Test');
  await assert.rejects(download({url},async()=>new Response(JSON.stringify(backup))), /ETag/);
  await assert.rejects(download({url},async()=>new Response('{}',{headers:{etag:'"v2"'}})), /Nieprawidłowy/);
  await assert.rejects(download({url},async()=>new Response('',{headers:{etag:'"v2"','content-length':String(26*1024*1024)}})), /25 MB/);
});
test('continuous pulling cannot create repeated jumps', () => {
  const g=new JumpGame(20);
  for(let t=0;t<200;t+=10)g.advance(10,0);
  for(let t=0;t<5000;t+=10)g.advance(10,20);
  assert.equal(g.jumps,1);
  for(let t=0;t<200;t+=10)g.advance(10,0);
  g.advance(10,20); assert.equal(g.jumps,2);
});
test('jump height does not increase with excess force', () => {
  const a=new JumpGame(20), b=new JumpGame(20);
  a.advance(200,0);b.advance(200,0);
  a.advance(100,20);b.advance(100,100);
  assert.equal(a.height,b.height);
});
test('timely jump clears obstacle, standing collides only once per obstacle', () => {
  const clear=new JumpGame(20), hit=new JumpGame(20);
  for(let t=0;t<3300;t+=10){clear.advance(10,t>=2600?20:0);hit.advance(10,0);}
  assert.equal(clear.cleared,1);assert.equal(clear.missed,0);
  assert.equal(hit.cleared,0);assert.equal(hit.missed,1);
});
test('rest resets obstacles but preserves totals; stale intervals do not advance game', () => {
  const g=new JumpGame(20);for(let t=0;t<3300;t+=10)g.advance(10,0);
  g.rest();assert.equal(g.missed,1);assert.equal(g.obstacles.length,0);
  g.advance(5000,20);assert.equal(g.elapsed,0);assert.equal(g.jumps,0);
});
test('jump mode integrates with session, stops and exports game summary', () => {
  const s=new TrainingSession({...PRESETS.jumps, unit:'kg',target:20,workS:4,reps:1},'left',{},0);
  for(let t=0;!s.done;t+=100)s.reading(0,t);
  assert.equal(s.summary().completed,true);
  assert.equal(s.summary().game.missed,1);
  assert.equal(s.jumpGame.obstacles.length,0);
});
