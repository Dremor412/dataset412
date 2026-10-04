"use strict";
/* ------------------------------------------------------------------ *
 *  Formes 3D parametriques (portees de forme2mims, MIMS Studio)      *
 * ------------------------------------------------------------------ */

class GenModele {
  constructor(nom, M = 1.0, K = 0.1, Z = 0.0001, Zo = 0.01) {
    this.nom = nom;
    this.M = M; this.K = K; this.Z = Z; this.Zo = Zo;
    this.masses = [];          // {id, x, y, z, grounded}
    this.ressorts = new Set(); // "a,b" avec a < b
    this.sortiesIds = [];
    this.entree = null;        // {x, y, z, cible}
    this.sol = false;          // plancher physique en z = 0
  }
  masse(x, y, z, grounded = false) {
    const id = this.masses.length;
    this.masses.push({ id, x, y, z, grounded });
    return id;
  }
  ressort(a, b) {
    if (a !== b) this.ressorts.add(`${Math.min(a, b)},${Math.max(a, b)}`);
  }
  ecoute(id) { this.sortiesIds.push(id); }
  frappe(id, hauteurAuDessus = 5.0) {
    const m = this.masses[id];
    this.entree = { x: m.x, y: m.y, z: m.z + hauteurAuDessus, cible: id };
  }
  /* Les deux "extremites" de l'objet : les points les plus eloignes en
   * suivant la structure (diametre du graphe des ressorts, pondere par la
   * longueur). Donut coupe -> ses deux bouts, spirale -> debut et fin,
   * anneau ferme -> deux points opposes. Un couple par morceau. */
  extremites() {
    if (this.extremitesImposees) return this.extremitesImposees;
    const n = this.masses.length, voisins = this.masses.map(() => []);
    const dist = (a, b) => Math.hypot(this.masses[a].x - this.masses[b].x,
      this.masses[a].y - this.masses[b].y, this.masses[a].z - this.masses[b].z);
    for (const s of this.ressorts) {
      const [a, b] = s.split(",").map(Number), d = dist(a, b);
      voisins[a].push([b, d]); voisins[b].push([a, d]);
    }
    const plusLoin = depart => {                     // Dijkstra simple (n petit)
      const d = new Float64Array(n).fill(Infinity), vu = new Uint8Array(n);
      d[depart] = 0;
      for (;;) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!vu[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
        if (u < 0) break;
        vu[u] = 1;
        for (const [v, w] of voisins[u]) if (d[u] + w < d[v]) d[v] = d[u] + w;
      }
      let loin = depart;
      for (let i = 0; i < n; i++) if (d[i] < Infinity && d[i] > d[loin]) loin = i;
      return [loin, vu];
    };
    const paires = [], traite = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (traite[i]) continue;
      // depart : le point le plus bas du morceau, puis deux balayages
      const [, morceau] = plusLoin(i);
      let bas = i;
      for (let k = 0; k < n; k++) if (morceau[k]) { traite[k] = 1; if (this.masses[k].z < this.masses[bas].z) bas = k; }
      const [a] = plusLoin(bas), [b] = plusLoin(a);
      paires.push(a === b ? [a] : [a, b]);
    }
    return paires.flat();
  }
  /* accroche l'objet par ses extremites seulement (et le pose sur le sol) */
  ancrerExtremites() {
    for (const m of this.masses) m.grounded = false;
    for (const id of this.extremites()) this.masses[id].grounded = true;
    this.sol = true;
    this._reviseCibles();
  }
  /* la bille et les ecoutes ne doivent pas viser un point fixe */
  _reviseCibles() {
    const mobileProche = id => {
      let best = -1, dmin = Infinity;
      const a = this.masses[id];
      for (const m of this.masses) {
        if (m.grounded) continue;
        const d = Math.hypot(m.x - a.x, m.y - a.y, m.z - a.z);
        if (d < dmin) { dmin = d; best = m.id; }
      }
      return best < 0 ? id : best;
    };
    if (this.entree && this.masses[this.entree.cible].grounded) this.frappe(this.sommetLePlusHaut());
    this.sortiesIds = this.sortiesIds.map(id => this.masses[id].grounded ? mobileProche(id) : id);
  }
  sommetLePlusHaut() {
    let best = this.masses[0];
    for (const m of this.masses) if (!m.grounded && m.z > best.z) best = m;
    return best.id;
  }
  /* Script au format MIMS4Max (s'ouvre aussi dans Max) ; la geometrie
   * 3D est rangee a la fin dans des lignes ~pos, ignorees par Max. */
  script(note = "") {
    const n = this.nom, f = v => v.toFixed(2);
    const L = [`# ${n} : objet 3D genere par mi-gen Studio`];
    if (note) L.push(`# ${note}`);
    L.push("# Attrape la bille jaune (@in1) et descends-la sur l'objet, ou Frapper.");
    L.push("");
    L.push(`@${n}_M param ${this.M}`);
    L.push(`@${n}_K param ${this.K}`);
    L.push(`@${n}_Z param ${this.Z}`);
    L.push(`@${n}_Zo param ${this.Zo}`);
    if (this.sol) { L.push(`@${n}_solK param 1.0`); L.push(`@${n}_solZ param 0.005`); }
    L.push("");
    for (const m of this.masses) {
      if (m.grounded) L.push(`@${n}_m${m.id} ground 0.`);
      else L.push(`@${n}_m${m.id} osc ${n}_M 0. ${n}_Zo 0. 0.`);
    }
    L.push("");
    const paires = [...this.ressorts].map(s => s.split(",").map(Number))
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    paires.forEach(([a, b], i) => {
      L.push(`@${n}_r${i} springDamper @${n}_m${a} @${n}_m${b} ${n}_K ${n}_Z`);
    });
    L.push("");
    if (this.entree) {
      const e = this.entree, cible = this.masses[e.cible];
      // seuil = ecart de hauteur : le choc a lieu quand la bille touche la masse
      L.push("@in1 posInput 0.");
      L.push(`@${n}_exc contact @${n}_m${e.cible} @in1 0.1 0.001 ${f(cible.z - e.z)}`);
    }
    this.sortiesIds.forEach((id, i) => L.push(`@out${i + 1} posOutput @${n}_m${id}`));
    if (this.sol) {
      // plancher : un contact par masse mobile avec le sol (z = 0) ; le seuil
      // vaut la hauteur de la masse, donc le choc a lieu quand elle touche le plan
      L.push("", `# sol : aucune masse ne passe sous z = 0`, `@${n}_sol ground 0.`);
      for (const m of this.masses)
        if (!m.grounded)
          L.push(`@${n}_s${m.id} contact @${n}_sol @${n}_m${m.id} ${n}_solK ${n}_solZ ${f(-m.z)}`);
    }
    L.push("");
    L.push(`# geometrie 3D (affichage seulement) : ${this.masses.length} masses, ${this.ressorts.size} ressorts`);
    for (const m of this.masses) L.push(`~pos @${n}_m${m.id} ${f(m.x)} ${f(m.y)} ${f(m.z)}`);
    if (this.entree) L.push(`~pos @in1 ${f(this.entree.x)} ${f(this.entree.y)} ${f(this.entree.z)}`);
    if (this.sol) L.push(`~pos @${n}_sol 0 0 0`);
    return L.join("\n") + "\n";
  }
}

