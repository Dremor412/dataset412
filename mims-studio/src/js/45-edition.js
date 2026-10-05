"use strict";
/* ------------------------------------------------------------------ *
 *  Edition 3D -> script : chaque geste dans la vue (deplacer, ajouter *
 *  un point, relier, tracer une corde ou une membrane) devient des    *
 *  lignes du script, qui reste la reference (et s'exporte vers Max).  *
 * ------------------------------------------------------------------ */

const estPlancher = (mdl, nom) => /(^|_)sol$/.test(nom) && mdl.masses.has(nom) && mdl.masses.get(nom).genre === "ground";

/* geometrie actuelle : position de chaque masse, ~place de chaque structure */
function geometrieActuelle(mdl, desc) {
  const masses = new Map(), macros = new Map();
  for (const [nom, i] of desc.indices) masses.set(nom, [desc.gx[i], desc.gy[i], desc.gz[i]]);
  for (const mc of desc.macros) {
    const a = mc.debut, b = mc.debut + mc.nx * mc.ny - 1;
    macros.set(mc.nom, [desc.gx[a], desc.gy[a], desc.gz[a], desc.gx[b], desc.gy[b], desc.gz[b]]);
  }
  return { masses, macros };
}

/* hauteur d'un point vise (@m ou proxy [@s a] / [@m a b]) dans une geometrie */
function hauteurDans(geo, mdl, ref) {
  if (ref.nom !== undefined) return (geo.masses.get(ref.nom) || [0, 0, 0])[2];
  const pl = geo.macros.get(ref.macro);
  if (!pl) return 0;
  let a = 0.5;
  try { a = Math.min(Math.max(evalue(ref.a, valeursParams(mdl)), 0), 1); } catch (e) { /* defaut */ }
  return pl[2] + (pl[5] - pl[2]) * a;
}

const fmt = v => (Math.round(v * 100) / 100).toFixed(2);
const fmtSeuil = v => { const r = Math.round(v * 1000) / 1000; return Number.isInteger(r) ? r.toFixed(1) : String(r); };

/* Applique de nouvelles positions (masses : [x y z], structures : [x0 y0 z0 x1 y1 z1]).
 * Les contacts "geometriques" (seuil = ecart de hauteur, comme le sol ou la bille
 * au-dessus d'un objet) suivent : leur seuil est recalcule. */
function ecrireGeometrie(texte, mdl, desc, changements) {
  const avant = geometrieActuelle(mdl, desc);
  const apres = { masses: new Map(avant.masses), macros: new Map(avant.macros) };
  for (const [n, p] of changements.masses || []) apres.masses.set(n, p);
  for (const [n, p] of changements.macros || []) apres.macros.set(n, p);
  const lignes = texte.replace(/\s+$/, "").split("\n");
  const ajouts = [];
  const indexDe = re => lignes.findIndex(l => re.test(l));
  const echappe = n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const [nom, p] of changements.masses || []) {
    const m = mdl.masses.get(nom);
    if (!m) continue;
    const g = p.map(fmt).join(" ");
    if (m.geoEnLigne) {                                 // ancien dialecte : [x y z] dans la ligne
      lignes[m.ligne - 1] = lignes[m.ligne - 1].replace(/\[[^\]@]*\]/, `[${g}]`);
      continue;
    }
    const k = indexDe(new RegExp(`^\\s*~pos\\s+@${echappe(nom)}\\s`));
    if (k >= 0) lignes[k] = `~pos @${nom} ${g}`; else ajouts.push(`~pos @${nom} ${g}`);
  }
  for (const [nom, p] of changements.macros || []) {
    const g = p.map(fmt).join(" ");
    const k = indexDe(new RegExp(`^\\s*~place\\s+@${echappe(nom)}\\s`));
    if (k >= 0) lignes[k] = `~place @${nom} ${g}`; else ajouts.push(`~place @${nom} ${g}`);
  }

  if (!mdl.legacy) {
    const bouges = new Set([...(changements.masses || []).keys(), ...(changements.macros || []).keys()]);
    for (const it of mdl.interactions) {
      if (it.genre !== "contact" && it.genre !== "nlContact") continue;
      if (!bouges.has(nomRef(it.m1)) && !bouges.has(nomRef(it.m2))) continue;
      const iSeuil = ARGS[it.genre][0].length, s = it.args[iSeuil];
      const ecartAvant = hauteurDans(avant, mdl, it.m1) - hauteurDans(avant, mdl, it.m2);
      const seuilAvant = s === undefined ? 0 : Number(s);
      if (Number.isNaN(seuilAvant) || Math.abs(seuilAvant - ecartAvant) > 0.02) continue;   // pas geometrique
      const args = it.args.slice();
      args[iSeuil] = fmtSeuil(hauteurDans(apres, mdl, it.m1) - hauteurDans(apres, mdl, it.m2));
      lignes[it.ligne - 1] = `@${it.nom} ${it.genre} ${refTexte(it.m1)} ${refTexte(it.m2)} ${args.join(" ")}`;
    }
  }
  return lignes.concat(ajouts).join("\n") + "\n";
}

