"""Перенастроить задержки секвенсора без повторной трассировки: retime.py DIR dw=100,d1=700,d2=200,d3=200,d4=600 [--name rc8]"""
import sys, os, pickle
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.grid import Grid, Block
from redcomp.modules import distribute_delay
from redcomp.export import write_datapack
d = sys.argv[1]
spec = dict((k, int(v)) for k, v in (kv.split("=") for kv in sys.argv[2].split(",")))
name = "rc8"
data = pickle.load(open(os.path.join(d, name + "_grid.pkl"), "rb"))
meta = pickle.load(open(os.path.join(d, name + "_meta.pkl"), "rb"))
tot = {}
for ch, reps in meta["seq_chains"].items():
    if ch in spec:
        for pos, dl in zip(reps, distribute_delay(len(reps), spec[ch])):
            n, props = data[pos]
            props = dict(props); props["delay"] = dl
            data[pos] = (n, props)
    tot[ch] = 2 * sum(data[p][1]["delay"] for p in reps) if ch != "dr" else 8
meta["timing"] = tot
pickle.dump(data, open(os.path.join(d, name + "_grid.pkl"), "wb"))
pickle.dump(meta, open(os.path.join(d, name + "_meta.pkl"), "wb"))
g = Grid()
for p, (n, props) in data.items():
    g.b[p] = Block(n, props)
rx, rz, _ = meta["ports"][("panel", "bRst")]
write_datapack(g, d, name=name, tile=96, reset_btn=(rx, 0, rz + 2))
bx0, bz0, bx1, bz1 = meta["mod_bbox"]["pixels"]
fdir = os.path.join(d, name, "data", name, "function")
with open(os.path.join(fdir, "clear_display.mcfunction"), "w") as f:
    f.write(f"fill ~{bx0} ~0 ~{bz0} ~{bx1} ~0 ~{bz1} minecraft:waxed_copper_bulb[lit=false,powered=false] replace minecraft:waxed_copper_bulb\n")
print("задержки (игр. тики):", tot, "период кольца ~", sum(tot[k] for k in ("d1", "d2", "d3", "d4")))
