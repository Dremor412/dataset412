"use strict";
/* ------------------------------------------------------------------ *
 *  Modeles prets a jouer et briques a ajouter d'un clic.              *
 *  Tout est ecrit au format MIMS4Max : ce qu'on construit ici         *
 *  s'exporte tel quel vers Max.                                       *
 * ------------------------------------------------------------------ */

const MODELES_PRETS = [
  {
    id: "corde-pincee", titre: "Corde pincée",
    desc: "Corde intégrée de 60 masses. Glisse la bille jaune à travers la corde pour la pincer ; règle le point de pincement et d'écoute.",
    script: () => `# Corde pincee (structure integree + proxies)
@corde_K param 0.3
@corde_Z param 0.0004
@corde_Zo param 0.00002
@pince_pos param 0.27
@ecoute_pos param 0.81
@pince_K param 0.5
@pince_echelle param 0.1

@corde string 60 1. corde_K corde_Z corde_Zo 0. 0.
@in1 posInput 0.
@pince nlPluck [@corde pince_pos] @in1 pince_K pince_echelle 0.001
@out1 posOutput [@corde ecoute_pos]
@out2 posOutput [@corde 0.5]

~place @corde -12 0 4 12 0 4
~pos @in1 -5.52 0 4
`,
  },
  {
    id: "corde-frottee", titre: "Corde frottée (archet)",
    desc: "Corde raide de 120 masses (exemple officiel « ExpressiveBowing »). Monte le curseur « archet » pour frotter.",
    script: () => `# Corde frottee : l'archet est une entree qui avance a vitesse constante
@corde_K param 0.7
@corde_K2 param 0.2
@corde_Z param 0.0009
@corde_Zo param 0.00016
@archet_pos param 0.13
@archet_pression param 0.6

@corde stiffString 120 1. corde_K corde_K2 corde_Z corde_Zo 0. 0.
@in1 posInput 0.
@archet nlBow [@corde archet_pos] @in1 0.1*archet_pression [0.002+0.004*archet_pression]
@out1 posOutput [@corde 0.96]
@out2 posOutput [@corde 0.98]

~place @corde -14 0 4 14 0 4
~pos @in1 -10.36 0 4
`,
  },
  {
    id: "corde-marteau", titre: "Corde au marteau",
    desc: "Un marteau (oscillateur) au-dessus de la corde, poussé par une entrée de force : Frapper (ou espace) le lance.",
    script: () => `# Corde frappee par un marteau
@corde_K param 0.25
@corde_Z param 0.0003
@corde_Zo param 0.00003
@frappe_pos param 0.15
@ecoute_pos param 0.7

@corde string 50 1. corde_K corde_Z corde_Zo 0. 0.
@marteau osc 3. 0.0005 0.003 0. 0.
@choc contact [@corde frappe_pos] @marteau 0.2 0.01 -1.5
@in1 frcInput @marteau
@out1 posOutput [@corde ecoute_pos]

~place @corde -12 0 4 12 0 4
~pos @marteau -8.4 0 5.5
`,
  },
  {
    id: "membrane", titre: "Membrane frappée",
    desc: "Membrane intégrée 16×16 bords fixes. Descends la bille sur la peau ; déplace le point de frappe et d'écoute en x et y.",
    script: () => `# Membrane (closedMesh) frappee par une bille
@peau_K param 0.15
@peau_Z param 0.0006
@peau_Zo param 0.00005
@frappe_x param 0.4
@frappe_y param 0.35
@ecoute_x param 0.7
@ecoute_y param 0.6

@peau closedMesh 16 16 1. peau_K peau_Z peau_Zo 0. 0.
@in1 posInput 0.
@choc contact [@peau frappe_x frappe_y] @in1 0.1 0.002 -3
@out1 posOutput [@peau ecoute_x ecoute_y]
@out2 posOutput [@peau 0.5 0.5]

~place @peau -8 -8 4 8 8 4
~pos @in1 -1.6 -2.4 7
`,
  },
  {
    id: "corde-membrane", titre: "Corde + membrane couplées",
    desc: "Une corde pincée transmet sa vibration à une membrane par un ressort, comme un chevalet sur une table d'harmonie.",
    script: () => `# Corde pincee couplee a une membrane (chevalet)
@corde_K param 0.3
@corde_Z param 0.0004
@peau_K param 0.1
@peau_Z param 0.0008
@couplage_K param 0.02
@pince_pos param 0.3

@corde string 50 1. corde_K corde_Z 0.00002 0. 0.
@table cornerMesh 12 9 2. peau_K peau_Z 0.00005 0. 0.
@in1 posInput 0.
@pince nlPluck [@corde pince_pos] @in1 0.5 0.1 0.001
@chevalet springDamper [@corde 0.9] [@table 0.5 0.5] couplage_K 0.0001
@out1 posOutput [@table 0.3 0.7]
@out2 posOutput [@corde 0.5]

~place @corde -10 0 8 10 0 8
~place @table -7 -5 4 7 5 4
~pos @in1 -4 0 8
`,
  },
  {
    id: "oscillateurs", titre: "Oscillateurs couplés",
    desc: "Trois oscillateurs reliés par des ressorts : la brique de base de mi-gen. Frappe, puis écoute les battements.",
    script: () => `# Trois oscillateurs couples
@K param 0.01
@Z param 0.00001
@couplage param 0.0005

@o1 osc 1. K Z 0. 0.
@o2 osc 1. K*1.07 Z 0. 0.
@o3 osc 1. K*1.19 Z 0. 0.
@r1 spring @o1 @o2 couplage
@r2 spring @o2 @o3 couplage
@in1 frcInput @o1
@out1 posOutput @o1
@out2 posOutput @o3

~pos @o1 -4 0 4
~pos @o2 0 0 4
~pos @o3 4 0 4
`,
  },
];

