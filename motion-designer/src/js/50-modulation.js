/* Modulation : LFO par parametre et connecteurs (vitesse, position XY).
 * Les valeurs de base restent dans l'etat ; on calcule ici les valeurs
 * "effectives" et on les pousse au moteur audio. */
"use strict";

const LIENS = {
  vitesse: { nom: "Vitesse", icone: "↗" },
  x: { nom: "Position X", icone: "↔" },
  y: { nom: "Position Y", icone: "↕" },
};

/* Pousse une valeur de parametre vers les noeuds audio concernes */
function appliquerAudio(chemin, v) {
  if (!audio.ctx || !audio.master) return;
  const p = chemin.split(":");
  if (p[0] === "m") {
    if (p[1] === "volume") lisser(audio.master.volume.gain, dbVersGain(v));
    else { const i = FX_MASTER.indexOf(p[2]); if (i >= 0) audio.master.modules[i].regler(p[3], v); }
  } else if (p[0] === "s") {
    const m = moteur.sources.get(p[1]); if (!m) return;
    if (p[2] === "volume") lisser(m.vol.gain, dbVersGain(v));
    else if (p[2] === "fx") m.module(p[3]).regler(p[4], v);
  }
  // champ, enveloppes, periode, hauteur : relus a chaque tick
}

const mod = {
  effectifs: new Map(),     // chemin -> valeur effective (seulement si module)
  phases: new Map(),        // chemin -> {phase, hasard}
  connecteurs: { vitesse: 0, x: 0.5, y: 0.5 },

  val(chemin, base) {
    const v = this.effectifs.get(chemin);
    return v === undefined ? base : v;
  },

  valeurLfo(forme, phase, etatH) {
    switch (forme) {
      case "triangle": return 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5);
      case "square": return phase < 0.5 ? 1 : -1;
      case "random": return etatH.valeur;
      default: return Math.sin(phase * 2 * Math.PI);
    }
  },

  /* valeurs des connecteurs pour un chemin : la source elle-meme, sinon le dernier objet bouge */
  connecteursPour(chemin) {
    const p = chemin.split(":");
    let id = p[0] === "s" ? p[1] : champ.dernierBouge;
    if (!id) return { vitesse: 0, x: 0.5, y: 0.5 };
    const pos = id === "aud" ? champ.auditeurLisse() : champ.positionLissee(id);
    if (!pos) return { vitesse: 0, x: 0.5, y: 0.5 };
    const v = id === "aud" ? Math.hypot(pos.vx, pos.vy) : champ.vitesseRelative(id);
    return { vitesse: borne(v / 2.5, 0, 1), x: (pos.x + 1) / 2, y: (1 - pos.y) / 2 };
  },

  /* liste de tous les parametres porteurs d'un LFO actif */
  lfosActifs() {
    const l = [];
    const parcourir = (prefixe, fxListe) => fxListe.forEach(fx => {
      if (!fx.on) return;
      for (const k in fx.lfo) if (fx.lfo[k].on) l.push([prefixe + fx.type + ":" + k, fx.lfo[k]]);
    });
    etat.sources.forEach(s => parcourir("s:" + s.id + ":fx:", s.fx));
    parcourir("m:fx:", etat.master.fx);
    return l;
  },

  tick(dt) {
    const g = this.connecteursPour("m");
    this.connecteurs = g;
    const nouveaux = new Map();
    const decal = new Map();
    for (const [chemin, lfo] of this.lfosActifs()) {
      let ph = this.phases.get(chemin);
      if (!ph) { ph = { phase: 0, valeur: Math.random() * 2 - 1 }; this.phases.set(chemin, ph); }
      ph.phase += dt * lfo.vitesse;
      if (ph.phase >= 1) { ph.phase %= 1; ph.valeur = Math.random() * 2 - 1; }
      decal.set(chemin, this.valeurLfo(lfo.forme, ph.phase, ph) * lfo.prof / 100 * 0.5);
    }
    const chemins = new Set([...decal.keys(), ...Object.keys(etat.liens)]);
    for (const chemin of chemins) {
      const r = resoudre(chemin);
      if (!r || !r.spec) { if (!decal.has(chemin)) delete etat.liens[chemin]; continue; }
      let n = norm(r.spec, r.obj[r.cle]);
      const lien = etat.liens[chemin];
      if (lien) { const c = this.connecteursPour(chemin)[lien]; n = n + c * (1 - n); }
      if (decal.has(chemin)) n += decal.get(chemin);
      const v = denorm(Object.assign({}, r.spec, { pas: 0 }), n);
      nouveaux.set(chemin, v);
      if (Math.abs((this.effectifs.get(chemin) ?? NaN) - v) > 1e-6 || !this.effectifs.has(chemin)) appliquerAudio(chemin, v);
    }
    // parametres qui ne sont plus modules : on remet la valeur de base
    for (const chemin of this.effectifs.keys()) {
      if (nouveaux.has(chemin)) continue;
      const r = resoudre(chemin);
      if (r && r.spec) appliquerAudio(chemin, r.obj[r.cle]);
    }
    this.effectifs = nouveaux;
  },
};
