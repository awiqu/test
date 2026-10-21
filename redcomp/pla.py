"""Генератор ПЛМ (две факельные плоскости) на пыли/факелах.

Поток слева направо: [инверторы входов] -> П1 (И-НЕ термы, столбцы вдоль Z) -> рампа -> П2 (ИЛИ, столбцы вдоль X)
Выходы выходят вниз (строки П2 вдоль Z). Все входы/выходы активны уровнем 1.
"""
from .grid import Grid

MAXRUN = 14   # макс. длина пыли без повторителя

def ramp_up_x(g, x, z, mat="stone", regen=False):
    """рампа вдоль +X: пыль (x,0,z) -> (x+1,1,z) -> (x+2,2,z). Занимает x..x+2. Возвращает x+2.
    regen=True: первая клетка — повторитель (восстанавливает уровень 15)."""
    g.solid(x + 1, 0, z, mat); g.dust(x + 1, 1, z)
    g.solid(x + 2, 1, z, mat); g.dust(x + 2, 2, z)
    if regen:
        g.repeater(x, 0, z, "east")
    else:
        g.dust(x, 0, z)
    return x + 2

def ramp_up_z(g, x, z, mat="stone"):
    """рампа вдоль +Z: (x,0,z) -> (x,1,z+1) -> (x,2,z+2). Возвращает z+2."""
    g.solid(x, 0, z + 1, mat); g.dust(x, 1, z + 1)
    g.solid(x, 1, z + 2, mat); g.dust(x, 2, z + 2)
    g.dust(x, 0, z)
    return z + 2

def _reps(g, cells, flow, every=11, avoid=()):
    """заменить каждую every-ю клетку пыли повторителем (поток flow)"""
    n = 0
    for i, (x, y, z) in enumerate(cells):
        n += 1
        if n >= every and (x, y, z) not in avoid:
            b = g.get(x, y, z)
            if b is not None and b.name == "redstone_wire":
                g.repeater(x, y, z, flow)
                n = 0


def plane_a(g, ox, oz, ncols, nrows, sites, col_len=None, mat="stone"):
    """Плоскость A: столбцы (y=2) вдоль Z сверху вниз, строки (y=0) вдоль X слева направо.
    столбец c: x=ox+2c, стена y=1; строка r: z=oz+2r. Факел на (x_c+1,1,z_r) смотрит на восток.
    Столбцы сверху получают сигнал; строки вытекают на восток (x = ox+2*ncols+1 - последняя клетка).
    Возвращает (x_end, [z_r...])."""
    zs = [oz + 2 * r for r in range(nrows)]
    z_lo, z_hi = oz - 1, oz + 2 * nrows - 1
    x_end = ox + 2 * ncols
    for c in range(ncols):
        x = ox + 2 * c
        for z in range(z_lo, z_hi + 1):
            g.solid(x, 1, z, mat)
            g.dust(x, 2, z)
    for r, z in enumerate(zs):
        for x in range(ox, x_end + 1):
            g.dust(x, 0, z)
    for (r, c) in sites:
        g.wall_torch(ox + 2 * c + 1, 1, zs[r], "east")
    # повторители: столбцы вниз (на нечётных z между строками), строки вправо (под стеной)
    for c in range(ncols):
        x = ox + 2 * c
        cells = [(x, 2, z) for z in range(z_lo, z_hi + 1) if (z - oz) % 2 == 1 or z < oz]
        n = 0
        for z in range(z_lo, z_hi + 1):
            n += 1
            if n >= 11 and (z - oz) % 2 == 1:
                g.repeater(x, 2, z, "south"); n = 0
    torch_x = {(ox + 2 * c + 1, zs[r]) for (r, c) in sites}
    for r, z in enumerate(zs):
        n = 0
        for x in range(ox, x_end + 1):
            n += 1
            if n >= 11 and (x - ox) % 2 == 0 and x != x_end:
                g.repeater(x, 0, z, "east"); n = 0
    return x_end, zs