const TAU = 2 * Math.PI;

function formeBoite(nx = 6, ny = 6, nz = 6, taille = 14.0, hauteur = 14.0) {
  const m = new GenModele("boite");
  const ids = new Map();
  const k3 = (i, j, k) => `${i},${j},${k}`;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const x = -taille / 2 + taille * i / (nx - 1);
        const y = -taille / 2 + taille * j / (ny - 1);
        const z = hauteur * k / (nz - 1);
        const pied = k === 0 && (i === 0 || i === nx - 1) && (j === 0 || j === ny - 1);
        ids.set(k3(i, j, k), m.masse(x, y, z, pied));
      }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        if (i + 1 < nx) m.ressort(ids.get(k3(i, j, k)), ids.get(k3(i + 1, j, k)));
        if (j + 1 < ny) m.ressort(ids.get(k3(i, j, k)), ids.get(k3(i, j + 1, k)));
        if (k + 1 < nz) m.ressort(ids.get(k3(i, j, k)), ids.get(k3(i, j, k + 1)));
      }
  m.frappe(ids.get(k3(Math.floor(nx / 2), Math.floor(ny / 2), nz - 1)));
  m.ecoute(ids.get(k3(Math.floor(nx / 2), 0, Math.floor(nz / 2))));
  m.ecoute(ids.get(k3(0, Math.floor(ny / 2), Math.floor(nz / 2))));
  return [m, `boite ${nx}x${ny}x${nz}, base au sol, 4 pieds ground aux coins`];
}

