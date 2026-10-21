"""Сборка всего компьютера RC-8 из модулей: ядро, секвенсор, ПЗУ, дисплей, цифры, пульт + глобальная трассировка."""
import re
from .grid import Grid, Block
from . import ctlmods as C
from .control import build_control
from .regfile import regfile
from .cells import latch_row
from .alu_slice import slice_pins, LEFT
from .core import Core, alu_slice_grid, SL_NI, SL_NJ, SL_H
from .pla import PLA
from . import seq as SEQ
from .rom import build_rom, ADDR
from .periph import pixel_array, digit


# ------------------------------------------------------------------ модуль = готовый фрагмент с портами
class Mod:
    def __init__(self, name):
        self.name = name
        self.g = Grid()
        self.ports = {}          # имя -> (x, z, dir)
        self.weak = set()        # имена выходных портов со слабым сигналом
        self.nets_in = []        # внутренние цепи (имя, (мод,порт) ...) — для макросов (не используется)

    def port(self, name, x, z, d):
        self.ports[name] = (x, z, d)

    def bbox(self):
        xs = [p[0] for p in self.g.b]; zs = [p[2] for p in self.g.b]
        for (x, z, d) in self.ports.values():
            xs.append(x); zs.append(z)
        return (min(xs), min(zs), max(xs), max(zs))


def _pla_mod(name, spec, ox=4, oz=8):
    m = Mod(name)
    ins, outs = spec
    p = PLA(m.g, ox, oz, ins, outs)
    for n, (x, y, z) in p.in_ports.items():
        m.port(n, x, z, "N")
    for n, (x, y, z) in p.out_ports.items():
        m.port(n, x, z, "S")
    return m


def mod_control():
    m = Mod("control")
    p = build_control(m.g, 4, 8)
    for n, (x, y, z) in p.in_ports.items():
        m.port(n, x, z, "N")
    for n, (x, y, z) in p.out_ports.items():
        m.port(n, x, z, "S")
    return m


def mod_regfile(name):
    m = Mod(name)
    P = regfile(m.g, 4, 4)
    for r in range(8):
        x, y, z = P["sel"][r]; m.port(f"sel{r}", x, z, "N")
        x, y, z = P["wr"][r]; m.port(f"wr{r}", x, z, "N")
    for k in range(8):
        x, y, z = P["W_in"][k]; m.port(f"W{k}", x, z, "E")
        x, y, z = P["R_out"][k]; m.port(f"R{k}", x, z, "E")
        m.weak.add(f"R{k}")
    return m


def mod_alu():
    """8 срезов АЛУ в столбец + повторители цепей переноса и na; порты: <pin><k> """
    m = Mod("alu")
    sl = alu_slice_grid()
    ext = slice_pins(SL_NI, SL_NJ)
    for k in range(8):
        oz = SL_H * k
        for p, (n, props) in sl["blocks"].items():
            m.g.b[(p[0], p[1], p[2] + oz)] = Block(n, props)
        for n in LEFT:
            (i, j, l) = ext[n][0]
            m.port(f"{n}{k}", 2 * i, oz + 2 * j, "W")
        (i, j, l) = ext["r"][0]
        m.port(f"r{k}", 2 * i, oz + 2 * j, "E"); m.weak.add(f"r{k}")
    xc, xn = 2 * ext["c"][0][0], 2 * ext["na"][0][0]
    for k in range(7):
        zb = SL_H * k + 2 * (SL_NJ - 1)               # z пинов cout/na_next среза k (низ)
        m.g.repeater(xc, 0, zb + 1, "south")            # cout_k -> c_{k+1} (z=36k+36)
        m.g.repeater(xn, 0, zb + 1, "north")            # na_{k+1} -> na_next_k
    (i, j, l) = ext["c"][0]
    m.port("c0", 2 * i, 2 * j, "N")                     # cin
    (i, j, l) = ext["cout"][0]
    m.port("cout7", 2 * i, SL_H * 7 + 2 * j, "S"); m.weak.add("cout7")
    (i, j, l) = ext["na_next"][0]
    m.port("na_next7", 2 * i, SL_H * 7 + 2 * j, "S")
    return m