/* ---------------- briques a ajouter ---------------- */

function nomLibre(mdl, base, enAttente = []) {
  const pris = new Set([...enAttente, ...mdl.params.keys(), ...mdl.masses.keys(), ...mdl.macros.keys(),
                        ...mdl.interactions.map(i => i.nom), ...mdl.entrees.map(e => e.nom),
                        ...mdl.sorties.map(s => s.nom)]);
  if (!pris.has(base) && !/^(in|out)\d*$/.test(base)) return base;
  for (let k = 1; ; k++) if (!pris.has(base + k)) return base + k;
}

function entreeLibre(mdl, prefixe) {
  const pris = new Set([...mdl.masses.keys(), ...mdl.entrees.map(e => e.nom), ...mdl.sorties.map(s => s.nom),
                        ...[...mdl.params.values()].filter(p => p.entree).map(p => p.entree)]);
  for (let k = 1; ; k++) if (!pris.has(prefixe + k)) return prefixe + k;
}

const f2 = v => (Math.round(v * 100) / 100).toFixed(2);

/* place libre sous ce qui existe deja */
function rangeeLibre(vue) {
  const b = vue.desc && vue.desc.nbNoeuds ? vue.bornes() : [0, 0, 6, 6, 0, 0];
  return b[2] - 6;
}

