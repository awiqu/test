"""Проверенные на живом сервере ячейки. Координаты: y=0 — слой земли (пол на y=-1)."""
from .grid import Grid

def crossbar(g: Grid, ox, oz, col_x, row_z, sites, z_lo=None, z_hi=None, x_lo=None, x_hi=None,
             mat="stone"):
    """Плоскость из факельных ячеек.
    Столбцы (входы): пыль на y=2 вдоль Z, под ней стена y=1.
    Строки (выходы): пыль на y=0 вдоль X.
    Ячейка (r,c) = настенный факел на восточной грани стены столбца: строка = ИЛИ НЕ(столбец) по ячейкам.
    col_x: список x столбцов; row_z: список z строк; sites: множество (r, c) где стоит факел.
    """
    z_lo = min(row_z) if z_lo is None else z_lo
    z_hi = max(row_z) if z_hi is None else z_hi
    x_lo = min(col_x) if x_lo is None else x_lo
    x_hi = max(col_x) + 1 if x_hi is None else x_hi
    for c, x in enumerate(col_x):
        for z in range(z_lo, z_hi + 1):
            g.solid(x, 1, z, mat)
            g.dust(x, 2, z)
    for r, z in enumerate(row_z):
        for x in range(x_lo, x_hi + 1):
            g.dust(x, 0, z)
    for (r, c) in sites:
        x, z = col_x[c], row_z[r]
        g.wall_torch(x + 1, 1, z, "east")


def hop_down(g: Grid, xv, z, torch_dx, mat="stone"):
    """Вертикальная линия (верхний слой y=2, стена y=1) -> инвертированный сигнал в нижний слой.
    Факел на боковой грани стены; пыль под факелом получает ~линию. torch_dx=+1: факел восточнее стены."""
    xt = xv + torch_dx
    face = "east" if torch_dx > 0 else "west"
    g.wall_torch(xt, 1, z, face)
    g.dust(xt, 0, z)
    return (xt, 0, z)


def regbit(g: Grid, xd, zw, wr_x, sel_x, mat="stone"):
    """Один бит регистра. Строки (z): zw = канал W (запись, нижний слой), zw+1 = отвод к D,
    zw+2 = D (вход с севера) + замок L + цепочка ~wr, zw+3 = F, zw+4 = компаратор C + цепочка ~sel,
    zw+5 = отвод, zw+6 = канал R (чтение).  Высота тайла 8 (с зазором).
    wr_x: x вертикальной линии записи (слева), sel_x: x линии выбора (справа)."""
    zd = zw + 2
    g.dust(xd, 0, zw + 1)                        # отвод W -> D
    g.repeater(xd, 0, zd, "south")               # D: вход с севера
    g.repeater(xd - 1, 0, zd, "east")            # L: замок D с запада
    hop_down(g, wr_x, zd, +1)                    # ~wr на (wr_x+1, 0, zd)
    for x in range(wr_x + 2, xd - 1):
        g.dust(x, 0, zd)
    g.solid(xd, 0, zd + 1, mat)                  # F
    g.comparator(xd, 0, zd + 2, "south", mode="subtract")   # C: сзади F, сбоку ~sel
    hop_down(g, sel_x, zd + 2, -1)               # ~sel
    for x in range(xd + 1, sel_x - 1):
        g.dust(x, 0, zd + 2)
    g.dust(xd, 0, zd + 3)                        # отвод к R
    return dict(W=zw, R=zw + 6)
