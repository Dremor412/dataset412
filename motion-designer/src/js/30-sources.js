/* Lecture des sources : modes de lecture, enveloppe ADSR, chaine d'effets
 * de piste, puis spatialisation (distance, absorption de l'air, panoramique,
 * Doppler) par rapport a l'auditeur. */
"use strict";

const C_SON = 343, METRES_PAR_UNITE = 10;

class MoteurSource {
  constructor(s) {
    const ctx = audio.ctx;
    this.id = s.id;
    this.voix = new Set();
    this.actif = false;          // en train de jouer (ou de declencher)
    this.tenu = 0;               // compteur de "maintiens" (glisser, MIDI, bouton)
    this.prochain = 0;
    this.doppler = 1;
    this.distPrec = null;
    this.entree = ctx.createGain();
    this.modules = FX_PISTE.map(t => creerModule(ctx, t));
    this.vol = ctx.createGain();
    this.dist = ctx.createGain();
    this.air = ctx.createBiquadFilter(); this.air.type = "lowpass"; this.air.frequency.value = 20000;
    this.pan = ctx.createStereoPanner();
    this.bus = ctx.createGain();
    this.vol.connect(this.dist).connect(this.air).connect(this.pan).connect(this.bus).connect(audio.master.entree);
    this.appliquer(s);
  }

  module(type) { return this.modules.find(m => m.type === type); }

  appliquer(s) {
    s.fx.forEach(fx => this.module(fx.type).appliquerTout(fx));
    chainer(this.entree, s.fx.map(fx => this.module(fx.type)), this.vol);
    lisser(this.vol.gain, dbVersGain(mod.val("s:" + s.id + ":volume", s.volume)));
    this.majAudible(s);
  }

  majAudible(s) {
    const solo = etat.sources.some(x => x.solo);
    const ok = !s.mute && (!solo || s.solo);
    lisser(this.bus.gain, ok ? 1 : 0, 0.01);
  }

  vitesseLecture(s) {
    const p = s.fx.find(f => f.type === "pitch");
    let demi = p.on ? mod.val("s:" + s.id + ":fx:pitch:demi", p.params.demi) : 0;
    const mp = etat.master.fx.find(f => f.type === "pitch");
    if (mp.on) demi += mod.val("m:fx:pitch:demi", mp.params.demi);
    return Math.pow(2, demi / 12) * this.doppler;
  }

  /* --- declenchement --- */
  jouer(s, velocite = 1) {
    const t = tampons.get(s.id);
    if (!t || !audio.ctx) return;
    this.velocite = velocite;
    if (s.mode === "periodique") {
      if (!this.actif) this.prochain = audio.ctx.currentTime;
      this.actif = true;
      return;
    }
    if (this.actif && s.mode !== "oneshot") return;
    this.actif = true;
    this.lancerVoix(s, t);
    bus.emettre("lecture", s.id, true);
  }

  lancerVoix(s, t) {
    const ctx = audio.ctx, now = ctx.currentTime;
    const D = t.buf.duration;
    const a = s.region[0] * D, b = Math.max(a + 0.005, s.region[1] * D);
    const dep = borne(s.depart * D, a, b - 0.002);
    const g = ctx.createGain();
    const env = {};
    for (const k in s.env) env[k] = mod.val("s:" + s.id + ":env:" + k, s.env[k]);
    const pic = this.velocite;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(pic, now + Math.max(0.003, env.a));
    g.gain.setTargetAtTime(pic * env.s / 100, now + Math.max(0.003, env.a), Math.max(0.001, env.d / 3));
    g.connect(this.entree);
    const v = { g, src: null, fin: false, mode: s.mode };
    const rate = this.vitesseLecture(s);

    const demarrer = (buffer, debut, duree, boucle) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      src.connect(g);
      if (boucle) { src.loop = true; src.loopStart = a; src.loopEnd = b; src.start(ctx.currentTime, debut); }
      else src.start(ctx.currentTime, debut, duree);
      v.src = src;
      return src;
    };

