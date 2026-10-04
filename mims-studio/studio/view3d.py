# -*- coding: utf-8 -*-
"""Vue 3D rudimentaire sur Canvas tkinter : orbite, zoom, panoramique.

Conventions : x, y = plan du sol ; z = hauteur (axe de vibration).
Souris : glisser gauche = orbiter, molette = zoom, glisser droit = deplacer,
double-clic = recadrer, clic simple = selectionner la masse la plus proche.
"""

import math
import tkinter as tk

COULEURS = {
    "fond": "#14171c",
    "grille": "#2a3038",
    "axe_x": "#7a4040", "axe_y": "#40603f",
    "mass": "#5aa9e6", "osc": "#5aa9e6",
    "ground": "#e05555", "posInput": "#f4d03f",
    "sortie": "#58d68d", "selection": "#ffffff",
    "spring": "#5f6f80", "damper": "#4a5560", "springDamper": "#7d8fa3",
    "contact": "#e08b3d", "nlContact": "#e08b3d",
    "nlPluck": "#58d68d", "nlBow": "#b07cc6",
    "nlSpring2": "#4fb3a9", "nlSpring3": "#4fb3a9", "nlSpringDamper": "#4fb3a9",
}
POINTILLES = {"contact": (4, 3), "nlContact": (4, 3), "nlPluck": (2, 3),
              "nlBow": (6, 3), "damper": (1, 3)}


