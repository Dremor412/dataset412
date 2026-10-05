"use strict";
/* ------------------------------------------------------------------ *
 *  Tutoriel interne : etapes guidees, chacune avec « Le faire pour    *
 *  moi » ; on passe a la suivante des que l'action est faite.         *
 * ------------------------------------------------------------------ */

const ETAPES_TUTO = [
  {
    titre: "Bienvenue dans mi-gen",
    texte: `Un modèle mi-gen, ce sont des <b>masses</b> (des points qui bougent) reliées par des
      <b>interactions</b> : ressorts, contacts, pincements, archets. Les <b>structures intégrées</b>
      (cordes, membranes) sont des grappes de masses calculées d'un bloc : c'est le plus efficace.
      On va construire une corde et une membrane, les relier, puis les jouer.`,
    faire: () => app.charger("# Mon premier modele mi-gen\n\n", "mon-modele.mdl"),
    bouton: "Commencer (modèle vide)",
    fait: () => app.modele && app.modele.masses.size + app.modele.macros.size === 0,
  },
  {
    titre: "1. Passe en mode Éditer",
    texte: `Clique <b>✎ Éditer</b> en haut à gauche de la vue (ou touche <b>Tab</b>). Une barre d'outils apparaît.
      Le <b>plan de travail</b> (grille bleutée) est la hauteur où l'on pose les éléments.`,
    faire: () => app.modeEdition(true),
    fait: () => app.vue.edition,
  },
  {
    titre: "2. Trace une corde intégrée",
    texte: `Choisis l'outil <b>〰 corde</b> (touche C), puis <b>glisse</b> dans la vue d'un bout à l'autre.
      Mi-gen crée une corde (<code>string</code>) aux extrémités fixes ; plus elle est longue, plus elle a de masses.`,
    faire: () => app.creer("corde", [-8, 0, 4], [8, 0, 4]),
    fait: () => [...app.modele.macros.values()].some(m => MACROS_CORDE.includes(m.genre)),
  },
  {
    titre: "3. Ajoute une membrane",
    texte: `Outil <b>▦ membrane</b> (touche B) : glisse un rectangle. Baisse d'abord <b>plan z</b> à 2 pour la poser
      sous la corde. C'est une <code>closedMesh</code> : une peau tendue aux bords fixes.`,
    faire: () => { $("plan-z").value = 2; app.vue.planZ = 2; app.creer("membrane", [-6, -12, 2], [6, -4, 2]); },
    fait: () => [...app.modele.macros.values()].some(m => !MACROS_CORDE.includes(m.genre)),
  },
  {
    titre: "4. Relie la corde à la membrane",
    texte: `Outil <b>╱ relier</b> (touche L) : clique un point de la corde, puis un point de la membrane.
      Sur une structure intégrée, le point devient un <b>proxy</b> : un point virtuel interpolé, dont la position
      se règle ensuite avec un curseur. C'est le principe d'un chevalet sur une table d'harmonie.`,
    faire: () => {
      const d = app.desc, c = d.macros.find(m => m.corde), p = d.macros.find(m => !m.corde);
      app.ajouterLignes(lignesLien(app.modele, d, c.debut + Math.floor(c.nx * 0.8), p.debut + Math.floor(p.nx / 2) * p.ny + Math.floor(p.ny / 2)));
    },
    fait: () => app.modele.interactions.some(i => i.m1.macro !== undefined && i.m2.macro !== undefined),
  },
  {
    titre: "5. Pince la corde",
    texte: `Repasse en <b>▶ Jouer</b> (Tab), clique un point de la corde : l'inspecteur (à droite) propose
      <b>Pincer</b>. Une bille jaune apparaît : c'est une <b>entrée de position</b> que tu déplaces à la souris.`,
    faire: () => {
      app.modeEdition(false);
      const d = app.desc, c = d.macros.find(m => m.corde);
      app.ajouterLignes(lignesExcitation(app.modele, d, c.debut + Math.floor(c.nx * 0.27), "pincer"));
    },
    fait: () => app.modele.interactions.some(i => i.genre === "nlPluck"),
  },
  {
    titre: "6. Écoute en stéréo",
    texte: `<b>Maj+clic</b> sur un point de la corde puis un point de la membrane, puis
      <b>🎧 Écouter ces 2 points</b>. Chacun devient une sortie, l'une à gauche, l'autre à droite.
      L'onglet <b>Écoute</b> règle panoramique, gain, ou un canal par sortie (multicanal).`,
    faire: () => {
      const d = app.desc, c = d.macros.find(m => m.corde), p = d.macros.find(m => !m.corde);
      app.ecouterPoints([c.debut + Math.floor(c.nx * 0.6), p.debut + 3 * p.ny + 3]);
    },
    fait: () => app.modele.sorties.length >= 2,
  },
  {
    titre: "7. Joue !",
    texte: `Clique <b>🔈 Son</b> en bas. Attrape la <b>bille jaune</b> et fais-la <b>traverser</b> la corde
      (vers le bas ou le haut) : elle la pince. Ou <b>barre espace</b> pour un coup.`,
    faire: () => { if (!son.actif) app.basculeSon(); },
    fait: () => son.actif,
  },
  {
    titre: "8. Règle le son",
    texte: `Onglet <b>Réglages</b> : chaque paramètre est un curseur qui agit pendant que ça joue.
      La <b>légende</b> explique M (masse), K (raideur), Z (amortissement)… Monte <b>corde_K</b> : la note monte.
      Si ça « explose », <b>🛟 Secours</b> revient aux derniers réglages stables.`,
    faire: () => app.onglet("reglages"),
    fait: () => $("p-reglages").classList.contains("actif"),
  },
  {
    titre: "9. Le frottement (archet)",
    texte: `Un archet, c'est une <b>entrée qui avance à vitesse constante</b>, reliée à la corde par un
      <code>nlBow</code>. Quand elle glisse lentement, le frottement « colle » la corde et l'entraîne ;
      la corde finit par décrocher, revient, se recolle… Cet <b>accroche-glisse</b> entretient le son,
      comme un violon. Clique un point de la corde → <b>Frotter</b> : l'archet démarre (curseur
      <b>🎻 archet</b> en bas : vitesse, 0 = arrêt). <b>Znl</b> = pression, <b>Vscale</b> = vitesse d'accroche.`,
    faire: () => {
      const d = app.desc, c = d.macros.find(m => m.corde);
      app.ajouterLignes(lignesExcitation(app.modele, d, c.debut + Math.floor(c.nx * 0.12), "frotter"));
      app.archet = 0.4; $("sld-archet").value = 0.4; $("val-archet").textContent = "0.40"; app._appliqueArchet();
    },
    fait: () => app.modele.interactions.some(i => i.genre === "nlBow"),
  },
  {
    titre: "10. Emporte-le dans Max",
    texte: `Onglet <b>Max</b> : télécharge le <b>.gendsp</b>, range-le à côté de ton patch et crée
      <code>[gen~ @gen nom]</code> vers <code>[dac~]</code> (package mi-gen installé). Les sorties <code>out1</code>,
      <code>out2</code>… sont tes points d'écoute. Bravo, tu sais tout faire !`,
    faire: () => app.onglet("export"),
    fait: () => $("p-export").classList.contains("actif"),
  },
];