/* params partages (crees une fois, puis reutilises : un seul curseur pour tous) */
function paramsPartages(mdl, defs, params) {
  for (const [nom, v] of defs)
    if (!mdl.params.has(nom) && !params.some(l => l.startsWith(`@${nom} `))) params.push(`@${nom} param ${v}`);
}

/* le sol du modele (s'il y en a un) et les reglages de ses contacts */
function solDuModele(mdl) {
  const nom = [...mdl.masses.keys()].find(n => estPlancher(mdl, n));
  if (!nom) return null;
  const c = mdl.interactions.find(i => i.genre === "contact" && i.m1.nom === nom);
  return { nom, K: c ? c.args[0] : "1.0", Z: c ? c.args[1] : "0.005" };
}

/* ajoute une masse / un oscillateur / un point fixe a la position p */
function ajouterPoint(mdl, genre, p, base) {
  const params = [], corps = [], geo = [];
  const nom = nomLibre(mdl, base || { mass: "m", osc: "osc", ground: "fixe" }[genre]);
  if (genre === "mass") {
    paramsPartages(mdl, [["points_M", 1]], params);
    corps.push(`@${nom} mass points_M 0. 0.`);
  } else if (genre === "osc") {
    paramsPartages(mdl, [["points_M", 1], ["osc_K", 0.01], ["osc_Z", 0.00002]], params);
    corps.push(`@${nom} osc points_M osc_K osc_Z 0. 0.`);
  } else corps.push(`@${nom} ground 0.`);
  const sol = solDuModele(mdl);
  if (sol && genre !== "ground" && p[2] >= 0)
    corps.push(`@${nom}_s contact @${sol.nom} @${nom} ${sol.K} ${sol.Z} ${fmtSeuil(-p[2])}`);
  geo.push(`~pos @${nom} ${p.map(fmt).join(" ")}`);
  return { ajout: { params, corps, geo }, nom };
}

/* ressort + amortisseur entre deux points (params partages liens_K / liens_Z) */
function lignesLien(mdl, desc, i, j) {
  const params = [];
  const a = refAvecParams(mdl, desc, i, "lien", params);
  const b = refAvecParams(mdl, desc, j, "lien", params);
  paramsPartages(mdl, [["liens_K", 0.05], ["liens_Z", 0.0002]], params);
  const nom = nomLibre(mdl, "lien", params.map(l => l.split(/\s+/)[0].slice(1)));
  return { params, corps: [`@${nom} springDamper ${a} ${b} liens_K liens_Z`], geo: [] };
}

/* raideur d'une corde (extremites fixes, n masses de 1) pour que sa note
 * fondamentale soit @nom_hz : f = 44100/pi * sqrt(K) * sin(pi / (2 (n-1))).
 * Expression gen~ valide : elle s'exporte telle quelle vers Max. */
