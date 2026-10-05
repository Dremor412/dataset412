"use strict";
/* ------------------------------------------------------------------ *
 *  Onglet Ecoute : plusieurs points d'ecoute, panoramique stereo ou   *
 *  un canal par sortie (multicanal). Reglages gardes dans le script   *
 *  (~sortie @outN pan p gain dB canal c), ignores par Max.            *
 * ------------------------------------------------------------------ */

Object.assign(app, {

  _brancheEcoute() {
    $("btn-ecouter-sel").addEventListener("click", () => {
      const d = this.desc, sel = [...this.vue.multi].filter(i => d && i < d.nbNoeuds + d.nbProxies &&
        !(i < d.nbNoeuds && (d.etat[i] === ENTREE || d.plancher.includes(i))));
      if (!sel.length) { this.statut("choisis d'abord des points dans la vue (Maj+clic, ou cadre en mode Éditer)"); return; }
      this.ecouterPoints(sel);
    });
    document.querySelectorAll("input[name=mode-canaux]").forEach(r => r.addEventListener("change", () => this._modeCanaux()));
  },

  _modeCanaux() {
    const multi = document.querySelector("input[name=mode-canaux]:checked").value === "multi";
    const n = multi ? Math.max(this.modele ? this.modele.sorties.length : 2, 2) : 2;
    const obtenu = son.configurerCanaux(multi, n);
    if (son.actif) {                       // nouveau noeud audio : on lui redonne tout
      this._envoieVolume(); this._envoieModeleSon(false); this._appliqueArchet();
    }
    $("info-canaux").textContent = son.ctx
      ? (multi ? `${obtenu} canal(aux) utilisés sur ${son.maxCanaux} disponibles` : "")
      : (multi ? "le nombre de canaux de ta carte son sera lu au démarrage du son" : "");
    this.majEcoute();
  },

  /* routage effectif des sorties (comme dans le moteur) */
  _sortiesRoutees() {
    if (!this.desc) return [];
    return this.desc.sorties.map(s => ({ ...s }));
  },

  majEcoute() {
    const zone = $("liste-sorties");
    if (!zone || !this.modele) return;
    zone.innerHTML = "";
    const multi = son.multi;
    const sorties = this._sortiesRoutees();
    if (!sorties.length) {
      zone.innerHTML = `<p class="aide">Aucune sortie : le son vient de deux masses prises au hasard. Choisis des points et clique « Écouter ».</p>`;
      return;
    }
    const nCanaux = multi ? son.nCanaux : 2;
    sorties.forEach((s, k) => {
      const mdlS = this.modele.sorties.find(o => o.nom === s.nom);
      const row = document.createElement("div");
      row.className = "sortie";
      const nom = document.createElement("b"); nom.textContent = s.nom;
      const cible = document.createElement("span"); cible.className = "cible";
      cible.textContent = refTexte(mdlS.cible) + (s.genre === "frcOutput" ? " (force)" : "");
      cible.title = `${s.genre === "frcOutput" ? "force" : "position"} de ${refTexte(mdlS.cible)}`;
      let reglage;
      if (multi) {
        reglage = document.createElement("select");
        for (let c = 1; c <= Math.max(nCanaux, s.canal); c++) {
          const o = document.createElement("option"); o.value = c; o.textContent = `canal ${c}`; reglage.appendChild(o);
        }
        reglage.value = s.canal;
        reglage.addEventListener("change", () => this.changerRoutage(s.nom, { canal: +reglage.value }));
      } else {
        reglage = document.createElement("input");
        reglage.type = "range"; reglage.min = -1; reglage.max = 1; reglage.step = 0.05; reglage.value = s.pan;
        reglage.title = "panoramique : gauche ← → droite";
        reglage.addEventListener("input", () => this.changerRoutage(s.nom, { pan: +reglage.value }));
      }
      const gain = document.createElement("input");
      gain.type = "number"; gain.step = 1; gain.value = s.gain; gain.title = "gain en dB";
      gain.addEventListener("change", () => this.changerRoutage(s.nom, { gain: +gain.value }));
      const muet = document.createElement("button");
      muet.textContent = "M"; muet.title = "couper cette sortie"; muet.className = s.muet ? "on" : "";
      muet.addEventListener("click", () => this.changerRoutage(s.nom, { muet: !s.muet }, true));
      const suppr = document.createElement("button");
      suppr.textContent = "✕"; suppr.title = "supprimer cette sortie";
      suppr.addEventListener("click", () => this.modifierTexte(supprimerElement($("editeur").value, s.nom).texte));
      // montrer le point dans la vue au survol
      row.addEventListener("mouseenter", () => { this.vue.choisir(s.i); });
      row.append(nom, cible, reglage, gain, muet, suppr);
      zone.appendChild(row);
    });
  },

  /* ajoute des ecoutes puis repartit TOUTES les sorties de gauche a droite */
  ecouterPoints(indices) {
    let t = insererLignes($("editeur").value, lignesEcoutes(this.modele, this.desc, indices));
    const mdl = parse(t), n = mdl.sorties.length;
    mdl.sorties.forEach((s, k) => {
      const r = mdl.routage.get(s.nom) || { gain: 0, muet: false, canal: null };
      t = ecrireRoutage(t, s.nom, { ...r, pan: n > 1 ? -1 + 2 * k / (n - 1) : 0 });
    });
    this.modifierTexte(t);
    this.statut(`${indices.length} point(s) d'écoute ajouté(s) ; les ${n} sorties sont réparties de gauche à droite (onglet Écoute)`);
  },

  /* pan / gain / canal / muet : ecrit dans le script et envoye au son sans coupure */
  changerRoutage(nom, modif, reconstruire = false) {
    const s = this.desc.sorties.find(o => o.nom === nom);
    if (!s) return;
    Object.assign(s, modif);
    const r = { pan: s.pan, gain: s.gain, canal: son.multi || this.modele.routage.has(nom) && this.modele.routage.get(nom).canal ? s.canal : null, muet: s.muet };
    $("editeur").value = ecrireRoutage($("editeur").value, nom, r);
    this.modele.routage.set(nom, r);
    son.envoyer({ type: "routage", sorties: this.desc.sorties.map(o => ({ pan: o.pan, gain: o.gain, canal: o.canal, muet: o.muet })) });
    if (reconstruire) this.majEcoute();
  },
});
