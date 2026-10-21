"""Секвенсор: кольцо импульсов (p1 -> p2 -> p3), защёлка RUN, Start/Stop/Step/Reset, HLT.

Кольцо: моностабильный генератор q (ширина w) -> задержка a1 -> p1 -> a2 -> p2 -> a3 -> p3 -> a4 -> fb;
fb И RUN снова запускает генератор. Кнопки впрыскивают импульс при остановленной машине.
"""
from .grid import Grid
from .lattice import Netlist
from .modules import lattice_module, delay_chain, cached

INS = ["bStart", "bStop", "bStep", "bRst", "hlt", "fb", "qd", "runD", "p3"]
OUTS = ["q", "run", "rstl"]
CTL_NI, CTL_NJ = 16, 14


def seqctl_netlist():
    nl = Netlist()
    for n in INS:
        nl.inp(n)
    nl.nor("run", ["bStop", "hlt", "bRst", "nrun"])
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
