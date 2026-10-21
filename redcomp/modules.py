"""Общие генераторы модулей: цепочка задержки (змейка из повторителей) и решёточный модуль на NOR-вентилях."""
import os, pickle
from .grid import Grid, Block
from .lattice import Netlist, Design


def delay_chain(g: Grid, ox, oz, n, delay=4, width=24):
    """Змейка из n повторителей (каждый delay редстоун-тиков = 2*delay игровых тиков).
    Вход: пыль в (ox, oz) — принимает сигнал с запада. Выход: пыль в конце цепи.
    Строки идут через 2 клетки по z. Возвращает dict(in=(x,0,z), out=(x,0,z), bbox, in_dir, out_dir, ticks)."""
    row, left = 0, n
    x_first, x_last = ox + 1, ox + width
    z = oz
    g.dust(ox, 0, oz)
    cur_dir = "east"
    x = x_first
    out = None
    while left > 0:
        if cur_dir == "east":
            cnt = min(left, x_last - x + 1)
            for k in range(cnt):
                g.repeater(x + k, 0, z, "east", delay)
            xe = x + cnt - 1
            left -= cnt
            if left > 0:
                # поворот на юг: пыль (xe+1, z), (xe+1, z+1), (xe+1, z+2)
                for dz in range(3):
                    g.dust(xe + 1, 0, z + dz)
                z += 2; cur_dir = "west"; x = xe          # следующая строка течёт на запад, первый повторитель в (xe, z)
            else:
                out = (xe + 1, 0, z); g.dust(*out); out_dir = "E"
        else:
            cnt = min(left, x - x_first + 1)
            for k in range(cnt):
                g.repeater(x - k, 0, z, "west", delay)
            xe = x - cnt + 1
            left -= cnt
            if left > 0:
                for dz in range(3):
                    g.dust(xe - 1, 0, z + dz)
                z += 2; cur_dir = "east"; x = xe
            else:
                out = (xe - 1, 0, z); g.dust(*out); out_dir = "W"
    # выровнять чётность выхода по x (узлы решётки на чётных x): добавим пыль
    if out[0] % 2:
        step = 1 if out_dir == "E" else -1
        out = (out[0] + step, 0, out[2]); g.dust(*out)
    return {"in": (ox, 0, oz), "out": out, "in_dir": "W", "out_dir": out_dir,
            "ticks": 2 * delay * n, "bbox": (ox, oz, x_last + 2, z)}


def lattice_module(nl: Netlist, NI, NJ, ext, src_names, seeds=range(8), iters=30000, flow_w=1.5, verbose=False):
    """Разместить и проложить нетлист в решётке NI x NJ; ext: имя -> [(i,j,l)] (пины по границам).
    Возвращает (Grid, ext) или (None, ext)."""
    for seed in seeds:
        d = Design(nl, NI, NJ, seed=seed)
        fixed = {n: p[0][:2] for n, p in ext.items()}
        d.place(iters=iters, fixed=fixed, flow_w=flow_w)
        for sd in range(3):
            R = d.route_pf(ext_pins=ext, ext_src={n: ext[n] for n in src_names}, seed=sd, iters=30)
            if R:
                g = Grid(); R.emit(g)
                return g, ext
        if verbose:
            print("seed", seed, "не удалось:", d.failed)
    return None, ext


def cached(name, build):
    """pickle-кэш модулей в build/cache"""
    cache = os.path.join(os.path.dirname(__file__), "..", "build", "cache")
    os.makedirs(cache, exist_ok=True)
    f = os.path.join(cache, name + ".pkl")
    if os.path.exists(f):
        data = pickle.load(open(f, "rb"))
        g = Grid()
        for p, (n, props) in data["blocks"].items():
            g.b[p] = Block(n, props)
        return g, data["meta"]
    g, meta = build()
    pickle.dump({"blocks": {p: (b.name, dict(b.props)) for p, b in g.b.items()}, "meta": meta}, open(f, "wb"))
    return g, meta
