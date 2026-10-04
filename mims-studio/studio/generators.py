# -*- coding: utf-8 -*-
"""Generateurs de formes 3D et import OBJ -> texte de script MIMS.

Reutilise le compilateur forme2mims (copie locale _source_formes.py) et
expose un catalogue declaratif pour construire l'interface du Studio.
"""

from . import _source_formes as F

# nom -> (fonction, description, {param: (label, defaut, min, max)})
CATALOGUE = {
    "boite": (lambda p: F.forme_boite(int(p["nx"]), int(p["ny"]), int(p["nz"])),
              "Cube gelatineux pose au sol",
              {"nx": ("largeur (billes)", 6, 2, 12),
               "ny": ("profondeur", 6, 2, 12),
               "nz": ("hauteur", 6, 2, 12)}),
    "pyramide": (lambda p: F.forme_pyramide(int(p["base"]), int(p["etages"])),
                 "Pyramide a etages carres",
                 {"base": ("cote de la base", 7, 3, 12),
                  "etages": ("etages", 5, 2, 8)}),
    "tour": (lambda p: F.forme_tour(int(p["etages"]), int(p["secteurs"])),
             "Cylindre / cloche simple, base scellee",
             {"etages": ("etages", 8, 3, 16),
              "secteurs": ("secteurs", 12, 6, 24)}),
    "sphere": (lambda p: F.forme_sphere(int(p["meridiens"]), int(p["paralleles"])),
               "Sphere posee au sol",
               {"meridiens": ("meridiens", 12, 6, 24),
                "paralleles": ("paralleles", 9, 4, 16)}),
    "tore": (lambda p: F.forme_tore(int(p["nu"]), int(p["nv"])),
             "Tore debout comme une roue",
             {"nu": ("grand cercle", 20, 8, 36),
              "nv": ("section", 8, 4, 12)}),
    "cloche": (lambda p: F.forme_cloche(int(p["anneaux"]), int(p["secteurs"])),
               "Cloche a profil evase, couronne fixee",
               {"anneaux": ("anneaux", 10, 4, 16),
                "secteurs": ("secteurs", 16, 8, 24)}),
    "grossecaisse": (lambda p: F.forme_grossecaisse(int(p["secteurs"])),
                     "Deux peaux couplees par un fut",
                     {"secteurs": ("secteurs", 20, 8, 28)}),
    "donutcoupe": (lambda p: F.forme_donutcoupe(int(p["nu"]), int(p["nv"])),
                   "Donut a plat auquel il manque une part",
                   {"nu": ("sections gardees", 22, 6, 40),
                    "nv": ("section", 8, 4, 12)}),
    "colimacon": (lambda p: F.forme_colimacon(int(p["n"])),
                  "Spirale logarithmique montante (chirp)",
                  {"n": ("nombre de billes", 90, 20, 200)}),
    "fibonacci": (lambda p: F.forme_fibonacci(),
                  "Orgue du nombre d'or (inharmonique)", {}),
    "moebius": (lambda p: F.forme_moebius(int(p["nu"])),
                "Ruban de Moebius (modes a demi-periode)",
                {"nu": ("sections", 36, 12, 60)}),
    "sablier": (lambda p: F.forme_sablier(),
                "Catenoide : deux chambres couplees (battements)", {}),
    "arbre": (lambda p: F.forme_arbre(),
              "Arbre binaire auto-similaire (quasi-octaves)", {}),
}


def genere(nom, params):
    """Retourne (texte_mdl, note) pour la forme demandee."""
    fabrique, _, _ = CATALOGUE[nom]
    modele, note = fabrique(params)
    return modele.script(note), note


def importe_obj(chemin, masses=400, ressorts=0):
    """Convertit un fichier .obj en texte MIMS (avec simplification)."""
    modele, note = F.forme_obj(chemin, masses=masses, ressorts=ressorts)
    return modele.script(note), note
