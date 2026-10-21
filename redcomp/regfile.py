"""Регистровый файл 8x8 (один порт чтения): защёлки на повторителях с блокировкой."""
from .grid import Grid
from .cells import regbit

def _line_with_reps(g, cells, flow, avoid, every=11):
    n = 0
    last = len(cells) - 1
    for k, (x, y, z) in enumerate(cells):
        n += 1
        if n >= every and (x, z) not in avoid and k != last and k != 0:
            g.repeater(x, y, z, flow); n = 0
        else:
            g.dust(x, y, z)

def regfile(g: Grid, ox, oz, nreg=8, nbit=8, px=10, pz=8, mat="stone"):
    """oz: z входа линий (порты на (x,0,oz)). Возвращает dict портов.
    sel[r], wr[r]: (x,0,oz) — пыль на y=0, принимает сигнал сверху (будет рампа вверх).
    W_in[i]: (x_east, 0, zw_i)  вход данных (с востока, течёт на запад)
    R_out[i]: (x_east, 0, zw_i+6) выход чтения (течёт на восток)"""
    zl0 = oz + 3                      # начало вертикальных линий (стена+пыль)
    zw0 = zl0 + 1                     # первая строка W
    z_bot = zw0 + nbit * pz - 1
    ports = {"sel": {}, "wr": {}, "W_in": {}, "R_out": {}}
    tap_x = set()
    for r in range(nreg):
        xd = ox + r * px + 4
        tap_x.add(xd)
        wr_x, sel_x = ox + r * px, ox + r * px + 8
        for x, name in ((wr_x, "wr"), (sel_x, "sel")):
            # порт и рампа
            g.dust(x, 0, oz)
            g.dust(x, 0, oz + 1)
            g.solid(x, 0, oz + 2, mat); g.dust(x, 1, oz + 2)
            # линия y=2
            n = 0
            for z in range(zl0, z_bot + 1):
                g.solid(x, 1, z, mat)
                n += 1
                hop_rows = [zw0 + i * pz + 2 + (0 if name == "wr" else 2) for i in range(nbit)]
                if n >= 11 and z not in hop_rows and (z - zw0) % pz in (0, 1, 5, 6, 7):
                    g.repeater(x, 2, z, "south"); n = 0
                else:
                    g.dust(x, 2, z)
            ports[name][r] = (x, 0, oz)
    for r in range(nreg):
        xd = ox + r * px + 4
        wr_x, sel_x = ox + r * px, ox + r * px + 8
        for i in range(nbit):
            zw = zw0 + i * pz
            regbit(g, xd, zw, wr_x, sel_x, mat)
    x_lo = ox - 2
    x_hi = ox + nreg * px + 2
    for i in range(nbit):
        zw = zw0 + i * pz
        # W: течёт на запад: источник на востоке (x_hi), стоки — отводы D
        cells = [(x, 0, zw) for x in range(x_hi, x_lo - 1, -1)]
        _line_with_reps(g, cells, "west", {(xx, zw) for xx in tap_x})
        # отвод к D — уже поставлен regbit (dust (xd,0,zw+1))
        ports["W_in"][i] = (x_hi, 0, zw)
        # R: течёт на восток
        zr = zw + 6
        cells = [(x, 0, zr) for x in range(x_lo, x_hi + 1)]
        _line_with_reps(g, cells, "east", {(xx, zr) for xx in tap_x})
        ports["R_out"][i] = (x_hi, 0, zr)
    ports["bbox"] = (ox - 2, oz, x_hi, z_bot + 7)
    ports["zw0"] = zw0
    return ports
