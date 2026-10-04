"use strict";
/* ------------------------------------------------------------------ *
 *  Modele MIMS : analyse des scripts .mdl                             *
 *                                                                     *
 *  Syntaxe = celle de MIMS4Max (l'outil officiel de mi-gen), donc un  *
 *  meme fichier s'ouvre ici et dans Max :                             *
 *    @m1 mass M [gravity] pos vel        @g ground pos                *
 *    @s string nbMass M K Z [Zo] pos vel (+ stiffString, chain,       *
 *       mesh, closedMesh, cornerMesh : integres mi-gen)               *
 *    @r springDamper @m1 [@s 0.3] K Z    (proxy = point sur une       *
 *       corde [@s a] ou une membrane [@mesh a b], a et b dans 0..1)   *
 *    @in1 posInput pos   @in2 frcInput @m  @out1 posOutput @m         *
 *    @k param 0.1        @pt audioParam @in3                          *
 *  Les lignes ~ sont ignorees par MIMS4Max : on y range la geometrie  *
 *  3D (purement visuelle) :                                           *
 *    ~pos @m1 x y z                  position d'une masse / entree    *
 *    ~place @s x0 y0 z0 x1 y1 z1     extremites d'une corde, coins    *
 *                                    opposes d'une membrane           *
 *  Ancien dialecte du studio (MIMS online) encore accepte :           *
 *    @m osc M K Z [x y z] vel  -> [x y z] = geometrie, pos physique 0 *
 * ------------------------------------------------------------------ */

const TYPES_MASSE = ["mass", "osc", "ground"];
const TYPES_INTERACTION = ["spring", "damper", "springDamper", "contact", "nlContact",
                           "nlSpring2", "nlSpring3", "nlSpringDamper", "nlBow", "nlPluck"];
const TYPES_MACRO = ["string", "stiffString", "chain", "mesh", "closedMesh", "cornerMesh"];
const MACROS_CORDE = ["string", "stiffString", "chain"];

/* Arguments [obligatoires, optionnels] : copie de phyDict.genModDict. */
const ARGS = {
  mass: [["M"], ["gravity"]],
  osc: [["M", "K", "Z"], ["gravity"]],
  ground: [[], []],
  spring: [["K"], []],
  damper: [["Z"], []],
  springDamper: [["K", "Z"], []],
  contact: [["K", "Z"], ["thresh"]],
  nlContact: [["K", "KnlQ", "Klim", "Z"], ["thresh"]],
  nlSpring2: [["K", "KnlP", "Z"], []],
  nlSpring3: [["K", "KnlQ", "Z"], []],
  nlSpringDamper: [["K", "KnlQ", "Klim", "Z"], []],
  nlBow: [["Znl", "Vscale"], ["smooth"]],
  nlPluck: [["Knl", "Pscale"], ["Z"]],
  string: [["nbMass", "M", "K", "Z"], ["Zo"]],
  chain: [["nbMass", "M", "K", "Z"], ["Zo"]],
  stiffString: [["nbMass", "M", "K", "K2", "Z"], ["Zo"]],
  mesh: [["nbX", "nbY", "M", "K", "Z"], ["Zo"]],
  closedMesh: [["nbX", "nbY", "M", "K", "Z"], ["Zo"]],
  cornerMesh: [["nbX", "nbY", "M", "K", "Z"], ["Zo"]],
};

/* Description courte de chaque type, pour l'interface. */
const AIDE_TYPES = {
  mass: "masse libre", osc: "oscillateur (masse + ressort + frein vers le repos)",
  ground: "point fixe", posInput: "entree de position (pilotee)",
  frcInput: "entree de force", posOutput: "sortie position (ecoute)",
  frcOutput: "sortie force",
  spring: "ressort", damper: "amortisseur", springDamper: "ressort + amortisseur",
  contact: "contact (choc)", nlContact: "contact non lineaire",
  nlSpring2: "ressort non lineaire (quadratique)", nlSpring3: "ressort non lineaire (cubique)",
  nlSpringDamper: "ressort non lineaire borne", nlBow: "archet (frottement)",
  nlPluck: "pincement",
  string: "corde integree (extremites fixes)", stiffString: "corde raide integree",
  chain: "chaine integree (libre)", mesh: "membrane integree (bords libres)",
  closedMesh: "membrane integree (bords fixes)", cornerMesh: "membrane integree (coins fixes)",
};

