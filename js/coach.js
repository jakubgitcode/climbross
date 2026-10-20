import { PRESETS, MAX_KEYS, validatePlan, durationMs, resolveTarget, TrainingSession } from './training.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const HAND = { left: 'Lewa ręka', right: 'Prawa ręka', both: 'Obie ręce' };
const PHASE = { ready: 'Przygotuj się', work: 'Praca', rest: 'Odpoczynek', setRest: 'Przerwa między seriami' };
const kg = (v) => `${v.toFixed(1)} kg`;
const time = (s) => { const n = Math.ceil(s); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };

export function createCoach({ context, busyChanged, toast, historyChanged }) {
  let session = null, result = null, plans = [], saving = false;
  const form = $('trainingForm');
  const fields = ['hand', 'name', 'mode', 'unit', 'target', 'tolerance', 'workS', 'restS', 'reps', 'sets', 'setRestS'];
  function readPlan() {
    return validatePlan(Object.fromEntries(fields.map((k) => [k, form.elements[k].value])));
  }
  function fill(plan) {
    for (const k of fields) if (plan[k] !== undefined) form.elements[k].value = plan[k];
    preview();
  }
  function preview() {
    if (session) return;
    try {
      const p = readPlan(), c = context(), hand = form.elements.hand.value;
      form.elements.target.max = p.unit === 'percent' ? 100 : 300;
      const force = resolveTarget(p, hand, c.profile);
      $('planPreview').textContent = `${HAND[hand]} · cel ${kg(force)} · strefa ${kg(force * (1 - p.tolerance / 100))}–${kg(force * (1 + p.tolerance / 100))} · ${time(durationMs(p) / 1000)} z odliczaniem`;
    } catch (e) { $('planPreview').textContent = e.message; }
    $('flightIntro').hidden = form.elements.mode.value !== 'game';
  }
  function listPlans() {
    $('savedPlans').replaceChildren(new Option('Wybierz zapisany plan', ''), ...plans.map((p, i) => new Option(p.name, String(i))));
  }
  async function reloadPlans() {
    try { plans = await store.getTrainingPlans(); listPlans(); } catch (e) { toast(`Nie można odczytać planów: ${e.message}`); }
  }
  async function savePlan() {
    try {
      const p = readPlan();
      const next = [...plans.filter((x) => x.name !== p.name), p];
      await store.saveTrainingPlans(next);
      plans = next; listPlans(); toast('Plan zapisany na tym urządzeniu.');
    } catch (e) { toast(e.message); }
  }
  function lock(active) {
    $('trainingFields').disabled = active;
    $('trainingStart').disabled = active;
    $('trainingStop').hidden = !active;
    busyChanged(active);
  }
  function start(e) {
    e.preventDefault();
    const c = context();
    if (!c.connected) { toast('Najpierw połącz deskę lub włącz Demo.'); return; }
    if (c.recording || c.pendingResult || result) { toast('Najpierw zapisz lub odrzuć poprzedni wynik.'); return; }
    if (session) return;
    try {
      session = new TrainingSession(readPlan(), form.elements.hand.value, c.profile, performance.now());
      session.profileSnapshot = { ...c.profile };
      session.device = c.device;
      session.demo = c.demo;
      $('coachResult').hidden = true;
      $('coachLive').hidden = false;
      $('flight').hidden = session.plan.mode !== 'game';
      lock(true);
      draw();
      $('coachLive').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { session = null; toast(e.message); }
  }
  function finish(reason) {
    if (!session) return;
    session.tick(performance.now());
    if (!session.done) session.finish(reason, performance.now());
    result = session;
    session = null;
    lock(false);
    $('coachLive').hidden = true;
    $('coachResult').hidden = false;
    const s = result.summary();
    $('coachResultTitle').textContent = `${s.reason}${result.demo ? ' · DEMO' : ''}`;
    $('coachResultText').textContent = `${HAND[result.hand]} · cel ${kg(s.targetKg)} · ${s.completedReps}/${s.plan.reps * s.plan.sets} powtórzeń. W strefie ${s.zoneS.toFixed(1)} z ${s.workS.toFixed(1)} s (${s.accuracy.toFixed(0)}%). Szczyt ${kg(result.peakKg)}.${s.plan.mode === 'game' ? ` Zdobyte gwiazdy: ${s.points}.` : ''}`;
    $('coachSave').disabled = false;
    $('trainingStart').disabled = true;
  }
  function draw() {
    if (!session) return;
    const now = performance.now();
    session.tick(now);
    if (session.done) { finish(session.reason); return; }
    const p = session.phase, work = p.kind === 'work';
    const fresh = session.lastReading !== null && now - session.lastReading <= 500;
    const inZone = fresh && session.kg >= session.minKg && session.kg <= session.maxKg;
    $('coachPhase').textContent = `${PHASE[p.kind]}${session.demo ? ' · DEMO' : ''}`;
    $('coachTime').textContent = time(Math.max(0, p.end - now) / 1000);
    $('coachRound').textContent = `${HAND[session.hand]} · seria ${p.set}/${session.plan.sets} · powtórzenie ${p.rep}/${session.plan.reps}`;
    $('coachForce').textContent = fresh ? kg(session.kg) : 'Czekam na dane…';
    $('coachTarget').textContent = `Cel ${kg(session.targetKg)} · strefa ${kg(session.minKg)}–${kg(session.maxKg)}`;
    $('coachHint').textContent = !work ? 'Rozluźnij chwyt' : !fresh ? 'Czekam na dane…' : inZone ? 'Utrzymaj tę siłę' : session.kg > session.maxKg ? 'Zmniejsz siłę' : 'Zwiększ siłę do celu';
    $('coachLive').dataset.zone = work && inZone ? 'yes' : 'no';
    $('forceMarker').style.left = `${Math.max(0, Math.min(100, session.kg / (session.targetKg * 2) * 100))}%`;
    $('forceZone').style.left = `${session.minKg / (session.targetKg * 2) * 100}%`;
    $('forceZone').style.width = `${session.plan.tolerance}%`;
    $('coachScore').textContent = `W strefie ${(session.zoneMs / 1000).toFixed(1)} s · ★ ${Math.floor(session.zoneMs / 1000)}`;
    const bird = $('flightBird');
    bird.style.top = `${Math.max(8, Math.min(92, 100 - session.kg / (session.targetKg * 2) * 100))}%`;
    $('flightBand').style.top = `${50 - session.plan.tolerance / 2}%`;
    $('flightBand').style.height = `${session.plan.tolerance}%`;
    $('flight').dataset.flying = work ? 'yes' : 'no';
    $('flight').setAttribute('aria-label', `${$('coachForce').textContent}. ${$('coachHint').textContent}. ${$('coachScore').textContent}`);
  }
  async function saveResult() {
    if (!result || saving) return;
    saving = true; $('coachSave').disabled = true;
    const r = result;
    try {
      r.id ||= crypto.randomUUID();
      await store.addMeasurement({
        id: r.id, date: new Date().toISOString(), hand: r.hand,
        peakKg: r.peakKg, avgKg: r.measuredMs ? r.forceIntegral / r.measuredMs : 0,
        tulS: r.loadMs / 1000, durationS: (r.ended - r.started) / 1000,
        bodyWeightKg: r.profileSnapshot.weightKg || 0, maxBeforeKg: r.profileSnapshot[MAX_KEYS[r.hand]] || 0,
        device: r.device, samples: r.samples, hold: '', demo: r.demo, training: r.summary(),
      });
      result = null; $('coachResult').hidden = true; $('trainingStart').disabled = false;
      toast('Wynik zapisany.'); historyChanged();
    } catch (e) { toast(`Zapis nie powiódł się: ${e.message}. Możesz spróbować ponownie.`); }
    finally { saving = false; $('coachSave').disabled = false; }
  }
  for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => fill(PRESETS[button.dataset.preset]));
  form.addEventListener('input', preview);
  form.addEventListener('submit', start);
  $('trainingStop').addEventListener('click', () => finish('Zatrzymano ręcznie'));
  $('planSave').addEventListener('click', savePlan);
  $('savedPlans').addEventListener('change', (e) => { if (e.target.value !== '') fill(plans[Number(e.target.value)]); });
  $('coachSave').addEventListener('click', saveResult);
  $('coachDiscard').addEventListener('click', () => { if (saving) return; result = null; $('coachResult').hidden = true; $('trainingStart').disabled = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish('Przerwano: aplikacja była w tle.'); });
  fill(PRESETS.endurance); reloadPlans();
  setInterval(draw, 100);
  return {
    reading(value, now) { session?.reading(value, now); },
    disconnect() { finish('Przerwano: rozłączono deskę.'); },
    get active() { return !!session; },
    get pending() { return !!result; },
    refresh() { preview(); }, reloadPlans,
  };
}
