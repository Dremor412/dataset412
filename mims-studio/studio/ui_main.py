# -*- coding: utf-8 -*-
"""MIMS Studio — fenetre principale.

Editeur de scripts MIMS + vue 3D + generateur de formes + import OBJ
+ simulation physique animee. Concu pour remplacer l'outil web MIMS online.
"""

import os
import re
import sys
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from . import __version__
from .parser_mdl import parse
from .view3d import Vue3D
from .simulator import Simulateur
from . import generators

EXEMPLE_DEPART = """# Bienvenue dans MIMS Studio !
# Colle ici un script MIMS, ouvre un .mdl, ou menu Generer.
# Clic gauche = orbiter, molette = zoom, clic droit = deplacer,
# clic simple sur une bille = la selectionner, puis bouton Frapper.

@demo_M param 1.0
@demo_K param 0.1
@demo_Z param 0.0001
@demo_Zo param 0.01

@demo_m0 ground [-6.00 0.00 0.00]
@demo_m1 osc demo_M 0 demo_Zo [-4.00 0.00 0.00] 0
@demo_m2 osc demo_M 0 demo_Zo [-2.00 0.00 0.00] 0
@demo_m3 osc demo_M 0 demo_Zo [0.00 0.00 0.00] 0
@demo_m4 osc demo_M 0 demo_Zo [2.00 0.00 0.00] 0
@demo_m5 osc demo_M 0 demo_Zo [4.00 0.00 0.00] 0
@demo_m6 ground [6.00 0.00 0.00]

@demo_r0 springDamper @demo_m0 @demo_m1 demo_K demo_Z
@demo_r1 springDamper @demo_m1 @demo_m2 demo_K demo_Z
@demo_r2 springDamper @demo_m2 @demo_m3 demo_K demo_Z
@demo_r3 springDamper @demo_m3 @demo_m4 demo_K demo_Z
@demo_r4 springDamper @demo_m4 @demo_m5 demo_K demo_Z
@demo_r5 springDamper @demo_m5 @demo_m6 demo_K demo_Z

@out1 posOutput @demo_m3
"""

DOSSIER_FORMES = os.path.join(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))), "mims-formes-3d")


