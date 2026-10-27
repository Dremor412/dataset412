#!/usr/bin/env node
/* Assemble src/ en un seul fichier autonome : Motion_Designer.html
 * (aucune dependance : node build.js). */
"use strict";
const fs = require("fs");
const path = require("path");

const ici = __dirname;
const src = p => fs.readFileSync(path.join(ici, "src", p), "utf8");

const scripts = fs.readdirSync(path.join(ici, "src", "js"))
  .filter(f => f.endsWith(".js")).sort()
  .map(f => `/* ===== ${f} ===== */\n${src("js/" + f)}`).join("\n\n");

const html = src("index.html")
  .replace("/*@@STYLE@@*/", () => src("style.css"))
  .replace("//@@SCRIPTS@@", () => scripts);

const sortie = path.join(ici, "Motion_Designer.html");
fs.writeFileSync(sortie, html);
console.log(`ecrit ${path.relative(process.cwd(), sortie)} (${(html.length / 1024).toFixed(0)} Ko)`);
