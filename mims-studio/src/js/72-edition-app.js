"use strict";
/* ------------------------------------------------------------------ *
 *  Mode Editer et inspecteur : placer, deplacer, relier, tracer,      *
 *  supprimer, coordonnees exactes, selection multiple.                *
 * ------------------------------------------------------------------ */

Object.assign(app, {

  _brancheEdition() {
    $("btn-mode-jeu").addEventListener("click", () => this.modeEdition(false));
    $("btn-mode-edit").addEventListener("click", () => this.modeEdition(true));
    document.querySelectorAll("#outils-edition .outil").forEach(b =>
      b.addEventListener("click", () => this.choisirOutil(b.dataset.outil)));
    $("plan-z").addEventListener("change", () => { this.vue.planZ = +$("plan-z").value || 0; this.vue.redessiner(); });
    $("chk-grille").addEventListener("change", () => { this.vue.pas = $("chk-grille").checked ? 0.5 : 0; });
    $("btn-annuler").addEventListener("click", () => this.annuler());
    $("btn-refaire").addEventListener("click", () => this.refaire());

    document.addEventListener("keydown", e => {
      const saisie = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName) || document.querySelector("dialog[open]");
      if (saisie) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) this.refaire(); else this.annuler(); return; }
      if (mod && k === "y") { e.preventDefault(); this.refaire(); return; }
      if (e.key === "Tab") { e.preventDefault(); this.modeEdition(!this.vue.edition); return; }
      if (!this.vue.edition || mod) return;
      const outils = { v: "selection", m: "mass", o: "osc", f: "ground", l: "relier", c: "corde", b: "membrane" };
      if (outils[k]) { this.choisirOutil(outils[k]); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.supprimerSelection(); return; }
      const fleches = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0],
                        PageUp: [0, 0, 1], PageDown: [0, 0, -1] };
      if (fleches[e.key] && this.vue.multi.size) {
        e.preventDefault();
        const p = this.vue.pas || 0.1;
        this.deplacer([...this.vue.multi], fleches[e.key].map(v => v * p * (e.shiftKey ? 5 : 1)));
      }
    });
  },

  modeEdition(on) {
    this.vue.edition = on;
    this.vue._apercu = null; this.vue._relierDepuis = -1;
    $("btn-mode-jeu").classList.toggle("actif", !on);
    $("btn-mode-edit").classList.toggle("actif", on);
    $("outils-edition").hidden = !on;
    $("vue3d").style.cursor = on ? "default" : "grab";
    if (on) this.choisirOutil(this.vue.outil);
    this.statut(on
      ? "Éditer : glisse les flèches X Y Z pour déplacer, cadre pour sélectionner, clic droit pour tourner, Suppr pour effacer · Tab = Jouer"
      : `${statsModele(this.modele)} · Tab = Éditer`);
    this.majInspecteur();
    this.vue.redessiner();
    tuto.verifier();
  },

  choisirOutil(o) {
    this.vue.outil = o;
    this.vue._apercu = null; this.vue._relierDepuis = -1;
    document.querySelectorAll("#outils-edition .outil").forEach(b => b.classList.toggle("actif", b.dataset.outil === o));
    const aide = {
      selection: "clic = choisir, Maj+clic = ajouter, glisser dans le vide = cadre ; flèches X Y Z (ou glisser un point) = déplacer ; flèches du clavier = pas à pas, PgUp/PgDn = hauteur",
      mass: "clic sur le plan de travail = poser une masse libre (il faudra la relier)",
      osc: "clic sur le plan de travail = poser un oscillateur (il vibre seul autour de sa position)",
      ground: "clic sur le plan de travail = poser un point fixe (pour accrocher des ressorts)",
      relier: "clic sur un point puis sur un autre = ressort ; Maj pour enchaîner les liens",
      corde: "glisse d'un bout à l'autre sur le plan de travail : corde intégrée mi-gen",
      membrane: "glisse un rectangle sur le plan de travail : membrane intégrée mi-gen (bords fixes)",
    }[o];
    this.statut(`Outil : ${aide}`);
    this.vue.redessiner();
  },

  /* ---------------- gestes -> script ---------------- */

  deplacer(ids, dv) {
    const d = this.desc, masses = new Map(), macros = new Map();
    const geo = geometrieActuelle(this.modele, d);
    for (const i of ids) {
      if (i >= d.nbNoeuds || d.plancher.includes(i)) continue;
      const el = d.element[i];
      if (el !== d.noms[i]) {
        if (!macros.has(el)) { const p = geo.macros.get(el); macros.set(el, p.map((v, k) => v + dv[k % 3])); }
      } else if (!masses.has(el)) masses.set(el, geo.masses.get(el).map((v, k) => v + dv[k]));
    }
    if (!masses.size && !macros.size) { this.vue.charger(d, true); return; }
    this.modifierTexte(ecrireGeometrie($("editeur").value, this.modele, d, { masses, macros }));
    this.statut(`déplacé de ${dv.map(v => v.toFixed(2)).join(", ")}`);
  },

  /* coordonnees tapees dans l'inspecteur */
  placerExactement(el, valeurs) {
    const d = this.desc, masses = new Map(), macros = new Map();
    if (this.modele.macros.has(el)) macros.set(el, valeurs); else masses.set(el, valeurs);
    this.modifierTexte(ecrireGeometrie($("editeur").value, this.modele, d, { masses, macros }));
  },

  creer(outil, p0, p1) {
    if (!this.modele) return;
    let r;
    if (outil === "corde") r = lignesCorde(this.modele, p0, p1);
    else if (outil === "membrane") r = lignesMembrane(this.modele, p0, p1);
    else r = ajouterPoint(this.modele, outil, p0);
    this.ajouterLignes(r.ajout);
    // selectionne ce qu'on vient de creer
    const i = this.desc.noms.findIndex((n, k) => this.desc.element[k] === r.nom);
    if (i >= 0) this.vue.choisir(i);
    this.statut(`ajouté : @${r.nom}` + (outil === "mass" ? " — relie-la (outil ╱) sinon elle flotte" : ""));
  },

  supprimerSelection() {
    const d = this.desc;
    const elements = new Set([...this.vue.multi].filter(i => i < d.nbNoeuds && !d.plancher.includes(i)).map(i => d.element[i]));
    if (!elements.size) return;
    let texte = $("editeur").value, n = 0;
    for (const el of elements) { const r = supprimerElement(texte, el); texte = r.texte; n += r.retires.length; }
    this.vue.choisir(-1);
    this.modifierTexte(texte);
    this.statut(`supprimé : ${[...elements].map(e => "@" + e).join(" ")} (${n} lignes) — Ctrl+Z pour annuler`);
  },

  /* ---------------- inspecteur ---------------- */

  majInspecteur() {
    const insp = $("inspecteur"), d = this.desc, vue = this.vue;
    const sel = [...vue.multi].filter(i => d && i < d.nbNoeuds + d.nbProxies);
    if (!d || !sel.length) { insp.hidden = true; return; }
    insp.hidden = false;
    const zone = $("insp-actions"), coords = $("insp-coords");
    zone.innerHTML = ""; coords.innerHTML = ""; $("insp-aide").textContent = "";
    const bouton = (texte, aide, action) => {
      const b = document.createElement("button");
      b.className = "btn"; b.textContent = texte; b.title = aide;
      b.addEventListener("click", action);
      zone.appendChild(b);
    };
    const sep = () => { const s = document.createElement("span"); s.className = "sep"; zone.appendChild(s); };

    if (sel.length > 1) {                                 // ---- plusieurs points
      $("insp-titre").textContent = `${sel.length} points sélectionnés`;
      $("insp-sous").textContent = sel.slice(0, 4).map(i => this._descriptionPoint(i)[0]).join(", ") + (sel.length > 4 ? "…" : "");
      bouton(`🎧 Écouter ces ${sel.length} points`, "une sortie par point, réparties de gauche à droite (stéréo)", () => {
        this.ecouterPoints(sel);
        this.onglet("ecoute");
      });
      if (sel.length === 2) bouton("╱ Relier", "ressort + amortisseur entre les deux points", () =>
        this.ajouterLignes(lignesLien(this.modele, d, sel[0], sel[1])));
      else bouton("╱ Relier en chaîne", "un ressort entre chaque point et le suivant", () => {
        let t = $("editeur").value, mdl = this.modele;
        for (let k = 0; k + 1 < sel.length; k++) { t = insererLignes(t, lignesLien(mdl, d, sel[k], sel[k + 1])); mdl = parse(t); }
        this.modifierTexte(t);
      });
      sep();
      bouton("⚡ Impulsion", "coup sur chacun de ces points", () => sel.forEach(i => this.frapper(i)));
      if (vue.edition) bouton("🗑 Supprimer", "supprime les éléments choisis (Suppr)", () => this.supprimerSelection());
      return;
    }

    const i = sel[0];                                     // ---- un seul point
    const [titre, sous] = this._descriptionPoint(i);
    $("insp-titre").textContent = titre;
    $("insp-sous").textContent = sous;
    const entree = i < d.nbNoeuds && d.etat[i] === ENTREE;
    const el = i < d.nbNoeuds ? d.element[i] : null;

    if (vue.edition && el) {                              // coordonnees exactes
      const mc = this.modele.macros.has(el);
      const geo = geometrieActuelle(this.modele, d);
      const v = mc ? geo.macros.get(el) : geo.masses.get(el);
      const lab = document.createElement("span");
      lab.textContent = mc ? `@${el} : début (x y z) puis fin (x y z)` : `@${el} : position x y z`;
      coords.appendChild(lab);
      const champs = v.map((c, k) => {
        const inp = document.createElement("input");
        inp.type = "number"; inp.step = "0.5"; inp.value = c.toFixed(2); inp.title = ["x", "y", "z"][k % 3];
        inp.addEventListener("change", () => this.placerExactement(el, champs.map(f => +f.value)));
        coords.appendChild(inp);
        return inp;
      });
    }

    if (entree) {
      const archet = this._entreesArchet().has(i);
      $("insp-aide").textContent = archet
        ? "Archet : il frotte quand il bouge. Monte le curseur 🎻 archet (en bas) pour un frottement continu, ou attrape la bille et bouge-la."
        : "Entrée de position : attrape la bille (mode Jouer) et glisse verticalement.";
    } else {
      for (const [mode, ex] of Object.entries(EXCITATIONS))
        bouton(ex.titre, ex.desc, () => {
          this.ajouterLignes(lignesExcitation(this.modele, d, i, mode));
          if (mode === "frotter") {
            this.archet = 0.4; $("sld-archet").value = 0.4; $("val-archet").textContent = "0.40";
            this._appliqueArchet();
            this.statut("archet ajouté : il frotte déjà (vitesse 0.4) — règle 🎻 archet en bas, 0 pour l'arrêter");
          }
        });
      bouton("🎧 Écouter", "ajoute une sortie sur ce point", () => {
        this.ecouterPoints([i]);
      });
      sep();
    }
    bouton("⚡ Impulsion", "coup immédiat sur ce point (rien n'est ajouté au modèle)", () => this.frapper(i));
    if (el && !d.plancher.includes(i))
      bouton(`🗑 @${el}`, "supprime l'élément et tout ce qui s'y rattache (Ctrl+Z pour annuler)", () => {
        const r = supprimerElement($("editeur").value, el);
        vue.choisir(-1);
        this.modifierTexte(r.texte);
        this.statut(`supprimé : ${r.retires.length} ligne(s) — Ctrl+Z pour annuler`);
      });
    if (!vue.edition && !entree)
      $("insp-aide").textContent = "Maj+clic sur d'autres points pour les écouter ensemble (stéréo) ou les relier. Tab = mode Éditer pour déplacer.";
  },
});