const BRIQUES = {
  corde: {
    titre: "Corde", desc: "Corde intégrée mi-gen (extrémités fixes). Raide = plus brillante, chaîne = libre aux deux bouts.",
    champs: { genre: ["type", "string", ["string", "stiffString", "chain"]], n: ["masses", 50, 3, 1000],
              M: ["masse", 1, 0.01, 100], K: ["raideur K", 0.3, 0.0001, 1], Z: ["amortissement Z", 0.0004, 0, 0.1],
              Zo: ["frein vers le repos Zo", 0.00002, 0, 0.1], K2: ["raideur de flexion K2 (corde raide)", 0.1, 0, 1] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, v.genre === "chain" ? "chaine" : "corde"), y = rangeeLibre(vue);
      const L = Math.min(Math.max(v.n * 0.35, 8), 30);
      const p = [`@${nom}_K param ${v.K}`, `@${nom}_Z param ${v.Z}`, `@${nom}_Zo param ${v.Zo}`];
      let def = `@${nom} ${v.genre} ${v.n | 0} ${v.M} ${nom}_K ${nom}_Z ${nom}_Zo 0. 0.`;
      if (v.genre === "stiffString") { p.push(`@${nom}_K2 param ${v.K2}`); def = `@${nom} stiffString ${v.n | 0} ${v.M} ${nom}_K ${nom}_K2 ${nom}_Z ${nom}_Zo 0. 0.`; }
      return { params: p, corps: [def], geo: [`~place @${nom} ${f2(-L / 2)} ${f2(y)} 4 ${f2(L / 2)} ${f2(y)} 4`] };
    },
  },
  membrane: {
    titre: "Membrane", desc: "Membrane intégrée mi-gen (grille de masses). Bords fixes, coins fixes ou libres.",
    champs: { genre: ["bords", "closedMesh", ["closedMesh", "cornerMesh", "mesh"]], nx: ["masses en x", 20, 3, 200],
              ny: ["masses en y", 20, 3, 200], M: ["masse", 1, 0.01, 100], K: ["raideur K", 0.15, 0.0001, 1],
              Z: ["amortissement Z", 0.0006, 0, 0.1], Zo: ["frein vers le repos Zo", 0.00005, 0, 0.1] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "peau"), y = rangeeLibre(vue);
      const lx = Math.min((v.nx - 1) * 0.6, 24), ly = Math.min((v.ny - 1) * 0.6, 24);
      return {
        params: [`@${nom}_K param ${v.K}`, `@${nom}_Z param ${v.Z}`, `@${nom}_Zo param ${v.Zo}`],
        corps: [`@${nom} ${v.genre} ${v.nx | 0} ${v.ny | 0} ${v.M} ${nom}_K ${nom}_Z ${nom}_Zo 0. 0.`],
        geo: [`~place @${nom} ${f2(-lx / 2)} ${f2(y - ly)} 4 ${f2(lx / 2)} ${f2(y)} 4`],
      };
    },
  },
  oscillateur: {
    titre: "Oscillateur", desc: "Masse rappelée vers sa position de repos (ressort + frein). Sa fréquence vient de K / M.",
    champs: { M: ["masse", 1, 0.01, 100], K: ["raideur K", 0.01, 0, 1], Z: ["amortissement Z", 0.00002, 0, 0.1] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "osc"), y = rangeeLibre(vue);
      return { params: [], corps: [`@${nom} osc ${v.M} ${v.K} ${v.Z} 0. 0.`], geo: [`~pos @${nom} 0 ${f2(y)} 4`] };
    },
  },
  masse: {
    titre: "Masse libre", desc: "Masse sans rappel : il faut la relier à quelque chose.",
    champs: { M: ["masse", 1, 0.01, 100] },
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "m"), y = rangeeLibre(vue);
      return { params: [], corps: [`@${nom} mass ${v.M} 0. 0.`], geo: [`~pos @${nom} 0 ${f2(y)} 4`] };
    },
  },
  fixe: {
    titre: "Point fixe", desc: "Point immobile (ground), pour accrocher des ressorts.",
    champs: {},
    lignes(mdl, v, vue) {
      const nom = nomLibre(mdl, "fixe"), y = rangeeLibre(vue);
      return { params: [], corps: [`@${nom} ground 0.`], geo: [`~pos @${nom} 0 ${f2(y)} 0`] };
    },
  },
};

/* --- actions sur un point selectionne : exciter, ecouter, relier --- */

/* reference MIMS d'un point du modele compile : @m ou [@corde a] / [@peau a b] */
function referencePoint(desc, i) {
  if (i < 0) return null;
  if (i >= desc.nbNoeuds) return { proxy: true, texte: desc.proxies[i - desc.nbNoeuds].ref };
  const el = desc.element[i];
  if (el === desc.noms[i]) return { nom: el, texte: "@" + el };
  const mc = desc.macros.find(m => m.nom === el);
  const k = i - mc.debut, ii = Math.floor(k / mc.ny), jj = k % mc.ny;
  const a = mc.nx > 1 ? ii / (mc.nx - 1) : 0, b = mc.ny > 1 ? jj / (mc.ny - 1) : 0;
  return { macro: el, a, b: mc.corde ? null : b, corde: mc.corde };
}

/* texte de reference, avec des params de position pour les structures
 * (un curseur les deplacera ensuite le long de la corde / sur la peau) */
function refAvecParams(mdl, desc, i, base, params) {
  const r = referencePoint(desc, i);
  if (!r) return null;
  if (r.texte) return r.texte;
  const pris = () => params.map(l => l.split(/\s+/)[0].slice(1));
  const pa = nomLibre(mdl, `${base}_${r.corde ? "pos" : "x"}`, pris());
  params.push(`@${pa} param ${f2(r.a)}`);
  if (r.corde) return `[@${r.macro} ${pa}]`;
  const pb = nomLibre(mdl, `${base}_y`, pris());
  params.push(`@${pb} param ${f2(r.b)}`);
  return `[@${r.macro} ${pa} ${pb}]`;
}

