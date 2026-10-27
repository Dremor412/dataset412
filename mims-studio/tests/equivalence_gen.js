/* Le code gen~ exporte calcule-t-il la meme chose que le studio ?
 * Pour chaque modele : le studio exporte le code gen~ (generateur officiel
 * MIMS4Max + migen-plus), on l'execute avec les VRAIES librairies .genexpr
 * (traduites en JS par tests/genexpr.js) et on compare, echantillon par
 * echantillon, avec le moteur du studio. Usage : node tests/equivalence_gen.js */
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const { traduireCodebox } = require("./genexpr.js");

const LIBS = ["migen-lib", "migen-integrated", "migen-proxies", "migen-plus"]
  .map(n => fs.readFileSync(path.join(__dirname, "..", "..", "mi-gen-lib", n + ".genexpr"), "utf8"));

const MODELES = {
  "corde pincee (string + proxies + nlPluck)": "MODELES_PRETS[0].script()",
  "corde frottee (stiffString + nlBow)": "MODELES_PRETS[1].script()",
  "membrane (closedMesh + contact)": "MODELES_PRETS[3].script()",
  "corde + membrane (2 proxies)": "MODELES_PRETS[4].script()",
  "corde a flexion + Hunt-Crossley + tension modulee": `\`
@K param 0.2
@Kb param 0.004
@c bendString 40 1. K Kb 0.0005 0.00002 3 0 0. 0.
@in1 posInput 0.3
@choc contactHC [@c 0.3] @in1 0.8 1.5 0.05 -0.2
@out1 posOutput [@c 0.7]
@out2 posOutput [@c 0.5]
\``,
  "barre libre + frottement": `\`
@b bendString 24 1. 0. 0.03 0.0002 0.00001 0 1 0. 0.
@in1 posInput 0.
@fr friction [@b 0.2] @in1 0.02 0.8 0.3 0.002 0.0005
@out1 posOutput [@b 0.9]
\``,
  "plaque bords libres + tension modulee": `\`
@pl plate 12 10 1. 0.05 0.01 0.0004 0.00003 2 2 0. 0.
@in1 posInput 0.5
@c contactHC [@pl 0.3 0.6] @in1 0.5 1.2 0.02
@out1 posOutput [@pl 0.7 0.2]
\``,
  "cloche 3D en modal (~modal, 40 modes)": `(() => { const def = {}; for (const [k, v] of Object.entries(CATALOGUE.cloche[2])) def[k] = v[1];
     return genere("cloche", def)[0] + "\\n@cloche_hauteur param 1.1\\n~modal cloche 40\\n"; })()`,
  "corde a flexion en modal (proxies mobiles)": `\`
@pos param 0.3
@c bendString 40 1. 0.2 0.004 0.0005 0.00002 0 0 0. 0.
@in1 posInput 0.3
@p nlPluck [@c pos] @in1 0.5 0.1 0.001
@out1 posOutput [@c 0.71]
@c_t60 param 1.5
~modal c 25
\``,
  "plaque en modal (proxies grille)": `\`
@pl plate 12 10 1. 0.05 0.01 0.0004 0.00003 0 2 0. 0.
@in1 posInput 0.5
@c contactHC [@pl 0.3 0.6] @in1 0.5 1.2 0.02
@out1 posOutput [@pl 0.7 0.2]
~modal pl 30
\``,
  "barre tres raide en modal (instable en masses)": `\`
@b bendString 30 1. 0. 2.5 0. 0. 0 1 0. 0.
@in1 posInput 0.3
@c contactHC [@b 0.4] @in1 0.05 1.5 0.01
@out1 posOutput [@b 0.95]
@b_t60 param 0.8
@b_brillance param 1
~modal b 20
\``,
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("file://" + path.join(__dirname, "..", "MIMS_Studio.html"));
  await p.waitForTimeout(600);
  await p.evaluate(() => tuto.fermer());
  const N = 6000;
  let echecs = 0;
  for (const [titre, expr] of Object.entries(MODELES)) {
    const r = await p.evaluate(({ expr, N }) => {
      const texte = eval(expr);
      const mdl = parse(texte);
      if (mdl.erreurs.length) return { erreur: mdl.erreurs.map(e => e.join(": ")).join(" | ") };
      const desc = compiler(mdl, { sr: 44100 });
      const conv = versMIMS4Max(mdl, desc, texte);
      const gen = genererGen(conv.texteGen, true, conv.plus);
      // le studio : entrees de position instantanees (comme update_input_pos), archet a vitesse fixe
      const sim = new Simulateur(desc);
      sim.lissage = 1;
      const entrees = [...mdl.masses.values()].filter(m => m.genre === "posInput").map(m => sim.noms.indexOf(m.nom));
      const archet = mdl.interactions.some(i => i.genre === "nlBow" || i.genre === "friction");
      const signal = t => archet ? 0.003 * t : (t < 200 ? 0.3 : Math.max(0.3 - 0.002 * (t - 200), -8));
      const sorties = [];
      for (let t = 0; t < N; t++) {
        for (const i of entrees) sim.placer(i, signal(t));
        sim._unPas();
        sorties.push(sim.sorties.map((s, k) => sim.sortie(k)));
      }
      return { code: gen.code, sorties, archet, nbIn: gen.nbEntrees, avert: conv.avertissements };
    }, { expr, N });
    if (r.erreur) { console.log(`ECHEC ${titre} : ${r.erreur}`); echecs++; continue; }
    let gen;
    try { gen = traduireCodebox(r.code, LIBS); }
    catch (e) { console.log(`ECHEC ${titre} : code gen~ non executable (${e.message})`); echecs++; continue; }
    const signal = t => r.archet ? 0.003 * t : (t < 200 ? 0.3 : Math.max(0.3 - 0.002 * (t - 200), -8));
    let ecart = 0, ampl = 0;
    for (let t = 0; t < N; t++) {
      const outs = gen.pas(...gen.entrees.map(() => signal(t)));
      r.sorties[t].forEach((v, k) => { ecart = Math.max(ecart, Math.abs(v - outs[k])); ampl = Math.max(ampl, Math.abs(v)); });
    }
    const ok = ampl > 1e-6 && ecart <= 1e-9 * Math.max(1, ampl);
    if (!ok) echecs++;
    console.log(`${ok ? "ok  " : "ECHEC"} ${titre} : ecart max ${ecart.toExponential(1)} (amplitude ${ampl.toExponential(1)})`);
  }
  await b.close();
  console.log(echecs ? `${echecs} ECHEC(S)` : "TOUT EST OK : le code gen~ exporte calcule exactement comme le studio");
  process.exit(echecs ? 1 : 0);
})();
