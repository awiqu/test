"""ПЗУ 512x16 «башней»: NB банков ПЛМ (фиксированная A-плоскость + B-плоскость с данными), поставленных друг на друга
по высоте с шагом 4. Адрес (9 линий) поднимается факельными башнями (два НЕ на ярус — полярность сохраняется),
выходы банков собираются ИЛИ-башнями (повторитель -> блок -> факел -> блок -> факел).

Занимает ~ (72 x 154) клетки в плане и 4*NB блоков по высоте вместо 305 x 331 у плоской версии."""
from .grid import Grid, Block
from .pla import PLA

NB = 8
WPB = 512 // NB
PITCH = 4
ADDR = [f"a{i}" for i in range(9)]
LOWB = WPB.bit_length() - 1


def bank_terms(b, nb=NB):
    """слово r (0..WPB-1) банка b -> И девяти литералов адреса: младшие биты — номер слова, старшие — номер банка"""
    bb = nb.bit_length() - 1
    terms = []
    for r in range(WPB):
        t = [(f"a{i}", (r >> i) & 1) for i in range(LOWB)] + [(f"a{LOWB + i}", (b >> i) & 1) for i in range(bb)]
        terms.append(t)
    return terms


def word_sites(words, bank):
    s = set()
    for r in range(WPB):
        i = bank * WPB + r
        w = words[i] if i < len(words) else 0
        for k in range(16):
            if (w >> k) & 1:
                s.add((k, r))
    return s


def _tower_stage(g, x, y, z, mat="stone"):
    """ярус башни: блок P (y), факел (y+1), блок Q (y+2), факел (y+3); следующий блок P — над верхним факелом"""
    g.solid(x, y, z, mat)
    g.torch(x, y + 1, z)
    g.solid(x, y + 2, z, mat)
    g.torch(x, y + 3, z)


def build_rom3d(words, ox=8, oz=24, nb=NB, mat="stone"):
    """возвращает dict: grid, ports {имя: (x, z, dir)}, pin_y {имя: y}, geo (для прошивки), bbox"""
    g = Grid()
    banks = []
    for b in range(nb):
        sub = Grid()
        terms = bank_terms(b, nb)
        sites = word_sites(words, b)
        outputs = {f"b{k}": [terms[r] for (kk, r) in sorted(sites) if kk == k] for k in range(16)}
        p = PLA(sub, ox, oz, ADDR, outputs, fixed_terms=terms)
        banks.append(p)
        for pos, blk in sub.b.items():
            g.b[(pos[0], pos[1] + PITCH * b, pos[2])] = blk
    p0 = banks[0]
    z_in = oz - 8
    in_x = {n: p0.in_ports[n][0] for n in ADDR}
    xs = p0.b_xs
    z_end = p0.z_endB
    x_lo, x_hi = ox - 2, p0.x_endB + 2
    top = PITCH * nb
    # ---- опорный пол яруса b>=1 только под пылью/повторителями/компараторами уровня 0 банка (остальным опора не нужна)
    tower_cols = {(in_x[n], z_in - 2) for n in ADDR} | {(xs[k], z_end + 3) for k in range(16)}
    need = set()
    for bk in banks:                                      # входные цепи a6..a8 различаются по банкам: берём объединение
        for pos, blk in bk.g.b.items():
            if pos[1] == 0 and blk.name in ("redstone_wire", "repeater", "comparator"):
                need.add((pos[0], pos[2]))
    for k in range(16):                                   # отводы выходов: пыль и повторитель после банка
        need.add((xs[k], z_end + 1)); need.add((xs[k], z_end + 2))
    for n in ADDR:
        need.add((in_x[n], z_in - 1))
    for b in range(1, nb):
        y = PITCH * b - 1
        for (x, z) in need:
            if (x, z) not in tower_cols:
                g.solid(x, y, z, mat)
    # ---- башни адреса: вход снизу (на уровне банка 0): пыль -> повторитель -> блок P0 (сильно запитан)
    ports, pin_y = {}, {}
    for n in ADDR:
        x = in_x[n]
        zt = z_in - 2
        for z in range(z_in - 6, z_in - 3):
            g.dust(x, 0, z)
        g.repeater(x, 0, z_in - 3, "south")
        for b in range(nb):
            y = PITCH * b
            _tower_stage(g, x, y, zt, mat)
            g.dust(x, y, z_in - 1)                    # отвод к входу банка (сосед блока P — сильно запитанного)
        ports[n] = (x, z_in - 6, "N")
        pin_y[n] = 0
    # ---- башни выходов: выход банка -> пыль -> повторитель (развязка) -> блок P яруса
    zo = z_end + 3
    for k in range(16):
        x = xs[k]
        for b in range(nb):
            y = PITCH * b
            g.dust(x, y, z_end + 1)
            g.repeater(x, y, z_end + 2, "south")
            _tower_stage(g, x, y, zo, mat)
        g.solid(x, top, zo, mat)                      # верхний блок O: питается верхним факелом башни
        g.solid(x, top - 1, zo + 1, mat)
        g.dust(x, top, zo + 1)                        # выходная клетка ИЛИ всех банков
        ports[f"I{k}"] = (x, zo + 1, "S")
        pin_y[f"I{k}"] = top
    geo = {"banks": [{"xs": p.b_xs, "oz": p.b_oz, "dy": PITCH * b} for b, p in enumerate(banks)]}
    xs_all = [pos[0] for pos in g.b]; zs_all = [pos[2] for pos in g.b]
    return {"g": g, "ports": ports, "pin_y": pin_y, "geo": geo, "bbox": (min(xs_all), min(zs_all), max(xs_all), max(zs_all)),
            "height": top + 2}


def program_tile(geo, words):
    """Grid с факелами/воздухом на всех сайтах B-плоскостей (для /place template): прошивка ПЗУ"""
    g = Grid()
    for b, bk in enumerate(geo["banks"]):
        sites = word_sites(words, b)
        for k, xk in enumerate(bk["xs"]):
            for r in range(WPB):
                z = bk["oz"] + 2 * r + 1
                if (k, r) in sites:
                    g.wall_torch(xk, 1 + bk["dy"], z, "south")
                else:
                    g.put(xk, 1 + bk["dy"], z, "air")
    return g
