import * as store from './store.js';
import { parseSas, upload, download } from './cloud.js';
const $ = id => document.getElementById(id);
export function createProfilePanel({ blocked, reload, toast }) {
  let busy = false;
  async function refresh() {
    const profiles = await store.listProfiles(), id = store.activeProfileId();
    $('profileSelect').replaceChildren(...profiles.map(p => new Option(p.name, p.id)));
    $('profileSelect').value = id;
    $('activeProfileBadge').textContent = profiles.find(p => p.id === id)?.name || 'Mój profil';
    const config = await store.getCloudConfig(id);
    $('sasUrl').value = '';
    $('cloudStatus').textContent = !config ? 'Brak połączenia z Azure. Dane pozostają na tym urządzeniu.' : `${config.resource} · SAS do ${new Date(config.expiresAt).toLocaleDateString()}${config.syncedAt ? ' · ostatnia operacja: ' + new Date(config.syncedAt).toLocaleString() : ''}`;
    $('cloudUpload').disabled = !config || busy;
    $('cloudDownload').disabled = !config || busy;
  }
  async function run(action) {
    if (busy || blocked()) { toast('Najpierw zakończ pomiar i zapisz lub odrzuć wynik.'); $('profileSelect').value = store.activeProfileId(); return; }
    busy = true;
    $('profileControls').disabled = true; $('cloudControls').disabled = true;
    try { await action(); }
    catch (e) { toast(e.message); $('cloudMessage').textContent = e.message; }
    finally { busy = false; $('profileControls').disabled = false; $('cloudControls').disabled = false; await refresh(); }
  }
  $('profileSelect').addEventListener('change', () => run(async () => {
    await store.selectProfile($('profileSelect').value); await reload(); $('cloudMessage').textContent = '';
  }));
  $('createProfile').addEventListener('click', () => run(async () => {
    await store.createProfile($('newProfileName').value); $('newProfileName').value = ''; await reload(); $('cloudMessage').textContent = 'Nowy profil ma osobną historię i konfigurację Azure.';
  }));
  $('saveSas').addEventListener('click', () => run(async () => {
    const parsed = parseSas($('sasUrl').value), id = store.activeProfileId();
    for (const p of await store.listProfiles()) {
      if (p.id !== id && (await store.getCloudConfig(p.id))?.resource === parsed.resource) throw new Error('Ten plik jest już przypisany do innego lokalnego profilu. Użyj osobnego bloba.');
    }
    const old = await store.getCloudConfig();
    await store.saveCloudConfig({ ...parsed, ...(old?.resource === parsed.resource ? { etag: old.etag, syncedAt: old.syncedAt } : {}) });
    $('cloudMessage').textContent = 'SAS zapisany tylko na tym urządzeniu. Nie trafia do eksportu ani publicznego kodu.';
  }));
  $('forgetSas').addEventListener('click', () => run(async () => {
    await store.saveCloudConfig(null); $('cloudMessage').textContent = 'Usunięto token z tego urządzenia. Historia lokalna i plik w Azure pozostają bez zmian.';
  }));
  $('cloudUpload').addEventListener('click', () => run(async () => {
    const id = store.activeProfileId(), config = await store.getCloudConfig(id);
    if (!config) throw new Error('Najpierw skonfiguruj SAS.');
    $('cloudMessage').textContent = 'Wysyłam historię…';
    const etag = await upload(config, await store.exportAll(id));
    await store.saveCloudConfig({ ...config, etag, syncedAt: new Date().toISOString() }, id);
    $('cloudMessage').textContent = 'Historia tego profilu zapisana w Azure.';
  }));
  $('cloudDownload').addEventListener('click', () => run(async () => {
    const id = store.activeProfileId(), config = await store.getCloudConfig(id);
    if (!config) throw new Error('Najpierw skonfiguruj SAS.');
    $('cloudMessage').textContent = 'Pobieram historię…';
    const result = await download(config);
    if (!confirm(`Pobrać profil „${result.backup.profile?.name || 'bez nazwy'}”? Ustawienia profilu zostaną zastąpione, a historia i plany połączone z lokalnymi. Lokalnie usunięte pomiary mogą wrócić z kopii w chmurze.`)) { $('cloudMessage').textContent = 'Anulowano pobieranie.'; return; }
    await store.importAll(result.backup, id);
    await store.saveCloudConfig({ ...config, etag: result.etag, syncedAt: new Date().toISOString() }, id);
    await reload(); $('cloudMessage').textContent = 'Pobrano i połączono historię. Możesz wysłać połączony zapis.';
  }));
  refresh().catch(e => toast(e.message));
  return { refresh, exclusive: run, get busy() { return busy; } };
}