/* ---------------- petites expressions : 0.5, k*2, (a+b)/2 ---------------- */

function evalue(token, params) {
  if (/^\[[^@\]]*\]$/.test(token)) token = token.slice(1, -1).trim();   // [0.002+0.004*p]
  const n = Number(token);
  if (token !== "" && !Number.isNaN(n)) return n;
  if (params && params.has(token)) return params.get(token).valeur;
  // expression : nombres, noms de params, + - * / ( ) et fonctions de genexpr
  const jetons = token.match(/\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/(),]/g);
  if (!jetons || jetons.join("") !== token.replace(/\s+/g, "")) throw new Error(`valeur illisible '${token}'`);
  let k = 0;
  const lit = () => jetons[k];
  function terme() {
    let v = facteur();
    while (lit() === "*" || lit() === "/") { const op = jetons[k++]; const w = facteur(); v = op === "*" ? v * w : v / w; }
    return v;
  }
  function expr() {
    let v = terme();
    while (lit() === "+" || lit() === "-") { const op = jetons[k++]; const w = terme(); v = op === "+" ? v + w : v - w; }
    return v;
  }
  function facteur() {
    const t = jetons[k++];
    if (t === undefined) throw new Error(`expression incomplete '${token}'`);
    if (t === "-") return -facteur();
    if (t === "+") return facteur();
    if (t === "(") { const v = expr(); if (jetons[k++] !== ")") throw new Error(`parenthese manquante dans '${token}'`); return v; }
    const v = Number(t);
    if (!Number.isNaN(v)) return v;
    if (lit() === "(" && FONCTIONS[t]) {
      k++;
      const args = [];
      if (lit() !== ")") { args.push(expr()); while (lit() === ",") { k++; args.push(expr()); } }
      if (jetons[k++] !== ")") throw new Error(`parenthese manquante dans '${token}'`);
      return FONCTIONS[t](...args);
    }
    if (params && params.has(t)) return params.get(t).valeur;
    throw new Error(`parametre inconnu '${t}'`);
  }
  const v = expr();
  if (k !== jetons.length) throw new Error(`valeur illisible '${token}'`);
  return v;
}

const FONCTIONS = {
  sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, abs: Math.abs, sin: Math.sin, cos: Math.cos,
  tan: Math.tan, atan: Math.atan, tanh: Math.tanh, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, clip: (x, a, b) => Math.min(Math.max(x, a), b),
  clamp: (x, a, b) => Math.min(Math.max(x, a), b), sign: Math.sign,
};

/* ---------------- references : @m1, [@s 0.3], [@mesh 0.2 0.7] ---------------- */

function lisRef(token) {
  if (/^@/.test(token)) return { nom: token.slice(1) };
  const m = /^\[\s*@(\S+)\s+(\S+)(?:\s+(\S+))?\s*\]$/.exec(token);
  if (m) return { macro: m[1], a: m[2], b: m[3] || null };
  return null;
}

function refTexte(ref) {
  if (ref.nom !== undefined) return "@" + ref.nom;
  return ref.b !== null ? `[@${ref.macro} ${ref.a} ${ref.b}]` : `[@${ref.macro} ${ref.a}]`;
}

function nomRef(ref) { return ref.nom !== undefined ? ref.nom : ref.macro; }

/* ---------------- analyse ---------------- */

const RE_JETON = /\[[^\]]*\]|[^\s\[\]]+/g;

function nouveauModele() {
  return {
    params: new Map(),        // nom -> {nom, genre, brut, valeur, entree, ligne}
    masses: new Map(),        // nom -> {nom, genre, args, pos, vel, geo, ligne}  (posInput inclus)
    macros: new Map(),        // nom -> {nom, genre, args, pos, vel, place, ligne}
    interactions: [],         // {nom, genre, m1, m2, args, ligne}
    entrees: [],              // frcInput : {nom, genre, cible, ligne}
    sorties: [],              // {nom, genre, cible, ligne}
    erreurs: [],              // [ligne, message]
    avertissements: [],
    legacy: false,            // ancien dialecte (positions 3D dans la ligne de masse)
  };
}

