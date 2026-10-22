"""Сборка ядра RC-8: ПЛМ управления, регистры, АЛУ, защёлки — всё на одном плане + глобальная трассировка."""
import os, pickle, time
from .grid import Grid
from . import ctlmods as C
from .control import build_control
from .regfile import regfile
from .alu_slice import make_slice, slice_pins, LEFT
from .cells import latch_row
from .glr import GlobalRouter

CACHE = os.path.join(os.path.dirname(__file__), "..", "build", "cache")
SL_NI, SL_NJ = 24, 18
SL_H = 2 * SL_NJ            # высота среза в блоках


def alu_slice_grid():
    """сетка одного среза АЛУ (кэшируется)"""
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, f"alu_slice_{SL_NI}x{SL_NJ}.pkl")
    if os.path.exists(f):
        return pickle.load(open(f, "rb"))
    d, R, ext = make_slice(SL_NI, SL_NJ, seeds=range(8), verbose=True)
    if R is None:
        raise RuntimeError("не удалось разместить срез АЛУ")
    g = Grid(); R.emit(g)
    data = {"blocks": {p: (b.name, dict(b.props)) for p, b in g.b.items()}, "ext": ext}
    pickle.dump(data, open(f, "wb"))
    return data


class Core:
    def __init__(self):
        self.g = Grid()
        self.ports = {}          # (module, port) -> (x, z, dir)
        self.nets = []           # (name, src, [sinks])
        self.floor_y = -1
        self.port_y = {}         # (модуль, порт) -> высота пина (по умолчанию 0)
        self.net_y = {}          # цепь -> [высоты пинов: источник, стоки...]
        self.mod_floor = {}      # модуль -> высота этажа (y)
        self.weak_ports = set()   # (модуль, порт) со слабым источником
        self.mod_bbox = {}
        self.weak = set()        # цепи со слабым источником (выход решёточного модуля): повторитель у источника

    # ---------- вспомогательное
    def port(self, mod, name, x, z, d):
        self.ports[(mod, name)] = (x, z, d)

    def pla(self, mod, spec, ox, oz):
        p = C.build(self.g, ox, oz, spec)
        self._pla_ports(mod, p)
        return p

    def _pla_ports(self, mod, p):
        for n, (x, y, z) in p.in_ports.items():
            self.port(mod, n, x, z, "N")
        for n, (x, y, z) in p.out_ports.items():
            self.port(mod, n, x, z, "S")

    def ext(self, name, x, z, d="S", sink=False):
        """внешний пин (одна клетка пыли) для подачи/съёма сигнала"""
        self.g.dust(x, 0, z)
        self.port("ext", name, x, z, d)

    def net(self, name, src, sinks, weak=False):
        if weak:
            self.weak.add(name)
        sp = self.ports[src] if isinstance(src, tuple) else src
        self.nets.append((name, sp, [self.ports[s] if isinstance(s, tuple) else s for s in sinks]))
        self.net_y[name] = [self.port_y.get(p, 0) if isinstance(p, tuple) else 0 for p in [src] + list(sinks)]


