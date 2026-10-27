/* Enregistrement de la sortie (et des pistes separees) en WAV. */
"use strict";

const CODE_ENREGISTREUR = `
class Enregistreur extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = e => { this.on = e.data; }; }
  process(entrees) {
    const e = entrees[0];
    if (this.on && e && e.length) {
      const g = e[0], d = e[1] || e[0];
      this.port.postMessage([g.slice(0), d.slice(0)]);
    }
    return true;
  }
}
registerProcessor("enregistreur", Enregistreur);`;

const enregistreur = {
  actif: false,
  worklet: false,
  options: { bits: 24, stems: false },
  prises: [],          // [{nom, morceaux:[[g,d]...]}]
  resultat: null,      // [{nom, blob}]
  debut: 0,

  async preparer() {
    const ctx = audio.ctx;
    if (!ctx.audioWorklet) return;
    // blob: est refuse quand la page est ouverte en file:// ; data: passe partout
    const urls = [
      URL.createObjectURL(new Blob([CODE_ENREGISTREUR], { type: "application/javascript" })),
      "data:application/javascript;base64," + btoa(CODE_ENREGISTREUR),
    ];
    for (const url of urls) {
      try { await ctx.audioWorklet.addModule(url); this.worklet = true; return; } catch (e) { /* essai suivant */ }
    }
    this.worklet = false;
  },

  capteur(noeud, nom) {
    const ctx = audio.ctx, prise = { nom, morceaux: [] };
    let n;
    if (this.worklet) {
      n = new AudioWorkletNode(ctx, "enregistreur", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });
      n.port.onmessage = e => prise.morceaux.push(e.data);
      n.port.postMessage(true);
    } else {
      n = ctx.createScriptProcessor(4096, 2, 2);
      n.onaudioprocess = e => prise.morceaux.push([e.inputBuffer.getChannelData(0).slice(), e.inputBuffer.getChannelData(1).slice()]);
    }
    const muet = ctx.createGain(); muet.gain.value = 0;
    noeud.connect(n); n.connect(muet).connect(ctx.destination);
    prise.noeud = n; prise.source = noeud; prise.muet = muet;
    this.prises.push(prise);
  },

  async demarrer() {
    await audio.demarrer();
    if (this.actif) return;
    this.prises = []; this.resultat = null;
    this.capteur(audio.master.volume, "mix");
    if (this.options.stems) {
      etat.sources.forEach((s, i) => {
        const m = moteur.sources.get(s.id);
        if (m) this.capteur(m.bus, "piste" + (i + 1) + "_" + s.nom.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_"));
      });
    }
    this.actif = true;
    this.debut = audio.ctx.currentTime;
    bus.emettre("enregistrement", true);
  },

  arreter() {
    if (!this.actif) return;
    this.actif = false;
    const sr = audio.ctx.sampleRate;
    this.resultat = this.prises.map(p => {
      if (p.noeud.port) p.noeud.port.postMessage(false);
      try { p.source.disconnect(p.noeud); } catch (e) { /* ignore */ }
      p.noeud.disconnect(); p.muet.disconnect();
      return { nom: p.nom, blob: encoderWav(p.morceaux, sr, this.options.bits), duree: p.morceaux.reduce((n, m) => n + m[0].length, 0) / sr };
    });
    this.prises = [];
    bus.emettre("enregistrement", false);
    notifier("Enregistrement prêt : " + this.resultat[0].duree.toFixed(1) + " s — clique sur Exporter.");
  },

  annuler() {
    if (this.actif) { this.prises.forEach(p => { try { p.noeud.disconnect(); } catch (e) { /* ignore */ } }); }
    this.actif = false; this.prises = [];
  },

  exporter() {
    if (!this.resultat) return;
    const d = new Date(), z = n => String(n).padStart(2, "0");
    const base = `motion_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
    this.resultat.forEach((r, i) => setTimeout(() => telecharger(base + "_" + r.nom + ".wav", r.blob), i * 350));
  },

  duree() { return this.actif ? audio.ctx.currentTime - this.debut : 0; },
};

function encoderWav(morceaux, sr, bits) {
  const n = morceaux.reduce((t, m) => t + m[0].length, 0);
  const oct = bits / 8, flottant = bits === 32;
  const buf = new ArrayBuffer(44 + n * 2 * oct), v = new DataView(buf);
  const ecr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ecr(0, "RIFF"); v.setUint32(4, 36 + n * 2 * oct, true); ecr(8, "WAVE");
  ecr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, flottant ? 3 : 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2 * oct, true); v.setUint16(32, 2 * oct, true); v.setUint16(34, bits, true);
  ecr(36, "data"); v.setUint32(40, n * 2 * oct, true);
  let o = 44;
  for (const [g, d] of morceaux) {
    for (let i = 0; i < g.length; i++) {
      for (const x of [g[i], d[i]]) {
        if (flottant) { v.setFloat32(o, x, true); o += 4; continue; }
        const c = borne(x, -1, 1);
        if (bits === 16) { v.setInt16(o, c < 0 ? c * 0x8000 : c * 0x7fff, true); o += 2; }
        else {
          const k = Math.round(c < 0 ? c * 0x800000 : c * 0x7fffff);
          v.setUint8(o, k & 255); v.setUint8(o + 1, (k >> 8) & 255); v.setUint8(o + 2, (k >> 16) & 255); o += 3;
        }
      }
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
