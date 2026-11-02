// Sauvegarde locale : réglages dans localStorage, sons importés dans IndexedDB.
window.VS = window.VS || {};

VS.store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('voixstudio.' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('voixstudio.' + key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
  },
};

VS.soundDb = (function () {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('voixstudio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('sounds', mode);
      const req = fn(t.objectStore('sounds'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }
  return {
    all: () => tx('readonly', (s) => s.getAll()).catch(() => []),
    put: (rec) => tx('readwrite', (s) => s.put(rec)).catch(() => null),
    del: (id) => tx('readwrite', (s) => s.delete(id)).catch(() => null),
  };
})();
