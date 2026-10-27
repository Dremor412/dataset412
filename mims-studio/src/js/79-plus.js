"use strict";
/* ------------------------------------------------------------------ *
 *  migen-plus dans l'interface : objets modaux (bouton dans           *
 *  l'inspecteur), briques physiques (corde reelle, barre, plaque),    *
 *  nouvelles excitations (maillet de Hunt-Crossley, frottement de     *
 *  Stribeck), legende des nouveaux parametres.                        *
 * ------------------------------------------------------------------ */

const MATERIAUX = {
  // densite (kg/m3), module d'Young (GPa)
  "acier": [7850, 200], "nylon": [1150, 3], "boyau": [1300, 5], "bronze": [8800, 110],
  "laiton": [8500, 100], "aluminium": [2700, 69], "bois (palissandre)": [850, 18], "verre": [2500, 70],
};
const SR2 = 1944810000;                                   // 44100^2

Object.assign(LEGENDE, {
  longueur: ["longueur", "longueur réelle (m) : plus long = plus grave"],
  diametre: ["diamètre", "diamètre de la corde (mm) : plus épais = plus grave et plus « raide » (harmoniques étirées)"],
  epaisseur: ["épaisseur", "épaisseur de la barre (mm) : plus épais = plus aigu"],
  tension: ["tension", "tension de la corde (N) : plus tendu = plus aigu"],
  densite: ["densité", "masse volumique du matériau (kg/m³)"],
  young: ["module d'Young", "rigidité du matériau (GPa) : acier 200, bois 10-20, nylon 3"],
  t60: ["durée", "temps (s) pour que le son du mode grave baisse de 60 dB"],
  brillance: ["brillance", "0 = tous les modes durent pareil ; 1 = un mode deux fois plus aigu s'éteint deux fois plus vite"],
  hauteur: ["hauteur", "multiplie toutes les fréquences de l'objet modal (1 = d'origine, 2 = une octave au-dessus)"],
  tmod: ["modulation de tension", "plus on joue fort, plus la note monte (corde) ou glisse (gong) ; 0 = linéaire"],
  alpha: ["dureté du choc", "1 = linéaire, 1.5 = bille, 2-3 = feutre : plus on frappe fort, plus c'est brillant"],
  mus: ["frottement statique", "accroche de l'archet à l'arrêt"],
  mud: ["frottement dynamique", "frottement en glissement (plus petit que le statique : accroche-glisse)"],
  aigus: ["amortissement des aigus", "éteint plus vite les harmoniques aiguës"],
});
ORDRE_LEGENDE.push("longueur", "diametre", "tension", "epaisseur", "densite", "young", "hauteur", "t60", "brillance", "tmod", "alpha", "mus", "mud");
Object.assign(PRIORITE_ROLE, { hauteur: 0, longueur: 0, tension: 0, diametre: 1, epaisseur: 1, t60: 1, brillance: 1,
                               alpha: 1, mus: 1, mud: 2, tmod: 2, aigus: 2, densite: 3, young: 3 });
for (const r of ["longueur", "diametre", "tension", "epaisseur", "densite", "young"]) ROLES_STABILITE.add(r);

/* role d'un param d'apres son suffixe (params physiques des briques) */
const ROLE_SUFFIXE = { _L: "longueur", _d: "diametre", _T: "tension", _h: "epaisseur", _rho: "densite", _E: "young",
                       _t60: "t60", _brillance: "brillance", _hauteur: "hauteur", _tmod: "tmod", _aigus: "aigus" };
function roleParSuffixe(nom) {
  for (const [s, r] of Object.entries(ROLE_SUFFIXE)) if (nom.endsWith(s)) return r;
  return null;
}

/* ---------------- briques physiques ---------------- */

const f3 = v => +(+v).toPrecision(4);

