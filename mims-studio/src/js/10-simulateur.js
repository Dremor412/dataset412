"use strict";
/* ------------------------------------------------------------------ *
 *  Moteur physique : meme algorithme que mi-gen (migen-lib,           *
 *  migen-integrated, migen-proxies), un pas = un echantillon.         *
 *                                                                     *
 *  Etat d'un point = sa position 1D u (un deplacement, comme dans     *
 *  gen~). La geometrie 3D (gx, gy, gz) ne sert qu'a l'affichage :     *
 *  on dessine le point a la hauteur gz + u.                           *
 *                                                                     *
 *  compiler() transforme le modele en tableaux simples (clonables     *
 *  vers le fil audio). Les structures integrees y sont depliees en    *
 *  masses et liaisons ; un proxy est un point virtuel interpole       *
 *  entre 2 (corde) ou 4 (membrane) masses.                            *
 * ------------------------------------------------------------------ */

const ARGS_K = new Set(["K", "K2", "Knl", "KnlP", "KnlQ", "Klim"]);
const ARGS_Z = new Set(["Z", "Znl", "Vscale", "Zo"]);
const CODES_INTER = ["spring", "damper", "springDamper", "contact", "nlContact",
                     "nlSpringDamper", "nlSpring3", "nlSpring2", "nlPluck", "nlBow",
                     "contactHC", "friction"];                    // 10, 11 : migen-plus
const NB_ARGS = 5;
const MOBILE = 0, FIXE = 1, ENTREE = 2;

/* Valeurs des params, avec les reglages en cours (curseurs) par-dessus. */
function valeursParams(mdl, reglages) {
  const P = new Map();
  for (const [nom, pr] of mdl.params) {
    let v;
    if (reglages && reglages.has(nom)) v = reglages.get(nom);
    else if (pr.genre === "param") {
      try { v = evalue(pr.brut, P); } catch (e) { v = pr.valeur; }
    } else v = pr.valeur;
    P.set(nom, { valeur: v });
  }
  return P;
}

