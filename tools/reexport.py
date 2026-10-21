"""Перегенерировать датапак из сохранённой сетки (без повторной трассировки): reexport.py DIR [name]"""
import sys, os, pickle
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.grid import Grid, Block
from redcomp.export import write_datapack
d = sys.argv[1]; name = sys.argv[2] if len(sys.argv) > 2 else "rc8"
data = pickle.load(open(os.path.join(d, name + "_grid.pkl"), "rb"))
meta = pickle.load(open(os.path.join(d, name + "_meta.pkl"), "rb"))
g = Grid()
for p, (n, props) in data.items():
    g.b[p] = Block(n, props)
write_datapack(g, d, name=name, tile=96)
bx0, bz0, bx1, bz1 = meta["mod_bbox"]["pixels"]
fdir = os.path.join(d, name, "data", name, "function")
with open(os.path.join(fdir, "clear_display.mcfunction"), "w") as f:
    f.write(f"fill ~{bx0} ~0 ~{bz0} ~{bx1} ~0 ~{bz1} minecraft:copper_bulb[lit=false,powered=false] replace minecraft:copper_bulb\n")
print("ok", os.path.getsize(os.path.join(d, name, "data", name, "structure", "full.nbt")) // 1024, "КБ")