Object.assign(BRIQUES, {
  cordeReelle: {
    titre: "Corde réelle", desc: "Corde avec flexion (migen-plus) réglée par la physique : matériau, longueur, diamètre, tension. " +
      "La note et la raideur des harmoniques en découlent.",
    champs: { materiau: ["matériau", "acier", ["acier", "nylon", "boyau", "bronze", "laiton"]],
              L: ["longueur (m)", 0.65, 0.05, 3], d: ["diamètre (mm)", 0.3, 0.05, 3], T: ["tension (N)", 70, 1, 2000],
              t60: ["durée du son (s)", 4, 0.1, 60], n: ["masses", 50, 10, 200] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "corde"), y = rangeeLibre(vue), N = (v.n | 0) - 1;
      const [rho, E] = MATERIAUX[v.materiau];
      const mu = rho * Math.PI * (v.d * 1e-3) ** 2 / 4, c = Math.sqrt(v.T / mu);
      const K = (c * N / (v.L * 44100)) ** 2, Kb = E * 1e9 * (v.d * 1e-3) ** 2 / (16 * rho) * (N / v.L) ** 4 / SR2;
      const p = [`@${nom}_L param ${v.L}`, `@${nom}_d param ${v.d}`, `@${nom}_T param ${v.T}`, `@${nom}_rho param ${rho}`,
                 `@${nom}_E param ${E}`, `@${nom}_t60 param ${v.t60}`, `@${nom}_aigus param 0.0002`, `@${nom}_tmod param 0`];
      const exK = `[pow(sqrt(${nom}_T/(${nom}_rho*0.785398*pow(${nom}_d*0.001,2)))*${N}/(${nom}_L*44100),2)]`;
      const exKb = `[${nom}_E*1000000000*pow(${nom}_d*0.001,2)/(16*${nom}_rho)*pow(${N}/${nom}_L,4)/${SR2}]`;
      const exZo = `[13.82/(${nom}_t60*44100)]`;
      const L = Math.min(Math.max(v.n * 0.35, 8), 30);
      const geo = [`~place @${nom} ${f2(-L / 2)} ${f2(y)} 4 ${f2(L / 2)} ${f2(y)} 4`];
      const instable = K + 4 * Kb > 0.9;
      if (instable) geo.push(`~modal ${nom} 40`);
      app.statut(`corde réelle : ≈ ${f3(c / (2 * v.L))} Hz` + (instable ? " — trop raide pour des masses : calculée en modal (stable)" : ""));
      return { params: p, corps: [`@${nom} bendString ${v.n | 0} 1. ${exK} ${exKb} ${nom}_aigus ${exZo} ${nom}_tmod 0 0. 0.`], geo };
    },
  },
  barre: {
    titre: "Barre (xylophone)", desc: "Barre libre aux deux bouts, avec flexion : partiels inharmoniques de xylophone / glockenspiel. " +
      "Toujours calculée en modal (stable et légère).",
    champs: { materiau: ["matériau", "bois (palissandre)", ["bois (palissandre)", "aluminium", "acier", "verre"]],
              L: ["longueur (m)", 0.3, 0.05, 2], h: ["épaisseur (mm)", 20, 1, 100], t60: ["durée du son (s)", 1.2, 0.05, 30],
              modes: ["modes", 16, 4, 80] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "barre"), y = rangeeLibre(vue), n = 40, N = n - 1;
      const [rho, E] = MATERIAUX[v.materiau];
      const f1 = 3.5608 / v.L ** 2 * Math.sqrt(E * 1e9 / rho * (v.h * 1e-3) ** 2 / 12);
      const exKb = `[${nom}_E*1000000000*pow(${nom}_h*0.001,2)/(12*${nom}_rho)*pow(${N}/${nom}_L,4)/${SR2}]`;
      app.statut(`barre : premier mode ≈ ${f3(f1)} Hz`);
      return {
        params: [`@${nom}_L param ${v.L}`, `@${nom}_h param ${v.h}`, `@${nom}_rho param ${rho}`, `@${nom}_E param ${E}`,
                 `@${nom}_hauteur param 1`, `@${nom}_t60 param ${v.t60}`, `@${nom}_brillance param 1`],
        corps: [`@${nom} bendString ${n} 1. 0. ${exKb} 0. 0. 0 1 0. 0.`],
        geo: [`~place @${nom} ${f2(-v.L * 20)} ${f2(y)} 4 ${f2(v.L * 20)} ${f2(y)} 4`, `~modal ${nom} ${v.modes | 0}`],
      };
    },
  },
  plaque: {
    titre: "Plaque / gong", desc: "Plaque avec épaisseur (migen-plus). Avec de la modulation de tension, la note glisse en s'éteignant (gong).",
    champs: { nx: ["masses en x", 16, 5, 60], ny: ["masses en y", 16, 5, 60], bords: ["bords", "centre (gong suspendu)", ["libres", "fixes", "centre (gong suspendu)"]],
              K: ["tension K", 0.02, 0, 0.5], Kb: ["flexion Kb", 0.02, 0, 0.06], tmod: ["modulation de tension", 3, 0, 50] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "plaque"), y = rangeeLibre(vue);
      const bords = ["libres", "fixes", "centre (gong suspendu)"].indexOf(v.bords);
      const lx = Math.min((v.nx - 1) * 0.6, 24), ly = Math.min((v.ny - 1) * 0.6, 24);
      return {
        params: [`@${nom}_K param ${v.K}`, `@${nom}_Kb param ${v.Kb}`, `@${nom}_aigus param 0.0004`, `@${nom}_Zo param 0.00002`, `@${nom}_tmod param ${v.tmod}`],
        corps: [`@${nom} plate ${v.nx | 0} ${v.ny | 0} 1. ${nom}_K ${nom}_Kb ${nom}_aigus ${nom}_Zo ${nom}_tmod ${bords} 0. 0.`],
        geo: [`~place @${nom} ${f2(-lx / 2)} ${f2(y - ly)} 4 ${f2(lx / 2)} ${f2(y)} 4`],
      };
    },
  },
});

