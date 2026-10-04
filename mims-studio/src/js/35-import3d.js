"use strict";
/* ------------------------------------------------------------------ *
 *  Import de modeles 3D (.obj, .stl) -> reseau masses-ressorts         *
 *                                                                     *
 *  1. lecture + soudure des sommets en double (STL)                   *
 *  2. simplification par grille : on vise un nombre de masses qui     *
 *     tient dans le budget materiel                                   *
 *  3. morceaux separes relies entre eux (un seul objet qui vibre)     *
 *  4. plafond de ressorts (on garde un squelette connexe d'abord)     *
 *  5. orientation, mise a l'echelle, points de fixation               *
 * ------------------------------------------------------------------ */

function lire3D(nomFichier, donnees) {
  const ext = nomFichier.toLowerCase().split(".").pop();
  if (ext === "stl") return lireSTL(donnees);
  if (ext === "obj") return lireOBJ(typeof donnees === "string" ? donnees : new TextDecoder().decode(donnees));
  throw new Error(`format .${ext} non gere (utilise .obj ou .stl)`);
}

function lireOBJ(texte) {
  const verts = [], faces = [];
  for (const ligne of texte.split(/\r?\n/)) {
    const p = ligne.trim().split(/\s+/);
    if (p[0] === "v") verts.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === "f" || p[0] === "l") {
      const idx = p.slice(1).map(t => {
        const k = parseInt(t.split("/")[0], 10);
        return k < 0 ? verts.length + k : k - 1;
      }).filter(k => k >= 0);
      if (idx.length >= 2) faces.push(idx);
    }
  }
  if (!verts.length) throw new Error("aucun sommet 'v' dans ce fichier .obj");
  return { verts, aretes: aretesDeFaces(faces) };
}

function lireSTL(donnees) {
  const buf = donnees instanceof ArrayBuffer ? donnees : new TextEncoder().encode(donnees).buffer;
  const dv = new DataView(buf);
  const tris = [];
  const nb = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (buf.byteLength === 84 + nb * 50 && nb > 0) {              // binaire
    for (let t = 0; t < nb; t++) {
      const o = 84 + t * 50 + 12, tri = [];
      for (let k = 0; k < 3; k++)
        tri.push([dv.getFloat32(o + k * 12, true), dv.getFloat32(o + k * 12 + 4, true), dv.getFloat32(o + k * 12 + 8, true)]);
      tris.push(tri);
    }
  } else {                                                        // texte
    const texte = new TextDecoder().decode(buf);
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m, tri = [];
    while ((m = re.exec(texte))) {
      tri.push([+m[1], +m[2], +m[3]]);
      if (tri.length === 3) { tris.push(tri); tri = []; }
    }
  }
  if (!tris.length) throw new Error("aucun triangle dans ce fichier .stl");
  // soudure : les STL repetent chaque sommet pour chaque triangle
  let diag = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) for (const v of tri) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  for (let k = 0; k < 3; k++) diag = Math.max(diag, mx[k] - mn[k]);
  const pas = Math.max(diag, 1e-9) * 1e-6;
  const index = new Map(), verts = [], faces = [];
  for (const tri of tris) {
    faces.push(tri.map(v => {
      const cle = `${Math.round(v[0] / pas)},${Math.round(v[1] / pas)},${Math.round(v[2] / pas)}`;
      if (!index.has(cle)) { index.set(cle, verts.length); verts.push(v); }
      return index.get(cle);
    }));
  }
  return { verts, aretes: aretesDeFaces(faces) };
}

function aretesDeFaces(faces) {
  const aretes = new Set();
  for (const f of faces)
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      if (a !== b && (f.length > 2 || k === 0)) aretes.add(a < b ? a * 4294967296 + b : b * 4294967296 + a);
    }
  return [...aretes].map(c => [Math.floor(c / 4294967296), c % 4294967296]);
}

/* ---------------- simplification par grille ---------------- */