function compiler(mdl, options = {}) {
  const sr = options.sr || null;
  const fz = sr ? 44100 / sr : 1, fk = fz * fz;       // invariance (comme MIMS4Max)
  const srPos = sr || 44100;
  const P = valeursParams(mdl, options.reglages);
  const val = t => evalue(t, P);
  const echelle = (nomArg, v) => ARGS_K.has(nomArg) ? v * fk : ARGS_Z.has(nomArg) ? v * fz : v;

  const N = {
    noms: [], etat: [], A: [], B: [], invM: [], grav: [], u0: [], ur0: [],
    gx: [], gy: [], gz: [], aGeo: [], element: [],
  };
  const ajoute = (nom, element, etat, A, B, invM, grav, u0, ur0, g) => {
    N.noms.push(nom); N.element.push(element); N.etat.push(etat);
    N.A.push(A); N.B.push(B); N.invM.push(invM); N.grav.push(grav);
    N.u0.push(u0); N.ur0.push(ur0);
    N.gx.push(g ? g[0] : 0); N.gy.push(g ? g[1] : 0); N.gz.push(g ? g[2] : 0);
    N.aGeo.push(g ? 1 : 0);
    return N.noms.length - 1;
  };

  // ---- masses et entrees de position
  const indice = new Map();
  for (const m of mdl.masses.values()) {
    const u0 = val(m.pos), v0 = val(m.vel);
    const ur0 = u0 - v0 / srPos;
    let i;
    if (m.genre === "ground") i = ajoute(m.nom, m.nom, FIXE, 2, -1, 1, 0, u0, u0, m.geo);
    else if (m.genre === "posInput") i = ajoute(m.nom, m.nom, ENTREE, 2, -1, 1, 0, u0, u0, m.geo);
    else {
      const a = m.args.map(val);
      const M = Math.max(a[0], 1e-9), invM = 1 / M;
      if (m.genre === "mass") {
        const g = a.length > 1 ? a[1] * fk / 44100 : 0;
        i = ajoute(m.nom, m.nom, MOBILE, 2, -1, invM, g, u0, ur0, m.geo);
      } else {                                         // osc
        const K = a[1] * fk, Z = a[2] * fz;
        const g = a.length > 3 ? a[3] * fk / 44100 : 0;
        i = ajoute(m.nom, m.nom, MOBILE, 2 - (K + Z) * invM, Z * invM - 1, invM, g, u0, ur0, m.geo);
      }
    }
    indice.set(m.nom, i);
  }

  // ---- structures integrees, depliees
  const liens = [];                 // {code, i1, i2, args[]}
  const structures = [];            // migen-plus : {type 0 corde a flexion / 1 plaque, debut, nx, ny, K, Kb, Z, tmod}
  const macros = new Map();         // nom -> {debut, nx, ny, corde}
  let rangee = 0;
  for (const mc of mdl.macros.values()) {
    const [nx, ny] = tailleMacro(mc, P);
    const corde = MACROS_CORDE.includes(mc.genre);
    const a = mc.args.map(val);
    const off = corde ? 1 : 2;                       // apres nbMass / nbX nbY
    const M = Math.max(a[off], 1e-9), invM = 1 / M;
    const K = a[off + 1] * fk;
    let K2 = 0, Z, Zo, tmod = 0, option = 0;
    const plus = mc.genre === "bendString" || mc.genre === "plate";
    if (mc.genre === "stiffString" || plus) {
      K2 = a[off + 2] * fk; Z = a[off + 3] * fz; Zo = (a[off + 4] || 0) * fz;
      if (plus) { tmod = (a[off + 5] || 0) * fk; option = Math.round(a[off + 6] || 0); }   // libre / bords
    }
    else { Z = a[off + 2] * fz; Zo = (a[off + 3] || 0) * fz; }
    const A = 2 - Zo * invM, B = Zo * invM - 1;
    const u0 = val(mc.pos), ur0 = u0 - val(mc.vel) / srPos;

    // geometrie : ~place, sinon rangee automatique
    let pl = mc.place;
    if (!pl) {
      const y = rangee * 5;
      if (corde) { const L = Math.min(Math.max(nx * 0.35, 8), 30); pl = [-L / 2, y, 0, L / 2, y, 0]; rangee += 1; }
      else {
        const lx = Math.min((nx - 1) * 0.6, 24), ly = Math.min((ny - 1) * 0.6, 24);
        pl = [-lx / 2, y, 0, lx / 2, y + ly, 0]; rangee += Math.ceil(ly / 5) + 1;
      }
    }
    const debut = N.noms.length;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const ti = nx > 1 ? i / (nx - 1) : 0, tj = ny > 1 ? j / (ny - 1) : 0;
        let g, fixe = false;
        if (corde) {
          g = [pl[0] + (pl[3] - pl[0]) * ti, pl[1] + (pl[4] - pl[1]) * ti, pl[2] + (pl[5] - pl[2]) * ti];
          fixe = mc.genre !== "chain" && !(mc.genre === "bendString" && option === 1) && (i === 0 || i === nx - 1);
        } else {
          g = [pl[0] + (pl[3] - pl[0]) * ti, pl[1] + (pl[4] - pl[1]) * tj, pl[2] + (pl[5] - pl[2]) * ti];
          const bordI = i === 0 || i === nx - 1, bordJ = j === 0 || j === ny - 1;
          fixe = (mc.genre === "cornerMesh" && bordI && bordJ) || (mc.genre === "closedMesh" && (bordI || bordJ))
              || (mc.genre === "plate" && ((option === 1 && (bordI || bordJ))
                                           || (option === 2 && i === Math.floor(nx / 2) && j === Math.floor(ny / 2))));
        }
        const nom = corde ? `${mc.nom}[${i}]` : `${mc.nom}[${i},${j}]`;
        if (fixe) ajoute(nom, mc.nom, FIXE, 2, -1, invM, 0, u0, u0, g);
        else ajoute(nom, mc.nom, MOBILE, A, B, invM, 0, u0, ur0, g);
      }
    }
    // liaisons internes (ordre de migen-integrated)
    const id = (i, j) => debut + i * ny + j;
    if (plus) {                                       // migen-plus : calcul dedie (flexion, tension modulee)
      structures.push({ type: mc.genre === "plate" ? 1 : 0, debut, nx, ny, K, Kb: K2, Z, tmod });
    } else if (corde) {
      for (let i = 0; i < nx - 1; i++) liens.push({ code: 2, i1: id(i, 0), i2: id(i + 1, 0), args: [K, Z] });
      if (mc.genre === "stiffString") {                // gabarit elargi (i, i+2)
        for (let i = -1; i <= nx - 1; i++) {
          const p = Math.min(Math.max(i, 0), nx - 1), q = Math.min(Math.max(i + 2, 0), nx - 1);
          if (p !== q) liens.push({ code: 0, i1: id(p, 0), i2: id(q, 0), args: [K2] });
        }
      }
    } else {
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny - 1; j++) liens.push({ code: 2, i1: id(i, j), i2: id(i, j + 1), args: [K, Z] });
      for (let i = 0; i < nx - 1; i++)
        for (let j = 0; j < ny; j++) liens.push({ code: 2, i1: id(i, j), i2: id(i + 1, j), args: [K, Z] });
    }
    macros.set(mc.nom, { debut, nx, ny, corde, genre: mc.genre });
  }
  // ---- geometrie automatique des masses sans position
  placementAutomatique(N, mdl, indice, macros);

  // ---- objets modaux (~modal) : le groupe devient des modes (resonateurs)
  const modaux = [], ligneModale = new Map(), internes = new Set(), aretesModales = [];
  for (const dir of mdl.modaux || []) {
    const mc = macros.get(dir.groupe);
    const membres = mc ? [...Array(mc.nx * mc.ny).keys()].map(k => mc.debut + k)
      : [...indice].filter(([nom, i]) => nom.startsWith(dir.groupe + "_") && N.etat[i] !== ENTREE && !/(^|_)sol$/.test(nom))
                   .map(([, i]) => i);
    const dans = new Set(membres);
    const mob = membres.filter(i => N.etat[i] === MOBILE);
    const n = mob.length;
    if (!n) continue;
    const pos = new Map(mob.map((i, k) => [i, k]));
    const K = new Float64Array(n * n), C = new Float64Array(n * n), m = new Float64Array(n);
    mob.forEach((i, k) => {
      const Mi = 1 / N.invM[i], z = (N.B[i] + 1) * Mi;
      m[k] = Mi; C[k * n + k] += z; K[k * n + k] += (2 - N.A[i]) * Mi - z;
    });
    const tampon = (p, q, k, c) => {                      // ressort + amortisseur entre p et q
      const a = pos.get(p), b = pos.get(q);
      if (a !== undefined) { K[a * n + a] += k; C[a * n + a] += c; }
      if (b !== undefined) { K[b * n + b] += k; C[b * n + b] += c; }
      if (a !== undefined && b !== undefined) { K[a * n + b] -= k; K[b * n + a] -= k; C[a * n + b] -= c; C[b * n + a] -= c; }
      aretesModales.push([p, q]);
    };
    for (let k = liens.length - 1; k >= 0; k--) {        // liaisons des structures integrees
      const l = liens[k];
      if (dans.has(l.i1) && dans.has(l.i2) && l.code <= 2) {
        tampon(l.i1, l.i2, l.code === 1 ? 0 : l.args[0], l.code === 0 ? 0 : l.code === 1 ? l.args[0] : l.args[1]);
        liens.splice(k, 1);
      }
    }
    for (let s = structures.length - 1; s >= 0; s--) {   // corde a flexion / plaque
      const st = structures[s];
      if (!dans.has(st.debut)) continue;
      const id = (i, j) => st.debut + i * st.ny + j;
      for (let i = 0; i < st.nx; i++) for (let j = 0; j < st.ny - 1; j++) tampon(id(i, j), id(i, j + 1), st.K, st.Z);
      for (let i = 0; i < st.nx - 1; i++) for (let j = 0; j < st.ny; j++) tampon(id(i, j), id(i + 1, j), st.K, st.Z);
      const flexion = pts => {                            // Kb * c c^T, c = coefficients de la courbure
        for (const [p, cp] of pts) for (const [q, cq] of pts) {
          const a = pos.get(p), b = pos.get(q);
          if (a !== undefined && b !== undefined) K[a * n + b] += st.Kb * cp * cq;
        }
      };
      if (st.Kb) {
        if (st.type === 0) for (let i = 1; i < st.nx - 1; i++) flexion([[id(i - 1, 0), 1], [id(i, 0), -2], [id(i + 1, 0), 1]]);
        else for (let i = 1; i < st.nx - 1; i++) for (let j = 1; j < st.ny - 1; j++)
          flexion([[id(i, j), -4], [id(i - 1, j), 1], [id(i + 1, j), 1], [id(i, j - 1), 1], [id(i, j + 1), 1]]);
      }
      structures.splice(s, 1);
    }
    for (const it of mdl.interactions) {                  // ressorts du script entre masses du groupe
      if (!["spring", "damper", "springDamper"].includes(it.genre) || it.m1.nom === undefined || it.m2.nom === undefined) continue;
      const p = indice.get(it.m1.nom), q = indice.get(it.m2.nom);
      if (!dans.has(p) || !dans.has(q)) continue;
      const a = it.args.map(val);
      if (it.genre === "spring") tampon(p, q, a[0] * fk, 0);
      else if (it.genre === "damper") tampon(p, q, 0, a[0] * fz);
      else tampon(p, q, a[0] * fk, a[1] * fz);
      internes.add(it);
    }
    const res = analyseModale(K, C, m, n, dir.nb);
    const reg = nom => P.has(`${dir.groupe}_${nom}`) ? P.get(`${dir.groupe}_${nom}`).valeur : null;
    const hauteurM = reg("hauteur") ?? 1, t60 = reg("t60") ?? res.t60, brillance = reg("brillance") ?? res.brillance;
    const coef = coefModes(res.omega, hauteurM, t60, brillance, fz, sr || 44100);
    const debut = N.noms.length, nb = res.omega.length;
    for (let k = 0; k < nb; k++) ajoute(`${dir.groupe}~mode${k}`, `${dir.groupe}~modes`, MOBILE, coef.A[k], coef.B[k], 1, 0, 0, 0, null);
    const lignes = new Float64Array(membres.length * nb);
    membres.forEach((i, r) => {
      const k0 = pos.get(i);
      if (k0 !== undefined) for (let k = 0; k < nb; k++) lignes[r * nb + k] = res.formes[k][k0];
      ligneModale.set(i, { g: modaux.length, r });
      if (N.etat[i] === MOBILE) N.etat[i] = FIXE;        // le point n'est plus calcule : il est affiche
    });
    modaux.push({ nom: dir.groupe, debut, nb, membres, mobiles: mob, lignes, omega: res.omega,
                  macro: mc ? (mc.corde ? "1d" : "2d") : null, nx: mc ? mc.nx : 0, ny: mc ? mc.ny : 0,
                  hauteur: hauteurM, t60, brillance, nbMasses: n });
  }
  const nbNoeuds = N.noms.length;

  // ---- proxies : un point virtuel par reference [@s a] (comme MIMS4Max)
  const proxies = [];
  // proxy sur un objet modal : poids = somme des deformees des points vises
  const proxyModal = (paires, texte) => {
    const md = modaux[ligneModale.get(paires[0][0]).g];
    const w = new Array(md.nb).fill(0), geo = [0, 0, 0];
    for (const [pt, p] of paires) {
      const r = ligneModale.get(pt).r;
      for (let k = 0; k < md.nb; k++) w[k] += p * md.lignes[r * md.nb + k];
      geo[0] += p * N.gx[pt]; geo[1] += p * N.gy[pt]; geo[2] += p * N.gz[pt];
    }
    proxies.push({ noeuds: [...Array(md.nb).keys()].map(k => md.debut + k), poids: w, ref: texte, geo, modal: true });
    return nbNoeuds + proxies.length - 1;
  };
  const resout = ref => {
    if (ref.nom !== undefined) {
      const i = indice.get(ref.nom);
      return ligneModale.has(i) ? proxyModal([[i, 1]], refTexte(ref)) : i;
    }
    const mc = macros.get(ref.macro);
    const noeuds = [], poids = [];
    if (mc.corde) {
      const n = mc.nx - 1, pt = Math.min(Math.max(val(ref.a), 0), 1) * n;
      const m1 = Math.min(Math.floor(pt), n), m2 = Math.min(m1 + 1, n), al = pt - m1;
      noeuds.push(mc.debut + m1, mc.debut + m2); poids.push(1 - al, al);
    } else {
      const pX = Math.min(Math.max(val(ref.a), 0), 1) * (mc.nx - 1);
      const pY = Math.min(Math.max(val(ref.b), 0), 1) * (mc.ny - 1);
      let i1 = Math.floor(pX), j1 = Math.floor(pY);
      const ai = pX - i1, aj = pY - j1;
      let i2 = Math.min(i1 + 1, mc.nx - 1), j2 = Math.min(j1 + 1, mc.ny - 1);
      i1 = Math.min(i1, mc.nx - 1); j1 = Math.min(j1, mc.ny - 1);
      const k = (i, j) => mc.debut + i * mc.ny + j;
      noeuds.push(k(i1, j1), k(i2, j1), k(i1, j2), k(i2, j2));
      poids.push((1 - ai) * (1 - aj), ai * (1 - aj), (1 - ai) * aj, ai * aj);
    }
    if (ligneModale.has(noeuds[0])) return proxyModal(noeuds.map((nd, k) => [nd, poids[k]]), refTexte(ref));
    proxies.push({ noeuds, poids, ref: refTexte(ref) });
    return nbNoeuds + proxies.length - 1;
  };

  // ---- interactions du script
  const plancherNom = nom => /(^|_)sol$/.test(nom) && mdl.masses.has(nom) && mdl.masses.get(nom).genre === "ground";
  const estModal = r => r.nom !== undefined ? ligneModale.has(indice.get(r.nom)) : ligneModale.has((macros.get(r.macro) || {}).debut);
  for (const it of mdl.interactions) {
    if (internes.has(it)) continue;                       // calcule dans les modes
    // contacts au sol d'un objet modal : abandonnes (un point par masse coute trop cher)
    if ((it.m1.nom !== undefined && plancherNom(it.m1.nom) && estModal(it.m2)) ||
        (it.m2.nom !== undefined && plancherNom(it.m2.nom) && estModal(it.m1))) continue;
    const i1 = resout(it.m1), i2 = resout(it.m2);
    const noms = [...ARGS[it.genre][0], ...ARGS[it.genre][1]];
    const args = it.args.map((t, k) => echelle(noms[k], val(t)));
    liens.push({ code: CODES_INTER.indexOf(it.genre), i1, i2, args, nom: it.nom });
  }
  const entrees = mdl.entrees.map(e => ({ nom: e.nom, i: resout(e.cible) }));
  // routage : pan (stereo) reparti de gauche a droite par defaut, gain en dB, canal (multicanal)
  const sorties = mdl.sorties.map((s, k, tout) => {
    const r = mdl.routage.get(s.nom) || {};
    const panDefaut = tout.length > 1 ? -1 + 2 * k / (tout.length - 1) : 0;
    return { nom: s.nom, genre: s.genre, i: resout(s.cible),
             pan: r.pan === null || r.pan === undefined ? panDefaut : Math.min(Math.max(r.pan, -1), 1),
             gain: r.gain || 0, canal: r.canal || k + 1, muet: !!r.muet };
  });

  // hauteur affichee d'un point (proxy = interpolee)
  const hauteur = i => i < nbNoeuds ? N.gz[i] : proxies[i - nbNoeuds].modal ? proxies[i - nbNoeuds].geo[2]
    : proxies[i - nbNoeuds].noeuds.reduce((s, n, k) => s + N.gz[n] * proxies[i - nbNoeuds].poids[k], 0);

  // ancien dialecte : contacts / pincements en hauteurs absolues
  const dec = liens.map(l => (mdl.legacy && (l.code === 3 || l.code === 4 || l.code === 8))
    ? hauteur(l.i1) - hauteur(l.i2) : 0);

  return {
    sr, nbNoeuds, nbProxies: proxies.length,
    noms: N.noms, element: N.element,
    etat: N.etat, A: N.A, B: N.B, invM: N.invM, grav: N.grav, u0: N.u0, ur0: N.ur0,
    gx: N.gx, gy: N.gy, gz: N.gz,
    proxies: proxies.map(p => ({ noeuds: p.noeuds, poids: p.poids, ref: p.ref, modal: !!p.modal })),
    proxyGeo: proxies.map((p, k) => {
      if (p.modal) return p.geo;
      const g = [0, 0, 0];
      p.noeuds.forEach((n, j) => { g[0] += N.gx[n] * p.poids[j]; g[1] += N.gy[n] * p.poids[j]; g[2] += N.gz[n] * p.poids[j]; });
      return g;
    }),
    liens: liens.map((l, k) => ({ code: l.code, i1: l.i1, i2: l.i2, args: l.args, dec: dec[k], nom: l.nom || null })),
    entrees, sorties,
    macros: [...macros].map(([nom, m]) => ({ nom, ...m })),
    structures,
    modaux, aretesModales,
    vibrants: modaux.flatMap(md => md.mobiles),           // points d'objets modaux : dessines comme des masses
    virtuel: modaux.flatMap(md => [...Array(md.nb).keys()].map(k => md.debut + k)),   // modes : pas dessines
    // plancher : point fixe nomme "sol" ou "..._sol" (contacts au plan z = 0)
    plancher: N.noms.map((nom, i) => i).filter(i => N.etat[i] === FIXE && /(^|_)sol$/.test(N.noms[i])),
    indices: [...indice],
  };
}

