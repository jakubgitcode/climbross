import { drawScale } from './scale.js';
import { drawClimb } from './climb.js';
import { drawRunner } from './jump.js';
import { drawShip } from './ship.js';
import { drawTug, RIVALS } from './tug.js';
import { PRESETS, MAX_KEYS, ALTERNATING, validatePlan, durationMs, resolveTarget, findGhost, TrainingSession } from './training.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const HAND = { left: 'Lewa ręka', right: 'Prawa ręka', both: 'Obie ręce' };
const PHASE = { ready: 'Przygotuj się', work: 'Praca', rest: 'Odpoczynek', setRest: 'Przerwa między seriami' };
const kg = (v) => `${v.toFixed(1)} kg`;
const time = (s) => { const n = Math.ceil(s); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };

export function createCoach({ context, busyChanged, toast, historyChanged, demoForce = () => {} }) {
  let session = null, result = null, plans = [], saving = false, starting = false;
  const demo = { held: false, latched: false };
  let audio = null, previousPhase = null, previousScore = 0;
  const sound = $('coachSound'), vibration = $('coachVibration');
  try { sound.checked = localStorage.getItem('coachSound') === '1'; vibration.checked = localStorage.getItem('coachVibration') === '1'; } catch { /* settings remain off */ }
  for (const [box, key] of [[sound, 'coachSound'], [vibration, 'coachVibration']]) box.addEventListener('change', () => {
    try { localStorage.setItem(key, box.checked ? '1' : '0'); } catch { /* optional preference */ }
    if (box === sound && box.checked) try { const C = globalThis.AudioContext || globalThis.webkitAudioContext; if (C) { audio ||= new C(); audio.resume(); } } catch { /* sound unavailable */ }
  });
  function cue() {
    if (vibration.checked) try { navigator.vibrate?.(60); } catch { /* unsupported */ }
    if (sound.checked && audio?.state === 'running') try {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.frequency.value = 660; gain.gain.setValueAtTime(.04, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .12);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .12);
    } catch { /* sound unavailable */ }
  }
  const form = $('trainingForm');
  const fields = ['hand', 'name', 'mode', 'unit', 'target', 'tolerance', 'workS', 'restS', 'reps', 'sets', 'setRestS', 'wind', 'river', 'rival', 'handMode'];
  function readPlan() {
    const input = Object.fromEntries(fields.map((k) => [k, form.elements[k].value]));
    if (input.mode === 'climb') input.handMode = form.elements.climbHandMode.value;
    return validatePlan(input);
  }
  function fill(plan) {
    form.elements.rival.value = plan.rival ?? 'medium';
    form.elements.handMode.value = plan.mode === 'tug' ? plan.handMode ?? 'single' : 'single';
    form.elements.climbHandMode.value = plan.mode === 'climb' ? plan.handMode ?? 'set' : 'set';
    for (const k of fields) if (plan[k] !== undefined) form.elements[k].value = plan[k];
    preview();
  }
  function preview() {
    if (session) return;
    const mode = form.elements.mode.value, ship = ALTERNATING.includes(mode) || mode === 'climb' || mode === 'scale' || (mode === 'tug' && form.elements.handMode.value === 'alternating'), kayak = mode === 'kayak';
    // The ship alternates hands, so "both together" makes no sense; the chosen hand only starts.
    form.elements.hand.options[2].disabled = ship;
    if (ship && form.elements.hand.value === 'both') form.elements.hand.value = 'left';
    $('handLabel').textContent = ship ? 'Ręka startowa' : 'Ręka';
    try {
      const p = readPlan(), c = context(), hand = form.elements.hand.value;
      form.elements.target.max = p.unit === 'percent' ? 100 : 300;
      const force = resolveTarget(p, hand, c.profile);
      const zone = (f) => `${kg(f * (1 - p.tolerance / 100))}–${kg(f * (1 + p.tolerance / 100))}`;
      $('planPreview').textContent = ship
        ? `Lewa: cel ${kg(resolveTarget(p, 'left', c.profile))} · prawa: cel ${kg(resolveTarget(p, 'right', c.profile))} · start: ${HAND[hand].toLowerCase()} · ${time(durationMs(p) / 1000)} z odliczaniem`
        : `${HAND[hand]} · cel ${kg(force)} · strefa ${zone(force)} · ${time(durationMs(p) / 1000)} z odliczaniem`;
      if (p.mode === 'tug') $('planPreview').textContent += ` · ${p.sets} rund · rywal: ${RIVALS[p.rival].label.toLowerCase()}`;
    } catch (e) { $('planPreview').textContent = e.message; }
    $('flightIntro').hidden = form.elements.mode.value !== 'game';
    $('jumpIntro').hidden = form.elements.mode.value !== 'jump';
    $('shipIntro').hidden = mode !== 'ship';
    $('kayakIntro').hidden = !kayak;
    $('tugIntro').hidden = mode !== 'tug';
    $('climbIntro').hidden = mode !== 'climb';
    $('scaleIntro').hidden = mode !== 'scale';
    $('climbHandsRow').hidden = mode !== 'climb';
    $('rivalRow').hidden = mode !== 'tug';
    $('tugHandsRow').hidden = mode !== 'tug';
    $('riverRow').hidden = mode !== 'ship';
    $('windRow').hidden = mode !== 'ship' || form.elements.river.value === 'bends';
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
  /** Force of the simulated hand: power is a share of the current target, 100% = on target. */
  function pushDemo() {
    const pct = Number($('demoPower').value);
    const pulling = demo.held || demo.latched;
    const target = session?.targetKg ?? 0;
    $('demoPowerOut').textContent = `${pct}% celu${target ? ` · ${kg(pct / 100 * target)}` : ''}`;
    $('demoPull').setAttribute('aria-pressed', String(pulling));
    $('demoPull').textContent = pulling ? 'Ciągniesz… (DEMO)' : 'Trzymaj, aby ciągnąć (DEMO)';
    demoForce(session?.demoManual && pulling ? pct / 100 * target : 0);
  }
  function resetDemo() {
    demo.held = false; demo.latched = false; $('demoLatch').checked = false; pushDemo();
  }
  async function start(e) {
    e.preventDefault();
    const c = context();
    if (c.busy) { toast('Poczekaj na zakończenie operacji profilu.'); return; }
    if (!c.connected) { toast('Najpierw połącz deskę lub włącz Demo.'); return; }
    if (c.recording || c.pendingResult || result) { toast('Najpierw zapisz lub odrzuć poprzedni wynik.'); return; }
    if (session || starting) return;
    starting = true;
    try {
      const plan = readPlan(), hand = form.elements.hand.value;
      const ghost = plan.mode === 'tug' && plan.rival === 'ghost' ? findGhost(await store.listMeasurements(), plan, hand) : null;
      session = new TrainingSession(plan, hand, c.profile, performance.now(), ghost);
      session.profileSnapshot = { ...c.profile };
      session.device = c.device;
      session.demo = c.demo;
      session.demoManual = !!c.manualDemo;
      $('coachResult').hidden = true;
      $('coachLive').hidden = false;
      $('flight').hidden = session.plan.mode !== 'game';
      $('runner').hidden = session.plan.mode !== 'jump';
      $('ship').hidden = !session.shipGame;
      $('tug').hidden = !session.tugGame;
      $('climbCanvas').hidden = !session.climbGame;
      $('scaleCanvas').hidden = !session.scaleGame;
      $('demoJump').hidden = session.plan.mode !== 'jump' || !session.demo || session.demoManual;
      $('demoHand').hidden = !session.demoManual;
      resetDemo(); previousPhase = null; previousScore = 0;
      if (sound.checked) try { const C = globalThis.AudioContext || globalThis.webkitAudioContext; if (C) { audio ||= new C(); audio.resume(); } } catch { /* optional */ }
      lock(true);
      draw();
      $('coachLive').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { session = null; toast(e.message); }
    finally { starting = false; }
  }
  function finish(reason) {
    if (!session) return;
    session.tick(performance.now());
    if (!session.done) session.finish(reason, performance.now());
    result = session;
    session = null;
    resetDemo(); $('demoHand').hidden = true;
    lock(false);
    $('coachLive').hidden = true;
    $('coachResult').hidden = false;
    const s = result.summary();
    $('coachResultTitle').textContent = `${s.reason}${result.demo ? ' · DEMO' : ''}`;
    $('coachResultText').textContent = `${HAND[result.hand]} · cel ${kg(s.targetKg)} · ${s.completedReps}/${s.plan.reps * s.plan.sets} powtórzeń. W strefie ${s.zoneS.toFixed(1)} z ${s.workS.toFixed(1)} s (${s.accuracy.toFixed(0)}%). Szczyt ${kg(result.peakKg)}.${s.plan.mode === 'game' ? ` Zdobyte gwiazdy: ${s.points}.` : ''}`;
    if (s.game?.type === 'scale') $('coachResultText').textContent += ` Szalka: zważone ${s.game.weighed}, zgodność rąk ${s.game.symmetry === null ? 'brak porównania' : `${s.game.symmetry.toFixed(0)}%`}.`;
    if (s.game?.type === 'climb') $('coachResultText').textContent += ` Wspinaczka: wysokość ${s.game.height}, czyste chwyty ${s.game.clean}, loty ${s.game.falls}.`;
    if (s.game?.type === 'jump') $('coachResultText').textContent += ` Przeskoczone: ${s.game.cleared}, trafione: ${s.game.missed}, skoki: ${s.game.jumps}.`;
    if (s.game?.type === 'kayak') $('coachResultText').textContent = `Spływ kajakiem · ${s.game.medal ? `medal ${s.game.medal} · ` : ''}${s.game.score} pkt. Gwiazdki ${s.game.stars}/${s.game.totalStars}, najdłuższa seria ${s.game.bestStreak}. Skały: ${s.game.rocks}, brzeg: ${s.game.hits - s.game.rocks}. Lewa ręka ${(s.game.leftThrust * 100).toFixed(0)}% celu, prawa ${(s.game.rightThrust * 100).toFixed(0)}% celu (różnica ${s.game.asymmetryPct.toFixed(0)}%). W strefie ${s.accuracy.toFixed(0)}% czasu pracy. Szczyt ${kg(result.peakKg)}.`;
    if (s.game?.type === 'ship') $('coachResultText').textContent = `Okręt · ${s.completedReps}/${s.plan.reps * s.plan.sets} powtórzeń. Uderzenia w brzeg: ${s.game.hits}. Lewa ręka ${(s.game.leftThrust * 100).toFixed(0)}% celu, prawa ${(s.game.rightThrust * 100).toFixed(0)}% celu (różnica ${s.game.asymmetryPct.toFixed(0)}%). W strefie ${s.accuracy.toFixed(0)}% czasu pracy. Szczyt ${kg(result.peakKg)}.`;
    if (s.game?.type === 'tug') $('coachResultText').textContent += ` Przeciąganie liny: ${s.completed ? '' : 'dotychczasowy wynik — '}${s.game.result}. Rundy ${s.game.roundsWon}:${s.game.roundsLost}, remisy: ${s.game.roundsDrawn}. Rywal: ${RIVALS[s.game.rival].label.toLowerCase()}. Średnia siła podczas pojedynku: Ty ${(s.game.avgPlayer * 100).toFixed(0)}%, rywal ${(s.game.avgRival * 100).toFixed(0)}% celu.`;
    $('coachSave').disabled = false;
    $('trainingStart').disabled = true;
  }
  function draw() {
    if (!session) return;
    const now = performance.now();
    session.tick(now);
    if (session.done) { cue(); finish(session.reason); return; }
    const p = session.phase, work = p.kind === 'work';
    if (previousPhase !== null && previousPhase !== session.phaseIndex) cue();
    previousPhase = session.phaseIndex;
    const eventScore = session.climbGame?.clean ?? session.scaleGame?.weighed ?? session.shipGame?.score ?? session.tugGame?.roundsWon ?? session.jumpGame?.cleared ?? 0;
    if (eventScore > previousScore) cue();
    previousScore = eventScore;
    $('phaseFill').style.width = `${Math.max(0, Math.min(1, (p.end - now) / p.ms)) * 100}%`;
    $('phaseBar').dataset.kind = p.kind;
    const fresh = session.lastReading !== null && now - session.lastReading <= 500;
    const inZone = fresh && session.kg >= session.minKg && session.kg <= session.maxKg;
    const ship = !!session.shipGame || !!session.climbGame || !!session.scaleGame || session.plan.handMode === 'alternating';
    $('coachPhase').textContent = `${ship && p.kind === 'setRest' ? `Zmiana ręki → ${HAND[p.hand]}` : PHASE[p.kind]}${session.demo ? ' · DEMO' : ''}`;
    $('coachTime').textContent = time(Math.max(0, p.end - now) / 1000);
    $('coachRound').textContent = `${ship ? HAND[p.hand] : HAND[session.hand]} · seria ${p.set}/${session.plan.sets} · powtórzenie ${p.rep}/${session.plan.reps}`;
    $('coachForce').textContent = fresh ? kg(session.kg) : 'Czekam na dane…';
    $('coachTarget').textContent = `Cel ${kg(session.targetKg)} · strefa ${kg(session.minKg)}–${kg(session.maxKg)}`;
    $('coachHint').textContent = !work ? 'Rozluźnij chwyt' : !fresh ? 'Czekam na dane…' : inZone ? 'Utrzymaj tę siłę' : session.kg > session.maxKg ? 'Zmniejsz siłę' : 'Zwiększ siłę do celu';
    $('coachLive').dataset.zone = work && inZone ? 'yes' : 'no';
    $('forceMarker').style.left = `${Math.max(0, Math.min(100, session.kg / (session.targetKg * 2) * 100))}%`;
    $('forceZone').style.left = `${session.minKg / (session.targetKg * 2) * 100}%`;
    $('forceZone').style.width = `${session.plan.tolerance}%`;
    $('coachScore').textContent = `W strefie ${(session.zoneMs / 1000).toFixed(1)} s · ★ ${Math.floor(session.zoneMs / 1000)}`;
    if (session.shipGame) {
      drawShip($('shipCanvas'), session.shipGame, work, p.hand);
      $('coachScore').textContent = `★ ${Math.floor(session.zoneMs / 1000)} s w strefie · ⚠ uderzenia ${session.shipGame.hits}`;
      const engine = p.hand === 'left' ? 'lewym' : 'prawym';
      const g = session.shipGame;
      if (g.kayak) {
        const bend = session.power > 1 ? 'ostry' : session.power < 1 ? 'łagodny' : 'średni';
        const turn = p.hand === 'left' ? 'prawo' : 'lewo';
        $('coachScore').textContent = `★ ${g.score} pkt · gwiazdki ${g.stars}/${g.totalStars} · combo ×${g.multiplier} · ⚠ ${g.hits}`;
        $('coachHint').textContent = work
          ? (!fresh ? 'Czekam na dane…' : `Zakręt ${bend} w ${turn} · ${Math.round(session.kg / session.targetKg * 100)}% celu`)
          : `${p.kind === 'rest' ? 'Odpocznij' : p.kind === 'setRest' ? `Zmień rękę: teraz ${HAND[p.hand].toLowerCase()}` : `Zaczynasz ${p.hand === 'left' ? 'lewą' : 'prawą'} ręką`} · następny zakręt ${bend}: ${kg(session.targetKg)}`;
      } else
      $('coachHint').textContent = !work ? (p.kind === 'setRest' ? `Zmień rękę: teraz ${HAND[p.hand].toLowerCase()}` : p.kind === 'ready' ? `Przygotuj się: zaczynasz ${p.hand === 'left' ? 'lewą' : 'prawą'} ręką` : 'Puść i odpocznij') : !fresh ? 'Czekam na dane…' : `Napędzasz ${engine} silnikiem, okręt skręca w ${engine === 'lewym' ? 'prawo' : 'lewo'} · ${Math.round(session.kg / session.targetKg * 100)}% celu`;
      $('shipCanvas').setAttribute('aria-label', `${$('coachScore').textContent}. ${$('coachHint').textContent}`);
    }
    if (session.scaleGame) {
      drawScale($('scaleCanvas'), session.scaleGame);
      $('coachScore').textContent = `Zważone: ${session.scaleGame.weighed}`;
      $('scaleCanvas').setAttribute('aria-label', $('coachScore').textContent + '. ' + $('coachHint').textContent);
    }
    if (session.climbGame) {
      drawClimb($('climbCanvas'), session.climbGame, p.hand);
      $('coachScore').textContent = `Chwyty ${session.climbGame.clean} · loty ${session.climbGame.falls} · wysokość ${session.climbGame.height}`;
      const next = session.phases.slice(session.phaseIndex + 1).find(x => x.kind === 'work');
      if (next) $('coachHint').textContent += ` · następny chwyt: ${HAND[next.hand].toLowerCase()}, ${kg(session.targets[next.hand] * next.power)}`;
      $('climbCanvas').setAttribute('aria-label', $('coachScore').textContent + '. ' + $('coachHint').textContent);
    }
    if (session.tugGame) {
      const g = session.tugGame;
      drawTug($('tugCanvas'), g, work, p.hand);
      $('coachScore').textContent = `Rundy: Ty ${g.roundsWon} : ${g.roundsLost} rywal · remisy ${g.roundsDrawn} · ${g.roundsWon} pkt`;
      $('coachHint').textContent = !work ? 'Puść i odpocznij — lina stoi' : g.roundResult
        ? `Runda: ${g.roundResult}. Do końca pracy utrzymuj siłę w strefie celu.`
        : !fresh ? 'Czekam na dane…' : g.warning ? 'Za sekundę rywal szarpnie — utrzymaj chwyt!'
        : g.rivalState === 'surge' ? 'Rywal szarpie — utrzymaj chwyt!'
        : g.rivalState === 'fatigue' ? 'Rywal łapie oddech — trzymaj siłę w celu'
        : inZone ? 'Utrzymaj tę siłę — przeciągasz linę' : session.kg > session.maxKg ? 'Zmniejsz siłę do strefy celu' : 'Zwiększ siłę do celu';
      $('tugCanvas').setAttribute('aria-label', `${$('coachScore').textContent}. ${$('coachHint').textContent}`);
    }
    if (session.jumpGame) {
      drawRunner($('runner'), session.jumpGame, work);
      $('demoJump').disabled = !work;
      $('coachScore').textContent = `★ ${session.jumpGame.cleared} przeskoczonych · × ${session.jumpGame.missed} trafionych`;
      $('coachHint').textContent = !work ? 'Rozluźnij chwyt' : session.demo && !session.demoManual ? 'Dotknij „Skok” przed przeszkodą' : session.jumpGame.armed ? `Dociągnij do ${kg(session.targetKg)}, żeby skoczyć` : `Odpuść poniżej ${kg(session.targetKg / 2)}, aby przygotować kolejny skok`;
      $('runner').setAttribute('aria-label', $('coachScore').textContent + '. ' + $('coachHint').textContent);
    }
    if (session.demoManual) pushDemo();
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
        bodyWeightKg: r.profileSnapshot.weightKg || 0,
        maxBeforeKg: (r.shipGame || r.climbGame || r.scaleGame || r.plan.handMode === 'alternating' ? Math.max(r.profileSnapshot.maxLeftKg || 0, r.profileSnapshot.maxRightKg || 0) : r.profileSnapshot[MAX_KEYS[r.hand]]) || 0,
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
  $('demoJump').addEventListener('click', () => { if (session?.demo && session.phase.kind === 'work') session.jumpGame?.jump(); });
  const hold = (on) => { demo.held = on; pushDemo(); };
  $('demoPull').addEventListener('pointerdown', (e) => { e.preventDefault(); hold(true); try { $('demoPull').setPointerCapture(e.pointerId); } catch { /* finger still tracked by pointerup/cancel */ } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('demoPull').addEventListener(type, () => hold(false));
  $('demoPull').addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) hold(true); } });
  $('demoPull').addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false); });
  $('demoPull').addEventListener('contextmenu', (e) => e.preventDefault());
  $('demoPower').addEventListener('input', pushDemo);
  $('demoLatch').addEventListener('change', () => { demo.latched = $('demoLatch').checked; pushDemo(); });
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
    refresh() { preview(); },
    resetPlan() { fill(PRESETS.endurance); }, reloadPlans,
  };
}
