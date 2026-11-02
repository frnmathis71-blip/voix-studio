// Bibliothèque de voix. Chaque voix ne précise que ce qui diffère de VOICE_BASE.
window.VS = window.VS || {};

VS.VOICE_BASE = {
  pitch: 0,            // demi-tons de la voix principale
  harm: [],            // harmonies : [[demi-tons, gain], ...]
  mainGain: 1,         // gain de la voix principale quand il y a des harmonies
  ring: 0,             // modulation en anneau (0..1)
  ringFreq: 50,        // Hz
  drive: 0,            // saturation (0..1)
  bits: 0,             // réduction de résolution, 0 = désactivée
  hp: 20,              // passe-haut (Hz)
  lp: 20000,           // passe-bas (Hz)
  q: 0.7,
  wobble: 0,           // amplitude de l'ondulation du passe-bas (Hz)
  wobbleRate: 1,
  chorus: 0,           // part du signal modulé
  chorusDry: 1,
  chorusTime: 0.012,
  chorusDepth: 0.003,
  chorusRate: 0.6,
  chorusFb: 0,
  trem: 0,             // profondeur du trémolo (0..1)
  tremRate: 5,
  tremShape: 'sine',
  delay: 0,            // part d'écho
  delayTime: 0.25,
  delayFb: 0.3,
  reverb: 0,           // part de réverbération
  decay: 2,            // durée de la réverbération (s)
  gainDb: 0,
};

VS.CATEGORIES = [
  { id: 'all', name: 'Toutes' },
  { id: 'classique', name: 'Hauteur' },
  { id: 'creature', name: 'Créatures' },
  { id: 'machine', name: 'Machines' },
  { id: 'lieu', name: 'Lieux' },
  { id: 'delire', name: 'Délires' },
  { id: 'mine', name: 'Mes voix' },
];