/* Positions 3D pour les masses qui n'en ont pas (scripts MIMS4Max) :
 * petit placement par ressorts dans le plan z = 0, deterministe. */
function placementAutomatique(N, mdl, indice, macros) {
  const libres = [];
  for (let i = 0; i < N.noms.length; i++) if (!N.aGeo[i] && N.element[i] === N.noms[i]) libres.push(i);
  if (!libres.length) return;
  const pos = new Map();
  libres.forEach((i, k) => {                         // depart : petite spirale
    const a = k * 2.399963, r = 1.5 * Math.sqrt(k + 1);
    pos.set(i, [r * Math.cos(a), -6 - r * Math.sin(a)]);
  });
  const ou = i => pos.get(i) || [N.gx[i], N.gy[i]];
  // liens entre elements (un proxy tire vers le centre de sa structure)
  const point = ref => {
    if (ref.nom !== undefined) return indice.get(ref.nom);
    const mc = macros.get(ref.macro);
    if (!mc) return undefined;
    const a = Math.min(Math.max(Number(ref.a) || 0.5, 0), 1);
    return mc.debut + Math.round(a * (mc.nx - 1)) * mc.ny + (mc.corde ? 0 : Math.floor(mc.ny / 2));
  };
  const aretes = [];
  for (const it of mdl.interactions) {
    const a = point(it.m1), b = point(it.m2);
    if (a !== undefined && b !== undefined) aretes.push([a, b]);
  }
  for (const e of mdl.entrees) {
    const b = point(e.cible), a = indice.get(e.nom);
    if (a !== undefined && b !== undefined) aretes.push([a, b]);
  }
  if (libres.length <= 400) {
    const L = 2.0;
    for (let it = 0; it < 250; it++) {
      const t = 0.3 * (1 - it / 250) + 0.02;
      const d = new Map(libres.map(i => [i, [0, 0]]));
      for (let p = 0; p < libres.length; p++)
        for (let q = p + 1; q < libres.length; q++) {
          const a = ou(libres[p]), b = ou(libres[q]);
          let dx = a[0] - b[0], dy = a[1] - b[1];
          const r2 = Math.max(dx * dx + dy * dy, 0.01), f = L * L / r2;
          d.get(libres[p])[0] += dx * f; d.get(libres[p])[1] += dy * f;
          d.get(libres[q])[0] -= dx * f; d.get(libres[q])[1] -= dy * f;
        }
      for (const [a, b] of aretes) {
        const pa = ou(a), pb = ou(b);
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1], r = Math.hypot(dx, dy) || 1e-3;
        const f = (r - L) / r;
        if (d.has(a)) { d.get(a)[0] -= dx * f; d.get(a)[1] -= dy * f; }
        if (d.has(b)) { d.get(b)[0] += dx * f; d.get(b)[1] += dy * f; }
      }
      for (const i of libres) {
        const v = d.get(i), n = Math.hypot(v[0], v[1]) || 1, s = Math.min(n, t * 4) / n;
        const p = pos.get(i); p[0] += v[0] * s; p[1] += v[1] * s;
      }
    }
  }
  for (const i of libres) { const p = pos.get(i); N.gx[i] = p[0]; N.gy[i] = p[1]; N.gz[i] = 0; N.aGeo[i] = 1; }
}