const EXCITATIONS = {
  frapper: { titre: "Frapper (bille)", desc: "Une bille au-dessus : descends-la pour taper (contact)." },
  pincer: { titre: "Pincer", desc: "Une bille à la hauteur du point : traverse-le pour pincer (nlPluck)." },
  frotter: { titre: "Frotter (archet)", desc: "Un archet qui avance tout seul : règle sa vitesse avec le curseur archet (nlBow)." },
  pousser: { titre: "Coup de force", desc: "Entrée de force : Frapper (ou espace) donne un coup (frcInput)." },
};

function lignesExcitation(mdl, desc, i, mode) {
  const params = [], corps = [], geo = [];
  const g = [desc.gx, desc.gy, desc.gz].map(a => i < desc.nbNoeuds ? a[i] : 0);
  if (i >= desc.nbNoeuds) { const p = desc.proxyGeo[i - desc.nbNoeuds]; g[0] = p[0]; g[1] = p[1]; g[2] = p[2]; }
  if (mode === "pousser") {
    const cible = refAvecParams(mdl, desc, i, "force", params);
    corps.push(`@${entreeLibre(mdl, "in")} frcInput ${cible}`);
    return { params, corps, geo };
  }
  const entree = entreeLibre(mdl, "in");
  const base = { frapper: "frappe", pincer: "pince", frotter: "archet" }[mode];
  const cible = refAvecParams(mdl, desc, i, base, params);
  const nom = nomLibre(mdl, base);
  corps.push(`@${entree} posInput 0.`);
  if (mode === "frapper") {
    corps.push(`@${nom} contact ${cible} @${entree} 0.1 0.002 -3`);
    geo.push(`~pos @${entree} ${f2(g[0])} ${f2(g[1])} ${f2(g[2] + 3)}`);
  } else if (mode === "pincer") {
    corps.push(`@${nom} nlPluck ${cible} @${entree} 0.5 0.1 0.001`);
    geo.push(`~pos @${entree} ${f2(g[0])} ${f2(g[1] + 0.6)} ${f2(g[2])}`);
  } else {
    corps.push(`@${nom} nlBow ${cible} @${entree} 0.06 0.004`);
    geo.push(`~pos @${entree} ${f2(g[0])} ${f2(g[1] + 0.6)} ${f2(g[2])}`);
  }
  return { params, corps, geo };
}

function lignesEcoute(mdl, desc, i, genre = "posOutput") {
  const params = [];
  const cible = refAvecParams(mdl, desc, i, "ecoute", params);
  return { params, corps: [`@${entreeLibre(mdl, "out")} ${genre} ${cible}`], geo: [] };
}

function lignesRelier(mdl, desc, i, j) {
  const params = [];
  const a = refAvecParams(mdl, desc, i, "lien", params);
  const b = refAvecParams(mdl, desc, j, "lien", params);
  const nom = nomLibre(mdl, "lien", params.map(l => l.split(/\s+/)[0].slice(1)));
  params.push(`@${nom}_K param 0.02`, `@${nom}_Z param 0.0002`);
  return { params, corps: [`@${nom} springDamper ${a} ${b} ${nom}_K ${nom}_Z`], geo: [] };
}

/* insere des lignes dans le script : params en haut, corps avant la geometrie */
function insererLignes(texte, ajout) {
  const lignes = texte.replace(/\s+$/, "").split("\n");
  let iParam = -1, iGeo = lignes.length;
  lignes.forEach((l, k) => { if (/^\s*@\S+\s+(param|audioParam)\b/.test(l)) iParam = k; });
  for (let k = 0; k < lignes.length; k++)
    if (/^\s*~(pos|place)\b/.test(lignes[k]) || /^#\s*geometrie/i.test(lignes[k])) { iGeo = k; break; }
  const res = lignes.slice();
  if (ajout.geo.length) res.push(...ajout.geo);
  if (ajout.corps.length) res.splice(iGeo, 0, ...ajout.corps, "");
  if (ajout.params.length) res.splice(iParam + 1, 0, ...ajout.params);
  return res.join("\n") + "\n";
}

/* supprime un element et tout ce qui le reference */
function supprimerElement(texte, nom) {
  const re = new RegExp(`@${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`);
  const garde = [], retires = [];
  for (const l of texte.split("\n")) {
    const code = l.split("#", 1)[0];
    if (re.test(code)) retires.push(l.trim()); else garde.push(l);
  }
  return { texte: garde.join("\n"), retires };
}
