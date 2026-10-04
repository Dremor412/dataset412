# -*- coding: utf-8 -*-
"""Analyseur de scripts MIMS (dialecte 'online' : positions 3D explicites).

Bien plus bavard que le site : chaque probleme est remonte avec son numero
de ligne, et les problemes non bloquants sont des avertissements.
"""

import re

from .model import (Modele, Masse, Interaction, Sortie,
                    TYPES_MASSE, TYPES_INTERACTION)

RE_BRACKET = re.compile(r"\[([^\]]*)\]")


def _nombre(token, params, avert, ligne):
    """Convertit un token en nombre : litteral ou reference a un param."""
    try:
        return float(token)
    except ValueError:
        pass
    if token in params:
        return params[token]
    avert.append((ligne, f"parametre inconnu '{token}' (remplace par 0)"))
    return 0.0


def _position(brut, params, avert, ligne):
    """Position [x y z], [z] ou scalaire z -> (x, y, z)."""
    parts = brut.split()
    vals = [_nombre(t, params, avert, ligne) for t in parts]
    if len(vals) == 3:
        return vals[0], vals[1], vals[2]
    if len(vals) == 1:
        return 0.0, 0.0, vals[0]
    avert.append((ligne, f"position mal formee '[{brut}]' (attendu 1 ou 3 valeurs)"))
    return 0.0, 0.0, 0.0


def parse(texte):
    """Analyse un script MIMS complet. Retourne un Modele (avec erreurs dedans)."""
    mdl = Modele()
    err, avert = mdl.erreurs, mdl.avertissements

    # ---- passe 1 : les parametres (utilisables partout ensuite)
    for num, brute in enumerate(texte.splitlines(), 1):
        ligne = brute.split("#", 1)[0].strip()
        if not ligne or not ligne.startswith("@"):
            continue
        parts = ligne.split()
        if len(parts) >= 3 and parts[1] in ("param", "audioParam"):
            nom = parts[0][1:]
            try:
                mdl.params[nom] = float(parts[2])
            except ValueError:
                mdl.params[nom] = 0.0
                if parts[1] == "param":
                    avert.append((num, f"valeur de param invalide '{parts[2]}'"))

    # ---- passe 2 : masses, interactions, entrees / sorties
    for num, brute in enumerate(texte.splitlines(), 1):
        ligne = brute.split("#", 1)[0].strip()
        if not ligne or ligne.startswith("~"):
            continue
        if not ligne.startswith("@"):
            avert.append((num, f"ligne ignoree (ne commence pas par @) : '{ligne[:40]}'"))
            continue
        parts = ligne.split()
        if len(parts) < 2:
            err.append((num, "ligne incomplete"))
            continue
        nom, genre = parts[0][1:], parts[1]

        if genre in ("param", "audioParam"):
            continue

        # -------- masses (avec position) --------
        if genre in TYPES_MASSE or genre == "posInput":
            m = RE_BRACKET.search(ligne)
            if m:
                x, y, z = _position(m.group(1), mdl.params, avert, num)
                avant = ligne[:m.start()].split()[2:]          # args avant [pos]
                apres = ligne[m.end():].split()                # vel apres [pos]
            else:
                toks = parts[2:]
                if genre == "ground":
                    avant, apres = [], []
                    x = y = 0.0
                    z = _nombre(toks[0], mdl.params, avert, num) if toks else 0.0
                elif genre == "posInput":
                    avant, apres = [], []
                    x = y = 0.0
                    z = _nombre(toks[0], mdl.params, avert, num) if toks else 0.0
                else:
                    # dialecte scalaire : M [grav] pos vel
                    if len(toks) < 3:
                        err.append((num, f"pas assez d'arguments pour {genre}"))
                        continue
                    avant = toks[:-2]
                    x = y = 0.0
                    z = _nombre(toks[-2], mdl.params, avert, num)
                    apres = [toks[-1]]
            vel = _nombre(apres[0], mdl.params, avert, num) if apres else 0.0
            args = tuple(_nombre(t, mdl.params, avert, num) for t in avant)

            if genre == "mass" and not args:
                err.append((num, "mass : il faut au moins la masse M"))
                continue
            if genre == "osc" and len(args) < 3:
                err.append((num, "osc : il faut M K Z"))
                continue
            if nom in mdl.masses:
                err.append((num, f"nom duplique : @{nom}"))
                continue
            mdl.masses[nom] = Masse(nom, genre, x, y, z, vel, args, num)
            continue

        # -------- interactions --------
        if genre in TYPES_INTERACTION:
            refs = [t[1:] for t in parts[2:] if t.startswith("@")]
            autres = [t for t in parts[2:] if not t.startswith("@")]
            if "[" in ligne and "@" in ligne[ligne.find("["):]:
                err.append((num, "syntaxe macro '[@s pos]' non supportee ici : "
                                 "utilise des masses explicites (dialecte du site)"))
                continue
            if len(refs) != 2:
                err.append((num, f"{genre} : il faut exactement 2 masses (@a @b)"))
                continue
            args = tuple(_nombre(t, mdl.params, avert, num) for t in autres)
            mdl.interactions.append(Interaction(nom, genre, refs[0], refs[1], args, num))
            continue

        # -------- entrees / sorties --------
        if genre == "frcInput":
            refs = [t[1:] for t in parts[2:] if t.startswith("@")]
            if refs:
                avert.append((num, f"frcInput @{refs[0]} : force externe non simulee (ok)"))
            continue
        if genre in ("posOutput", "frcOutput"):
            refs = [t[1:] for t in parts[2:] if t.startswith("@")]
            if not refs:
                err.append((num, f"{genre} : il faut une masse cible (@m)"))
                continue
            mdl.sorties.append(Sortie(nom, genre, refs[0], num))
            continue

        err.append((num, f"type de module inconnu : '{genre}'"))

    # ---- passe 3 : verification des references
    for it in mdl.interactions:
        for ref in (it.m1, it.m2):
            if ref not in mdl.masses:
                mdl.erreurs.append((it.ligne, f"masse inconnue @{ref} dans {it.nom}"))
    for s in mdl.sorties:
        if s.cible not in mdl.masses:
            mdl.erreurs.append((s.ligne, f"masse inconnue @{s.cible} dans {s.nom}"))

    return mdl