const tuto = {
  etape: 0,
  ouvert: false,

  init() {
    $("tuto-faire").addEventListener("click", () => {
      const e = ETAPES_TUTO[this.etape];
      e.faire();
      if (this.etape === 0) this.aller(1); else this.verifier();
    });
    $("tuto-suiv").addEventListener("click", () => this.aller(this.etape + 1));
    $("tuto-prec").addEventListener("click", () => this.aller(this.etape - 1));
    $("tuto-fermer").addEventListener("click", () => this.fermer());
    document.querySelectorAll("[data-action=tuto]").forEach(b => b.addEventListener("click", () => this.ouvrir()));
    let vu = true;
    try { vu = localStorage.getItem("migen-tuto-vu") === "1"; } catch (e) { /* stockage indisponible */ }
    if (!vu) setTimeout(() => this.ouvrir(), 600);
  },

  ouvrir() { this.ouvert = true; $("tuto").hidden = false; this.aller(0); },

  fermer() {
    this.ouvert = false; $("tuto").hidden = true;
    try { localStorage.setItem("migen-tuto-vu", "1"); } catch (e) { /* rien */ }
  },

  aller(k) {
    if (k >= ETAPES_TUTO.length) { this.fermer(); return; }
    this.etape = Math.max(0, k);
    const e = ETAPES_TUTO[this.etape];
    $("tuto-etape").textContent = `Tutoriel · étape ${this.etape + 1} / ${ETAPES_TUTO.length}`;
    $("tuto-titre").textContent = e.titre;
    $("tuto-texte").innerHTML = e.texte;
    $("tuto-faire").textContent = e.bouton || "Le faire pour moi";
    $("tuto-suiv").textContent = this.etape === ETAPES_TUTO.length - 1 ? "Terminer" : "Suivant ▶";
    $("tuto").classList.remove("fait");
    this._attente = false;
  },

  /* appele apres chaque changement : passe a l'etape suivante si c'est fait */
  verifier() {
    if (!this.ouvert || this._attente || !app.modele) return;
    const e = ETAPES_TUTO[this.etape];
    let ok = false;
    try { ok = e.fait(); } catch (err) { ok = false; }
    if (!ok || this.etape === 0) return;
    $("tuto").classList.add("fait");
    this._attente = true;
    setTimeout(() => { if (this.ouvert) this.aller(this.etape + 1); }, 1200);
  },
};