def plane_b(g, ox, oz, ncols, nrows, sites, mat="stone"):
    """Плоскость B (транспонированная): столбцы (y=2) вдоль X слева направо на z=oz+2c,
    строки (y=0) вдоль Z на x=ox+2r. Факел на (x_r,1,z_c+1) смотрит на юг."""
    xs = [ox + 2 * r for r in range(nrows)]
    x_lo, x_hi = ox - 1, ox + 2 * nrows - 1
    z_end = oz + 2 * ncols
    for c in range(ncols):
        z = oz + 2 * c
        for x in range(x_lo, x_hi + 1):
            g.solid(x, 1, z, mat)
            g.dust(x, 2, z)
    for r, x in enumerate(xs):
        for z in range(oz, z_end + 1):
            g.dust(x, 0, z)
    for (r, c) in sites:
        g.wall_torch(xs[r], 1, oz + 2 * c + 1, "south")
    for c in range(ncols):
        z = oz + 2 * c
        n = 0
        for x in range(x_lo, x_hi + 1):
            n += 1
            if n >= 11 and (x - ox) % 2 == 1:
                g.repeater(x, 2, z, "east"); n = 0
    for r, x in enumerate(xs):
        n = 0
        for z in range(oz, z_end + 1):
            n += 1
            if n >= 11 and (z - oz) % 2 == 0 and z != z_end and z != oz:
                g.repeater(x, 0, z, "south"); n = 0
        if ncols >= 2:
            g.repeater(x, 0, z_end - 2, "south")          # регенерация перед портом
    return z_end, xs

def insert_repeaters_row(g, y, z, x0, x1, step=MAXRUN):
    """заменить пыль в горизонтальной линии (вдоль +X) повторителями каждые ~step клеток
    (только в клетках, где y-слой содержит пыль и нет «чувствительных» мест — вызывающий выбирает x)."""
    pass