function _grille(verts, h) {
  const groupes = new Map();
  const cle = new Int32Array(verts.length);
  const inv = 1 / h;
  const ids = new Map();
  verts.forEach((v, i) => {
    const k = `${Math.floor(v[0] * inv)},${Math.floor(v[1] * inv)},${Math.floor(v[2] * inv)}`;
    let g = ids.get(k);
    if (g === undefined) { g = ids.size; ids.set(k, g); groupes.set(g, []); }
    groupes.get(g).push(i);
    cle[i] = g;
  });
  return [groupes, cle];
}

function simplifier(verts, aretes, cible) {
  if (cible <= 0 || verts.length <= cible) return { verts, aretes, simplifie: false };
  let diag = 0;
  for (let k = 0; k < 3; k++) {
    let mn = Infinity, mx = -Infinity;
    for (const v of verts) { mn = Math.min(mn, v[k]); mx = Math.max(mx, v[k]); }
    diag = Math.max(diag, mx - mn);
  }
  diag = Math.max(diag, 1e-9);
  let lo = diag / 2000, hi = diag, meilleur = null;
  for (let it = 0; it < 28; it++) {
    const h = Math.sqrt(lo * hi);
    const r = _grille(verts, h);
    const n = r[0].size;
    if (!meilleur || (n <= cible && (meilleur[0].size > cible || n > meilleur[0].size))) meilleur = r;
    if (n > cible) lo = h; else hi = h;
  }
  const [groupes, cle] = meilleur;
  const nverts = [];
  for (const [, idxs] of groupes) {
    const moy = [0, 0, 0];
    for (const i of idxs) for (let k = 0; k < 3; k++) moy[k] += verts[i][k];
    nverts.push(moy.map(v => v / idxs.length));
  }
  const vues = new Set(), naretes = [];
  for (const [a, b] of aretes) {
    const ca = cle[a], cb = cle[b];
    if (ca === cb) continue;
    const k = ca < cb ? ca * 4294967296 + cb : cb * 4294967296 + ca;
    if (!vues.has(k)) { vues.add(k); naretes.push(ca < cb ? [ca, cb] : [cb, ca]); }
  }
  return { verts: nverts, aretes: naretes, simplifie: true };
}

/* relie chaque morceau isole au morceau principal par son ressort le plus court */
function relierMorceaux(verts, aretes) {
  const parent = verts.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const [a, b] of aretes) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  const morceaux = new Map();
  verts.forEach((_, i) => { const r = find(i); if (!morceaux.has(r)) morceaux.set(r, []); morceaux.get(r).push(i); });
  if (morceaux.size <= 1) return 0;
  const tries = [...morceaux.values()].sort((p, q) => q.length - p.length);
  let principal = tries[0].slice(), ajouts = 0;
  for (const m of tries.slice(1)) {
    let best = null, dmin = Infinity;
    const pasA = Math.max(1, Math.floor(m.length / 60)), pasB = Math.max(1, Math.floor(principal.length / 400));
    for (let ia = 0; ia < m.length; ia += pasA)
      for (let ib = 0; ib < principal.length; ib += pasB) {
        const a = verts[m[ia]], b = verts[principal[ib]];
        const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
        if (d < dmin) { dmin = d; best = [m[ia], principal[ib]]; }
      }
    aretes.push(best[0] < best[1] ? best : [best[1], best[0]]);
    principal = principal.concat(m);
    ajouts++;
  }
  return ajouts;
}

/* garde d'abord un squelette connexe (aretes courtes), puis complete jusqu'au plafond */
function plafonnerRessorts(verts, aretes, plafond) {
  if (plafond <= 0 || aretes.length <= plafond) return { aretes, limite: false };
  const d2 = ([a, b]) => { const va = verts[a], vb = verts[b]; return (va[0] - vb[0]) ** 2 + (va[1] - vb[1]) ** 2 + (va[2] - vb[2]) ** 2; };
  const triees = aretes.slice().sort((p, q) => d2(p) - d2(q));
  const parent = verts.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const garde = [], reste = [];
  for (const e of triees) {
    const ra = find(e[0]), rb = find(e[1]);
    if (ra !== rb) { parent[ra] = rb; garde.push(e); } else reste.push(e);
  }
  for (const e of reste) { if (garde.length >= plafond) break; garde.push(e); }
  return { aretes: garde, limite: true };
}

