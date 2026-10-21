"""Собрать компьютер целиком: программа -> ПЗУ -> размещение -> трассировка -> датапак + pickle.
Использование: python3 tools/make_system.py программа.asm [--halo N] [--seed N] [--out DIR]"""
import sys, os, time, pickle, argparse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.system import build_system, route_system
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
ap.add_argument("--nw", type=int, default=20)
ap.add_argument("--a1", type=int, default=100)
ap.add_argument("--a2", type=int, default=30)
ap.add_argument("--a3", type=int, default=30)
ap.add_argument("--a4", type=int, default=60)
ap.add_argument("--plan", default=None)
a = ap.parse_args()

words = assemble(open(a.asm).read())
seqp = dict(nw=a.nw, a1=a.a1, a2=a.a2, a3=a.a3, a4=a.a4)
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
core.g.fix_wires()
bad = check_nets(core.g, core.nets, verbose=False)
sh = find_shorts(core.g, core.nets, verbose=False)
print(f"проверка: слабых/недостижимых {len(bad)}, замыканий {len(sh)}, блоков {len(core.g.b)}", flush=True)
assert not bad and not sh
os.makedirs(a.out, exist_ok=True)
pickle.dump({"plan": plan_, "ports": core.ports, "nets": core.nets, "mod_bbox": core.mod_bbox,
             "timing": getattr(mods["seq"], "timing", None), "words": words},
            open(os.path.join(a.out, a.name + "_meta.pkl"), "wb"))
pickle.dump({p: (b.name, dict(b.props)) for p, b in core.g.b.items()}, open(os.path.join(a.out, a.name + "_grid.pkl"), "wb"))
tiles = write_datapack(core.g, a.out, name=a.name, tile=96)
print("датапак:", tiles, "плиток в", os.path.join(a.out, a.name), flush=True)
