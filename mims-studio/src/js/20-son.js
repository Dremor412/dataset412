"use strict";
/* ------------------------------------------------------------------ *
 *  Son temps reel : un pas de calcul par echantillon audio (comme     *
 *  gen~). Sorties posOutput / frcOutput placees en stereo (pan) ou    *
 *  sur des canaux separes (multicanal). AudioWorklet, ou              *
 *  ScriptProcessor en secours.                                        *
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
    this.nCanaux = 2;
    this.multi = false;                            // stereo (pan) ou multicanal (canal)
    this.dc = new Float64Array(2 * 32);            // filtres anti-continu par canal
    this.mix = new Float64Array(32);
    this.charge = 0;                               // part du temps reel utilisee
    this.routes = [];                              // [{i, frc, gains[canal]}]
  }

  message(d) {
    switch (d.type) {
      case "modele": {
        const ancien = this.sim;
        this.sim = d.desc ? new Simulateur(d.desc) : null;
        if (!(d.garder && this.sim && this.sim.adopter(ancien))) { this.dc.fill(0); this.env = 0; }
        this._routage();
        break;
      }
      case "routage":                               // pan / gain / canal / muet, sans recompiler
        if (this.sim) d.sorties.forEach((r, k) => { if (this.sim.sorties[k]) Object.assign(this.sim.sorties[k], r); });
        this._routage();
        break;
      case "canaux": this.nCanaux = d.n; this.multi = d.multi; this.dc.fill(0); this._routage(); break;
      case "frapper": if (this.sim) this.sim.frapper(d.i, d.force); break;
      case "pousser": if (this.sim) this.sim.pousser(d.force, Math.round(this.sr / 1000)); break;
      case "placer": if (this.sim) this.sim.placer(d.i, d.u); break;
      case "entrainer": if (this.sim) this.sim.entrainer(d.i, d.v); break;
      case "reset": if (this.sim) this.sim.reset(); this.dc.fill(0); this.env = 0; break;
      case "gain": this.gain = d.v; this.auto = d.auto !== false; break;
    }
  }

  /* gains de chaque sortie vers chaque canal. Stereo : pan a puissance
   * constante. Multicanal : la sortie va sur son canal. Sans posOutput,
   * on ecoute deux masses de l'objet. */
  _routage() {
    const s = this.sim, C = this.nCanaux;
    this.routes = [];
    if (!s) return;
    let sorties = s.sorties.map(o => ({ i: o.i, frc: o.genre === "frcOutput", pan: o.pan, gain: o.gain, canal: o.canal, muet: o.muet }));
    if (!sorties.length) {
      const mob = [];
      for (let i = 0; i < s.n; i++) if (s.etat[i] === MOBILE) mob.push(i);
      if (mob.length) sorties = [
        { i: mob[Math.floor(mob.length / 3)], frc: false, pan: -1, gain: 0, canal: 1, muet: false },
        { i: mob[Math.floor(2 * mob.length / 3)], frc: false, pan: 1, gain: 0, canal: 2, muet: false }];
    }
    for (const o of sorties) {
      const g = o.muet ? 0 : Math.pow(10, (o.gain || 0) / 20), gains = new Float64Array(C);
      if (this.multi) gains[((o.canal || 1) - 1) % C] = g;
      else if (C === 1) gains[0] = g;
      else {
        const a = (Math.min(Math.max(o.pan, -1), 1) + 1) * Math.PI / 4;
        gains[0] = g * Math.cos(a); gains[1] = g * Math.sin(a);
      }
      this.routes.push({ i: o.i, frc: o.frc, gains });
    }
  }

  remplir(canaux) {
    const s = this.sim, C = Math.min(canaux.length, this.nCanaux), N = canaux[0].length;
    if (!s) { for (const c of canaux) c.fill(0); return; }
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const g = this.gain, dc = this.dc, mix = this.mix, routes = this.routes, u = s.u, f = s.f;
    for (let k = 0; k < N; k++) {
      s._unPas();
      for (let c = 0; c < C; c++) mix[c] = 0;
      for (let r = 0; r < routes.length; r++) {
        const R = routes[r], v = R.frc ? f[R.i] : u[R.i];
        for (let c = 0; c < C; c++) mix[c] += v * R.gains[c];
      }
      // filtre anti-continu par canal, puis volume auto et limiteur doux
      let a = 0;
      for (let c = 0; c < C; c++) {
        const y = mix[c] - dc[2 * c] + 0.995 * dc[2 * c + 1];
        dc[2 * c] = mix[c]; dc[2 * c + 1] = y; mix[c] = y;
        a = Math.max(a, Math.abs(y));
      }
      this.env = a > this.env ? a : this.env * this.relache;
      const ga = this.auto ? g * 0.35 / Math.max(this.env, 1e-4) : g * 4;
      for (let c = 0; c < C; c++) canaux[c][k] = Math.tanh(mix[c] * ga);
    }
    for (let c = C; c < canaux.length; c++) canaux[c].fill(0);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.charge = 0.97 * this.charge + 0.03 * ((t1 - t0) / (1000 * N / this.sr));
    this.compteur += N;
    if (this.compteur >= this.periode) {
      this.compteur = 0;
      if (!s.sain()) { this.dc.fill(0); this.env = 0; this.poster({ type: "explosion" }); }
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
    this.noyau.remplir(sorties[0]);
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
        this.mode = "worklet";
        this._creeNoeud();
        return;
      } catch (exc) {
        console.warn("AudioWorklet indisponible, mode secours :", exc);
      }
    }
    // secours : calcul dans le fil principal (moins stable si la page est chargee)
    this.mode = "secours";
    this.noyau = new NoyauSon(this.ctx.sampleRate, recoit);
    this._creeNoeud();
  },

  nCanaux: 2,
  multi: false,

  /* (re)cree le noeud de sortie avec le bon nombre de canaux */
  _creeNoeud() {
    const recoit = d => { if (this.surMessage) this.surMessage(d); };
    if (this.noeud) this.noeud.disconnect();
    if (this.multi) this.nCanaux = Math.min(this.nCanaux, this.maxCanaux);
    const n = this.nCanaux, dest = this.ctx.destination;
    try { dest.channelCount = Math.max(2, n); dest.channelInterpretation = n > 2 ? "discrete" : "speakers"; }
    catch (e) { /* certains navigateurs refusent : on garde la stereo */ }
    if (this.mode === "worklet") {
      this.noeud = new AudioWorkletNode(this.ctx, "mims-son",
        { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [n],
          channelCount: n, channelCountMode: "explicit", channelInterpretation: "discrete" });
      this.noeud.port.onmessage = e => recoit(e.data);
    } else {
      this.noeud = this.ctx.createScriptProcessor(1024, 0, n);
      this.noeud.onaudioprocess = e => {
        const b = e.outputBuffer, c = [];
        for (let k = 0; k < b.numberOfChannels; k++) c.push(b.getChannelData(k));
        this.noyau.remplir(c);
      };
    }
    this.noeud.connect(dest);
    this.envoyer({ type: "canaux", n, multi: this.multi });
  },

  /* nombre de canaux de la carte son (2 si inconnu) */
  get maxCanaux() { return this.ctx ? Math.max(2, this.ctx.destination.maxChannelCount || 2) : 2; },

  /* stereo (pan) ou multicanal (une sortie par canal) ; renvoie le nombre de canaux */
  configurerCanaux(multi, n) {
    this.multi = multi;
    this.nCanaux = multi ? Math.min(Math.max(n, 1), 32) : 2;
    if (this.ctx) this._creeNoeud();
    return this.nCanaux;
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
