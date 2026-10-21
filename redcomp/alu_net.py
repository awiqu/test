"""Нетлист АЛУ RC-8 на NOR-вентилях.

Входы : a0..a7, b0..b7, m0..m7 (непосредственный операнд, уже строб-ированный), i0..i3 (рычаги),
        sub, nsub, cin, nfS, nfAND, nfOR, nfXOR, nfSHR, nfIN   (nf* - активный НИЗКИЙ выбор функции)
Выходы: r0..r7, cout (перенос из старшего бита, активный высокий), nz (результат != 0)
Функция: R = sum(a, b|m ^ sub, cin) | a&b | a|b | a^b | a>>1 | levers   (по выбранной nf*)
"""
from .lattice import Netlist


def build_alu(nl: Netlist | None = None, nbits=8, lever_bits=4):
    nl = nl or Netlist()
    for n in ("sub", "nsub", "cin", "nfS", "nfAND", "nfOR", "nfXOR", "nfSHR", "nfIN"):
        nl.inp(n)
    for k in range(nbits):
        nl.inp(f"a{k}"); nl.inp(f"b{k}"); nl.inp(f"m{k}")
    for k in range(lever_bits):
        nl.inp(f"i{k}")
    # дополнения a_j
    for k in range(nbits):
        nl.NOT(f"a{k}", f"na{k}")
    for k in range(nbits):
        c = "cin" if k == 0 else f"cout{k-1}"
        a, b, m = f"a{k}", f"b{k}", f"m{k}"
        nl.nor(f"nbi{k}", [b, m])
        # bp = nbi ^ nsub
        nl.nor(f"t1b{k}", [f"nbi{k}", "nsub"])
        nl.nor(f"bp{k}", [f"nbi{k}", f"t1b{k}"])
        nl.nor(f"bp{k}", ["nsub", f"t1b{k}"])
        # P = a ^ bp ; G = a & bp
        nl.nor(f"t1p{k}", [a, f"bp{k}"])
        nl.nor(f"P{k}", [a, f"t1p{k}"])
        nl.nor(f"P{k}", [f"bp{k}", f"t1p{k}"])
        nl.nor(f"G{k}", [f"t1p{k}", f"P{k}"])
        nl.nor(f"cout{k}", [f"t1p{k}", f"P{k}"])          # G в цепи переноса
        nl.NOT(f"P{k}", f"nP{k}")
        # сумма
        nl.nor(f"u1_{k}", [f"P{k}", c])
        nl.nor(f"S{k}", [f"P{k}", f"u1_{k}"])
        nl.nor(f"S{k}", [c, f"u1_{k}"])
        nl.NOT(f"S{k}", f"nS{k}")
        nl.NOT(c, f"nc{k}")
        nl.nor(f"cout{k}", [f"nP{k}", f"nc{k}"])           # P&c
        nl.NOT(f"G{k}", f"nG{k}")
        nl.nor(f"nQ{k}", [f"P{k}", f"G{k}"])
        # выбор результата
        nl.nor(f"r{k}", [f"nS{k}", "nfS"])
        nl.nor(f"r{k}", [f"nG{k}", "nfAND"])
        nl.nor(f"r{k}", [f"nQ{k}", "nfOR"])
        nl.nor(f"r{k}", [f"nP{k}", "nfXOR"])
        if k + 1 < nbits:
            nl.nor(f"r{k}", [f"na{k+1}", "nfSHR"])
        if k < lever_bits:
            nl.NOT(f"i{k}", f"ni{k}")
            nl.nor(f"r{k}", [f"ni{k}", "nfIN"])
        nl.outp(f"r{k}")
    nl.outp(f"cout{nbits-1}")
    # nz: результат != 0 : z = NOR(r...) , nz = NOT z
    return nl


def eval_netlist(nl: Netlist, inputs: dict):
    """логическая модель: итерация до сходимости (многодрайверные сети = ИЛИ)"""
    v = dict(inputs)
    outs_names = {g.out for g in nl.gates}
    for _ in range(200):
        outs = {}
        for g in nl.gates:
            o = int(not any(v.get(n, 0) for n in g.ins))
            outs[g.out] = outs.get(g.out, 0) | o
        ch = False
        for k, o in outs.items():
            if v.get(k) != o:
                v[k] = o; ch = True
        if not ch:
            return v
    raise RuntimeError("не сошлось")
