"""Выгрузка готовой постройки во все форматы.
python3 tools/export_all.py DIR [--out OUT]
Читает DIR/rc8_grid.pkl (после make_system.py) и пишет в OUT:
  rc8.nbt        — ванильная структура целиком (structure block / datapack)
  rc8.schem      — Sponge Schematic v2 (WorldEdit/FAWE: //schem load rc8, //paste)
  rc8.litematic  — Litematica
  datapack/rc8   — готовый датапак (/function rc8:build)"""
import sys, os, pickle, shutil, argparse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.grid import Grid, Block
from redcomp.export import structure_nbt, schem_bytes, litematic_bytes, bounds, apply_labels

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--out", default=None)
ap.add_argument("--name", default="rc8")
a = ap.parse_args()
out = a.out or os.path.join(a.dir, "export")
os.makedirs(out, exist_ok=True)
data = pickle.load(open(os.path.join(a.dir, a.name + "_grid.pkl"), "rb"))
g = Grid()
for p, (n, props) in data.items():
    g.b[p] = Block(n, props)
meta = pickle.load(open(os.path.join(a.dir, a.name + "_meta.pkl"), "rb"))
g.fix_wires()
apply_labels(g, meta.get("labels", []))
org, hi = bounds(g)
size = (hi[0] - org[0] + 1, hi[1] - org[1] + 1, hi[2] - org[2] + 1)
print("размер", size, "блоков", len(g.b))
open(os.path.join(out, a.name + ".nbt"), "wb").write(structure_nbt(g.b, org, size))
open(os.path.join(out, a.name + ".schem"), "wb").write(schem_bytes(g.b, org, size))
open(os.path.join(out, a.name + ".litematic"), "wb").write(litematic_bytes(g.b, org, size, name="RC-8"))
dst = os.path.join(out, "datapack")
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(os.path.join(a.dir, a.name), os.path.join(dst, a.name))
if os.path.isdir(os.path.join(a.dir, a.name + "_rom")):
    shutil.copytree(os.path.join(a.dir, a.name + "_rom"), os.path.join(dst, a.name + "_rom"))
for f in os.listdir(out):
    p = os.path.join(out, f)
    if os.path.isfile(p):
        print(f"{f}: {os.path.getsize(p)//1024} КБ")