def mod_latch(name, n):
    m = Mod(name)
    L = latch_row(m.g, 8, 4, n)
    x, y, z = L["bus"]; m.port("bus", x, z, "W")
    for i in range(n):
        x, y, z = L["d"][i]; m.port(f"d{i}", x, z, "N")
        x, y, z = L["q"][i]; m.port(f"q{i}", x, z, "S")
    return m


def mod_rom(words):
    m = Mod("rom")
    core = Core()
    info = build_rom(core, 4, 10, words)
    m.g = core.g
    for (mn, pn), (x, z, d) in core.ports.items():
        m.port(f"{mn}.{pn}", x, z, d)
    m.info = info
    return m


def mod_pixels():
    m = Mod("pixels")
    P = pixel_array(m.g, 1, 0, 32, 32)
    for j, (x, y, z) in P["rows"].items():
        m.port(f"row{j}", x, z, "W")
    for i, (x, y, z) in P["cols"].items():
        m.port(f"col{i}", x, z, "N")
    m.P = P
    return m


def decoder_spec(prefix, nb=5, extra=None):
    ins = [f"{prefix}{i}" for i in range(nb)] + ([extra] if extra else [])
    outs = {}
    for v in range(1 << nb):
        t = [(f"{prefix}{i}", (v >> i) & 1) for i in range(nb)]
        if extra:
            t.append((extra, 1))
        outs[f"s{v}"] = [t]
    return ins, outs


def hex7_spec():
    HEX7 = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71]
    ins = [f"h{i}" for i in range(4)]
    outs = {}
    for s, name in enumerate("abcdefg"):
        terms = []
        for v in range(16):
            if (HEX7[v] >> s) & 1:
                terms.append([(f"h{i}", (v >> i) & 1) for i in range(4)])
        outs[name] = terms
    return ins, outs


def digsel_spec():
    ins = ["pOUT", "rd0", "rd1", "rd2"]
    outs = {f"pD{k}": [[("pOUT", 1)] + [(f"rd{i}", (k >> i) & 1) for i in range(3)]] for k in range(3)}
    return ins, outs


def mod_digit():
    m = Mod("digit")
    d = digit(m.g, 0, 0)
    for n, (x, y, z) in d["pins"].items():
        m.port(n, x, z, "W" if x <= 6 else "E")
    return m


def mod_panel():
    """Пульт: кнопки Start/Stop/Step/Reset, рычаги IN0..3, лампа RUN. Пины-источники на y=0 (пыль), рычаг/кнопка рядом."""
    m = Mod("panel")
    g = m.g
    x = 4
    for name in ("bStart", "bStop", "bStep", "bRst"):
        g.dust(x, 0, 4)
        g.put(x, 0, 6, "stone_button", face="floor", facing="north", powered="false")
        g.dust(x, 0, 5)
        m.port(name, x, 4, "N")
        x += 8
    x += 4
    for i in range(4):
        g.dust(x, 0, 4)
        g.lever(x, 0, 5, face="floor", facing="north")
        m.port(f"lev{i}", x, 4, "N")
        x += 6
    x += 4
    g.dust(x, 0, 4)                     # лампа RUN
    g.put(x, 0, 5, "redstone_lamp", lit="false")
    m.port("runlamp", x, 4, "N")
    x += 8
    g.dust(x, 0, 4); g.rblock(x, 0, 5)             # постоянная единица
    m.port("one", x, 4, "N")
    return m


