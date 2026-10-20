import { validatePlan } from './training.js';
// Local-only storage: the profile and measurements live in IndexedDB on the phone.

const DB_NAME = 'climbross';
const DB_VERSION = 1;
const PROFILE_KEY = 'profile';

export const DEFAULT_PROFILE = {
  name: '',
  weightKg: 0,
  maxLeftKg: 0,
  maxRightKg: 0,
  maxBothKg: 0,
  autoUpdateMax: true,
};

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('kv');
        const m = db.createObjectStore('measurements', { keyPath: 'id' });
        m.createIndex('date', 'date');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getProfile() {
  const p = await tx('kv', 'readonly', (s) => s.get(PROFILE_KEY));
  return { ...DEFAULT_PROFILE, ...(p || {}) };
}

export function saveProfile(profile) {
  return tx('kv', 'readwrite', (s) => s.put(profile, PROFILE_KEY));
}

export async function getTrainingPlans() {
  return (await tx('kv', 'readonly', (s) => s.get('trainingPlans'))) || [];
}

export function saveTrainingPlans(plans) {
  const valid = plans.map(validatePlan);
  return tx('kv', 'readwrite', (s) => s.put(valid, 'trainingPlans'));
}

export function addMeasurement(m) {
  return tx('measurements', 'readwrite', (s) => s.put(m));
}

export function deleteMeasurement(id) {
  return tx('measurements', 'readwrite', (s) => s.delete(id));
}

export async function listMeasurements() {
  const all = await tx('measurements', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function exportAll() {
  return {
    app: 'climbross',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: await getProfile(),
    measurements: await listMeasurements(),
    trainingPlans: await getTrainingPlans(),
  };
}

/** Merges an export into local data. Measurements with the same id are overwritten. */
export async function importAll(data) {
  if (!data || data.app !== 'climbross' || !Array.isArray(data.measurements)) {
    throw new Error('Not a climbross export file');
  }
  const incomingPlans = data.trainingPlans === undefined ? [] : data.trainingPlans;
  if (!Array.isArray(incomingPlans)) throw new Error('Invalid training plans');
  const validPlans = incomingPlans.map(validatePlan);
  if (validPlans.length) {
    const plans = await getTrainingPlans();
    await saveTrainingPlans([...plans.filter((p) => !validPlans.some((v) => v.name === p.name)), ...validPlans]);
  }
  if (data.profile) await saveProfile({ ...DEFAULT_PROFILE, ...data.profile });
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction('measurements', 'readwrite');
    const s = t.objectStore('measurements');
    for (const m of data.measurements) if (m && m.id && m.date) s.put(m);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return data.measurements.length;
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* not critical */ }
  return false;
}
