/* Compare, pour chaque exemple .mdl de mi-gen, le code gen~ de l'outil officiel
 * (MIMS4Max lance directement sur le fichier) et celui de l'export du studio.
 * Usage : node tests/exemples_officiels.js <dossier mi-gen>   (Playwright requis) */
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const racine = process.argv[2];
const fichiers = [];
(function parcours(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) parcours(p);
    else if (f.endsWith(".mdl")) fichiers.push(p);
  }
})(path.join(racine, "examples"));

// outil officiel, dans Node
const officiel = texte => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  const dir = path.join(__dirname, "..", "src", "vendor", "mims4max");
  const log = console.log; console.log = () => {};
  try {
    require(path.join(dir, "scriptParser.js")).parseMIMSFile(texte);
    global.mdl.sampleRateInvariant = 1;
    const cb = require(path.join(dir, "codeBuilder.js"));
    return new cb.GenCodeBuilder(global.mdl).compileToGenExpr()[0].replace(/\\"/g, '"');
  } catch (e) { return "ERREUR " + e; } finally { console.log = log; }
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const erreursPage = [];
  p.on("pageerror", e => erreursPage.push(e.message));
  await p.goto("file://" + path.join(__dirname, "..", "MIMS_Studio.html"));
  await p.waitForTimeout(500);
  const bilan = { identiques: 0, differents: 0, refusOfficiel: 0, refusStudio: 0 };
  for (const f of fichiers) {
    const texte = fs.readFileSync(f, "utf8");
    const ref = officiel(texte);
    const r = await p.evaluate(t => {
      const mdl = parse(t);
      if (mdl.erreurs.length) return { erreur: mdl.erreurs.map(e => `l${e[0]}: ${e[1]}`).join(" | ") };
      try {
        const desc = compiler(mdl);
        const sim = new Simulateur(desc); sim.pas(200);
        const conv = versMIMS4Max(mdl, desc, t);
        return { code: genererGen(conv.texte, true).code, avert: conv.avertissements };
      } catch (e) { return { erreur: "export : " + e.message }; }
    }, texte);
    const nom = path.relative(racine, f);
    if (ref.startsWith("ERREUR")) {
      bilan.refusOfficiel++;
      console.log(`[officiel refuse] ${nom} ${r.erreur ? "| studio refuse aussi" : "| studio accepte"}`);
    } else if (r.erreur) {
      bilan.refusStudio++; console.log(`[STUDIO REFUSE] ${nom} : ${r.erreur}`);
    } else if (r.code === ref) bilan.identiques++;
    else {
      bilan.differents++;
      const a = ref.split("\n"), c = r.code.split("\n");
      const k = a.findIndex((l, i) => l !== c[i]);
      console.log(`[DIFFERENT] ${nom} (ligne ${k}) officiel: ${a[k]} | studio: ${c[k]}  ${r.avert.join("; ")}`);
    }
  }
  console.log(JSON.stringify(bilan), "erreurs page:", erreursPage);
  await b.close();
  process.exit(bilan.differents || erreursPage.length ? 1 : 0);
})();
