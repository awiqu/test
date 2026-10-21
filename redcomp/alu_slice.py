"""Один разряд АЛУ как отдельный нетлист + шаблон с пинами на границах (для тиражирования x8)."""
from .lattice import Netlist, Design
from .grid import Grid

CTRL = ["sub", "nsub", "nfS", "nfAND", "nfOR", "nfXOR", "nfSHR", "nfIN"]
LEFT = CTRL + ["a", "b", "m", "i"]


def slice_netlist(lever=True):
    nl = Netlist()
    for n in CTRL + ["a", "b", "m", "c", "na_next"] + (["i"] if lever else []):
        nl.inp(n)
    nl.NOT("a", "na")
    nl.nor("nbi", ["b", "m"])
    nl.nor("t1b", ["nbi", "nsub"])
    nl.nor("bp", ["nbi", "t1b"]); nl.nor("bp", ["nsub", "t1b"])
    nl.nor("t1p", ["a", "bp"])
    nl.nor("P", ["a", "t1p"]); nl.nor("P", ["bp", "t1p"])
    nl.nor("G", ["t1p", "P"])
    nl.nor("cout", ["t1p", "P"])
    nl.NOT("P", "nP")
    nl.nor("u1", ["P", "c"])
    nl.nor("S", ["P", "u1"]); nl.nor("S", ["c", "u1"])
    nl.NOT("S", "nS")
    nl.NOT("c", "nc")
    nl.nor("cout", ["nP", "nc"])
    nl.NOT("G", "nG")
    nl.nor("nQ", ["P", "G"])
    nl.nor("r", ["nS", "nfS"])
    nl.nor("r", ["nG", "nfAND"])
    nl.nor("r", ["nQ", "nfOR"])
    nl.nor("r", ["nP", "nfXOR"])
    nl.nor("r", ["na_next", "nfSHR"])
    if lever:
        nl.NOT("i", "ni")
        nl.nor("r", ["ni", "nfIN"])
    nl.outp("r"); nl.outp("cout"); nl.outp("na")
    return nl


def slice_pins(NI, NJ):
    """позиции пинов (i,j,l) шаблона"""
    ext = {}
    n_l = len(LEFT)
    for k, n in enumerate(LEFT):
        ext[n] = [(0, 1 + (k * (NJ - 2)) // n_l, 0)]
    ext["r"] = [(NI - 1, NJ // 2, 0)]
    ext["c"] = [(NI // 2, 0, 0)]
    ext["na"] = [(NI // 2 + 2, 0, 0)]
    ext["cout"] = [(NI // 2, NJ - 1, 0)]
    ext["na_next"] = [(NI // 2 + 2, NJ - 1, 0)]
    return ext


def make_slice(NI=24, NJ=18, seeds=range(6), iters=30000, flow_w=1.5, verbose=False):
    """Размещение+трассировка среза; возвращает (Design, Router, ext)."""
    ext = slice_pins(NI, NJ)
    src_names = LEFT + ["c", "na_next"]
    for seed in seeds:
        nl = slice_netlist()
        d = Design(nl, NI, NJ, seed=seed)
        fixed = {n: p[0][:2] for n, p in ext.items()}
        d.place(iters=iters, fixed=fixed, flow_w=flow_w)
        for sd in range(3):
            R = d.route_pf(ext_pins=ext, ext_src={n: ext[n] for n in src_names}, seed=sd, iters=30)
            if R:
                return d, R, ext
        if verbose:
            print("seed", seed, "не удалось:", d.failed)
    return None, None, ext