class PLA:
    """Построенная ПЛМ."""
    def __init__(self, g, ox, oz, inputs, outputs, mat="stone"):
        self.g = g
        self.inputs = list(inputs)           # имена
        self.outputs = outputs               # name -> list of terms; term = [(name, pol), ...]
        self.ox, self.oz = ox, oz
        self.mat = mat
        self.build()

    def build(self):
        g, mat = self.g, self.mat
        # литералы
        lits = []
        need_neg = set()
        terms = []
        for oname, tl in self.outputs.items():
            for t in tl:
                tt = tuple(sorted(t))
                if tt not in terms:
                    terms.append(tt)
                for (n, p) in tt:
                    if p == 0:
                        need_neg.add(n)
        pos_cols = list(self.inputs)
        # столбцы: для каждого входа true (если используется) и neg (если нужен)
        used_pos = set(n for tt in terms for (n, p) in tt if p == 1)
        cols = []
        for n in self.inputs:
            if n in used_pos:
                cols.append((n, 1))
            if n in need_neg:
                cols.append((n, 0))
        self.cols = cols
        ncols = len(cols)
        nterms = len(terms)
        self.terms = terms
        ox, oz = self.ox, self.oz
        # --- зона входов: сверху на z=oz-?; инверторы: поместим 4 строки выше плоскости A
        # входные порты: (x_c, y=0, z=oz-5): пыль сверху вниз на y=0; на y=0 идёт вниз до инверторов/рампы
        z_in = oz - 8
        self.in_ports = {}
        self.col_x = {}
        for ci, (n, p) in enumerate(cols):
            x = ox + 2 * ci
            self.col_x[(n, p)] = x
        # для каждого входа: линия приходит в (x_true, z_in). Если нужны оба: true-колонка и neg-колонка рядом.
        # Структура: вход n приходит на колонку x_n (если есть true) иначе на x_neg-?.
        for n in self.inputs:
            has_t, has_n = (n, 1) in self.col_x, (n, 0) in self.col_x
            if not (has_t or has_n):
                continue
            if has_t and has_n:
                xt, xn = self.col_x[(n, 1)], self.col_x[(n, 0)]
                # вход приходит в xt. от xt идёт пыль вниз на y=0 до рампы; ответвление в блок-инвертор у xn.
                self.in_ports[n] = (xt, 0, z_in)
                self._inv_pair(xt, xn, z_in, oz)
            elif has_t:
                xt = self.col_x[(n, 1)]
                self.in_ports[n] = (xt, 0, z_in)
                self._feed(xt, z_in, oz)
            else:
                xn = self.col_x[(n, 0)]
                self.in_ports[n] = (xn, 0, z_in)
                self._inv_single(xn, z_in, oz)
        # --- плоскость A
        sitesA = set()
        for ti, tt in enumerate(terms):
            for (n, p) in tt:
                sitesA.add((ti, [c for c, (nn, pp) in enumerate(cols) if (nn, pp) == (n, p)][0]))
        x_endA, zs = plane_a(g, ox, oz, ncols, nterms, sitesA, mat=mat)
        # --- рампа вверх по X в конце строк (строка заканчивается в x_endA)
        x_ramp = x_endA
        for z in zs:
            # пыль строки уже на y=0 до x_endA; рампа продолжается с x_endA
            ramp_up_x(g, x_endA, z, mat, regen=True)
        xB = x_endA + 4            # начало плоскости B (чётный x для выравнивания порта)
        # столбцы B лежат на z=zs[r]; B-стена начинается с x_lo = xB-1; рампа кончается на x_endA+2 (y=2) -> смыкается с x_lo?
        # plane_b ставит стену/пыль от x_lo=ox_b-1.. ; задаём ox_b = x_endA+3 -> x_lo = x_endA+2 (последняя клетка рампы)
        outs = list(self.outputs.keys())
        nout = len(outs)
        sitesB = set()
        for oi, oname in enumerate(outs):
            for t in self.outputs[oname]:
                tt = tuple(sorted(t))
                sitesB.add((oi, terms.index(tt)))
        # plane_b: столбцы по z=oz+2c, c=терм; строки (выходы) вдоль Z. Но plane_b использует oz как начало: нужно oz_b=oz.
        z_endB, xs = plane_b(g, xB, oz, nterms, nout, sitesB, mat=mat)
        self.out_ports = {on: (xs[i], 0, z_endB) for i, on in enumerate(outs)}
        self.size = (xB + 2 * nout - ox, z_endB - z_in)
        self.x_endB = xB + 2 * nout
        self.z_endB = z_endB

    # --- входные цепи (вход приходит на (xt, 0, z_in), z_in = oz-7)
    def _tail_true(self, x, z_in, oz):
        """пыль вниз (с повторителем) -> рампа вверх: (x,0,oz-3) -> (x,1,oz-2) -> столбец (x,2,oz-1)"""
        g = self.g
        for z in range(z_in, oz - 2):
            g.dust(x, 0, z)
        g.repeater(x, 0, oz - 5, "south")
        g.solid(x, 0, oz - 2, self.mat); g.dust(x, 1, oz - 2)

    def _feed(self, x, z_in, oz):
        self._tail_true(x, z_in, oz)

    def _inv_chain(self, xn, zi, oz, from_x=None):
        """ветка (из from_x по строке zi+1) -> пыль (xn,zi+2) -> блок(zi+3) -> факел(zi+4,юг) -> пыль(zi+5=oz-3) -> рампа"""
        g = self.g
        if from_x is None:
            g.dust(xn, 0, zi); g.dust(xn, 0, zi + 1)
        else:
            step = 1 if xn > from_x else -1
            x = from_x + step
            while x != xn:
                g.dust(x, 0, zi + 1); x += step
            g.dust(xn, 0, zi + 1)
        g.dust(xn, 0, zi + 2)
        g.solid(xn, 0, zi + 3, self.mat)
        g.wall_torch(xn, 0, zi + 4, "south")
        g.dust(xn, 0, zi + 5)                       # = oz-3 при zi = oz-8
        g.solid(xn, 0, oz - 2, self.mat); g.dust(xn, 1, oz - 2)

    def _inv_single(self, x, z_in, oz):
        self._inv_chain(x, z_in, oz)

    def _inv_pair(self, xt, xn, z_in, oz):
        self._tail_true(xt, z_in, oz)
        self._inv_chain(xn, z_in, oz, from_x=xt)
