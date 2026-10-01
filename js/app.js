import * as ble from './ble.js';
import * as store from './store.js';
import { drawChart } from './chart.js';

const $ = (id) => document.getElementById(id);
const fmt = (kg) => (Number.isFinite(kg) ? kg.toFixed(1) : '–');
const HAND_LABEL = { left: 'Left hand', right: 'Right hand', both: 'Both hands' };
const HAND_SHORT = { left: 'L', right: 'R', both: 'B' };
const MAX_KEY = { left: 'maxLeftKg', right: 'maxRightKg', both: 'maxBothKg' };

const LOAD_THRESHOLD_KG = 1;   // counts as "under load" above this
const AUTOSTOP_MIN_PEAK_KG = 5; // only auto-stop once a real pull happened
const AUTOSTOP_RELEASE_MS = 1500;
const IDLE_WINDOW_MS = 10000;
const STORE_EVERY_MS = 50;     // samples kept in history at ~20 Hz

const state = {
  conn: null,
  profile: { ...store.DEFAULT_PROFILE },
  hand: localGet('hand') || 'right',
  tare: 0,
  rawRecent: [],     // [t, kg before tare] for zeroing
  filter: new ble.ForceFilter(),
  idle: [],          // [t, kg] for the chart when not recording
  rec: null,         // active recording
  result: null,      // finished recording awaiting save/discard
  battery: null,
  hanging: true,
  dirty: true,
  histFilter: 'all',
};

// ---------- readings ----------

function onReading(r) {
  const now = performance.now();
  state.battery = r.battery ?? state.battery;
  state.hanging = r.hanging;
  state.rawRecent.push([now, r.kg]);
  while (state.rawRecent.length && now - state.rawRecent[0][0] > 600) state.rawRecent.shift();

  const kg = state.filter.push({ ...r, kg: r.kg - state.tare });
  const rec = state.rec;
  if (rec) {
    const t = now - rec.start;
    rec.samples.push([t, kg]);
    if (kg > rec.peak) { rec.peak = kg; rec.peakT = t; }
    if (kg >= LOAD_THRESHOLD_KG) {
      if (rec.lastT !== null && rec.lastKg >= LOAD_THRESHOLD_KG) rec.loadedMs += t - rec.lastT;
      rec.loadSum += kg; rec.loadCount++;
    }
    rec.lastT = t; rec.lastKg = kg;
    if ($('autoStop').checked && rec.peak >= AUTOSTOP_MIN_PEAK_KG) {
      const releaseLevel = Math.max(LOAD_THRESHOLD_KG, rec.peak * 0.1);
      if (kg < releaseLevel) {
        rec.releasedAt ??= t;
        if (t - rec.releasedAt > AUTOSTOP_RELEASE_MS) stopRecording();
      } else {
        rec.releasedAt = null;
      }
    }
  } else {
    state.idle.push([now, kg]);
    while (state.idle.length && now - state.idle[0][0] > IDLE_WINDOW_MS) state.idle.shift();
  }
  state.dirty = true;
}

function render() {
  if (state.dirty) {
    state.dirty = false;
    $('liveKg').textContent = fmt(state.filter.value);
    const rec = state.rec;
    const peak = rec ? rec.peak : state.result ? state.result.peakKg : NaN;
    $('peakKg').textContent = Number.isFinite(peak) && peak > 0 ? `${fmt(peak)} kg` : '–';
    const max = state.profile[MAX_KEY[state.hand]];
    $('pctMaxWrap').hidden = !(max > 0);
    $('pctMax').textContent = max > 0 && peak > 0 ? `${Math.round((peak / max) * 100)}%` : '–';
    $('timer').textContent = rec ? `${((performance.now() - rec.start) / 1000).toFixed(1)} s` : state.result ? `${state.result.durationS.toFixed(1)} s` : '0.0 s';

    const bat = $('battery');
    bat.hidden = state.battery == null || !state.conn;
    bat.textContent = `🔋 ${state.battery}%`;
    $('mode').hidden = !state.conn || state.hanging;
    $('mode').textContent = 'Lifting';

    drawMainChart();
  }
  requestAnimationFrame(render);
}

