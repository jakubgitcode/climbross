// A SAS is a bearer credential. Never log it, export it, or embed it in public code.
import { validateBackup } from './store.js';
export function parseSas(value, now = Date.now()) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Wklej pełny URL pliku z tokenem SAS.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname) || url.username || url.password || url.port || url.hash) throw new Error('Wymagany jest adres HTTPS pliku w Azure Blob Storage.');
  if (url.pathname.split('/').filter(Boolean).length < 2) throw new Error('SAS musi wskazywać jeden plik profilu.');
  const q = url.searchParams, permissions = q.get('sp') || '', expiry = Date.parse(q.get('se'));
  if (q.get('sr') !== 'b' || q.get('spr') !== 'https' || !q.get('sig') || q.has('snapshot') || q.has('versionid')) throw new Error('Użyj SAS dla jednego bloba (sr=b), tylko HTTPS.');
  if (!permissions.includes('r') || !permissions.includes('w') || /[^rcw]/.test(permissions)) throw new Error('SAS powinien mieć wyłącznie odczyt i zapis (rw lub rcw), bez listowania i usuwania.');
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error('Token SAS wygasł albo nie ma daty ważności.');
  if (expiry - now > 31 * 86400000) throw new Error('Wygeneruj SAS ważny maksymalnie 30 dni.');
  if (q.get('st') && Date.parse(q.get('st')) > now + 60000) throw new Error('Ten SAS nie jest jeszcze aktywny.');
  return { url: url.href, resource: url.origin + url.pathname, expiresAt: new Date(expiry).toISOString() };
}
function failStatus(status) {
  if (status === 403) throw new Error('Azure odrzucił SAS. Sprawdź ważność, uprawnienia i politykę konta.');
  if (status === 412 || status === 409) throw new Error('Plik już istnieje lub zmienił się na innym urządzeniu. Najpierw pobierz i połącz historię, potem wyślij ponownie.');
  if (status === 404) throw new Error('Nie ma jeszcze pliku w chmurze. Wyślij pierwszy zapis.');
  throw new Error(`Azure zwrócił błąd ${status}.`);
}
async function request(config, options, fetcher) {
  const { url } = parseSas(config.url);
  try {
    return await fetcher(url, { ...options, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) });
  } catch { throw new Error('Brak połączenia z Azure. Sprawdź internet i regułę CORS dla adresu aplikacji.'); }
}
function etag(response) {
  const tag = response.headers.get('etag');
  if (!tag) throw new Error('Brak ETag. W CORS konta Storage dodaj ETag do ExposedHeaders, następnie pobierz historię przed kolejnym zapisem.');
  return tag;
}
export async function upload(config, backup, fetcher = fetch) {
  validateBackup(backup);
  const body = JSON.stringify(backup);
  if (new Blob([body]).size > 25 * 1024 * 1024) throw new Error('Historia przekracza limit 25 MB.');
  const response = await request(config, {
    method: 'PUT', body,
    headers: { 'Content-Type': 'application/json', 'x-ms-blob-type': 'BlockBlob', ...(config.etag ? { 'If-Match': config.etag } : { 'If-None-Match': '*' }) },
  }, fetcher);
  if (!response.ok) failStatus(response.status);
  return etag(response);
}
export async function download(config, fetcher = fetch) {
  const response = await request(config, { method: 'GET' }, fetcher);
  if (!response.ok) failStatus(response.status);
  if (Number(response.headers.get('content-length')) > 25 * 1024 * 1024) throw new Error('Plik przekracza limit 25 MB.');
  const tag = etag(response);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 25 * 1024 * 1024) { await reader.cancel(); throw new Error('Plik przekracza limit 25 MB.'); }
    chunks.push(value);
  }
  let backup;
  try { backup = JSON.parse(await new Blob(chunks).text()); } catch { throw new Error('Plik w Azure nie zawiera poprawnego JSON.'); }
  validateBackup(backup);
  return { backup, etag: tag };
}
