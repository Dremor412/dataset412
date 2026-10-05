"use strict";
/* demarrage (apres tous les modules) */
app.init();

/* auto-test : ouvrir avec #selftest dans l'URL */
if (location.hash === "#selftest") {
  setTimeout(() => {
    const r = [];
    for (const m of MODELES_PRETS) {
      const mdl = parse(m.script());
      const s = new Simulateur(compiler(mdl));
      s.frapper(Math.floor(s.n / 2), 0.3);
      if (s.entrees.length) s.pousser(0.3, 30);
      s.pas(3000);
      r.push(`${m.id}: ${mdl.erreurs.length} erreur(s), amplitude ${s.amplitude().toExponential(2)}`);
    }
    r.push("SELFTEST OK");
    window._selftest = r.join("\n");
    console.log(window._selftest);
  }, 500);
}