function drawMainChart() {
  const canvas = $('chart');
  const max = state.profile[MAX_KEY[state.hand]];
  if (state.rec) {
    drawChart(canvas, state.rec.samples, { hand: state.hand, maxKg: max, peak: [state.rec.peakT, state.rec.peak] });
  } else if (state.result) {
    const r = state.result;
    drawChart(canvas, r.samples, { hand: r.hand, maxKg: max, peak: [r.peakT, r.peakKg] });
  } else {
    const t0 = state.idle.length ? state.idle[state.idle.length - 1][0] - IDLE_WINDOW_MS : 0;
    drawChart(canvas, state.idle.map(([t, kg]) => [t - t0, kg]), { hand: state.hand, maxKg: max, fixedSpanMs: IDLE_WINDOW_MS });
  }
}

// ---------- recording ----------

function startRecording() {
  hideResult();
  state.rec = {
    start: performance.now(), samples: [], peak: 0, peakT: 0,
    loadedMs: 0, loadSum: 0, loadCount: 0, lastT: null, lastKg: 0, releasedAt: null,
  };
  const btn = $('startBtn');
  btn.textContent = 'Stop';
  btn.classList.add('stop');
  state.dirty = true;
}

function stopRecording() {
  const rec = state.rec;
  if (!rec) return;
  state.rec = null;
  const btn = $('startBtn');
  btn.textContent = 'Start';
  btn.classList.remove('stop');

  const maxBefore = state.profile[MAX_KEY[state.hand]] || 0;
  state.result = {
    hand: state.hand,
    peakKg: rec.peak,
    peakT: rec.peakT,
    avgKg: rec.loadCount ? rec.loadSum / rec.loadCount : 0,
    tulS: rec.loadedMs / 1000,
    durationS: rec.samples.length ? rec.samples[rec.samples.length - 1][0] / 1000 : 0,
    maxBeforeKg: maxBefore,
    bodyWeightKg: state.profile.weightKg || 0,
    samples: downsample(rec.samples, STORE_EVERY_MS, rec.peakT),
  };
  showResult(state.result);
  state.dirty = true;
}

/** Keeps one sample per interval, always including the peak sample. */
function downsample(samples, everyMs, peakT) {
  const out = [];
  let next = 0;
  for (const [t, kg] of samples) {
    if (t >= next || t === peakT) {
      out.push([Math.round(t), Math.round(kg * 100) / 100]);
      next = t + everyMs;
    }
  }
  return out;
}

function showResult(r) {
  $('resTitle').textContent = HAND_LABEL[r.hand];
  $('resPeak').textContent = `${fmt(r.peakKg)} kg`;
  $('resBw').textContent = r.bodyWeightKg > 0 ? `${Math.round((r.peakKg / r.bodyWeightKg) * 100)}%` : 'set weight';
  $('resVsMax').textContent = r.maxBeforeKg > 0 ? `${Math.round((r.peakKg / r.maxBeforeKg) * 100)}%` : 'no max yet';
  $('resAvg').textContent = `${fmt(r.avgKg)} kg`;
  $('resTul').textContent = `${r.tulS.toFixed(1)} s`;
  $('resHold').value = localGet('lastHold') || '';
  const beats = r.peakKg > r.maxBeforeKg && r.peakKg > 0;
  $('resBadge').hidden = !(beats && r.maxBeforeKg > 0);
  $('resUpdateMax').checked = beats && state.profile.autoUpdateMax;
  $('resUpdateMaxWrap').hidden = !(r.peakKg > 0);
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  state.result = null;
  $('result').hidden = true;
}

async function saveResult() {
  const r = state.result;
  if (!r) return;
  const hold = $('resHold').value.trim();
  localSet('lastHold', hold);
  await store.addMeasurement({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    date: new Date().toISOString(),
    hand: r.hand,
    peakKg: round2(r.peakKg),
    avgKg: round2(r.avgKg),
    tulS: round2(r.tulS),
    durationS: round2(r.durationS),
    bodyWeightKg: r.bodyWeightKg,
    maxBeforeKg: r.maxBeforeKg,
    hold,
    device: state.conn ? state.conn.name : null,
    samples: r.samples,
  });
  if ($('resUpdateMax').checked) {
    state.profile[MAX_KEY[r.hand]] = round2(r.peakKg);
    await store.saveProfile(state.profile);
    fillProfileForm();
    toast(`Saved. ${HAND_LABEL[r.hand]} max is now ${fmt(r.peakKg)} kg.`);
  } else {
    toast('Saved.');
  }
  hideResult();
  state.dirty = true;
  renderHistory();
}