function formePyramide(base = 7, etages = 5, taille = 16.0, hauteur = 12.0) {
  const m = new GenModele("pyramide");
  const couches = [];
  for (let k = 0; k < etages; k++) {
    const cote = base - k;
    const span = taille * cote / base;
    const z = etages > 1 ? hauteur * k / (etages - 1) : 0.0;
    const couche = new Map();
    for (let i = 0; i < cote; i++)
      for (let j = 0; j < cote; j++) {
        const x = -span / 2 + (cote > 1 ? span * i / (cote - 1) : 0.0);
        const y = -span / 2 + (cote > 1 ? span * j / (cote - 1) : 0.0);
        const pied = k === 0 && (i === 0 || i === cote - 1) && (j === 0 || j === cote - 1);
        couche.set(`${i},${j}`, m.masse(x, y, z, pied));
      }
    couches.push([cote, couche]);
  }
  couches.forEach(([cote, couche], k) => {
    for (let i = 0; i < cote; i++)
      for (let j = 0; j < cote; j++) {
        if (i + 1 < cote) m.ressort(couche.get(`${i},${j}`), couche.get(`${i + 1},${j}`));
        if (j + 1 < cote) m.ressort(couche.get(`${i},${j}`), couche.get(`${i},${j + 1}`));
        if (k + 1 < etages) {
          const [coteH, coucheH] = couches[k + 1];
          const dec = Math.floor((cote - coteH) / 2);
          const ih = Math.min(Math.max(i - dec, 0), coteH - 1);
          const jh = Math.min(Math.max(j - dec, 0), coteH - 1);
          if (Math.abs(i - ih - dec) <= 1 && Math.abs(j - jh - dec) <= 1)
            m.ressort(couche.get(`${i},${j}`), coucheH.get(`${ih},${jh}`));
        }
      }
  });
  m.frappe(m.sommetLePlusHaut());
  const [cote0, couche0] = couches[0];
  m.ecoute(couche0.get(`${Math.floor(cote0 / 2)},0`));
  m.ecoute(couche0.get(`0,${Math.floor(cote0 / 2)}`));
  return [m, `pyramide de ${etages} etages sur base ${base}x${base}`];
}

