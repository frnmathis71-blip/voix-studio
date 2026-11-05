// Moteur audio : micro → traitement du micro → transformation de voix → sorties.
window.VS = window.VS || {};

VS.dbToGain = (db) => Math.pow(10, db / 20);
VS.gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

VS.EQ_BANDS = [
  { type: 'lowshelf', f: 80, label: '80 Hz' },
  { type: 'peaking', f: 250, label: '250 Hz' },
  { type: 'peaking', f: 1000, label: '1 kHz' },
  { type: 'peaking', f: 4000, label: '4 kHz' },
  { type: 'highshelf', f: 10000, label: '10 kHz' },
];

VS.COMP = {
  off: { thr: 0, ratio: 1, knee: 0, att: 0.01, rel: 0.2, makeup: 0 },
  leger: { thr: -20, ratio: 2, knee: 10, att: 0.01, rel: 0.2, makeup: 3 },
  moyen: { thr: -26, ratio: 3.5, knee: 8, att: 0.005, rel: 0.15, makeup: 6 },
  fort: { thr: -32, ratio: 6, knee: 6, att: 0.003, rel: 0.1, makeup: 9 },
};

// Cibles du niveau automatique selon la position face au micro.
VS.AUTO = {
  proche: { target: -20, hpf: 100, gate: -48 },
  loin: { target: -18, hpf: 75, gate: -56 },
};

class Engine {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.N = {};
    this.gateOpen = false;
    this.agcDb = 0;
    this.listeners = {};
    this.curveKey = '';
    this.irCache = {};
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  emit(evt, data) { (this.listeners[evt] || []).forEach((fn) => fn(data)); }

