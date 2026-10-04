"use strict";
/* ------------------------------------------------------------------ *
 *  Export vers Max/MSP :                                              *
 *   1. script MIMS4Max propre (entrees in1.., sorties out1..,         *
 *      seuils de contact recalcules pour l'ancien dialecte 3D)        *
 *   2. code gen~ + fichier .gendsp produits par le generateur officiel *
 *      MIMS4Max (inclus tel quel dans la page)                        *
 * ------------------------------------------------------------------ */

function versMIMS4Max(mdl, desc, texteSource) {
  const avert = [];
  const geoDe = new Map(desc.indices);                 // nom de masse -> indice
  const hauteur = ref => {
    if (ref.nom !== undefined) return desc.gz[geoDe.get(ref.nom)];
    const mc = desc.macros.find(m => m.nom === ref.macro);
    if (!mc) return 0;
    const P = valeursParams(mdl);
    const a = Math.min(Math.max(evalue(ref.a, P), 0), 1);
    const b = ref.b !== null ? Math.min(Math.max(evalue(ref.b, P), 0), 1) : 0;
    const i = Math.round(a * (mc.nx - 1)), j = mc.corde ? 0 : Math.round(b * (mc.ny - 1));
    return desc.gz[mc.debut + i * mc.ny + j];
  };

  // --- entrees / sorties : numerotation exigee par MIMS4Max (@inN, @outN)
  const entrees = [
    ...[...mdl.masses.values()].filter(m => m.genre === "posInput").map(m => m.nom),
    ...mdl.entrees.map(e => e.nom),
  ];
  const audio = [...mdl.params.values()].filter(p => p.genre === "audioParam");
  const renom = new Map();
  const tous = [...entrees, ...audio.map(p => p.entree)];
  const valides = tous.every(n => /^in\d+$/.test(n)) && new Set(tous).size === tous.length;
  if (valides) tous.forEach(n => renom.set(n, n));
  else {
    entrees.forEach((n, k) => renom.set(n, `in${k + 1}`));
    audio.forEach((p, k) => renom.set("audio:" + p.nom, `in${entrees.length + k + 1}`));
    avert.push("entrees renumerotees pour Max : " +
               [...renom].map(([a, b]) => `${a.replace("audio:", "audioParam ")} -> ${b}`).join(", "));
  }
  const sortiesValides = mdl.sorties.every(s => /^out\d+$/.test(s.nom)) &&
                         new Set(mdl.sorties.map(s => s.nom)).size === mdl.sorties.length;
  mdl.sorties.forEach((s, k) => renom.set(s.nom, sortiesValides ? s.nom : `out${k + 1}`));
  const nomDe = n => renom.get(n) || n;
  const ref = r => r.nom !== undefined ? "@" + nomDe(r.nom)
                 : r.b !== null ? `[@${r.macro} ${r.a} ${r.b}]` : `[@${r.macro} ${r.a}]`;
  const num = v => Number.isInteger(v) ? v.toFixed(1) : String(+v.toPrecision(6));

  // on transforme le texte d'origine ligne par ligne (commentaires, ordre,
  // expressions et blocs ~begin/~end sont conserves)
  const lignes = texteSource.split(/\r\n|\r|\n/);
  const nouvelles = new Map();                          // numero de ligne -> texte
  const geoAjoutee = [];
  for (const m of mdl.masses.values()) {
    if (!m.geoEnLigne) continue;                       // ancien dialecte : [x y z] dans la ligne
    if (m.genre === "posInput") nouvelles.set(m.ligne, `@${m.nom} posInput ${m.pos}`);
    else if (m.genre === "ground") nouvelles.set(m.ligne, `@${m.nom} ground ${m.pos}`);
    else nouvelles.set(m.ligne, `@${m.nom} ${m.genre} ${m.args.join(" ")} ${m.pos} ${m.vel}`);
    geoAjoutee.push(`~pos @${m.nom} ${m.geo.map(v => v.toFixed(2)).join(" ")}`);
  }
  for (const it of mdl.interactions) {
    if (!(mdl.legacy && (it.genre === "contact" || it.genre === "nlContact" || it.genre === "nlPluck"))) continue;
    const off = hauteur(it.m1) - hauteur(it.m2);
    if (Math.abs(off) < 1e-9) continue;
    if (it.genre === "nlPluck") {
      avert.push(`@${it.nom} : pincement entre points a des hauteurs differentes, ecart ignore dans Max`);
      continue;
    }
    const args = it.args.slice(), iSeuil = ARGS[it.genre][0].length, s = args[iSeuil];
    if (s === undefined) args.push(num(off));
    else if (!Number.isNaN(Number(s))) args[iSeuil] = num(Number(s) + off);
    else args[iSeuil] = `[${s}+(${num(off)})]`;
    nouvelles.set(it.ligne, `@${it.nom} ${it.genre} ${refTexte(it.m1)} ${refTexte(it.m2)} ${args.join(" ")}`);
  }
  for (const p of audio)
    if (!valides) nouvelles.set(p.ligne, `@${p.nom} audioParam @${renom.get("audio:" + p.nom)}`);

  const renomme = l => l.replace(/@([A-Za-z0-9_]+)(?![A-Za-z0-9_])/g,
                                 (t, n) => renom.has(n) ? "@" + renom.get(n) : t);
  const L = ["# MIMS script exporte par mi-gen Studio pour MIMS4Max / gen~",
             "# (les lignes ~pos / ~place gardent la geometrie 3D, Max les ignore)"];
  lignes.forEach((l, k) => {
    let t = nouvelles.has(k + 1) ? nouvelles.get(k + 1) : l;
    if (/^\s*@/.test(t)) t = t.split("#", 1)[0].replace(/\s+$/, "");   // MIMS4Max ne lit pas les # en fin de ligne
    L.push(renomme(t));
  });
  if (geoAjoutee.length) L.push("", "# geometrie 3D (mi-gen Studio)", ...geoAjoutee.map(renomme));
  return { texte: L.join("\n") + "\n", avertissements: avert };
}

/* code gen~ et .gendsp avec le generateur officiel MIMS4Max */
function genererGen(texteMIMS4Max, invariant = true) {
  const analyse = MIMS4MAX("scriptParser"), cb = MIMS4MAX("codeBuilder"), patch = MIMS4MAX("gendspCreator");
  const journal = console.log;
  console.log = () => {};                              // le generateur est bavard
  try {
    analyse.parseMIMSFile(texteMIMS4Max);
    globalThis.mdl.sampleRateInvariant = invariant ? 1 : 0;
    const [code, nbEntrees, nbSorties] = new cb.GenCodeBuilder(globalThis.mdl).compileToGenExpr();
    return {
      code: code.replace(/\\"/g, '"'),                 // tel qu'on le colle dans un codebox
      nbEntrees, nbSorties,
      gendsp: patch.generate(code, nbEntrees, nbSorties),
    };
  } catch (e) {
    throw new Error(String(e && e.message ? e.message : e));
  } finally {
    console.log = journal;
  }
}

function telecharger(nom, contenu, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contenu], { type: type + ";charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
