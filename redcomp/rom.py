"""ПЗУ 512x16: 4 банка по 128 слов (ПЛМ с фиксированной A-плоскостью, данные — факелы в B-плоскости)
+ коллектор, объединяющий банки в 16 выходных линий (биты команды)."""
from .grid import Grid, Block
from .pla import PLA

BANKS = 4
WORDS_PER_BANK = 512 // BANKS
ADDR = [f"a{i}" for i in range(9)]


def bank_terms(bank):
    """термы A-плоскости банка: слово r (0..127) -> И девяти литералов адреса"""
    bb = [(bank >> 0) & 1, (bank >> 1) & 1]           # a7, a8
    nlow = WORDS_PER_BANK.bit_length() - 1             # 7
    terms = []
    for r in range(WORDS_PER_BANK):
        t = [(f"a{i}", (r >> i) & 1) for i in range(nlow)] + [("a7", bb[0]), ("a8", bb[1])]
        terms.append(t)
    return terms


def word_sites(words, bank):
    """множество (бит, терм) факелов B-плоскости банка для списка слов (длина до 512)"""
    s = set()
    for r in range(WORDS_PER_BANK):
        w = words[bank * WORDS_PER_BANK + r] if bank * WORDS_PER_BANK + r < len(words) else 0
        for k in range(16):
            if (w >> k) & 1:
                s.add((k, r))
    return s


def build_rom(core, ox, oz, words, mod="rom", gap=6):
    """Разместить ПЗУ в Core. Порты: (mod.c{b}, 'a{i}') входы адреса (N), (mod, 'I{k}') выходы (E).
    Возвращает dict с геометрией и данными для генератора программ."""
    g = core.g
    outs = [f"b{k}" for k in range(16)]
    chunks = []
    x = ox
    for b in range(BANKS):
        terms = bank_terms(b)
        sites = word_sites(words, b)
        outputs = {f"b{k}": [terms[r] for (kk, r) in sorted(sites) if kk == k] for k in range(16)}
        p = PLA(g, x, oz, ADDR, outputs, fixed_terms=terms)
        core._pla_ports(f"{mod}.c{b}", p)
        chunks.append(p)
        x = p.x_endB + gap + 4
        x += x % 2
    zB = chunks[0].z_endB
    # --- коллектор: строка k на y=2, z_k = zB + 6 + 2k
    z_row0 = zB + 6
    x_lo = min(min(p.out_ports[o][0] for o in outs) for p in chunks)
    x_hi = max(max(p.out_ports[o][0] for o in outs) for p in chunks)
    ports = {}
    for k in range(16):
        zk = z_row0 + 4 * k
        for p in chunks:
            xc, _, zc = p.out_ports[f"b{k}"]
            for z in range(zc + 1, zk - 1):                 # спуск по y=0
                g.dust(xc, 0, z)
            # рампа вверх по Z: (xc,0,zk-2) -> (xc,1,zk-1) -> (xc,2,zk)
            g.dust(xc, 0, zk - 2)
            g.solid(xc, 0, zk - 1); g.dust(xc, 1, zk - 1)
            g.solid(xc, 1, zk); g.dust(xc, 2, zk)
        for xx in range(x_lo, x_hi + 3):
            g.solid(xx, 1, zk); g.dust(xx, 2, zk)
        # повторители строки каждые 11 клеток (вправо), не в точках рамп
        ramp_x = {p.out_ports[f"b{k}"][0] for p in chunks}
        n = 0
        for xx in range(x_lo, x_hi + 3):
            n += 1
            if n >= 11 and all(abs(xx - rx) > 1 for rx in ramp_x):
                g.repeater(xx, 2, zk, "east"); n = 0
        # спуск вниз на y=0 справа: (xe,2) -> (xe+1,1) -> (xe+2,0)
        xe = x_hi + 2
        g.solid(xe + 1, 0, zk); g.dust(xe + 1, 1, zk)
        g.repeater(xe + 2, 0, zk, "east")           # источник на чётном узле: сильный выход линии IR
        ports[k] = (xe + 2, zk)
        core.port(mod, f"I{k}", xe + 2, zk, "E")
    # координаты для генератора программ (в системе сетки Core)
    geo = {"chunks": [{"xs": p.b_xs, "oz": p.b_oz, "outs": p.b_outs} for p in chunks], "ports": ports}
    return {"chunks": chunks, "geo": geo, "bbox": (ox, oz, x_hi + 8, z_row0 + 4 * 16 + 4)}


def program_tile(geo, words, bank):
    """Grid c факелами/воздухом на всех сайтах B-плоскости банка (для /place template)"""
    ch = geo["chunks"][bank]
    sites = word_sites(words, bank)
    g = Grid()
    for k, xk in enumerate(ch["xs"]):
        for r in range(WORDS_PER_BANK):
            z = ch["oz"] + 2 * r + 1
            if (k, r) in sites:
                g.wall_torch(xk, 1, z, "south")
            else:
                g.put(xk, 1, z, "air")
    return g
