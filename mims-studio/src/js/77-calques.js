"use strict";
/* ------------------------------------------------------------------ *
 *  Reglages en calques : un volet par objet (corde, membrane,         *
 *  pincement, ecoute...), parametres essentiels en premier, le reste  *
 *  sous « options ». Favoris epingles en haut (~favoris), etats       *
 *  memorises (~etat), zone rouge = limite de stabilite estimee.       *
 * ------------------------------------------------------------------ */

const PRIORITE_ROLE = { note: 0, K: 0, position: 0, Znl: 0, Knl: 1, Z: 1, M: 2, Zo: 2, K2: 1, Vscale: 2, Pscale: 2,
                        KnlP: 2, KnlQ: 2, Klim: 3, thresh: 3, gravity: 3, smooth: 3, nbMass: 3, nbX: 3, nbY: 3 };
const ICONES = { string: "〰", stiffString: "〰", chain: "⛓", mesh: "▦", closedMesh: "▦", cornerMesh: "▦",
                 mass: "●", osc: "◉", ground: "■", nlPluck: "✋", nlBow: "🎻", contact: "✊", nlContact: "✊",
                 springDamper: "╱", spring: "╱", damper: "╱", posOutput: "🎧", frcOutput: "🎧", frcInput: "⚡" };
// roles qui changent la stabilite du calcul : on cherche leur limite
const ROLES_STABILITE = new Set(["note", "K", "M", "Z", "Zo", "K2", "Knl", "Klim", "Znl"]);

