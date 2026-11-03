// Interface : état, rendu des onglets, raccourcis et boucle des vumètres.
(function () {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const store = VS.store;
  const engine = new VS.Engine();

  const DEFAULT_MIC = {
    inputId: '',
    virtualOutId: null, // null : pas encore choisi, on cherche un câble virtuel
    monitorOutId: '',
    gain: 0,
    autoLevel: true,
    position: 'proche',
    tone: 'naturel',
    hpf: '75',
    presence: 'leger',
    comp: 'leger',
    limiter: true,
    gate: { on: true, threshold: -55 },
    eq: [0, 0, 0, 0, 0],
    eqOn: true,
    browserNS: false,
    echoCancel: false,
    monitorOn: false,
    monitorVol: 0.8,
    monitorMix: 0.4,
    outDb: 0,
    mute: false,
    pttMode: false,
  };

  const DEFAULT_VOICE_KEYS = {
    normal: 'Digit1', helium: 'Digit2', grave: 'Digit3', demon: 'Digit4', robot: 'Digit5',
    telephone: 'Digit6', cathedrale: 'Digit7', chorale: 'Digit8', eau: 'Digit9',
  };
  const DEFAULT_HOTKEYS = { mute: 'KeyM', voice: 'KeyT', monitor: 'KeyH', stopSounds: 'KeyX', ptt: 'KeyV' };

  const savedMic = store.get('mic', {});
  const state = {
    mic: Object.assign({}, DEFAULT_MIC, savedMic, { gate: Object.assign({}, DEFAULT_MIC.gate, savedMic.gate) }),
    voiceId: store.get('voiceId', 'normal'),
    voiceOn: store.get('voiceOn', true),
    customVoices: store.get('customVoices', []),
    voiceKeys: store.get('voiceKeys', DEFAULT_VOICE_KEYS),
    soundKeys: store.get('soundKeys', {}),
    hotkeys: Object.assign({}, DEFAULT_HOTKEYS, store.get('hotkeys', {})),
    sbVol: store.get('sbVol', 0.7),
    micPresets: store.get('micPresets', []),
    lab: Object.assign({}, VS.VOICE_BASE, { harm0: 7, harm0g: 0 }, store.get('lab', {})),
    tab: 'voix',
    cat: 'all',
    query: '',
    pttHeld: false,
    userSounds: [],
    playing: {},
    padCat: 'all',
    winDefault: store.get('winDefault', true),
    autoStart: store.get('autoStart', true),
  };

  // Micros virtuels (le nôtre ou celui d'un autre logiciel) : jamais une source pour Voix Studio
  const VIRTUAL_MIC = /voicemod|virtual|cable output|vb-audio|voicemeeter|steam streaming/i;

  // ---------- Utilitaires
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function notice(msg, isErr) {
    const el = $('#notice');
    el.hidden = !msg;
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }

  function keyLabel(code) {
    if (!code) return '—';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
    const names = { Space: 'Espace', Backquote: '²', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Entrée', Tab: 'Tab', ShiftLeft: 'Maj g.', ShiftRight: 'Maj d.', ControlLeft: 'Ctrl g.', ControlRight: 'Ctrl d.', AltLeft: 'Alt', AltRight: 'Alt Gr', CapsLock: 'Verr. maj' };
    return names[code] || code;
  }

  function saveMic() { store.set('mic', state.mic); }

  function allVoices() {
    return VS.VOICES.concat(state.customVoices.map((v) => Object.assign({ cat: 'mine' }, v)));
  }
  function findVoice(id) { return allVoices().find((v) => v.id === id) || VS.VOICES[0]; }

  // ---------- Raccourcis clavier
  let capturing = null;

  function clearKey(code) {
    Object.keys(state.voiceKeys).forEach((k) => { if (state.voiceKeys[k] === code) delete state.voiceKeys[k]; });
    Object.keys(state.soundKeys).forEach((k) => { if (state.soundKeys[k] === code) delete state.soundKeys[k]; });
    Object.keys(state.hotkeys).forEach((k) => { if (state.hotkeys[k] === code) state.hotkeys[k] = ''; });
  }

  function saveKeys() {
    store.set('voiceKeys', state.voiceKeys);
    store.set('soundKeys', state.soundKeys);
    store.set('hotkeys', state.hotkeys);
  }

  function captureKey(btn, assign) {
    if (capturing) capturing.btn.classList.remove('listening');
    btn.classList.add('listening');
    btn.textContent = 'Touche ?';
    capturing = {
      btn,
      done(code) {
        btn.classList.remove('listening');
        capturing = null;
        if (code === 'Escape') { renderAllKeys(); return; }
        const value = code === 'Backspace' || code === 'Delete' ? '' : code;
        if (value) clearKey(value);
        assign(value);
        saveKeys();
        renderAllKeys();
        toast(value ? 'Raccourci : ' + keyLabel(value) : 'Raccourci retiré');
      },
    };
  }

  function renderAllKeys() {
    renderVoices();
    renderPads();
    $$('[data-hk]').forEach((b) => { b.textContent = keyLabel(state.hotkeys[b.dataset.hk]); });
  }

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && /text|search|number/.test(t.type)));
  }

  document.addEventListener('keydown', (e) => {
    if (capturing) {
      e.preventDefault();
      capturing.done(e.code);
      return;
    }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    const hk = state.hotkeys;
    if (state.mic.pttMode && code === hk.ptt) {
      e.preventDefault();
      if (!state.pttHeld) { state.pttHeld = true; updateMute(); }
      return;
    }
    if (e.repeat) return;
    if (code === hk.mute) { setMute(!state.mic.mute); return; }
    if (code === hk.voice) { setVoiceOn(!state.voiceOn); return; }
    if (code === hk.monitor) { setMonitor(!state.mic.monitorOn); return; }
    if (code === hk.stopSounds) { stopAllSounds(); return; }
    const vId = Object.keys(state.voiceKeys).find((k) => state.voiceKeys[k] === code);
    if (vId) { e.preventDefault(); selectVoice(vId); toast(findVoice(vId).name); return; }
    const sId = Object.keys(state.soundKeys).find((k) => state.soundKeys[k] === code);
    if (sId) { e.preventDefault(); playPad(sId); }
  });

  document.addEventListener('keyup', (e) => {
    if (state.mic.pttMode && e.code === state.hotkeys.ptt && state.pttHeld) {
      state.pttHeld = false;
      updateMute();
    }
  });
  window.addEventListener('blur', () => { if (state.pttHeld) { state.pttHeld = false; updateMute(); } });

  // ---------- Onglets
  function showTab(tab) {
    const wasLab = state.tab === 'labo';
    state.tab = tab;
    $$('.nav').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + tab));
    if (tab === 'labo' || wasLab) applyVoice();
    if (tab === 'micro') requestAnimationFrame(sizeEqCanvas);
    $('main').scrollTop = 0;
  }
  $$('.nav').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- Barre du haut
  function setMute(v) {
    state.mic.mute = v;
    saveMic();
    updateMute();
  }

  function updateMute() {
    const m = state.mic;
    const muted = m.mute || (m.pttMode && !state.pttHeld);
    engine.applyMute(muted);
    const btn = $('#btnMute');
    btn.setAttribute('aria-pressed', String(muted));
    let label = muted ? 'Micro coupé' : 'Micro ouvert';
    if (m.pttMode && !m.mute) label = state.pttHeld ? 'Vous parlez' : 'Maintenez ' + keyLabel(state.hotkeys.ptt);
    $('#muteLabel').textContent = label;
  }
  $('#btnMute').addEventListener('click', () => setMute(!state.mic.mute));

  function setVoiceOn(v) {
    state.voiceOn = v;
    store.set('voiceOn', v);
    $('#tglVoice').checked = v;
    applyVoice();
  }
  $('#tglVoice').addEventListener('change', (e) => setVoiceOn(e.target.checked));

  function setMonitor(v) {
    state.mic.monitorOn = v;
    saveMic();
    $('#tglMonitor').checked = v;
    engine.applyMonitor(state.mic);
  }
  $('#tglMonitor').addEventListener('change', (e) => setMonitor(e.target.checked));

  const power = $('#power');
  power.addEventListener('click', async () => {
    if (engine.running) {
      stopAllSounds();
      if (recording) stopRec();
      await engine.stop();
      state.userSounds.forEach((s) => { s.buffer = null; });
      return;
    }
    power.disabled = true;
    $('#powerLabel').textContent = 'Ouverture du micro…';
    try {
      await engine.start(state.mic, voiceParams());
      engine.setSoundVolume(state.sbVol);
      updateMute();
      await refreshDevices();
      await engine.setOutputs(effectiveOutputs());
      notice(vmicNotice());
    } catch (err) {
      console.error(err);
      if (engine.ctx) await engine.stop().catch(() => {});
      if (err.name === 'NotAllowedError') notice('Le navigateur bloque le micro. Cliquez sur l’icône de cadenas ou de micro dans la barre d’adresse, autorisez le micro, puis réessayez.', true);
      else if (err.name === 'NotFoundError') notice('Aucun micro détecté. Branchez-en un, puis cliquez sur « Activer le micro ».', true);
      else notice('Le micro n’a pas pu démarrer : ' + err.message, true);
    } finally {
      power.disabled = false;
      renderPower();
    }
  });

  function renderPower() {
    power.setAttribute('aria-pressed', String(engine.running));
    $('#powerLabel').textContent = engine.running ? 'Micro actif' : 'Activer le micro';
  }
  engine.on('state', renderPower);
  engine.on('warn', (msg) => toast(msg));
  engine.on('device', (label) => { if (label) toast('Micro : ' + label); });

  // ---------- Voix
  function labParams() {
    const L = state.lab;
    const p = {};
    Object.keys(VS.VOICE_BASE).forEach((k) => { if (k !== 'harm') p[k] = L[k]; });
    p.harm = L.harm0g > 0 ? [[L.harm0, L.harm0g]] : [];
    return p;
  }

  function voiceParams() {
    if (!state.voiceOn) return {};
    if (state.tab === 'labo') return labParams();
    return findVoice(state.voiceId).p;
  }

  function applyVoice() {
    engine.applyVoice(voiceParams());
    let name = state.voiceOn ? findVoice(state.voiceId).name : 'Transformation désactivée';
    if (state.voiceOn && state.tab === 'labo') name = 'Labo (aperçu)';
    $('#rackVoice').textContent = name;
  }

  function selectVoice(id) {
    state.voiceId = id;
    store.set('voiceId', id);
    if (!state.voiceOn) setVoiceOn(true);
    else applyVoice();
    $$('.voice').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
  }

  // Petite forme d'onde dessinée à partir des réglages de la voix
  function waveSvg(v) {
    const P = Object.assign({}, VS.VOICE_BASE, v.p);
    const f = 2.2 * Math.pow(2, P.pitch / 12);
    const steps = P.bits ? Math.pow(2, P.bits) / 2 : 0;
    let d = '';
    for (let i = 0; i <= 80; i++) {
      const x = i / 80;
      let y = Math.sin(x * Math.PI * 2 * f) * 0.8;
      P.harm.forEach(([s, g]) => { y += Math.sin(x * Math.PI * 2 * f * Math.pow(2, s / 12)) * g * 0.5; });
      if (P.ring) y *= 1 - P.ring + P.ring * Math.cos(x * Math.PI * 2 * (P.ringFreq / 40));
      if (P.trem) y *= 1 - P.trem / 2 + (P.trem / 2) * Math.sin(x * Math.PI * 2 * 3);
      if (P.drive) y = Math.tanh(y * (1 + P.drive * 4)) / Math.tanh(1 + P.drive * 4);
      if (steps) y = Math.round(y * steps) / steps;
      const env = Math.sin(x * Math.PI);
      y = Math.max(-1, Math.min(1, y * env));
      d += (i ? 'L' : 'M') + (x * 200).toFixed(1) + ' ' + (17 - y * 14).toFixed(1);
    }
    return '<svg class="voice-wave" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="hsl(' + v.hue + ' 75% 66%)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }

  function renderCats() {
    const wrap = $('#voiceCats');
    wrap.innerHTML = '';
    VS.CATEGORIES.forEach((c) => {
      if (c.id === 'mine' && !state.customVoices.length) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.cat === c.id ? ' on' : '');
      b.textContent = c.name;
      b.addEventListener('click', () => { state.cat = c.id; renderCats(); renderVoices(); });
      wrap.appendChild(b);
    });
  }

  function renderVoices() {
    const grid = $('#voiceGrid');
    const q = state.query.trim().toLowerCase();
    const catName = Object.fromEntries(VS.CATEGORIES.map((c) => [c.id, c.name]));
    grid.innerHTML = '';
    allVoices()
      .filter((v) => state.cat === 'all' || v.cat === state.cat)
      .filter((v) => !q || (v.name + ' ' + v.desc).toLowerCase().includes(q))
      .forEach((v) => {
        const card = document.createElement('div');
        card.className = 'voice' + (v.id === state.voiceId ? ' on' : '');
        card.dataset.id = v.id;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.innerHTML = waveSvg(v) +
          '<div class="voice-name"></div><div class="voice-desc"></div>' +
          '<div class="voice-foot"><span class="voice-tag"></span><span class="row gap"></span></div>';
        card.querySelector('.voice-name').textContent = v.name;
        card.querySelector('.voice-desc').textContent = v.desc;
        card.querySelector('.voice-tag').textContent = catName[v.cat];
        const actions = card.querySelector('.voice-foot .row');
        if (v.cat === 'mine') {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'mini-btn';
          del.textContent = 'Supprimer';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            state.customVoices = state.customVoices.filter((c) => c.id !== v.id);
            store.set('customVoices', state.customVoices);
            delete state.voiceKeys[v.id];
            saveKeys();
            if (state.voiceId === v.id) selectVoice('normal');
            if (!state.customVoices.length && state.cat === 'mine') state.cat = 'all';
            renderCats(); renderVoices(); renderLabBase();
            toast('« ' + v.name + ' » supprimée');
          });
          actions.appendChild(del);
        }
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'keycap';
        key.title = 'Choisir un raccourci (Retour arrière pour l’enlever)';
        key.textContent = keyLabel(state.voiceKeys[v.id]);
        key.addEventListener('click', (e) => {
          e.stopPropagation();
          captureKey(key, (code) => { if (code) state.voiceKeys[v.id] = code; else delete state.voiceKeys[v.id]; });
        });
        actions.appendChild(key);
        card.addEventListener('click', () => selectVoice(v.id));
        card.addEventListener('keydown', (e) => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectVoice(v.id); } });
        grid.appendChild(card);
      });
    if (!grid.children.length) grid.innerHTML = '<p class="hint">Aucune voix ne correspond à cette recherche.</p>';
  }

  $('#voiceSearch').addEventListener('input', (e) => { state.query = e.target.value; renderVoices(); });

  // ---------- Labo de voix
  const LAB = [
    { title: 'Hauteur', ctl: [
      ['pitch', 'Hauteur de la voix', -12, 12, 1, 'st'],
      ['harm0', 'Harmonie ajoutée', -12, 19, 1, 'st'],
      ['harm0g', 'Volume de l’harmonie', 0, 1, 0.01, '%'],
    ] },
    { title: 'Machine', ctl: [
      ['ring', 'Effet robot', 0, 1, 0.01, '%'],
      ['ringFreq', 'Fréquence du robot', 10, 1000, 0, 'log'],
      ['drive', 'Saturation', 0, 1, 0.01, '%'],
      ['bits', 'Numérique (bits)', 0, 12, 1, 'bits'],
    ] },
    { title: 'Filtres', ctl: [
      ['hp', 'Coupe les graves sous', 20, 2000, 0, 'log'],
      ['lp', 'Coupe les aigus au-dessus', 300, 20000, 0, 'log'],
      ['q', 'Résonance', 0.5, 8, 0.1, ''],
      ['wobble', 'Ondulation du filtre', 0, 3000, 10, 'Hz'],
      ['wobbleRate', 'Vitesse d’ondulation', 0.1, 10, 0.1, 'Hz'],
    ] },
    { title: 'Modulation', ctl: [
      ['chorus', 'Chorus / flanger', 0, 1, 0.01, '%'],
      ['chorusRate', 'Vitesse du chorus', 0.1, 8, 0.1, 'Hz'],
      ['chorusFb', 'Effet métallique', 0, 0.9, 0.01, '%'],
      ['trem', 'Trémolo', 0, 1, 0.01, '%'],
      ['tremRate', 'Vitesse du trémolo', 1, 20, 0.5, 'Hz'],
    ] },
    { title: 'Espace', ctl: [
      ['delay', 'Écho', 0, 1, 0.01, '%'],
      ['delayTime', 'Temps de l’écho', 0.05, 1, 0.01, 's'],
      ['delayFb', 'Répétitions', 0, 0.85, 0.01, '%'],
      ['reverb', 'Réverbération', 0, 1, 0.01, '%'],
      ['decay', 'Taille de la salle', 0.3, 8, 0.1, 's'],
    ] },
  ];

  function fmtLab(unit, v) {
    if (unit === '%') return Math.round(v * 100) + ' %';
    if (unit === 'st') return (v > 0 ? '+' : '') + v + ' st';
    if (unit === 'log' || unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz';
    if (unit === 'bits') return v ? v + ' bits' : 'Désactivé';
    if (unit === 's') return v.toFixed(2) + ' s';
    return String(v);
  }

  function renderLab() {
    const wrap = $('#labGroups');
    wrap.innerHTML = '';
    LAB.forEach((g) => {
      const box = document.createElement('div');
      box.className = 'lab-group';
      box.innerHTML = '<h3></h3>';
      box.querySelector('h3').textContent = g.title;
      g.ctl.forEach(([key, label, min, max, step, unit]) => {
        const row = document.createElement('div');
        row.className = 'lab-ctl';
        const id = 'lab-' + key;
        row.innerHTML = '<label for="' + id + '"></label><output></output><input type="range" id="' + id + '">';
        row.querySelector('label').textContent = label;
        const input = row.querySelector('input');
        const out = row.querySelector('output');
        const isLog = unit === 'log';
        if (isLog) { input.min = 0; input.max = 1000; input.step = 1; }
        else { input.min = min; input.max = max; input.step = step; }
        const toSlider = (v) => (isLog ? Math.round((Math.log(v / min) / Math.log(max / min)) * 1000) : v);
        const fromSlider = (s) => (isLog ? min * Math.pow(max / min, s / 1000) : Number(s));
        input.value = toSlider(state.lab[key]);
        out.textContent = fmtLab(unit, state.lab[key]);
        input.addEventListener('input', () => {
          state.lab[key] = fromSlider(input.value);
          out.textContent = fmtLab(unit, state.lab[key]);
          store.set('lab', state.lab);
          applyVoice();
        });
        box.appendChild(row);
      });
      wrap.appendChild(box);
    });
  }

  function renderLabBase() {
    const sel = $('#labBase');
    sel.innerHTML = '<option value="">Partir d’une voix…</option>';
    allVoices().forEach((v) => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name;
      sel.appendChild(o);
    });
  }

  function loadIntoLab(p) {
    const P = Object.assign({}, VS.VOICE_BASE, p);
    state.lab = Object.assign({}, P, { harm0: P.harm[0] ? P.harm[0][0] : 7, harm0g: P.harm[0] ? P.harm[0][1] : 0 });
    store.set('lab', state.lab);
    renderLab();
    applyVoice();
  }

  $('#labBase').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const v = findVoice(e.target.value);
    loadIntoLab(v.p);
    toast('Labo chargé depuis « ' + v.name + ' »');
    e.target.value = '';
  });
  $('#labReset').addEventListener('click', () => loadIntoLab({}));
  $('#labSave').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#labName').value.trim();
    if (!name) return;
    const v = {
      id: 'c' + Date.now().toString(36),
      name,
      cat: 'mine',
      hue: Math.floor(Math.random() * 360),
      desc: 'Voix créée dans le labo.',
      p: labParams(),
    };
    state.customVoices.push(v);
    store.set('customVoices', state.customVoices);
    $('#labName').value = '';
    state.voiceId = v.id;
    store.set('voiceId', v.id);
    renderCats(); renderVoices(); renderLabBase();
    toast('« ' + name + ' » est dans Mes voix');
  });

  // ---------- Effets sonores
  function allPads() {
    return VS.BUILTIN_SOUNDS.concat(state.userSounds);
  }

  async function playPad(id) {
    if (!engine.running) { toast('Activez le micro pour jouer les sons'); return; }
    if (state.playing[id]) { state.playing[id].stop(); finishPad(id); return; }
    const s = allPads().find((p) => p.id === id);
    if (!s) return;
    if (s.data && !s.buffer) {
      try { s.buffer = await engine.ctx.decodeAudioData(s.data.slice(0)); }
      catch (e) { toast('Ce fichier audio ne peut pas être lu'); return; }
    }
    const h = VS.playSound(engine.ctx, engine.N.sb, s, 1);
    state.playing[id] = h;
    const pad = $('.pad[data-id="' + id + '"]');
    if (pad) {
      pad.classList.add('playing');
      const bar = pad.querySelector('.pad-progress');
      bar.style.transition = 'none';
      bar.style.width = '0';
      void bar.offsetWidth;
      bar.style.transition = 'width ' + h.duration + 's linear';
      bar.style.width = '100%';
    }
    h.timer = setTimeout(() => finishPad(id), h.duration * 1000 + 100);
  }

  function finishPad(id) {
    const h = state.playing[id];
    if (h) clearTimeout(h.timer);
    delete state.playing[id];
    const pad = $('.pad[data-id="' + id + '"]');
    if (pad) {
      pad.classList.remove('playing');
      const bar = pad.querySelector('.pad-progress');
      bar.style.transition = 'none';
      bar.style.width = '0';
    }
  }

  function stopAllSounds() {
    Object.keys(state.playing).forEach((id) => { state.playing[id].stop(); finishPad(id); });
  }

  const padSource = (s) => (s.data ? s.source || 'Importés' : 'Synthèse');

  function renderPadCats() {
    const wrap = $('#padCats');
    const sources = Array.from(new Set(allPads().map(padSource)));
    wrap.innerHTML = '';
    if (sources.length < 2) { state.padCat = 'all'; return; }
    if (state.padCat !== 'all' && !sources.includes(state.padCat)) state.padCat = 'all';
    ['all', ...sources].forEach((src) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.padCat === src ? ' on' : '');
      const n = src === 'all' ? allPads().length : allPads().filter((s) => padSource(s) === src).length;
      b.textContent = (src === 'all' ? 'Tous' : src) + ' · ' + n;
      b.addEventListener('click', () => { state.padCat = src; renderPads(); });
      wrap.appendChild(b);
    });
  }

  function startRename(pad, s) {
    const nameEl = pad.querySelector('.pad-name');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pad-rename';
    input.maxLength = 40;
    input.value = s.name;
    input.setAttribute('aria-label', 'Nom du son');
    nameEl.replaceWith(input);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== s.name) {
        s.name = name;
        await VS.soundDb.put(s);
      }
      renderPads();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function renderPads() {
    renderPadCats();
    const grid = $('#padGrid');
    grid.innerHTML = '';
    allPads().filter((s) => !state.padCat || state.padCat === 'all' || padSource(s) === state.padCat).forEach((s) => {
      const pad = document.createElement('div');
      pad.className = 'pad';
      pad.dataset.id = s.id;
      pad.tabIndex = 0;
      pad.setAttribute('role', 'button');
      pad.style.setProperty('--h', s.hue);
      pad.innerHTML = '<div class="pad-name"></div><div class="pad-foot"><span class="voice-tag"></span><span class="row gap"></span></div><div class="pad-progress"></div>';
      pad.querySelector('.pad-name').textContent = s.name;
      pad.querySelector('.voice-tag').textContent = padSource(s);
      const actions = pad.querySelector('.pad-foot .row');
      if (s.data) {
        const ren = document.createElement('button');
        ren.type = 'button';
        ren.className = 'mini-btn';
        ren.textContent = 'Renommer';
        ren.addEventListener('click', (e) => { e.stopPropagation(); startRename(pad, s); });
        actions.appendChild(ren);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mini-btn';
        del.textContent = 'Retirer';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          await VS.soundDb.del(s.id);
          state.userSounds = state.userSounds.filter((u) => u.id !== s.id);
          delete state.soundKeys[s.id];
          saveKeys();
          renderPads();
        });
        actions.appendChild(del);
      }
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'keycap';
      key.title = 'Choisir un raccourci (Retour arrière pour l’enlever)';
      key.textContent = keyLabel(state.soundKeys[s.id]);
      key.addEventListener('click', (e) => {
        e.stopPropagation();
        captureKey(key, (code) => { if (code) state.soundKeys[s.id] = code; else delete state.soundKeys[s.id]; });
      });
      actions.appendChild(key);
      pad.addEventListener('click', () => playPad(s.id));
      pad.addEventListener('keydown', (e) => { if (e.target === pad && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); playPad(s.id); } });
      if (state.playing[s.id]) pad.classList.add('playing');
      grid.appendChild(pad);
    });
  }

  $('#sbImport').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) { toast('« ' + f.name + ' » dépasse 20 Mo'); continue; }
      const rec = {
        id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: f.name.replace(/\.[^.]+$/, '').slice(0, 28),
        hue: Math.floor(Math.random() * 360),
        data: await f.arrayBuffer(),
      };
      await VS.soundDb.put(rec);
      state.userSounds.push(rec);
    }
    e.target.value = '';
    renderPads();
    if (files.length) toast(files.length > 1 ? files.length + ' sons importés' : 'Son importé');
  });

  const sbVol = $('#sbVol');
  sbVol.value = state.sbVol;
  $('#sbVolOut').textContent = Math.round(state.sbVol * 100) + ' %';
  sbVol.addEventListener('input', () => {
    state.sbVol = Number(sbVol.value);
    store.set('sbVol', state.sbVol);
    $('#sbVolOut').textContent = Math.round(state.sbVol * 100) + ' %';
    engine.setSoundVolume(state.sbVol);
  });
  $('#sbStop').addEventListener('click', stopAllSounds);

  // ---------- Réglages micro
  const RESTART_KEYS = ['inputId', 'browserNS', 'echoCancel'];
  const OUTPUT_KEYS = ['virtualOutId', 'monitorOutId'];

  function effectiveOutputs() {
    return Object.assign({}, state.mic, { virtualOutId: state.mic.virtualOutId || '' });
  }

  async function onMicChange(key) {
    // Sur le bureau, « par défaut » pourrait désigner notre propre micro virtuel : on choisit le vrai micro
    if (key === 'inputId' && !state.mic.inputId && window.desktop) await resolveRealMic(true);
    saveMic();
    renderMic();
    if (!engine.running) return;
    if (RESTART_KEYS.includes(key)) {
      try { await engine.openMic(); } catch (e) { toast('Ce micro ne répond pas'); }
    } else if (OUTPUT_KEYS.includes(key)) {
      await engine.setOutputs(effectiveOutputs());
    } else {
      engine.applyMic(state.mic);
      updateMute();
    }
  }

  function fmtMic(key, v) {
    if (key === 'monitorVol') return Math.round(v * 100) + ' %';
    return (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' dB';
  }

  function renderMic() {
    const m = state.mic;
    document.body.classList.toggle('auto', m.autoLevel);
    $$('.seg[data-key]').forEach((seg) => {
      const val = String(m[seg.dataset.key]);
      $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === val));
    });
    $$('input[data-key]').forEach((inp) => {
      const k = inp.dataset.key;
      if (inp.type === 'checkbox') inp.checked = !!m[k];
      else if (document.activeElement !== inp) inp.value = m[k];
      const out = $('output[data-for="' + k + '"]');
      if (out) out.textContent = fmtMic(k, m[k]);
    });
    $('#gateOn').checked = m.gate.on;
    $('#gateThr').value = m.gate.threshold;
    $('#gateThrOut').textContent = m.gate.threshold + ' dB';
    $('#gmThr').style.left = ((m.gate.threshold + 80) / 60) * 100 + '%';
    $('#tglMonitor').checked = m.monitorOn;
    $$('#eqBands input').forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = m.eq[i];
      inp.nextElementSibling.textContent = (m.eq[i] > 0 ? '+' : '') + m.eq[i] + ' dB';
    });
    drawEq();
  }

  $$('.seg[data-key]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = seg.dataset.key;
      let v = b.dataset.v;
      if (v === 'true' || v === 'false') v = v === 'true';
      state.mic[k] = v;
      onMicChange(k);
    });
  });

  $$('input[data-key]').forEach((inp) => {
    const k = inp.dataset.key;
    inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
      state.mic[k] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
      if (k === 'pttMode') state.pttHeld = false;
      onMicChange(k);
    });
  });

  $$('select[data-key]').forEach((sel) => {
    sel.addEventListener('change', () => { state.mic[sel.dataset.key] = sel.value; onMicChange(sel.dataset.key); });
  });

  $('#gateOn').addEventListener('change', (e) => { state.mic.gate.on = e.target.checked; onMicChange('gate'); });
  $('#gateThr').addEventListener('input', (e) => { state.mic.gate.threshold = Number(e.target.value); onMicChange('gate'); });

  // Égaliseur
  const EQ_PRESETS = [
    ['Plat', [0, 0, 0, 0, 0]],
    ['Podcast', [-2, -1, 0, 2, 1]],
    ['Voix chaude', [3, 1, -1, 0, -2]],
    ['Clarté', [-3, -1, 1, 3, 2]],
    ['Moins de basses', [-6, -2, 0, 0, 0]],
    ['Streaming', [1, 0, -1, 2, 3]],
  ];

  function renderEqControls() {
    const wrap = $('#eqBands');
    wrap.innerHTML = '';
    VS.EQ_BANDS.forEach((b, i) => {
      const col = document.createElement('div');
      col.className = 'eq-band';
      col.innerHTML = '<span></span><input type="range" min="-12" max="12" step="0.5" id="eq' + i + '"><output></output>';
      col.querySelector('span').textContent = b.label;
      const inp = col.querySelector('input');
      inp.setAttribute('aria-label', 'Égaliseur ' + b.label);
      inp.addEventListener('input', () => { state.mic.eq[i] = Number(inp.value); onMicChange('eq'); });
      wrap.appendChild(col);
    });
    const pre = $('#eqPresets');
    EQ_PRESETS.forEach(([name, vals]) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.textContent = name;
      c.addEventListener('click', () => { state.mic.eq = vals.slice(); state.mic.eqOn = true; onMicChange('eq'); });
      pre.appendChild(c);
    });
  }

  // Calcul de la courbe sans dépendre du micro : un contexte hors ligne suffit
  const eqCalc = (function () {
    const ctx = new OfflineAudioContext(1, 128, 48000);
    const filters = VS.EQ_BANDS.map((b) => {
      const f = ctx.createBiquadFilter();
      f.type = b.type; f.frequency.value = b.f; f.Q.value = 1;
      return f;
    });
    const N = 200;
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
    const mag = new Float32Array(N);
    const ph = new Float32Array(N);
    return {
      freqs,
      curve(gains) {
        const total = new Float32Array(N).fill(1);
        filters.forEach((f, i) => {
          f.gain.value = gains[i];
          f.getFrequencyResponse(freqs, mag, ph);
          for (let k = 0; k < N; k++) total[k] *= mag[k];
        });
        return total;
      },
    };
  })();

  const eqCanvas = $('#eqCanvas');
  const eqCtx = eqCanvas.getContext('2d');
  let eqW = 0, eqH = 0;
  const DB_RANGE = 15;
  const fx = (f) => (Math.log(f / 20) / Math.log(1000)) * eqW;
  const dy = (db) => eqH / 2 - (db / DB_RANGE) * (eqH / 2 - 10);

  function sizeEqCanvas() {
    const r = eqCanvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    eqW = r.width; eqH = r.height;
    eqCanvas.width = Math.round(r.width * dpr);
    eqCanvas.height = Math.round(r.height * dpr);
    eqCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEq();
  }
  window.addEventListener('resize', sizeEqCanvas);

  const css = getComputedStyle(document.documentElement);
  const COL = {
    line: css.getPropertyValue('--line').trim(),
    muted: css.getPropertyValue('--muted').trim(),
    amber: css.getPropertyValue('--amber').trim(),
    violet: css.getPropertyValue('--violet').trim(),
    fg: css.getPropertyValue('--fg').trim(),
  };
  let specData = null;

  function drawEq() {
    if (!eqW) return;
    const c = eqCtx;
    c.clearRect(0, 0, eqW, eqH);
    c.font = '10px "JetBrains Mono", monospace';
    c.lineWidth = 1;
    // Grille
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
      const x = Math.round(fx(f)) + 0.5;
      c.strokeStyle = COL.line;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, eqH); c.stroke();
      c.fillStyle = COL.muted;
      c.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, eqH - 4);
    });
    [-12, -6, 0, 6, 12].forEach((db) => {
      const y = Math.round(dy(db)) + 0.5;
      c.strokeStyle = COL.line;
      c.beginPath(); c.moveTo(0, y); c.lineTo(eqW, y); c.stroke();
      c.fillStyle = COL.muted;
      c.fillText((db > 0 ? '+' : '') + db, 4, y - 3);
    });
    // Spectre de la voix après traitement
    if (specData && engine.running) {
      const rate = engine.ctx.sampleRate;
      const bins = specData.length;
      c.beginPath();
      c.moveTo(0, eqH);
      for (let x = 0; x <= eqW; x += 2) {
        const f = 20 * Math.pow(1000, x / eqW);
        const idx = Math.min(bins - 1, Math.round((f / (rate / 2)) * bins));
        const v = (specData[idx] + 100) / 80;
        c.lineTo(x, eqH - Math.max(0, Math.min(1, v)) * eqH);
      }
      c.lineTo(eqW, eqH);
      c.closePath();
      c.fillStyle = 'rgba(154, 140, 255, 0.18)';
      c.fill();
    }
    // Courbe de l'égaliseur
    const gains = state.mic.eqOn ? state.mic.eq : [0, 0, 0, 0, 0];
    const curve = eqCalc.curve(gains);
    c.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const x = fx(eqCalc.freqs[i]);
      const y = dy(20 * Math.log10(curve[i]));
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.strokeStyle = state.mic.eqOn ? COL.amber : COL.muted;
    c.lineWidth = 2.5;
    c.stroke();
    // Poignées
    VS.EQ_BANDS.forEach((b, i) => {
      c.beginPath();
      c.arc(fx(b.f), dy(gains[i]), dragBand === i ? 8 : 6, 0, Math.PI * 2);
      c.fillStyle = COL.fg;
      c.fill();
      c.strokeStyle = COL.amber;
      c.lineWidth = 2;
      c.stroke();
    });
  }

  let dragBand = -1;
  function bandAt(e) {
    const r = eqCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = -1, bestD = 30;
    VS.EQ_BANDS.forEach((b, i) => { const d = Math.abs(fx(b.f) - x); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  function dragTo(e) {
    const r = eqCanvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    let db = ((eqH / 2 - y) / (eqH / 2 - 10)) * DB_RANGE;
    db = Math.max(-12, Math.min(12, Math.round(db * 2) / 2));
    state.mic.eq[dragBand] = db;
    state.mic.eqOn = true;
    onMicChange('eq');
  }
  eqCanvas.addEventListener('pointerdown', (e) => {
    dragBand = bandAt(e);
    if (dragBand < 0) return;
    eqCanvas.setPointerCapture(e.pointerId);
    dragTo(e);
  });
  eqCanvas.addEventListener('pointermove', (e) => { if (dragBand >= 0) dragTo(e); });
  eqCanvas.addEventListener('pointerup', () => { dragBand = -1; drawEq(); });
  eqCanvas.addEventListener('dblclick', (e) => {
    const i = bandAt(e);
    if (i >= 0) { state.mic.eq[i] = 0; onMicChange('eq'); }
  });

  // Préréglages micro
  const PROCESS_KEYS = ['gain', 'autoLevel', 'position', 'tone', 'hpf', 'presence', 'comp', 'limiter', 'gate', 'eq', 'eqOn', 'outDb'];
  const BUILTIN_PRESETS = [
    { name: 'Podcast', v: { autoLevel: false, gain: 6, comp: 'moyen', hpf: '75', presence: 'leger', tone: 'naturel', limiter: true, eq: [-2, -1, 0, 2, 1], eqOn: true, gate: { on: true, threshold: -50 } } },
    { name: 'Streaming', v: { autoLevel: true, position: 'proche', tone: 'brillant', eq: [1, 0, -1, 2, 3], eqOn: true, gate: { on: true, threshold: -52 } } },
    { name: 'Jeu vidéo', v: { autoLevel: true, position: 'loin', tone: 'naturel', eq: [-3, -1, 1, 3, 2], eqOn: true, gate: { on: true, threshold: -45 } } },
    { name: 'Chant', v: { autoLevel: false, gain: 0, comp: 'leger', hpf: 'off', presence: 'off', tone: 'naturel', limiter: true, eq: [0, 0, 0, 0, 0], eqOn: false, gate: { on: false, threshold: -60 } } },
  ];

  function renderPresets() {
    const sel = $('#micPreset');
    sel.innerHTML = '<option value="">Préréglages…</option>';
    const add = (label, value) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
    BUILTIN_PRESETS.forEach((p, i) => add(p.name, 'b' + i));
    state.micPresets.forEach((p, i) => add('Mon réglage : ' + p.name, 'u' + i));
  }

  $('#micPreset').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const p = v[0] === 'b' ? BUILTIN_PRESETS[+v.slice(1)] : state.micPresets[+v.slice(1)];
    const vals = JSON.parse(JSON.stringify(p.v));
    Object.assign(state.mic, vals);
    onMicChange('preset');
    toast('Préréglage « ' + p.name + ' » appliqué');
    e.target.value = '';
  });

  $('#micPresetSave').addEventListener('click', () => {
    $('#presetForm').hidden = false;
    $('#presetName').focus();
  });
  $('#presetCancel').addEventListener('click', () => { $('#presetForm').hidden = true; });
  $('#presetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#presetName').value.trim();
    if (!name) return;
    $('#presetName').value = '';
    $('#presetForm').hidden = true;
    const v = {};
    PROCESS_KEYS.forEach((k) => { v[k] = JSON.parse(JSON.stringify(state.mic[k])); });
    state.micPresets.push({ name, v });
    store.set('micPresets', state.micPresets);
    renderPresets();
    toast('Réglage « ' + name + ' » enregistré');
  });

  // ---------- Appareils
  async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devs = await navigator.mediaDevices.enumerateDevices();
    const ins = devs.filter((d) => d.kind === 'audioinput');
    const outs = devs.filter((d) => d.kind === 'audiooutput');
    const m = state.mic;

    if (m.virtualOutId === null && outs.some((d) => d.label)) {
      // Par ordre de préférence ; « virtual » seul attraperait aussi les sorties d'autres logiciels (MOTIV Mix…)
      const cable = [/^cable input/i, /vb-audio virtual cable/i, /voicemeeter input/i]
        .map((re) => outs.find((d) => re.test(d.label)))
        .find(Boolean);
      m.virtualOutId = cable ? cable.deviceId : '';
      saveMic();
      if (cable) toast('Câble virtuel détecté : ' + cable.label);
    }

    const fill = (sel, list, first, value) => {
      sel.innerHTML = '';
      const o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = first;
      sel.appendChild(o0);
      list.forEach((d, i) => {
        if (d.deviceId === 'default' || d.deviceId === 'communications') return;
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Appareil ' + (i + 1);
        sel.appendChild(o);
      });
      sel.value = list.some((d) => d.deviceId === value) ? value : '';
    };
    // Le câble virtuel ne peut pas servir d'entrée : la voix tournerait en boucle
    const realIns = ins.filter((d) => !/cable output|vb-audio virtual/i.test(d.label));
    fill($('#inputSel'), realIns, window.desktop ? 'Choisir mon micro automatiquement' : 'Micro par défaut de Windows', m.inputId);
    fill($('#virtSel'), outs, 'Désactivée', m.virtualOutId || '');
    fill($('#monSel'), outs, 'Sortie par défaut (casque)', m.monitorOutId);
    if (!outs.length || !('setSinkId' in HTMLMediaElement.prototype)) {
      $('#virtSel').disabled = true;
      $('#virtSel').title = 'Ce navigateur ne permet pas de choisir la sortie. Utilisez Chrome ou Edge.';
    }
  }
  $('#refreshDevices').addEventListener('click', async () => { await refreshDevices(); toast('Appareils actualisés'); });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices());
  }

  $$('[data-hk]').forEach((b) => b.addEventListener('click', () => captureKey(b, (code) => { state.hotkeys[b.dataset.hk] = code; })));

  // ---------- Enregistrement
  let recording = false;
  let recStart = 0;
  let recCount = 0;

  async function startRec() {
    if (!engine.running) { toast('Activez le micro pour enregistrer'); return; }
    recording = true;
    recStart = performance.now();
    $('#recBtn').setAttribute('aria-pressed', 'true');
    $('#recLabel').textContent = 'Arrêter';
    const blob = await engine.startRecording();
    addRecording(blob);
  }

  function stopRec() {
    recording = false;
    engine.stopRecording();
    $('#recBtn').setAttribute('aria-pressed', 'false');
    $('#recLabel').textContent = 'Enregistrer';
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function addRecording(blob) {
    recCount++;
    const list = $('#recList');
    const empty = $('.rec-empty', list);
    if (empty) empty.remove();
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const li = document.createElement('li');
    li.className = 'rec-item';
    li.innerHTML = '<span class="rec-name"></span><audio controls></audio><a class="btn" download>Télécharger</a>';
    li.querySelector('.rec-name').textContent = 'Prise ' + recCount + ' · ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + findVoice(state.voiceId).name;
    li.querySelector('audio').src = url;
    const a = li.querySelector('a');
    a.href = url;
    a.download = 'voix-studio-' + stamp + (blob.type.includes('ogg') ? '.ogg' : '.webm');
    list.prepend(li);
  }

  $('#recBtn').addEventListener('click', () => (recording ? stopRec() : startRec()));
  $('#recList').innerHTML = '<li class="rec-empty">Vos prises apparaîtront ici pendant cette session.</li>';

  // ---------- Boucle des vumètres
  const pct = (db, floor = -60) => Math.max(0, Math.min(1, (db - floor) / -floor));
  let inShown = -90, inPeak = -90, inPeakT = 0, hotUntil = 0, quietSince = 0;

  function setMeter(el, db) {
    el.style.width = pct(db) * 100 + '%';
    el.classList.toggle('hot', db > -10 && db <= -3);
    el.classList.toggle('clip', db > -3);
  }

  function loop(now) {
    if (engine.running) {
      const N = engine.N;
      const pre = engine.readMeter(N.preAn);
      const mic = engine.readMeter(N.micAn);
      const post = engine.readMeter(N.postAn);
      engine.tickAgc(mic.rms);

      inShown = pre.peak > inShown ? pre.peak : inShown - 0.8;
      if (pre.peak > inPeak || now - inPeakT > 1500) { inPeak = pre.peak; inPeakT = now; }
      setMeter($('#mIn'), pre.peak);
      setMeter($('#mOut'), post.peak);

      if (state.tab === 'micro') {
        const f = pct(inShown);
        const fill = $('#bmFill');
        fill.style.width = f * 100 + '%';
        fill.style.setProperty('--w', Math.max(0.001, f));
        $('#bmPeak').style.left = 'calc(' + pct(inPeak) * 100 + '% - 1px)';
        $('#gmFill').style.width = Math.max(0, Math.min(1, (pre.rms + 80) / 60)) * 100 + '%';
        $('#gateLed').classList.toggle('on', engine.gateOpen);
        $('#gateState').textContent = state.mic.gate.on ? (engine.gateOpen ? 'Ouverte : vous parlez' : 'Fermée : silence') : 'Désactivée';

        if (pre.peak > -1) hotUntil = now + 2500;
        if (engine.gateOpen && pre.rms < -42) { if (!quietSince) quietSince = now; } else quietSince = 0;
        let hint = 'Parlez normalement : la barre doit rester dans la zone claire, entre -24 et -10 dB.';
        if (now < hotUntil) hint = state.mic.autoLevel ? 'Ça sature : éloignez-vous un peu du micro.' : 'Ça sature : baissez le gain du micro ou éloignez-vous.';
        else if (quietSince && now - quietSince > 2000) hint = state.mic.autoLevel ? 'Votre voix est faible : rapprochez-vous ou passez en position « Loin ».' : 'Votre voix est faible : montez le gain du micro.';
        $('#levelHint').textContent = hint;

        if (!specData || specData.length !== N.micAn.frequencyBinCount) specData = new Float32Array(N.micAn.frequencyBinCount);
        N.micAn.getFloatFrequencyData(specData);
        drawEq();
      }

      $('#rackGate').classList.toggle('on', engine.gateOpen);
      $('#rackGr').textContent = N.comp.reduction.toFixed(1) + ' dB';
      $('#rackAgc').textContent = state.mic.autoLevel ? (engine.agcDb > 0 ? '+' : '') + engine.agcDb.toFixed(1) + ' dB' : '—';
      if (recording) $('#recTime').textContent = fmtTime(now - recStart);
    } else {
      $('#mIn').style.width = '0';
      $('#mOut').style.width = '0';
    }
    requestAnimationFrame(loop);
  }

  // ---------- Démarrage
  async function init() {
    $('#tglVoice').checked = state.voiceOn;
    renderCats();
    renderVoices();
    renderLab();
    renderLabBase();
    renderEqControls();
    renderPresets();
    renderMic();
    updateMute();
    applyVoice();
    $$('[data-hk]').forEach((b) => { b.textContent = keyLabel(state.hotkeys[b.dataset.hk]); });
    state.userSounds = await VS.soundDb.all();
    renderPads();
    refreshDevices().catch(() => {});
    notice('Le micro est éteint. Cliquez sur « Activer le micro » en haut pour commencer.');
    initUpdates();
    requestAnimationFrame(loop);
    initDesktop();
  }

  // ---------- Mises à jour (application de bureau uniquement)
  function renderUpdate(s) {
    const text = $('#updateText');
    const btn = $('#updateBtn');
    btn.hidden = s.state !== 'ready';
    if (s.state === 'ready') btn.textContent = 'Version ' + s.version + ' prête : redémarrer';
    const msgs = {
      dev: 'Mode développement : les mises à jour ne sont vérifiées que dans la version installée.',
      idle: 'Voix Studio cherche les mises à jour au démarrage puis toutes les 30 minutes.',
      checking: 'Recherche de mises à jour…',
      latest: 'Vous avez la dernière version.',
      downloading: 'Téléchargement de la version ' + (s.version || '') + '… ' + (s.percent || 0) + ' %',
      ready: 'La version ' + s.version + ' est prête. Elle s’installera à la fermeture, ou tout de suite avec le bouton en haut.',
      error: 'La recherche de mises à jour a échoué. Vérifiez votre connexion, Voix Studio réessaiera plus tard.',
    };
    text.textContent = msgs[s.state] || msgs.idle;
  }

  // ---------- Micro virtuel de Windows (application de bureau uniquement)
  let vmic = null;

  async function audioInputs() {
    const list = async () => (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    let ins = await list();
    if (!ins.some((d) => d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch (e) { /* sans autorisation, pas de noms */ }
      ins = await list();
    }
    return ins;
  }

  // Choisit le vrai micro de l'utilisateur si aucun n'est choisi, ou si le choix actuel est un micro virtuel
  async function resolveRealMic(force) {
    const ins = await audioInputs();
    const current = ins.find((d) => d.deviceId === state.mic.inputId);
    if (!force && current && !VIRTUAL_MIC.test(current.label)) return;
    const name = vmic ? vmic.realMicName : '';
    const pick = (name && ins.find((d) => d.label && (d.label === name || d.label.startsWith(name) || name.startsWith(d.label))))
      || ins.find((d) => d.label && !VIRTUAL_MIC.test(d.label));
    if (pick) {
      state.mic.inputId = pick.deviceId;
      saveMic();
    }
  }

  function vmicNotice() {
    return vmic && !vmic.installed
      ? 'Pour que Discord, OBS ou vos jeux entendent votre voix transformée, installez le micro virtuel dans Routage et raccourcis.'
      : '';
  }

  function renderVmic() {
    const led = $('#vmicLed');
    const text = $('#vmicText');
    $('#winDefault').checked = state.winDefault;
    $('#autoStart').checked = state.autoStart;
    $('#vmicInstall').hidden = !vmic || vmic.installed;
    $('#cableLatencyField').hidden = !vmic || !vmic.installed || !vmic.latency;
    if (vmic && vmic.latency) {
      const sel = $('#cableLatency');
      if (document.activeElement !== sel) sel.value = String(vmic.latency);
      const ms = Math.round((vmic.latency / vmic.sampleRate) * 1000);
      $('#cableLatencyHint').textContent = 'Réglage actuel : ' + vmic.latency + ' échantillons, soit ' + ms + ' ms. ' +
        (vmic.latency > 2048 ? 'Baissez-le pour réduire le décalage de votre voix. ' : '') +
        'Windows demande une autorisation, puis il faut redémarrer le PC.';
    }
    led.classList.toggle('on', !!(vmic && vmic.isDefault));
    if (!vmic) text.textContent = 'Impossible de lire les périphériques audio de Windows.';
    else if (!vmic.installed) text.textContent = 'Micro virtuel non installé : Discord et les jeux ne peuvent pas encore entendre Voix Studio.';
    else if (vmic.isDefault) text.textContent = '« ' + vmic.cableName + ' » est le micro par défaut de Windows : il diffuse votre voix transformée.';
    else text.textContent = 'Micro virtuel installé. Dans Discord, choisissez « ' + vmic.cableName + ' » comme micro, ou activez l’option ci-dessous.';
  }

  async function refreshVmic() {
    try { vmic = await window.desktop.vmic.status(); } catch (e) { vmic = null; }
    renderVmic();
  }

  // Le micro virtuel s'affiche « Voix Studio » dans Windows, Discord et les jeux
  async function renameCable() {
    if (!vmic || !vmic.installed || vmic.renamed) return;
    try {
      await window.desktop.vmic.rename();
      await refreshVmic();
      toast('Le micro virtuel s’appelle maintenant « Voix Studio »');
    } catch (e) { /* le nom d'origine reste utilisable */ }
  }

  $('#cableLatencyApply').addEventListener('click', async () => {
    const btn = $('#cableLatencyApply');
    btn.disabled = true;
    btn.textContent = 'Acceptez la demande de Windows…';
    try {
      await window.desktop.vmic.setLatency(Number($('#cableLatency').value));
      await refreshVmic();
      notice('Délai du micro virtuel enregistré. Redémarrez le PC pour l’appliquer.');
    } catch (e) {
      toast(e.message || 'Le délai n’a pas été changé');
    }
    btn.disabled = false;
    btn.textContent = 'Appliquer';
  });

  async function applyWinDefault() {
    if (!vmic || !vmic.installed) return;
    try {
      if (state.winDefault && !vmic.isDefault) await window.desktop.vmic.enable();
      if (!state.winDefault) await window.desktop.vmic.restore();
    } catch (e) {
      toast('Windows a refusé de changer le micro par défaut');
    }
    await refreshVmic();
  }

  async function initDesktop() {
    const d = window.desktop;
    if (!d) return;
    $('#vmicPanel').hidden = false;
    $('#sbScan').hidden = false;
    $('#sbFolder').hidden = false;
    await refreshVmic();
    await resolveRealMic(false);
    // Sans sortie vers le câble, le micro virtuel resterait muet : on le reconnecte
    if (vmic && vmic.installed && !state.mic.virtualOutId) { state.mic.virtualOutId = null; saveMic(); }
    await refreshDevices().catch(() => {});
    await renameCable();
    await applyWinDefault();
    if (vmicNotice()) notice(vmicNotice());
    if (state.autoStart && !engine.running) power.click();
  }

  $('#winDefault').addEventListener('change', (e) => {
    state.winDefault = e.target.checked;
    store.set('winDefault', state.winDefault);
    applyWinDefault();
  });
  $('#autoStart').addEventListener('change', (e) => {
    state.autoStart = e.target.checked;
    store.set('autoStart', state.autoStart);
  });
  $('#vmicInstall').addEventListener('click', async () => {
    const btn = $('#vmicInstall');
    btn.disabled = true;
    btn.textContent = 'Téléchargement et installation…';
    $('#vmicText').textContent = 'Acceptez la demande de Windows, puis cliquez sur « Install Driver » dans la fenêtre VB-CABLE.';
    try {
      vmic = await window.desktop.vmic.install();
    } catch (e) {
      toast(e.message || 'Installation impossible');
      await refreshVmic();
    }
    btn.disabled = false;
    btn.textContent = 'Installer le micro virtuel';
    renderVmic();
    if (vmic && vmic.installed) {
      state.mic.virtualOutId = null;
      saveMic();
      await refreshDevices();
      if (engine.running) await engine.setOutputs(effectiveOutputs());
      await renameCable();
      await applyWinDefault();
      notice('');
      toast('Micro virtuel installé. Si Discord ne le voit pas, redémarrez le PC.');
    }
  });

  // Import des sons d'autres soundboards
  const decodeCtx = new OfflineAudioContext(1, 1, 44100);

  async function importSounds(files) {
    const existing = new Set(state.userSounds.map((s) => s.origin).filter(Boolean));
    const todo = files.filter((f) => !existing.has(f.path));
    if (!files.length) { toast('Aucun son trouvé'); return; }
    if (!todo.length) { toast('Ces sons sont déjà dans Voix Studio'); return; }
    let added = 0;
    for (const f of todo) {
      try {
        const bytes = await window.desktop.sounds.read(f.path);
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        await decodeCtx.decodeAudioData(data.slice(0));
        const rec = {
          id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: f.name,
          hue: Math.floor(Math.random() * 360),
          data,
          origin: f.path,
          source: f.source,
        };
        await VS.soundDb.put(rec);
        state.userSounds.push(rec);
        added++;
        if (added % 5 === 0) toast('Import en cours : ' + added + ' / ' + todo.length);
      } catch (e) { /* fichier illisible : ignoré */ }
    }
    renderPads();
    const skipped = todo.length - added;
    toast(added + ' son' + (added > 1 ? 's' : '') + ' importé' + (added > 1 ? 's' : '') + (skipped ? ', ' + skipped + ' illisible' + (skipped > 1 ? 's' : '') : ''));
  }

  $('#sbScan').addEventListener('click', async () => {
    const { files, protectedBy } = await window.desktop.sounds.scan();
    await importSounds(files);
    const prot = Object.keys(protectedBy).map((k) => protectedBy[k] + ' sons de la bibliothèque ' + k + ' sont protégés et ne peuvent pas être repris');
    if (prot.length) notice(prot.join('. ') + '. Pour les retrouver, importez les fichiers d’origine avec « Importer un dossier ».');
  });
  $('#sbFolder').addEventListener('click', async () => {
    const files = await window.desktop.sounds.pickFolder();
    if (files.length) await importSounds(files);
  });

  async function initUpdates() {
    const d = window.desktop;
    if (!d) {
      $('#updateCheck').disabled = true;
      $('#updateText').textContent = 'Les mises à jour automatiques fonctionnent dans la version installée de Voix Studio.';
      return;
    }
    $('#appVersion').textContent = await d.version();
    renderUpdate(await d.updateStatus());
    d.onUpdate((s) => {
      renderUpdate(s);
      if (s.state === 'ready') toast('Nouvelle version ' + s.version + ' téléchargée');
    });
    $('#updateCheck').addEventListener('click', () => d.checkUpdates());
    $('#updateBtn').addEventListener('click', async () => {
      if (recording) stopRec();
      if (engine.running) await engine.stop();
      d.installUpdate();
    });
  }

  init();
})();