function formeTour(etages = 8, secteurs = 12, rayon = 4.5, hauteur = 16.0) {
  const m = new GenModele("tour");
  const ids = new Map();
  for (let k = 0; k < etages; k++) {
    const z = hauteur * k / (etages - 1);
    for (let s = 0; s < secteurs; s++) {
      const a = TAU * s / secteurs;
      ids.set(`${k},${s}`, m.masse(rayon * Math.cos(a), rayon * Math.sin(a), z, k === 0));
    }
  }
  for (let k = 0; k < etages; k++)
    for (let s = 0; s < secteurs; s++) {
      m.ressort(ids.get(`${k},${s}`), ids.get(`${k},${(s + 1) % secteurs}`));
      if (k + 1 < etages) {
        m.ressort(ids.get(`${k},${s}`), ids.get(`${k + 1},${s}`));
        m.ressort(ids.get(`${k},${s}`), ids.get(`${k + 1},${(s + 1) % secteurs}`));
      }
    }
  m.frappe(ids.get(`${etages - 1},0`));
  m.ecoute(ids.get(`${Math.floor(etages / 2)},${Math.floor(secteurs / 3)}`));
  m.ecoute(ids.get(`${etages - 1},${Math.floor(secteurs / 2)}`));
  return [m, `tour/cloche ${etages} etages x ${secteurs} secteurs, base scellee au sol`];
}

function formeSphere(meridiens = 12, paralleles = 9, rayon = 7.0) {
  const m = new GenModele("sphere");
  const sud = m.masse(0.0, 0.0, 0.0, true);
  const nord = m.masse(0.0, 0.0, 2 * rayon);
  const anneaux = [];
  for (let p = 1; p <= paralleles; p++) {
    const theta = Math.PI * p / (paralleles + 1);
    const rr = rayon * Math.sin(theta);
    const z = rayon * (1 - Math.cos(theta));
    const anneau = [];
    for (let s = 0; s < meridiens; s++)
      anneau.push(m.masse(rr * Math.cos(TAU * s / meridiens),
                          rr * Math.sin(TAU * s / meridiens), z));
    anneaux.push(anneau);
  }
  anneaux.forEach((anneau, p) => {
    for (let s = 0; s < meridiens; s++) {
      m.ressort(anneau[s], anneau[(s + 1) % meridiens]);
      if (p + 1 < anneaux.length) m.ressort(anneau[s], anneaux[p + 1][s]);
    }
    if (p === 0) for (let s = 0; s < meridiens; s++) m.ressort(sud, anneau[s]);
    if (p === anneaux.length - 1)
      for (let s = 0; s < meridiens; s++) m.ressort(nord, anneau[s]);
  });
  m.frappe(nord);
  m.ecoute(anneaux[Math.floor(anneaux.length / 2)][0]);
  m.ecoute(anneaux[Math.floor(anneaux.length / 2)][Math.floor(meridiens / 2)]);
  return [m, `sphere ${meridiens}x${paralleles}, pole sud ancre au sol`];
}

function formeTore(nu = 20, nv = 8, R = 6.0, r = 2.2) {
  const m = new GenModele("tore");
  const ids = new Map();
  let zMin = null;
  for (let u = 0; u < nu; u++) {
    const au = TAU * u / nu - Math.PI / 2;
    for (let v = 0; v < nv; v++) {
      const av = TAU * v / nv;
      const rr = R + r * Math.cos(av);
      const x = rr * Math.cos(au);
      const z = rr * Math.sin(au) + R + r;
      const y = r * Math.sin(av);
      ids.set(`${u},${v}`, m.masse(x, y, z));
      if (zMin === null || z < zMin) zMin = z;
    }
  }
  // ancre les masses les plus basses (le point de contact avec le sol)
  for (const id of ids.values())
    if (m.masses[id].z < zMin + 0.6) m.masses[id].grounded = true;
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      m.ressort(ids.get(`${u},${v}`), ids.get(`${(u + 1) % nu},${v}`));
      m.ressort(ids.get(`${u},${v}`), ids.get(`${u},${(v + 1) % nv}`));
    }
  let haut = 0;
  for (const id of ids.values()) if (m.masses[id].z > m.masses[haut].z) haut = id;
  m.frappe(haut);
  m.ecoute(ids.get(`${Math.floor(nu / 4)},0`));
  m.ecoute(ids.get(`${Math.floor(3 * nu / 4)},${Math.floor(nv / 2)}`));
  return [m, `tore debout ${nu}x${nv} (roue), point de contact ancre au sol`];
}

