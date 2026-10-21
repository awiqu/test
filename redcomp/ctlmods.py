"""Малые ПЛМ-модули управления RC-8 + эталонные модели."""
from .pla import PLA


def T(*lits):
    return [(n, p) for n, p in lits]


def seldec_spec(prefix, enable=True):
    """3 бита -> 8 линий выбора (активный высокий), с разрешением en. имена входов: <prefix>0..2, en"""
    ins = [f"{prefix}{i}" for i in range(3)] + (["en"] if enable else [])
    outs = {}
    for r in range(8):
        t = [(f"{prefix}{i}", (r >> i) & 1) for i in range(3)]
        if enable:
            t.append(("en", 1))
        outs[f"s{r}"] = [t]
    return ins, outs


def seldec_model(v):
    r = (v["x0"] | v["x1"] << 1 | v["x2"] << 2)
    en = v.get("en", 1)
    return {f"s{k}": int(en and k == r) for k in range(8)}


def imm_spec():
    ins = [f"I{k}" for k in range(8)] + ["isimm", "isldi", "isaddi"]
    outs = {}
    for k in range(6):
        outs[f"m{k}"] = [T((f"I{k}", 1), ("isimm", 1))]
    outs["m6"] = [T(("I6", 1), ("isldi", 1)), T(("I5", 1), ("isaddi", 1))]
    outs["m7"] = [T(("I7", 1), ("isldi", 1)), T(("I5", 1), ("isaddi", 1))]
    return ins, outs


def imm_model(v):
    out = {}
    for k in range(6):
        out[f"m{k}"] = v[f"I{k}"] & v["isimm"]
    out["m6"] = (v["I6"] & v["isldi"]) | (v["I5"] & v["isaddi"])
    out["m7"] = (v["I7"] & v["isldi"]) | (v["I5"] & v["isaddi"])
    return out


def pc_spec(nb=9):
    ins = [f"pc{i}" for i in range(nb)] + [f"a{i}" for i in range(nb)] + ["take"]
    outs = {}
    for k in range(nb):
        terms = [T((f"a{k}", 1), ("take", 1))]
        if k == 0:
            terms.append(T(("pc0", 0), ("take", 0)))
        else:
            for j in range(k):
                terms.append(T((f"pc{k}", 1), (f"pc{j}", 0), ("take", 0)))
            terms.append(T((f"pc{k}", 0), *[(f"pc{j}", 1) for j in range(k)], ("take", 0)))
        outs[f"n{k}"] = terms
    return ins, outs


def pc_model(v, nb=9):
    pc = sum(v[f"pc{i}"] << i for i in range(nb))
    a = sum(v[f"a{i}"] << i for i in range(nb))
    nxt = a if v["take"] else (pc + 1) % (1 << nb)
    return {f"n{k}": (nxt >> k) & 1 for k in range(nb)}


def jump_spec():
    ins = ["isjmp", "isjcc", "c0", "c1", "c2", "Z", "C", "sub", "isadc"]
    outs = {
        "take": [T(("isjmp", 1)),
                 T(("isjcc", 1), ("c2", 0), ("c1", 0), ("c0", 0), ("Z", 1)),
                 T(("isjcc", 1), ("c2", 0), ("c1", 0), ("c0", 1), ("Z", 0)),
                 T(("isjcc", 1), ("c2", 0), ("c1", 1), ("c0", 0), ("C", 1)),
                 T(("isjcc", 1), ("c2", 0), ("c1", 1), ("c0", 1), ("C", 0))],
        "cin": [T(("sub", 1)), T(("isadc", 1), ("C", 1))],
    }
    return ins, outs


def jump_model(v):
    cond = v["c0"] | v["c1"] << 1 | v["c2"] << 2
    m = [v["Z"] == 1, v["Z"] == 0, v["C"] == 1, v["C"] == 0, False, False, False, False][cond]
    take = int(v["isjmp"] or (v["isjcc"] and m))
    cin = int(v["sub"] or (v["isadc"] and v["C"]))
    return {"take": take, "cin": cin}


def flags_spec():
    ins = [f"r{k}" for k in range(8)] + ["cout7", "a0", "fS", "fSHR"]
    outs = {
        "Znew": [T(*[(f"r{k}", 0) for k in range(8)])],
        "Cnew": [T(("cout7", 1), ("fS", 1)), T(("a0", 1), ("fSHR", 1))],
    }
    return ins, outs


def flags_model(v):
    z = int(all(v[f"r{k}"] == 0 for k in range(8)))
    c = int((v["cout7"] and v["fS"]) or (v["a0"] and v["fSHR"]))
    return {"Znew": z, "Cnew": c}


def build(g, ox, oz, spec):
    ins, outs = spec
    return PLA(g, ox, oz, ins, outs)