class Studio(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"MIMS Studio {__version__}")
        self.geometry("1280x760")
        self.fichier = None
        self.sim = None
        self.sim_active = False
        self._auto_id = None

        self._construit_menu()
        self._construit_ui()
        self.editeur.insert("1.0", EXEMPLE_DEPART)
        self.compiler()

        self.bind("<F5>", lambda e: self.compiler())
        self.bind("<Control-s>", lambda e: self.enregistrer())
        self.bind("<Control-o>", lambda e: self.ouvrir())
        self.protocol("WM_DELETE_WINDOW", self._quitter)

    # ================================================== construction UI

    def _construit_menu(self):
        barre = tk.Menu(self)
        mf = tk.Menu(barre, tearoff=0)
        mf.add_command(label="Nouveau", command=self.nouveau)
        mf.add_command(label="Ouvrir un .mdl...  (Ctrl+O)", command=self.ouvrir)
        mf.add_command(label="Enregistrer  (Ctrl+S)", command=self.enregistrer)
        mf.add_command(label="Enregistrer sous...", command=self.enregistrer_sous)
        mf.add_separator()
        mf.add_command(label="Quitter", command=self._quitter)
        barre.add_cascade(label="Fichier", menu=mf)

        mg = tk.Menu(barre, tearoff=0)
        for nom in generators.CATALOGUE:
            desc = generators.CATALOGUE[nom][1]
            mg.add_command(label=f"{nom} — {desc}",
                           command=lambda n=nom: self.dialogue_forme(n))
        barre.add_cascade(label="Générer", menu=mg)

        mi = tk.Menu(barre, tearoff=0)
        mi.add_command(label="Importer un modèle 3D (.obj)...",
                       command=self.dialogue_obj)
        barre.add_cascade(label="Importer", menu=mi)

        me = tk.Menu(barre, tearoff=0)
        if os.path.isdir(DOSSIER_FORMES):
            for f in sorted(os.listdir(DOSSIER_FORMES)):
                if f.endswith(".mdl"):
                    chemin = os.path.join(DOSSIER_FORMES, f)
                    me.add_command(label=f,
                                   command=lambda c=chemin: self.charge_fichier(c))
        barre.add_cascade(label="Exemples", menu=me)

        ma = tk.Menu(barre, tearoff=0)
        ma.add_command(label="Raccourcis et aide", command=self._aide)
        barre.add_cascade(label="Aide", menu=ma)
        self.config(menu=barre)

    def _construit_ui(self):
        pane = ttk.PanedWindow(self, orient="horizontal")
        pane.pack(fill="both", expand=True)

        # ---- colonne gauche : editeur + erreurs
        gauche = ttk.Frame(pane)
        pane.add(gauche, weight=2)

        outils = ttk.Frame(gauche)
        outils.pack(fill="x", padx=4, pady=3)
        ttk.Button(outils, text="▶ Compiler (F5)",
                   command=self.compiler).pack(side="left")
        self.var_auto = tk.BooleanVar(value=True)
        ttk.Checkbutton(outils, text="Auto", variable=self.var_auto
                        ).pack(side="left", padx=6)
        ttk.Button(outils, text="Recadrer la vue",
                   command=lambda: self.vue.recadrer()).pack(side="left", padx=6)

        self.editeur = tk.Text(gauche, wrap="none", undo=True, font=("Consolas", 10),
                               bg="#1d2127", fg="#d8dee9", insertbackground="#d8dee9")
        self.editeur.pack(fill="both", expand=True, padx=4)
        self.editeur.bind("<KeyRelease>", self._touche)

        ttk.Label(gauche, text="Problèmes (double-clic = aller à la ligne) :"
                  ).pack(anchor="w", padx=4)
        self.console = tk.Listbox(gauche, height=6, bg="#16191e", fg="#e0b0b0",
                                  font=("Consolas", 9))
        self.console.pack(fill="x", padx=4, pady=(0, 4))
        self.console.bind("<Double-Button-1>", self._va_ligne)

        # ---- colonne droite : vue 3D + simulation + statut
        droite = ttk.Frame(pane)
        pane.add(droite, weight=3)

        self.vue = Vue3D(droite, sur_selection=self._selectionne)
        self.vue.pack(fill="both", expand=True)

        simbar = ttk.Frame(droite)
        simbar.pack(fill="x", padx=4, pady=3)
        self.btn_sim = ttk.Button(simbar, text="⏵ Simuler", command=self.bascule_sim)
        self.btn_sim.pack(side="left")
        ttk.Button(simbar, text="⚡ Frapper", command=self.frapper).pack(side="left", padx=4)
        ttk.Button(simbar, text="⟲ Reset", command=self.reset_sim).pack(side="left")
        ttk.Label(simbar, text="  vitesse").pack(side="left")
        self.var_vitesse = tk.IntVar(value=300)
        ttk.Scale(simbar, from_=30, to=1200, variable=self.var_vitesse,
                  length=140).pack(side="left", padx=2)
        ttk.Label(simbar, text="  amplification").pack(side="left")
        self.var_ampli = tk.DoubleVar(value=3.0)
        ttk.Scale(simbar, from_=1.0, to=12.0, variable=self.var_ampli,
                  length=110).pack(side="left", padx=2)

        self.statut = ttk.Label(droite, text="pret", anchor="w")
        self.statut.pack(fill="x", padx=6, pady=(0, 3))

    # ================================================== compilation

    def _touche(self, _e):
        if not self.var_auto.get():
            return
        if self._auto_id:
            self.after_cancel(self._auto_id)
        self._auto_id = self.after(500, self.compiler)

    def compiler(self):
        self._stop_sim()
        texte = self.editeur.get("1.0", "end")
        modele = parse(texte)
        self.modele = modele
        self.vue.charger(modele)
        self.console.delete(0, "end")
        for lig, msg in modele.erreurs:
            self.console.insert("end", f"ERREUR  ligne {lig} : {msg}")
            self.console.itemconfig("end", fg="#ff7b7b")
        for lig, msg in modele.avertissements:
            self.console.insert("end", f"note    ligne {lig} : {msg}")
            self.console.itemconfig("end", fg="#c9b458")
        etat = "ERREURS — corrige puis F5" if modele.erreurs else "OK"
        self.statut.config(text=f"[{etat}]  {modele.stats()}")

    def _va_ligne(self, _e):
        sel = self.console.curselection()
        if not sel:
            return
        m = re.search(r"ligne (\d+)", self.console.get(sel[0]))
        if m:
            self.editeur.mark_set("insert", f"{m.group(1)}.0")
            self.editeur.see("insert")
            self.editeur.focus_set()

    def _selectionne(self, nom):
        if nom and self.modele and nom in self.modele.masses:
            ms = self.modele.masses[nom]
            self.statut.config(text=f"selection : @{nom}  ({ms.genre})  "
                                    f"pos [{ms.x:.2f} {ms.y:.2f} {ms.z:.2f}]")
        else:
            self.statut.config(text=self.modele.stats() if self.modele else "pret")

    # ================================================== simulation

    def bascule_sim(self):
        if self.sim_active:
            self._stop_sim()
            return
        if not self.modele or self.modele.erreurs or not self.modele.masses:
            self.statut.config(text="corrige les erreurs avant de simuler")
            return
        if self.sim is None:
            self.sim = Simulateur(self.modele)
        self.sim_active = True
        self.btn_sim.config(text="⏸ Pause")
        self._tick()

    def _stop_sim(self):
        self.sim_active = False
        self.sim = None
        try:
            self.btn_sim.config(text="⏵ Simuler")
        except tk.TclError:
            pass

    def reset_sim(self):
        if self.sim:
            self.sim.reset()
            self._affiche_sim()

    def frapper(self):
        if not self.sim_active:
            self.bascule_sim()
        if not self.sim:
            return
        nom = self.vue.selection
        if nom is None or (nom in self.modele.masses
                           and self.modele.masses[nom].fixe):
            mobiles = [n for n in self.sim.noms
                       if self.sim.mobile[self.sim.noms.index(n)]]
            if not mobiles:
                return
            nom = max(mobiles, key=lambda n: self.modele.masses[n].z)
        self.sim.frapper(nom)

    def _tick(self):
        if not self.sim_active or self.sim is None:
            return
        ok = self.sim.pas(int(self.var_vitesse.get()))
        if not ok:
            self.statut.config(text="EXPLOSION numerique -> reset (baisse K ou monte Z)")
        self._affiche_sim()
        self.after(25, self._tick)

    def _affiche_sim(self):
        amp = self.var_ampli.get()
        zi = self.sim.z_init
        zs = zi + (self.sim.x - zi) * amp
        self.vue.positions_dynamiques(dict(zip(self.sim.noms, zs)))

    # ================================================== fichiers

    def nouveau(self):
        self._stop_sim()
        self.editeur.delete("1.0", "end")
        self.editeur.insert("1.0", "# Nouveau modele MIMS\n\n")
        self.fichier = None
        self.title(f"MIMS Studio {__version__}")
        self.compiler()

    def ouvrir(self):
        chemin = filedialog.askopenfilename(
            filetypes=[("Scripts MIMS", "*.mdl"), ("Tous", "*.*")])
        if chemin:
            self.charge_fichier(chemin)

    def charge_fichier(self, chemin):
        with open(chemin, encoding="utf-8", errors="replace") as f:
            contenu = f.read()
        self._stop_sim()
        self.editeur.delete("1.0", "end")
        self.editeur.insert("1.0", contenu)
        self.fichier = chemin
        self.title(f"MIMS Studio {__version__} — {os.path.basename(chemin)}")
        self.compiler()
        self.vue.recadrer()

    def enregistrer(self):
        if not self.fichier:
            return self.enregistrer_sous()
        with open(self.fichier, "w", encoding="utf-8") as f:
            f.write(self.editeur.get("1.0", "end-1c"))
        self.statut.config(text=f"enregistre : {self.fichier}")

    def enregistrer_sous(self):
        chemin = filedialog.asksaveasfilename(
            defaultextension=".mdl", filetypes=[("Scripts MIMS", "*.mdl")])
        if chemin:
            self.fichier = chemin
            self.title(f"MIMS Studio {__version__} — {os.path.basename(chemin)}")
            self.enregistrer()

    def _quitter(self):
        self._stop_sim()
        self.destroy()

    # ================================================== dialogues

    def dialogue_forme(self, nom):
        fabrique, desc, schema = generators.CATALOGUE[nom]
        dlg = tk.Toplevel(self)
        dlg.title(f"Générer : {nom}")
        dlg.transient(self)
        ttk.Label(dlg, text=desc, font=("Segoe UI", 9, "italic")
                  ).grid(row=0, column=0, columnspan=2, padx=10, pady=(10, 6))
        vars_ = {}
        for i, (cle, (label, defaut, vmin, vmax)) in enumerate(schema.items(), 1):
            ttk.Label(dlg, text=label).grid(row=i, column=0, sticky="e",
                                            padx=(10, 4), pady=2)
            v = tk.IntVar(value=defaut)
            vars_[cle] = v
            ttk.Spinbox(dlg, from_=vmin, to=vmax, textvariable=v, width=7
                        ).grid(row=i, column=1, sticky="w", padx=(0, 10))

        def go():
            try:
                params = {k: v.get() for k, v in vars_.items()}
                texte, note = generators.genere(nom, params)
            except Exception as exc:            # parametre farfelu
                messagebox.showerror("Generation impossible", str(exc), parent=dlg)
                return
            self._stop_sim()
            self.editeur.delete("1.0", "end")
            self.editeur.insert("1.0", texte)
            self.compiler()
            self.vue.recadrer()
            dlg.destroy()

        ttk.Button(dlg, text="Insérer dans l'éditeur", command=go
                   ).grid(row=len(schema) + 1, column=0, columnspan=2, pady=10)
        dlg.grab_set()

    def dialogue_obj(self):
        chemin = filedialog.askopenfilename(
            filetypes=[("Modeles 3D Wavefront", "*.obj"), ("Tous", "*.*")])
        if not chemin:
            return
        dlg = tk.Toplevel(self)
        dlg.title("Importer un .obj")
        dlg.transient(self)
        ttk.Label(dlg, text=os.path.basename(chemin)).grid(
            row=0, column=0, columnspan=2, padx=10, pady=(10, 6))
        ttk.Label(dlg, text="masses visées (0 = toutes)").grid(
            row=1, column=0, sticky="e", padx=(10, 4))
        v_masses = tk.IntVar(value=300)
        ttk.Spinbox(dlg, from_=0, to=1000, textvariable=v_masses, width=8
                    ).grid(row=1, column=1, sticky="w", padx=(0, 10))
        ttk.Label(dlg, text="plafond ressorts (0 = aucun)").grid(
            row=2, column=0, sticky="e", padx=(10, 4))
        v_res = tk.IntVar(value=0)
        ttk.Spinbox(dlg, from_=0, to=3000, textvariable=v_res, width=8
                    ).grid(row=2, column=1, sticky="w", padx=(0, 10))

        def go():
            try:
                texte, note = generators.importe_obj(
                    chemin, masses=v_masses.get(), ressorts=v_res.get())
            except SystemExit as exc:
                messagebox.showerror("Import impossible", str(exc), parent=dlg)
                return
            except Exception as exc:
                messagebox.showerror("Import impossible",
                                     f"{type(exc).__name__} : {exc}", parent=dlg)
                return
            self._stop_sim()
            self.editeur.delete("1.0", "end")
            self.editeur.insert("1.0", texte)
            self.compiler()
            self.vue.recadrer()
            dlg.destroy()

        ttk.Button(dlg, text="Importer", command=go).grid(
            row=3, column=0, columnspan=2, pady=10)
        dlg.grab_set()

    def _aide(self):
        messagebox.showinfo(
            "MIMS Studio — aide",
            "SOURIS (vue 3D)\n"
            "  glisser gauche : orbiter\n"
            "  molette : zoom\n"
            "  glisser droit : deplacer\n"
            "  double-clic : recadrer\n"
            "  clic simple : selectionner une bille\n\n"
            "SIMULATION\n"
            "  Simuler : lance la physique (les billes bougent en hauteur)\n"
            "  Frapper : impulsion sur la bille selectionnee (ou la plus haute)\n"
            "  vitesse : nombre de pas de calcul par image\n"
            "  amplification : exagere visuellement le mouvement\n\n"
            "COULEURS\n"
            "  bleu = masse mobile   rouge = point fixe (ground)\n"
            "  jaune = posInput      cercle vert = sortie ecoutee\n"
            "  orange pointille = contact   violet = archet   vert = pluck")


def main(selftest=False):
    app = Studio()
    if selftest:
        def _test():
            rapport = []
            rapport.append("compile: " + app.statut.cget("text"))
            app.bascule_sim()
            if app.sim:
                app.sim.frapper(app.sim.noms[3])
                app.sim.pas(2000)
                rapport.append(f"simulation 2000 pas ok, amplitude "
                               f"{app.sim.amplitude():.4f}")
            app._stop_sim()
            print("\n".join(rapport))
            print("SELFTEST OK")
            app.destroy()
        app.after(400, _test)
    app.mainloop()