function formeCloche(anneaux = 10, secteurs = 16, rBouche = 7.0, rCouronne = 2.8, H = 14.0) {
  const m = new GenModele("cloche", 1.0, 0.1, 0.00005, 0.002);
  const ids = new Map();
  for (let k = 0; k < anneaux; k++) {
    const t = (anneaux - 1 - k) / (anneaux - 1);
    const r = rCouronne + (rBouche - rCouronne) * t ** 1.8;
    const z = 0.5 + (H - 0.5) * k / (anneaux - 1);
    for (let s = 0; s < secteurs; s++) {
      const a = TAU * s / secteurs;
      ids.set(`${k},${s}`, m.masse(r * Math.cos(a), r * Math.sin(a), z, k === anneaux - 1));
    }
  }
  for (let k = 0; k < anneaux; k++)
    for (let s = 0; s < secteurs; s++) {
      m.ressort(ids.get(`${k},${s}`), ids.get(`${k},${(s + 1) % secteurs}`));
      if (k + 1 < anneaux) {
        m.ressort(ids.get(`${k},${s}`), ids.get(`${k + 1},${s}`));
        m.ressort(ids.get(`${k},${s}`), ids.get(`${k + 1},${(s + 1) % secteurs}`));
      }
    }
  m.frappe(ids.get("1,0"));
  m.ecoute(ids.get(`0,${Math.floor(secteurs / 2)}`));
  m.ecoute(ids.get(`2,${Math.floor(secteurs / 3)}`));
  return [m, "cloche a profil evase, couronne fixee, bouche libre — laisse-la resonner"];
}

function formeGrossecaisse(secteurs = 20, R = 8.0, H = 5.0) {
  const m = new GenModele("grossecaisse", 2.0, 0.06, 0.0002, 0.01);
  const fut = new Map();
  [0.0, H / 2, H].forEach((z, k) => {
    for (let s = 0; s < secteurs; s++) {
      const a = TAU * s / secteurs;
      fut.set(`${k},${s}`, m.masse(R * Math.cos(a), R * Math.sin(a), z, k === 0));
    }
  });
  for (let k = 0; k < 3; k++)
    for (let s = 0; s < secteurs; s++) {
      m.ressort(fut.get(`${k},${s}`), fut.get(`${k},${(s + 1) % secteurs}`));
      if (k + 1 < 3) m.ressort(fut.get(`${k},${s}`), fut.get(`${k + 1},${s}`));
    }

  function peau(z, anneauBord) {
    const centre = m.masse(0.0, 0.0, z);
    let prec = new Array(secteurs).fill(centre);
    for (let ai = 1; ai < 4; ai++) {                   // 3 anneaux internes
      const rr = R * ai / 4;
      const cour = [];
      for (let s = 0; s < secteurs; s++)
        cour.push(m.masse(rr * Math.cos(TAU * s / secteurs),
                          rr * Math.sin(TAU * s / secteurs), z));
      for (let s = 0; s < secteurs; s++) {
        m.ressort(cour[s], cour[(s + 1) % secteurs]);
        m.ressort(prec[ai > 1 ? s : 0], cour[s]);
      }
      prec = cour;
    }
    for (let s = 0; s < secteurs; s++) m.ressort(prec[s], anneauBord[s]);
    return centre;
  }

  const bordHaut = [], bordBas = [];
  for (let s = 0; s < secteurs; s++) {
    bordHaut.push(fut.get(`2,${s}`));
    bordBas.push(fut.get(`0,${s}`));
  }
  const cHaut = peau(H, bordHaut);
  const cBas = peau(0.0, bordBas);
  m.frappe(cHaut);
  m.ecoute(cBas);
  m.ecoute(cHaut);
  return [m, "grosse caisse : peau de frappe + peau de resonance couplees par le fut"];
}

