"""Собрать компьютер целиком: программа -> ПЗУ -> размещение -> трассировка -> датапак + pickle.
Использование: python3 tools/make_system.py программа.asm [--halo N] [--seed N] [--out DIR]"""
import sys, os, time, pickle, argparse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.system import build_system, route_system, make_labels
from redcomp.export import apply_labels
from redcomp.asm import assemble
from redcomp.export import write_datapack
from redcomp.netcheck import check_nets, find_shorts

ap = argparse.ArgumentParser()
ap.add_argument("asm")
ap.add_argument("--halo", type=int, default=20)
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--iters", type=int, default=30000)
ap.add_argument("--route-iters", type=int, default=150)
ap.add_argument("--out", default="/tmp/mc/dp")
ap.add_argument("--name", default="rc8")
ap.add_argument("--ticks", default="", help="например dw=100,d1=700,d2=200,d3=200,d4=600 (игровые тики)")
ap.add_argument("--plan", default=None)
a = ap.parse_args()

words = assemble(open(a.asm).read())
seqp = dict(ticks={k: int(v) for k, v in (kv.split("=") for kv in a.ticks.split(",") if kv)})
plan = pickle.load(open(a.plan, "rb")) if a.plan else None
halo = a.halo
for attempt in range(4):
    t = time.time()
    core, plan_, mods = build_system(words, halo=halo, seed=a.seed, iters=a.iters, verbose=False, seq_params=seqp, plan=plan)
    lo, hi = core.g.bbox()
    print(f"[{attempt}] размещение halo={halo}: {hi[0]-lo[0]}x{hi[2]-lo[2]} ({time.time()-t:.0f} c)", flush=True)
    t = time.time()
    gr, ok = route_system(core, verbose=False, iters=a.route_iters)
    print(f"[{attempt}] трассировка: {'успех' if ok else 'НЕУДАЧА ' + str(gr.R.failed)} ({time.time()-t:.0f} c)", flush=True)
    if ok:
        break
    plan = None
    halo += 8
else:
    sys.exit("не удалось проложить цепи")
n = gr.emit()
for pos, b in core.g.b.items():                     # оставшийся камень — проводка трассировщика: светло-серый бетон
    if b.name == "stone":
        b.name = "light_gray_concrete"
core.g.fix_wires()
bad = check_nets(core.g, core.nets, verbose=False)
sh = find_shorts(core.g, core.nets, verbose=False)
print(f"проверка: слабых/недостижимых {len(bad)}, замыканий {len(sh)}, блоков {len(core.g.b)}", flush=True)
assert not bad and not sh
labels = make_labels(core)
os.makedirs(a.out, exist_ok=True)
pickle.dump({"plan": plan_, "labels": labels, "ports": core.ports, "nets": core.nets, "mod_bbox": core.mod_bbox,
             "timing": getattr(mods["seq"], "timing", None), "words": words,
             "seq_chains": {k: [(x + plan_["seq"][0], y, z + plan_["seq"][1]) for (x, y, z) in v] for k, v in mods["seq"].chain_reps.items()}},
            open(os.path.join(a.out, a.name + "_meta.pkl"), "wb"))
pickle.dump({p: (b.name, dict(b.props)) for p, b in core.g.b.items()}, open(os.path.join(a.out, a.name + "_grid.pkl"), "wb"))
apply_labels(core.g, labels)
rx, rz, _ = core.ports[("panel", "bRst")]
tiles = write_datapack(core.g, a.out, name=a.name, tile=96, reset_btn=(rx, 0, rz + 2))
# функция очистки дисплея (запускается автоматически после запуска и вручную: /function <name>:clear_display)
bx0, bz0, bx1, bz1 = core.mod_bbox["pixels"]
fdir = os.path.join(a.out, a.name, "data", a.name, "function")
with open(os.path.join(fdir, "clear_display.mcfunction"), "w") as f:
    f.write(f"fill ~{bx0} ~0 ~{bz0} ~{bx1} ~0 ~{bz1} minecraft:waxed_copper_bulb[lit=false,powered=false] replace minecraft:waxed_copper_bulb\n")
print("датапак:", tiles, "плиток в", os.path.join(a.out, a.name), flush=True)