function raideurPourNote(nom, n, M = 1) {
  return `[${M === 1 ? "" : M + "*"}pow(3.14159*${nom}_hz/(44100*sin(3.14159/${2 * (n - 1)})),2)]`;
}

/* corde integree tracee de p0 a p1 ; membrane dans le rectangle p0-p1 */
function lignesCorde(mdl, p0, p1, genre = "string") {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const n = Math.min(Math.max(Math.round(L * 2.5), 8), 200);
  const nom = nomLibre(mdl, genre === "chain" ? "chaine" : "corde");
  // corde : accordee en Hz (la raideur K en decoule) ; chaine / corde raide : raideur K
  const params = genre === "string"
    ? [`@${nom}_hz param 110`, `@${nom}_Z param 0.0004`, `@${nom}_Zo param 0.00002`]
    : [`@${nom}_K param 0.3`, `@${nom}_Z param 0.0004`, `@${nom}_Zo param 0.00002`];
  let def = genre === "string"
    ? `@${nom} string ${n} 1. ${raideurPourNote(nom, n)} ${nom}_Z ${nom}_Zo 0. 0.`
    : `@${nom} ${genre} ${n} 1. ${nom}_K ${nom}_Z ${nom}_Zo 0. 0.`;
  if (genre === "stiffString") {
    params.push(`@${nom}_K2 param 0.1`);
    def = `@${nom} stiffString ${n} 1. ${nom}_K ${nom}_K2 ${nom}_Z ${nom}_Zo 0. 0.`;
  }
  return { ajout: { params, corps: [def], geo: [`~place @${nom} ${[...p0, ...p1].map(fmt).join(" ")}`] }, nom };
}

function lignesMembrane(mdl, p0, p1, genre = "closedMesh") {
  const nx = Math.min(Math.max(Math.round(Math.abs(p1[0] - p0[0]) * 1.6) + 1, 4), 40);
  const ny = Math.min(Math.max(Math.round(Math.abs(p1[1] - p0[1]) * 1.6) + 1, 4), 40);
  const nom = nomLibre(mdl, "peau");
  const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]);
  const y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
  return {
    ajout: {
      params: [`@${nom}_K param 0.15`, `@${nom}_Z param 0.0006`, `@${nom}_Zo param 0.00005`],
      corps: [`@${nom} ${genre} ${nx} ${ny} 1. ${nom}_K ${nom}_Z ${nom}_Zo 0. 0.`],
      geo: [`~place @${nom} ${[x0, y0, p0[2], x1, y1, p0[2]].map(fmt).join(" ")}`],
    }, nom,
  };
}

/* ecoute de plusieurs points : une sortie chacun, reparties de gauche a droite */
function lignesEcoutes(mdl, desc, indices) {
  const params = [], corps = [], geo = [];
  const pris = [];
  indices.forEach((i, k) => {
    const cible = refAvecParams(mdl, desc, i, "ecoute", params);
    let n = 1; const deja = new Set([...mdl.sorties.map(s => s.nom), ...pris]);
    while (deja.has(`out${n}`) || mdl.masses.has(`out${n}`)) n++;
    const nom = `out${n}`; pris.push(nom);
    corps.push(`@${nom} posOutput ${cible}`);
    const pan = indices.length > 1 ? -1 + 2 * k / (indices.length - 1) : 0;
    geo.push(`~sortie @${nom} pan ${fmt(pan)} gain 0`);
  });
  return { params, corps, geo };
}

/* remplace (ou cree) la ligne ~sortie d'une sortie */
function ecrireRoutage(texte, nom, r) {
  const ligne = `~sortie @${nom} pan ${fmt(r.pan)} gain ${fmt(r.gain)}` +
                (r.canal ? ` canal ${r.canal | 0}` : "") + (r.muet ? " muet" : "");
  const lignes = texte.replace(/\s+$/, "").split("\n");
  const k = lignes.findIndex(l => new RegExp(`^\\s*~sortie\\s+@${nom}(\\s|$)`).test(l));
  if (k >= 0) lignes[k] = ligne; else lignes.push(ligne);
  return lignes.join("\n") + "\n";
}
