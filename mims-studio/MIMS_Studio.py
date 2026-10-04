# -*- coding: utf-8 -*-
"""Lanceur de MIMS Studio.  Usage :  python MIMS_Studio.py  [--selftest]"""

import sys

from studio.ui_main import main

if __name__ == "__main__":
    main(selftest="--selftest" in sys.argv)
