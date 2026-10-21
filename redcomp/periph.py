"""Периферия: матрица пикселей на медных фонарях, 8-сегментные цифры на лампах."""
from .grid import Grid


def pixel_array(g: Grid, ox, oz, nx=32, ny=32, mat="stone", bulb="copper_bulb"):
    """Матрица nx x ny. Шаг 4x4. Пиксель (i,j) переключается (T-триггер медного фонаря), когда
    строка j высокая (импульс PLOT) И столбец i выбран (активный высокий уровень):
        компаратор-вычитатель: вход сзади = строка, боковой = НЕ(столбец) (настенный факел на стенке столбца).
    ox нечётное, oz чётное (пины на чётных узлах решётки).
    Возвращает dict: rows[j] = (x,0,z) пин строки (вход с запада), cols[i] = (x,0,z) пин столбца (вход с севера)."""
    assert ox % 2 == 1 and oz % 2 == 0
    rows, cols, bulbs = {}, {}, {}
    zr = lambda j: oz + 4 + 4 * j
    z_first, z_last = oz + 2, zr(ny - 1) + 3
    for i in range(nx):
        cx = ox + 4 * i
        xc = cx + 3
        # столбец: пин, рампа, линия y=2 над стенкой y=1
        g.dust(xc, 0, oz)
        g.solid(xc, 0, oz + 1, mat); g.dust(xc, 1, oz + 1)
        for z in range(oz + 2, z_last + 1):
            g.solid(xc, 1, z, mat)
            g.dust(xc, 2, z)
        for j in range(ny):
            z = zr(j) + 3
            if j % 3 == 2 and z <= z_last:
                g.repeater(xc, 2, z, "south")
        cols[i] = (xc, 0, oz)
    for j in range(ny):
        z = zr(j)
        # линия строки y=0 слева направо; повторитель у каждого пикселя (изоляция от боковой пыли)
        g.dust(ox - 1, 0, z)
        for i in range(nx):
            cx = ox + 4 * i
            g.dust(cx, 0, z); g.dust(cx + 1, 0, z)
            g.repeater(cx + 2, 0, z, "east")
            g.dust(cx + 3, 0, z)
            # пиксель
            g.comparator(cx + 1, 0, z + 1, "south", mode="subtract")
            g.put(cx + 1, 0, z + 2, bulb, lit="false", powered="false")
            g.dust(cx + 2, 0, z + 1)
            g.wall_torch(cx + 2, 1, z + 1, "west")
            bulbs[(i, j)] = (cx + 1, 0, z + 2)
        rows[j] = (ox - 1, 0, z)
    bbox = (ox - 1, oz, ox + 4 * nx, zr(ny - 1) + 3)
    return {"rows": rows, "cols": cols, "bulbs": bulbs, "bbox": bbox}


def digit(g: Grid, ox, oz, mat="stone"):
    """Одна 8-сегментная цифра из ламп. Пины сегментов a..g, dp (пыль y=0, чётные координаты).
    Лампы на y=0, питающая пыль сверху (y=1); подвод — камень+пыль у конца сегмента. Размер 15 x 13."""
    assert ox % 2 == 0 and oz % 2 == 0
    pins = {}

    def feed_w(xl, z, extra=0):
        """подвод слева к лампе в xl: [пин, (extra) пыль, пыль] -> камень (xl-1) + пыль сверху"""
        for k in range(2 + extra):
            g.dust(ox + xl - 3 - extra + k, 0, oz + z)
        g.solid(ox + xl - 1, 0, oz + z, mat); g.dust(ox + xl - 1, 1, oz + z)
        return (ox + xl - 3 - extra, 0, oz + z)

    def feed_e(xr, z, extra=0):
        for k in range(2 + extra):
            g.dust(ox + xr + 2 + k, 0, oz + z)
        g.solid(ox + xr + 1, 0, oz + z, mat); g.dust(ox + xr + 1, 1, oz + z)
        return (ox + xr + 3 + extra, 0, oz + z)

    def lamps(x, z, dx, dz, n):
        for k in range(n):
            g.put(ox + x + dx * k, 0, oz + z + dz * k, "redstone_lamp", lit="false")
            g.dust(ox + x + dx * k, 1, oz + z + dz * k)

    lamps(5, 0, 1, 0, 3);  pins["a"] = feed_w(5, 0)
    lamps(8, 2, 0, 1, 3);  pins["b"] = feed_e(8, 4, extra=1)
    lamps(8, 8, 0, 1, 3);  pins["c"] = feed_e(8, 10, extra=1)
    lamps(5, 12, 1, 0, 3); pins["d"] = feed_w(5, 12)
    lamps(4, 8, 0, 1, 3);  pins["e"] = feed_w(4, 10, extra=1)
    lamps(4, 2, 0, 1, 3);  pins["f"] = feed_w(4, 4, extra=1)
    lamps(5, 6, 1, 0, 3);  pins["g"] = feed_w(5, 6)
    g.put(ox + 10, 0, oz + 12, "redstone_lamp", lit="false"); g.dust(ox + 10, 1, oz + 12)
    pins["dp"] = feed_e(10, 12, extra=1)
    return {"pins": pins, "bbox": (ox, oz, ox + 16, oz + 13)}