function formeDonutcoupe(nu = 22, nv = 8, nuPlein = 28, R = 6.5, r = 2.2) {
  const m = new GenModele("donutcoupe", 1.0, 0.1, 0.0001, 0.004);
  const ids = new Map();
  for (let u = 0; u < nu; u++) {
    const au = TAU * u / nuPlein;
    for (let v = 0; v < nv; v++) {
      const av = TAU * v / nv;
      const rr = R + r * Math.cos(av);
      const z = r + r * Math.sin(av);
      ids.set(`${u},${v}`, m.masse(rr * Math.cos(au), rr * Math.sin(au), z, z < 0.15));
    }
  }
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      m.ressort(ids.get(`${u},${v}`), ids.get(`${u},${(v + 1) % nv}`));
      if (u + 1 < nu)                                  // pas de rebouclage : coupe !
        m.ressort(ids.get(`${u},${v}`), ids.get(`${u + 1},${v}`));
    }
  m.frappe(ids.get(`0,${Math.floor(nv / 4)}`));
  m.ecoute(ids.get(`${nu - 1},${Math.floor(nv / 4)}`));
  m.ecoute(ids.get(`${Math.floor(nu / 2)},0`));
  return [m, "donut coupe : la part manquante libere deux bords vifs (mode splitting)"];
}

function formeColimacon(n = 90, tours = 3, R0 = 9.0, H = 13.0) {
  const m = new GenModele("colimacon", 0.8, 0.12, 0.0001, 0.003);
  const parTour = Math.floor(n / tours);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = R0 * Math.exp(Math.log(0.28) * t);
    const a = TAU * tours * t;
    ids.push(m.masse(r * Math.cos(a), r * Math.sin(a), H * t, i < 3));
  }
  for (let i = 0; i < n - 1; i++) m.ressort(ids[i], ids[i + 1]);
  for (let i = 0; i < n - parTour; i++) m.ressort(ids[i], ids[i + parTour]);
  m.extremitesImposees = [ids[0], ids[n - 1]];       // debut et fin de la spirale
  m.frappe(ids[n - 2]);
  m.ecoute(ids[Math.floor(n / 2)]);
  m.ecoute(ids[parTour]);
  return [m, "spirale logarithmique : auto-similarite -> cascade de resonances (chirp)"];
}

function formeFibonacci() {
  const m = new GenModele("fibonacci", 1.0, 0.1, 0.00008, 0.002);
  const nb = 25;
  const socle = [];
  for (let i = 0; i < nb; i++)
    socle.push(m.masse(-12 + 24 * i / (nb - 1), 0.0, 0.0, i === 0 || i === nb - 1));
  for (let i = 0; i < nb - 1; i++) m.ressort(socle[i], socle[i + 1]);
  const tailles = [3, 8, 21, 13, 5];
  const tips = [];
  tailles.forEach((taille, ti) => {
    const baseIdx = Math.round(ti * (nb - 1) / 4);
    let prec = socle[baseIdx];
    const x = -12 + 24 * baseIdx / (nb - 1);
    for (let j = 0; j < taille; j++) {
      const nid = m.masse(x, 0.0, 0.9 * (j + 1));
      m.ressort(prec, nid);
      prec = nid;
    }
    tips.push(prec);
  });
  m.frappe(socle[3]);
  m.ecoute(tips[2]);
  m.ecoute(tips[3]);
  return [m, "orgue de Fibonacci : rapports ~nombre d'or = inharmonicite maximale"];
}

