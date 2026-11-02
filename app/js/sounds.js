// Effets sonores synthétisés à la volée (aucun fichier externe).
window.VS = window.VS || {};

(function () {
  function noiseBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(ctx, dest, t, a, hold, r, peak = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
    g.connect(dest);
    return g;
  }

  function osc(ctx, type, freq, t, dur, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function noise(ctx, t, dur, dest) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, dur + 0.05);
    s.connect(dest);
    s.start(t);
    return s;
  }

  function filter(ctx, type, f, q, dest) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    b.connect(dest);
    return b;
  }

  const SYNTHS = {
    corne(ctx, out, t) {
      for (let k = 0; k < 3; k++) {
        const s = t + k * 0.32;
        const len = k === 2 ? 0.9 : 0.22;
        const lp = filter(ctx, 'lowpass', 2600, 1, env(ctx, out, s, 0.02, len, 0.12, 0.28));
        [466, 470, 587, 932].forEach((f) => {
          const o = osc(ctx, 'sawtooth', f, s, len + 0.15, lp);
          o.frequency.linearRampToValueAtTime(f * 0.97, s + len + 0.1);
        });
      }
      return 2;
    },
    applaudissements(ctx, out, t) {
      const dur = 3.2;
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * dur);
      const buf = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let next = 0;
        while (next < len) {
          const pos = next / len;
          const amp = Math.min(1, pos * 6) * Math.min(1, (1 - pos) * 2.5) * (0.4 + Math.random() * 0.6);
          const clapLen = Math.floor(rate * (0.008 + Math.random() * 0.01));
          for (let i = 0; i < clapLen && next + i < len; i++) {
            d[next + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (clapLen / 3));
          }
          next += Math.floor(rate / (35 + Math.random() * 40));
        }
      }
      const s = ctx.createBufferSource();
      s.buffer = buf;
      const bp = filter(ctx, 'bandpass', 1800, 0.6, env(ctx, out, t, 0.01, dur - 0.3, 0.3, 0.8));
      s.connect(bp);
      s.start(t);
      return dur;
    },
    badumtss(ctx, out, t) {
      // caisse claire, grosse caisse, cymbale
      const snare = (s) => {
        noise(ctx, s, 0.2, filter(ctx, 'highpass', 1200, 0.7, env(ctx, out, s, 0.001, 0.01, 0.15, 0.5)));
        osc(ctx, 'triangle', 190, s, 0.12, env(ctx, out, s, 0.001, 0.01, 0.1, 0.4));
      };
      const kick = (s) => {
        const o = osc(ctx, 'sine', 140, s, 0.35, env(ctx, out, s, 0.002, 0.02, 0.3, 0.9));
        o.frequency.exponentialRampToValueAtTime(45, s + 0.25);
      };
      snare(t);
      kick(t + 0.17);
      noise(ctx, t + 0.42, 1.6, filter(ctx, 'highpass', 6500, 0.5, env(ctx, out, t + 0.42, 0.002, 0.05, 1.4, 0.45)));
      kick(t + 0.42);
      return 2.1;
    },
    bonne(ctx, out, t) {
      [[880, 0], [1318.5, 0.14]].forEach(([f, d]) => {
        const g = env(ctx, out, t + d, 0.004, 0.02, 1.1, 0.35);
        osc(ctx, 'sine', f, t + d, 1.2, g);
        osc(ctx, 'sine', f * 2.01, t + d, 0.6, env(ctx, out, t + d, 0.004, 0.01, 0.4, 0.08));
      });
      return 1.4;
    },
    mauvaise(ctx, out, t) {
      const lp = filter(ctx, 'lowpass', 1400, 0.8, env(ctx, out, t, 0.01, 0.7, 0.1, 0.25));
      osc(ctx, 'square', 110, t, 0.85, lp);
      osc(ctx, 'square', 116.5, t, 0.85, lp);
      return 0.9;
    },
    laser(ctx, out, t) {
      for (let k = 0; k < 3; k++) {
        const s = t + k * 0.18;
        const o = osc(ctx, 'square', 1800, s, 0.18, filter(ctx, 'lowpass', 5000, 1, env(ctx, out, s, 0.002, 0.05, 0.12, 0.18)));
        o.frequency.exponentialRampToValueAtTime(140, s + 0.17);
      }
      return 0.8;
    },
    ressort(ctx, out, t) {
      const g = env(ctx, out, t, 0.005, 0.2, 0.7, 0.4);
      const o = osc(ctx, 'sine', 160, t, 0.95, g);
      const lfo = osc(ctx, 'sine', 14, t, 0.95, ctx.createGain());
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(220, t);
      depth.gain.exponentialRampToValueAtTime(5, t + 0.9);
      lfo.disconnect();
      lfo.connect(depth).connect(o.frequency);
      o.frequency.linearRampToValueAtTime(380, t + 0.9);
      return 1;
    },
    sirene(ctx, out, t) {
      const dur = 2.6;
      const g = env(ctx, out, t, 0.05, dur - 0.3, 0.25, 0.22);
      const o = osc(ctx, 'sawtooth', 800, t, dur, filter(ctx, 'lowpass', 2500, 0.7, g));
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.9;
      const depth = ctx.createGain();
      depth.gain.value = 260;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur);
      return dur;
    },
    roulement(ctx, out, t) {
      const dur = 2;
      for (let s = 0; s < dur; s += 1 / 28) {
        const amp = 0.08 + 0.4 * (s / dur);
        noise(ctx, t + s, 0.06, filter(ctx, 'bandpass', 2200, 0.8, env(ctx, out, t + s, 0.001, 0.005, 0.05, amp)));
      }
      noise(ctx, t + dur, 2, filter(ctx, 'highpass', 5000, 0.5, env(ctx, out, t + dur, 0.002, 0.05, 1.8, 0.5)));
      const k = osc(ctx, 'sine', 120, t + dur, 0.4, env(ctx, out, t + dur, 0.002, 0.02, 0.35, 0.8));
      k.frequency.exponentialRampToValueAtTime(40, t + dur + 0.3);
      return dur + 2;
    },
    piece(ctx, out, t) {
      osc(ctx, 'square', 988, t, 0.08, env(ctx, out, t, 0.002, 0.06, 0.02, 0.15));
      osc(ctx, 'square', 1319, t + 0.08, 0.5, env(ctx, out, t + 0.08, 0.002, 0.05, 0.4, 0.15));
      return 0.7;
    },
    triste(ctx, out, t) {
      const notes = [[311, 0, 0.35], [293.7, 0.4, 0.35], [277.2, 0.8, 0.35], [261.6, 1.2, 1.1]];
      notes.forEach(([f, d, len]) => {
        const g = env(ctx, out, t + d, 0.03, len - 0.1, 0.15, 0.25);
        const o = osc(ctx, 'sawtooth', f, t + d, len, filter(ctx, 'lowpass', 1200, 2, g));
        if (len > 1) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 6;
          const depth = ctx.createGain();
          depth.gain.value = 9;
          lfo.connect(depth).connect(o.frequency);
          lfo.start(t + d + 0.2); lfo.stop(t + d + len);
        }
      });
      return 2.5;
    },
  };

  VS.BUILTIN_SOUNDS = [
    { id: 'corne', name: 'Corne de brume', hue: 15 },
    { id: 'applaudissements', name: 'Applaudissements', hue: 45 },
    { id: 'badumtss', name: 'Ba-dum-tss', hue: 280 },
    { id: 'bonne', name: 'Bonne réponse', hue: 140 },
    { id: 'mauvaise', name: 'Mauvaise réponse', hue: 0 },
    { id: 'laser', name: 'Laser', hue: 190 },
    { id: 'ressort', name: 'Ressort', hue: 60 },
    { id: 'sirene', name: 'Sirène', hue: 220 },
    { id: 'roulement', name: 'Roulement de tambour', hue: 25 },
    { id: 'piece', name: 'Pièce', hue: 50 },
    { id: 'triste', name: 'Trompette triste', hue: 250 },
  ];

  // Joue un son dans `out`. Renvoie un objet pour l'arrêter.
  VS.playSound = function (ctx, out, sound, volume = 1) {
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(out);
    const t = ctx.currentTime + 0.02;
    let dur;
    if (sound.buffer) {
      const s = ctx.createBufferSource();
      s.buffer = sound.buffer;
      s.connect(g);
      s.start(t);
      dur = sound.buffer.duration;
    } else {
      dur = SYNTHS[sound.id](ctx, g, t);
    }
    return {
      duration: dur,
      stop() {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => g.disconnect(), 200);
      },
    };
  };
})();
