/* Moteur audio : contexte, modules d'effets, bus master, sortie audio
 * (choix du peripherique, mode multipiste pour un DAW) et vu-metres. */
"use strict";

const lisser = (param, v, tau = 0.02) => {
  if (!isFinite(v)) return;
  param.setTargetAtTime(v, audio.ctx.currentTime, tau);
};

/* ---------- Modules d'effets ---------- */

function courbeTanh() {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(4 * x); }
  return c;
}

function reponseImpulsion(ctx, duree) {
  const sr = ctx.sampleRate, n = Math.max(1, Math.floor(sr * duree));
  const b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // -60 dB a "duree", petite montee initiale pour eviter le clic
      d[i] = (Math.random() * 2 - 1) * Math.pow(10, -3 * t / duree) * Math.min(1, i / (sr * 0.004));
    }
  }
  return b;
}

function creerModule(ctx, type) {
  const m = {
    type, on: false, valeurs: {},
    entree: ctx.createGain(), sortie: ctx.createGain(),
    byp: ctx.createGain(), proc: ctx.createGain(), oscs: [],
  };
  m.entree.connect(m.byp).connect(m.sortie);
  m.proc.connect(m.sortie);
  m.proc.gain.value = 0;
  const reglages = {};
  const mixer = (dry, wet, v) => { lisser(dry.gain, 1 - v / 100); lisser(wet.gain, v / 100); };

  switch (type) {
    case "pitch":
      break;

    case "filtre": {
      const f = ctx.createBiquadFilter();
      m.entree.connect(f).connect(m.proc);
      reglages.freq = v => lisser(f.frequency, v);
      reglages.q = v => lisser(f.Q, v);
      reglages.gain = v => lisser(f.gain, v);
      reglages.type = v => { f.type = v; };
      break;
    }

    case "sat": {
      const pre = ctx.createGain(), sh = ctx.createWaveShaper(), post = ctx.createGain();
      const ton = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain();
      sh.curve = courbeTanh(); sh.oversample = "4x"; ton.type = "lowpass";
      m.entree.connect(pre).connect(sh).connect(post).connect(ton).connect(wet).connect(m.proc);
      m.entree.connect(dry).connect(m.proc);
      reglages.drive = v => {
        const g = dbVersGain(v * 0.36) * 0.25;
        lisser(pre.gain, g); lisser(post.gain, Math.pow(g * 4, -0.5));
      };
      reglages.mix = v => mixer(dry, wet, v);
      reglages.ton = v => lisser(ton.frequency, v);
      break;
    }

    case "flanger": {
      const somme = ctx.createGain(), d = ctx.createDelay(0.05), fb = ctx.createGain();
      const dry = ctx.createGain(), wet = ctx.createGain(), osc = ctx.createOscillator(), og = ctx.createGain();
      m.entree.connect(somme).connect(d).connect(wet).connect(m.proc);
      d.connect(fb).connect(somme);
      m.entree.connect(dry).connect(m.proc);
      osc.connect(og).connect(d.delayTime); osc.start(); m.oscs.push(osc);
      reglages.mix = v => mixer(dry, wet, v);
      reglages.vitesse = v => lisser(osc.frequency, v);
      reglages.prof = v => { lisser(d.delayTime, 0.0005 + v / 2000); lisser(og.gain, v / 2000); };
      reglages.retour = v => lisser(fb.gain, v / 100);
      break;
    }

    case "chorus": {
      const dry = ctx.createGain(), wet = ctx.createGain(), osc = ctx.createOscillator();
      const voix = [-1, 1].map(cote => {
        const d = ctx.createDelay(0.1), og = ctx.createGain(), pan = ctx.createStereoPanner();
        pan.pan.value = cote * 0.85;
        m.entree.connect(d).connect(pan).connect(wet);
        osc.connect(og).connect(d.delayTime);
        return { d, og, cote };
      });
      wet.connect(m.proc); m.entree.connect(dry).connect(m.proc);
      osc.start(); m.oscs.push(osc);
      let delai = 18, prof = 6;
      const maj = () => voix.forEach(v => {
        lisser(v.d.delayTime, delai / 1000); lisser(v.og.gain, v.cote * prof / 2000);
      });
      reglages.mix = v => { lisser(dry.gain, 1 - v / 200); lisser(wet.gain, v / 100); };
      reglages.vitesse = v => lisser(osc.frequency, v);
      reglages.prof = v => { prof = v; maj(); };
      reglages.delai = v => { delai = v; maj(); };
      break;
    }

    case "delai": {
      const d = ctx.createDelay(2), amorti = ctx.createBiquadFilter(), fb = ctx.createGain();
      const dry = ctx.createGain(), wet = ctx.createGain();
      amorti.type = "lowpass";
      m.entree.connect(d).connect(amorti).connect(wet).connect(m.proc);
      amorti.connect(fb).connect(d);
      m.entree.connect(dry).connect(m.proc);
      reglages.mix = v => mixer(dry, wet, v);
      reglages.temps = v => lisser(d.delayTime, v / 1000, 0.06);
      reglages.retour = v => lisser(fb.gain, v / 100);
      reglages.amorti = v => lisser(amorti.frequency, v);
      break;
    }

    case "reverb": {
      const pre = ctx.createDelay(0.5), conv = ctx.createConvolver(), amorti = ctx.createBiquadFilter();
      const dry = ctx.createGain(), wet = ctx.createGain();
      amorti.type = "lowpass";
      m.entree.connect(pre).connect(conv).connect(amorti).connect(wet).connect(m.proc);
      m.entree.connect(dry).connect(m.proc);
      let minuterie = null, dureeIR = 0;
      reglages.mix = v => mixer(dry, wet, v);
      reglages.predelai = v => lisser(pre.delayTime, v / 1000);
      reglages.amorti = v => lisser(amorti.frequency, v);
      reglages.decro = v => {
        if (Math.abs(v - dureeIR) < 0.05) return;
        dureeIR = v; clearTimeout(minuterie);
        const faire = () => { conv.buffer = reponseImpulsion(ctx, v); };
        if (!conv.buffer) faire(); else minuterie = setTimeout(faire, 150);
      };
      break;
    }

    case "dyn": {
      const c = ctx.createDynamicsCompressor();
      c.knee.value = 6;
      m.entree.connect(c).connect(m.proc);
      reglages.seuil = v => lisser(c.threshold, v);
      reglages.ratio = v => lisser(c.ratio, v);
      reglages.attaque = v => lisser(c.attack, v / 1000);
      reglages.relache = v => lisser(c.release, v / 1000);
      break;
    }
  }

  m.regler = (cle, v) => { m.valeurs[cle] = v; if (reglages[cle]) reglages[cle](v); };
  m.activer = on => {
    m.on = on;
    if (type === "pitch") return;
    lisser(m.byp.gain, on ? 0 : 1, 0.01);
    lisser(m.proc.gain, on ? 1 : 0, 0.01);
  };
  m.appliquerTout = fx => {
    for (const k in fx.choix) m.regler(k, fx.choix[k]);
    for (const k in fx.params) m.regler(k, fx.params[k]);
    m.activer(fx.on);
  };
  m.detruire = () => {
    m.oscs.forEach(o => { try { o.stop(); } catch (e) { /* deja arrete */ } });
    m.entree.disconnect(); m.sortie.disconnect();
  };
  return m;
}

