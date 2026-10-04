# -*- coding: utf-8 -*-
"""
forme2mims.py — Compilateur d'objets 3D vers scripts MIMS
pour l'outil web tool_MIMS_online.html (mi-creative).  v2 : vraie 3D.

Formes disponibles :
    python forme2mims.py boite     [--nx 6 --ny 6 --nz 6]
    python forme2mims.py pyramide  [--base 7 --etages 5]
    python forme2mims.py tour      [--etages 8 --secteurs 12]     (cylindre/cloche)
    python forme2mims.py sphere    [--meridiens 12 --paralleles 8]
    python forme2mims.py tore      [--nu 20 --nv 8]               (roue debout)
    python forme2mims.py obj CHEMIN.obj [--masses 400] [--ressorts 0]

Simplification des imports .obj :
    --masses N    nombre de masses vise : les sommets proches sont
                  regroupes (vertex clustering) jusqu'a approcher N.
                  0 = garder tous les sommets. Defaut : 400.
    --ressorts N  plafond d'interconnexions : garde les ressorts les
                  plus courts en priorite, en preservant toujours un
                  squelette connexe (l'objet reste d'un seul tenant).
                  0 = pas de limite. Defaut : 0.

Regles du moteur MIMS online :
 - l'axe z est l'axe de simulation : les [x y z] sont bien 3D et
   l'objet s'etend en hauteur, comme le cube officiel (z de 0 a 20) ;
 - les ressorts n'ont pas de longueur au repos, MAIS si l'espacement
   vertical est regulier les tensions s'annulent a l'interieur de la
   structure -> l'objet tient debout ;
 - l'objet doit toucher le sol : sa base est a z=0, ancree par des
   modules ground (les "pieds") ;
 - la bille posInput (jaune) demarre au-dessus de l'objet : on
   l'attrape a la souris et on la descend dessus pour le frapper.
"""

import argparse
import math
import os


# ----------------------------------------------------------------- noyau

class Modele:
    """Accumule masses / ressorts / io puis ecrit le script MIMS."""

    def __init__(self, nom, M=1.0, K=0.1, Z=0.0001, Zo=0.01):
        self.nom = nom
        self.M, self.K, self.Z, self.Zo = M, K, Z, Zo
        self.masses = []       # (id, x, y, z, grounded)
        self.ressorts = set()  # {(idA, idB)}
        self.sorties = []      # ids de masses ecoutees
        self.entree = None     # (x, y, z, id masse frappee)

    def masse(self, x, y, z, grounded=False):
        mid = len(self.masses)
        self.masses.append((mid, x, y, z, grounded))
        return mid

    def ressort(self, a, b):
        if a != b:
            self.ressorts.add((min(a, b), max(a, b)))

    def ecoute(self, mid):
        self.sorties.append(mid)

    def frappe(self, mid, hauteur_au_dessus=5.0):
        _, x, y, z, _ = self.masses[mid]
        self.entree = (x, y, z + hauteur_au_dessus, mid)

    def sommet_le_plus_haut(self):
        return max(self.masses, key=lambda m: m[3])[0]

    def script(self, note=""):
        n = self.nom
        L = [f"# MIMS script genere par forme2mims.py — objet 3D : {n}"]
        if note:
            L.append(f"# {note}")
        L.append("# L'objet touche le sol (base z=0, pieds ground).")
        L.append("# Attrape la bille jaune (posInput) et descends-la sur l'objet.")
        L.append("")
        L.append(f"@{n}_M param {self.M}")
        L.append(f"@{n}_K param {self.K}")
        L.append(f"@{n}_Z param {self.Z}")
        L.append(f"@{n}_Zo param {self.Zo}")
        L.append("")
        for mid, x, y, z, grounded in self.masses:
            if grounded:
                L.append(f"@{n}_m{mid} ground [{x:.2f} {y:.2f} {z:.2f}]")
            else:
                L.append(f"@{n}_m{mid} osc {n}_M 0 {n}_Zo [{x:.2f} {y:.2f} {z:.2f}] 0")
        L.append("")
        for i, (a, b) in enumerate(sorted(self.ressorts)):
            L.append(f"@{n}_r{i} springDamper @{n}_m{a} @{n}_m{b} {n}_K {n}_Z")
        L.append("")
        if self.entree:
            x, y, z, cible = self.entree
            L.append(f"@in1 posInput [{x:.2f} {y:.2f} {z:.2f}]")
            L.append(f"@{n}_exc contact @{n}_m{cible} @in1 0.1 0.001")
        for i, mid in enumerate(self.sorties):
            L.append(f"@out{i+1} posOutput @{n}_m{mid}")
        L.append("")
        L.append(f"# {len(self.masses)} masses, {len(self.ressorts)} interactions")
        L.append("# end of MIMS script")
        return "\n".join(L)