class Vue3D(tk.Canvas):
    def __init__(self, parent, sur_selection=None, **kw):
        kw.setdefault("bg", COULEURS["fond"])
        kw.setdefault("highlightthickness", 0)
        super().__init__(parent, **kw)
        self.sur_selection = sur_selection      # callback(nom_masse | None)

        self.yaw = math.radians(35)
        self.pitch = math.radians(28)
        self.zoom = 14.0
        self.panx, self.pany = 0.0, 0.0
        self.cible = [0.0, 0.0, 5.0]
        self.persp = 60.0

        self.modele = None
        self.noms = []                          # ordre stable des masses
        self.pos = {}                           # nom -> (x, y, z) affiches
        self.selection = None
        self._sorties = set()
        self._drag = None

        self.bind("<ButtonPress-1>", self._press1)
        self.bind("<B1-Motion>", self._orbite)
        self.bind("<ButtonRelease-1>", self._release1)
        self.bind("<ButtonPress-3>", lambda e: self._set_drag(e, "pan"))
        self.bind("<B3-Motion>", self._pan)
        # macOS : clic droit = Button-2, molette a petits increments
        self.bind("<ButtonPress-2>", lambda e: self._set_drag(e, "pan"))
        self.bind("<B2-Motion>", self._pan)
        self.bind("<MouseWheel>", self._molette)
        # Linux : molette = Button-4/5
        self.bind("<Button-4>", lambda e: self._zoom_pas(1))
        self.bind("<Button-5>", lambda e: self._zoom_pas(-1))
        self.bind("<Double-Button-1>", lambda e: self.recadrer())
        self.bind("<Configure>", lambda e: self.redessiner())

    # ------------------------------------------------ modele

    def charger(self, modele):
        self.modele = modele
        self.noms = list(modele.masses) if modele else []
        self.pos = {n: (m.x, m.y, m.z) for n, m in modele.masses.items()} if modele else {}
        self._sorties = {s.cible for s in modele.sorties} if modele else set()
        if self.selection not in self.pos:
            self.selection = None
        self.recadrer()

    def positions_dynamiques(self, zdict):
        """Met a jour la hauteur affichee des masses (simulation)."""
        for n, z in zdict.items():
            if n in self.pos:
                x, y, _ = self.pos[n]
                self.pos[n] = (x, y, z)
        self.redessiner()

    def recadrer(self):
        if not self.modele or not self.modele.masses:
            self.redessiner()
            return
        x0, x1, y0, y1, z0, z1 = self.modele.bornes()
        self.cible = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
        etendue = max(x1 - x0, y1 - y0, z1 - z0, 4.0)
        w = max(self.winfo_width(), 300)
        h = max(self.winfo_height(), 300)
        self.zoom = 0.75 * min(w, h) / etendue
        self.panx = self.pany = 0.0
        self.redessiner()

    # ------------------------------------------------ projection

    def _projette(self, x, y, z):
        ca, sa = math.cos(self.yaw), math.sin(self.yaw)
        cb, sb = math.cos(self.pitch), math.sin(self.pitch)
        dx, dy, dz = x - self.cible[0], y - self.cible[1], z - self.cible[2]
        X = dx * ca + dy * sa
        Y = -dx * sa + dy * ca
        Z2 = -Y * sb + dz * cb          # vertical ecran
        prof = Y * cb + dz * sb         # profondeur
        s = self.persp / max(self.persp + prof * 0.04, 0.2)
        w, h = self.winfo_width(), self.winfo_height()
        return (w / 2 + self.zoom * s * X + self.panx,
                h / 2 - self.zoom * s * Z2 + self.pany,
                prof, s)

    # ------------------------------------------------ dessin

    def redessiner(self):
        self.delete("all")
        self._grille()
        if not self.modele:
            return
        # interactions
        for it in self.modele.interactions:
            if it.m1 not in self.pos or it.m2 not in self.pos:
                continue
            x1, y1, _, _ = self._projette(*self.pos[it.m1])
            x2, y2, _, _ = self._projette(*self.pos[it.m2])
            coul = COULEURS.get(it.genre, "#666666")
            kw = {"fill": coul, "width": 1}
            if it.genre in POINTILLES:
                kw["dash"] = POINTILLES[it.genre]
            self.create_line(x1, y1, x2, y2, **kw)
        # masses (triees par profondeur : lointaines d'abord)
        projetees = []
        for n in self.noms:
            px, py, prof, s = self._projette(*self.pos[n])
            projetees.append((prof, n, px, py, s))
        projetees.sort(reverse=True)
        for prof, n, px, py, s in projetees:
            m = self.modele.masses[n]
            r = max(2.0, (5.5 if m.genre == "posInput" else 3.6) * s)
            coul = COULEURS.get(m.genre, "#aaaaaa")
            if m.genre == "ground":
                self.create_rectangle(px - r, py - r, px + r, py + r,
                                      fill=coul, outline="")
            else:
                self.create_oval(px - r, py - r, px + r, py + r,
                                 fill=coul, outline="")
            if n in self._sorties:
                self.create_oval(px - r - 3, py - r - 3, px + r + 3, py + r + 3,
                                 outline=COULEURS["sortie"], width=2)
            if n == self.selection:
                self.create_oval(px - r - 4, py - r - 4, px + r + 4, py + r + 4,
                                 outline=COULEURS["selection"], width=1)

    def _grille(self):
        L, pas = 20, 5
        for i in range(-L, L + 1, pas):
            for (a, b) in (((i, -L, 0), (i, L, 0)), ((-L, i, 0), (L, i, 0))):
                x1, y1, _, _ = self._projette(*a)
                x2, y2, _, _ = self._projette(*b)
                self.create_line(x1, y1, x2, y2, fill=COULEURS["grille"])
        for axe, coul in ((( L, 0, 0), COULEURS["axe_x"]), ((0, L, 0), COULEURS["axe_y"])):
            x1, y1, _, _ = self._projette(0, 0, 0)
            x2, y2, _, _ = self._projette(*axe)
            self.create_line(x1, y1, x2, y2, fill=coul, width=2)

    # ------------------------------------------------ souris

    def _press1(self, e):
        self._drag = ("maybe", e.x, e.y)

    def _orbite(self, e):
        if self._drag is None:
            return
        mode, x0, y0 = self._drag
        if mode == "maybe" and abs(e.x - x0) + abs(e.y - y0) < 4:
            return
        self.yaw += (e.x - x0) * 0.008
        self.pitch = min(max(self.pitch + (e.y - y0) * 0.008, -1.4), 1.5)
        self._drag = ("orbit", e.x, e.y)
        self.redessiner()

    def _release1(self, e):
        if self._drag and self._drag[0] == "maybe":
            self._selectionne(e.x, e.y)
        self._drag = None

    def _selectionne(self, ex, ey):
        meilleur, dmin = None, 12.0
        for n in self.noms:
            px, py, _, _ = self._projette(*self.pos[n])
            d = math.hypot(px - ex, py - ey)
            if d < dmin:
                meilleur, dmin = n, d
        self.selection = meilleur
        if self.sur_selection:
            self.sur_selection(meilleur)
        self.redessiner()

    def _set_drag(self, e, mode):
        self._drag = (mode, e.x, e.y)

    def _pan(self, e):
        if self._drag is None:
            return
        _, x0, y0 = self._drag
        self.panx += e.x - x0
        self.pany += e.y - y0
        self._drag = ("pan", e.x, e.y)
        self.redessiner()

    def _molette(self, e):
        # Windows : delta multiple de 120 ; macOS : petits entiers (+-1...)
        pas = e.delta / 120 if abs(e.delta) >= 120 else e.delta
        self._zoom_pas(pas)

    def _zoom_pas(self, pas):
        self.zoom *= 1.1 ** pas
        self.zoom = min(max(self.zoom, 0.5), 400)
        self.redessiner()
