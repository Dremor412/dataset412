/* Interface : pistes, effets, master, connecteurs, menus contextuels. */
"use strict";

/* ---------- Menu contextuel ---------- */
function menuContextuel(x, y, items) {
  fermerMenu();
  const m = h("div.menu-ctx#menu-ctx", items.map(it => it.titre
    ? h("div.menu-titre", it.titre)
    : h("button", { class: it.coche ? "coche" : null, disabled: it.inactif, onclick: () => { fermerMenu(); it.action(); } }, it.texte)));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", fermerMenuDehors, true), 0);
}
function fermerMenuDehors(e) { if (!e.target.closest("#menu-ctx")) fermerMenu(); }
function fermerMenu() {
  const m = $("#menu-ctx"); if (m) m.remove();
  document.removeEventListener("pointerdown", fermerMenuDehors, true);
}

/* ---------- Curseurs ---------- */
const interfaceUI = {
  curseurs: [],
  fxOuverts: new Set(),

  /* curseur lie a un chemin de parametre (connectable, MIDI, LFO) */
  curseur(chemin, opts = {}) {
    const r = resoudre(chemin);
    const spec = r.spec;
    const val = h("span.valeur");
    const pastille = h("span.pastille");
    const entree = h("input", { type: "range", min: 0, max: 1000, step: 1, "aria-label": opts.nom || spec.nom });
    const el = h("label.curseur" + (opts.classe ? "." + opts.classe : ""), h("span.ligne-titre", h("span.nom", opts.nom || spec.nom), pastille, val), entree);
    const lire = () => { const rr = resoudre(chemin); return rr ? rr.obj[rr.cle] : spec.def; };
    const maj = () => {
      const v = lire();
      entree.value = Math.round(norm(spec, v) * 1000);
      val.textContent = formater(v, spec.unite);
      const lien = etat.liens[chemin], lfo = r.fx && r.fx.lfo[r.cle] && r.fx.lfo[r.cle].on;
      const cc = midi.ccPour(chemin);
      pastille.textContent = [lien ? LIENS[lien].icone : "", lfo ? "∿" : "", cc ? "CC" + cc : ""].join(" ").trim();
      el.classList.toggle("module", !!(lien || lfo));
    };
    entree.addEventListener("input", () => {
      historique.debutGeste();
      const rr = resoudre(chemin); if (!rr) return;
      rr.obj[rr.cle] = denorm(spec, entree.value / 1000);
      val.textContent = formater(rr.obj[rr.cle], spec.unite);
      appliquerAudio(chemin, mod.val(chemin, rr.obj[rr.cle]));
      if (opts.surChange) opts.surChange(rr.obj[rr.cle]);
    });
    entree.addEventListener("change", () => historique.finGeste(spec.nom));
    entree.addEventListener("dblclick", () => {
      historique.noter(spec.nom);
      const rr = resoudre(chemin); rr.obj[rr.cle] = spec.def; maj();
      appliquerAudio(chemin, spec.def);
      if (opts.surChange) opts.surChange(spec.def);
    });
    el.addEventListener("contextmenu", e => {
      e.preventDefault();
      const lien = etat.liens[chemin];
      const items = [{ titre: "Connecter " + spec.nom + " à" }];
      if (!opts.sansLien) {
        for (const k in LIENS) items.push({ texte: LIENS[k].icone + "  " + LIENS[k].nom, coche: lien === k, action: () => interfaceUI.lier(chemin, lien === k ? null : k) });
        if (lien) items.push({ texte: "✕  Déconnecter", action: () => interfaceUI.lier(chemin, null) });
      }
      items.push({ titre: "MIDI" });
      items.push({ texte: "Apprendre un CC (bouge un contrôleur)", action: () => midi.apprendre(chemin) });
      if (midi.ccPour(chemin)) items.push({ texte: "Oublier le CC " + midi.ccPour(chemin), action: () => midi.oublier(chemin) });
      items.push({ titre: "Valeur" });
      items.push({ texte: "Revenir à la valeur par défaut (" + formater(spec.def, spec.unite) + ")", action: () => entree.dispatchEvent(new Event("dblclick")) });
      menuContextuel(e.clientX, e.clientY, items);
    });
    this.curseurs.push({ maj, chemin });
    maj();
    return el;
  },

  /* curseur simple lie a un objet (reglages de LFO...) */
  curseurSimple(nom, obj, cle, spec, surChange) {
    const val = h("span.valeur");
    const entree = h("input", { type: "range", min: 0, max: 1000, step: 1, "aria-label": nom });
    const maj = () => { entree.value = Math.round(norm(spec, obj[cle]) * 1000); val.textContent = formater(obj[cle], spec.unite); };
    entree.addEventListener("input", () => {
      historique.debutGeste();
      obj[cle] = denorm(spec, entree.value / 1000); val.textContent = formater(obj[cle], spec.unite);
      if (surChange) surChange(obj[cle]);
    });
    entree.addEventListener("change", () => historique.finGeste(nom));
    this.curseurs.push({ maj });
    maj();
    return h("label.curseur.petit", h("span.ligne-titre", h("span.nom", nom), val), entree);
  },

  selectionner(options, valeur, surChange, label) {
    const s = h("select", { "aria-label": label || "" }, options.map(([v, t]) => h("option", { value: v, selected: v === valeur }, t)));
    s.addEventListener("change", () => surChange(s.value));
    return s;
  },

  lier(chemin, lien) {
    historique.noter("Connecteur");
    if (lien) etat.liens[chemin] = lien; else delete etat.liens[chemin];
    this.rafraichir();
    this.rendreConnecteurs();
  },

  rafraichir() { this.curseurs.forEach(c => c.maj()); this.majPositions(); },

  /* ---------- rendu complet ---------- */
  rendre() {
    this.curseurs = [];
    this.rendrePistes();
    this.rendreMaster();
    this.rendreChampBas();
    this.rendreConnecteurs();
    this.majSelection();
  },

  rendrePistes() {
    const liste = $("#pistes");
    liste.replaceChildren();
    $("#nb-sources").textContent = etat.sources.length + " / " + MAX_SOURCES;
    $("#zone-depot").hidden = etat.sources.length > 0;
    etat.sources.forEach((s, i) => liste.append(this.carteSource(s, i)));
    this.majPositions();
  },

  carteSource(s, i) {
    const t = tampons.get(s.id);
    const m = moteur.sources.get(s.id);
    const id = s.id, ch = "s:" + id + ":";
    const changer = (cle, label) => v => { historique.noter(label); s[cle] = v; moteur.synchroniser(); this.rendrePistes(); };
    const bouton = (txt, titre, action, classe) => h("button.mini" + (classe ? "." + classe : ""), { title: titre, "aria-label": titre, onclick: action }, txt);
    const tete = h("div.carte-tete",
      h("span.num", { style: { borderColor: s.couleur, color: s.couleur } }, i + 1),
      h("div.titre-piste", h("div.nom-piste", { title: s.nom }, s.nom),
        h("div.duree", t ? formaterTemps(t.buf.duration) : "audio manquant — remplace le fichier")),
      h("div.boutons",
        bouton(m && m.actif ? "■" : "▶", "Jouer / arrêter cette source (barre espace)", () => { audio.demarrer().then(() => moteur.basculer(id)); }, "jouer" + (m && m.actif ? ".actif" : "")),
        bouton("M", "Muet", () => { historique.noter("Muet"); s.mute = !s.mute; moteur.synchroniser(); this.rendrePistes(); }, s.mute ? "allume" : ""),
        bouton("S", "Solo", () => { historique.noter("Solo"); s.solo = !s.solo; moteur.synchroniser(); this.rendrePistes(); }, s.solo ? "allume" : ""),
        bouton("⤓", "Remplacer le fichier audio", () => fichiers.choisir(f => fichiers.remplacer(id, f[0]), false)),
        bouton("×", "Supprimer la piste", () => this.supprimer(id)),
        bouton(s.ouvert ? "⌃" : "⌄", s.ouvert ? "Replier" : "Déplier", () => { s.ouvert = !s.ouvert; this.rendrePistes(); })));
    const carte = h("div.carte-source", { "data-id": id, style: { "--c": s.couleur }, onpointerdown: () => { champ.focus = id; this.majSelection(); } }, tete);
    if (!s.ouvert) return carte;

    // forme d'onde avec region et marqueur de depart
    const onde = h("canvas.onde", { width: 600, height: 120 });
    const infos = h("div.onde-infos");
    carte.append(h("div.onde-cadre", h("span.onde-aide", "Glisse pour choisir la région · déplace le marqueur blanc"), onde), infos);
    regionEditeur(onde, infos, s);

    const grille = h("div.grille2");
    grille.append(
      h("label.champ-select", h("span.nom", "Mode de lecture"), this.selectionner(MODES, s.mode, changer("mode", "Mode de lecture"), "Mode de lecture")),
      this.curseur(ch + "volume"));
    if (s.mode === "periodique") grille.append(this.curseur(ch + "periode", { nom: "Période" }));
    const pos = h("span.valeur.pos-txt", { "data-id": id });
    grille.append(h("div.curseur.position", h("span.ligne-titre", h("span.nom", "Position"), pos),
      (() => {
        const e = h("input", { type: "range", min: -1000, max: 1000, step: 1, "aria-label": "Position horizontale de la source", "data-pos": id });
        e.addEventListener("input", () => { historique.debutGeste(); s.x = e.value / 1000; this.majPositions(); });
        e.addEventListener("change", () => historique.finGeste("Position"));
        return e;
      })()));
    carte.append(grille);

    // enveloppe
    const envOuvert = s.envOuvert;
    const env = h("div.bloc" + (envOuvert ? ".ouvert" : ""),
      h("button.bloc-tete", { onclick: () => { s.envOuvert = !s.envOuvert; this.rendrePistes(); } },
        h("span.badge.orange", "ENV"), h("span.bloc-titre", "Enveloppe ADSR"), h("span.bloc-sous", "A · D · S · R"), h("span.chevron", envOuvert ? "⌄" : "›")));
    if (envOuvert) {
      const dessin = h("canvas.adsr", { width: 300, height: 70 });
      const redessiner = () => dessinerADSR(dessin, s.env, s.couleur);
      env.append(h("div.bloc-corps", dessin, h("div.grille2",
        ...["a", "d", "s", "r"].map(k => this.curseur(ch + "env:" + k, { surChange: redessiner })))));
      requestAnimationFrame(redessiner);
    }
    carte.append(env);

    // effets de piste
    const nbOn = s.fx.filter(f => f.on).length;
    const fxBloc = h("div.bloc" + (s.fxOuvert ? ".ouvert" : ""),
      h("button.bloc-tete", { onclick: () => { s.fxOuvert = !s.fxOuvert; this.rendrePistes(); } },
        h("span.badge.orange", "FX"), h("span.bloc-titre", "Effets de piste"),
        h("span.bloc-sous", nbOn ? nbOn + " actif" + (nbOn > 1 ? "s" : "") + " · ordre modifiable" : "7 modules · ordre modifiable"), h("span.chevron", s.fxOuvert ? "⌄" : "›")));
    if (s.fxOuvert) {
      const corps = h("div.bloc-corps.liste-fx");
      s.fx.forEach((fx, k) => corps.append(this.carteEffet(fx, ch + "fx:", "s:" + id, k, s)));
      fxBloc.append(corps);
    }
    carte.append(fxBloc);
    return carte;
  },

  carteEffet(fx, prefixe, cleOuvert, index, source) {
    const d = EFFETS[fx.type];
    const cle = cleOuvert + ":" + fx.type, ouvert = this.fxOuverts.has(cle);
    const deplacable = source && fx.type !== "pitch";
    const carte = h("div.fx" + (fx.on ? ".on" : "") + (ouvert ? ".ouvert" : ""), { "data-type": fx.type });
    const power = h("button.power" + (fx.on ? ".on" : ""), {
      title: (fx.on ? "Couper " : "Activer ") + d.nom, "aria-label": (fx.on ? "Couper " : "Activer ") + d.nom,
      onclick: e => {
        e.stopPropagation();
        historique.noter(d.nom);
        fx.on = !fx.on;
        moteur.synchroniser();
        if (fx.on) this.fxOuverts.add(cle);
        source ? this.rendrePistes() : this.rendreMaster();
      },
    }, "⏻");
    const tete = h("div.fx-tete", { onclick: () => { ouvert ? this.fxOuverts.delete(cle) : this.fxOuverts.add(cle); source ? this.rendrePistes() : this.rendreMaster(); } },
      deplacable ? h("span.poignee", { title: "Glisser pour réordonner", draggable: true }, "⠿") : null,
      h("span.badge", d.abr), h("span.fx-nom", d.nom), h("span.fx-sous", d.sous), h("span.chevron", ouvert ? "⌄" : "›"), power);
    carte.append(tete);
    if (deplacable) brancherReordonnancement(carte, tete.querySelector(".poignee"), source, fx.type);
    if (!ouvert) return carte;

    const corps = h("div.fx-corps");
    const grille = h("div.grille2");
    for (const k in d.choix || {}) {
      grille.append(h("label.champ-select", h("span.nom", d.choix[k].nom),
        this.selectionner(d.choix[k].options, fx.choix[k], v => {
          historique.noter(d.choix[k].nom); fx.choix[k] = v; moteur.synchroniser();
        }, d.choix[k].nom)));
    }
    for (const k in d.params) grille.append(this.curseur(prefixe + fx.type + ":" + k));
    corps.append(grille);

    if (source && d.lfo.length) {
      const lfoBloc = h("div.lfo", h("div.lfo-titre", h("span.badge.petit", "LFO"), " Modulation par paramètre"));
      d.lfo.forEach(k => {
        const l = fx.lfo[k];
        const coche = h("input", { type: "checkbox", checked: l.on, "aria-label": "Activer le LFO pour " + d.params[k].nom });
        coche.addEventListener("change", () => { historique.noter("LFO"); l.on = coche.checked; this.rafraichir(); });
        lfoBloc.append(h("div.lfo-ligne" + (l.on ? ".on" : ""),
          h("label.lfo-nom", coche, " ", d.params[k].nom),
          this.selectionner(FORMES_LFO, l.forme, v => { historique.noter("Forme LFO"); l.forme = v; }, "Forme du LFO pour " + d.params[k].nom),
          this.curseurSimple("Vitesse", l, "vitesse", P("Vitesse", 0.05, 8, 0.5, "Hz", { log: true })),
          this.curseurSimple("Profondeur", l, "prof", P("Profondeur", 0, 100, 50, "%"))));
      });
      corps.append(lfoBloc);
    }
    carte.append(corps);
    return carte;
  },

  rendreMaster() {
    const zone = $("#master-fx");
    zone.replaceChildren();
    etat.master.fx.forEach((fx, k) => zone.append(this.carteEffet(fx, "m:fx:", "m", k, null)));
    const vol = $("#master-volume");
    vol.replaceChildren(this.curseur("m:volume", { nom: "Volume général", classe: "orange" }));
  },

  rendreChampBas() {
    const z = $("#champ-reglages");
    z.replaceChildren(
      this.curseur("c:doppler"),
      this.curseur("c:lissageMouv"),
      this.curseur("c:lissagePan"),
      h("label.bascule", { title: "Atténuation avec la distance et perte d'aigus dans l'air" },
        (() => {
          const c = h("input", { type: "checkbox", checked: etat.champ.distance, "aria-label": "Distance" });
          c.addEventListener("change", () => { historique.noter("Distance"); etat.champ.distance = c.checked; });
          this.curseurs.push({ maj: () => { c.checked = etat.champ.distance; } });
          return c;
        })(), h("span.interrupteur"), h("span", h("b", "Distance"), h("small", "Niveau + air"))),
      this.curseur("c:portee"));
  },

  rendreConnecteurs() {
    const z = $("#connecteurs");
    z.replaceChildren();
    const liste = type => Object.keys(etat.liens).filter(c => etat.liens[c] === type);
    const carte = (types, titre, sous, icone, idVal) => {
      const lies = types.flatMap(liste);
      return h("div.connecteur",
        h("div.connecteur-tete", h("span.icone", icone), h("div", h("b", titre), h("small", sous)), h("span.valeur#" + idVal)),
        lies.length
          ? h("ul", lies.map(c => h("li", h("span", (etat.liens[c] !== "vitesse" ? LIENS[etat.liens[c]].nom.slice(-1) + " → " : "") + nomChemin(c)),
            h("button.mini", { title: "Déconnecter", "aria-label": "Déconnecter", onclick: () => this.lier(c, null) }, "×"))))
          : h("p.vide", "Clic droit sur un réglage, puis « " + titre + " »."));
    };
    z.append(
      carte(["vitesse"], "Vitesse", "Plus le mouvement est rapide, plus la valeur monte", "↗", "val-vitesse"),
      carte(["x", "y"], "Position XY", "Vers la droite ou vers le bas, la valeur monte", "✣", "val-xy"));
  },

  majPositions() {
    etat.sources.forEach(s => {
      const t = $(`.pos-txt[data-id="${s.id}"]`);
      if (t) t.textContent = `X ${s.x >= 0 ? "+" : ""}${Math.round(s.x * 100)} · Y ${s.y >= 0 ? "+" : ""}${Math.round(s.y * 100)}`;
      const e = $(`input[data-pos="${s.id}"]`);
      if (e && document.activeElement !== e) e.value = Math.round(s.x * 1000);
    });
  },

  majSelection() {
    $$(".carte-source").forEach(c => {
      c.classList.toggle("selection", champ.selection.has(c.dataset.id));
      c.classList.toggle("focus", champ.focus === c.dataset.id);
    });
  },

  majLecture() {
    $$(".carte-source").forEach(c => {
      const m = moteur.sources.get(c.dataset.id), b = $(".jouer", c);
      const actif = !!(m && m.actif);
      c.classList.toggle("joue", actif);
      if (b) { b.textContent = actif ? "■" : "▶"; b.classList.toggle("actif", actif); }
    });
  },

  supprimer(id) {
    historique.noter("Supprimer la piste");
    moteur.relacher(id, true);
    etat.sources = etat.sources.filter(s => s.id !== id);
    champ.selection.delete(id);
    if (champ.focus === id) champ.focus = null;
    for (const c in etat.liens) if (c.startsWith("s:" + id + ":")) delete etat.liens[c];
    moteur.synchroniser();
    audio.router();
    this.rendre();
  },
};