// ---------- connection ----------

async function toggleConnection(demo = false) {
  if (state.conn) {
    if (state.rec) stopRecording();
    state.conn.disconnect();
    onDisconnected();
    return;
  }
  const handlers = { onReading, onDisconnect: onDisconnected, showAll: $('showAll').checked };
  try {
    if (demo) {
      state.conn = ble.connectDemo(handlers);
    } else {
      if (!ble.isSupported()) {
        toast('Web Bluetooth is not available. Use Chrome on Android, served over https.');
        return;
      }
      $('connectBtn').textContent = 'Connecting…';
      state.conn = await ble.connect(handlers);
    }
    state.filter.reset();
    state.tare = 0;
    $('connectBtn').textContent = state.conn.name;
    $('connectBtn').classList.add('connected');
    $('startBtn').disabled = false;
    keepAwake();
  } catch (e) {
    $('connectBtn').textContent = 'Connect';
    if (e && e.name !== 'NotFoundError') toast(`Could not connect: ${e.message || e}`);
  }
}

function onDisconnected() {
  if (!state.conn) return;
  if (state.rec) stopRecording();
  state.conn = null;
  $('connectBtn').textContent = 'Connect';
  $('connectBtn').classList.remove('connected');
  $('startBtn').disabled = true;
  releaseAwake();
  state.dirty = true;
}

function tare() {
  if (!state.rawRecent.length) { toast('Connect the board first.'); return; }
  state.tare = state.rawRecent.reduce((a, [, kg]) => a + kg, 0) / state.rawRecent.length;
  state.filter.reset();
  toast(`Zeroed at ${fmt(state.tare)} kg.`);
}

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
}
function releaseAwake() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.conn) keepAwake();
});

// ---------- history ----------

async function renderHistory() {
  const all = await store.listMeasurements();
  const best = { left: 0, right: 0, both: 0 };
  for (const m of all) best[m.hand] = Math.max(best[m.hand] || 0, m.peakKg);

  const bests = $('bests');
  bests.replaceChildren(
    ...['left', 'right', 'both'].map((h) => el('div', { class: `best ${h}` },
      el('div', { class: 'k' }, `Best ${h}`),
      el('div', { class: 'v' }, best[h] ? fmt(best[h]) : '–'))),
  );
  if (best.left && best.right) {
    const diff = Math.abs(best.left - best.right) / Math.max(best.left, best.right);
    const weaker = best.left < best.right ? 'left' : 'right';
    bests.append(el('div', { class: 'asym' },
      diff < 0.005 ? 'Left and right are even.' : `${weaker[0].toUpperCase() + weaker.slice(1)} hand is ${Math.round(diff * 100)}% weaker.`));
  }

  const items = all.filter((m) => state.histFilter === 'all' || m.hand === state.histFilter);
  $('histEmpty').hidden = items.length > 0;
  $('histList').replaceChildren(...items.map(historyItem));
}