    if (s.mode === "loop") {
      demarrer(t.buf, dep, 0, true);
    } else if (s.mode === "pingpong") {
      let sens = 1;
      const suivant = () => {
        if (v.fin) return;
        const src = sens > 0
          ? demarrer(t.buf, v.src ? a : dep, b - (v.src ? a : dep))
          : demarrer(t.inv, D - b, b - a);
        sens = -sens;
        src.onended = suivant;
      };
      suivant();
    } else {
      // une fois, ou un coup du declenchement periodique
      demarrer(t.buf, dep, b - dep).onended = () => {
        if (v.fin) return;
        this.finirVoix(v, 0.005);
        if (s.mode === "oneshot" && this.voix.size === 0 && !this.tenu) {
          this.actif = false; bus.emettre("lecture", s.id, false);
        }
      };
    }
    this.voix.add(v);
  }

  finirVoix(v, rel) {
    if (v.fin && !v.src) return;
    v.fin = true;
    const now = audio.ctx.currentTime;
    v.g.gain.cancelScheduledValues(now);
    v.g.gain.setValueAtTime(v.g.gain.value, now);
    v.g.gain.setTargetAtTime(0, now, Math.max(0.002, rel / 4));
    const src = v.src;
    if (src) { src.onended = null; try { src.stop(now + rel + 0.05); } catch (e) { /* deja arrete */ } }
    setTimeout(() => v.g.disconnect(), (rel + 0.2) * 1000);
    v.src = null;
    this.voix.delete(v);
  }

  relacher(s, immediat) {
    const rel = immediat ? 0.01 : mod.val("s:" + s.id + ":env:r", s.env.r);
    [...this.voix].forEach(v => this.finirVoix(v, rel));
    if (this.actif) { this.actif = false; bus.emettre("lecture", s.id, false); }
    this.tenu = 0;
  }

  /* --- mise a jour periodique : spatialisation, Doppler, declenchements --- */
  tick(s, dt) {
    const ctx = audio.ctx, ch = etat.champ;
    const pos = champ.positionLissee(s.id) || s, aud = champ.auditeurLisse();
    const dx = pos.x - aud.x, dy = pos.y - aud.y;
    const d = Math.hypot(dx, dy);
    const portee = mod.val("c:portee", ch.portee) / 100 * 1.6;
    const lp = mod.val("c:lissagePan", ch.lissagePan) / 100;
    const tauPan = 0.004 + lp * lp * 0.35;

    // niveau et absorption de l'air
    let g = 1, fc = 20000;
    if (ch.distance) {
      const r = borne(d / portee, 0, 1);
      g = Math.pow(1 - r, 1.6);
      fc = 20000 * Math.pow(2, -5 * r);
    }
    const ang = Math.atan2(dx, dy);
    if (d > 0.02) fc *= 1 - 0.45 * Math.max(0, -Math.cos(ang));   // derriere : plus sourd
    lisser(this.dist.gain, g, tauPan);
    lisser(this.air.frequency, borne(fc, 200, 20000), tauPan);
    const panCible = d < 0.02 ? 0 : borne(Math.sin(ang) * Math.min(1, d / 0.12), -1, 1);
    lisser(this.pan.pan, panCible, tauPan);

    // Doppler : vitesse radiale (m/s), facteur c / (c + v)
    if (this.distPrec !== null && dt > 0) {
      const vr = (d - this.distPrec) / dt * METRES_PAR_UNITE;
      const k = mod.val("c:doppler", ch.doppler) / 100;
      const cible = borne(C_SON / (C_SON + vr * k), 0.5, 2);
      this.doppler += (cible - this.doppler) * Math.min(1, dt * 12);
    }
    this.distPrec = d;
    this.vitesseRel = champ.vitesseRelative(s.id);

    const rate = this.vitesseLecture(s);
    this.voix.forEach(v => v.src && v.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.03));

    if (this.actif && s.mode === "periodique" && tampons.has(s.id)) {
      const per = mod.val("s:" + s.id + ":periode", s.periode);
      while (this.prochain <= ctx.currentTime + 0.03) {
        this.lancerVoix(s, tampons.get(s.id));
        bus.emettre("lecture", s.id, true);
        this.prochain += per;
        if (this.prochain < ctx.currentTime) this.prochain = ctx.currentTime + per;
      }
    }
  }

  detruire() {
    [...this.voix].forEach(v => this.finirVoix(v, 0.01));
    this.modules.forEach(m => m.detruire());
    if (this.sortieMulti) this.sortieMulti.disconnect();
    this.bus.disconnect();
  }
}