class Simulateur {
  constructor(desc) {
    this.desc = desc;
    const n = desc.nbNoeuds, np = desc.nbProxies, T = n + np;
    this.n = n; this.T = T;
    this.noms = desc.noms;
    this.sorties = desc.sorties;
    this.u = new Float64Array(T);
    this.ur = new Float64Array(T);
    this.f = new Float64Array(T);
    this.etat = Int8Array.from(desc.etat);
    this.A = Float64Array.from(desc.A);
    this.B = Float64Array.from(desc.B);
    this.invM = Float64Array.from(desc.invM);
    this.grav = Float64Array.from(desc.grav);
    this.u0 = Float64Array.from(desc.u0);
    this.ur0 = Float64Array.from(desc.ur0);
    this.cible = new Float64Array(n);        // entrees de position (u vise)
    this.vitesse = new Float64Array(n);      // entrees entrainees (archet) : u par pas
    this.lissage = 0.002;

    // proxies a plat
    this.pDebut = new Int32Array(np + 1);
    const pn = [], pp = [];
    desc.proxies.forEach((p, k) => { this.pDebut[k] = pn.length; pn.push(...p.noeuds); pp.push(...p.poids); });
    this.pDebut[np] = pn.length;
    this.pNoeud = Int32Array.from(pn);
    this.pPoids = Float64Array.from(pp);

    // interactions a plat
    const L = desc.liens, ni = L.length;
    this.code = new Int8Array(ni); this.i1 = new Int32Array(ni); this.i2 = new Int32Array(ni);
    this.dec = new Float64Array(ni); this.args = new Float64Array(ni * NB_ARGS); this.nargs = new Int8Array(ni);
    L.forEach((l, k) => {
      this.code[k] = l.code; this.i1[k] = l.i1; this.i2[k] = l.i2; this.dec[k] = l.dec;
      this.nargs[k] = Math.min(l.args.length, NB_ARGS);
      for (let j = 0; j < this.nargs[k]; j++) this.args[k * NB_ARGS + j] = l.args[j];
    });
    this.entrees = Int32Array.from(desc.entrees.map(e => e.i));
    // points d'objets modaux : une frappe se repartit sur les modes
    this.pointModal = new Map();
    for (const md of desc.modaux || []) md.membres.forEach((i, r) => this.pointModal.set(i, { md, r }));
    // structures migen-plus : parametres a plat (K, Kb, Z, tmod) pour les transitions
    this.structs = (desc.structures || []).map(st => ({ type: st.type, debut: st.debut, nx: st.nx, ny: st.ny }));
    this.sP = new Float64Array(this.structs.length * 4);
    (desc.structures || []).forEach((st, k) => this.sP.set([st.K, st.Kb, st.Z, st.tmod], 4 * k));
    this.impulsion = null;                   // {reste, duree, amp}
    this._tr = null; this._compteTr = 0;     // transition de coefficients en cours
    this.reset();
  }