function historyItem(m) {
  const d = new Date(m.date);
  const bw = m.bodyWeightKg > 0 ? ` · ${Math.round((m.peakKg / m.bodyWeightKg) * 100)}% BW` : '';
  const sub = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${m.hold ? ' · ' + m.hold : ''}`;
  const li = el('li', { class: 'item' },
    el('div', { class: 'item-main' },
      el('span', { class: `hand ${m.hand}` }, HAND_SHORT[m.hand]),
      el('div', { class: 'item-body' },
        el('div', { class: 'item-title' }, `${fmt(m.peakKg)} kg peak${bw}`),
        el('div', { class: 'item-sub' }, sub))));
  li.firstChild.addEventListener('click', () => {
    const open = li.querySelector('.item-detail');
    if (open) { open.remove(); return; }
    const canvas = el('canvas', { height: '120' });
    const del = el('button', { class: 'btn' }, 'Delete');
    del.addEventListener('click', async () => {
      if (!confirm('Delete this measurement?')) return;
      await store.deleteMeasurement(m.id);
      renderHistory();
    });
    const stats = el('p', { class: 'hint' },
      `Avg under load ${fmt(m.avgKg)} kg · time under load ${m.tulS.toFixed(1)} s` + (m.maxBeforeKg > 0 ? ` · ${Math.round((m.peakKg / m.maxBeforeKg) * 100)}% of max then` : ''));
    li.append(el('div', { class: 'item-detail' }, canvas, stats, el('div', { class: 'row' }, del)));
    const peak = m.samples.reduce((p, s) => (s[1] > p[1] ? s : p), [0, 0]);
    drawChart(canvas, m.samples, { hand: m.hand, peak });
  });
  return li;
}

// ---------- profile & data ----------

function fillProfileForm() {
  const f = $('profileForm');
  for (const [k, v] of Object.entries(state.profile)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v || '';
  }
}

async function saveProfileForm(e) {
  e.preventDefault();
  const f = e.target;
  state.profile = {
    ...state.profile,
    name: f.elements.name.value.trim(),
    weightKg: num(f.elements.weightKg.value),
    maxLeftKg: num(f.elements.maxLeftKg.value),
    maxRightKg: num(f.elements.maxRightKg.value),
    maxBothKg: num(f.elements.maxBothKg.value),
    autoUpdateMax: f.elements.autoUpdateMax.checked,
  };
  await store.saveProfile(state.profile);
  $('profileSaved').hidden = false;
  setTimeout(() => { $('profileSaved').hidden = true; }, 2000);
  state.dirty = true;
}

async function exportData() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `climbross-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const n = await store.importAll(JSON.parse(await file.text()));
    state.profile = await store.getProfile();
    fillProfileForm();
    renderHistory();
    toast(`Imported ${n} measurements.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
}

async function showStorageInfo() {
  const persisted = await store.requestPersistence();
  let text = persisted ? 'Storage is persistent.' : 'Storage may be cleared by the browser if the phone runs low on space; export backups.';
  try {
    const est = await navigator.storage.estimate();
    text += ` Using ${(est.usage / 1024 / 1024).toFixed(1)} MB.`;
  } catch { /* optional */ }
  $('storageInfo').textContent = text;
}

// ---------- ui plumbing ----------

function setHand(hand) {
  if (state.rec) return;
  state.hand = hand;
  localSet('hand', hand);
  for (const b of $('handSeg').children) b.setAttribute('aria-checked', String(b.dataset.hand === hand));
  hideResult();
  state.dirty = true;
}

function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${name}`);
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (name === 'history') renderHistory();
  if (name === 'profile') showStorageInfo();
  if (name === 'measure') state.dirty = true;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...children);
  return n;
}

function num(v) { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; }
function round2(x) { return Math.round(x * 100) / 100; }
function localGet(k) { try { return localStorage.getItem(`climbross.${k}`); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(`climbross.${k}`, v); } catch { /* optional */ } }

async function init() {
  setHand(state.hand);
  $('connectBtn').addEventListener('click', () => toggleConnection(false));
  $('demoBtn').addEventListener('click', () => { if (!state.conn) toggleConnection(true); showView('measure'); });
  $('startBtn').addEventListener('click', () => (state.rec ? stopRecording() : startRecording()));
  $('tareBtn').addEventListener('click', tare);
  $('saveBtn').addEventListener('click', saveResult);
  $('discardBtn').addEventListener('click', () => { hideResult(); state.dirty = true; });
  $('handSeg').addEventListener('click', (e) => e.target.dataset.hand && setHand(e.target.dataset.hand));
  $('histFilter').addEventListener('click', (e) => {
    const f = e.target.dataset.filter;
    if (!f) return;
    state.histFilter = f;
    for (const b of $('histFilter').children) b.setAttribute('aria-pressed', String(b.dataset.filter === f));
    renderHistory();
  });
  document.querySelector('.tabs').addEventListener('click', (e) => e.target.dataset.view && showView(e.target.dataset.view));
  $('profileForm').addEventListener('submit', saveProfileForm);
  $('exportBtn').addEventListener('click', exportData);
  $('importInput').addEventListener('change', importData);
  window.addEventListener('resize', () => { state.dirty = true; });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  requestAnimationFrame(render);

  try {
    state.profile = await store.getProfile();
  } catch (e) {
    toast(`Local storage unavailable, nothing will be saved: ${e.message || e}`);
  }
  fillProfileForm();
  state.dirty = true;
  document.documentElement.dataset.ready = '1';
}

init();