  async start(mic, voiceParams) {
    if (this.running) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([VS.WORKLET_SRC], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.build();
    this.mic = mic;
    await this.openMic();
    this.applyMic(mic);
    this.applyVoice(voiceParams);
    await this.setOutputs(mic);
    this.running = true;
    this.emit('state', true);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.closeMonitorBridge();
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    await this.ctx.close();
    this.ctx = null;
    this.N = {};
    this.emit('state', false);
  }

  build() {
    const c = this.ctx;
    const N = this.N;
    const mono = { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
    const biquad = (type, f, q = 0.707, gain = 0) => {
      const b = c.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain;
      return b;
    };
    const gain = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };

    // --- Traitement du micro (équivalent des réglages d'un micro USB de podcast)
    N.inGain = gain();
    N.preAn = c.createAnalyser(); N.preAn.fftSize = 2048; N.preAn.smoothingTimeConstant = 0.6;
    N.hpf = biquad('highpass', 10);
    N.eq = VS.EQ_BANDS.map((b) => biquad(b.type, b.f, 1));
    N.presence = biquad('peaking', 5500, 0.9);
    N.toneLo = biquad('lowshelf', 220);
    N.toneHi = biquad('highshelf', 6000);
    N.gate = new AudioWorkletNode(c, 'vs-gate', { outputChannelCount: [1], ...mono });
    N.gate.port.onmessage = (e) => { this.gateOpen = e.data.open; };
    N.comp = c.createDynamicsCompressor();
    N.makeup = gain();
    N.agc = gain();

    N.inGain.connect(N.preAn);
    let node = N.inGain;
    [N.hpf, ...N.eq, N.presence, N.toneLo, N.toneHi, N.gate, N.comp, N.makeup, N.agc].forEach((n) => { node.connect(n); node = n; });
    N.micAn = c.createAnalyser(); N.micAn.fftSize = 2048;
    N.agc.connect(N.micAn);

    // --- Transformation de voix
    N.pitch = new AudioWorkletNode(c, 'vs-pitch', { outputChannelCount: [1], ...mono });
    N.agc.connect(N.pitch);

    N.ringDry = gain(1);
    N.ringMod = gain(0);
    N.ringWet = gain(0);
    N.ringOsc = c.createOscillator(); N.ringOsc.frequency.value = 50; N.ringOsc.start();
    N.ringOsc.connect(N.ringMod.gain);
    N.ringSum = gain();
    N.pitch.connect(N.ringDry).connect(N.ringSum);
    N.pitch.connect(N.ringMod).connect(N.ringWet).connect(N.ringSum);

    N.shaper = c.createWaveShaper(); N.shaper.oversample = '2x';
    N.fxHp = biquad('highpass', 20);
    N.fxLp = biquad('lowpass', 20000);
    N.wobOsc = c.createOscillator(); N.wobOsc.frequency.value = 1; N.wobOsc.start();
    N.wobGain = gain(0);
    N.wobOsc.connect(N.wobGain).connect(N.fxLp.frequency);
    N.ringSum.connect(N.shaper).connect(N.fxHp).connect(N.fxLp);

    N.chDry = gain(1);
    N.chDelay = c.createDelay(0.1); N.chDelay.delayTime.value = 0.012;
    N.chFb = gain(0);
    N.chWet = gain(0);
    N.chLfo = c.createOscillator(); N.chLfo.frequency.value = 0.6; N.chLfo.start();
    N.chDepth = gain(0);
    N.chLfo.connect(N.chDepth).connect(N.chDelay.delayTime);
    N.chSum = gain();
    N.fxLp.connect(N.chDry).connect(N.chSum);
    N.fxLp.connect(N.chDelay);
    N.chDelay.connect(N.chFb).connect(N.chDelay);
    N.chDelay.connect(N.chWet).connect(N.chSum);

    N.trem = gain(1);
    N.tremOsc = c.createOscillator(); N.tremOsc.frequency.value = 5; N.tremOsc.start();
    N.tremDepth = gain(0);
    N.tremOsc.connect(N.tremDepth).connect(N.trem.gain);
    N.voiceGain = gain();
    N.chSum.connect(N.trem).connect(N.voiceGain);

    N.fxOut = gain();
    N.fxDry = gain(1);
    N.voiceGain.connect(N.fxDry).connect(N.fxOut);
    N.dl = c.createDelay(2);
    N.dlFb = gain(0);
    N.dlWet = gain(0);
    N.voiceGain.connect(N.dl);
    N.dl.connect(N.dlFb).connect(N.dl);
    N.dl.connect(N.dlWet).connect(N.fxOut);
    N.conv = c.createConvolver();
    N.revWet = gain(0);
    N.voiceGain.connect(N.conv).connect(N.revWet).connect(N.fxOut);

    // --- Sortie : limiteur, coupure, volume
    N.limiter = c.createDynamicsCompressor();
    N.limiter.knee.value = 0; N.limiter.attack.value = 0.001; N.limiter.release.value = 0.06;
    N.mute = gain(1);
    N.master = gain(1);
    N.fxOut.connect(N.limiter).connect(N.mute).connect(N.master);

    N.postAn = c.createAnalyser(); N.postAn.fftSize = 2048;
    N.master.connect(N.postAn);
    // Copie pour l'enregistrement
    N.virtDest = c.createMediaStreamDestination();
    N.master.connect(N.virtDest);
    // Sortie virtuelle : la destination du contexte, réglée sur le câble virtuel.
    // C'est le chemin le plus court, sans tampon de lecture entre le moteur et le câble.
    N.toVirt = gain(0);
    N.master.connect(N.toVirt).connect(c.destination);

    // Effets sonores : vers la sortie virtuelle et le retour casque
    N.sb = gain(0.8);
    N.sbAn = c.createAnalyser(); N.sbAn.fftSize = 512;
    N.sb.connect(N.virtDest);
    N.sb.connect(N.toVirt);
    N.sb.connect(N.sbAn);

    // Retour casque : direct quand il n'y a pas de sortie virtuelle,
    // sinon par un second contexte branché sur le casque
    N.monMic = gain(1);
    N.monSb = gain(1);
    N.monSum = gain(0);
    N.master.connect(N.monMic).connect(N.monSum);
    N.sb.connect(N.monSb).connect(N.monSum);
    N.monDirect = gain(1);
    N.monSum.connect(N.monDirect).connect(c.destination);
    N.monDest = c.createMediaStreamDestination();
    N.monSum.connect(N.monDest);
  }

  async openMonitorBridge(sinkId) {
    if (!this.monCtx) {
      this.monCtx = new AudioContext({ latencyHint: 'interactive' });
      this.monCtx.createMediaStreamSource(this.N.monDest.stream).connect(this.monCtx.destination);
    }
    // Ne change la sortie que si elle diffère : redemander la même sortie peut échouer pour rien
    if (this.monCtx.setSinkId && this.monCtx.sinkId !== (sinkId || '')) {
      try { await this.monCtx.setSinkId(sinkId || ''); } catch (e) { this.emit('warn', 'Impossible de choisir la sortie du retour casque.'); }
    }
    await this.monCtx.resume();
  }

  closeMonitorBridge() {
    if (!this.monCtx) return;
    this.monCtx.close();
    this.monCtx = null;
  }

  async openMic() {
    const m = this.mic;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.src) this.src.disconnect();
    const audio = {
      echoCancellation: m.echoCancel,
      noiseSuppression: m.browserNS,
      autoGainControl: false,
      channelCount: 1,
    };
    if (m.inputId) audio.deviceId = { exact: m.inputId };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
        delete audio.deviceId;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      } else {
        throw err;
      }
    }
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.src.connect(this.N.inGain);
    const track = this.stream.getAudioTracks()[0];
    this.emit('device', track ? track.label : '');
  }

  async setOutputs(m) {
    if (!this.ctx) return;
    const N = this.N;
    if (m.virtualOutId) {
      // Le moteur joue directement dans le câble virtuel ; le casque passe par le second contexte
      try {
        await this.ctx.setSinkId(m.virtualOutId);
        this.ramp(N.toVirt.gain, 1, 0.01);
        this.ramp(N.monDirect.gain, 0, 0.01);
        await this.openMonitorBridge(m.monitorOutId);
        return;
      } catch (e) {
        this.emit('warn', 'Sortie virtuelle introuvable. Vérifiez qu’elle est toujours branchée.');
      }
    }
    // Pas de sortie virtuelle : le moteur joue seulement le retour casque
    this.ramp(N.toVirt.gain, 0, 0.01);
    this.ramp(N.monDirect.gain, 1, 0.01);
    this.closeMonitorBridge();
    if (this.ctx.sinkId === (m.monitorOutId || '')) return;
    try { await this.ctx.setSinkId(m.monitorOutId || ''); } catch (e) { this.emit('warn', 'Impossible de choisir la sortie du retour casque.'); }
  }

  ramp(param, value, k = 0.03) {
    if (!this.ctx) return;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setTargetAtTime(value, this.ctx.currentTime, k);
  }

  applyMic(m) {
    this.mic = m;
    if (!this.ctx) return;
    const N = this.N;
    const auto = m.autoLevel ? VS.AUTO[m.position] : null;

    this.ramp(N.inGain.gain, VS.dbToGain(auto ? 0 : m.gain));

    const hpf = auto ? auto.hpf : (m.hpf === 'off' ? 10 : Number(m.hpf));
    this.ramp(N.hpf.frequency, hpf);

    N.eq.forEach((b, i) => this.ramp(b.gain, m.eqOn ? m.eq[i] : 0));

    const pres = { off: 0, leger: 3, fort: 6 }[auto ? 'leger' : m.presence];
    this.ramp(N.presence.gain, pres);

    const tone = { sombre: [2, -4], naturel: [0, 0], brillant: [-2, 4] }[m.tone];
    this.ramp(N.toneLo.gain, tone[0]);
    this.ramp(N.toneHi.gain, tone[1]);

    N.gate.parameters.get('on').value = m.gate.on ? 1 : 0;
    N.gate.parameters.get('threshold').value = auto ? Math.min(m.gate.threshold, auto.gate) : m.gate.threshold;

    const cp = VS.COMP[auto ? 'moyen' : m.comp];
    const comp = N.comp;
    comp.threshold.value = cp.thr; comp.ratio.value = cp.ratio; comp.knee.value = cp.knee;
    comp.attack.value = cp.att; comp.release.value = cp.rel;
    this.ramp(N.makeup.gain, VS.dbToGain(cp.makeup));
    if (!auto) { this.agcDb = 0; this.ramp(N.agc.gain, 1); }

    if (m.limiter) { N.limiter.threshold.value = -3; N.limiter.ratio.value = 20; }
    else { N.limiter.threshold.value = 0; N.limiter.ratio.value = 1; }

    this.ramp(N.master.gain, VS.dbToGain(m.outDb));
    this.applyMonitor(m);
    this.applyMute(m.mute);
  }

  applyMonitor(m) {
    if (!this.ctx) return;
    const N = this.N;
    this.ramp(N.monSum.gain, m.monitorOn ? m.monitorVol : 0, 0.02);
    // Mélange du retour : 0 = uniquement le micro, 1 = uniquement les effets sonores
    const mix = m.monitorMix;
    this.ramp(N.monMic.gain, Math.min(1, 2 * (1 - mix)));
    this.ramp(N.monSb.gain, Math.min(1, 2 * mix));
  }

  applyMute(muted) {
    if (!this.ctx) return;
    this.ramp(this.N.mute.gain, muted ? 0 : 1, 0.01);
  }

  setSoundVolume(v) { if (this.ctx) this.ramp(this.N.sb.gain, v); }

  makeCurve(drive, bits) {
    const key = drive + '/' + bits;
    if (key === this.curveKey) return undefined;
    this.curveKey = key;
    if (!drive && !bits) return null;
    const n = 4096;
    const curve = new Float32Array(n);
    const k = drive * 60;
    const steps = bits ? Math.pow(2, bits) / 2 : 0;
    for (let i = 0; i < n; i++) {
      let x = (i * 2) / (n - 1) - 1;
      if (k) x = ((1 + k) * x) / (1 + k * Math.abs(x));
      if (steps) x = Math.round(x * steps) / steps;
      curve[i] = x;
    }
    return curve;
  }

  impulse(decay) {
    const key = decay.toFixed(1);
    if (this.irCache[key]) return this.irCache[key];
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * decay));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
    }
    this.irCache[key] = buf;
    return buf;
  }

  applyVoice(params) {
    if (!this.ctx) return;
    const P = Object.assign({}, VS.VOICE_BASE, params || {});
    const N = this.N;

    const voices = [{ ratio: Math.pow(2, P.pitch / 12), gain: P.harm.length ? P.mainGain : 1 }];
    P.harm.forEach(([semi, g]) => voices.push({ ratio: Math.pow(2, semi / 12), gain: g }));
    N.pitch.port.postMessage({ voices });

    this.ramp(N.ringDry.gain, 1 - P.ring);
    this.ramp(N.ringWet.gain, P.ring);
    this.ramp(N.ringOsc.frequency, P.ringFreq);

    const curve = this.makeCurve(P.drive, P.bits);
    if (curve !== undefined) N.shaper.curve = curve;

    this.ramp(N.fxHp.frequency, P.hp);
    this.ramp(N.fxLp.frequency, P.lp);
    this.ramp(N.fxLp.Q, P.q);
    this.ramp(N.fxHp.Q, P.q);
    this.ramp(N.wobGain.gain, Math.min(P.wobble, P.lp * 0.9));
    this.ramp(N.wobOsc.frequency, P.wobbleRate);

    this.ramp(N.chDry.gain, P.chorusDry);
    this.ramp(N.chWet.gain, P.chorus);
    this.ramp(N.chDelay.delayTime, P.chorusTime);
    this.ramp(N.chDepth.gain, P.chorusDepth);
    this.ramp(N.chLfo.frequency, P.chorusRate);
    this.ramp(N.chFb.gain, P.chorusFb);

    N.tremOsc.type = P.tremShape;
    this.ramp(N.trem.gain, 1 - P.trem / 2);
    this.ramp(N.tremDepth.gain, P.trem / 2);
    this.ramp(N.tremOsc.frequency, P.tremRate);

    this.ramp(N.voiceGain.gain, VS.dbToGain(P.gainDb));

    this.ramp(N.dl.delayTime, P.delayTime, 0.01);
    this.ramp(N.dlFb.gain, P.delayFb);
    this.ramp(N.dlWet.gain, P.delay);
    this.ramp(N.fxDry.gain, 1 - P.reverb * 0.35);
    if (P.reverb > 0) N.conv.buffer = this.impulse(P.decay);
    this.ramp(N.revWet.gain, P.reverb * 0.9);
  }

  // Lecture des niveaux, appelée à chaque image
  readMeter(an) {
    if (!an) return { peak: -Infinity, rms: -Infinity };
    const buf = this._buf || (this._buf = new Float32Array(2048));
    const data = buf.subarray(0, an.fftSize);
    an.getFloatTimeDomainData(data);
    let peak = 0, sum = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
      sum += data[i] * data[i];
    }
    return { peak: VS.gainToDb(peak), rms: VS.gainToDb(Math.sqrt(sum / data.length)) };
  }

  // Niveau automatique : remonte ou baisse doucement le gain pendant que l'on parle
  tickAgc(micRms) {
    const m = this.mic;
    if (!this.ctx || !m.autoLevel || !this.gateOpen || micRms < -55) return;
    const target = VS.AUTO[m.position].target;
    const err = target - micRms;
    const step = Math.max(-0.4, Math.min(0.15, err * 0.02));
    this.agcDb = Math.max(-12, Math.min(24, this.agcDb + step));
    this.ramp(this.N.agc.gain, VS.dbToGain(this.agcDb), 0.1);
  }

  // Enregistrement de ce que les autres entendent (micro transformé + effets sonores)
  startRecording() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    this.recChunks = [];
    this.recorder = new MediaRecorder(this.N.virtDest.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.recChunks.push(e.data); };
    return new Promise((resolve) => {
      this.recorder.onstop = () => resolve(new Blob(this.recChunks, { type: this.recorder.mimeType || 'audio/webm' }));
      this.recorder.start(250);
    });
  }

  stopRecording() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
}

VS.Engine = Engine;
