"use strict";
/* ------------------------------------------------------------------ *
 *  Application : onglets, construction, reglages, jeu, export         *
 * ------------------------------------------------------------------ */

const $ = id => document.getElementById(id);

const app = {
  modele: null,          // modele analyse (dernier sans erreur)
  desc: null,            // modele compile pour la vue / l'animation (sr = 44100)
  sim: null,             // simulation visuelle (sans son)
  anime: false,
  reglagesAudio: new Map(),   // valeurs des audioParam (curseurs)
  valeursInitiales: new Map(),
  archet: 0,
  fichierNom: "modele.mdl",
  _autoId: null,
  _majPhysique: false,

  init() {
    this.vue = new Vue3D($("vue3d"), {
      surSelection: () => this.majInspecteur(),
      surPlacement: (i, z) => this.placer(i, z),
      surDeplacement: (ids, dv) => this.deplacer(ids, dv),
      surCreation: (outil, p0, p1) => this.creer(outil, p0, p1),
      surRelier: (i, j) => this.ajouterLignes(lignesLien(this.modele, this.desc, i, j)),
    });
    son.surMessage = d => this._messageSon(d);
    this._construitConstruire();
    this._branche();
    this._brancheEdition();
    this._brancheEcoute();
    this._brancheSecours();
    this._brancheJeu();
    tuto.init();
    $("sld-ampli").value = 10;
    this.charger(MODELES_PRETS[0].script(), "corde-pincee.mdl");
    setTimeout(() => { budget.mesurer(); this.majJauge(); }, 300);
  },

  /* ================= chargement / compilation ================= */

  charger(texte, nom) {
    $("editeur").value = texte;
    if (nom) { this.fichierNom = nom; document.title = `mi-gen Studio — ${nom}`; }
    this.reglagesAudio = new Map();
    this.valeursInitiales = new Map();
    this._stables = null;
    this.historique.push($("editeur").value);
    this.compiler({ garderVue: false });
  },

  compiler({ garderVue = true } = {}) {
    const mdl = parse($("editeur").value);
    this._afficheProblemes(mdl);
    if (mdl.erreurs.length) {
      this.statut(`${mdl.erreurs.length} erreur(s) dans le script — onglet Script`);
      return false;
    }
    const neuf = !this.modele || !garderVue;
    this.modele = mdl;
    for (const [n, p] of mdl.params)
      if (!this.valeursInitiales.has(n)) this.valeursInitiales.set(n, p.genre === "param" ? p.valeur : 0.5);
    for (const n of [...this.reglagesAudio.keys()]) if (!mdl.params.has(n)) this.reglagesAudio.delete(n);
    this.desc = compiler(mdl, { reglages: this.reglagesAudio });
    this.vue.charger(this.desc, !neuf);
    if (this.anime) { const s = new Simulateur(this.desc); s.adopter(this.sim); this.sim = s; }
    else this.sim = null;
    if (son.actif) this._envoieModeleSon(false);
    this._appliqueArchet();
    this._construitReglages();
    if (son.multi && mdl.sorties.length !== son.nCanaux && son.ctx) this._modeCanaux();
    this.majEcoute();
    this.majInspecteur();
    this.majJauge();
    tuto.verifier();
    this.statut(`${statsModele(mdl)}`);
    $("stats-script").textContent = statsModele(mdl);
    if ($("p-export").classList.contains("actif")) this.majExport();
    return true;
  },

  /* reglage a chaud : on recompile le modele sans toucher a l'etat */
  rafraichirPhysique() {
    if (this._majPhysique) return;
    this._majPhysique = true;
    requestAnimationFrame(() => {
      this._majPhysique = false;
      if (!this.modele) return;
      this.desc = compiler(this.modele, { reglages: this.reglagesAudio });
      this.vue.charger(this.desc, true);
      if (this.anime) {
        const s = new Simulateur(this.desc);
        s.transitionDepuis(this.sim, Math.round(this.options.fluidite * 44.1));
        s.lissage = this.sim.lissage; this.sim = s;
      }
      if (son.actif) this._envoieModeleSon(true);
      this._appliqueArchet();
    });
  },

  _envoieModeleSon(garder) {
    if (!this.modele) return;
    const d = compiler(this.modele, { sr: son.frequence, reglages: this.reglagesAudio });
    son.envoyer({ type: "modele", desc: d, garder });
  },

  _afficheProblemes(mdl) {
    const c = $("console");
    c.innerHTML = "";
    const ligne = (classe, texte, lig) => {
      const div = document.createElement("div");
      div.className = classe; div.textContent = texte;
      div.addEventListener("click", () => { this.onglet("script"); this._vaLigne(lig); });
      c.appendChild(div);
    };
    for (const [l, m] of mdl.erreurs) ligne("err", `ERREUR  ligne ${l} : ${m}`, l);
    for (const [l, m] of mdl.avertissements) ligne("note", `note    ligne ${l} : ${m}`, l);
    if (mdl.erreurs.length) this.onglet("script");
  },

  _vaLigne(lig) {
    const ed = $("editeur"), lignes = ed.value.split("\n");
    let pos = 0;
    for (let i = 0; i < lig - 1 && i < lignes.length; i++) pos += lignes[i].length + 1;
    ed.focus();
    ed.setSelectionRange(pos, pos + (lignes[lig - 1] || "").length);
    const lh = parseFloat(getComputedStyle(ed).lineHeight) || 18;
    ed.scrollTop = Math.max(0, (lig - 1) * lh - ed.clientHeight / 2);
  },

  statut(t) { $("statut-texte").textContent = t; },

  onglet(nom) {
    document.querySelectorAll("#onglets button").forEach(b => b.classList.toggle("actif", b.dataset.onglet === nom));
    document.querySelectorAll(".panneau").forEach(p => p.classList.toggle("actif", p.id === "p-" + nom));
    if (nom === "export") this.majExport();
    if (typeof tuto !== "undefined") tuto.verifier();
  },

  /* ================= onglet Construire ================= */

  _construitConstruire() {
    const cartes = $("liste-modeles");
    for (const m of MODELES_PRETS) {
      const b = document.createElement("button");
      b.className = "carte";
      b.innerHTML = `<b></b><span></span>`;
      b.querySelector("b").textContent = m.titre;
      b.querySelector("span").textContent = m.desc;
      b.addEventListener("click", () => { this.charger(m.script(), `${m.id}.mdl`); this._suggereSon(); });
      cartes.appendChild(b);
    }
    const formes = $("liste-formes");
    for (const [nom, [, desc]] of Object.entries(CATALOGUE)) {
      const b = document.createElement("button");
      b.className = "puce"; b.textContent = nom; b.title = desc;
      b.addEventListener("click", () => this.dialogueForme(nom));
      formes.appendChild(b);
    }
    const briques = $("liste-briques");
    for (const [cle, br] of Object.entries(BRIQUES)) {
      const b = document.createElement("button");
      b.className = "puce"; b.textContent = "+ " + br.titre; b.title = br.desc;
      b.addEventListener("click", () => this.dialogueBrique(cle));
      briques.appendChild(b);
    }
  },

  _suggereSon() {
    if (!son.actif) this.statut(`${statsModele(this.modele)} — clique 🔈 Son pour l'entendre`);
  },

  /* formulaire generique : champs {cle: [label, defaut, min|choix, max]} */
  formulaire(titre, desc, champs, bouton, surOk) {
    $("dlg-form-titre").textContent = titre;
    $("dlg-form-desc").textContent = desc;
    const zone = $("dlg-form-champs");
    zone.innerHTML = "";
    const entrees = {};
    for (const [cle, [label, defaut, a, b]] of Object.entries(champs)) {
      const div = document.createElement("div");
      div.className = "champ";
      const span = document.createElement("span");
      span.textContent = label;
      let inp;
      if (Array.isArray(a)) {
        inp = document.createElement("select");
        for (const o of a) { const op = document.createElement("option"); op.value = op.textContent = o; inp.appendChild(op); }
        inp.value = defaut;
      } else {
        inp = document.createElement("input");
        inp.type = "number"; inp.min = a; inp.max = b; inp.value = defaut;
        inp.step = Math.abs(defaut) > 0 && Math.abs(defaut) < 1 ? "any" : 1;
      }
      entrees[cle] = inp;
      div.append(span, inp);
      zone.appendChild(div);
    }
    const go = $("dlg-form-go");
    const neuf = go.cloneNode(true);
    neuf.textContent = bouton;
    go.replaceWith(neuf);
    neuf.addEventListener("click", () => {
      const v = {};
      for (const [k, inp] of Object.entries(entrees)) v[k] = inp.tagName === "SELECT" ? inp.value : Number(inp.value);
      try { surOk(v); $("dlg-form").close(); }
      catch (e) { alert(e.message); }
    });
    $("dlg-form").showModal();
  },

  dialogueForme(nom) {
    const [, desc, schema] = CATALOGUE[nom];
    const champs = {};
    for (const [k, [label, def, mn, mx]] of Object.entries(schema)) champs[k] = [label, def, mn, mx];
    this.formulaire(`Forme 3D : ${nom}`, desc, champs, "Créer", v => {
      const [texte] = genere(nom, v);
      this.charger(texte, `${nom}.mdl`);
      this._suggereSon();
    });
  },

  dialogueBrique(cle) {
    const br = BRIQUES[cle];
    this.formulaire(`Ajouter : ${br.titre}`, br.desc, br.champs, "Ajouter", v => {
      this.ajouterLignes(br.lignes(this.modele || parse(""), v, this.vue), false);
    });
  },

  ajouterLignes(ajout, garderVue = true) {
    this.modifierTexte(insererLignes($("editeur").value, ajout), garderVue);
  },

  /* toute modification du script passe ici : historique pour Annuler / Refaire */
  historique: [],
  futur: [],
  modifierTexte(texte, garderVue = true) {
    const avant = $("editeur").value;
    if (texte === avant) return;
    this.historique.push(avant);
    if (this.historique.length > 200) this.historique.shift();
    this.futur = [];
    $("editeur").value = texte;
    this.compiler({ garderVue });
  },
  annuler() {
    if (!this.historique.length) { this.statut("rien à annuler"); return; }
    this.futur.push($("editeur").value);
    $("editeur").value = this.historique.pop();
    this.compiler();
    this.statut("annulé");
  },
  refaire() {
    if (!this.futur.length) { this.statut("rien à refaire"); return; }
    this.historique.push($("editeur").value);
    $("editeur").value = this.futur.pop();
    this.compiler();
    this.statut("refait");
  },

  /* ================= inspecteur (point selectionne) ================= */

  _descriptionPoint(i) {
    const d = this.desc;
    if (i >= d.nbNoeuds) return [`proxy ${d.proxies[i - d.nbNoeuds].ref}`, "point virtuel interpolé sur la structure"];
    const el = d.element[i];
    if (el !== d.noms[i]) {
      const mc = d.macros.find(m => m.nom === el);
      const r = referencePoint(d, i);
      const pos = r.corde ? `à ${r.a.toFixed(2)}` : `en (${r.a.toFixed(2)}, ${r.b.toFixed(2)})`;
      return [`@${el} ${pos}`, `${AIDE_TYPES[mc.genre]} · ${mc.corde ? mc.nx : mc.nx + "×" + mc.ny} masses` +
              (d.etat[i] === FIXE ? " · point fixe" : "")];
    }
    const m = this.modele.masses.get(el);
    return [`@${el}`, AIDE_TYPES[m.genre] || m.genre];
  },

  majInspecteur() {
    const insp = $("inspecteur"), d = this.desc;
    const i = this.vue.selection, j = this.vue.selection2;
    if (!d || i < 0 || i >= d.nbNoeuds + d.nbProxies) { insp.hidden = true; return; }
    insp.hidden = false;
    const [titre, sous] = this._descriptionPoint(i);
    $("insp-titre").textContent = titre;
    $("insp-sous").textContent = sous;
    const zone = $("insp-actions");
    zone.innerHTML = "";
    const bouton = (texte, titreAide, action) => {
      const b = document.createElement("button");
      b.className = "btn"; b.textContent = texte; b.title = titreAide;
      b.addEventListener("click", action);
      zone.appendChild(b);
    };
    const sep = () => { const s = document.createElement("span"); s.className = "sep"; zone.appendChild(s); };
    if (j >= 0) {
      const [t2] = this._descriptionPoint(j);
      bouton(`Relier à ${t2}`, "ressort + amortisseur entre les deux points", () => {
        this.ajouterLignes(lignesRelier(this.modele, d, i, j));
        this.vue.selection2 = -1;
      });
      sep();
    }
    const entree = i < d.nbNoeuds && d.etat[i] === ENTREE;
    if (!entree) {
      for (const [mode, ex] of Object.entries(EXCITATIONS))
        bouton(ex.titre, ex.desc, () => {
          this.ajouterLignes(lignesExcitation(this.modele, d, i, mode));
          if (mode === "frotter") { this.onglet("reglages"); this.statut("archet ajouté : règle sa vitesse dans Réglages"); }
        });
      bouton("🎧 Écouter", "ajoute une sortie (posOutput) sur ce point", () =>
        this.ajouterLignes(lignesEcoute(this.modele, d, i)));
      sep();
    }
    bouton("⚡ Impulsion", "coup immédiat sur ce point (sans rien ajouter au modèle)", () => this.frapper(i));
    if (i < d.nbNoeuds) {
      const el = d.element[i];
      bouton(`Supprimer @${el}`, "retire l'élément et tout ce qui s'y rattache", () => {
        const r = supprimerElement($("editeur").value, el);
        $("editeur").value = r.texte;
        this.vue.selection = -1; this.vue.selection2 = -1;
        this.compiler();
        this.statut(`supprimé : ${r.retires.length} ligne(s)`);
      });
    }
  },

  /* ================= onglet Reglages ================= */

  /* params servant de position sur une structure (curseur 0..1) */
  _paramsDePosition() {
    const s = new Set();
    const mdl = this.modele;
    const refs = [...mdl.interactions.flatMap(i => [i.m1, i.m2]), ...mdl.entrees.map(e => e.cible), ...mdl.sorties.map(e => e.cible)];
    for (const r of refs) if (r.macro !== undefined)
      for (const t of [r.a, r.b]) if (t) for (const n of t.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) s.add(n);
    return s;
  },

  _construitReglages() {
    const zone = $("liste-reglages");
    zone.innerHTML = "";
    const mdl = this.modele;
    if (!mdl.params.size) {
      zone.innerHTML = `<p class="aide">Ce modèle n'a pas de @param. Ajoute des lignes « @nom param valeur » dans le script et utilise ces noms comme valeurs : ils deviennent des curseurs ici.</p>`;
      return;
    }
    const positions = this._paramsDePosition();
    const groupes = { "Positions sur les structures": [], "Entrées audio (audioParam)": [], "Paramètres physiques": [] };
    for (const p of mdl.params.values()) {
      if (p.genre === "audioParam") groupes["Entrées audio (audioParam)"].push(p);
      else if (positions.has(p.nom) && p.valeur >= 0 && p.valeur <= 1) groupes["Positions sur les structures"].push(p);
      else groupes["Paramètres physiques"].push(p);
    }
    for (const [titre, liste] of Object.entries(groupes)) {
      if (!liste.length) continue;
      const g = document.createElement("div");
      g.className = "groupe-reglages";
      g.innerHTML = `<h4></h4>`;
      g.querySelector("h4").textContent = titre;
      for (const p of liste) g.appendChild(this._ligneReglage(p, titre !== "Paramètres physiques"));
      zone.appendChild(g);
    }
  },

  _ligneReglage(p, lineaire) {
    const row = document.createElement("div");
    row.className = "reglage";
    const lab = document.createElement("label");
    lab.textContent = p.nom; lab.title = p.genre === "audioParam" ? `audioParam relié à @${p.entree} dans Max` : `@${p.nom} param`;
    const sld = document.createElement("input");
    sld.type = "range"; sld.min = 0; sld.max = 1000; sld.step = 1;
    const num = document.createElement("input");
    num.type = "number"; num.step = "any";
    const raz = document.createElement("button");
    raz.className = "raz"; raz.textContent = "↺"; raz.title = "valeur de départ";
    const v0 = this.valeursInitiales.has(p.nom) ? this.valeursInitiales.get(p.nom) : p.valeur;
    const valeur = p.genre === "audioParam" ? (this.reglagesAudio.has(p.nom) ? this.reglagesAudio.get(p.nom) : 0.5) : p.valeur;
    // echelle : lineaire 0..1 pour les positions, logarithmique autour de la valeur de depart sinon
    let versCurseur, depuisCurseur;
    const libre = /^-?[\d.eE+-]+$/.test(p.brut) || p.genre === "audioParam";
    if (lineaire) {
      versCurseur = v => v * 1000; depuisCurseur = c => c / 1000;
    } else if (v0 > 0) {
      const lo = Math.log(v0 / 30), hi = Math.log(v0 * 30);
      versCurseur = v => (Math.log(Math.max(v, 1e-30)) - lo) / (hi - lo) * 1000;
      depuisCurseur = c => +Math.exp(lo + (hi - lo) * c / 1000).toPrecision(4);
    } else {
      const ampl = Math.max(Math.abs(v0) * 4, 1);
      versCurseur = v => (v + ampl) / (2 * ampl) * 1000; depuisCurseur = c => +(c / 1000 * 2 * ampl - ampl).toPrecision(4);
    }
    sld.value = versCurseur(valeur);
    num.value = +valeur.toPrecision(6);
    if (!libre) { sld.disabled = true; num.disabled = true; lab.title += ` = ${p.brut} (expression, modifiable dans le script)`; }
    const applique = v => {
      if (!Number.isFinite(v)) return;
      this.changerParam(p.nom, v);
    };
    sld.addEventListener("input", () => { const v = depuisCurseur(+sld.value); num.value = v; applique(v); });
    num.addEventListener("change", () => { const v = +num.value; sld.value = versCurseur(v); applique(v); });
    raz.addEventListener("click", () => { num.value = v0; sld.value = versCurseur(v0); applique(v0); });
    row.append(lab, sld, num, raz);
    return row;
  },

  changerParam(nom, v) {
    const p = this.modele.params.get(nom);
    if (!p) return;
    if (p.genre === "audioParam") this.reglagesAudio.set(nom, v);
    else {
      p.brut = String(v); p.valeur = v;
      // recopie dans le script (sans recompiler : on garde l'etat qui joue)
      const ed = $("editeur");
      const re = new RegExp(`^(\\s*@${nom}\\s+param\\s+)(\\S+)`, "m");
      ed.value = ed.value.replace(re, `$1${v}`);
      for (const q of this.modele.params.values())            // params qui en dependent
        if (q.genre === "param" && q !== p) { try { q.valeur = evalue(q.brut, this.modele.params); } catch (e) { /* garde */ } }
    }
    this._dernierChangement = performance.now();
    this._majStabilite();
    this.rafraichirPhysique();
  },

  /* ---- archet : les entrees reliees a un nlBow avancent a vitesse constante ---- */
  _entreesArchet() {
    const s = new Set();
    if (!this.modele || !this.desc) return s;
    const idx = new Map(this.desc.indices);
    for (const it of this.modele.interactions)
      if (it.genre === "nlBow")
        for (const r of [it.m1, it.m2])
          if (r.nom !== undefined && this.modele.masses.get(r.nom).genre === "posInput") s.add(idx.get(r.nom));
    return s;
  },

  _appliqueArchet() {
    const entrees = this._entreesArchet();
    $("zone-archet").hidden = !entrees.size;
    this._entraines = entrees;
    // vitesse en u par echantillon a 44,1 kHz (l'echelle du nlBow, ~0.002 a 0.006)
    const v = this.archet * 0.01;
    for (const i of entrees) {
      if (son.actif) son.envoyer({ type: "entrainer", i, v: v * 44100 / son.frequence });
      if (this.sim) this.sim.entrainer(i, v);
    }
  },

  /* ================= jeu ================= */

  async basculeSon() {
    const btn = $("btn-son");
    if (son.actif) {
      await son.arreter();
      btn.textContent = "🔈 Son"; btn.classList.remove("actif");
      $("lbl-vitesse").classList.remove("grise");
      this.statut("son coupé");
      this.majJauge();
      return;
    }
    try { await son.demarrer(); }
    catch (exc) { this.statut("son impossible : " + exc.message); return; }
    if (this.anime) this.basculeAnim();
    btn.textContent = "🔊 Son"; btn.classList.add("actif");
    $("lbl-vitesse").classList.add("grise");
    this._envoieVolume();
    this._envoieOptions();
    if (son.multi) this._modeCanaux();
    this._envoieModeleSon(false);
    this._appliqueArchet();
    const nb = this.modele ? this.modele.sorties.length : 0;
    this.statut(`son actif · ${son.frequence} Hz · ` +
      (nb ? `${nb} sortie(s) écoutée(s)` : "pas de posOutput : on écoute 2 masses de l'objet") + " · espace = frapper");
    this.majJauge();
    tuto.verifier();
  },

  _envoieVolume() { son.envoyer({ type: "gain", v: 10 ** (+$("sld-volume").value / 20), auto: $("chk-autovol").checked }); },

  _messageSon(d) {
    if (d.type === "explosion") this.secours(true);
    else if (d.type === "etat" && son.actif && this.desc && d.u.length === this.desc.nbNoeuds + this.desc.nbProxies) {
      this._noteStable();
      this.vue.majPositions(d.u, +$("sld-ampli").value, this._entraines);
      if (d.charge > 0) this._chargeMesuree = d.charge;
      this.majJauge();
    }
  },

  basculeAnim() {
    if (this.anime) {
      this.anime = false; this.sim = null;
      $("btn-anim").textContent = "▶ Animer"; $("btn-anim").classList.remove("actif");
      return;
    }
    if (son.actif) { this.statut("le son fait déjà tourner la simulation"); return; }
    if (!this.desc) return;
    this.anime = true;
    this.sim = new Simulateur(this.desc);
    this._appliqueArchet();
    $("btn-anim").textContent = "⏸ Pause"; $("btn-anim").classList.add("actif");
    const boucle = () => {
      if (!this.anime || !this.sim) return;
      if (!this.sim.pas(+$("sld-vitesse").value)) this.secours(true);
      else this._noteStable();
      this.vue.majPositions(this.sim.u, +$("sld-ampli").value, this._entraines);
      requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
  },

  _assureSimulation() {
    if (!son.actif && !this.anime) this.basculeAnim();
  },

  frapper(cible = null) {
    if (!this.desc) return;
    this._assureSimulation();
    const force = +$("sld-force").value;
    if (cible === null && this.desc.entrees.length) {
      if (son.actif) son.envoyer({ type: "pousser", force });
      else if (this.sim) this.sim.pousser(force, 30);
      return;
    }
    let i = cible !== null ? cible : this.vue.selection;
    const d = this.desc;
    const frappable = k => k >= d.nbNoeuds || (k >= 0 && d.etat[k] === MOBILE);
    if (!frappable(i)) {
      i = -1;
      for (let k = 0; k < d.nbNoeuds; k++) if (d.etat[k] === MOBILE && (i < 0 || d.gz[k] > d.gz[i])) i = k;
    }
    if (i < 0) return;
    if (son.actif) son.envoyer({ type: "frapper", i, force });
    else if (this.sim) this.sim.frapper(i, force);
  },

  placer(i, z) {
    const u = z - this.desc.gz[i];
    this._assureSimulation();
    if (son.actif) son.envoyer({ type: "placer", i, u });
    else if (this.sim) this.sim.placer(i, u);
  },

  reset() {
    if (son.actif) son.envoyer({ type: "reset" });
    else if (this.sim) this.sim.reset();
    this._appliqueArchet();
  },

  majJauge() {
    if (!this.modele) return;
    const c = this.desc ? comptesDesc(this.desc) : comptesModele(this.modele);
    const sr = son.frequence || 48000;
    const estimee = budget.charge(c, sr);
    const mesuree = son.actif && son.mode === "worklet" && this._chargeMesuree ? this._chargeMesuree : null;
    const ch = mesuree !== null ? mesuree : estimee;
    const pc = Math.round(ch * 100);
    const barre = $("jauge-barre");
    barre.style.width = Math.min(pc, 100) + "%";
    barre.style.background = ch < 0.5 ? "#3f8f63" : ch < 0.85 ? "#c9a227" : "#d0453f";
    $("jauge-texte").textContent = `CPU son ≈ ${pc} %${mesuree !== null ? "" : budget.mesure ? " (estimé)" : " (…)"}`;
    $("jauge").title = `${c.masses} masses, ${c.liaisons} liaisons, ${c.proxies} proxy · ` +
      `${(budget.coutMasse * 1e9).toFixed(1)} ns / masse, ${(budget.coutLien * 1e9).toFixed(1)} ns / liaison sur cette machine`;
  },

  /* ================= import 3D ================= */

  async ouvrir3D(fichier) {
    let brut;
    try {
      const donnees = fichier.name.toLowerCase().endsWith(".stl") ? await fichier.arrayBuffer() : await fichier.text();
      brut = lire3D(fichier.name, donnees);
    } catch (e) { alert("Import impossible : " + e.message); return; }
    const ratio = 4;                                  // ~3 ressorts par masse + 1 contact au sol
    const maxBudget = budget.maxMasses(ratio);
    const max = Math.max(20, Math.min(brut.verts.length, Math.max(maxBudget * 2, 200), 5000));
    $("imp-nom").textContent = `Importer : ${fichier.name}`;
    $("imp-origine").textContent = `${brut.verts.length} sommets, ${brut.aretes.length} arêtes. ` +
      `Ta machine tient environ ${maxBudget} masses en temps réel (budget ${Math.round(budget.part * 100)} % d'un coeur).`;
    const sld = $("imp-masses"), nb = $("imp-masses-n");
    sld.max = max; nb.max = max;
    const depart = Math.min(brut.verts.length, maxBudget);
    sld.value = nb.value = depart;
    $("imp-ressorts").value = 0;
    let dernier = null;
    const apercu = () => {
      const o = this._optionsImport(fichier.name);
      const ressortsAuto = o.ressorts === 0 ? budget.maxLiens(o.masses) : o.ressorts;
      try {
        dernier = adapter3D(brut, { ...o, ressorts: ressortsAuto });
        const c = { masses: dernier.masses, liaisons: dernier.ressorts, proxies: 0 };
        const ch = budget.charge(c);
        $("imp-apercu").innerHTML = `→ <b>${dernier.masses}</b> masses, <b>${dernier.ressorts}</b> ressorts, ` +
          `${dernier.fixes} fixes${dernier.liesAjoutes ? `, ${dernier.liesAjoutes} morceau(x) relié(s)` : ""}<br>` +
          `CPU son ≈ <b style="color:${ch < 0.5 ? "#58d68d" : ch < 0.85 ? "#e0c341" : "#ff7b7b"}">${Math.round(ch * 100)} %</b>` +
          (o.ressorts === 0 && ressortsAuto < brut.aretes.length ? ` · ressorts plafonnés au budget (${ressortsAuto})` : "");
      } catch (e) { $("imp-apercu").textContent = "erreur : " + e.message; dernier = null; }
    };
    let minuterie = null;
    const plusTard = () => { clearTimeout(minuterie); minuterie = setTimeout(apercu, 120); };
    sld.oninput = () => { nb.value = sld.value; plusTard(); };
    nb.onchange = () => { sld.value = nb.value; plusTard(); };
    for (const id of ["imp-ressorts", "imp-fixation", "imp-orientation", "imp-taille", "imp-relier", "imp-sol"]) $(id).onchange = plusTard;
    $("imp-go").onclick = () => {
      if (!dernier) return;
      $("dlg-import").close();
      this.charger(dernier.modele.script(dernier.note), `${dernier.modele.nom}.mdl`);
      this.onglet("construire");
      this._suggereSon();
    };
    apercu();
    $("dlg-import").showModal();
  },

  _optionsImport(nom) {
    return {
      masses: +$("imp-masses-n").value, ressorts: +$("imp-ressorts").value,
      fixation: $("imp-fixation").value, orientation: $("imp-orientation").value,
      taille: +$("imp-taille").value, relier: $("imp-relier").checked, sol: $("imp-sol").checked, nom,
    };
  },

  /* ================= export Max ================= */

  _export() {
    const texte = $("editeur").value;
    const mdl = parse(texte);
    if (mdl.erreurs.length) throw new Error("corrige d'abord les erreurs du script (onglet Script)");
    const conv = versMIMS4Max(mdl, compiler(mdl, { reglages: this.reglagesAudio }), texte);
    const gen = genererGen(conv.texteGen, $("chk-invariant").checked, conv.plus);
    return { ...conv, ...gen };
  },

  majExport() {
    const infos = $("export-infos");
    try {
      const r = this._export();
      const entrees = [];
      for (const l of r.texte.split("\n")) {
        const m = /^@(\S+)\s+(posInput|frcInput|audioParam)\s*(\S*)/.exec(l);
        if (m) entrees.push(m[2] === "audioParam" ? `${m[3].slice(1)} = audioParam ${m[1]}` : `${m[1]} = ${m[2]}`);
      }
      entrees.sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10));
      infos.innerHTML = "";
      const p = document.createElement("div");
      p.textContent = `gen~ : ${r.nbEntrees} entrée(s), ${r.nbSorties} sortie(s). ` +
        (entrees.length ? `Entrées : ${entrees.join(" · ")}.` : "");
      infos.appendChild(p);
      for (const a of r.avertissements) { const d = document.createElement("div"); d.className = "note"; d.textContent = a; infos.appendChild(d); }
      $("export-code").value = r.code;
      this._dernierExport = r;
    } catch (e) {
      infos.innerHTML = "";
      const d = document.createElement("div"); d.className = "err"; d.textContent = "Export impossible : " + e.message;
      infos.appendChild(d);
      $("export-code").value = "";
      this._dernierExport = null;
    }
  },

  _nomBase() { return this.fichierNom.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "modele"; },

  /* ================= fichiers et evenements ================= */

  enregistrer() {
    const nom = this.fichierNom.endsWith(".mdl") ? this.fichierNom : this.fichierNom + ".mdl";
    telecharger(nom, $("editeur").value);
    this.statut(`téléchargé : ${nom}`);
  },

  _branche() {
    document.querySelectorAll("#onglets button").forEach(b => b.addEventListener("click", () => this.onglet(b.dataset.onglet)));
    // menus
    const menus = document.querySelectorAll(".menu");
    menus.forEach(menu => menu.querySelector(":scope > button").addEventListener("click", e => {
      e.stopPropagation();
      const etait = menu.classList.contains("ouvert");
      menus.forEach(m => m.classList.remove("ouvert"));
      if (!etait) menu.classList.add("ouvert");
    }));
    document.addEventListener("click", () => menus.forEach(m => m.classList.remove("ouvert")));
    const actions = {
      ouvrir: () => $("fichier-mdl").click(),
      enregistrer: () => this.enregistrer(),
      import3d: () => $("fichier-3d").click(),
      export: () => this.onglet("export"),
      aide: () => $("dlg-aide").showModal(),
      budget: () => { budget.mesurer(); this.majJauge(); this.statut(`machine : ${(budget.coutMasse * 1e9).toFixed(1)} ns / masse, ${(budget.coutLien * 1e9).toFixed(1)} ns / liaison`); },
    };
    document.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => actions[b.dataset.action]()));
    document.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

    $("fichier-mdl").addEventListener("change", async e => {
      const f = e.target.files[0]; e.target.value = "";
      if (f) { this.charger(await f.text(), f.name); }
    });
    $("fichier-3d").addEventListener("change", e => {
      const f = e.target.files[0]; e.target.value = "";
      if (f) this.ouvrir3D(f);
    });
    // glisser-deposer d'un fichier sur la page
    document.addEventListener("dragover", e => e.preventDefault());
    document.addEventListener("drop", async e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (/\.(obj|stl)$/i.test(f.name)) this.ouvrir3D(f);
      else this.charger(await f.text(), f.name);
    });

    $("btn-vide").addEventListener("click", () => this.charger("# Nouveau modele : ajoute des elements avec l'onglet Construire\n\n", "modele.mdl"));
    $("btn-compiler").addEventListener("click", () => this.compiler());
    $("editeur").addEventListener("input", () => {
      if (!$("chk-auto").checked) return;
      clearTimeout(this._autoId);
      this._autoId = setTimeout(() => this.compiler(), 500);
    });
    $("btn-anim").addEventListener("click", () => this.basculeAnim());
    $("btn-son").addEventListener("click", () => this.basculeSon());
    $("btn-frapper").addEventListener("click", () => this.frapper());
    $("btn-reset").addEventListener("click", () => this.reset());
    $("sld-volume").addEventListener("input", () => this._envoieVolume());
    $("chk-autovol").addEventListener("change", () => this._envoieVolume());
    $("sld-archet").addEventListener("input", () => {
      this.archet = +$("sld-archet").value;
      $("val-archet").textContent = this.archet.toFixed(2);
      if (this.archet !== 0) this._assureSimulation();
      this._appliqueArchet();
    });
    $("chk-invariant").addEventListener("change", () => this.majExport());
    $("btn-gendsp").addEventListener("click", () => {
      this.majExport();
      if (this._dernierExport) telecharger(`${this._nomBase()}.gendsp`, this._dernierExport.gendsp, "application/json");
    });
    $("btn-mdl-max").addEventListener("click", () => {
      this.majExport();
      if (this._dernierExport) telecharger(`${this._nomBase()}_max.mdl`, this._dernierExport.texte);
    });
    $("btn-copier-gen").addEventListener("click", async () => {
      this.majExport();
      if (!this._dernierExport) return;
      try { await navigator.clipboard.writeText(this._dernierExport.code); this.statut("code gen~ copié"); }
      catch (e) { $("export-code").select(); document.execCommand("copy"); this.statut("code gen~ copié"); }
    });

    document.addEventListener("keydown", e => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "F5") { e.preventDefault(); this.compiler(); }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); this.enregistrer(); }
      if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); $("fichier-mdl").click(); }
      const saisie = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName) || document.querySelector("dialog[open]");
      if (e.key === " " && !saisie && !mod) { e.preventDefault(); this.frapper(); }
      if (e.key === "Escape" && !saisie) { this.vue.choisir(-1); if (this.vue.edition) this.choisirOutil("selection"); }
    });
  },
};