/* ---------------- chaine complete ---------------- */

/* options : {masses, ressorts, orientation: auto|y|z, taille, fixation: bas|haut|aucun,
 *            relier: bool, nom} */
function adapter3D(brut, options) {
  const o = Object.assign({ masses: 300, ressorts: 0, orientation: "auto", taille: 16,
                            fixation: "extremites", sol: true, relier: true, nom: "objet" }, options);
  let { verts, aretes, simplifie } = simplifier(brut.verts, brut.aretes, o.masses);
  aretes = aretes.map(e => e.slice());
  const liesAjoutes = o.relier ? relierMorceaux(verts, aretes) : 0;
  const plaf = plafonnerRessorts(verts, aretes, o.ressorts);
  aretes = plaf.aretes;

  // orientation : la plupart des logiciels 3D exportent avec Y vers le haut
  const etendue = k => Math.max(...verts.map(v => v[k])) - Math.min(...verts.map(v => v[k]));
  const yHaut = o.orientation === "y" || (o.orientation === "auto" && etendue(1) > etendue(2) * 1.05);
  if (yHaut) verts = verts.map(v => [v[0], -v[2], v[1]]);
  const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  const zmin = Math.min(...verts.map(v => v[2]));
  verts = verts.map(v => [v[0] - cx, v[1] - cy, v[2] - zmin]);
  const ampl = Math.max(...verts.map(v => Math.max(Math.abs(v[0]), Math.abs(v[1]), v[2])), 1e-9);
  const k = o.taille / ampl;
  verts = verts.map(v => v.map(c => c * k));

  const zmax = Math.max(...verts.map(v => v[2]));
  const fixe = verts.map(v => o.fixation === "extremites" ? false
                             : o.fixation === "bas" ? v[2] <= 0.04 * zmax + 1e-9
                             : o.fixation === "haut" ? v[2] >= 0.96 * zmax - 1e-9 : false);
  if (o.fixation !== "aucun" && fixe.every(Boolean)) fixe.fill(false);

  const nom = (o.nom.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 14) || "objet")
    .replace(/^(\d)/, "o$1");
  const m = new GenModele(nom, 1.0, 0.1, 0.0001, 0.003);
  const ids = verts.map((v, i) => m.masse(v[0], v[1], v[2], fixe[i]));
  for (const [a, b] of aretes) m.ressort(ids[a], ids[b]);
  if (o.fixation === "extremites") {
    for (const id of m.extremites()) { m.masses[id].grounded = true; fixe[id] = true; }
  }
  m.sol = !!o.sol;
  const mobiles = ids.filter(id => !m.masses[id].grounded);
  if (mobiles.length) {
    m.frappe(m.sommetLePlusHaut());
    m.ecoute(mobiles[Math.floor(mobiles.length / 3)]);
    m.ecoute(mobiles[Math.floor(2 * mobiles.length / 3)]);
  }
  const nFixes = m.masses.filter(mm => mm.grounded).length;
  let note = `importe de ${o.nom} : ${brut.verts.length} sommets / ${brut.aretes.length} aretes`;
  if (simplifie) note += ` -> ${verts.length} masses`;
  if (plaf.limite) note += `, ressorts plafonnes a ${aretes.length}`;
  if (liesAjoutes) note += `, ${liesAjoutes} morceau(x) relie(s)`;
  note += `, ${nFixes} point(s) fixe(s)`;
  const nSol = m.sol ? m.masses.filter(mm => !mm.grounded).length : 0;
  return { modele: m, note, masses: verts.length + (nSol ? 1 : 0),
           ressorts: m.ressorts.size + (mobiles.length ? 1 : 0) + nSol,
           fixes: nFixes, liesAjoutes };
}
