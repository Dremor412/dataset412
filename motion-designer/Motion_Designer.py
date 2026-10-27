# -*- coding: utf-8 -*-
"""Lanceur de Motion Designer : sert la page sur http://localhost et l'ouvre.

Ouvrir Motion_Designer.html directement marche aussi. Passer par ce petit
serveur local aide quand le navigateur bloque le MIDI ou le choix de la
sortie audio pour les fichiers ouverts en file://.
Usage :  python3 Motion_Designer.py  [port]"""

import functools
import http.server
import os
import sys
import threading
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8412
ICI = os.path.dirname(os.path.abspath(__file__))


def main():
    gestion = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ICI)
    serveur = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), gestion)
    url = "http://localhost:%d/Motion_Designer.html" % PORT
    print("Motion Designer : %s" % url)
    print("(Ctrl+C pour arrêter ; garde cette fenêtre ouverte pendant que tu joues)")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