/* ---------- Reordonnancement des effets de piste (glisser-deposer) ---------- */
let fxGlisse = null;
function brancherReordonnancement(carte, poignee, source, type) {
  poignee.addEventListener("dragstart", e => {
    fxGlisse = { source: source.id, type };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", type);
    carte.classList.add("glisse");
  });
  poignee.addEventListener("dragend", () => { carte.classList.remove("glisse"); fxGlisse = null; });
  poignee.addEventListener("click", e => e.stopPropagation());
  carte.addEventListener("dragover", e => {
    if (!fxGlisse || fxGlisse.source !== source.id || type === "pitch") return;
    e.preventDefault();
    const r = carte.getBoundingClientRect();
    carte.classList.toggle("cible-haut", e.clientY < r.top + r.height / 2);
    carte.classList.toggle("cible-bas", e.clientY >= r.top + r.height / 2);
  });
  carte.addEventListener("dragleave", () => carte.classList.remove("cible-haut", "cible-bas"));
  carte.addEventListener("drop", e => {
    e.preventDefault();
    carte.classList.remove("cible-haut", "cible-bas");
    if (!fxGlisse || fxGlisse.source !== source.id || fxGlisse.type === type) return;
    const r = carte.getBoundingClientRect(), apres = e.clientY >= r.top + r.height / 2;
    historique.noter("Ordre des effets");
    const fx = source.fx.find(f => f.type === fxGlisse.type);
    source.fx = source.fx.filter(f => f !== fx);
    let i = source.fx.findIndex(f => f.type === type) + (apres ? 1 : 0);
    i = Math.max(1, i);              // la hauteur reste en tete
    source.fx.splice(i, 0, fx);
    moteur.synchroniser();
    interfaceUI.rendrePistes();
  });
}

