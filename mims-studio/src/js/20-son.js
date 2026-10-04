"use strict";
/* ------------------------------------------------------------------ *
 *  Son temps reel : un pas de calcul par echantillon audio (comme     *
 *  gen~). Sorties posOutput / frcOutput : 1re a gauche, 2e a droite,  *
 *  etc. Calcul dans un AudioWorklet, ScriptProcessor en secours.      *
 * ------------------------------------------------------------------ */

class NoyauSon {
  constructor(sampleRate, poster) {
    this.poster = poster;
    this.sr = sampleRate;
    this.sim = null;
    this.gain = 1.0;
    this.auto = true;                              // volume automatique
    this.env = 0;                                  // enveloppe crete (volume auto)
    this.relache = Math.exp(-1 / (sampleRate * 4));
    this.periode = Math.round(sampleRate / 30);    // ~30 images / s vers la vue
    this.compteur = 0;
    this.dc = new Float64Array(4);                 // filtres anti-continu L/R
    this.charge = 0;                               // part du temps reel utilisee
  }

  message(d) {
    switch (d.type) {
      case "modele": {
        const ancien = this.sim;
        this.sim = d.desc ? new Simulateur(d.desc) : null;
        if (!(d.garder && this.sim && this.sim.adopter(ancien))) { this.dc.fill(0); this.env = 0; }
        this._choisitVoies();
        break;
      }
      case "frapper": if (this.sim) this.sim.frapper(d.i, d.force); break;
      case "pousser": if (this.sim) this.sim.pousser(d.force, Math.round(this.sr / 1000)); break;
      case "placer": if (this.sim) this.sim.placer(d.i, d.u); break;
      case "entrainer": if (this.sim) this.sim.entrainer(d.i, d.v); break;
      case "reset": if (this.sim) this.sim.reset(); break;
      case "gain": this.gain = d.v; this.auto = d.auto !== false; break;
    }
  }

  /* Sans posOutput dans le script, on ecoute deux masses mobiles. */
  _choisitVoies() {
    this.secours = null;
    const s = this.sim;
    if (!s || s.sorties.length) return;
    const mob = [];
    for (let i = 0; i < s.n; i++) if (s.etat[i] === MOBILE) mob.push(i);
    if (mob.length) this.secours = [mob[Math.floor(mob.length / 3)], mob[Math.floor(2 * mob.length / 3)]];
  }

  remplir(L, R) {
    const s = this.sim;
    if (!s) { L.fill(0); if (R !== L) R.fill(0); return; }
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const ns = s.sorties.length, g = this.gain, dc = this.dc, u = s.u, sec = this.secours;
    for (let k = 0; k < L.length; k++) {
      s._unPas();
      let l = 0, r = 0;
      if (ns) {
        for (let j = 0; j < ns; j++) { const v = s.sortie(j); if (j % 2 === 0) l += v; else r += v; }
        if (ns === 1) r = l;
      } else if (sec) { l = u[sec[0]]; r = u[sec[1]]; }
      // filtre anti-continu, puis limiteur doux
      const yl = l - dc[0] + 0.995 * dc[1]; dc[0] = l; dc[1] = yl;
      const yr = r - dc[2] + 0.995 * dc[3]; dc[2] = r; dc[3] = yr;
      // volume auto : crete suivie (montee immediate, descente ~4 s) ramenee vers 0.35
      const a = Math.max(Math.abs(yl), Math.abs(yr));
      this.env = a > this.env ? a : this.env * this.relache;
      const ga = this.auto ? g * 0.35 / Math.max(this.env, 1e-4) : g * 4;
      L[k] = Math.tanh(yl * ga);
      if (R !== L) R[k] = Math.tanh(yr * ga);
    }
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dispo = 1000 * L.length / this.sr;
    this.charge = 0.97 * this.charge + 0.03 * ((t1 - t0) / dispo);
    this.compteur += L.length;
    if (this.compteur >= this.periode) {
      this.compteur = 0;
      if (!s.sain()) this.poster({ type: "explosion" });
      this.poster({ type: "etat", u: s.u.slice(), charge: this.charge });
    }
  }
}

const son = {
  ctx: null,
  noeud: null,
  noyau: null,            // seulement en mode secours (ScriptProcessor)
  actif: false,
  surMessage: null,
  mode: "",

  async demarrer() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("ce navigateur ne gere pas le son (Web Audio)");
      this.ctx = new AC({ latencyHint: "interactive" });
      await this._construitNoeud();
    }
    await this.ctx.resume();
    this.actif = true;
  },

  async _construitNoeud() {
    const recoit = d => { if (this.surMessage) this.surMessage(d); };
    if (this.ctx.audioWorklet) {
      try {
        const src = `"use strict";
${SOURCE_MOTEUR()}
${NoyauSon.toString()}
class MimsProcesseur extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noyau = new NoyauSon(sampleRate, d => this.port.postMessage(d));
    this.port.onmessage = e => this.noyau.message(e.data);
  }
  process(entrees, sorties) {
    const o = sorties[0];
    this.noyau.remplir(o[0], o[1] || o[0]);
    return true;
  }
}
registerProcessor("mims-son", MimsProcesseur);`;
        // blob: d'abord ; en file:// Chrome le refuse, data: passe partout
        const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
        try {
          await this.ctx.audioWorklet.addModule(url);
        } catch (exc) {
          await this.ctx.audioWorklet.addModule("data:application/javascript;base64," +
            btoa(unescape(encodeURIComponent(src))));
        } finally {
          URL.revokeObjectURL(url);
        }
        this.noeud = new AudioWorkletNode(this.ctx, "mims-son",
          { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.noeud.port.onmessage = e => recoit(e.data);
        this.noeud.connect(this.ctx.destination);
        this.mode = "worklet";
        return;
      } catch (exc) {
        console.warn("AudioWorklet indisponible, mode secours :", exc);
      }
    }
    // secours : calcul dans le fil principal (moins stable si la page est chargee)
    this.noyau = new NoyauSon(this.ctx.sampleRate, recoit);
    this.noeud = this.ctx.createScriptProcessor(1024, 0, 2);
    this.noeud.onaudioprocess = e => {
      const b = e.outputBuffer;
      this.noyau.remplir(b.getChannelData(0), b.getChannelData(1));
    };
    this.noeud.connect(this.ctx.destination);
    this.mode = "secours";
  },

  envoyer(d) {
    if (!this.noeud) return;
    if (this.noyau) this.noyau.message(d);
    else this.noeud.port.postMessage(d);
  },

  async arreter() {
    this.actif = false;
    this.envoyer({ type: "modele", desc: null });
    if (this.ctx) await this.ctx.suspend();
  },

  get frequence() { return this.ctx ? this.ctx.sampleRate : 0; },
};
