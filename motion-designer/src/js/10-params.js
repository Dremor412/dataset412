/* Definition des parametres, des effets et de l'etat du projet.
 * Tout ce qui est reglable a un "chemin" texte (ex. "s:<id>:fx:delai:temps")
 * pour que curseurs, LFO, connecteurs et MIDI parlent la meme langue. */
"use strict";

const P = (nom, min, max, def, unite, extra) => Object.assign({ nom, min, max, def, unite, pas: 0 }, extra);

const EFFETS = {
  pitch: {
    abr: "PIT", nom: "Hauteur", sous: "Vitesse de lecture",
    params: { demi: P("Transposition", -24, 24, 0, "st", { pas: 0.1 }) },
    lfo: [],
  },
  filtre: {
    abr: "FLT", nom: "Filtre", sous: "Biquad",
    choix: { type: { nom: "Type", def: "lowpass", options: [
      ["lowpass", "Passe-bas"], ["highpass", "Passe-haut"], ["bandpass", "Passe-bande"],
      ["notch", "Coupe-bande"], ["lowshelf", "Plateau grave"], ["highshelf", "Plateau aigu"]] } },
    params: {
      freq: P("Coupure", 20, 20000, 20000, "Hz", { log: true }),
      q: P("Résonance", 0.1, 20, 0.71, "Q", { log: true }),
      gain: P("Gain", -18, 18, 0, "dB", { pas: 0.1 }),
    },
    lfo: ["freq", "q"],
  },
  sat: {
    abr: "SAT", nom: "Saturation", sous: "Suréchantillonnée 4×",
    params: {
      drive: P("Drive", 0, 100, 0, "%"),
      mix: P("Mix", 0, 100, 100, "%"),
      ton: P("Tonalité", 300, 20000, 20000, "Hz", { log: true }),
    },
    lfo: ["drive", "mix", "ton"],
  },
  flanger: {
    abr: "FLG", nom: "Flanger", sous: "Filtre en peigne modulé",
    params: {
      mix: P("Mix", 0, 100, 50, "%"),
      vitesse: P("Vitesse", 0.05, 5, 0.28, "Hz", { log: true }),
      prof: P("Profondeur", 0.2, 10, 2.5, "ms"),
      retour: P("Réinjection", -85, 85, 35, "%"),
    },
    lfo: ["mix", "vitesse", "prof", "retour"],
  },
  chorus: {
    abr: "CHR", nom: "Chorus", sous: "Deux voix stéréo",
    params: {
      mix: P("Mix", 0, 100, 50, "%"),
      vitesse: P("Vitesse", 0.05, 5, 0.8, "Hz", { log: true }),
      prof: P("Profondeur", 0.5, 15, 6, "ms"),
      delai: P("Retard", 6, 35, 18, "ms"),
    },
    lfo: ["mix", "vitesse", "prof", "delai"],
  },
  delai: {
    abr: "DLY", nom: "Écho", sous: "Réinjection amortie",
    params: {
      mix: P("Mix", 0, 100, 30, "%"),
      temps: P("Temps", 5, 1800, 240, "ms", { log: true }),
      retour: P("Réinjection", 0, 92, 34, "%"),
      amorti: P("Amorti", 500, 20000, 8000, "Hz", { log: true }),
    },
    lfo: ["mix", "temps", "retour"],
  },
  reverb: {
    abr: "REV", nom: "Réverbération", sous: "Convolution stéréo",
    params: {
      mix: P("Mix", 0, 100, 30, "%"),
      predelai: P("Pré-délai", 0, 180, 20, "ms"),
      decro: P("Durée", 0.3, 8, 2.8, "s", { pas: 0.1 }),
      amorti: P("Amorti", 500, 20000, 9000, "Hz", { log: true }),
    },
    lfo: ["mix", "predelai", "amorti"],
  },
  dyn: {
    abr: "DYN", nom: "Dynamique", sous: "Compresseur",
    params: {
      seuil: P("Seuil", -60, 0, -8, "dB", { pas: 0.1 }),
      ratio: P("Ratio", 1, 20, 4, ":1", { pas: 0.1 }),
      attaque: P("Attaque", 0, 1000, 8, "ms"),
      relache: P("Relâche", 10, 1000, 120, "ms", { log: true }),
    },
    lfo: [],
  },
};

const MAX_SOURCES = 20;
const FX_PISTE = ["pitch", "filtre", "sat", "flanger", "chorus", "delai", "reverb"];
const FX_MASTER = ["filtre", "sat", "delai", "reverb", "dyn", "pitch"];

