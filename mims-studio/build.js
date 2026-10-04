#!/usr/bin/env node
/* Assemble src/ en un seul fichier autonome : MIMS_Studio.html
 * (aucune dependance : node build.js). */
"use strict";
const fs = require("fs");
const path = require("path");

const ici = __dirname;
const src = p => fs.readFileSync(path.join(ici, "src", p), "utf8");

// Generateur officiel MIMS4Max : modules CommonJS enveloppes dans un mini
// chargeur. Script separe et non strict (le code d'origine en a besoin).
const VENDOR = ["utility", "phyDict", "modelState", "scriptParser", "codeBuilder", "gendspCreator"];
const vendor = `/* Generateur officiel MIMS4Max (mi-gen, James Leonard, GPL v3), non modifie. */
var MIMS4MAX = (function () {
  var modules = {}, cache = {};
  function require(nom) {
    nom = nom.replace(/^\\.\\//, "").replace(/\\.js$/, "");
    if (cache[nom]) return cache[nom].exports;
    var module = { exports: {} };
    cache[nom] = module;
    modules[nom](require, module, module.exports, globalThis);
    return module.exports;
  }
${VENDOR.map(n => `  modules[${JSON.stringify(n)}] = function (require, module, exports, global) {
${src(`vendor/mims4max/${n}.js`)}
  };`).join("\n")}
  return require;
})();`;

const scripts = fs.readdirSync(path.join(ici, "src", "js"))
  .filter(f => f.endsWith(".js")).sort()
  .map(f => `/* ===== ${f} ===== */\n${src("js/" + f)}`).join("\n\n");

const html = src("index.html")
  .replace("/*@@STYLE@@*/", () => src("style.css"))
  .replace("//@@VENDOR@@", () => vendor)
  .replace("//@@SCRIPTS@@", () => scripts);

const sortie = path.join(ici, "MIMS_Studio.html");
fs.writeFileSync(sortie, html);
console.log(`ecrit ${path.relative(process.cwd(), sortie)} (${(html.length / 1024).toFixed(0)} Ko)`);