/* ---------- Dessin de l'enveloppe ---------- */
function dessinerADSR(c, env, couleur) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const tot = env.a + env.d + 0.6 + env.r || 1;
  const x = t => 6 + t / tot * (W - 12), y = v => H - 6 - v * (H - 12);
  const pts = [[0, 0], [env.a, 1], [env.a + env.d, env.s / 100], [env.a + env.d + 0.6, env.s / 100], [tot, 0]];
  g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo : g.moveTo).call(g, x(t), y(v)));
  g.lineTo(x(tot), y(0)); g.closePath();
  g.fillStyle = couleur + "26"; g.fill();
  g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo : g.moveTo).call(g, x(t), y(v)));
  g.strokeStyle = couleur; g.lineWidth = 2; g.stroke();
  g.fillStyle = couleur; pts.forEach(([t, v]) => { g.beginPath(); g.arc(x(t), y(v), 3, 0, 7); g.fill(); });
}

/* ---------- Editeur de region sur la forme d'onde ---------- */
function regionEditeur(c, infos, s) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  const t = tampons.get(s.id);
  const D = t ? t.buf.duration : 0;
  const dessiner = () => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.03)"; g.fillRect(0, 0, W, H);
    const [a, b] = s.region;
    g.fillStyle = s.couleur + "22"; g.fillRect(a * W, 0, (b - a) * W, H);
    if (t) {
      g.fillStyle = s.couleur;
      const n = t.pics.length;
      for (let i = 0; i < n; i++) {
        const xx = i / n * W, hh = Math.max(1, t.pics[i] * (H / 2 - 4));
        g.globalAlpha = (i / n >= a && i / n <= b) ? 0.95 : 0.3;
        g.fillRect(xx, H / 2 - hh, Math.max(1, W / n), hh * 2);
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = s.couleur; g.fillRect(a * W - 1, 0, 3, H); g.fillRect(b * W - 2, 0, 3, H);
    g.fillStyle = "#fff"; g.fillRect(s.depart * W - 1, 0, 2, H);
    g.beginPath(); g.moveTo(s.depart * W - 6, 0); g.lineTo(s.depart * W + 6, 0); g.lineTo(s.depart * W, 8); g.fill();
    infos.replaceChildren(
      h("span", (a * D).toFixed(2) + " s"),
      h("span", "Départ ", h("b", (s.depart * D).toFixed(2) + " s")),
      h("span", (b * D).toFixed(2) + " s"));
  };
  let prise = null;
  const pos = e => { const r = c.getBoundingClientRect(); return borne((e.clientX - r.left) / r.width, 0, 1); };
  c.addEventListener("pointerdown", e => {
    const x = pos(e), tol = 8 / c.getBoundingClientRect().width;
    c.setPointerCapture(e.pointerId);
    historique.debutGeste();
    if (Math.abs(x - s.depart) < tol) prise = "depart";
    else if (Math.abs(x - s.region[0]) < tol) prise = "a";
    else if (Math.abs(x - s.region[1]) < tol) prise = "b";
    else { s.region = [x, x]; s.depart = x; prise = { x0: x }; }
    dessiner();
  });
  c.addEventListener("pointermove", e => {
    const x = pos(e), tol = 8 / c.getBoundingClientRect().width;
    if (!prise) {
      c.style.cursor = (Math.abs(x - s.depart) < tol || Math.abs(x - s.region[0]) < tol || Math.abs(x - s.region[1]) < tol) ? "ew-resize" : "crosshair";
      return;
    }
    if (prise === "depart") s.depart = borne(x, s.region[0], s.region[1]);
    else if (prise === "a") { s.region[0] = Math.min(x, s.region[1] - 0.002); s.depart = Math.max(s.depart, s.region[0]); }
    else if (prise === "b") { s.region[1] = Math.max(x, s.region[0] + 0.002); s.depart = Math.min(s.depart, s.region[1]); }
    else { s.region = [Math.min(prise.x0, x), Math.max(prise.x0, x)]; s.depart = s.region[0]; }
    dessiner();
  });
  const fin = () => {
    if (!prise) return;
    if (s.region[1] - s.region[0] < 0.002) { s.region = [0, 1]; }
    s.depart = borne(s.depart, s.region[0], s.region[1]);
    prise = null; dessiner();
    historique.finGeste("Région");
  };
  c.addEventListener("pointerup", fin);
  c.addEventListener("pointercancel", fin);
  c.addEventListener("dblclick", () => { historique.noter("Région"); s.region = [0, 1]; s.depart = 0; dessiner(); });
  dessiner();
}