function parse(texte) {
  const mdl = nouveauModele();
  const err = (l, m) => mdl.erreurs.push([l, m]);
  const avert = (l, m) => mdl.avertissements.push([l, m]);
  const lignes = texte.split(/\r\n|\r|\n/);
  const geo = new Map(), place = new Map();
  const noms = new Set();

  // passe 1 : parametres (utilisables partout)
  lignes.forEach((brute, i) => {
    const ligne = brute.split("#", 1)[0].trim();
    const p = ligne.match(RE_JETON) || [];
    if (p.length < 3 || !/^@/.test(p[0]) || (p[1] !== "param" && p[1] !== "audioParam")) return;
    const nom = p[0].slice(1);
    if (mdl.params.has(nom)) { err(i + 1, `parametre en double : @${nom}`); return; }
    if (p[1] === "param") {
      mdl.params.set(nom, { nom, genre: "param", brut: p[2], valeur: 0, ligne: i + 1 });
    } else {
      if (!/^@in\d+$/.test(p[2])) err(i + 1, `audioParam @${nom} : il faut une entree @inN (ex. @in3)`);
      mdl.params.set(nom, { nom, genre: "audioParam", brut: "0.5", valeur: 0.5,
                            entree: p[2].slice(1), ligne: i + 1 });
    }
    noms.add(nom);
  });
  // valeurs des params (dans l'ordre : un param peut utiliser les precedents)
  for (const pr of mdl.params.values()) {
    if (pr.genre !== "param") continue;
    try { pr.valeur = evalue(pr.brut, mdl.params); }
    catch (e) { err(pr.ligne, `@${pr.nom} : ${e.message}`); pr.valeur = 0; }
  }

  const verifArgs = (num, genre, args, nom) => {
    const [obl, opt] = ARGS[genre];
    if (args.length < obl.length) {
      err(num, `${genre} @${nom} : il manque des arguments (attendu ${obl.join(" ")}` +
               `${opt.length ? " [" + opt.join(" ") + "]" : ""})`);
      return false;
    }
    if (args.length > obl.length + opt.length) {
      err(num, `${genre} @${nom} : trop d'arguments (attendu ${obl.join(" ")}` +
               `${opt.length ? " [" + opt.join(" ") + "]" : ""})`);
      return false;
    }
    for (const a of args) {
      try { evalue(a, mdl.params); } catch (e) { err(num, `@${nom} : ${e.message}`); return false; }
    }
    return true;
  };

  // passe 2 : le reste
  lignes.forEach((brute, i) => {
    const num = i + 1;
    const ligne = brute.split("#", 1)[0].trim();
    if (!ligne) return;
    const p = ligne.match(RE_JETON) || [];

    if (p[0] === "~pos") {
      if (p.length !== 5 || !/^@/.test(p[1])) { err(num, "~pos : attendu ~pos @nom x y z"); return; }
      const v = p.slice(2).map(Number);
      if (v.some(Number.isNaN)) { err(num, "~pos : coordonnees non numeriques"); return; }
      geo.set(p[1].slice(1), v);
      return;
    }
    if (p[0] === "~place") {
      if (p.length !== 8 || !/^@/.test(p[1])) { err(num, "~place : attendu ~place @nom x0 y0 z0 x1 y1 z1"); return; }
      const v = p.slice(2).map(Number);
      if (v.some(Number.isNaN)) { err(num, "~place : coordonnees non numeriques"); return; }
      place.set(p[1].slice(1), v);
      return;
    }
    if (p[0].startsWith("~")) return;             // ~begin / ~end (buffers Max)
    if (!p[0].startsWith("@")) { avert(num, `ligne ignoree (ne commence pas par @) : '${ligne.slice(0, 40)}'`); return; }
    if (p.length < 2) { err(num, "ligne incomplete"); return; }

    const nom = p[0].slice(1), genre = p[1];
    if (genre === "param" || genre === "audioParam") return;
    if (noms.has(nom)) { err(num, `nom en double : @${nom}`); return; }

    // -------- masses --------
    if (TYPES_MASSE.includes(genre)) {
      let toks = p.slice(2), g = null, pos, vel = "0";
      // ancien dialecte : [x y z] (ou [z]) en avant-dernier jeton (ou dernier pour ground)
      const estPos = t => /^\[\s*-?[\d.eE+-]+(\s+-?[\d.eE+-]+){0,2}\s*\]$/.test(t);
      let iCrochet = -1;
      for (let k = Math.max(0, toks.length - 2); k < toks.length; k++) if (estPos(toks[k])) { iCrochet = k; break; }
      if (iCrochet >= 0) {                        // ancien dialecte : [x y z] = geometrie
        const v = toks[iCrochet].slice(1, -1).trim().split(/\s+/).map(Number);
        if (v.length === 3 && !v.some(Number.isNaN)) { g = v; mdl.legacy = true; pos = "0"; }
        else if (v.length === 1 && !Number.isNaN(v[0])) pos = String(v[0]);
        else { err(num, `position illisible ${toks[iCrochet]}`); return; }
        if (genre !== "ground" && toks.length > iCrochet + 1) vel = toks[iCrochet + 1];
        toks = toks.slice(0, iCrochet);
      } else if (genre === "ground") {
        if (!toks.length) { err(num, "ground : il faut une position (ex. @g ground 0.)"); return; }
        pos = toks.pop();
      } else {
        if (toks.length < 2) { err(num, `${genre} @${nom} : il faut ... pos vel a la fin`); return; }
        vel = toks.pop(); pos = toks.pop();
      }
      if (!verifArgs(num, genre, toks, nom)) return;
      try { evalue(pos, mdl.params); evalue(vel, mdl.params); }
      catch (e) { err(num, `@${nom} : ${e.message}`); return; }
      mdl.masses.set(nom, { nom, genre, args: toks, pos, vel, geo: g, geoEnLigne: !!g, ligne: num });
      noms.add(nom);
      return;
    }

    // -------- structures integrees --------
    if (TYPES_MACRO.includes(genre)) {
      const toks = p.slice(2);
      if (toks.length < 2) { err(num, `${genre} @${nom} : il faut ... pos vel a la fin`); return; }
      const vel = toks.pop(), pos = toks.pop();
      if (!verifArgs(num, genre, toks, nom)) return;
      const tailles = MACROS_CORDE.includes(genre) ? [toks[0]] : [toks[0], toks[1]];
      for (const t of tailles) {
        const v = evalue(t, mdl.params);
        if (!Number.isInteger(v) || v < 2 || v > 4096) {
          err(num, `${genre} @${nom} : nombre de masses invalide (${t})`); return;
        }
      }
      mdl.macros.set(nom, { nom, genre, args: toks, pos, vel, place: null, ligne: num });
      noms.add(nom);
      return;
    }

    // -------- interactions --------
    if (TYPES_INTERACTION.includes(genre)) {
      if (p.length < 4) { err(num, `${genre} @${nom} : il faut deux elements (@a @b)`); return; }
      const m1 = lisRef(p[2]), m2 = lisRef(p[3]);
      if (!m1 || !m2) { err(num, `${genre} @${nom} : elements illisibles (attendu @a ou [@corde 0.5])`); return; }
      const args = p.slice(4);
      if (!verifArgs(num, genre, args, nom)) return;
      mdl.interactions.push({ nom, genre, m1, m2, args, ligne: num });
      noms.add(nom);
      return;
    }

    // -------- entrees / sorties --------
    if (genre === "posInput") {
      const toks = p.slice(2);
      let g = null, pos = "0";
      if (toks.length === 1 && toks[0].startsWith("[")) {
        const v = toks[0].slice(1, -1).trim().split(/\s+/).map(Number);
        if (v.length === 3 && !v.some(Number.isNaN)) { g = v; mdl.legacy = true; }
        else if (v.length === 1 && !Number.isNaN(v[0])) pos = String(v[0]);
        else { err(num, `position illisible ${toks[0]}`); return; }
      } else if (toks.length === 1) {
        pos = toks[0];
        try { evalue(pos, mdl.params); } catch (e) { err(num, `@${nom} : ${e.message}`); return; }
      } else { err(num, "posInput : attendu @inN posInput pos"); return; }
      mdl.masses.set(nom, { nom, genre: "posInput", args: [], pos, vel: "0", geo: g, geoEnLigne: !!g, ligne: num });
      noms.add(nom);
      return;
    }
    if (genre === "frcInput" || genre === "posOutput" || genre === "frcOutput") {
      let ref = p[2] ? lisRef(p[2]) : null;
      // forme experimentale de mi-gen : @out1 posOutput @s 0.9  -> [@s 0.9]
      if (ref && ref.nom !== undefined && p.length >= 4)
        ref = { macro: ref.nom, a: p[3], b: p[4] || null };
      if (!ref) { err(num, `${genre} @${nom} : il faut un element cible (@m ou [@corde 0.5])`); return; }
      const liste = genre === "frcInput" ? mdl.entrees : mdl.sorties;
      liste.push({ nom, genre, cible: ref, ligne: num });
      noms.add(nom);
      return;
    }

    err(num, `type de module inconnu : '${genre}'`);
  });

  // passe 3 : geometrie et verification des references
  for (const [n, g] of geo) {
    if (mdl.masses.has(n)) mdl.masses.get(n).geo = g;
    else mdl.avertissements.push([0, `~pos @${n} : element inconnu`]);
  }
  for (const [n, pl] of place) {
    if (mdl.macros.has(n)) mdl.macros.get(n).place = pl;
    else mdl.avertissements.push([0, `~place @${n} : structure inconnue`]);
  }
  const verifRef = (ref, ligne, quoi) => {
    if (ref.nom !== undefined) {
      if (mdl.macros.has(ref.nom))
        err(ligne, `${quoi} : @${ref.nom} est une structure, precise un point : [@${ref.nom} 0.5]` +
                   (MACROS_CORDE.includes(mdl.macros.get(ref.nom).genre) ? "" : ` ou [@${ref.nom} 0.5 0.5]`));
      else if (!mdl.masses.has(ref.nom)) err(ligne, `${quoi} : element inconnu @${ref.nom}`);
      return;
    }
    const mc = mdl.macros.get(ref.macro);
    if (!mc) { err(ligne, `${quoi} : structure inconnue @${ref.macro}`); return; }
    const corde = MACROS_CORDE.includes(mc.genre);
    if (corde && ref.b !== null) err(ligne, `${quoi} : une corde se vise avec une seule position [@${ref.macro} a]`);
    if (!corde && ref.b === null) err(ligne, `${quoi} : une membrane se vise avec deux positions [@${ref.macro} a b]`);
    for (const t of [ref.a, ref.b]) {
      if (t === null) continue;
      try { evalue(t, mdl.params); } catch (e) { err(ligne, `${quoi} : ${e.message}`); }
    }
  };
  for (const it of mdl.interactions) {
    verifRef(it.m1, it.ligne, `@${it.nom}`);
    verifRef(it.m2, it.ligne, `@${it.nom}`);
  }
  for (const s of [...mdl.entrees, ...mdl.sorties]) verifRef(s.cible, s.ligne, `@${s.nom}`);
  for (const pr of mdl.params.values())
    if (pr.genre === "audioParam" && [...mdl.masses.keys(), ...mdl.entrees.map(e => e.nom)].includes(pr.entree))
      err(pr.ligne, `audioParam @${pr.nom} : l'entree @${pr.entree} est deja utilisee`);

  return mdl;
}

