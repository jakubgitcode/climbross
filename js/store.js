import { validatePlan } from './training.js';
// Every profile has its own database. The original DB stays intact as "default".
const DB_VERSION = 1;
export const DEFAULT_PROFILE = { name: '', weightKg: 0, maxLeftKg: 0, maxRightKg: 0, maxBothKg: 0, autoUpdateMax: true };
let activeId = 'default';
const databases = new Map();
function openDB(name, catalog = false) {
  if (!databases.has(name)) databases.set(name, new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      if (!catalog) {
        const m = req.result.createObjectStore('measurements', { keyPath: 'id' });
        m.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { databases.delete(name); reject(req.error); };
  }));
  return databases.get(name);
}
function open(id) { return openDB(id === 'default' ? 'climbross' : `climbross-profile-${id}`); }
async function transaction(dbPromise, name, mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(name, mode), result = fn(t.objectStore(name));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
function tx(id, name, mode, fn) { return transaction(open(id), name, mode, fn); }
function catalog(mode, fn) { return transaction(openDB('climbross-catalog', true), 'kv', mode, fn); }
export function activeProfileId() { return activeId; }
export async function initProfiles() {
  let profiles = await catalog('readonly', s => s.get('profiles'));
  if (!profiles?.length) {
    const profile = await getProfile('default');
    profiles = [{ id: 'default', name: profile.name || 'Mój profil' }];
    await catalog('readwrite', s => s.put(profiles, 'profiles'));
  }
  const saved = await catalog('readonly', s => s.get('active'));
  activeId = profiles.some(p => p.id === saved) ? saved : 'default';
}
export async function listProfiles() { return (await catalog('readonly', s => s.get('profiles'))) || []; }
export async function selectProfile(id) {
  if (!(await listProfiles()).some(p => p.id === id)) throw new Error('Nie znaleziono profilu.');
  await catalog('readwrite', s => s.put(id, 'active')); activeId = id;
}
export async function createProfile(name) {
  name = String(name).trim().slice(0, 60);
  if (!name) throw new Error('Wpisz nazwę profilu.');
  const id = crypto.randomUUID();
  await tx(id, 'kv', 'readwrite', s => s.put({ ...DEFAULT_PROFILE, name }, 'profile'));
  const profiles = await listProfiles();
  await catalog('readwrite', s => s.put([...profiles, { id, name }], 'profiles'));
  await selectProfile(id); return id;
}
export async function getProfile(id = activeId) { return { ...DEFAULT_PROFILE, ...((await tx(id, 'kv', 'readonly', s => s.get('profile'))) || {}) }; }
export async function saveProfile(profile, id = activeId) {
  await tx(id, 'kv', 'readwrite', s => s.put(profile, 'profile'));
  await updateProfileName(id, profile.name);
}
async function updateProfileName(id, name) {
  const profiles = await listProfiles();
  await catalog('readwrite', s => s.put(profiles.map(p => p.id === id ? { ...p, name: name || 'Mój profil' } : p), 'profiles'));
}
export async function getTrainingPlans(id = activeId) { return (await tx(id, 'kv', 'readonly', s => s.get('trainingPlans'))) || []; }
export function saveTrainingPlans(plans, id = activeId) { return tx(id, 'kv', 'readwrite', s => s.put(plans.map(validatePlan), 'trainingPlans')); }
export function addMeasurement(m, id = activeId) { return tx(id, 'measurements', 'readwrite', s => s.put(m)); }
export function deleteMeasurement(key, id = activeId) { return tx(id, 'measurements', 'readwrite', s => s.delete(key)); }
export async function listMeasurements(id = activeId) {
  const all = await tx(id, 'measurements', 'readonly', s => s.getAll());
  return all.sort((a, b) => b.date.localeCompare(a.date));
}
export async function exportAll(id = activeId) {
  return { app: 'climbross', version: 2, exportedAt: new Date().toISOString(), profile: await getProfile(id), measurements: await listMeasurements(id), trainingPlans: await getTrainingPlans(id) };
}
// Only these explicit fields are exported. SAS settings never leave local storage.
export async function getCloudConfig(id = activeId) { return (await tx(id, 'kv', 'readonly', s => s.get('cloud'))) || null; }
export function saveCloudConfig(config, id = activeId) { return tx(id, 'kv', 'readwrite', s => s.put(config, 'cloud')); }
export function validateBackup(data) {
  if (!data || data.app !== 'climbross' || !Array.isArray(data.measurements) || data.measurements.length > 50000) throw new Error('Nieprawidłowy plik historii climbross.');
  const plans = data.trainingPlans ?? [];
  if (!Array.isArray(plans) || plans.length > 500) throw new Error('Nieprawidłowe plany.');
  const trainingPlans = plans.map(validatePlan);
  const profile = { ...DEFAULT_PROFILE };
  if (data.profile) {
    profile.name = String(data.profile.name || '').slice(0, 60);
    for (const k of ['weightKg', 'maxLeftKg', 'maxRightKg', 'maxBothKg']) {
      const value = data.profile[k] ?? 0;
      if (!Number.isFinite(value) || value < 0) throw new Error('Nieprawidłowe wartości profilu.');
      profile[k] = value;
    }
    profile.autoUpdateMax = data.profile.autoUpdateMax !== false;
  }
  const measurements = data.measurements.map(m => {
    if (!m || typeof m.id !== 'string' || m.id.length > 200 || typeof m.date !== 'string' || !Number.isFinite(Date.parse(m.date)) || !['left','right','both'].includes(m.hand)) throw new Error('Nieprawidłowy pomiar.');
    for (const k of ['peakKg','avgKg','tulS','durationS']) if (!Number.isFinite(m[k]) || m[k] < 0) throw new Error('Nieprawidłowy wynik pomiaru.');
    if (!Array.isArray(m.samples) || m.samples.length > 100000 || m.samples.some(s => !Array.isArray(s) || s.length !== 2 || !s.every(Number.isFinite))) throw new Error('Nieprawidłowa krzywa siły.');
    if (m.training) {
      validatePlan(m.training.plan);
      for (const k of ['targetKg','zoneS','accuracy','completedReps','points']) if (!Number.isFinite(m.training[k]) || m.training[k] < 0) throw new Error('Nieprawidłowy wynik treningu.');
    }
    return m;
  });
  return { profile, trainingPlans, measurements };
}
/** Atomic merge into the chosen local profile, preserving other profiles. */
export async function importAll(data, id = activeId) {
  const valid = validateBackup(data), oldPlans = await getTrainingPlans(id), db = await open(id);
  const plans = [...oldPlans.filter(p => !valid.trainingPlans.some(v => v.name === p.name)), ...valid.trainingPlans];
  await new Promise((resolve, reject) => {
    const t = db.transaction(['kv','measurements'], 'readwrite');
    if (data.profile) t.objectStore('kv').put(valid.profile, 'profile');
    t.objectStore('kv').put(plans, 'trainingPlans');
    for (const m of valid.measurements) t.objectStore('measurements').put(m);
    t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  if (data.profile) await updateProfileName(id, valid.profile.name);
  return valid.measurements.length;
}
export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* optional */ }
  return false;
}
