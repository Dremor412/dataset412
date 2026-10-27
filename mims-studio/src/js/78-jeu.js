"use strict";
/* ------------------------------------------------------------------ *
 *  Options de jeu : fluidite (glissement des reglages et de la        *
 *  bille), frappe aleatoire (force, point), repetition (BPM),         *
 *  anti-craquements (coupe-bas, latence). Memorisees dans le          *
 *  navigateur.                                                        *
 * ------------------------------------------------------------------ */

Object.assign(app, {
  options: { fluidite: 40, alea: 0, hasard: false, repeter: false, bpm: 120, coupeBas: 30, latence: "interactive" },

  _brancheJeu() {
    try { Object.assign(this.options, JSON.parse(localStorage.getItem("migen-options") || "{}")); } catch (e) { /* defaut */ }
    const o = this.options;
    $("opt-fluidite").value = o.fluidite; $("opt-alea").value = o.alea; $("opt-hasard").checked = o.hasard;
    $("opt-repeter").checked = o.repeter; $("opt-bpm").value = o.bpm; $("opt-coupebas").value = o.coupeBas;
    $("opt-latence").value = o.latence; son.latence = o.latence;
    const lit = () => {
      o.fluidite = +$("opt-fluidite").value; o.alea = +$("opt-alea").value; o.hasard = $("opt-hasard").checked;
      o.repeter = $("opt-repeter").checked; o.bpm = Math.min(Math.max(+$("opt-bpm").value || 120, 10), 1200);
      o.coupeBas = +$("opt-coupebas").value;
      $("val-fluidite").textContent = `${o.fluidite} ms`; $("val-alea").textContent = `${o.alea} %`;
      $("val-coupebas").textContent = `${o.coupeBas} Hz`;
      try { localStorage.setItem("migen-options", JSON.stringify(o)); } catch (e) { /* rien */ }
      this._envoieOptions();
      this._majRepetition();
    };
    for (const id of ["opt-fluidite", "opt-alea", "opt-hasard", "opt-repeter", "opt-bpm", "opt-coupebas"])
      $(id).addEventListener("input", lit);
    $("opt-latence").addEventListener("change", async () => {
      o.latence = $("opt-latence").value; lit();
      if (await son.changerLatence(o.latence)) {          // le son tournait : on lui redonne tout
        if (son.multi) this._modeCanaux();
        this._envoieVolume(); this._envoieOptions(); this._envoieModeleSon(false); this._appliqueArchet();
        this.statut(`latence ${$("opt-latence").selectedOptions[0].textContent} — son relancé`);
      }
    });
    $("btn-options").addEventListener("click", e => { e.stopPropagation(); $("options-jeu").hidden = !$("options-jeu").hidden; });
    document.addEventListener("click", e => { if (!$("options-jeu").contains(e.target) && e.target.id !== "btn-options") $("options-jeu").hidden = true; });
    $("btn-memoriser").addEventListener("click", () => this.memoriserEtat());
    lit();
  },

  _envoieOptions() {
    son.envoyer({ type: "options", fluidite: this.options.fluidite, coupeBas: this.options.coupeBas });
    if (this.sim) this.sim.lissage = 1 - Math.exp(-1 / (Math.max(this.options.fluidite, 2) * 44.1));
  },

  _majRepetition() {
    clearInterval(this._idRepetition);
    this._idRepetition = null;
    if (!this.options.repeter) { $("btn-frapper").classList.remove("actif"); return; }
    $("btn-frapper").classList.add("actif");
    this._idRepetition = setInterval(() => { if (son.actif || this.anime) this.frapper(); }, 60000 / this.options.bpm);
  },

  /* frappe, avec force aleatoire et point au hasard en option */
  frapper(cible = null) {
    if (!this.desc) return;
    this._assureSimulation();
    const o = this.options;
    let force = +$("sld-force").value;
    if (o.alea > 0) force *= Math.max(0, 1 + (o.alea / 100) * (2 * Math.random() - 1));
    const d = this.desc;
    if (cible === null && d.entrees.length) {
      if (son.actif) son.envoyer({ type: "pousser", force });
      else if (this.sim) this.sim.pousser(force, 30);
      return;
    }
    const virtuel = new Set(d.virtuel || []), vibrants = new Set(d.vibrants || []);
    const frappable = k => k >= d.nbNoeuds || (k >= 0 && ((d.etat[k] === MOBILE && !virtuel.has(k)) || vibrants.has(k)));
    let i = cible !== null ? cible : this.vue.selection;
    if (cible === null && o.hasard) {
      const mobiles = [];
      for (let k = 0; k < d.nbNoeuds; k++) if (frappable(k)) mobiles.push(k);
      if (mobiles.length) i = mobiles[Math.floor(Math.random() * mobiles.length)];
    }
    if (!frappable(i)) {
      i = -1;
      for (let k = 0; k < d.nbNoeuds; k++) if (frappable(k) && (i < 0 || d.gz[k] > d.gz[i])) i = k;
    }
    if (i < 0) return;
    if (son.actif) son.envoyer({ type: "frapper", i, force });
    else if (this.sim) this.sim.frapper(i, force);
  },
});