/* ---------------- nouvelles excitations ---------------- */

Object.assign(EXCITATIONS, {
  maillet: { titre: "Maillet (+)", desc: "Bille au-dessus, choc de Hunt-Crossley : doux quand on effleure, brillant quand on frappe fort, sans clic (migen-plus)." },
  stribeck: { titre: "Frotter (+)", desc: "Archet à frottement de Stribeck : pression + vitesse, accroche-glisse plus naturel (migen-plus)." },
});
const _lignesExcitationBase = lignesExcitation;
lignesExcitation = function (mdl, desc, i, mode) {
  if (mode !== "maillet" && mode !== "stribeck") return _lignesExcitationBase(mdl, desc, i, mode);
  const params = [], corps = [], geo = [];
  const g = i < desc.nbNoeuds ? [desc.gx[i], desc.gy[i], desc.gz[i]] : desc.proxyGeo[i - desc.nbNoeuds];
  const entree = entreeLibre(mdl, "in");
  const base = mode === "maillet" ? "maillet" : "frottement";
  const cible = refAvecParams(mdl, desc, i, base, params);
  const nom = nomLibre(mdl, base, params.map(l => l.split(/\s+/)[0].slice(1)));
  corps.push(`@${entree} posInput 0.`);
  if (mode === "maillet") {
    params.push(`@${nom}_K param 0.3`, `@${nom}_alpha param 2.5`);
    corps.push(`@${nom} contactHC ${cible} @${entree} ${nom}_K ${nom}_alpha 0.02 -3`);
    geo.push(`~pos @${entree} ${f2(g[0])} ${f2(g[1])} ${f2(g[2] + 3)}`);
  } else {
    params.push(`@${nom}_pression param 0.02`, `@${nom}_mus param 0.8`, `@${nom}_mud param 0.3`);
    corps.push(`@${nom} friction ${cible} @${entree} ${nom}_pression ${nom}_mus ${nom}_mud 0.002 0.0005`);
    geo.push(`~pos @${entree} ${f2(g[0])} ${f2(g[1] + 0.6)} ${f2(g[2])}`);
  }
  return { params, corps, geo };
};

/* ---------------- objets modaux dans l'inspecteur ---------------- */