function formeMoebius(nu = 36, R = 7.0, d = 1.3) {
  const m = new GenModele("moebius", 1.0, 0.1, 0.0001, 0.003);
  const ids = new Map();
  for (let ui = 0; ui < nu; ui++) {
    const u = TAU * ui / nu;
    [-d, 0.0, d].forEach((w, wi) => {
      const rad = R + w * Math.cos(u / 2);
      const z = w * Math.sin(u / 2) + d;
      ids.set(`${ui},${wi}`, m.masse(rad * Math.cos(u), rad * Math.sin(u), z, z < 0.25));
    });
  }
  for (let ui = 0; ui < nu; ui++)
    for (let wi = 0; wi < 3; wi++) {
      if (wi + 1 < 3) m.ressort(ids.get(`${ui},${wi}`), ids.get(`${ui},${wi + 1}`));
      if (ui + 1 < nu) m.ressort(ids.get(`${ui},${wi}`), ids.get(`${ui + 1},${wi}`));
      else m.ressort(ids.get(`${ui},${wi}`), ids.get(`0,${2 - wi}`)); // recollement inverse !
    }
  let haut = ids.get("0,0");
  for (const id of ids.values()) if (m.masses[id].z > m.masses[haut].z) haut = id;
  m.frappe(haut);
  m.ecoute(ids.get(`${Math.floor(nu / 4)},1`));
  m.ecoute(ids.get(`${Math.floor(3 * nu / 4)},1`));
  return [m, "ruban de Moebius : recollement inverse = modes a demi-periode"];
}

function formeSablier(anneaux = 9, secteurs = 14, H = 14.0, rCol = 2.2, s = 4.0) {
  const m = new GenModele("sablier", 1.0, 0.1, 0.00008, 0.002);
  const ids = new Map();
  for (let k = 0; k < anneaux; k++) {
    const z = H * k / (anneaux - 1);
    const r = rCol * Math.cosh((z - H / 2) / s);
    for (let sct = 0; sct < secteurs; sct++) {
      const a = TAU * sct / secteurs;
      ids.set(`${k},${sct}`, m.masse(r * Math.cos(a), r * Math.sin(a), z, k === 0));
    }
  }
  for (let k = 0; k < anneaux; k++)
    for (let sct = 0; sct < secteurs; sct++) {
      m.ressort(ids.get(`${k},${sct}`), ids.get(`${k},${(sct + 1) % secteurs}`));
      if (k + 1 < anneaux) {
        m.ressort(ids.get(`${k},${sct}`), ids.get(`${k + 1},${sct}`));
        m.ressort(ids.get(`${k},${sct}`), ids.get(`${k + 1},${(sct + 1) % secteurs}`));
      }
    }
  m.frappe(ids.get(`${anneaux - 1},0`));
  m.ecoute(ids.get(`1,${Math.floor(secteurs / 2)}`));
  m.ecoute(ids.get(`${anneaux - 2},${Math.floor(secteurs / 2)}`));
  return [m, "sablier/catenoide : col etroit = couplage faible -> battements lents"];
}

function formeArbre() {
  const m = new GenModele("arbre", 0.9, 0.11, 0.0001, 0.0025);
  const tips = [];

  function branche(depart, x, y, z, dx, dy, dz, n, niveau) {
    let prec = depart;
    for (let j = 1; j <= n; j++) {
      const nid = m.masse(x + dx * j, y + dy * j, z + dz * j);
      m.ressort(prec, nid);
      prec = nid;
    }
    if (niveau === 0) { tips.push(prec); return; }
    const bx = x + dx * n, by = y + dy * n, bz = z + dz * n;
    const pas = dz * 0.78;
    const nSuiv = Math.max(2, Math.trunc(n / 1.6));
    if (niveau % 2 === 0) {                            // alterne les plans x / y
      branche(prec, bx, by, bz, 0.8 * pas, 0, pas, nSuiv, niveau - 1);
      branche(prec, bx, by, bz, -0.8 * pas, 0, pas, nSuiv, niveau - 1);
    } else {
      branche(prec, bx, by, bz, 0, 0.8 * pas, pas, nSuiv, niveau - 1);
      branche(prec, bx, by, bz, 0, -0.8 * pas, pas, nSuiv, niveau - 1);
    }
  }

  const racine = m.masse(0.0, 0.0, 0.0, true);
  branche(racine, 0, 0, 0, 0, 0, 1.3, 7, 3);           // tronc de 7 puis 3 divisions
  const sommetTronc = 7;                               // derniere masse du tronc
  m.frappe(sommetTronc);
  m.ecoute(tips[0]);
  m.ecoute(tips[tips.length - 1]);
  return [m, "arbre binaire auto-similaire : longueurs /1.6 -> resonances quasi-octaves"];
}