const PARAMS_SOURCE = {
  volume: P("Volume", -60, 6, -6, "dB", { pas: 0.1 }),
  periode: P("Période", 0.05, 8, 1, "s", { log: true }),
  x: P("Position X", -1, 1, 0, ""),
  y: P("Position Y", -1, 1, 0, ""),
};
const PARAMS_ENV = {
  a: P("Attaque", 0, 2, 0.02, "s", { pas: 0.01 }),
  d: P("Déclin", 0, 2, 0.12, "s", { pas: 0.01 }),
  s: P("Maintien", 0, 100, 82, "%"),
  r: P("Relâche", 0, 4, 0.6, "s", { pas: 0.01 }),
};
const PARAMS_CHAMP = {
  doppler: P("Doppler", 0, 200, 100, "%"),
  lissageMouv: P("Lissage mouv.", 0, 90, 24, "%"),
  lissagePan: P("Lissage pan.", 0, 100, 35, "%"),
  portee: P("Portée", 15, 130, 68, "%"),
};
const PARAMS_MASTER = { volume: P("Volume général", -60, 6, 0, "dB", { pas: 0.1 }) };
const PARAMS_AUDITEUR = { x: P("Auditeur X", -1, 1, 0, ""), y: P("Auditeur Y", -1, 1, 0, "") };

const MODES = [["oneshot", "Une fois"], ["loop", "Boucle"], ["pingpong", "Aller-retour"], ["periodique", "Déclenchement périodique"]];
const FORMES_LFO = [["sine", "Sinus"], ["triangle", "Triangle"], ["square", "Carré"], ["random", "Aléatoire tenu"]];
const COULEURS = ["#f5a524", "#3fd9b0", "#5aa9ff", "#ff6b8b", "#b78cff", "#9be15d", "#ffd84d", "#4de1e1", "#ff9157", "#e07bff"];

function nouvelEffet(type) {
  const d = EFFETS[type], fx = { type, on: false, params: {}, choix: {}, lfo: {} };
  for (const k in d.params) fx.params[k] = d.params[k].def;
  for (const k in d.choix || {}) fx.choix[k] = d.choix[k].def;
  for (const k of d.lfo) fx.lfo[k] = { on: false, forme: "sine", vitesse: 0.5, prof: 50 };
  return fx;
}

function nouvelleSource(nom, index) {
  const ang = (index % 8) * Math.PI / 4, r = 0.53;
  const s = {
    id: nouvelId(), nom, couleur: COULEURS[index % COULEURS.length],
    x: +(Math.sin(ang) * r).toFixed(3), y: +(Math.cos(ang) * r).toFixed(3),
    volume: -6, periode: 1, mode: "loop", region: [0, 1], depart: 0,
    mute: false, solo: false, ouvert: true, envOuvert: false, fxOuvert: false,
    env: {}, fx: FX_PISTE.map(nouvelEffet), duree: 0,
  };
  for (const k in PARAMS_ENV) s.env[k] = PARAMS_ENV[k].def;
  return s;
}

function etatInitial() {
  const e = {
    version: 1,
    sources: [],
    auditeur: { x: 0, y: 0 },
    champ: { distance: true },
    master: { volume: 0, fx: FX_MASTER.map(nouvelEffet) },
    liens: {},          // chemin -> "vitesse" | "x" | "y"
    midi: {},           // "canal:cc" -> chemin
  };
  for (const k in PARAMS_CHAMP) e.champ[k] = PARAMS_CHAMP[k].def;
  return e;
}

/* --- Adressage des parametres par chemin --- */
function resoudre(chemin, e = etat) {
  const p = chemin.split(":");
  if (p[0] === "m") {
    if (p[1] === "volume") return { spec: PARAMS_MASTER.volume, obj: e.master, cle: "volume" };
    const fx = e.master.fx.find(f => f.type === p[2]);
    return fx && { spec: EFFETS[p[2]].params[p[3]], obj: fx.params, cle: p[3], fx };
  }
  if (p[0] === "c") return { spec: PARAMS_CHAMP[p[1]], obj: e.champ, cle: p[1] };
  if (p[0] === "a") return { spec: PARAMS_AUDITEUR[p[1]], obj: e.auditeur, cle: p[1] };
  if (p[0] === "s") {
    const s = e.sources.find(x => x.id === p[1]);
    if (!s) return null;
    if (p[2] === "env") return { spec: PARAMS_ENV[p[3]], obj: s.env, cle: p[3], source: s };
    if (p[2] === "fx") {
      const fx = s.fx.find(f => f.type === p[3]);
      return fx && { spec: EFFETS[p[3]].params[p[4]], obj: fx.params, cle: p[4], fx, source: s };
    }
    return { spec: PARAMS_SOURCE[p[2]], obj: s, cle: p[2], source: s };
  }
  return null;
}

function nomChemin(chemin) {
  const r = resoudre(chemin); if (!r) return chemin;
  const p = chemin.split(":");
  let n = r.spec.nom;
  if (r.fx) n = EFFETS[r.fx.type].nom + " · " + n;
  if (r.source) n = (etat.sources.indexOf(r.source) + 1) + ". " + r.source.nom + " · " + n;
  else if (p[0] === "m" && r.fx) n = "Master · " + n;
  return n;
}

/* Valeur <-> position normalisee 0..1 (echelle log si demandee) */
function norm(spec, v) {
  if (spec.log) return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  return (v - spec.min) / (spec.max - spec.min);
}
function denorm(spec, n) {
  n = borne(n, 0, 1);
  let v = spec.log ? spec.min * Math.pow(spec.max / spec.min, n) : spec.min + n * (spec.max - spec.min);
  if (spec.pas) v = Math.round(v / spec.pas) * spec.pas;
  return v;
}