def mod_seq(a1=6, a2=6, a3=6, a4=10, nw=4):
    """Секвенсор как жёсткий макрос: внутренние цепи проложены; внешние порты на границах."""
    from .glr import GlobalRouter
    c = Core()
    info = SEQ.build_seq(c, 8, 8, nw=nw, a1=a1, a2=a2, a3=a3, a4=a4)
    bb = info["bbox"]
    x_out = ((bb[2] // 2) + 6) * 2
    outs = {}
    for k, (net, port) in enumerate((("p1", None), ("p2", None), ("p3", None), ("rst", None), ("run", None))):
        z = 8 + 4 * k
        c.ext(f"o_{net}", x_out, z, "W")
    # внешние входы: пины на западной границе макроса, внутренние цепи до ctl
    for k, n in enumerate(("bStart", "bStop", "bStep", "bRst", "hlt")):
        c.ext(f"i_{n}", 2, 8 + 4 * k, "E")
        c.net(f"seq.in_{n}", ("ext", f"i_{n}"), [("seq.ctl", n)])
    # внешние выходы как дополнительные стоки
    def add_sink(net_name, pin):
        for i, (n, s, sk) in enumerate(c.nets):
            if n == net_name:
                c.nets[i] = (n, s, sk + [c.ports[("ext", pin)]])
                return
        raise KeyError(net_name)
    add_sink("seq.p1", "o_p1"); add_sink("seq.p2", "o_p2"); add_sink("seq.p3", "o_p3"); add_sink("seq.run", "o_run")
    c.net("seq.rstn", ("seq.ctl", "rstl"), [("ext", "o_rst")], weak=True)
    H = ((bb[3] + 8) // 2 + 2) * 2
    gr = GlobalRouter(c.g, 2, 0, x_out, H)          # домен ровно между внешними пинами: вне его соседних улиц нет
    gr.mark_obstacles()
    gr.weak = set(c.weak)
    for name, src, sinks in c.nets:
        gr.add_net(name, src, sinks)
    if not gr.route(iters=60, verbose=False):
        raise RuntimeError("секвенсор: маршрутизация не удалась")
    gr.emit()
    m = Mod("seq")
    m.g = c.g
    for n in ("bStart", "bStop", "bStep", "bRst", "hlt"):
        x, z, d = c.ports[("ext", f"i_{n}")]
        m.port(n, x, z, "W")
    for n in ("p1", "p2", "p3", "rst", "run"):
        x, z, d = c.ports[("ext", f"o_{n}")]
        m.port(n, x, z, "E")
    for n in ("run", "rst"):
        m.weak.add(n)
    m.timing = info["ticks"]
    return m


def place(core, mod, ox, oz, name=None):
    """вставить модуль в Core со смещением; порты -> (имя_модуля, порт)"""
    name = name or mod.name
    assert ox % 2 == 0 and oz % 2 == 0, "смещение модуля должно быть чётным"
    for (x, y, z), b in mod.g.b.items():
        core.g.b[(x + ox, y, z + oz)] = Block(b.name, b.props)
    for pn, (x, z, d) in mod.ports.items():
        core.port(name, pn, x + ox, z + oz, d)
        if pn in mod.weak:
            core.weak_ports.add((name, pn))
    b = mod.bbox()
    core.mod_bbox[name] = (b[0] + ox, b[1] + oz, b[2] + ox, b[3] + oz)


PULSE_SPEC = (["p1", "p2", "p3", "wr", "setf", "isout", "isplot", "ishlt", "rst"],
              {"pNPC": [[("p1", 1)]], "pRES": [[("p1", 1)]],
               "pFLG": [[("p1", 1), ("setf", 1), ("rst", 0)]],
               "pWR": [[("p2", 1), ("wr", 1), ("rst", 0)]],
               "pOUT": [[("p2", 1), ("isout", 1), ("rst", 0)]],
               "pPLOT": [[("p2", 1), ("isplot", 1), ("rst", 0)]],
               "pHLT": [[("p2", 1), ("ishlt", 1), ("rst", 0)]],
               "pPC": [[("p3", 1)]]})


def make_modules(words, seq_params=None):
    """все модули (кроме повторяющихся экземпляров) -> dict имя -> Mod"""
    mods = {}
    mods["control"] = mod_control()
    mods["selA"] = _pla_mod("selA", C.seldec_spec("ra"))
    mods["selB"] = _pla_mod("selB", C.seldec_spec("rb"))
    mods["wrdec"] = _pla_mod("wrdec", C.seldec_spec("rd"))
    mods["imm"] = _pla_mod("imm", C.imm_spec())
    mods["jump"] = _pla_mod("jump", C.jump_spec())
    mods["pulse"] = _pla_mod("pulse", PULSE_SPEC)
    mods["flags"] = _pla_mod("flags", C.flags_spec())
    mods["pc"] = _pla_mod("pc", C.pc_spec(9))
    mods["regA"] = mod_regfile("regA"); mods["regB"] = mod_regfile("regB")
    mods["alu"] = mod_alu()
    for n, k in (("NPC", 9), ("PCL", 9), ("RES", 8), ("FLG", 2)):
        mods[n] = mod_latch(n, k)
    mods["hex7"] = _pla_mod("hex7", hex7_spec())
    mods["digsel"] = _pla_mod("digsel", digsel_spec())
    for k in range(3):
        mods[f"DIG{k}"] = mod_latch(f"DIG{k}", 8)
        mods[f"dgt{k}"] = mod_digit()
    mods["coldec"] = _pla_mod("coldec", decoder_spec("c"))
    mods["rowdec"] = _pla_mod("rowdec", decoder_spec("r", 5, "pplot"))
    mods["pixels"] = mod_pixels()
    mods["panel"] = mod_panel()
    mods["rom"] = mod_rom(words)
    mods["seq"] = mod_seq(**(seq_params or {}))
    return mods


SEG = "abcdefg"


def system_nets():
    """полный список цепей: (имя, (мод, порт), [(мод, порт)...])"""
    nets = []
    N = lambda name, src, sinks: nets.append((name, src, list(sinks)))
    # --- шина команды IR (выходы ПЗУ)
    for k in range(16):
        s = []
        if 12 <= k <= 15: s.append(("control", f"op{k-12}"))
        if k == 0: s.append(("control", "i0"))
        if 6 <= k <= 8: s.append(("selA", f"ra{k-6}"))
        if 3 <= k <= 5: s.append(("selB", f"rb{k-3}"))
        if 9 <= k <= 11:
            s += [("wrdec", f"rd{k-9}"), ("jump", f"c{k-9}"), ("digsel", f"rd{k-9}")]
        if k <= 7: s.append(("imm", f"I{k}"))
        if k <= 8: s.append(("pc", f"a{k}"))
        N(f"I{k}", ("rom", f"rom.I{k}"), s)
    # --- управление -> АЛУ и прочее
    for n in ("sub", "nsub", "nfS", "nfAND", "nfOR", "nfXOR", "nfSHR", "nfIN"):
        s = [("alu", f"{n}{k}") for k in range(8)]
        if n == "sub": s.append(("jump", "sub"))
        N(n, ("control", n), s)
    for n in ("isimm", "isldi", "isaddi"):
        N(n, ("control", n), [("imm", n)])
    N("enA", ("control", "enA"), [("selA", "en")])
    N("enB", ("control", "enB"), [("selB", "en")])
    N("wr", ("control", "wr"), [("pulse", "wr")])
    N("setf", ("control", "setf"), [("pulse", "setf")])
    N("isadc", ("control", "isadc"), [("jump", "isadc")])
    N("isjmp", ("control", "isjmp"), [("jump", "isjmp")])
    N("isjcc", ("control", "isjcc"), [("jump", "isjcc")])
    N("isout", ("control", "isout"), [("pulse", "isout")])
    N("isplot", ("control", "isplot"), [("pulse", "isplot")])
    N("ishlt", ("control", "ishlt"), [("pulse", "ishlt")])
    N("fS", ("control", "fS"), [("flags", "fS")])
    N("fSHR", ("control", "fSHR"), [("flags", "fSHR")])
    # --- секвенсор и импульсы
    for n in ("p1", "p2", "p3", "rst"):
        N(n, ("seq", n), [("pulse", n)])
    N("pNPC", ("pulse", "pNPC"), [("NPC", "bus")])
    N("pRES", ("pulse", "pRES"), [("RES", "bus")])
    N("pFLG", ("pulse", "pFLG"), [("FLG", "bus")])
    N("pPC", ("pulse", "pPC"), [("PCL", "bus")])
    N("pWR", ("pulse", "pWR"), [("wrdec", "en")])
    N("pOUT", ("pulse", "pOUT"), [("digsel", "pOUT")])
    N("pPLOT", ("pulse", "pPLOT"), [("rowdec", "pplot")])
    N("pHLT", ("pulse", "pHLT"), [("seq", "hlt")])
    for n in ("bStart", "bStop", "bStep", "bRst"):
        N(n, ("panel", n), [("seq", n)])
    N("run", ("seq", "run"), [("panel", "runlamp")])
    # --- регистры
    for r in range(8):
        N(f"sA{r}", ("selA", f"s{r}"), [("regA", f"sel{r}")])
        N(f"sB{r}", ("selB", f"s{r}"), [("regB", f"sel{r}")])
        N(f"wr{r}", ("wrdec", f"s{r}"), [("regA", f"wr{r}"), ("regB", f"wr{r}")])
    for k in range(8):
        sa = [("alu", f"a{k}")]
        if k == 0: sa.append(("flags", "a0"))
        if k < 4: sa.append(("hex7", f"h{k}"))
        if k < 5: sa.append(("coldec", f"c{k}"))
        if k == 7: sa += [(f"DIG{d}", "d7") for d in range(3)]
        N(f"RA{k}", ("regA", f"R{k}"), sa)
        sb = [("alu", f"b{k}")]
        if k < 5: sb.append(("rowdec", f"r{k}"))
        N(f"RB{k}", ("regB", f"R{k}"), sb)
        N(f"m{k}", ("imm", f"m{k}"), [("alu", f"m{k}")])
        N(f"r{k}", ("alu", f"r{k}"), [("RES", f"d{k}"), ("flags", f"r{k}")])
        N(f"Q{k}", ("RES", f"q{k}"), [("regA", f"W{k}"), ("regB", f"W{k}")])
    for i in range(4):
        N(f"lev{i}", ("panel", f"lev{i}"), [("alu", f"i{i}")])
    N("cout7", ("alu", "cout7"), [("flags", "cout7")])
    N("one", ("panel", "one"), [("alu", "na_next7")])
    N("cin", ("jump", "cin"), [("alu", "c0")])
    N("Znew", ("flags", "Znew"), [("FLG", "d0")])
    N("Cnew", ("flags", "Cnew"), [("FLG", "d1")])
    N("Zq", ("FLG", "q0"), [("jump", "Z")])
    N("Cq", ("FLG", "q1"), [("jump", "C")])
    # --- счётчик команд
    N("take", ("jump", "take"), [("pc", "take")])
    for k in range(9):
        N(f"n{k}", ("pc", f"n{k}"), [("NPC", f"d{k}")])
        N(f"nq{k}", ("NPC", f"q{k}"), [("PCL", f"d{k}")])
        N(f"pcq{k}", ("PCL", f"q{k}"), [("pc", f"pc{k}")] + [("rom", f"rom.c{b}.a{k}") for b in range(4)])
    # --- цифры
    for s, nm in enumerate(SEG):
        N(f"seg{nm}", ("hex7", nm), [(f"DIG{d}", f"d{s}") for d in range(3)])
    for d in range(3):
        N(f"pD{d}", ("digsel", f"pD{d}"), [(f"DIG{d}", "bus")])
        for i, nm in enumerate(SEG + "p"):
            pin = nm if nm != "p" else "dp"
            N(f"dg{d}{nm}", (f"DIG{d}", f"q{i}"), [(f"dgt{d}", pin)])
    # --- дисплей
    for v in range(32):
        N(f"col{v}", ("coldec", f"s{v}"), [("pixels", f"col{v}")])
        N(f"row{v}", ("rowdec", f"s{v}"), [("pixels", f"row{v}")])
    return nets


FRONT = [("dgt0", 12, 0), ("dgt1", 40, 0), ("dgt2", 68, 0), ("pixels", 0, 30), ("panel", 30, 30 + 132 + 18)]


def route_system(core, margin=8, iters=80, verbose=True, tag=""):
    from .glr import GlobalRouter
    lo, hi = core.g.bbox()
    x1 = ((hi[0] + margin) // 2 + 1) * 2
    z1 = ((hi[2] + margin) // 2 + 1) * 2
    gr = GlobalRouter(core.g, 0, 0, x1, z1)
    gr.mark_obstacles()
    gr.weak = set(core.weak)
    for name, src, sinks in core.nets:
        gr.add_net(name, src, sinks)
    ok = gr.route(iters=iters, verbose=verbose)
    return gr, ok


def build_system(words, halo=24, seed=1, iters=20000, verbose=True, seq_params=None, plan=None, pin_k=1.0):
    from .floorplan import make_units, anneal
    mods = make_modules(words, seq_params)
    # жёсткий блок переднего плана: цифры над дисплеем, пульт под ним
    groups = {"front": FRONT}
    nets = system_nets()
    if plan is None:
        units = make_units(mods, groups)
        plan = anneal(units, mods, nets, halo=halo, iters=iters, seed=seed, verbose=verbose, pin_k=pin_k)
    # нормализация: минимум >= 4, чётность
    mx = min(plan[m][0] + mods[m].bbox()[0] for m in plan)
    mz = min(plan[m][1] + mods[m].bbox()[1] for m in plan)
    sx, sz = 2 * ((4 - mx + 1) // 2), 2 * ((4 - mz + 1) // 2)
    plan = {m: (x + sx, z + sz) for m, (x, z) in plan.items()}
    core = Core()
    for m, (x, z) in plan.items():
        place(core, mods[m], x, z, name=m)
    for name, src, sinks in nets:
        core.net(name, src, sinks, weak=(src in core.weak_ports))
    return core, plan, mods


DIRV2 = {"E": (1, 0), "W": (-1, 0), "S": (0, 1), "N": (0, -1)}


def check_pins(core, gr):
    """доступность пинов: соседний узел в разрешённую сторону и клетка улицы должны быть свободны"""
    blk = gr.R.blk
    occ = {}
    for (x, y, z) in core.g.b:
        if y >= 0:
            occ[(x, z)] = 1
    bad = []
    owner = {}
    for (mn, pn), (x, z, d) in core.ports.items():
        owner[(x, z)] = (mn, pn)
    for name, src, sinks in core.nets:
        for (x, z, d) in [src] + sinks:
            dx, dz = DIRV2[d]
            nx, nz = x + 2 * dx, z + 2 * dz
            i, j = gr.node_of(nx, nz)
            sx, sz = x + dx, z + dz
            reasons = []
            if not (0 <= i < gr.ni and 0 <= j < gr.nj):
                reasons.append("вне решётки")
            elif (i, j) in blk and (i, j) not in gr.R.pin_nodes:
                reasons.append("узел заблокирован")
            if (sx, sz) in occ:
                reasons.append("клетка улицы занята")
            if reasons:
                bad.append((name, owner.get((x, z)), (x, z, d), reasons))
    return bad