  reset() {
    this.u.fill(0); this.ur.fill(0); this.f.fill(0);
    this.u.set(this.u0); this.ur.set(this.ur0);
    for (let i = 0; i < this.n; i++) this.cible[i] = this.u0[i];
    this._proxiesPos(); this._proxiesPos();
    this.impulsion = null;
  }

  /* reprend l'etat d'un autre simulateur (meme structure) : reglage a chaud */
  adopter(autre) {
    if (!autre || autre.T !== this.T || autre.noms.length !== this.noms.length) return false;
    for (let i = 0; i < this.noms.length; i++) if (autre.noms[i] !== this.noms[i]) return false;
    this.u.set(autre.u); this.ur.set(autre.ur); this.f.set(autre.f);
    this.cible.set(autre.cible); this.vitesse.set(autre.vitesse);
    return true;
  }

  /* Comme adopter(), mais les coefficients (raideurs, masses, positions des
   * proxies...) glissent de leurs anciennes valeurs aux nouvelles en nEch pas :
   * bouger un curseur ne fait plus de saut (donc plus de clic). */
  transitionDepuis(ancien, nEch) {
    if (!this.adopter(ancien)) return false;
    if (nEch < 8 || ancien.code.length !== this.code.length || ancien.sP.length !== this.sP.length) return true;
    const champs = ["A", "B", "invM", "grav", "args", "dec", "sP"];
    const de = {}, vers = {};
    for (const c of champs) { de[c] = Float64Array.from(ancien[c]); vers[c] = Float64Array.from(this[c]); this[c].set(de[c]); }
    // proxies : poids sur l'union des anciens et nouveaux points
    let proxies = null;
    const np = this.pDebut.length - 1;
    if (np > 0 && ancien.pDebut.length - 1 === np) {
      const fin = { pDebut: this.pDebut, pNoeud: this.pNoeud, pPoids: this.pPoids };
      const deb = [0], noe = [], pde = [], pve = [];
      for (let k = 0; k < np; k++) {
        const poids = new Map();
        for (let j = ancien.pDebut[k]; j < ancien.pDebut[k + 1]; j++) {
          const n = ancien.pNoeud[j], w = ancien.pPoids[j];
          poids.set(n, [(poids.get(n) || [0, 0])[0] + w, 0]);
        }
        for (let j = this.pDebut[k]; j < this.pDebut[k + 1]; j++) {
          const n = this.pNoeud[j], w = this.pPoids[j], q = poids.get(n) || [0, 0];
          poids.set(n, [q[0], q[1] + w]);
        }
        for (const [n, [a, b]] of poids) { noe.push(n); pde.push(a); pve.push(b); }
        deb.push(noe.length);
      }
      this.pDebut = Int32Array.from(deb); this.pNoeud = Int32Array.from(noe);
      this.pPoids = Float64Array.from(pde);
      proxies = { de: Float64Array.from(pde), vers: Float64Array.from(pve), fin };
    }
    this._tr = { k: 0, n: nEch, champs, de, vers, proxies };
    return true;
  }

