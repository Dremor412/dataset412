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

  // migen-plus : MIMS4Max ne connait pas ces structures. Pour la generation,
  // on les deguise en structure officielle de meme forme (corde / membrane),
  // puis on remplace l'appel dans le code gen~ (postTraiterPlus).
  const plus = [], deguises = new Map();
  for (const mc of mdl.macros.values()) {
    if (mc.genre === "bendString") {
      plus.push({ nom: mc.nom, genre: mc.genre, args: mc.args });
      deguises.set(mc.ligne, `@${mc.nom} stiffString ${mc.args.slice(0, 5).join(" ")} ${mc.pos} ${mc.vel}`);
    } else if (mc.genre === "plate") {
      plus.push({ nom: mc.nom, genre: mc.genre, args: mc.args });
      const a = mc.args;
      deguises.set(mc.ligne, `@${mc.nom} mesh ${[a[0], a[1], a[2], a[3], a[5]].join(" ")} ${mc.pos} ${mc.vel}`);
    }
  }
  // objets modaux (~modal) : le .gendsp calcule les modes (compute_modal) ; le
  // .mdl MIMS4Max garde la version masses-ressorts complete (toujours valide)
  const supprimees = new Set(), refsModales = new Map();     // nom de masse -> [@groupe p]
  for (const md of desc.modaux || []) {
    // une structure migen-plus passee en modal n'est plus qu'un objet modal
    for (let k = plus.length - 1; k >= 0; k--) if (plus[k].nom === md.nom && plus[k].genre !== "modal") plus.splice(k, 1);
    const reg = (nom, def) => mdl.params.has(`${md.nom}_${nom}`) ? `${md.nom}_${nom}` : String(+def.toPrecision(6));
    const entree = { genre: "modal", nom: md.nom, nb: md.nb, omega: md.omega, forme: md.macro || "points",
                     nx: md.nx, ny: md.ny, hauteur: reg("hauteur", md.hauteur), t60: reg("t60", md.t60),
                     brillance: reg("brillance", md.brillance), lignes: [] };
    if (md.macro) {
      const mc = mdl.macros.get(md.nom);
      deguises.set(mc.ligne, md.macro === "1d" ? `@${md.nom} chain ${md.nb} 1. 0. 0. 0. 0.`
                                               : `@${md.nom} mesh ${md.nx} ${md.ny} 1. 0. 0. 0. 0.`);
      for (let r = 0; r < md.membres.length; r++) entree.lignes.push(md.lignes.slice(r * md.nb, (r + 1) * md.nb));
    } else {
      const membres = new Set(md.membres.map(i => desc.noms[i]));
      const plancher = n => /(^|_)sol$/.test(n);
      let premiere = Infinity;
      for (const nom of membres) { const m = mdl.masses.get(nom); supprimees.add(m.ligne); premiere = Math.min(premiere, m.ligne); }
      for (const it of mdl.interactions) {
        const a = it.m1.nom, b = it.m2.nom;
        const interne = a !== undefined && b !== undefined && membres.has(a) && membres.has(b) && ["spring", "damper", "springDamper"].includes(it.genre);
        const sol = (a !== undefined && plancher(a) && membres.has(b)) || (b !== undefined && plancher(b) && membres.has(a));
        if (interne || sol) supprimees.add(it.ligne);
      }
      supprimees.delete(premiere);
      deguises.set(premiere, `@${md.nom} chain ${md.nb} 1. 0. 0. 0. 0.`);
      // points vises de l'exterieur : une ligne de formes chacun
      const vises = [];
      for (const it of mdl.interactions) if (!supprimees.has(it.ligne)) for (const r of [it.m1, it.m2]) if (r.nom !== undefined && membres.has(r.nom)) vises.push(r.nom);
      for (const s2 of [...mdl.sorties, ...mdl.entrees]) if (s2.cible.nom !== undefined && membres.has(s2.cible.nom)) vises.push(s2.cible.nom);
      for (const nom of new Set(vises)) {
        const r = md.membres.indexOf(new Map(desc.indices).get(nom));
        refsModales.set(nom, `[@${md.nom} ${entree.lignes.length}]`);
        entree.lignes.push(md.lignes.slice(r * md.nb, (r + 1) * md.nb));
      }
    }
    plus.push(entree);
  }
  const utilisePlus = plus.length > 0 || mdl.interactions.some(i => TYPES_PLUS.includes(i.genre));
  if (utilisePlus) avert.push("ce modèle utilise migen-plus : le .gendsp demande migen-plus.genexpr à côté des librairies mi-gen " +
                              "(le .mdl MIMS4Max ne peut pas être compilé par MIMS4Max)");

  const renomme = l => l.replace(/@([A-Za-z0-9_]+)(?![A-Za-z0-9_])/g,
                                 (t, n) => renom.has(n) ? "@" + renom.get(n) : t);
  const ecrit = avecDeguises => {
    const L = ["# MIMS script exporte par mi-gen Studio pour MIMS4Max / gen~",
               "# (les lignes ~pos / ~place gardent la geometrie 3D, Max les ignore)"];
    lignes.forEach((l, k) => {
      if (avecDeguises && supprimees.has(k + 1)) return;
      let t = avecDeguises && deguises.has(k + 1) ? deguises.get(k + 1) : nouvelles.has(k + 1) ? nouvelles.get(k + 1) : l;
      if (/^\s*@/.test(t)) t = t.split("#", 1)[0].replace(/\s+$/, "");   // MIMS4Max ne lit pas les # en fin de ligne
      if (avecDeguises && refsModales.size && /^\s*@/.test(t))
        t = t.replace(/@([A-Za-z0-9_]+)(?![A-Za-z0-9_])/g, (m, n) => refsModales.has(n) ? refsModales.get(n) : m);
      L.push(renomme(t));
    });
    if (geoAjoutee.length) L.push("", "# geometrie 3D (mi-gen Studio)", ...geoAjoutee.map(renomme));
    return L.join("\n") + "\n";
  };
  return { texte: ecrit(false), texteGen: ecrit(true), plus, avertissements: avert };
}