/* ---------------- catalogue (generators.py) ---------------- */

const CATALOGUE = {
  boite: [p => formeBoite(p.nx | 0, p.ny | 0, p.nz | 0),
          "Cube gelatineux pose au sol",
          { nx: ["largeur (billes)", 6, 2, 12],
            ny: ["profondeur", 6, 2, 12],
            nz: ["hauteur", 6, 2, 12] }],
  pyramide: [p => formePyramide(p.base | 0, p.etages | 0),
             "Pyramide a etages carres",
             { base: ["cote de la base", 7, 3, 12],
               etages: ["etages", 5, 2, 8] }],
  tour: [p => formeTour(p.etages | 0, p.secteurs | 0),
         "Cylindre / cloche simple, base scellee",
         { etages: ["etages", 8, 3, 16],
           secteurs: ["secteurs", 12, 6, 24] }],
  sphere: [p => formeSphere(p.meridiens | 0, p.paralleles | 0),
           "Sphere posee au sol",
           { meridiens: ["meridiens", 12, 6, 24],
             paralleles: ["paralleles", 9, 4, 16] }],
  tore: [p => formeTore(p.nu | 0, p.nv | 0),
         "Tore debout comme une roue",
         { nu: ["grand cercle", 20, 8, 36],
           nv: ["section", 8, 4, 12] }],
  cloche: [p => formeCloche(p.anneaux | 0, p.secteurs | 0),
           "Cloche a profil evase, couronne fixee",
           { anneaux: ["anneaux", 10, 4, 16],
             secteurs: ["secteurs", 16, 8, 24] }],
  grossecaisse: [p => formeGrossecaisse(p.secteurs | 0),
                 "Deux peaux couplees par un fut",
                 { secteurs: ["secteurs", 20, 8, 28] }],
  donutcoupe: [p => formeDonutcoupe(p.nu | 0, p.nv | 0),
               "Donut a plat auquel il manque une part",
               { nu: ["sections gardees", 22, 6, 40],
                 nv: ["section", 8, 4, 12] }],
  colimacon: [p => formeColimacon(p.n | 0),
              "Spirale logarithmique montante (chirp)",
              { n: ["nombre de billes", 90, 20, 200] }],
  fibonacci: [() => formeFibonacci(),
              "Orgue du nombre d'or (inharmonique)", {}],
  moebius: [p => formeMoebius(p.nu | 0),
            "Ruban de Moebius (modes a demi-periode)",
            { nu: ["sections", 36, 12, 60] }],
  sablier: [() => formeSablier(),
            "Catenoide : deux chambres couplees (battements)", {}],
  arbre: [() => formeArbre(),
          "Arbre binaire auto-similaire (quasi-octaves)", {}],
};

/* formes qui gardent leur accroche d'origine : la cloche pend par sa
 * couronne, l'arbre tient par son pied ; les autres sont accrochees par
 * leurs deux extremites et posees sur le sol */
const ACCROCHE_PROPRE = ["cloche", "arbre"];

function genere(nom, params) {
  const [fabrique] = CATALOGUE[nom];
  const [modele, note] = fabrique(params);
  if (ACCROCHE_PROPRE.includes(nom)) { modele.sol = true; modele._reviseCibles(); }
  else modele.ancrerExtremites();
  return [modele.script(note), note];
}