Object.assign(app, {
  /* groupe d'un point : structure integree, ou prefixe commun des masses (cloche_m12 -> cloche) */
  _groupeDe(el) {
    if (this.modele.macros.has(el)) return el;
    const m = /^(.*)_m\d+$/.exec(el);
    if (!m) return null;
    const n = [...this.modele.masses.keys()].filter(k => k.startsWith(m[1] + "_m")).length;
    return n >= 3 ? m[1] : null;
  },

  basculerModal(groupe, nb = 40) {
    const texte = $("editeur").value;
    const dir = this.modele.modaux.find(d => d.groupe === groupe);
    const avant = budget.charge(comptesDesc(this.desc));
    if (dir) {                                              // retour aux masses
      const lignes = texte.split("\n");
      lignes.splice(dir.ligne - 1, 1);
      this.modifierTexte(lignes.join("\n"));
      this.statut(`@${groupe} : de nouveau en masses-ressorts · CPU ${Math.round(avant * 100)} % → ${Math.round(budget.charge(comptesDesc(this.desc)) * 100)} %`);
      return;
    }
    // reglages par defaut d'apres l'amortissement du groupe
    let essai;
    try { essai = compiler(parse(texte + `\n~modal ${groupe} ${nb}\n`)).modaux.find(m => m.nom === groupe); }
    catch (e) { this.statut("calcul des modes impossible : " + e.message); return; }
    if (!essai) { this.statut(`@${groupe} : rien à calculer en modal (aucune masse mobile)`); return; }
    const params = [];
    for (const [k, v] of [["hauteur", 1], ["t60", +essai.t60.toPrecision(3)], ["brillance", +essai.brillance.toPrecision(3)]])
      if (!this.modele.params.has(`${groupe}_${k}`)) params.push(`@${groupe}_${k} param ${v}`);
    this.ajouterLignes({ params, corps: [], geo: [`~modal ${groupe} ${nb}`] });
    const apres = budget.charge(comptesDesc(this.desc));
    this.statut(`@${groupe} en modal : ${essai.nbMasses} masses → ${essai.nb} modes · CPU ${Math.round(avant * 100)} % → ${Math.round(apres * 100)} %` +
                " · règle hauteur / t60 / brillance dans Réglages");
  },
});

const _majInspecteurBase = app.majInspecteur;
app.majInspecteur = function () {
  _majInspecteurBase.call(this);
  const d = this.desc, sel = [...this.vue.multi];
  if (!d || sel.length !== 1 || sel[0] >= d.nbNoeuds) return;
  const el = d.element[sel[0]], g = this._groupeDe(el);
  if (!g) return;
  const modal = this.modele.modaux.some(m => m.groupe === g);
  const md = (d.modaux || []).find(m => m.nom === g);
  if (md) $("insp-sous").textContent += ` · objet modal : ${md.nb} modes`;
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = modal ? `↩ @${g} en masses` : `〜 @${g} en modal`;
  b.title = modal ? "revenir au calcul masse par masse"
                  : "calculer cet objet en modes (migen-plus) : stable a toutes les frequences, bien plus leger, mais lineaire (pas de contact au sol, pas de modulation de tension)";
  b.addEventListener("click", () => this.basculerModal(g));
  $("insp-actions").appendChild(b);
};

/* l'archet entraine aussi les entrees reliees par un frottement de Stribeck */
const _entreesArchetBase = app._entreesArchet;
app._entreesArchet = function () {
  const s = _entreesArchetBase.call(this);
  if (!this.modele || !this.desc) return s;
  const idx = new Map(this.desc.indices);
  for (const it of this.modele.interactions)
    if (it.genre === "friction")
      for (const r of [it.m1, it.m2])
        if (r.nom !== undefined && this.modele.masses.has(r.nom) && this.modele.masses.get(r.nom).genre === "posInput") s.add(idx.get(r.nom));
  return s;
};

/* roles des params physiques (suffixes) et des reglages modaux */
const _rolesParamsBase = app._rolesParams;
app._rolesParams = function () {
  const roles = _rolesParamsBase.call(this);
  for (const [nom] of this.modele.params) {
    const r = roleParSuffixe(nom);
    if (!r) continue;
    const ou = (roles.get(nom) || [{ ou: "@" + nom.replace(/_[^_]+$/, "") }])[0].ou;
    roles.set(nom, [{ role: r, ou }]);
  }
  return roles;
};
