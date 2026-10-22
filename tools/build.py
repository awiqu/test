#!/usr/bin/env python3
"""Единая команда сборки: ассемблер -> ПЗУ -> размещение -> трассировка -> проверки -> датапак/.nbt/.schem/.litematic.
  python3 tools/build.py programs/test_all.asm [--out dist] [--ticks dw=..,d1=..]
Если собранная постройка уже есть (dist/work/rc8_grid.pkl), а меняется только программа — используйте tools/romgen.py (быстро)."""
import sys, os, subprocess, argparse, shutil
here = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("asm")
ap.add_argument("--out", default=os.path.join(here, "..", "dist"))
ap.add_argument("--ticks", default="")
a, rest = ap.parse_known_args()
work = os.path.join(a.out, "work")
os.makedirs(work, exist_ok=True)
py = sys.executable
subprocess.check_call([py, os.path.join(here, "make_system.py"), a.asm, "--out", work, "--ticks", a.ticks] + rest)
subprocess.check_call([py, os.path.join(here, "romgen.py"), a.asm, "--meta", os.path.join(work, "rc8_meta.pkl"), "--out", work])
subprocess.check_call([py, os.path.join(here, "export_all.py"), work, "--out", a.out])
print("готово:", os.path.abspath(a.out))