# ----------------------------------------------------------------- formes 3D

def forme_boite(nx=6, ny=6, nz=6, taille=14.0, hauteur=14.0):
    """Cube/boite gelatineuse posee au sol, coins de la base ancres."""
    m = Modele("boite")
    ids = {}
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                x = -taille / 2 + taille * i / (nx - 1)
                y = -taille / 2 + taille * j / (ny - 1)
                z = hauteur * k / (nz - 1)
                pied = k == 0 and i in (0, nx - 1) and j in (0, ny - 1)
                ids[(i, j, k)] = m.masse(x, y, z, grounded=pied)
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                if i + 1 < nx: m.ressort(ids[(i, j, k)], ids[(i + 1, j, k)])
                if j + 1 < ny: m.ressort(ids[(i, j, k)], ids[(i, j + 1, k)])
                if k + 1 < nz: m.ressort(ids[(i, j, k)], ids[(i, j, k + 1)])
    m.frappe(ids[(nx // 2, ny // 2, nz - 1)])       # frappe sur le dessus
    m.ecoute(ids[(nx // 2, 0, nz // 2)])
    m.ecoute(ids[(0, ny // 2, nz // 2)])
    return m, f"boite {nx}x{ny}x{nz}, base au sol, 4 pieds ground aux coins"


def forme_pyramide(base=7, etages=5, taille=16.0, hauteur=12.0):
    """Pyramide a etages carres retrecissants, base au sol."""
    m = Modele("pyramide")
    couches = []
    for k in range(etages):
        cote = base - k
        span = taille * cote / base
        z = hauteur * k / (etages - 1) if etages > 1 else 0.0
        couche = {}
        for i in range(cote):
            for j in range(cote):
                x = -span / 2 + (span * i / (cote - 1) if cote > 1 else 0.0)
                y = -span / 2 + (span * j / (cote - 1) if cote > 1 else 0.0)
                pied = k == 0 and (i in (0, cote - 1) and j in (0, cote - 1))
                couche[(i, j)] = m.masse(x, y, z, grounded=pied)
        couches.append((cote, couche))
    for k, (cote, couche) in enumerate(couches):
        for i in range(cote):
            for j in range(cote):
                if i + 1 < cote: m.ressort(couche[(i, j)], couche[(i + 1, j)])
                if j + 1 < cote: m.ressort(couche[(i, j)], couche[(i, j + 1)])
                if k + 1 < etages:
                    cote_h, couche_h = couches[k + 1]
                    ih = min(max(i - (cote - cote_h) // 2, 0), cote_h - 1)
                    jh = min(max(j - (cote - cote_h) // 2, 0), cote_h - 1)
                    # relie vers l'etage superieur (le plus proche)
                    if abs(i - ih - (cote - cote_h) // 2) <= 1 and abs(j - jh - (cote - cote_h) // 2) <= 1:
                        m.ressort(couche[(i, j)], couche_h[(ih, jh)])
    m.frappe(m.sommet_le_plus_haut())
    cote0, couche0 = couches[0]
    m.ecoute(couche0[(cote0 // 2, 0)])
    m.ecoute(couche0[(0, cote0 // 2)])
    return m, f"pyramide de {etages} etages sur base {base}x{base}"


def forme_tour(etages=8, secteurs=12, rayon=4.5, hauteur=16.0):
    """Cylindre vertical type cloche/tube, anneau de base entierement au sol."""
    m = Modele("tour")
    ids = {}
    for k in range(etages):
        z = hauteur * k / (etages - 1)
        for s in range(secteurs):
            a = 2 * math.pi * s / secteurs
            ids[(k, s)] = m.masse(rayon * math.cos(a), rayon * math.sin(a), z,
                                  grounded=(k == 0))
    for k in range(etages):
        for s in range(secteurs):
            m.ressort(ids[(k, s)], ids[(k, (s + 1) % secteurs)])       # anneau
            if k + 1 < etages:
                m.ressort(ids[(k, s)], ids[(k + 1, s)])                # vertical
                m.ressort(ids[(k, s)], ids[(k + 1, (s + 1) % secteurs)])  # diagonale
    m.frappe(ids[(etages - 1, 0)])
    m.ecoute(ids[(etages // 2, secteurs // 3)])
    m.ecoute(ids[(etages - 1, secteurs // 2)])
    return m, f"tour/cloche {etages} etages x {secteurs} secteurs, base scellee au sol"


def forme_sphere(meridiens=12, paralleles=9, rayon=7.0):
    """Sphere posee au sol (pole sud a z=0, ancre)."""
    m = Modele("sphere")
    sud = m.masse(0.0, 0.0, 0.0, grounded=True)
    nord = m.masse(0.0, 0.0, 2 * rayon)
    anneaux = []
    for p in range(1, paralleles + 1):
        theta = math.pi * p / (paralleles + 1)      # 0 = sud, pi = nord
        rr = rayon * math.sin(theta)
        z = rayon * (1 - math.cos(theta))
        anneau = [m.masse(rr * math.cos(2 * math.pi * s / meridiens),
                          rr * math.sin(2 * math.pi * s / meridiens), z)
                  for s in range(meridiens)]
        anneaux.append(anneau)
    for p, anneau in enumerate(anneaux):
        for s in range(meridiens):
            m.ressort(anneau[s], anneau[(s + 1) % meridiens])          # parallele
            if p + 1 < len(anneaux):
                m.ressort(anneau[s], anneaux[p + 1][s])                # meridien
        if p == 0:
            for s in range(meridiens):
                m.ressort(sud, anneau[s])
        if p == len(anneaux) - 1:
            for s in range(meridiens):
                m.ressort(nord, anneau[s])
    m.frappe(nord)
    m.ecoute(anneaux[len(anneaux) // 2][0])
    m.ecoute(anneaux[len(anneaux) // 2][meridiens // 2])
    return m, f"sphere {meridiens}x{paralleles}, pole sud ancre au sol"


def forme_tore(nu=20, nv=8, R=6.0, r=2.2):
    """Tore debout comme une roue, touchant le sol en un point (ancre)."""
    m = Modele("tore")
    ids = {}
    z_min = None
    for u in range(nu):
        au = 2 * math.pi * u / nu - math.pi / 2     # depart en bas
        for v in range(nv):
            av = 2 * math.pi * v / nv
            rr = R + r * math.cos(av)
            x = rr * math.cos(au)
            z = rr * math.sin(au) + R + r           # remonte : base a z=0
            y = r * math.sin(av)
            ids[(u, v)] = m.masse(x, y, z)
            if z_min is None or z < z_min:
                z_min = z
    # ancre les masses les plus basses (le point de contact avec le sol)
    for (u, v), mid in ids.items():
        if m.masses[mid][3] < z_min + 0.6:
            _, x, y, z, _ = m.masses[mid]
            m.masses[mid] = (mid, x, y, z, True)
    for u in range(nu):
        for v in range(nv):
            m.ressort(ids[(u, v)], ids[((u + 1) % nu, v)])
            m.ressort(ids[(u, v)], ids[(u, (v + 1) % nv)])
    haut = max(ids.values(), key=lambda mid: m.masses[mid][3])
    m.frappe(haut)
    m.ecoute(ids[(nu // 4, 0)])
    m.ecoute(ids[(3 * nu // 4, nv // 2)])
    return m, f"tore debout {nu}x{nv} (roue), point de contact ancre au sol"


# ----------------------------------------------------------------- instruments

def forme_cloche(anneaux=10, secteurs=16, r_bouche=7.0, r_couronne=2.8, H=14.0):
    """Cloche suspendue par sa couronne (ancree en haut), bouche libre
    juste au-dessus du sol. Profil evase, amortissement quasi nul."""
    m = Modele("cloche", M=1.0, K=0.1, Z=0.00005, Zo=0.002)
    ids = {}
    for k in range(anneaux):
        t = (anneaux - 1 - k) / (anneaux - 1)          # 1 = bouche, 0 = couronne
        r = r_couronne + (r_bouche - r_couronne) * (t ** 1.8)
        z = 0.5 + (H - 0.5) * k / (anneaux - 1)
        for s in range(secteurs):
            a = 2 * math.pi * s / secteurs
            ids[(k, s)] = m.masse(r * math.cos(a), r * math.sin(a), z,
                                  grounded=(k == anneaux - 1))
    for k in range(anneaux):
        for s in range(secteurs):
            m.ressort(ids[(k, s)], ids[(k, (s + 1) % secteurs)])
            if k + 1 < anneaux:
                m.ressort(ids[(k, s)], ids[(k + 1, s)])
                m.ressort(ids[(k, s)], ids[(k + 1, (s + 1) % secteurs)])
    m.frappe(ids[(1, 0)])                              # coup pres de la bouche
    m.ecoute(ids[(0, secteurs // 2)])
    m.ecoute(ids[(2, secteurs // 3)])
    return m, "cloche a profil evase, couronne fixee, bouche libre — laisse-la resonner"


def forme_grossecaisse(secteurs=20, R=8.0, H=5.0):
    """Grosse caisse : deux peaux circulaires couplees par un fut
    cylindrique. Masses lourdes + raideur faible = boum grave."""
    m = Modele("grossecaisse", M=2.0, K=0.06, Z=0.0002, Zo=0.01)
    fut = {}
    for k, z in enumerate((0.0, H / 2, H)):
        for s in range(secteurs):
            a = 2 * math.pi * s / secteurs
            fut[(k, s)] = m.masse(R * math.cos(a), R * math.sin(a), z,
                                  grounded=(k == 0))
    for k in range(3):
        for s in range(secteurs):
            m.ressort(fut[(k, s)], fut[(k, (s + 1) % secteurs)])
            if k + 1 < 3:
                m.ressort(fut[(k, s)], fut[(k + 1, s)])

    def peau(z, anneau_bord):
        centre = m.masse(0.0, 0.0, z)
        prec = [centre] * secteurs
        for a_i in range(1, 4):                        # 3 anneaux internes
            rr = R * a_i / 4
            cour = [m.masse(rr * math.cos(2 * math.pi * s / secteurs),
                            rr * math.sin(2 * math.pi * s / secteurs), z)
                    for s in range(secteurs)]
            for s in range(secteurs):
                m.ressort(cour[s], cour[(s + 1) % secteurs])
                m.ressort(prec[s if a_i > 1 else 0], cour[s])
            prec = cour
        for s in range(secteurs):                      # bord = fut
            m.ressort(prec[s], anneau_bord[s])
        return centre

    c_haut = peau(H, [fut[(2, s)] for s in range(secteurs)])
    c_bas = peau(0.0, [fut[(0, s)] for s in range(secteurs)])
    m.frappe(c_haut)                                   # frappe au centre
    m.ecoute(c_bas)
    m.ecoute(c_haut)
    return m, "grosse caisse : peau de frappe + peau de resonance couplees par le fut"


def forme_donutcoupe(nu=22, nv=8, nu_plein=28, R=6.5, r=2.2):
    """Donut pose a plat auquel il manque une part (~80 degres) :
    les deux extremites libres cassent la symetrie -> son 'twang'."""
    m = Modele("donutcoupe", M=1.0, K=0.1, Z=0.0001, Zo=0.004)
    ids = {}
    for u in range(nu):
        au = 2 * math.pi * u / nu_plein
        for v in range(nv):
            av = 2 * math.pi * v / nv
            rr = R + r * math.cos(av)
            z = r + r * math.sin(av)
            ids[(u, v)] = m.masse(rr * math.cos(au), rr * math.sin(au), z,
                                  grounded=(z < 0.15))
    for u in range(nu):
        for v in range(nv):
            m.ressort(ids[(u, v)], ids[(u, (v + 1) % nv)])
            if u + 1 < nu:                             # pas de rebouclage : coupe !
                m.ressort(ids[(u, v)], ids[(u + 1, v)])
    m.frappe(ids[(0, nv // 4)])                        # frappe une extremite libre
    m.ecoute(ids[(nu - 1, nv // 4)])
    m.ecoute(ids[(nu // 2, 0)])
    return m, "donut coupe : la part manquante libere deux bords vifs (mode splitting)"


# ------------------------------------------------- inventions mathematiques

def forme_colimacon(n=90, tours=3, R0=9.0, H=13.0):
    """Spirale logarithmique montante (escargot). Auto-similarite :
    chaque tour est une copie reduite du precedent -> cascade de
    resonances etagees, effet 'chirp' quand l'onde remonte la spire."""
    m = Modele("colimacon", M=0.8, K=0.12, Z=0.0001, Zo=0.003)
    par_tour = n // tours
    ids = []
    for i in range(n):
        t = i / (n - 1)
        r = R0 * math.exp(math.log(0.28) * t)          # rayon divise par ~3.6
        a = 2 * math.pi * tours * t
        ids.append(m.masse(r * math.cos(a), r * math.sin(a), H * t,
                           grounded=(i < 3)))
    for i in range(n - 1):
        m.ressort(ids[i], ids[i + 1])
    for i in range(n - par_tour):                      # couplage entre spires
        m.ressort(ids[i], ids[i + par_tour])
    m.frappe(ids[n - 1])                               # pichenette au sommet
    m.ecoute(ids[n // 2])
    m.ecoute(ids[par_tour])
    return m, "spirale logarithmique : auto-similarite -> cascade de resonances (chirp)"


def forme_fibonacci():
    """Orgue de Fibonacci : tuyaux de 3, 5, 8, 13, 21 masses sur un
    socle commun. Les rapports de longueurs tendent vers le nombre
    d'or, 'le plus irrationnel' des nombres -> partiels qui ne se
    synchronisent jamais, halo inharmonique sans battement stable."""
    m = Modele("fibonacci", M=1.0, K=0.1, Z=0.00008, Zo=0.002)
    nb = 25
    socle = [m.masse(-12 + 24 * i / (nb - 1), 0.0, 0.0,
                     grounded=(i in (0, nb - 1))) for i in range(nb)]
    for i in range(nb - 1):
        m.ressort(socle[i], socle[i + 1])
    tailles = [3, 8, 21, 13, 5]                        # le plus grand au centre
    tips = []
    for t_i, taille in enumerate(tailles):
        base_idx = round(t_i * (nb - 1) / 4)
        prec = socle[base_idx]
        x = -12 + 24 * base_idx / (nb - 1)
        for j in range(taille):
            nid = m.masse(x, 0.0, 0.9 * (j + 1))
            m.ressort(prec, nid)
            prec = nid
        tips.append(prec)
    m.frappe(socle[3])                                 # frappe le socle
    m.ecoute(tips[2])                                  # tuyau 21
    m.ecoute(tips[3])                                  # tuyau 13
    return m, "orgue de Fibonacci : rapports ~nombre d'or = inharmonicite maximale"


def forme_moebius(nu=36, R=7.0, d=1.3):
    """Ruban de Moebius : bande a un seul cote, refermee avec un
    demi-tour. Le recollement inverse (haut<->bas) impose des modes
    'a demi-periode' impossibles sur un anneau normal -> timbre
    legerement desaccorde, ondulant."""
    m = Modele("moebius", M=1.0, K=0.1, Z=0.0001, Zo=0.003)
    ids = {}
    for u_i in range(nu):
        u = 2 * math.pi * u_i / nu
        for w_i, w in enumerate((-d, 0.0, d)):
            rad = R + w * math.cos(u / 2)
            z = w * math.sin(u / 2) + d
            ids[(u_i, w_i)] = m.masse(rad * math.cos(u), rad * math.sin(u), z,
                                      grounded=(z < 0.25))
    for u_i in range(nu):
        for w_i in range(3):
            if w_i + 1 < 3:
                m.ressort(ids[(u_i, w_i)], ids[(u_i, w_i + 1)])
            if u_i + 1 < nu:
                m.ressort(ids[(u_i, w_i)], ids[(u_i + 1, w_i)])
            else:                                      # recollement inverse !
                m.ressort(ids[(u_i, w_i)], ids[(0, 2 - w_i)])
    haut = max(ids.values(), key=lambda mid: m.masses[mid][3])
    m.frappe(haut)
    m.ecoute(ids[(nu // 4, 1)])
    m.ecoute(ids[(3 * nu // 4, 1)])
    return m, "ruban de Moebius : recollement inverse = modes a demi-periode"


def forme_sablier(anneaux=9, secteurs=14, H=14.0, r_col=2.2, s=4.0):
    """Sablier / catenoide (surface minimale) : deux chambres larges
    reliees par un col etroit. Le col est un goulot de couplage :
    l'energie oscille lentement d'une chambre a l'autre -> battements
    amples, effet 'wah' naturel."""
    m = Modele("sablier", M=1.0, K=0.1, Z=0.00008, Zo=0.002)
    ids = {}
    for k in range(anneaux):
        z = H * k / (anneaux - 1)
        r = r_col * math.cosh((z - H / 2) / s)
        for sct in range(secteurs):
            a = 2 * math.pi * sct / secteurs
            ids[(k, sct)] = m.masse(r * math.cos(a), r * math.sin(a), z,
                                    grounded=(k == 0))
    for k in range(anneaux):
        for sct in range(secteurs):
            m.ressort(ids[(k, sct)], ids[(k, (sct + 1) % secteurs)])
            if k + 1 < anneaux:
                m.ressort(ids[(k, sct)], ids[(k + 1, sct)])
                m.ressort(ids[(k, sct)], ids[(k + 1, (sct + 1) % secteurs)])
    m.frappe(ids[(anneaux - 1, 0)])                    # frappe le bord haut
    m.ecoute(ids[(1, secteurs // 2)])                  # chambre basse
    m.ecoute(ids[(anneaux - 2, secteurs // 2)])        # chambre haute
    return m, "sablier/catenoide : col etroit = couplage faible -> battements lents"


def forme_arbre():
    """Arbre binaire auto-similaire : tronc, puis branches divisees
    par ~1.6 a chaque etage. Les longueurs en progression geometrique
    donnent des resonances quasi-octaves -> halo harmonique, comme un
    carillon accorde sur lui-meme."""
    m = Modele("arbre", M=0.9, K=0.11, Z=0.0001, Zo=0.0025)
    tips = []

    def branche(depart, x, y, z, dx, dy, dz, n, niveau):
        prec = depart
        for j in range(1, n + 1):
            nid = m.masse(x + dx * j, y + dy * j, z + dz * j)
            m.ressort(prec, nid)
            prec = nid
        if niveau == 0:
            tips.append(prec)
            return
        bx, by, bz = x + dx * n, y + dy * n, z + dz * n
        pas = dz * 0.78
        if niveau % 2 == 0:                            # alterne les plans x / y
            branche(prec, bx, by, bz, 0.8 * pas, 0, pas, max(2, int(n / 1.6)), niveau - 1)
            branche(prec, bx, by, bz, -0.8 * pas, 0, pas, max(2, int(n / 1.6)), niveau - 1)
        else:
            branche(prec, bx, by, bz, 0, 0.8 * pas, pas, max(2, int(n / 1.6)), niveau - 1)
            branche(prec, bx, by, bz, 0, -0.8 * pas, pas, max(2, int(n / 1.6)), niveau - 1)

    racine = m.masse(0.0, 0.0, 0.0, grounded=True)
    branche(racine, 0, 0, 0, 0, 0, 1.3, 7, 3)          # tronc de 7 puis 3 divisions
    sommet_tronc = 7                                    # derniere masse du tronc
    m.frappe(sommet_tronc)
    m.ecoute(tips[0])
    m.ecoute(tips[-1])
    return m, "arbre binaire auto-similaire : longueurs /1.6 -> resonances quasi-octaves"


# ----------------------------------------------------------------- import OBJ

def _simplifie_sommets(verts, edges, cible):
    """Regroupe les sommets proches par cellules (vertex clustering)
    pour approcher `cible` masses. Les positions sont moyennees et les
    aretes reportees entre groupes. Retourne (verts, edges, actif)."""
    if cible <= 0 or len(verts) <= cible:
        return verts, edges, False

    diag = max(
        max(v[i] for v in verts) - min(v[i] for v in verts) for i in range(3))
    diag = max(diag, 1e-9)

    def clusterise(h):
        groupes = {}
        for i, v in enumerate(verts):
            cle = (int(v[0] // h), int(v[1] // h), int(v[2] // h))
            groupes.setdefault(cle, []).append(i)
        return groupes

    # recherche dichotomique de la taille de cellule qui approche la cible
    lo, hi = diag / 300.0, diag
    meilleur = None
    for _ in range(40):
        h = (lo + hi) / 2
        groupes = clusterise(h)
        n = len(groupes)
        if meilleur is None or abs(n - cible) < abs(len(meilleur[1]) - cible):
            meilleur = (h, groupes)
        if n > cible:
            lo = h          # trop de groupes -> cellules plus grandes
        else:
            hi = h
    _, groupes = meilleur

    vmap = [0] * len(verts)
    nverts = []
    for ci, (_, idxs) in enumerate(sorted(groupes.items())):
        nverts.append([sum(verts[i][k] for i in idxs) / len(idxs) for k in range(3)])
        for i in idxs:
            vmap[i] = ci
    nedges = set()
    for a, b in edges:
        ca, cb = vmap[a], vmap[b]
        if ca != cb:
            nedges.add((min(ca, cb), max(ca, cb)))
    return nverts, nedges, True


def _limite_ressorts(verts, edges, plafond):
    """Reduit les interconnexions a `plafond` : construit d'abord un
    squelette connexe avec les aretes les plus courtes (arbre couvrant),
    puis complete avec les plus courtes restantes. Retourne (edges, actif)."""
    if plafond <= 0 or len(edges) <= plafond:
        return edges, False

    def d2(e):
        va, vb = verts[e[0]], verts[e[1]]
        return sum((va[k] - vb[k]) ** 2 for k in range(3))

    parent = list(range(len(verts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    squelette, restantes = [], []
    for e in sorted(edges, key=d2):
        ra, rb = find(e[0]), find(e[1])
        if ra != rb:
            parent[ra] = rb
            squelette.append(e)     # indispensable a la connexite
        else:
            restantes.append(e)
    for e in restantes:
        if len(squelette) >= plafond:
            break
        squelette.append(e)
    return set(squelette), True


def forme_obj(chemin, cible=16.0, max_masses=1000, masses=400, ressorts=0):
    """Convertit un maillage .obj : sommets->masses, aretes->ressorts,
    pose au sol (min z = 0), pieds ground sur les sommets les plus bas.
    `masses` et `ressorts` pilotent la simplification (0 = desactive)."""
    verts, edges = [], set()
    with open(chemin, encoding="utf-8", errors="ignore") as f:
        for ligne in f:
            p = ligne.split()
            if not p:
                continue
            if p[0] == "v":
                verts.append([float(c) for c in p[1:4]])
            elif p[0] == "f":
                idx = [int(t.split("/")[0]) - 1 for t in p[1:]]
                for k in range(len(idx)):
                    a, b = idx[k], idx[(k + 1) % len(idx)]
                    edges.add((min(a, b), max(a, b)))

    n_verts0, n_edges0 = len(verts), len(edges)
    verts, edges, simplifie = _simplifie_sommets(verts, edges, masses)

    if len(verts) > max_masses:
        raise SystemExit(
            f"{len(verts)} masses apres simplification : trop pour le navigateur "
            f"(max ~{max_masses}). Utilise --masses {max_masses} ou moins.")

    # Blender exporte en general Y vers le haut -> on prend l'axe vertical
    # comme celui de plus grande... non : on suppose l'axe Z du fichier =
    # vertical si son etendue est non nulle, sinon Y. Centre en x,y,
    # pose au sol en z, mis a l'echelle.
    ez = max(v[2] for v in verts) - min(v[2] for v in verts)
    ey = max(v[1] for v in verts) - min(v[1] for v in verts)
    if ey > ez:                      # axe vertical = Y (convention Blender)
        verts = [[v[0], v[2], v[1]] for v in verts]
    cx = sum(v[0] for v in verts) / len(verts)
    cy = sum(v[1] for v in verts) / len(verts)
    zmin = min(v[2] for v in verts)
    verts = [[v[0] - cx, v[1] - cy, v[2] - zmin] for v in verts]
    ampl = max(max(abs(v[0]), abs(v[1]), v[2]) for v in verts)
    k = cible / max(ampl, 1e-9)
    verts = [[v[0] * k, v[1] * k, v[2] * k] for v in verts]

    edges, limite = _limite_ressorts(verts, edges, ressorts)

    nom = os.path.splitext(os.path.basename(chemin))[0][:12] or "objet"
    nom = "".join(c if c.isalnum() else "_" for c in nom)
    m = Modele(nom)
    zmax = max(v[2] for v in verts)
    seuil_pied = 0.04 * zmax
    ids = [m.masse(v[0], v[1], v[2], grounded=(v[2] <= seuil_pied)) for v in verts]
    for a, b in sorted(edges):
        m.ressort(ids[a], ids[b])
    m.frappe(m.sommet_le_plus_haut())
    m.ecoute(ids[len(ids) // 3])
    m.ecoute(ids[2 * len(ids) // 3])
    n_pieds = sum(1 for mm in m.masses if mm[4])
    note = (f"importe de {os.path.basename(chemin)} : "
            f"{n_verts0} sommets / {n_edges0} aretes d'origine")
    if simplifie:
        note += f" -> simplifie a {len(verts)} masses"
    if limite:
        note += f", ressorts plafonnes a {len(edges)}"
    note += f", {n_pieds} pieds au sol"
    return m, note


# ----------------------------------------------------------------- CLI

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="forme", required=True)

    p = sub.add_parser("boite")
    p.add_argument("--nx", type=int, default=6); p.add_argument("--ny", type=int, default=6)
    p.add_argument("--nz", type=int, default=6)
    p = sub.add_parser("pyramide")
    p.add_argument("--base", type=int, default=7); p.add_argument("--etages", type=int, default=5)
    p = sub.add_parser("tour")
    p.add_argument("--etages", type=int, default=8); p.add_argument("--secteurs", type=int, default=12)
    p = sub.add_parser("sphere")
    p.add_argument("--meridiens", type=int, default=12); p.add_argument("--paralleles", type=int, default=9)
    p = sub.add_parser("tore")
    p.add_argument("--nu", type=int, default=20); p.add_argument("--nv", type=int, default=8)
    p = sub.add_parser("cloche")
    p.add_argument("--anneaux", type=int, default=10); p.add_argument("--secteurs", type=int, default=16)
    p = sub.add_parser("grossecaisse")
    p.add_argument("--secteurs", type=int, default=20)
    p = sub.add_parser("donutcoupe")
    p.add_argument("--nu", type=int, default=22); p.add_argument("--nv", type=int, default=8)
    p = sub.add_parser("colimacon")
    p.add_argument("--n", type=int, default=90)
    p = sub.add_parser("fibonacci")
    p = sub.add_parser("moebius")
    p.add_argument("--nu", type=int, default=36)
    p = sub.add_parser("sablier")
    p = sub.add_parser("arbre")
    p = sub.add_parser("obj")
    p.add_argument("chemin")
    p.add_argument("--masses", type=int, default=400,
                   help="nombre de masses vise apres simplification (0 = tout garder)")
    p.add_argument("--ressorts", type=int, default=0,
                   help="plafond d'interconnexions (0 = pas de limite)")

    for name, sp in sub.choices.items():
        sp.add_argument("--out", default=None)

    args = ap.parse_args()
    if args.forme == "boite":
        modele, note = forme_boite(args.nx, args.ny, args.nz)
    elif args.forme == "pyramide":
        modele, note = forme_pyramide(args.base, args.etages)
    elif args.forme == "tour":
        modele, note = forme_tour(args.etages, args.secteurs)
    elif args.forme == "sphere":
        modele, note = forme_sphere(args.meridiens, args.paralleles)
    elif args.forme == "tore":
        modele, note = forme_tore(args.nu, args.nv)
    elif args.forme == "cloche":
        modele, note = forme_cloche(args.anneaux, args.secteurs)
    elif args.forme == "grossecaisse":
        modele, note = forme_grossecaisse(args.secteurs)
    elif args.forme == "donutcoupe":
        modele, note = forme_donutcoupe(args.nu, args.nv)
    elif args.forme == "colimacon":
        modele, note = forme_colimacon(args.n)
    elif args.forme == "fibonacci":
        modele, note = forme_fibonacci()
    elif args.forme == "moebius":
        modele, note = forme_moebius(args.nu)
    elif args.forme == "sablier":
        modele, note = forme_sablier()
    elif args.forme == "arbre":
        modele, note = forme_arbre()
    else:
        modele, note = forme_obj(args.chemin, masses=args.masses,
                                 ressorts=args.ressorts)

    out = args.out or f"{modele.nom}.mdl"
    with open(out, "w", encoding="utf-8") as f:
        f.write(modele.script(note))
    print(f"OK : {out} — {len(modele.masses)} masses, {len(modele.ressorts)} interactions — {note}")
