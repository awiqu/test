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
    for x in range(xd + 2, sel_x - 1):
        g.dust(x, 0, zd + 2)
    g.repeater(xd + 1, 0, zd + 2, "west")        # регенератор: боковой вход компаратора обязан быть ровно 15
    g.dust(xd, 0, zd + 3)                        # отвод к R
    return dict(W=zw, R=zw + 6)


def latch_row(g: Grid, ox, oz, n, pitch=4, mat="stone"):
    """Ряд из n защёлок (D-повторитель + замок). Шина записи (активный высокий импульс) идёт на y=2 вдоль X на z=oz.
    Бит i: x = ox + pitch*i. Данные подаются сверху на (x,0,oz-1); выход Q — снизу (x,0,oz+2).
    Шина записи подаётся в порт (ox-4, 0, oz) слева (пыль на y=0, рампа вверх).
    Возвращает dict портов."""
    x_first = ox - 2
    x_last = ox + pitch * (n - 1) + 1
    # шина: стена y=1 + пыль y=2
    for x in range(x_first, x_last + 1):
        g.solid(x, 1, oz, mat)
        g.dust(x, 2, oz)
    # рампа подачи шины слева: (ox-6,0)->(ox-5,1)->(ox-4,2)  [порт (ox-6,0,oz)]
    g.repeater(ox - 6, 0, oz, "east")                      # регенератор на входе: слабый сигнал не дойдёт по рампе
    g.solid(ox - 5, 0, oz, mat); g.dust(ox - 5, 1, oz)
    g.solid(ox - 4, 1, oz, mat); g.dust(ox - 4, 2, oz)
    for x in range(ox - 3, x_first):
        g.solid(x, 1, oz, mat); g.dust(x, 2, oz)
    ports = {"bus": (ox - 6, 0, oz), "d": [], "q": []}
    for i in range(1, n, 2):                               # регенерация шины каждые 2 бита
        g.repeater(ox + pitch * i + 1, 2, oz, "east")
    for i in range(n):
        x = ox + pitch * i
        g.dust(x, 0, oz)                                  # данные (под шиной)
        g.repeater(x, 0, oz + 1, "south")                 # D
        g.repeater(x - 1, 0, oz + 1, "east")              # замок L
        g.wall_torch(x - 2, 1, oz + 1, "south")           # переход: факел на южной грани стены (x-2,1,oz)
        g.dust(x - 2, 0, oz + 1)                          # ~шина под факелом -> вход L
        g.dust(x, 0, oz + 2)                              # Q
        g.dust(x, 0, oz - 1); g.dust(x, 0, oz - 2)
        ports["d"].append((x, 0, oz - 2))
        ports["q"].append((x, 0, oz + 2))
    return ports