  _avanceTransition() {
    const tr = this._tr;
    tr.k += 8;
    const t = Math.min(tr.k / tr.n, 1);
    for (const c of tr.champs) {
      const a = this[c], de = tr.de[c], vers = tr.vers[c];
      for (let i = 0; i < a.length; i++) a[i] = de[i] + (vers[i] - de[i]) * t;
    }
    if (tr.proxies) {
      const w = this.pPoids, de = tr.proxies.de, vers = tr.proxies.vers;
      for (let i = 0; i < w.length; i++) w[i] = de[i] + (vers[i] - de[i]) * t;
    }
    if (t >= 1) {
      if (tr.proxies) Object.assign(this, tr.proxies.fin);
      this._tr = null;
    }
  }

  /* impulsion de vitesse (bouton Frapper) sur un point ou un proxy */
  frapper(i, force = 0.3) {
    if (i < 0 || i >= this.T) return;
    if (i >= this.n) {
      const k = i - this.n;
      for (let j = this.pDebut[k]; j < this.pDebut[k + 1]; j++)
        if (this.etat[this.pNoeud[j]] === MOBILE) this.ur[this.pNoeud[j]] += force * this.pPoids[j];
    } else if (this.pointModal.has(i)) {
      const { md, r } = this.pointModal.get(i);
      for (let k = 0; k < md.nb; k++) this.ur[md.debut + k] += force * md.lignes[r * md.nb + k];
    } else if (this.etat[i] === MOBILE) this.ur[i] += force;
  }

  /* coup de force sur les entrees frcInput (demi-sinus) */
  pousser(force = 0.3, duree = 48) {
    // aire du demi-sinus = force : la masse poussee gagne force / M de vitesse (vers le bas)
    if (this.entrees.length) this.impulsion = { reste: duree, duree, amp: -force * Math.PI / (2 * duree) };
  }

  /* deplace une entree de position (u vise ; elle y glisse en douceur) */
  placer(i, u) {
    if (i >= 0 && i < this.n && this.etat[i] === ENTREE) this.cible[i] = u;
  }

  /* fait avancer une entree a vitesse constante (archet) */
  entrainer(i, v) {
    if (i >= 0 && i < this.n && this.etat[i] === ENTREE) this.vitesse[i] = v;
  }

  sortie(k) {
    const s = this.sorties[k];
    return s.genre === "frcOutput" ? this.f[s.i] : this.u[s.i];
  }

  amplitude() {
    let a = 0;
    for (let i = 0; i < this.n; i++)
      if (this.etat[i] === MOBILE) a = Math.max(a, Math.abs(this.u[i] - this.u0[i]));
    return a;
  }

  pas(nb = 1) {
    for (let k = 0; k < nb; k++) this._unPas();
    return this.sain();
  }

  sain() {
    for (let i = 0; i < this.n; i++)
      if (!(Math.abs(this.u[i]) < 1e6)) { this.reset(); return false; }
    return true;
  }

  _proxiesPos() {
    const { u, ur, pDebut, pNoeud, pPoids, n } = this;
    for (let k = 0; k + 1 < pDebut.length; k++) {
      let s = 0;
      for (let j = pDebut[k]; j < pDebut[k + 1]; j++) s += pPoids[j] * u[pNoeud[j]];
      ur[n + k] = u[n + k];
      u[n + k] = s;
    }
  }