VS.VOICES = [
  { id: 'normal', name: 'Voix naturelle', cat: 'classique', hue: 210, desc: 'Aucune transformation, seulement le traitement du micro.', p: {} },
  { id: 'helium', name: 'Hélium', cat: 'classique', hue: 48, desc: 'Une octave et demie plus légère, comme après un ballon.', p: { pitch: 8 } },
  { id: 'bebe', name: 'Bébé', cat: 'classique', hue: 330, desc: 'Une octave plus aiguë, timbre adouci.', p: { pitch: 12, lp: 9000 } },
  { id: 'grave', name: 'Grave', cat: 'classique', hue: 260, desc: 'Quatre demi-tons plus bas, posé et radiophonique.', p: { pitch: -4, reverb: 0.06, decay: 1.2 } },
  { id: 'geant', name: 'Géant', cat: 'classique', hue: 20, desc: 'Une quinte plus bas avec un peu d’espace.', p: { pitch: -7, reverb: 0.15, decay: 2.5 } },
  { id: 'titan', name: 'Titan', cat: 'classique', hue: 5, desc: 'Une octave plus bas, légèrement saturé.', p: { pitch: -12, drive: 0.15, reverb: 0.3, decay: 3.5 } },

  { id: 'demon', name: 'Démon', cat: 'creature', hue: 0, desc: 'Voix grave doublée à l’octave, rugueuse.', p: { pitch: -9, harm: [[-14, 0.55]], drive: 0.3, lp: 6000, reverb: 0.25, decay: 3 } },
  { id: 'fantome', name: 'Fantôme', cat: 'creature', hue: 190, desc: 'Lointain, flottant, avec une réverbération longue.', p: { pitch: 3, harm: [[-5, 0.4]], hp: 300, lp: 5000, trem: 0.3, tremRate: 4, reverb: 0.6, decay: 5 } },
  { id: 'fee', name: 'Fée', cat: 'creature', hue: 300, desc: 'Aiguë et scintillante, avec une harmonie haute.', p: { pitch: 7, harm: [[19, 0.25]], chorus: 0.4, reverb: 0.45, decay: 4 } },
  { id: 'zombie', name: 'Zombie', cat: 'creature', hue: 95, desc: 'Grave, étouffée et chancelante.', p: { pitch: -5, drive: 0.5, lp: 2500, trem: 0.4, tremRate: 3 } },
  { id: 'alien', name: 'Extraterrestre', cat: 'creature', hue: 140, desc: 'Métallique et ondulante, d’une autre planète.', p: { pitch: 5, ring: 0.4, ringFreq: 400, wobble: 2000, wobbleRate: 6, lp: 4000, chorus: 0.4 } },
  { id: 'lutin', name: 'Lutin', cat: 'creature', hue: 75, desc: 'Petit, rapide et nasal.', p: { pitch: 5, hp: 350, lp: 7000, q: 2 } },

  { id: 'robot', name: 'Robot', cat: 'machine', hue: 200, desc: 'Timbre métallique et résonant.', p: { ring: 0.8, ringFreq: 50, chorus: 0.5, chorusTime: 0.006, chorusDepth: 0, chorusFb: 0.6 } },
  { id: 'androide', name: 'Androïde', cat: 'machine', hue: 220, desc: 'Modulation en anneau grave, voix de machine de guerre.', p: { pitch: -2, ring: 1, ringFreq: 30, drive: 0.2 } },
  { id: 'mecha', name: 'Mécha', cat: 'machine', hue: 30, desc: 'Grave, métallique, avec un flanger serré.', p: { pitch: -4, ring: 0.5, ringFreq: 120, chorus: 0.5, chorusTime: 0.006, chorusDepth: 0.002, chorusFb: 0.7, reverb: 0.2 } },
  { id: 'telephone', name: 'Téléphone', cat: 'machine', hue: 170, desc: 'Bande passante d’une ligne fixe, 400 à 3 400 Hz.', p: { hp: 400, lp: 3400, q: 1, drive: 0.3 } },
  { id: 'radio', name: 'Vieille radio', cat: 'machine', hue: 35, desc: 'Poste à lampes, son étroit et granuleux.', p: { hp: 500, lp: 2800, drive: 0.4, bits: 7 } },
  { id: 'talkie', name: 'Talkie-walkie', cat: 'machine', hue: 120, desc: 'Transmission radio compressée et saturée.', p: { hp: 600, lp: 2800, drive: 0.55, bits: 5 } },
  { id: 'megaphone', name: 'Mégaphone', cat: 'machine', hue: 15, desc: 'Médium agressif et saturé, pour haranguer la foule.', p: { hp: 700, lp: 4500, drive: 0.7, gainDb: -6 } },

  { id: 'caverne', name: 'Caverne', cat: 'lieu', hue: 25, desc: 'Échos sur la roche et réverbération sombre.', p: { delay: 0.5, delayTime: 0.32, delayFb: 0.45, reverb: 0.4, decay: 3.5, lp: 6000 } },
  { id: 'cathedrale', name: 'Cathédrale', cat: 'lieu', hue: 45, desc: 'Sept secondes de réverbération sous les voûtes.', p: { reverb: 0.7, decay: 7 } },
  { id: 'eau', name: 'Sous l’eau', cat: 'lieu', hue: 195, desc: 'Étouffée et ondulante, comme au fond d’une piscine.', p: { pitch: -1, lp: 700, wobble: 400, wobbleRate: 1.2, chorus: 0.5 } },
  { id: 'stade', name: 'Stade', cat: 'lieu', hue: 100, desc: 'Annonce sonorisée avec écho tardif.', p: { hp: 250, drive: 0.2, delay: 0.35, delayTime: 0.45, delayFb: 0.25, reverb: 0.35, decay: 3 } },
  { id: 'casque', name: 'Casque spatial', cat: 'lieu', hue: 230, desc: 'Voix d’astronaute dans un casque fermé.', p: { hp: 350, lp: 3800, chorus: 0.3, chorusTime: 0.004, chorusDepth: 0, chorusFb: 0.4, reverb: 0.12, decay: 0.6 } },

  { id: 'chorale', name: 'Chorale', cat: 'delire', hue: 280, desc: 'Accord majeur chanté à quatre voix.', p: { harm: [[4, 0.5], [7, 0.5], [12, 0.35]], reverb: 0.35, decay: 3 } },
  { id: 'vibrato', name: 'Vibrato', cat: 'delire', hue: 320, desc: 'Une ondulation de chanteur lyrique sur chaque mot.', p: { chorus: 1, chorusDry: 0, chorusTime: 0.008, chorusDepth: 0.0035, chorusRate: 5.5, reverb: 0.2 } },
  { id: 'glitch', name: 'Glitch', cat: 'delire', hue: 160, desc: 'Signal haché et numérique, comme une connexion qui lâche.', p: { bits: 4, trem: 1, tremRate: 14, tremShape: 'square', ring: 0.3, ringFreq: 900 } },
  { id: 'clones', name: 'Clones', cat: 'delire', hue: 250, desc: 'Trois versions de vous parlent en même temps.', p: { harm: [[-3, 0.5], [3, 0.5]], chorus: 0.5, chorusRate: 1.5, delay: 0.25, delayTime: 0.09, delayFb: 0.1 } },
  { id: 'dessin', name: 'Dessin animé', cat: 'delire', hue: 55, desc: 'Aiguë et nasillarde, avec un léger vibrato.', p: { pitch: 10, hp: 500, q: 1.5, chorus: 1, chorusDry: 0, chorusTime: 0.006, chorusDepth: 0.0012, chorusRate: 7 } },
];
