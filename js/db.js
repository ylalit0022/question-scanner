/**
 * db.js — IndexedDB wrapper (client-side only, no backend)
 *
 * Stores:
 *  • projects   — metadata per project
 *  • questions  — question items with cropped image Blobs
 *  • settings   — PDF settings per project
 */

const DB_NAME    = 'DocScannerDB';
const DB_VERSION = 1;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      // ── projects store ──────────────────────────────────
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // ── questions store ─────────────────────────────────
      if (!db.objectStoreNames.contains('questions')) {
        const qs = db.createObjectStore('questions', { keyPath: 'id' });
        qs.createIndex('projectId', 'projectId', { unique: false });
        qs.createIndex('order',     'order',     { unique: false });
      }

      // ── settings store ──────────────────────────────────
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'projectId' });
      }
    };

    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Generic helpers ──────────────────────────────────────────

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function promReq(req) {
  return new Promise((res, rej) => {
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ── Projects ─────────────────────────────────────────────────

export async function saveProject(project) {
  await openDB();
  project.updatedAt = Date.now();
  return promReq(tx('projects', 'readwrite').put(project));
}

export async function getProject(id) {
  await openDB();
  return promReq(tx('projects').get(id));
}

export async function getAllProjects() {
  await openDB();
  return promReq(tx('projects').getAll());
}

export async function deleteProject(id) {
  await openDB();
  // delete all questions first
  const questions = await getQuestionsForProject(id);
  const qtx = _db.transaction('questions', 'readwrite').objectStore('questions');
  for (const q of questions) qtx.delete(q.id);
  // delete settings
  const stx = _db.transaction('settings', 'readwrite').objectStore('settings');
  stx.delete(id);
  // delete project
  return promReq(tx('projects', 'readwrite').delete(id));
}

// ── Questions ────────────────────────────────────────────────

export async function saveQuestion(question) {
  await openDB();
  if (!question.id) question.id = crypto.randomUUID();
  if (question.order === undefined) question.order = Date.now();
  return promReq(tx('questions', 'readwrite').put(question));
}

export async function getQuestion(id) {
  await openDB();
  return promReq(tx('questions').get(id));
}

export async function getQuestionsForProject(projectId) {
  await openDB();
  const all = await promReq(
    tx('questions').index('projectId').getAll(projectId)
  );
  return all.sort((a, b) => a.order - b.order);
}

export async function deleteQuestion(id) {
  await openDB();
  return promReq(tx('questions', 'readwrite').delete(id));
}

export async function reorderQuestions(projectId, orderedIds) {
  await openDB();
  const qtx = _db.transaction('questions', 'readwrite').objectStore('questions');
  return new Promise((resolve, reject) => {
    let done = 0;
    const total = orderedIds.length;
    if (total === 0) { resolve(); return; }

    orderedIds.forEach((id, idx) => {
      const req = qtx.get(id);
      req.onsuccess = e => {
        const q = e.target.result;
        if (q) {
          q.order = idx;
          qtx.put(q);
        }
        done++;
        if (done === total) resolve();
      };
      req.onerror = e => reject(e.target.error);
    });
  });
}

// ── PDF Settings ─────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  pageSize:      'A4',
  orientation:   'portrait',
  fontSize:      12,
  includeImages: true,
  imageSize:     'medium',
  lineSpacing:   'normal',
  headerText:    '',
  footerText:    '',
  showNumbers:   true,
  showAnswerLines: true,
  answerLines:   3,
  marginMm:      15,
};

export async function getSettings(projectId) {
  await openDB();
  const s = await promReq(tx('settings').get(projectId));
  return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS, projectId };
}

export async function saveSettings(settings) {
  await openDB();
  return promReq(tx('settings', 'readwrite').put(settings));
}

// ── Blob ↔ URL helpers ───────────────────────────────────────

export function blobToURL(blob) {
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export function canvasToBlob(canvas, quality = 0.88) {
  return new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );
}