Object.assign(app, {
  _calquesFermes: new Set(),

  /* objet "proprietaire" de chaque element nomme : son type et son libelle */
  _proprietaires() {
    const mdl = this.modele, info = new Map();
    for (const m of mdl.masses.values()) info.set("@" + m.nom, { genre: m.genre, titre: AIDE_TYPES[m.genre] || m.genre });
    for (const mc of mdl.macros.values()) info.set("@" + mc.nom, { genre: mc.genre, titre: AIDE_TYPES[mc.genre] });
    for (const it of mdl.interactions) info.set(`${it.genre} @${it.nom}`, { genre: it.genre, titre: AIDE_TYPES[it.genre] || it.genre, nom: it.nom });
    for (const s of mdl.sorties) info.set("@" + s.nom, { genre: s.genre, titre: "point d'écoute" });
    return info;
  },

  _construitReglages() {
    const zone = $("liste-reglages");
    zone.innerHTML = "";
    const mdl = this.modele;
    this._construitEtats();
    const roles = this._rolesParams();
    this._construitLegende(roles);
    if (!mdl.params.size) {
      zone.innerHTML = `<p class="aide">Ce modèle n'a pas de @param. Écris « @nom param valeur » dans le script et
        utilise ce nom comme valeur : il devient un curseur ici.</p>`;
      this._majStabilite();
      return;
    }
    // regroupement par objet : le premier endroit ou le param sert
    const info = this._proprietaires(), groupes = new Map();
    const ajoute = (cle, p) => { if (!groupes.has(cle)) groupes.set(cle, []); groupes.get(cle).push(p); };
    for (const p of mdl.params.values()) {
      const r = roles.get(p.nom) || [];
      const proprios = [...new Set(r.map(x => x.ou))];
      if (p.genre === "audioParam") ajoute("audio", p);
      else if (!proprios.length) ajoute("autres", p);
      else if (proprios.length > 1 && !r.every(x => x.role === "position")) ajoute(proprios.length > 3 ? "partages" : proprios[0], p);
      else ajoute(proprios[0], p);
    }
    const prio = p => Math.min(...(roles.get(p.nom) || [{ role: "?" }]).map(x => PRIORITE_ROLE[x.role] ?? 3));

    // favoris
    const favoris = mdl.favoris.filter(n => mdl.params.has(n));
    if (favoris.length) zone.appendChild(this._calque("⭐", "Favoris", "épinglés", favoris.map(n => mdl.params.get(n)), roles, true, "favoris"));

    // ordre : structures, puis excitations, liens, ecoutes, le reste
    const rang = cle => {
      const g = (info.get(cle) || {}).genre || "";
      if (TYPES_MACRO.includes(g)) return 0;
      if (["nlPluck", "nlBow", "contact", "nlContact"].includes(g)) return 1;
      if (["mass", "osc"].includes(g)) return 2;
      if (["springDamper", "spring", "damper"].includes(g)) return 3;
      if (g === "posOutput" || g === "frcOutput") return 4;
      return 5;
    };
    for (const cle of [...groupes.keys()].sort((a, b) => rang(a) - rang(b))) {
      const liste = groupes.get(cle).sort((a, b) => prio(a) - prio(b));
      let icone = "•", titre, sous;
      if (cle === "audio") { icone = "🎚"; titre = "Entrées audio"; sous = "audioParam (une entrée inN dans Max)"; }
      else if (cle === "autres") { titre = "Autres paramètres"; sous = ""; }
      else if (cle === "partages") { icone = "⇄"; titre = "Paramètres partagés"; sous = "utilisés par plusieurs objets"; }
      else {
        const i = info.get(cle) || {};
        icone = ICONES[i.genre] || "•";
        titre = cle.replace(/^\S+ (?=@)/, "");
        sous = i.titre || "";
      }
      zone.appendChild(this._calque(icone, titre, sous, liste, roles, false, cle));
    }
    this._majStabilite();
    clearTimeout(this._idLimites);
    this._idLimites = setTimeout(() => this._calculeLimites(), 200);
  },

  _calque(icone, titre, sous, liste, roles, estFavoris, cle) {
    const div = document.createElement("div");
    div.className = "calque" + (estFavoris ? " favoris" : "") + (this._calquesFermes.has(cle) ? " ferme" : "");
    const tete = document.createElement("div");
    tete.className = "entete";
    tete.innerHTML = `<span class="fleche"></span><span></span><b></b><span class="type"></span>`;
    tete.children[0].textContent = this._calquesFermes.has(cle) ? "▸" : "▾";
    tete.children[1].textContent = icone;
    tete.children[2].textContent = titre;
    tete.children[3].textContent = sous;
    tete.addEventListener("click", () => {
      const ferme = div.classList.toggle("ferme");
      tete.children[0].textContent = ferme ? "▸" : "▾";
      if (ferme) this._calquesFermes.add(cle); else this._calquesFermes.delete(cle);
    });
    // survol : montre l'objet dans la vue
    const nomEl = (titre.match(/@(\S+)/) || [])[1];
    if (nomEl) tete.addEventListener("mouseenter", () => {
      const k = this.desc.element.findIndex(e => e === nomEl);
      if (k >= 0) { this.vue.choisir(k); }
    });
    const corps = document.createElement("div");
    corps.className = "corps";
    const essentiels = estFavoris ? liste : liste.filter((p, k) => k < 2 || (PRIORITE_ROLE[((roles.get(p.nom) || [])[0] || {}).role] ?? 3) <= 1);
    const options = estFavoris ? [] : liste.filter(p => !essentiels.includes(p));
    for (const p of essentiels) corps.appendChild(this._ligneReglage(p, roles));
    if (options.length) {
      const det = document.createElement("details");
      det.className = "options-calque";
      det.innerHTML = `<summary>options (${options.length})</summary>`;
      for (const p of options) det.appendChild(this._ligneReglage(p, roles));
      corps.appendChild(det);
    }
    div.append(tete, corps);
    return div;
  },

  /* une ligne : etoile, nom, curseur (+ zone rouge), valeur libre, retour */
  _ligneReglage(p, roles) {
    const r = (roles && roles.get(p.nom)) || [];
    const lineaire = p.genre === "audioParam" || (r.length && r.every(x => x.role === "position"));
    const row = document.createElement("div");
    row.className = "reglage";
    row.dataset.param = p.nom;
    const et = document.createElement("button");
    et.className = "etoile" + (this.modele.favoris.includes(p.nom) ? " on" : "");
    et.textContent = "★"; et.title = "épingler en haut (favori)";
    et.addEventListener("click", () => this.basculeFavori(p.nom));
    const lab = document.createElement("label");
    lab.textContent = p.nom;
    lab.title = r.map(x => `${x.role} (${(LEGENDE[x.role] || [x.role])[0]}) de ${x.ou}`).join("\n") || p.nom;
    const zoneC = document.createElement("div"); zoneC.className = "curseur";
    const sld = document.createElement("input");
    sld.type = "range"; sld.min = 0; sld.max = 1000; sld.step = 1;
    const rouge = document.createElement("div"); rouge.className = "rouge"; rouge.hidden = true;
    zoneC.append(sld, rouge);
    const num = document.createElement("input");
    num.type = "number"; num.step = "any"; num.title = "valeur libre (même hors de la plage du curseur)";
    const raz = document.createElement("button");
    raz.className = "raz"; raz.textContent = "↺"; raz.title = "valeur de départ";
    const v0 = this.valeursInitiales.has(p.nom) ? this.valeursInitiales.get(p.nom) : p.valeur;
    const valeur = p.genre === "audioParam" ? (this.reglagesAudio.has(p.nom) ? this.reglagesAudio.get(p.nom) : 0.5) : p.valeur;
    // plage : 0..1 pour les positions ; sinon logarithmique, de v0/100 a v0*100
    let vers, depuis;
    if (lineaire) { vers = v => v * 1000; depuis = c => c / 1000; }
    else if (v0 > 0) {
      const lo = Math.log(v0 / 100), hi = Math.log(v0 * 100);
      vers = v => (Math.log(Math.max(v, 1e-30)) - lo) / (hi - lo) * 1000;
      depuis = c => +Math.exp(lo + (hi - lo) * c / 1000).toPrecision(4);
    } else {
      const a = Math.max(Math.abs(v0) * 10, 1);
      vers = v => (v + a) / (2 * a) * 1000; depuis = c => +(c / 1000 * 2 * a - a).toPrecision(4);
    }
    row._echelle = { vers, depuis, lineaire };
    sld.value = vers(valeur);
    num.value = +(+valeur).toPrecision(6);
    const libre = /^-?[\d.eE+-]+$/.test(p.brut) || p.genre === "audioParam";
    if (!libre) { sld.disabled = true; num.disabled = true; lab.title += `\n= ${p.brut} (expression : modifiable dans le script)`; }
    const applique = v => { if (Number.isFinite(v)) { this.changerParam(p.nom, v); this._marqueDanger(row, v); } };
    sld.addEventListener("input", () => { const v = depuis(+sld.value); num.value = v; applique(v); });
    num.addEventListener("change", () => { const v = +num.value; sld.value = vers(v); applique(v); });
    raz.addEventListener("click", () => { num.value = v0; sld.value = vers(v0); applique(v0); });
    row.append(et, lab, zoneC, num, raz);
    if (r.length) {
      const d = document.createElement("div");
      d.className = "role";
      d.textContent = [...new Set(r.map(x => `${x.role} — ${(LEGENDE[x.role] || [x.role])[0]}`))].join(" ; ");
      row.appendChild(d);
    }
    return row;
  },

  /* mise a jour des curseurs apres un rappel d'etat ou un secours */
  _rafraichitCurseurs() {
    document.querySelectorAll("#liste-reglages .reglage").forEach(row => {
      const p = this.modele.params.get(row.dataset.param);
      if (!p || !row._echelle) return;
      const v = p.genre === "audioParam" ? (this.reglagesAudio.get(p.nom) ?? 0.5) : p.valeur;
      row.querySelector("input[type=range]").value = row._echelle.vers(v);
      row.querySelector("input[type=number]").value = +(+v).toPrecision(6);
      this._marqueDanger(row, v);
    });
  },

  /* ---------------- limite de stabilite sur chaque curseur ---------------- */

  _rapportAvec(nom, v) {
    const reg = new Map(this.reglagesAudio);
    reg.set(nom, v);
    return margeStabilite(compiler(this.modele, { reglages: reg })).rapport;
  },

  /* pour chaque parametre physique : valeur ou le calcul devient instable
   * (dichotomie sur la plage du curseur), dessinee en rouge sous le curseur */
  _calculeLimites() {
    const lignes = [...document.querySelectorAll("#liste-reglages .reglage")];
    const roles = this._rolesParams();
    const suivant = () => {
      const row = lignes.shift();
      if (!row) return;
      const nom = row.dataset.param, p = this.modele && this.modele.params.get(nom);
      const r = roles.get(nom) || [];
      if (p && p.genre === "param" && row._echelle && !row._echelle.lineaire && r.some(x => ROLES_STABILITE.has(x.role))) {
        const { depuis } = row._echelle;
        try {
          const rLo = this._rapportAvec(nom, depuis(0)), rHi = this._rapportAvec(nom, depuis(1000));
          const rouge = row.querySelector(".rouge");
          if ((rLo >= 1) !== (rHi >= 1)) {
            let a = 0, b = 1000;
            for (let k = 0; k < 10; k++) {
              const m = (a + b) / 2, rm = this._rapportAvec(nom, depuis(m));
              if ((rm >= 1) === (rLo >= 1)) a = m; else b = m;
            }
            const x = (a + b) / 20;                       // en %
            const versLaDroite = rHi >= 1;
            rouge.style.left = versLaDroite ? `${x}%` : "0%";
            rouge.style.width = versLaDroite ? `${100 - x}%` : `${x}%`;
            rouge.hidden = false;
            row._limite = { valeur: depuis((a + b) / 2), versLaDroite };
            rouge.title = `au-delà de ${row._limite.valeur.toPrecision(3)} le calcul devient instable (estimation)`;
          } else if (rLo >= 1) { rouge.style.left = "0%"; rouge.style.width = "100%"; rouge.hidden = false; row._limite = null; }
          else { rouge.hidden = true; row._limite = null; }
          this._marqueDanger(row, p.valeur);
        } catch (e) { /* modele en cours d'edition */ }
      }
      setTimeout(suivant, 0);
    };
    suivant();
  },

  _marqueDanger(row, v) {
    const l = row._limite;
    row.classList.toggle("danger", !!l && (l.versLaDroite ? v >= l.valeur : v <= l.valeur));
  },

  /* ---------------- favoris ---------------- */

  basculeFavori(nom) {
    const f = new Set(this.modele.favoris);
    if (f.has(nom)) f.delete(nom); else f.add(nom);
    const lignes = $("editeur").value.replace(/\s+$/, "").split("\n").filter(l => !/^\s*~favoris\b/.test(l));
    if (f.size) lignes.push(`~favoris ${[...f].join(" ")}`);
    this.modifierTexte(lignes.join("\n") + "\n");
    this.onglet("reglages");
  },

  /* ---------------- legende ---------------- */

  _construitLegende(roles) {
    const presents = new Set([...roles.values()].flat().map(x => x.role));
    const dl = $("liste-legende");
    dl.innerHTML = "";
    for (const k of [...ORDRE_LEGENDE.filter(k => presents.has(k)), ...ORDRE_LEGENDE.filter(k => !presents.has(k))]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = k; dd.textContent = `${LEGENDE[k][0]} : ${LEGENDE[k][1]}`;
      if (!presents.has(k)) { dt.style.opacity = dd.style.opacity = 0.5; }
      dl.append(dt, dd);
    }
  },

  /* ---------------- etats memorises (~etat) ---------------- */

  _construitEtats() {
    const zone = $("liste-etats");
    zone.innerHTML = "";
    for (const e of this.modele.etats) {
      const b = document.createElement("span");
      b.className = "puce etat";
      b.title = [...e.valeurs].map(([k, v]) => `${k} = ${v}`).join("\n");
      const t = document.createElement("span"); t.textContent = e.nom;
      const x = document.createElement("span"); x.className = "x"; x.textContent = "✕"; x.title = "oublier cet état";
      b.append(t, x);
      t.addEventListener("click", () => this.rappelerEtat(e));
      t.addEventListener("dblclick", () => {
        const n = prompt("Nom de l'état :", e.nom);
        if (n && /^\S+$/.test(n)) this._remplaceLigneEtat(e, `~etat ${n} ${this._texteValeurs(e.valeurs)}`);
      });
      x.addEventListener("click", () => this._remplaceLigneEtat(e, null));
      zone.appendChild(b);
    }
    if (!this.modele.etats.length)
      zone.innerHTML = `<span class="discret">Aucun état : règle le son, puis 📸 pour le retrouver plus tard (il est enregistré dans le .mdl).</span>`;
  },

  _texteValeurs(valeurs) { return [...valeurs].map(([k, v]) => `${k}=${+(+v).toPrecision(6)}`).join(" "); },

  memoriserEtat() {
    const v = this._valeursParams();
    let n = 1;
    const noms = new Set(this.modele.etats.map(e => e.nom));
    while (noms.has(`etat${n}`)) n++;
    const lignes = $("editeur").value.replace(/\s+$/, "").split("\n");
    lignes.push(`~etat etat${n} ${this._texteValeurs(v)}`);
    this.modifierTexte(lignes.join("\n") + "\n");
    this.onglet("reglages");
    this.statut(`état « etat${n} » mémorisé (${v.size} réglages) — Ctrl+S pour l'enregistrer dans le .mdl`);
  },

  _remplaceLigneEtat(e, nouvelle) {
    const lignes = $("editeur").value.split("\n");
    if (nouvelle === null) lignes.splice(e.ligne - 1, 1); else lignes[e.ligne - 1] = nouvelle;
    this.modifierTexte(lignes.join("\n"));
    this.onglet("reglages");
  },

  /* revient a un etat : les valeurs glissent (fluidite), le son continue */
  rappelerEtat(e) {
    let n = 0;
    for (const [k, v] of e.valeurs) {
      const p = this.modele.params.get(k);
      if (!p) continue;
      if (p.genre === "audioParam") this.reglagesAudio.set(k, v);
      else {
        p.brut = String(v); p.valeur = v;
        $("editeur").value = $("editeur").value.replace(new RegExp(`^(\\s*@${k}\\s+param\\s+)(\\S+)`, "m"), `$1${v}`);
      }
      n++;
    }
    for (const q of this.modele.params.values())
      if (q.genre === "param") { try { q.valeur = evalue(q.brut, valeursParams(this.modele)); } catch (err) { /* garde */ } }
    this._dernierChangement = performance.now();
    this.rafraichirPhysique();
    this._rafraichitCurseurs();
    this._majStabilite();
    this.statut(`état « ${e.nom} » rappelé (${n} réglages)`);
  },
});