/* Relie une liste de modules en serie entre entree et sortie */
function chainer(entree, modules, sortie) {
  entree.disconnect();
  modules.forEach(m => m.sortie.disconnect());
  let n = entree;
  for (const m of modules) { n.connect(m.entree); n = m.sortie; }
  n.connect(sortie);
}

/* ---------- Contexte, master et sortie ---------- */

const audio = {
  ctx: null,
  options: { latence: "interactive", frequence: 0 },
  sortie: { deviceId: "", mode: "stereo", canaux: 2, voie: "contexte" },
  master: null,

  async demarrer() {
    if (this.ctx) { if (this.ctx.state !== "running") await this.ctx.resume(); return; }
    const opt = { latencyHint: this.options.latence };
    if (this.options.frequence) opt.sampleRate = this.options.frequence;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)(opt);
    this.construireMaster();
    moteur.synchroniser();
    if (this.sortie.deviceId) await this.choisirSortie(this.sortie.deviceId, true);
    this.router();
    await enregistreur.preparer();
    bus.emettre("audio-pret");
  },

  /* Recree tout le contexte (changement de latence ou de frequence) */
  async reconstruire() {
    if (!this.ctx) return;
    moteur.toutArreter(true);
    enregistreur.annuler();
    const ancien = this.ctx;
    this.ctx = null; this.master = null; moteur.sources.clear();
    if (this.elementSortie) { this.elementSortie.pause(); this.elementSortie.srcObject = null; this.elementSortie = null; }
    await ancien.close();
    await this.demarrer();
  },

  construireMaster() {
    const ctx = this.ctx, M = {};
    M.entree = ctx.createGain();
    M.volume = ctx.createGain();
    M.modules = FX_MASTER.map(t => creerModule(ctx, t));
    chainer(M.entree, M.modules, M.volume);
    M.split = ctx.createChannelSplitter(2);
    M.analyseurs = [0, 1].map(i => {
      const a = ctx.createAnalyser(); a.fftSize = 1024; M.split.connect(a, i); return a;
    });
    M.volume.connect(M.split);
    M.tampon = new Float32Array(1024);
    M.crete = [0, 0];
    this.master = M;
    this.appliquerMaster();
  },

  appliquerMaster() {
    const M = this.master; if (!M) return;
    lisser(M.volume.gain, dbVersGain(etat.master.volume));
    etat.master.fx.forEach((fx, i) => M.modules[i].appliquerTout(fx));
  },

  /* Branche le master (et les pistes en multipiste) vers la sortie */
  router() {
    const ctx = this.ctx, M = this.master; if (!ctx || !M) return;
    const dest = this.destination();
    M.volume.disconnect(); M.volume.connect(M.split);
    if (this.fusion) { this.fusion.disconnect(); this.fusion = null; }
    moteur.sources.forEach(m => {
      if (!m.sortieMulti) return;
      try { m.bus.disconnect(m.sortieMulti); } catch (e) { /* deja debranche */ }
      m.sortieMulti.disconnect(); m.sortieMulti = null;
    });

    const max = dest.maxChannelCount || 2;
    this.sortie.canauxDispo = max;
    let multi = this.sortie.mode === "multi" && max >= 4;
    const paires = Math.min(Math.floor(max / 2), 1 + etat.sources.length);
    if (multi) {
      try {
        dest.channelCount = paires * 2;
        dest.channelCountMode = "explicit";
        dest.channelInterpretation = "discrete";
      } catch (e) {
        multi = false;
        notifier("Cette sortie refuse " + paires * 2 + " canaux : retour en stéréo.", 4000);
      }
    }
    if (multi) {
      const n = paires * 2;
      const fusion = ctx.createChannelMerger(n);
      const brancher = (noeud, paire) => {
        const sp = ctx.createChannelSplitter(2);
        noeud.connect(sp);
        sp.connect(fusion, 0, paire * 2); sp.connect(fusion, 1, paire * 2 + 1);
        return sp;
      };
      brancher(M.volume, 0);
      etat.sources.forEach((s, i) => {
        const m = moteur.sources.get(s.id);
        if (m && i + 1 < paires) m.sortieMulti = brancher(m.bus, i + 1);
      });
      fusion.connect(dest);
      this.fusion = fusion;
      this.sortie.pairesActives = paires;
    } else {
      try { dest.channelCount = 2; dest.channelCountMode = "explicit"; dest.channelInterpretation = "speakers"; } catch (e) { /* ignore */ }
      M.volume.connect(dest);
      this.sortie.pairesActives = 1;
    }
    bus.emettre("sortie-changee");
  },

  destination() {
    if (this.sortie.voie === "element") {
      if (!this.fluxSortie) this.fluxSortie = this.ctx.createMediaStreamDestination();
      return this.fluxSortie;
    }
    return this.ctx.destination;
  },

  async listerSorties() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const l = await navigator.mediaDevices.enumerateDevices();
    return l.filter(d => d.kind === "audiooutput");
  },

  /* Les navigateurs cachent le nom des peripheriques tant que la page n'a pas
   * obtenu une autorisation media : on demande le micro une fois, puis on le coupe. */
  async autoriserNoms() {
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      flux.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) { return false; }
  },

  async choisirSortie(deviceId, silencieux) {
    this.sortie.deviceId = deviceId;
    if (!this.ctx) return true;
    try {
      if (typeof this.ctx.setSinkId === "function") {
        await this.ctx.setSinkId(deviceId === "default" ? "" : deviceId);
        if (this.sortie.voie !== "contexte") { this.sortie.voie = "contexte"; this.couperElement(); }
      } else {
        // Repli : contexte -> flux -> <audio> dont on choisit la sortie
        const el = this.elementSortie || (this.elementSortie = new Audio());
        if (typeof el.setSinkId !== "function") throw new Error("Ce navigateur ne permet pas de choisir la sortie audio.");
        this.sortie.voie = "element";
        el.srcObject = this.destination().stream;
        await el.setSinkId(deviceId === "default" ? "" : deviceId);
        await el.play();
      }
      this.router();
      return true;
    } catch (e) {
      if (!silencieux) notifier("Sortie impossible : " + e.message, 4000);
      return false;
    }
  },

  couperElement() {
    if (this.elementSortie) { this.elementSortie.pause(); this.elementSortie.srcObject = null; }
  },

  /* Crete par canal (dBFS) pour les vu-metres */
  cretes() {
    const M = this.master; if (!M) return [-120, -120];
    return M.analyseurs.map((a, i) => {
      a.getFloatTimeDomainData(M.tampon);
      let p = 0; for (let k = 0; k < M.tampon.length; k++) p = Math.max(p, Math.abs(M.tampon[k]));
      M.crete[i] = Math.max(p, M.crete[i] * 0.92);
      return gainVersDb(M.crete[i]);
    });
  },
};