/* ---------------- statistiques ---------------- */

function tailleMacro(mc, params) {
  const v = t => Math.round(evalue(t, params));
  return MACROS_CORDE.includes(mc.genre) ? [v(mc.args[0]), 1] : [v(mc.args[0]), v(mc.args[1])];
}

/* Nombre d'elements de calcul, comme les compte le moteur. */
function comptesModele(mdl) {
  let masses = 0, liaisons = 0, fixes = 0;
  for (const m of mdl.masses.values()) {
    masses++;
    if (m.genre === "ground" || m.genre === "posInput") fixes++;
  }
  for (const mc of mdl.macros.values()) {
    const [nx, ny] = tailleMacro(mc, mdl.params);
    masses += nx * ny;
    if (MACROS_CORDE.includes(mc.genre)) {
      liaisons += nx - 1;
      if (mc.genre === "stiffString") liaisons += nx;
      if (mc.genre !== "chain") fixes += 2;
    } else {
      liaisons += nx * (ny - 1) + (nx - 1) * ny;
      if (mc.genre === "cornerMesh") fixes += 4;
      if (mc.genre === "closedMesh") fixes += 2 * nx + 2 * ny - 4;
    }
  }
  const refs = [...mdl.interactions.flatMap(i => [i.m1, i.m2]),
                ...mdl.entrees.map(e => e.cible), ...mdl.sorties.map(s => s.cible)];
  const proxies = refs.filter(r => r.macro !== undefined).length;
  return { masses, fixes, liaisons: liaisons + mdl.interactions.length, proxies };
}

function statsModele(mdl) {
  const c = comptesModele(mdl);
  return `${c.masses} masses (${c.fixes} fixes) · ${c.liaisons} liaisons` +
         (c.proxies ? ` · ${c.proxies} proxy` : "") +
         ` · ${mdl.sorties.length} sortie(s)` +
         (mdl.macros.size ? ` · ${mdl.macros.size} structure(s) integree(s)` : "");
}
