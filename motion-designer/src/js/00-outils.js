/* Petits outils partages par tous les modules. */
"use strict";

const borne = (v, a, b) => Math.min(b, Math.max(a, v));
const dbVersGain = db => (db <= -60 ? 0 : Math.pow(10, db / 20));
const gainVersDb = g => (g <= 1e-6 ? -120 : 20 * Math.log10(g));
const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];
const copie = o => JSON.parse(JSON.stringify(o));
let compteurId = 1;
const nouvelId = () => "s" + Date.now().toString(36) + (compteurId++);

/* Creation DOM compacte : h("div.classe#id", {attr}, enfants...) */
function h(sel, attrs, ...enfants) {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const e = document.createElement(m[1] || "div");
  (m[2].match(/[.#][\w-]+/g) || []).forEach(t => {
    if (t[0] === ".") e.classList.add(t.slice(1)); else e.id = t.slice(1);
  });
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    enfants.unshift(attrs); attrs = null;
  }
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k in e && k !== "list" && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of enfants.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

/* Formatage des valeurs selon l'unite */
function formater(v, unite) {
  switch (unite) {
    case "Hz": return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + " kHz" : v.toFixed(v < 10 ? 2 : 0) + " Hz";
    case "dB": return (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
    case "%": return Math.round(v) + "%";
    case "ms": return v.toFixed(v < 10 ? 1 : 0) + " ms";
    case "s": return v.toFixed(2) + " s";
    case "st": return (v > 0 ? "+" : "") + v.toFixed(1) + " dt";
    case "Q": return v.toFixed(2) + " Q";
    case ":1": return v.toFixed(1) + ":1";
    case "×": return v.toFixed(2) + "×";
    default: return String(Math.round(v * 100) / 100);
  }
}

function formaterTemps(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return String(m).padStart(2, "0") + ":" + r.toFixed(3).padStart(6, "0");
}

/* Petit bus d'evenements */
const bus = {
  ecouteurs: {},
  on(nom, f) { (this.ecouteurs[nom] = this.ecouteurs[nom] || []).push(f); },
  emettre(nom, ...a) { (this.ecouteurs[nom] || []).forEach(f => f(...a)); },
};

function telecharger(nom, contenu, type) {
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: nom });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function notifier(texte, duree = 2600) {
  const n = h("div.toast", texte);
  $("#toasts").append(n);
  setTimeout(() => n.classList.add("parti"), duree);
  setTimeout(() => n.remove(), duree + 400);
}

const enBase64 = buf => {
  const o = new Uint8Array(buf); let s = "";
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
  return btoa(s);
};
const depuisBase64 = b => {
  const s = atob(b), o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return o.buffer;
};
