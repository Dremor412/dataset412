"use strict";
/* ------------------------------------------------------------------ *
 *  Budget materiel : on mesure au demarrage le cout reel d'une masse  *
 *  et d'une liaison sur CETTE machine, puis on en deduit la charge    *
 *  audio d'un modele et la taille maximale d'un objet importe.        *
 *  (Le son tourne sur un seul coeur : charge 100 % = decrochages.)    *
 * ------------------------------------------------------------------ */

function descSynthetique(n, liensParMasse) {
  const desc = {
    sr: null, nbNoeuds: n, nbProxies: 0, noms: [], element: [], etat: [], A: [], B: [],
    invM: [], grav: [], u0: [], ur0: [], gx: [], gy: [], gz: [], proxies: [], liens: [],
    entrees: [], sorties: [{ nom: "out1", genre: "posOutput", i: 1 }], macros: [], indices: [],
  };
  for (let i = 0; i < n; i++) {
    desc.noms.push("m" + i); desc.element.push("m" + i);
    desc.etat.push(i === 0 ? FIXE : MOBILE);
    desc.A.push(1.999); desc.B.push(-0.999); desc.invM.push(1); desc.grav.push(0);
    desc.u0.push(0); desc.ur0.push(i === n >> 1 ? -0.1 : 0);
    desc.gx.push(0); desc.gy.push(0); desc.gz.push(0);
  }
  for (let k = 1; k <= liensParMasse; k++)
    for (let i = 0; i < n; i++)
      desc.liens.push({ code: 2, i1: i, i2: (i + k) % n, args: [0.05, 0.0001], dec: 0, nom: null });
  return desc;
}

const budget = {
  coutMasse: 6e-9,        // secondes par masse et par pas (valeurs prudentes
  coutLien: 8e-9,         //  avant la mesure)
  part: 0.5,              // part d'un coeur qu'on s'autorise pour le son
  sr: 48000,
  mesure: false,

  _chrono(n, k, pas) {
    const sim = new Simulateur(descSynthetique(n, k));
    sim.pas(Math.min(pas, 1500));                       // chauffe (JIT)
    let meilleur = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      sim.pas(pas);
      meilleur = Math.min(meilleur, performance.now() - t0);
    }
    return meilleur / 1000 / pas;                       // secondes par pas
  },

  mesurer() {
    const n = 400;
    const t1 = this._chrono(n, 1, 2000), t4 = this._chrono(n, 4, 2000);
    const cl = Math.max((t4 - t1) / (3 * n), 1e-10);
    const cm = Math.max((t1 - n * cl) / n, 1e-10);
    this.coutMasse = cm; this.coutLien = cl; this.mesure = true;
    return { cm, cl };
  },

  /* part d'un coeur utilisee par le son pour ces comptes */
  charge(c, sr = this.sr) {
    return (c.masses * this.coutMasse + (c.liaisons + 2 * c.proxies) * this.coutLien) * sr;
  },

  /* plus grand nombre de masses qui tient dans le budget, a "ratio" liaisons par masse */
  maxMasses(ratio, sr = this.sr) {
    return Math.max(20, Math.floor(this.part / ((this.coutMasse + ratio * this.coutLien) * sr)));
  },

  maxLiens(masses, sr = this.sr) {
    return Math.max(0, Math.floor((this.part / sr - masses * this.coutMasse) / this.coutLien));
  },
};

/* comptes d'apres le modele compile (tient compte des objets modaux :
 * un mode = une masse, un point d'ecoute modal ~ nbModes / 2 liaisons) */
function comptesDesc(desc) {
  let masses = 0, liaisons = desc.liens.length, proxies = 0;
  for (let i = 0; i < desc.nbNoeuds; i++) if (desc.etat[i] === MOBILE) masses++;
  for (const st of desc.structures || []) liaisons += st.type === 0 ? 4 * st.nx : 7 * st.nx * st.ny;
  for (const p of desc.proxies) proxies += p.modal ? p.noeuds.length / 2 : 1;
  return { masses, fixes: 0, liaisons, proxies: Math.round(proxies) };
}