/* le generateur officiel apprend les interactions de migen-plus (son
 * dictionnaire est fait pour ca : nom de fonction + noms d'arguments, qui
 * decident aussi de la mise a l'echelle _Ksr / _Zsr) */
function etendreMIMS4Max() {
  const d = MIMS4MAX("phyDict");
  if (d.genModDict.contactHC) return;
  d.interaction_modules.push("contactHC", "friction");
  d.genModDict.contactHC = { func: "compute_contact_hc", nbArgs: 3, argTypes: ["K", "alpha", "Z"], optArgs: ["thresh"] };
  d.genModDict.friction = { func: "compute_friction", nbArgs: 5, argTypes: ["Knl", "mus", "mud", "Vscale", "Znl"], optArgs: [] };
}

/* remplace les structures deguisees par leur vrai appel migen-plus */
function postTraiterPlus(code, plus, utilisePlus) {
  if (!utilisePlus) return code;
  code = code.replace(/(require\(\\"migen-lib\\"\);)/, '$1\nrequire(\\"migen-plus\\");');
  const t = x => String(x === undefined ? 0 : x).replace(/^\[|\]$/g, "");
  for (const p of plus) {
    if (p.genre === "modal") { code = postTraiterModal(code, p); continue; }
    const a = p.args.map(t);
    let ancien, appel;
    if (p.genre === "bendString") {
      ancien = "compute_stiff_string";
      appel = `compute_bend_string(${p.nom}, ${a[0]}, ${a[1]}, ${a[2]} * _Ksr, ${a[3]} * _Ksr, ${a[4]} * _Zsr, ` +
              `Zo = ${t(a[5])} * _Zsr, tmod = ${t(a[6])} * _Ksr, libre = ${t(a[7])});`;
    } else {
      ancien = "compute_open_mesh";
      appel = `compute_plate(${p.nom}, ${a[0]}, ${a[1]}, ${a[2]}, ${a[3]} * _Ksr, ${a[4]} * _Ksr, ${a[5]} * _Zsr, ` +
              `Zo = ${t(a[6])} * _Zsr, tmod = ${t(a[7])} * _Ksr, bords = ${t(a[8])});`;
    }
    const re = new RegExp(`${ancien}\\(${p.nom},[^\\n]*`);
    if (!re.test(code)) throw new Error(`export migen-plus : appel de @${p.nom} introuvable`);
    code = code.replace(re, appel);
  }
  return code;
}

/* objet modal : Data des modes et des formes, compute_modal, proxies modaux,
 * pulsations et formes ecrites dans le bloc d'initialisation */
function postTraiterModal(code, p) {
  const nom = p.nom, R = Math.max(p.lignes.length, 1);
  const reData = new RegExp(`Data ${nom}\\(3, \\d+\\);`);
  if (!reData.test(code)) throw new Error(`export modal : Data de @${nom} introuvable`);
  code = code.replace(reData, `Data ${nom}(8, ${p.nb});\nData ${nom}_formes(${R}, ${p.nb});`);
  const reCalc = new RegExp(`compute_(chain|open_mesh)\\(${nom},[^\\n]*`);
  if (!reCalc.test(code)) throw new Error(`export modal : calcul de @${nom} introuvable`);
  code = code.replace(reCalc, `compute_modal(${nom}, ${p.nb}, ${p.hauteur} * _Zsr, ${p.t60}, ${p.brillance});`);
  const suffixe = p.forme === "1d" ? "_modal_corde" : p.forme === "2d" ? "_modal_grille" : "_modal";
  const ancien = p.forme === "2d" ? "mesh" : "string";
  code = code.replace(new RegExp(`(set|apply)_proxy_(pos|frc)_${ancien}\\((\\w+), ${nom}, `, "g"),
                      (m, a, b, x) => `${a}_proxy_${b}${suffixe}(${x}, ${nom}, ${nom}_formes, `);
  const init = [`// objet modal ${nom} : ${p.nb} modes (pulsations a 44,1 kHz, formes aux points utiles)`];
  p.omega.forEach((w, k) => init.push(`poke(${nom}, ${w}, 3, ${k});`));
  p.lignes.forEach((l, r) => l.forEach((v, k) => { if (v !== 0) init.push(`poke(${nom}_formes, ${v}, ${r}, ${k});`); }));
  return code.replace("model_init = 1;", init.join("\n") + "\nmodel_init = 1;");
}

/* code gen~ et .gendsp avec le generateur officiel MIMS4Max */
function genererGen(texteMIMS4Max, invariant = true, plus = [], utilisePlus = false) {
  etendreMIMS4Max();
  const analyse = MIMS4MAX("scriptParser"), cb = MIMS4MAX("codeBuilder"), patch = MIMS4MAX("gendspCreator");
  const journal = console.log;
  console.log = () => {};                              // le generateur est bavard
  try {
    analyse.parseMIMSFile(texteMIMS4Max);
    globalThis.mdl.sampleRateInvariant = invariant ? 1 : 0;
    let [code, nbEntrees, nbSorties] = new cb.GenCodeBuilder(globalThis.mdl).compileToGenExpr();
    code = postTraiterPlus(code, plus, utilisePlus || plus.length > 0 || /compute_contact_hc|compute_friction/.test(code));
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
