// Processeurs AudioWorklet, chargés depuis une URL blob pour fonctionner sans serveur.
window.VS = window.VS || {};

VS.WORKLET_SRC = `
// Décaleur de hauteur à deux têtes de lecture croisées (fenêtre sin²).
// Chaque "voix" a son propre rapport de hauteur et son gain : la voix
// principale plus d'éventuelles harmonies.
class VsPitch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1 << 15;
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.win = Math.round(sampleRate * 0.05);
    this.voices = [{ ratio: 1, gain: 1, p: 0 }];
    this.port.onmessage = (e) => {
      const vs = e.data.voices || [];
      const prev = this.voices;
      this.voices = vs.map((v, i) => ({
        ratio: v.ratio,
        gain: v.gain,
        p: prev[i] ? prev[i].p : (i * 0.37) % 1,
      }));
    };
  }
  read(d) {
    const pos = this.w - d;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[i & this.mask];
    const b = this.buf[(i + 1) & this.mask];
    return a + (b - a) * f;
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const inp = inputs[0][0];
    const W = this.win;
    const vs = this.voices;
    for (let n = 0; n < out.length; n++) {
      const x = inp ? inp[n] : 0;
      this.buf[this.w] = x;
      let y = 0;
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k];
        if (v.ratio === 1) { y += x * v.gain; continue; }
        const p = v.p;
        const p2 = p + 0.5 >= 1 ? p - 0.5 : p + 0.5;
        const g1 = Math.sin(Math.PI * p);
        const g2 = Math.sin(Math.PI * p2);
        y += (this.read(p * W) * g1 * g1 + this.read(p2 * W) * g2 * g2) * v.gain;
        let np = p + (1 - v.ratio) / W;
        if (np >= 1) np -= 1; else if (np < 0) np += 1;
        v.p = np;
      }
      out[n] = y;
      this.w = (this.w + 1) & this.mask;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

// Porte de bruit avec hystérésis et maintien. Envoie son état ~20 fois/s.
class VsGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.g = 1;
    this.hold = 0;
    this.att = Math.exp(-1 / (sampleRate * 0.002));
    this.rel = Math.exp(-1 / (sampleRate * 0.08));
    this.kOpen = 1 - Math.exp(-1 / (sampleRate * 0.003));
    this.kClose = 1 - Math.exp(-1 / (sampleRate * 0.07));
    this.holdN = Math.round(sampleRate * 0.18);
    this.tick = 0;
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const inp = inputs[0][0];
    const on = params.on[0] > 0.5;
    const thr = Math.pow(10, params.threshold[0] / 20);
    for (let n = 0; n < out.length; n++) {
      const x = inp ? inp[n] : 0;
      const a = Math.abs(x);
      this.env = a > this.env ? this.att * this.env + (1 - this.att) * a : this.rel * this.env + (1 - this.rel) * a;
      if (!on) { this.g = 1; out[n] = x; continue; }
      if (this.env > thr) this.hold = this.holdN;
      else if (this.hold > 0) this.hold--;
      const target = this.hold > 0 ? 1 : 0;
      this.g += (target - this.g) * (target > this.g ? this.kOpen : this.kClose);
      out[n] = x * this.g;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    this.tick += out.length;
    if (this.tick >= sampleRate / 20) {
      this.tick = 0;
      this.port.postMessage({ open: this.g > 0.5, env: this.env });
    }
    return true;
  }
}

registerProcessor('vs-pitch', VsPitch);
registerProcessor('vs-gate', VsGate);
`;
