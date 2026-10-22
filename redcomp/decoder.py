"""Дешифратор «адрес -> одна из 2^n линий» без B-плоскости: строка A-плоскости (И-НЕ литералов) -> один инвертор (блок + настенный факел)."""
from .grid import Grid
from .pla import PLA, plane_a, ramp_up_x


class Decoder(PLA):
    """Использует вход/A-плоскость ПЛМ; вместо B-плоскости каждая строка получает свой инвертор.
    Выход s{v}: (x_endA+4, 0, z_v), поток на восток."""

    def build(self):
        g, mat = self.g, self.mat
        terms = []
        need_neg = set()
        for tt in self.fixed_terms:
            if tt not in terms:
                terms.append(tt)
            for (n, p) in tt:
                if p == 0:
                    need_neg.add(n)
        used_pos = set(n for tt in terms for (n, p) in tt if p == 1)
        cols = []
        for n in self.inputs:
            if n in used_pos:
                cols.append((n, 1))
            if n in need_neg:
                cols.append((n, 0))
        self.cols = cols
        ncols, nterms = len(cols), len(terms)
        self.terms = terms
        ox, oz = self.ox, self.oz
        z_in = oz - 8
        self.in_ports = {}
        self.col_x = {}
        for ci, (n, p) in enumerate(cols):
            self.col_x[(n, p)] = ox + 2 * ci
        for n in self.inputs:
            has_t, has_n = (n, 1) in self.col_x, (n, 0) in self.col_x
            if not (has_t or has_n):
                continue
            if has_t and has_n:
                xt, xn = self.col_x[(n, 1)], self.col_x[(n, 0)]
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
        sitesA = set()
        for ti, tt in enumerate(terms):
            for (n, p) in tt:
                sitesA.add((ti, [c for c, (nn, pp) in enumerate(cols) if (nn, pp) == (n, p)][0]))
        x_endA, zs = plane_a(g, ox, oz, ncols, nterms, sitesA, mat=mat)
        self.out_ports = {}
        for ti, tt in enumerate(terms):
            z = zs[ti]
            g.solid(x_endA + 1, 0, z, mat)
            g.wall_torch(x_endA + 2, 0, z, "east")
            g.dust(x_endA + 3, 0, z); g.dust(x_endA + 4, 0, z)
            self.out_ports[self.outputs_by_term[tt]] = (x_endA + 4, 0, z)
        self.size = (x_endA + 5 - ox, zs[-1] - z_in)
        self.x_endB = x_endA + 5
        self.z_endB = zs[-1]


def decoder(g: Grid, ox, oz, prefix, nbits=5, extra=None, mat="stone"):
    """возвращает Decoder; входы prefix0..prefix{n-1} (+extra), выходы s0..s{2^n-1}"""
    inputs = [f"{prefix}{i}" for i in range(nbits)] + ([extra] if extra else [])
    terms, names = [], {}
    for v in range(1 << nbits):
        t = [(f"{prefix}{i}", (v >> i) & 1) for i in range(nbits)]
        if extra:
            t.append((extra, 1))
        terms.append(t)
        names[tuple(sorted(t))] = f"s{v}"
    d = Decoder.__new__(Decoder)
    d.outputs_by_term = names
    PLA.__init__(d, g, ox, oz, inputs, {}, mat=mat, fixed_terms=terms)
    return d