  _unPas() {
    if (this._tr && (this._compteTr = (this._compteTr + 1) & 7) === 0) this._avanceTransition();
    const { u, ur, f, etat, A, B, invM, grav, cible, lissage, n } = this;
    // 1) masses (et entrees pilotees)
    for (let i = 0; i < n; i++) {
      const e = etat[i];
      if (e === MOBILE) {
        // (+1e-18 -1e-18) ramene a 0 les valeurs infimes : sans ca, quand le son
        // s'eteint, le processeur passe en nombres "denormaux", jusqu'a 100x plus lents
        const un = (A[i] * u[i] + B[i] * ur[i] + (f[i] - grav[i]) * invM[i] + 1e-18) - 1e-18;
        ur[i] = u[i]; u[i] = un;
      } else if (e === ENTREE) {
        cible[i] += this.vitesse[i];
        ur[i] = u[i]; u[i] += (cible[i] - u[i]) * lissage;
      } else ur[i] = u[i];
      f[i] = 0;
    }
    // 2) positions des proxies
    this._proxiesPos();
    // 3) interactions
    const { code, i1, i2, dec, args, nargs } = this;
    for (let k = 0; k < code.length; k++) {
      const p = i1[k], q = i2[k], o = k * NB_ARGS;
      const d = u[p] - u[q] + dec[k];
      const dv = (u[p] - ur[p]) - (u[q] - ur[q]);
      let fv;
      switch (code[k]) {
        case 0: fv = args[o] * d; break;                                   // spring
        case 1: fv = args[o] * dv; break;                                  // damper
        case 2: fv = args[o] * d + args[o + 1] * dv; break;                // springDamper
        case 3: {                                                          // contact
          const s = nargs[k] > 2 ? args[o + 2] : 0.0;
          fv = d > -s ? args[o] * (d + s) + args[o + 1] * dv : 0.0;
          break;
        }
        case 4: fv = Simulateur._nl3Clipped(d, dv, args, o, nargs[k], true); break;
        case 5: fv = Simulateur._nl3Clipped(d, dv, args, o, nargs[k], false); break;
        case 6: fv = args[o] * d + args[o + 1] * d * d * d + args[o + 2] * dv; break;
        case 7: fv = args[o] * d + args[o + 1] * Math.sign(d) * d * d + args[o + 2] * dv; break;
        case 8: fv = Simulateur._nlPluck(d, dv, args, o, nargs[k]); break;
        case 9: fv = Simulateur._nlBow(dv, args, o, nargs[k]); break;
        case 10: {                                                         // contactHC
          const dd = d + (nargs[k] > 3 ? args[o + 3] : 0);
          if (dd > 0) { const dp = Math.pow(dd, args[o + 1]); fv = dp * (args[o] + args[o + 2] * dv); if (fv < 0) fv = 0; }
          else fv = 0;
          break;
        }
        case 11: {                                                         // friction (Stribeck)
          const mu = args[o + 2] + (args[o + 1] - args[o + 2]) * Math.exp(-Math.abs(dv) / Math.max(args[o + 3], 1e-12));
          fv = args[o] * mu * Math.tanh(dv / Math.max(args[o + 4], 1e-12));
          break;
        }
        default: continue;
      }
      f[p] -= fv;
      f[q] += fv;
    }
    // structures migen-plus (corde a flexion, plaque)
    for (let s = 0; s < this.structs.length; s++) this._structure(this.structs[s], 4 * s);
    // entrees de force
    const imp = this.impulsion;
    if (imp) {
      const v = imp.amp * Math.sin(Math.PI * (imp.duree - imp.reste + 0.5) / imp.duree);
      for (let k = 0; k < this.entrees.length; k++) f[this.entrees[k]] += v;
      if (--imp.reste <= 0) this.impulsion = null;
    }
    // 4) forces des proxies -> masses voisines
    const { pDebut, pNoeud, pPoids } = this;
    for (let k = 0; k + 1 < pDebut.length; k++) {
      const fp = f[n + k];
      if (fp === 0) continue;
      for (let j = pDebut[k]; j < pDebut[k + 1]; j++) f[pNoeud[j]] += fp * pPoids[j];
      f[n + k] = 0;
    }
  }