def build_core(core: Core, verbose=True):
    g = core.g
    P = core.ports
    # ---------- внешние пины: IR, импульсы, рычаги
    ir_x = {k: 10 + 8 * k for k in range(16)}
    for k in range(16):
        core.ext(f"I{k}", ir_x[k], 0, "S")
    for i, n in enumerate(("p1", "p2", "p3", "rst")):
        core.ext(n, 140 + 8 * i, 0, "S")
    for i in range(4):
        core.ext(f"lev{i}", 180 + 8 * i, 0, "S")
    core.ext("one", 212, 0, "S")          # постоянная единица (вход na_next старшего разряда)
    g.rblock(212, 0, -1)

    # ---------- строка ПЛМ управления
    OZ = 40
    ctl = build_control(g, 4, OZ)
    core._pla_ports("control", ctl)
    selA = core.pla("selA", C.seldec_spec("ra"), 100, OZ)
    selB = core.pla("selB", C.seldec_spec("rb"), 150, OZ)
    wrd = core.pla("wrdec", C.seldec_spec("rd"), 200, OZ)
    imm = core.pla("imm", C.imm_spec(), 250, OZ)
    jmp = core.pla("jump", C.jump_spec(), 310, OZ)
    pulse_spec = (["p1", "p2", "p3", "wr", "setf", "isout", "isplot", "ishlt", "rst"],
                  {"pNPC": [[("p1", 1)]], "pRES": [[("p1", 1)]],
                   "pFLG": [[("p1", 1), ("setf", 1), ("rst", 0)]],
                   "pWR": [[("p2", 1), ("wr", 1), ("rst", 0)]],
                   "pOUT": [[("p2", 1), ("isout", 1), ("rst", 0)]],
                   "pPLOT": [[("p2", 1), ("isplot", 1), ("rst", 0)]],
                   "pHLT": [[("p2", 1), ("ishlt", 1), ("rst", 0)]],
                   "pPC": [[("p3", 1)]]})
    pul = core.pla("pulse", pulse_spec, 360, OZ)
    flg = core.pla("flags", C.flags_spec(), 420, OZ)
    pcp = core.pla("pc", C.pc_spec(9), 470, 150)

    # ---------- регистры и АЛУ
    RA = regfile(g, 4, 150)
    RB = regfile(g, 4, 260)
    for tag, R_ in (("regA", RA), ("regB", RB)):
        for r in range(8):
            x, y, z = R_["sel"][r]; core.port(tag, f"sel{r}", x, z, "N")
            x, y, z = R_["wr"][r]; core.port(tag, f"wr{r}", x, z, "N")
        for k in range(8):
            x, y, z = R_["W_in"][k]; core.port(tag, f"W{k}", x, z, "E")
            x, y, z = R_["R_out"][k]; core.port(tag, f"R{k}", x, z, "E")
    sl = alu_slice_grid()
    AX, AZ = 220, 150
    for k in range(8):
        oz = AZ + SL_H * k
        for p, (n, props) in sl["blocks"].items():
            from .grid import Block
            g.b[(p[0] + AX, p[1], p[2] + oz)] = Block(n, props)
        ext = slice_pins(SL_NI, SL_NJ)
        for n in LEFT:
            (i, j, l) = ext[n][0]
            core.port(f"alu{k}", n, AX + 2 * i, oz + 2 * j, "W")
        for n, d in (("r", "E"), ("c", "N"), ("na", "N"), ("cout", "S"), ("na_next", "S")):
            (i, j, l) = ext[n][0]
            core.port(f"alu{k}", n, AX + 2 * i, oz + 2 * j, d)

    # ---------- защёлки
    NPC = latch_row(g, 480, 340, 9)
    PCL = latch_row(g, 480, 400, 9)
    RES = latch_row(g, 480, 470, 8)
    FLG = latch_row(g, 480, 530, 2)
    for tag, Lr, n in (("NPC", NPC, 9), ("PCL", PCL, 9), ("RES", RES, 8), ("FLG", FLG, 2)):
        x, y, z = Lr["bus"]; core.port(tag, "bus", x, z, "W")
        for i in range(n):
            x, y, z = Lr["d"][i]; core.port(tag, f"d{i}", x, z, "N")
            x, y, z = Lr["q"][i]; core.port(tag, f"q{i}", x, z, "S")

    # ---------- цепи
    N = core.net
    # IR
    for b in range(4):
        N(f"I{12+b}", ("ext", f"I{12+b}"), [("control", f"op{b}")])
    for b in range(3):
        N(f"I{6+b}", ("ext", f"I{6+b}"), [("selA", f"ra{b}")])
        N(f"I{3+b}", ("ext", f"I{3+b}"), [("selB", f"rb{b}")])
    # I9..11 -> wrdec rd0..2 и jump c0..2
    for b in range(3):
        N(f"I{9+b}", ("ext", f"I{9+b}"), [("wrdec", f"rd{b}"), ("jump", f"c{b}")])
    # I0..I7 -> imm; I0..I8 -> pc a0..a8 ; I0 -> control.i0 ; (I3..I8 уже в других списках — добавим imm/pc отдельными приёмниками)
    # объединяем все приёмники одной сети IRk
    sinks = {k: [] for k in range(16)}
    for b in range(4): sinks[12 + b].append(("control", f"op{b}"))
    for b in range(3):
        sinks[6 + b].append(("selA", f"ra{b}")); sinks[3 + b].append(("selB", f"rb{b}"))
        sinks[9 + b] += [("wrdec", f"rd{b}"), ("jump", f"c{b}")]
    sinks[0].append(("control", "i0"))
    for k in range(8): sinks[k].append(("imm", f"I{k}"))
    for k in range(9): sinks[k].append(("pc", f"a{k}"))
    core.nets = [n for n in core.nets if not n[0].startswith("I")]
    for k in range(16):
        if sinks[k]:
            N(f"I{k}", ("ext", f"I{k}"), sinks[k])
    # управление -> АЛУ
    for n in ("sub", "nsub", "nfS", "nfAND", "nfOR", "nfXOR", "nfSHR", "nfIN"):
        s = [(f"alu{k}", n) for k in range(8)]
        if n == "sub":
            s.append(("jump", "sub"))
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
    # импульсы
    N("p1", ("ext", "p1"), [("pulse", "p1")]); N("p2", ("ext", "p2"), [("pulse", "p2")])
    N("p3", ("ext", "p3"), [("pulse", "p3")]); N("rst", ("ext", "rst"), [("pulse", "rst")])
    N("pNPC", ("pulse", "pNPC"), [("NPC", "bus")])
    N("pRES", ("pulse", "pRES"), [("RES", "bus")])
    N("pFLG", ("pulse", "pFLG"), [("FLG", "bus")])
    N("pPC", ("pulse", "pPC"), [("PCL", "bus")])
    N("pWR", ("pulse", "pWR"), [("wrdec", "en")])
    # выбор/запись регистров
    for r in range(8):
        N(f"sA{r}", ("selA", f"s{r}"), [("regA", f"sel{r}")])
        N(f"sB{r}", ("selB", f"s{r}"), [("regB", f"sel{r}")])
        N(f"wr{r}", ("wrdec", f"s{r}"), [("regA", f"wr{r}"), ("regB", f"wr{r}")])
    # данные
    for k in range(8):
        sa = [(f"alu{k}", "a")]
        if k == 0:
            sa.append(("flags", "a0"))
        N(f"RA{k}", ("regA", f"R{k}"), sa)
        N(f"RB{k}", ("regB", f"R{k}"), [(f"alu{k}", "b")])
        N(f"m{k}", ("imm", f"m{k}"), [(f"alu{k}", "m")])
        N(f"r{k}", (f"alu{k}", "r"), [("RES", f"d{k}"), ("flags", f"r{k}")])
        N(f"Q{k}", ("RES", f"q{k}"), [("regA", f"W{k}"), ("regB", f"W{k}")])
    for k in range(4):
        N(f"lev{k}", ("ext", f"lev{k}"), [(f"alu{k}", "i")])
    for k in range(7):
        N(f"cout{k}", (f"alu{k}", "cout"), [(f"alu{k+1}", "c")])
        N(f"na{k+1}", (f"alu{k+1}", "na"), [(f"alu{k}", "na_next")])
    N("cout7", ("alu7", "cout"), [("flags", "cout7")])
    N("one", ("ext", "one"), [("alu7", "na_next")])
    N("cin", ("jump", "cin"), [("alu0", "c")])
    # флаги
    N("Znew", ("flags", "Znew"), [("FLG", "d0")])
    N("Cnew", ("flags", "Cnew"), [("FLG", "d1")])
    N("Zq", ("FLG", "q0"), [("jump", "Z")])
    N("Cq", ("FLG", "q1"), [("jump", "C")])
    # PC
    N("take", ("jump", "take"), [("pc", "take")])
    for k in range(9):
        N(f"n{k}", ("pc", f"n{k}"), [("NPC", f"d{k}")])
        N(f"nq{k}", ("NPC", f"q{k}"), [("PCL", f"d{k}")])
        N(f"pcq{k}", ("PCL", f"q{k}"), [("pc", f"pc{k}")])
    return core
