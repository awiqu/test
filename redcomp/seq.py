"""Секвенсор: кольцо импульсов (p1 -> p2 -> p3), защёлка RUN, Start/Stop/Step/Reset, HLT.

Кольцо: моностабильный генератор q (ширина w) -> задержка a1 -> p1 -> a2 -> p2 -> a3 -> p3 -> a4 -> fb;
fb И RUN снова запускает генератор. Кнопки впрыскивают импульс при остановленной машине.
"""
from .grid import Grid
from .lattice import Netlist
from .modules import lattice_module, delay_chain, cached, distribute_delay

INS = ["bStart", "bStop", "bStep", "bRst", "hlt", "fb", "qd", "runD", "p3"]
OUTS = ["q", "run", "rstl"]
CTL_NI, CTL_NJ = 16, 14


def seqctl_netlist():
    nl = Netlist()
    for n in INS:
        nl.inp(n)
    nl.nor("nstop", ["bStop", "hlt", "bRst"])
    nl.NOT("nstop", "stop")
    nl.nor("run", ["stop", "nrun"])
    nl.nor("nrun", ["bStart", "run"])
    nl.nor("x1", ["bStart", "bStep", "bRst"])
    nl.nor("inj", ["x1", "runD"])           # нажатие при остановленной машине
    nl.NOT("fb", "nfb")
    nl.nor("inj", ["nfb", "nrun"])          # возврат кольца при RUN
    nl.nor("q", ["qd", "nq"])
    nl.nor("nq", ["inj", "q"])
    nl.nor("rstl", ["p3", "nrstl"])
    nl.nor("nrstl", ["bRst", "rstl"])
    for n in OUTS:
        nl.outp(n)
    return nl


def seqctl_pins(NI=CTL_NI, NJ=CTL_NJ):
    ext = {}
    for k, n in enumerate(INS):
        ext[n] = [(0, 1 + (k * (NJ - 2)) // len(INS), 0)]
    for k, n in enumerate(OUTS):
        ext[n] = [(NI - 1, 2 + (k * (NJ - 4)) // len(OUTS), 0)]
    return ext


def seqctl_grid():
    def build():
        ext = seqctl_pins()
        g, ext = lattice_module(seqctl_netlist(), CTL_NI, CTL_NJ, ext, INS, seeds=range(12), verbose=True)
        if g is None:
            raise RuntimeError("seqctl: не удалось разместить")
        return g, {"ext": ext}
    return cached(f"seqctl_{CTL_NI}x{CTL_NJ}", build)


CAP = dict(dw=16, dr=1, d1=50, d2=20, d3=20, d4=50)          # ёмкость цепочек (повторителей)
TICKS = dict(dw=100, d1=700, d2=200, d3=200, d4=600)         # задержки по умолчанию (игровые тики)


def build_seq(core, ox, oz, cap=None, ticks=None, width=22, mod="seq"):
    """Разместить секвенсор в Core: модуль логики + цепочки задержек; зарегистрировать порты и цепи.
    Внешние входы (порты (mod,'bStart'..'hlt')), выходы ('p1','p2','p3','rst','run') — пины на модуле логики/цепочках.
    Возвращает dict с геометрией и временами (игровые тики)."""
    g = core.g
    ctl, meta = seqctl_grid()
    for p, b in ctl.b.items():
        g.b[(p[0] + ox, p[1], p[2] + oz)] = type(b)(b.name, b.props)
    ext = meta["ext"]
    for n in INS:
        i, j, l = ext[n][0]
        core.port(f"{mod}.ctl", n, ox + 2 * i, oz + 2 * j, "W")
    for n in OUTS:
        i, j, l = ext[n][0]
        core.port(f"{mod}.ctl", n, ox + 2 * i, oz + 2 * j, "E")
    # цепочки справа от логики, друг под другом
    cx = ox + 2 * CTL_NI + 16
    z = oz
    chains = {}
    cap = {**CAP, **(cap or {})}
    tk = {**TICKS, **(ticks or {})}
    for name in ("dw", "dr", "d1", "d2", "d3", "d4"):
        n = cap[name]
        sub = Grid()
        c = delay_chain(sub, 0, 0, n, 4, width)
        if name != "dr":
            for pos, d in zip(c["reps"], distribute_delay(n, tk[name])):
                sub.b[pos].props["delay"] = d
            c["ticks"] = 2 * sum(sub.b[pos].props["delay"] for pos in c["reps"])
        c["abs_reps"] = [(pp[0] + cx, pp[1], pp[2] + z) for pp in c["reps"]]
        for p, b in sub.b.items():
            g.b[(p[0] + cx, p[1], p[2] + z)] = b
        (xi, _, zi), (xo, _, zo) = c["in"], c["out"]
        core.port(f"{mod}.{name}", "in", cx + xi, z + zi, "W")
        core.port(f"{mod}.{name}", "out", cx + xo, z + zo, c["out_dir"])
        chains[name] = c
        z += c["bbox"][3] + 8
    N = core.net
    N(f"{mod}.q", (f"{mod}.ctl", "q"), [(f"{mod}.dw", "in"), (f"{mod}.d1", "in")], weak=True)
    N(f"{mod}.qd", (f"{mod}.dw", "out"), [(f"{mod}.ctl", "qd")])
    N(f"{mod}.p1", (f"{mod}.d1", "out"), [(f"{mod}.d2", "in")])
    N(f"{mod}.p2", (f"{mod}.d2", "out"), [(f"{mod}.d3", "in")])
    N(f"{mod}.p3", (f"{mod}.d3", "out"), [(f"{mod}.d4", "in"), (f"{mod}.ctl", "p3")])
    N(f"{mod}.fb", (f"{mod}.d4", "out"), [(f"{mod}.ctl", "fb")])
    N(f"{mod}.run", (f"{mod}.ctl", "run"), [(f"{mod}.dr", "in")], weak=True)
    N(f"{mod}.runD", (f"{mod}.dr", "out"), [(f"{mod}.ctl", "runD")])
    ticks = {k: c["ticks"] for k, c in chains.items()}
    return {"chains": chains, "ticks": ticks, "bbox": (ox, oz, cx + width + 4, z)}
