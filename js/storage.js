import { rooms, entryRoom, roomStates, history, changedDuringLoad } from './state.js';

const DEFAULT_CLOUD_CONFIG = {
  url: 'https://fgwlfstijmkxuqkhcseq.supabase.co',
  publishableKey: 'sb_publishable_iGxoOh5lswoMSym3QD5CJA_7kRSpD2L'
};
const CLOUD_STORAGE_KEY = 'smart-home-control-cloud-config';

let db;
let cloudClient;
let cloudClientKey = '';

export function getCloudConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLOUD_STORAGE_KEY));
    if (saved && typeof saved.url === 'string' && typeof saved.publishableKey === 'string') {
      return {
        url: saved.url.trim() || DEFAULT_CLOUD_CONFIG.url,
        publishableKey: saved.publishableKey.trim() || DEFAULT_CLOUD_CONFIG.publishableKey
      };
    }
  } catch {}
  return { ...DEFAULT_CLOUD_CONFIG };
}

export function saveCloudConfig(url, publishableKey) {
  const next = {
    url: (url || '').trim(),
    publishableKey: (publishableKey || '').trim()
  };
  localStorage.setItem(CLOUD_STORAGE_KEY, JSON.stringify(next));
  cloudClient = null;
  cloudClientKey = '';
  return getCloudConfig();
}

export function resetCloudConfig() {
  localStorage.removeItem(CLOUD_STORAGE_KEY);
  cloudClient = null;
  cloudClientKey = '';
  return getCloudConfig();
}

function connectDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('smart-home-iot', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rooms', { keyPath: 'index' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readDatabase() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('rooms').objectStore('rooms').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function saveRoom(index, onStatus) {
  if (!db) return;
  const room = roomStates[index];
  const records = history[index];
  const tx = db.transaction('rooms', 'readwrite');
  tx.objectStore('rooms').put({ index, state: { ...room }, records: [...records] });
  tx.oncomplete = () => onStatus?.('IndexedDB · Деректер сақталды');
  tx.onabort = () => onStatus?.('Дерекқорға сақтау сәтсіз болды');
}

export function logRoom(index, action, energyFn, onStatus) {
  const room = roomStates[index];
  changedDuringLoad.add(index);
  const records = history[index];
  records.push({
    at: new Date().toISOString(),
    air: Number(room.air.toFixed ? room.air.toFixed(1) : room.air),
    humidity: Math.round(room.humidity),
    lux: Math.round(room.lux),
    power: energyFn(room),
    action
  });
  if (records.length > 120) records.shift();
  saveRoom(index, onStatus);
}

export async function initLocalDatabase(onStatus, onLoaded) {
  try {
    db = await connectDatabase();
    const saved = await readDatabase();
    saved.forEach(record => {
      if (!roomStates[record.index] || changedDuringLoad.has(record.index)) return;
      const savedRoom = roomStates[record.index];
      Object.assign(savedRoom, record.state);
      if (record.index === entryRoom && savedRoom.lock) savedRoom.door = false;
      history[record.index] = Array.isArray(record.records) ? record.records : [];
    });
    rooms.forEach((_, index) => {
      if (!saved.some(record => record.index === index) || changedDuringLoad.has(index)) {
        saveRoom(index, onStatus);
      }
    });
    onStatus?.('IndexedDB · Дерекқор дайын');
    onLoaded?.();
  } catch {
    onStatus?.('IndexedDB қолжетімсіз · Деректер осы сеанста ғана сақталады');
  }
}

async function ensureCloudClient() {
  const cfg = getCloudConfig();
  if (!cfg.url || !cfg.publishableKey) throw Error('Supabase конфигурациясы толтырылмаған');
  const key = cfg.url + '|' + cfg.publishableKey;
  if (!cloudClient || cloudClientKey !== key) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    cloudClient = createClient(cfg.url, cfg.publishableKey, {
      auth: { storageKey: 'smart-home-control-supabase' }
    });
    cloudClientKey = key;
  }
  const existing = await cloudClient.auth.getSession();
  if (existing.error) throw existing.error;
  const auth = existing.data.session ? existing : await cloudClient.auth.signInAnonymously();
  if (auth.error) throw auth.error;
  const owner = auth.data.session?.user?.id;
  if (!owner) throw Error('Supabase authentication did not return a user');
  return { client: cloudClient, owner };
}

export async function syncToCloud() {
  const { client, owner } = await ensureCloudClient();
  const savedAt = new Date().toISOString();
  const snapshots = roomStates.map((state, roomIndex) => ({
    owner_id: owner,
    room_index: roomIndex,
    room_state: { ...state },
    records: [...history[roomIndex]].slice(-120),
    updated_at: savedAt
  }));
  const table = client.from('iot_room_snapshots');
  const saved = await table.upsert(snapshots, { onConflict: 'owner_id,room_index' });
  if (saved.error) throw saved.error;

  const checked = await table.select('room_index,updated_at').eq('owner_id', owner).order('room_index');
  if (checked.error) throw checked.error;
  const time = new Intl.DateTimeFormat('kk-KZ', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Qyzylorda'
  }).format(new Date(savedAt));
  return { count: checked.data.length, time };
}

export async function loadFromCloud(onStatus) {
  const { client, owner } = await ensureCloudClient();
  const { data, error } = await client
    .from('iot_room_snapshots')
    .select('room_index,room_state,records,updated_at')
    .eq('owner_id', owner)
    .order('room_index');
  if (error) throw error;
  if (!data || !data.length) return { count: 0 };

  data.forEach(row => {
    const idx = row.room_index;
    if (!roomStates[idx]) return;
    Object.assign(roomStates[idx], row.room_state);
    if (idx === entryRoom && roomStates[idx].lock) roomStates[idx].door = false;
    history[idx] = Array.isArray(row.records) ? row.records : [];
    saveRoom(idx, onStatus);
  });
  const latest = data.reduce((acc, r) => (r.updated_at > acc ? r.updated_at : acc), data[0].updated_at);
  const time = new Intl.DateTimeFormat('kk-KZ', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Qyzylorda'
  }).format(new Date(latest));
  return { count: data.length, time };
}
