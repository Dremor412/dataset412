# -*- coding: utf-8 -*-
"""Simulateur physique 1D par masse (portage du moteur mi-gen / MIMS online).

Chaque masse a un etat scalaire = sa hauteur z. Les [x y] ne servent qu'a
l'affichage. Schema saute-mouton.

Points de fixation : dans mi-gen les ressorts n'ont pas de longueur au repos
car l'etat est un deplacement autour de 0. Ici z sert aussi a dessiner la
forme : les liaisons de structure travaillent donc sur l'ecart a la position
de repos (et les osc oscillent autour de leur z de repos), sinon l'objet
s'effondre a la hauteur des points fixes. Les interactions "outil" (contact,
nlContact, nlPluck, nlBow) restent en hauteurs absolues (vraie collision).
"""

import math

import numpy as np


STRUCTURE = ("spring", "damper", "springDamper",
             "nlSpring2", "nlSpring3", "nlSpringDamper")


class Simulateur:
    def __init__(self, modele):
        self.noms = list(modele.masses)
        idx = {n: i for i, n in enumerate(self.noms)}
        n = len(self.noms)

        self.x = np.zeros(n)
        self.xr = np.zeros(n)
        self.f = np.zeros(n)
        self.mobile = np.zeros(n, dtype=bool)
        self.A = np.full(n, 2.0)
        self.B = np.full(n, -1.0)
        self.invM = np.ones(n)
        self.grav = np.zeros(n)
        self.z_init = np.zeros(n)

        for i, nom in enumerate(self.noms):
            m = modele.masses[nom]
            self.z_init[i] = m.z
            self.x[i] = m.z
            self.xr[i] = m.z - m.vel        # vitesse initiale
            if m.fixe:
                continue
            self.mobile[i] = True
            if m.genre == "mass":
                M = m.args[0] if m.args else 1.0
                g = m.args[1] if len(m.args) > 1 else 0.0
                self.invM[i] = 1.0 / max(M, 1e-9)
                self.grav[i] = g
            elif m.genre == "osc":
                M, K, Z = m.args[0], m.args[1], m.args[2]
                g = m.args[3] if len(m.args) > 3 else 0.0
                invM = 1.0 / max(M, 1e-9)
                self.invM[i] = invM
                self.A[i] = 2.0 - (K + Z) * invM
                self.B[i] = Z * invM - 1.0
                self.grav[i] = g

        # interactions groupees par genre, en tableaux d'indices
        self.lots = {}                       # genre -> (i1, i2, args ndarray)
        groupes = {}
        for it in modele.interactions:
            if it.m1 not in idx or it.m2 not in idx:
                continue
            groupes.setdefault(it.genre, []).append(
                (idx[it.m1], idx[it.m2], it.args))
        for genre, lst in groupes.items():
            i1 = np.array([a for a, _, _ in lst], dtype=int)
            i2 = np.array([b for _, b, _ in lst], dtype=int)
            nb_args = max(len(a) for _, _, a in lst)
            args = np.zeros((len(lst), max(nb_args, 1)))
            for k, (_, _, a) in enumerate(lst):
                for j, v in enumerate(a):
                    args[k, j] = v
            d0 = (self.z_init[i1] - self.z_init[i2]) if genre in STRUCTURE \
                else np.zeros(len(lst))
            self.lots[genre] = (i1, i2, args, d0)

    # ------------------------------------------------ etat

    def reset(self):
        self.x[:] = self.z_init
        self.xr[:] = self.z_init
        self.f[:] = 0.0

    def frapper(self, nom_ou_indice, force=0.3):
        """Impulsion de vitesse vers le bas sur une masse."""
        i = (self.noms.index(nom_ou_indice)
             if isinstance(nom_ou_indice, str) else nom_ou_indice)
        if self.mobile[i]:
            self.xr[i] += force                # vel = x - xr -> vers le bas
        else:
            # masse fixe : frappe la plus proche masse mobile connectee ? non :
            # on secoue tout doucement a la place
            self.xr[self.mobile] += force * 0.15

    def hauteurs(self):
        return dict(zip(self.noms, self.x))

    def amplitude(self):
        d = np.abs(self.x - self.z_init)[self.mobile]
        return float(np.max(d)) if len(d) else 0.0

    # ------------------------------------------------ pas de calcul

    def pas(self, n=1):
        for _ in range(n):
            self._un_pas()
        # garde-fou anti-explosion
        if not np.all(np.isfinite(self.x)) or np.max(np.abs(self.x - self.z_init)) > 1e5:
            self.reset()
            return False
        return True

    def _un_pas(self):
        x, xr, f = self.x, self.xr, self.f
        # 1) integration des masses autour de leur position de repos
        z0 = self.z_init
        xn = z0 + self.A * (x - z0) + self.B * (xr - z0) + (f - self.grav) * self.invM
        xr[self.mobile] = x[self.mobile]
        x[self.mobile] = xn[self.mobile]
        f[:] = 0.0
        # 2) les interactions accumulent les forces pour le pas suivant
        v = x - xr
        for genre, (i1, i2, a, d0) in self.lots.items():
            x1, x2 = x[i1], x[i2]
            v1, v2 = v[i1], v[i2]
            d, dv = x1 - x2 - d0, v1 - v2
            if genre == "spring":
                fv = a[:, 0] * d
            elif genre == "damper":
                fv = a[:, 0] * dv
            elif genre == "springDamper":
                fv = a[:, 0] * d + a[:, 1] * dv
            elif genre == "contact":
                seuil = a[:, 2] if a.shape[1] > 2 else 0.0
                fv = (a[:, 0] * (d + seuil) + a[:, 1] * dv) * (d > -seuil)
            elif genre == "nlContact":
                fv = self._nl3_clipped(d, dv, a, contact=True)
            elif genre == "nlSpringDamper":
                fv = self._nl3_clipped(d, dv, a, contact=False)
            elif genre == "nlSpring3":
                fv = a[:, 0] * d + a[:, 1] * d ** 3 + a[:, 2] * dv
            elif genre == "nlSpring2":
                fv = a[:, 0] * d + a[:, 1] * np.sign(d) * d ** 2 + a[:, 2] * dv
            elif genre == "nlPluck":
                fv = self._nl_pluck(d, dv, a)
            elif genre == "nlBow":
                fv = self._nl_bow(dv, a)
            else:
                continue
            np.add.at(f, i1, -fv)
            np.add.at(f, i2, fv)

    # ---- non-linearites (portees de migen-lib) ----

    @staticmethod
    def _nl3_clipped(d, dv, a, contact):
        s, c, k, Z = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
        seuil = a[:, 4] if a.shape[1] > 4 else np.zeros_like(s)
        dd = d + (seuil if contact else 0.0)
        with np.errstate(divide="ignore", invalid="ignore"):
            b = np.sqrt(np.maximum((k - s) / np.maximum(c, 1e-12), 0.0))
        lin = s * dd + c * dd ** 3
        borne = k * dd
        fv = np.where(c <= 0, s * dd,
                      np.where(s >= k, borne,
                               np.where(np.abs(dd) <= b, lin, borne)))
        fv = fv + Z * dv
        if contact:
            fv = fv * (d > -seuil)
        return fv

    @staticmethod
    def _nl_pluck(d, dv, a):
        nlK, scale = a[:, 0], np.maximum(a[:, 1], 1e-9)
        Z = a[:, 2] if a.shape[1] > 2 else np.zeros_like(nlK)
        sharp = 10.0
        tip = scale / sharp
        Kend = nlK / sharp
        ad = np.abs(d)
        f_centre = -(nlK - Kend) * d
        f_bord = np.where(d > 0, -tip * nlK + Kend * d + Z * dv,
                          tip * nlK + Kend * d + Z * dv)
        return np.where(ad < tip, f_centre, np.where(ad < scale, f_bord, 0.0))

    @staticmethod
    def _nl_bow(dv, a):
        nlZ, scale = a[:, 0], np.maximum(a[:, 1], 1e-9)
        smooth = a[:, 2] if a.shape[1] > 2 else np.zeros_like(nlZ)
        lisse = 0.63 * nlZ * dv * np.exp(-4 * (dv / scale) ** 2 + 0.5)
        sharp = 3.0
        tip = scale / sharp
        Zend = nlZ / sharp
        av = np.abs(dv)
        f1 = (nlZ - Zend) * dv
        f2 = np.where(dv > 0, tip * nlZ - Zend * dv, -tip * nlZ - Zend * dv)
        raide = np.where(av < tip, f1, np.where(av < scale, f2, 0.0))
        return np.where(smooth >= 1, lisse, raide)
