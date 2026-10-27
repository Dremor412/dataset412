/* Mini traducteur genexpr -> JavaScript, pour TESTER sans Max le code gen~
 * exporte et les librairies (.genexpr). Couvre le sous-ensemble utilise par
 * mi-gen / migen-plus : fonctions, variables implicites, for / if / else,
 * peek / poke sur Data, retours multiples, arguments nommes, Param, History,
 * Data, Buffer. Ce n'est PAS un compilateur gen~ complet. */
"use strict";

class Data {
  constructor(dim, ch = 1) { this.dim = dim; this.ch = ch; this.v = new Float64Array(dim * ch); }
}

const BIBLIO = {
  peek(d, i, c = 0) {
    i = Math.trunc(i); c = Math.trunc(c);
    return (i < 0 || i >= d.dim || c < 0 || c >= d.ch) ? 0 : d.v[c * d.dim + i];
  },
  poke(d, x, i, c = 0) {
    i = Math.trunc(i); c = Math.trunc(c);
    if (!(i < 0 || i >= d.dim || c < 0 || c >= d.ch)) d.v[c * d.dim + i] = x;
  },
  channels: d => d.ch, dim: d => d.dim,
  clamp: (x, a, b) => Math.min(Math.max(x, a), b), clip: (x, a, b) => Math.min(Math.max(x, a), b),
  max: Math.max, min: Math.min, abs: Math.abs, floor: Math.floor, pow: Math.pow, sqrt: Math.sqrt,
  exp: Math.exp, cos: Math.cos, sin: Math.sin, tanh: Math.tanh, sign: Math.sign, SAMPLERATE: 44100,
};
const MOTS = new Set(["if", "else", "for", "while", "return", "function", "let", "var", "const", "true", "false"]);

/* fin du bloc { ... } qui commence a s[i] */
function finBloc(s, i) {
  let n = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "{") n++;
    else if (s[k] === "}" && --n === 0) return k;
  }
  throw new Error("accolade non fermee");
}

/* arguments d'un appel : decoupe aux virgules de premier niveau */
function decoupeArgs(s) {
  const r = []; let n = 0, cur = "";
  for (const c of s) {
    if (c === "(" || c === "[") n++;
    if (c === ")" || c === "]") n--;
    if (c === "," && n === 0) { r.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim()) r.push(cur);
  return r;
}

/* corps de fonction / de codebox -> JS (retours multiples, affectations multiples) */
function corpsJS(corps, exclus) {
  corps = corps.replace(/^(\s*)([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=(?!=)\s*/gm, "$1[$2] = ");
  corps = corps.replace(/return\s+([^;]*,[^;]*);/g, (m, e) => `return [${e}];`);
  const locaux = new Set();
  for (const m of corps.matchAll(/\[([A-Za-z_][\w\s,]*)\]\s*=(?!=)/g)) m[1].split(",").forEach(v => locaux.add(v.trim()));
  for (const m of corps.matchAll(/(^|[^\w.])([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|=(?!=))/g)) locaux.add(m[2]);
  for (const e of exclus) locaux.delete(e);
  for (const k of MOTS) locaux.delete(k);
  return (locaux.size ? `let ${[...locaux].join(", ")};\n` : "") + corps;
}

/* une librairie .genexpr -> { js, signatures } */
function traduireLib(src) {
  src = src.replace(/require\([^)]*\);/g, "");
  const signatures = {};
  let js = "", pos = 0;
  const re = /^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const debut = m.index + m[0].length - 1, fin = finBloc(src, debut);
    const params = m[2].split(",").map(p => p.trim()).filter(Boolean);
    const noms = params.map(p => p.split("=")[0].trim());
    signatures[m[1]] = noms;
    js += `function ${m[1]}(${params.join(", ")}) {\n${corpsJS(src.slice(debut + 1, fin), noms)}\n}\n`;
    re.lastIndex = fin + 1;
    pos = fin + 1;
  }
  return { js, signatures };
}

/* appels avec arguments nommes (Zo = ...) -> arguments positionnels */
function argumentsNommes(code, signatures) {
  let out = "", i = 0;
  const re = /(^|[^\w.])([A-Za-z_]\w*)\(/g;
  let m;
  while ((m = re.exec(code))) {
    const nom = m[2];
    if (!signatures[nom]) continue;
    const ouvre = m.index + m[0].length - 1;
    let n = 0, fin = ouvre;
    for (; fin < code.length; fin++) { if (code[fin] === "(") n++; if (code[fin] === ")" && --n === 0) break; }
    const args = decoupeArgs(code.slice(ouvre + 1, fin));
    if (!args.some(a => /^\s*[A-Za-z_]\w*\s*=(?!=)/.test(a))) continue;
    const pos = [];
    for (const a of args) {
      const nm = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
      if (nm) pos[signatures[nom].indexOf(nm[1])] = nm[2];
      else pos[pos.length] = a;
    }
    for (let k = 0; k < pos.length; k++) if (pos[k] === undefined) pos[k] = "undefined";
    out += code.slice(i, ouvre + 1) + pos.join(", ") + ")";
    i = fin + 1;
    re.lastIndex = fin + 1;
  }
  return out + code.slice(i);
}

/* codebox gen~ -> fonction par echantillon : (in1, in2, ...) -> [out1, out2, ...] */
function traduireCodebox(code, libs) {
  code = code.replace(/\\"/g, '"');
  let tete = "";
  const hisse = new Set(), corps = [];
  for (const ligne of code.split("\n")) {
    const l = ligne.trim();
    let m;
    if (/^require\(/.test(l)) continue;
    if ((m = /^Data\s+(\w+)\(([^)]*)\);/.exec(l))) { const a = m[2].split(","); tete += `const ${m[1]} = new Data(${a[0]}, ${a[1] || 1});\n`; hisse.add(m[1]); }
    else if ((m = /^Param\s+(\w+)\(([^)]*)\);/.exec(l))) { tete += `let ${m[1]} = ${m[2]};\n`; hisse.add(m[1]); }
    else if ((m = /^History\s+(\w+)\(([^)]*)\);/.exec(l))) { tete += `let ${m[1]} = ${m[2]};\n`; hisse.add(m[1]); }
    else if ((m = /^Buffer\s+(\w+);/.exec(l))) { tete += `const ${m[1]} = { poke() {} };\n`; hisse.add(m[1]); }
    else corps.push(ligne);
  }
  const signatures = {};
  let libJS = "";
  for (const src of libs) { const t = traduireLib(src); libJS += t.js; Object.assign(signatures, t.signatures); }
  let body = argumentsNommes(corps.join("\n"), signatures);
  const entrees = [...new Set([...body.matchAll(/\bin(\d+)\b/g)].map(m => +m[1]))].sort((a, b) => a - b);
  const sorties = [...new Set([...body.matchAll(/\bout(\d+)\s*=/g)].map(m => +m[1]))].sort((a, b) => a - b);
  const params = entrees.map(n => `in${n}`);
  body = corpsJS(body, [...hisse, ...params]);
  const src = `${libJS}\n${tete}\nreturn function (${params.join(", ")}) {\n${body}\nreturn [${sorties.map(n => `out${n}`).join(", ")}];\n};`;
  const fabrique = new Function("Data", ...Object.keys(BIBLIO), src);
  return { pas: fabrique(Data, ...Object.values(BIBLIO)), entrees, sorties, source: src };
}

module.exports = { Data, BIBLIO, traduireLib, traduireCodebox };