  /* corde a flexion / plaque : tension (modulee) + amortissement entre
   * voisins, puis flexion (energie Kb/2 * somme des courbures^2) ;
   * meme calcul que compute_bend_string / compute_plate de migen-plus */
  _structure(st, o) {
    const { u, ur, f } = this, sP = this.sP;
    const K = sP[o], Kb = sP[o + 1], Z = sP[o + 2], tmod = sP[o + 3];
    const d0 = st.debut, nx = st.nx, ny = st.ny;
    let Keff = K;
    if (tmod !== 0) {
      let s = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny - 1; j++) { const e = u[d0 + i * ny + j + 1] - u[d0 + i * ny + j]; s += e * e; }
      for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny; j++) { const e = u[d0 + (i + 1) * ny + j] - u[d0 + i * ny + j]; s += e * e; }
      Keff = K + tmod * s / (st.type === 0 ? nx - 1 : nx * ny);
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny - 1; j++) {
      const p = d0 + i * ny + j, q = p + 1;
      const fv = Keff * (u[p] - u[q]) + Z * ((u[p] - ur[p]) - (u[q] - ur[q]));
      f[p] -= fv; f[q] += fv;
    }
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny; j++) {
      const p = d0 + i * ny + j, q = p + ny;
      const fv = Keff * (u[p] - u[q]) + Z * ((u[p] - ur[p]) - (u[q] - ur[q]));
      f[p] -= fv; f[q] += fv;
    }
    if (Kb === 0) return;
    if (st.type === 0) {
      for (let i = 1; i < nx - 1; i++) {
        const p = d0 + i, c = u[p - 1] - 2 * u[p] + u[p + 1];
        f[p] += 2 * Kb * c; f[p - 1] -= Kb * c; f[p + 1] -= Kb * c;
      }
    } else {
      for (let i = 1; i < nx - 1; i++) for (let j = 1; j < ny - 1; j++) {
        const p = d0 + i * ny + j, c = u[p - 1] + u[p + 1] + u[p - ny] + u[p + ny] - 4 * u[p];
        f[p] += 4 * Kb * c; f[p - 1] -= Kb * c; f[p + 1] -= Kb * c; f[p - ny] -= Kb * c; f[p + ny] -= Kb * c;
      }
    }
  }

  /* ---- non-linearites (portees de migen-lib) ---- */

  static _nl3Clipped(d, dv, a, o, na, contact) {
    const s = a[o], c = a[o + 1], k = a[o + 2], Z = a[o + 3];
    const seuil = contact && na > 4 ? a[o + 4] : 0.0;
    if (contact && !(d > -seuil)) return 0.0;
    const dd = d + seuil;
    let fv;
    if (contact && k < s) fv = s * dd;                  // migen-lib : k = s, c = 0
    else if (c === 0) fv = s * dd;
    else if (s >= k) fv = k * dd;
    else if (Math.abs(dd) <= Math.sqrt((k - s) / c)) fv = dd * (s + c * dd * dd);
    else { fv = k * dd; if (!contact) return fv + (Z + 0.3 * k) * dv; }   // "HACK" de migen-lib
    return fv + Z * dv;
  }

  static _nlPluck(d, dv, a, o, na) {
    const nlK = a[o], scale = Math.max(a[o + 1], 1e-12);
    const Z = na > 2 ? a[o + 2] : 0.0;
    const tip = scale / 10, Kend = nlK / 10;
    const ad = Math.abs(d);
    if (ad < tip) return -(nlK - Kend) * d;
    if (ad < scale)
      return d > 0 ? -tip * nlK + Kend * d + Z * dv : tip * nlK + Kend * d + Z * dv;
    return 0.0;
  }

  static _nlBow(dv, a, o, na) {
    const nlZ = a[o], scale = Math.max(a[o + 1], 1e-12);
    const smooth = na > 2 ? a[o + 2] : 0.0;
    if (smooth >= 1) return 0.63 * nlZ * dv * Math.exp(-4 * (dv / scale) ** 2 + 0.5);
    const tip = scale / 3, Zend = nlZ / 3;
    const av = Math.abs(dv);
    if (av < tip) return (nlZ - Zend) * dv;
    if (av < scale) return dv > 0 ? tip * nlZ - Zend * dv : -tip * nlZ - Zend * dv;
    return 0.0;
  }
}

/* constantes utilisees par le moteur, a copier dans le fil audio */
const SOURCE_MOTEUR = () => [
  `const NB_ARGS = ${NB_ARGS}, MOBILE = ${MOBILE}, FIXE = ${FIXE}, ENTREE = ${ENTREE};`,
  Simulateur.toString(),
].join("\n");

/* Marge de stabilite (schema saute-mouton) : pour une masse seule,
 * le calcul reste stable tant que (K + 2 Z) / M < 4. Pour un reseau, on
 * borne K et Z par la somme des liaisons (Gershgorin) : 2x pour une
 * liaison vers une masse mobile, 1x vers un point fixe. Contacts compris
 * (quand ils touchent). Renvoie le pire rapport (< 1 = stable) et le point. */
function margeStabilite(desc) {
  const n = desc.nbNoeuds, K = new Float64Array(n), Z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (desc.etat[i] !== MOBILE) continue;
    const M = 1 / desc.invM[i];                       // osc : A = 2-(K+Z)/M, B = Z/M-1
    Z[i] = (desc.B[i] + 1) * M;
    K[i] = (2 - desc.A[i]) * M - Z[i];
  }
  const ajoute = (i, k, z, poids, autreMobile) => {
    const f = autreMobile ? 2 : 1;
    if (i < n) { if (desc.etat[i] === MOBILE) { K[i] += f * k; Z[i] += f * z; } return; }
    const p = desc.proxies[i - n];
    p.noeuds.forEach((m, j) => { if (desc.etat[m] === MOBILE) { K[m] += f * k * p.poids[j]; Z[m] += f * z * p.poids[j]; } });
  };
  const mobile = i => i >= n || desc.etat[i] === MOBILE;
  for (const l of desc.liens) {
    let k = 0, z = 0;
    const a = l.args;
    switch (l.code) {
      case 0: k = a[0]; break;
      case 1: z = a[0]; break;
      case 2: case 3: k = a[0]; z = a[1] || 0; break;
      case 4: case 5: k = Math.max(a[0], a[2] || 0); z = a[3] || 0; break;
      case 6: case 7: k = a[0]; z = a[2] || 0; break;
      case 8: k = a[0]; z = a[2] || 0; break;
      case 9: z = a[0]; break;
    }
    k = Math.abs(k || 0); z = Math.abs(z || 0);
    ajoute(l.i1, k, z, 1, mobile(l.i2));
    ajoute(l.i2, k, z, 1, mobile(l.i1));
  }
  // structures migen-plus : tension 2K par voisin, flexion 16 Kb (corde) / 64 Kb (plaque)
  for (const st of desc.structures || []) {
    for (let i = 0; i < st.nx; i++) for (let j = 0; j < st.ny; j++) {
      const p = st.debut + i * st.ny + j;
      if (desc.etat[p] !== MOBILE) continue;
      const voisins = (i > 0) + (i < st.nx - 1) + (j > 0) + (j < st.ny - 1);
      K[p] += 2 * st.K * voisins + (st.type === 0 ? 16 : 64) * st.Kb;
      Z[p] += 2 * st.Z * voisins;
    }
  }
  let pire = 0, ou = -1;
  const virtuel = new Set(desc.virtuel || []);              // modes : stables par construction
  for (let i = 0; i < n; i++) {
    if (desc.etat[i] !== MOBILE || virtuel.has(i)) continue;
    const r = (K[i] + 2 * Z[i]) * desc.invM[i] / 4;
    if (r > pire) { pire = r; ou = i; }
  }
  return { rapport: pire, noeud: ou };
}
