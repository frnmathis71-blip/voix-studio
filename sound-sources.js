// Recherche des sons déjà présents dans d'autres soundboards installées sur le PC.
// Seuls les fichiers audio lisibles sont proposés : les ressources chiffrées sont ignorées.
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const AUDIO = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i;
const MAX_FILES = 1000;
const MAX_SIZE = 20 * 1024 * 1024;

// Chemins que l'interface a le droit de lire : uniquement ceux que l'on a trouvés ou que l'utilisateur a choisis
const allowed = new Set();

function audioFilesIn(dir, recursive) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive) walk(p); continue; }
      if (!AUDIO.test(e.name)) continue;
      const st = fs.statSync(p);
      if (st.size > 0 && st.size <= MAX_SIZE) out.push({ path: p, size: st.size, mtime: st.mtimeMs });
    }
  };
  walk(dir);
  return out;
}

// Reconnaît un fichier audio ordinaire à sa signature (Ogg, WAV, FLAC, MP3, MP4/M4A, WebM)
function isPlainAudio(p) {
  const fd = fs.openSync(p, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  const s = b.toString('latin1');
  return s.startsWith('OggS') || s.startsWith('RIFF') || s.startsWith('fLaC') || s.startsWith('ID3')
    || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || s.slice(4, 8) === 'ftyp' || b.readUInt32BE(0) === 0x1a45dfa3;
}

const SOURCES = [
  {
    // Voicemod garde les sons de tes soundboards dans son cache, sous des noms codés.
    // Les titres sont stockés en ligne : on numérote les sons par ordre d'ajout.
    // Les sons de la bibliothèque Voicemod sont chiffrés : seuls les vrais fichiers audio sont repris.
    name: 'Voicemod',
    find() {
      const dir = path.join(process.env.LOCALAPPDATA || '', 'VoicemodV3', 'cache');
      const all = audioFilesIn(dir, false).sort((a, b) => a.mtime - b.mtime);
      const readable = all.filter((f) => isPlainAudio(f.path));
      this.protectedCount = all.length - readable.length;
      return readable.map((f, i) => ({ ...f, name: 'Voicemod ' + (i + 1) }));
    },
  },
  {
    // Soundpad : liste XML avec le titre et le chemin de chaque son
    name: 'Soundpad',
    find() {
      const file = path.join(process.env.APPDATA || '', 'Leppsoft', 'soundlist.spl');
      let xml;
      try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
      const out = [];
      const re = /<Sound\b[^>]*>/g;
      let m;
      while ((m = re.exec(xml)) && out.length < MAX_FILES) {
        const attr = (k) => { const a = m[0].match(new RegExp(k + '="([^"]*)"')); return a ? a[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''; };
        const p = attr('url');
        if (!p || !AUDIO.test(p)) continue;
        try {
          const st = fs.statSync(p);
          if (st.size > MAX_SIZE) continue;
          out.push({ path: p, size: st.size, name: attr('title') || path.basename(p).replace(AUDIO, '') });
        } catch (e) { /* fichier déplacé ou supprimé */ }
      }
      return out;
    },
  },
];

function scan() {
  const files = [];
  const protectedBy = {};
  for (const src of SOURCES) {
    let found = [];
    src.protectedCount = 0;
    try { found = src.find(); } catch (e) { found = []; }
    if (src.protectedCount) protectedBy[src.name] = src.protectedCount;
    found.forEach((f) => {
      allowed.add(f.path);
      files.push({ source: src.name, name: f.name.slice(0, 40), path: f.path, size: f.size });
    });
  }
  return { files, protectedBy };
}

async function pickFolder(win) {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir un dossier de sons',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return [];
  const dir = r.filePaths[0];
  return audioFilesIn(dir, true).map((f) => {
    allowed.add(f.path);
    return { source: path.basename(dir), name: path.basename(f.path).replace(AUDIO, '').slice(0, 40), path: f.path, size: f.size };
  });
}

function read(p) {
  if (!allowed.has(p)) throw new Error('Fichier non autorisé.');
  return fs.readFileSync(p);
}

module.exports = { scan, pickFolder, read };
