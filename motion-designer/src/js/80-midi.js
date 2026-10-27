/* MIDI (Web MIDI) pour travailler avec un DAW :
 *  - recevoir : notes -> jouer les sources, CC -> n'importe quel reglage
 *    (apprentissage), Start/Stop du DAW -> lecture et enregistrement ;
 *  - envoyer : positions X/Y des sources et de l'auditeur, vitesse, et une
 *    note par source quand elle joue (pour enregistrer l'automation). */
"use strict";

const midi = {
  acces: null,
  erreur: "",
  attente: null,
  reglages: {
    entree: "toutes", sortie: "", canal: 1,
    recevoirNotes: true, noteBase: 36, noteOffArrete: true,
    transport: true, enregistrerAvecTransport: false,
    envoyerPositions: true, ccBase: 20, envoyerNotes: true,
  },
  derniersEnvois: new Map(),
  activite: 0,

  charger() {
    try { Object.assign(this.reglages, JSON.parse(localStorage.getItem("md-midi") || "{}")); } catch (e) { /* stockage indisponible */ }
  },
  sauver() {
    try { localStorage.setItem("md-midi", JSON.stringify(this.reglages)); } catch (e) { /* stockage indisponible */ }
  },

  async activer() {
    if (this.acces) return true;
    if (!navigator.requestMIDIAccess) {
      this.erreur = "Ce navigateur ne gère pas le Web MIDI (utilise Chrome ou Edge).";
      return false;
    }
    try {
      this.acces = await navigator.requestMIDIAccess({ sysex: false });
      this.acces.onstatechange = () => { this.brancher(); if (this.surPorts) this.surPorts(); };
      this.brancher();
      this.erreur = "";
      return true;
    } catch (e) {
      this.erreur = "Accès MIDI refusé : " + e.message;
      return false;
    }
  },

  entrees() { return this.acces ? [...this.acces.inputs.values()] : []; },
  sorties() { return this.acces ? [...this.acces.outputs.values()] : []; },

  brancher() {
    this.entrees().forEach(p => {
      p.onmidimessage = (this.reglages.entree === "toutes" || this.reglages.entree === p.id) ? e => this.recevoir(e.data) : null;
    });
  },

  sortie() { return this.sorties().find(p => p.id === this.reglages.sortie) || null; },

  /* --- correspondances CC -> parametre (enregistrees avec le projet) --- */
  ccPour(chemin) {
    for (const k in etat.midi) if (etat.midi[k] === chemin) return k.split(":")[1];
    return "";
  },
  apprendre(chemin) {
    this.activer().then(ok => {
      if (!ok) { notifier(this.erreur, 4000); return; }
      this.attente = chemin;
      notifier("Bouge un bouton ou un fader sur ton contrôleur (ou envoie un CC depuis le DAW)…", 4000);
    });
  },
  oublier(chemin) {
    historique.noter("MIDI");
    for (const k in etat.midi) if (etat.midi[k] === chemin) delete etat.midi[k];
    interfaceUI.rafraichir();
  },

  recevoir(d) {
    this.activite = performance.now();
    const st = d[0] & 0xf0, ch = (d[0] & 0x0f) + 1;
    const R = this.reglages;
    if (d[0] === 0xfa || d[0] === 0xfb) {          // Start / Continue
      if (R.transport) audio.demarrer().then(() => moteur.jouerTout());
      if (R.enregistrerAvecTransport) enregistreur.demarrer();
      return;
    }
    if (d[0] === 0xfc) {                             // Stop
      if (R.transport) moteur.toutArreter();
      if (R.enregistrerAvecTransport) enregistreur.arreter();
      return;
    }
    if (st === 0xb0) {
      const cle = ch + ":" + d[1];
      if (this.attente) {
        historique.noter("MIDI");
        for (const k in etat.midi) if (etat.midi[k] === this.attente) delete etat.midi[k];
        etat.midi[cle] = this.attente;
        notifier("CC " + d[1] + " (canal " + ch + ") → " + nomChemin(this.attente));
        this.attente = null;
        interfaceUI.rafraichir();
        return;
      }
      const chemin = etat.midi[cle];
      if (chemin) this.appliquerCC(chemin, d[2] / 127);
      return;
    }
    if (!R.recevoirNotes) return;
    const idx = d[1] - R.noteBase, s = etat.sources[idx];
    if (st === 0x90 && d[2] > 0) {
      if (!s) return;
      audio.demarrer().then(() => {
        if (R.noteOffArrete) moteur.tenir(s.id, d[2] / 127);
        else moteur.basculer(s.id);
      });
    } else if (st === 0x80 || (st === 0x90 && d[2] === 0)) {
      if (s && R.noteOffArrete) moteur.lacher(s.id);
    }
  },

  appliquerCC(chemin, n) {
    const r = resoudre(chemin);
    if (!r || !r.spec) return;
    r.obj[r.cle] = denorm(r.spec, n);
    appliquerAudio(chemin, mod.val(chemin, r.obj[r.cle]));
    if (/:(x|y)$/.test(chemin)) champ.dernierBouge = chemin.startsWith("a:") ? "aud" : chemin.split(":")[1];
    this.aRafraichir = true;
  },

  /* --- envoi vers le DAW --- */
  envoyerCC(cc, v) {
    const p = this.sortie(); if (!p || cc > 127) return;
    const k = this.reglages.canal + ":" + cc, val = borne(Math.round(v * 127), 0, 127);
    if (this.derniersEnvois.get(k) === val) return;
    this.derniersEnvois.set(k, val);
    p.send([0xb0 | (this.reglages.canal - 1), cc, val]);
  },
  envoyerNote(idx, on) {
    const p = this.sortie(); if (!p || !this.reglages.envoyerNotes) return;
    const n = this.reglages.noteBase + idx; if (n > 127) return;
    p.send([(on ? 0x90 : 0x80) | (this.reglages.canal - 1), n, on ? 100 : 0]);
  },

  tick() {
    if (this.aRafraichir) { this.aRafraichir = false; interfaceUI.rafraichir(); }
    if (!this.reglages.envoyerPositions || !this.sortie()) return;
    const b = this.reglages.ccBase;
    etat.sources.forEach((s, i) => {
      const p = champ.positionLissee(s.id) || s;
      this.envoyerCC(b + i * 2, (p.x + 1) / 2);
      this.envoyerCC(b + i * 2 + 1, (p.y + 1) / 2);
    });
    const a = champ.auditeurLisse();
    this.envoyerCC(102, (a.x + 1) / 2);
    this.envoyerCC(103, (a.y + 1) / 2);
    this.envoyerCC(104, mod.connecteurs.vitesse);
  },
};

bus.on("lecture", (id, on) => {
  const i = etat.sources.findIndex(s => s.id === id);
  if (i >= 0) midi.envoyerNote(i, on);
});
