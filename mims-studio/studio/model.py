# -*- coding: utf-8 -*-
"""Structures de donnees d'un modele MIMS (masses, interactions, entrees/sorties)."""

from dataclasses import dataclass, field


MASSES_FIXES = ("ground", "posInput")          # ne bougent pas dans la simulation

TYPES_MASSE = ("mass", "osc", "ground", "posInput")
TYPES_INTERACTION = ("spring", "damper", "springDamper", "contact", "nlContact",
                     "nlSpring2", "nlSpring3", "nlSpringDamper", "nlBow", "nlPluck")
TYPES_IO = ("posInput", "frcInput", "posOutput", "frcOutput")


@dataclass
class Masse:
    nom: str
    genre: str                   # mass / osc / ground / posInput
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    vel: float = 0.0
    args: tuple = ()             # mass: (M, grav) ; osc: (M, K, Z, grav)
    ligne: int = 0

    @property
    def fixe(self):
        return self.genre in MASSES_FIXES


@dataclass
class Interaction:
    nom: str
    genre: str
    m1: str
    m2: str
    args: tuple = ()
    ligne: int = 0


@dataclass
class Sortie:
    nom: str
    genre: str                   # posOutput / frcOutput
    cible: str
    ligne: int = 0


@dataclass
class Modele:
    masses: dict = field(default_factory=dict)          # nom -> Masse
    interactions: list = field(default_factory=list)
    sorties: list = field(default_factory=list)
    params: dict = field(default_factory=dict)
    erreurs: list = field(default_factory=list)         # [(ligne, message)]
    avertissements: list = field(default_factory=list)

    # ---- statistiques et geometrie ----

    def stats(self):
        fixes = sum(1 for m in self.masses.values() if m.fixe)
        return (f"{len(self.masses)} masses ({fixes} fixes) · "
                f"{len(self.interactions)} interactions · "
                f"{len(self.sorties)} sortie(s) · "
                f"{self.nb_composantes()} composante(s)")

    def bornes(self):
        if not self.masses:
            return (-10, 10, -10, 10, 0, 10)
        xs = [m.x for m in self.masses.values()]
        ys = [m.y for m in self.masses.values()]
        zs = [m.z for m in self.masses.values()]
        return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))

    def nb_composantes(self):
        noms = list(self.masses)
        if not noms:
            return 0
        idx = {n: i for i, n in enumerate(noms)}
        parent = list(range(len(noms)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for it in self.interactions:
            if it.m1 in idx and it.m2 in idx:
                ra, rb = find(idx[it.m1]), find(idx[it.m2])
                if ra != rb:
                    parent[ra] = rb
        return len({find(i) for i in range(len(noms))})