/* Tampons audio (independants du contexte, survivent a l'annulation) */
const tampons = new Map();

async function decoderAudio(octets) {
  const ctx = audio.ctx || new OfflineAudioContext(2, 1, 44100);
  const buf = await ctx.decodeAudioData(octets.slice(0));
  const inv = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) inv.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
  return { buf, inv, octets, pics: calculerPics(buf, 600) };
}

function calculerPics(buf, n) {
  const d = buf.getChannelData(0), d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d;
  const pics = new Float32Array(n), pas = d.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = Math.floor(i * pas), f = Math.floor((i + 1) * pas); k < f; k++) m = Math.max(m, Math.abs(d[k]), Math.abs(d2[k]));
    pics[i] = m;
  }
  return pics;
}

const moteur = {
  sources: new Map(),
  tempsLecture: 0,

  /* Aligne les moteurs sur l'etat (apres ajout, suppression, annulation...) */
  synchroniser() {
    if (!audio.ctx) return;
    const ids = new Set(etat.sources.map(s => s.id));
    this.sources.forEach((m, id) => { if (!ids.has(id)) { m.detruire(); this.sources.delete(id); } });
    let nouveau = false;
    etat.sources.forEach(s => {
      if (!this.sources.has(s.id)) { this.sources.set(s.id, new MoteurSource(s)); nouveau = true; }
      else this.sources.get(s.id).appliquer(s);
    });
    audio.appliquerMaster();
    if (nouveau || audio.sortie.mode === "multi") audio.router();
  },

  source(id) { return etat.sources.find(s => s.id === id); },

  jouer(id, velocite) {
    const s = this.source(id), m = this.sources.get(id);
    if (s && m) m.jouer(s, velocite);
  },
  relacher(id, immediat) {
    const s = this.source(id), m = this.sources.get(id);
    if (s && m) m.relacher(s, immediat);
  },
  basculer(id) {
    const m = this.sources.get(id);
    if (!m) return;
    if (m.actif) this.relacher(id); else this.jouer(id);
  },
  /* "maintien" : la source joue tant qu'on la tient (glisser, note MIDI) */
  tenir(id, velocite) {
    const m = this.sources.get(id); if (!m) return;
    if (!m.actif) { this.jouer(id, velocite); m.parMaintien = true; }
    m.tenu++;
  },
  lacher(id) {
    const m = this.sources.get(id); if (!m) return;
    m.tenu = Math.max(0, m.tenu - 1);
    if (!m.tenu && m.parMaintien) { m.parMaintien = false; this.relacher(id); }
  },
  jouerTout() { etat.sources.forEach(s => this.jouer(s.id)); },
  toutArreter(immediat) { etat.sources.forEach(s => this.relacher(s.id, immediat)); },
  unActif() { for (const m of this.sources.values()) if (m.actif) return true; return false; },

  tick(dt) {
    if (!audio.ctx) return;
    etat.sources.forEach(s => { const m = this.sources.get(s.id); if (m) m.tick(s, dt); });
    if (this.unActif()) this.tempsLecture += dt; else if (!enregistreur.actif) this.tempsLecture = 0;
  },
};
