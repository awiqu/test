"""Глобальный маршрутизатор: соединяет порты готовых модулей на решётке (шаг 2), два слоя + рампы."""
import time
from collections import defaultdict
from .grid import Grid
from .lattice import PFRouter, D

DIRV = {"E": (1, 0), "W": (-1, 0), "S": (0, 1), "N": (0, -1)}


class GlobalRouter:
    def __init__(self, g: Grid, x0, z0, x1, z1, y0=0, margin=1, mat="stone"):
        assert x0 % 2 == 0 and z0 % 2 == 0, "решётка должна быть выровнена по чётным координатам"
        self.g, self.x0, self.z0, self.x1, self.z1, self.y0, self.mat = g, x0, z0, x1, z1, y0, mat
        self.ni = (x1 - x0) // 2 + 1
        self.nj = (z1 - z0) // 2 + 1
        self.R = PFRouter(self.ni, self.nj, x0, z0, y0, mat)
        self.nets = {}          # name -> (src_pin, [sink pins])
        self.margin = margin

    def node_of(self, x, z):
        if (x - self.x0) % 2 or (z - self.z0) % 2:
            raise ValueError(f"порт ({x},{z}) не на узле решётки")
        return ((x - self.x0) // 2, (z - self.z0) // 2)

    def mark_obstacles(self, extra_cells=()):
        """занятые клетки сетки + зазор -> блокированные узлы (по всем слоям)"""
        blk = set()
        occ = set((p[0], p[2]) for p in self.g.b)
        occ |= set(extra_cells)
        for (x, z) in occ:
            # узлы, в 3x3 окрестности которых лежит клетка
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    xx, zz = x + dx, z + dz
                    if (xx - self.x0) % 2 == 0 and (zz - self.z0) % 2 == 0:
                        i, j = (xx - self.x0) // 2, (zz - self.z0) // 2
                        if 0 <= i < self.ni and 0 <= j < self.nj:
                            blk.add((i, j))
        self.R.blk = blk
        return blk

    def add_net(self, name, src, sinks):
        """src, sink: (x, z, dir) — клетка порта (y=0) и сторона, куда уходит провод"""
        self.nets[name] = (src, list(sinks))

    def route(self, iters=60, verbose=True, seed=0):
        R = self.R
        pins = {}
        terms = {}
        pin_dirs = {}
        for name, (src, sinks) in self.nets.items():
            pl = []
            for (x, z, d) in [src] + sinks:
                i, j = self.node_of(x, z)
                node = (i, j, 0)
                if (i, j) in R.pin_nodes and R.pin_nodes[(i, j)] != name:
                    raise ValueError(f"порт ({x},{z}) занят сетью {R.pin_nodes[(i, j)]}, а нужен {name}")
                R.pin_nodes[(i, j)] = name
                R.node[node] = name
                pin_dirs.setdefault((i, j), set()).add(d)
                pl.append(node)
            terms[name] = pl
        # закрыть улицы пинов в неразрешённые стороны
        for (i, j), dirs in pin_dirs.items():
            for d, (di, dj) in D.items():
                if d not in dirs:
                    key = R.skey((i, j), (i + di, j + dj))
                    R.street[(key, 0)] = ("pinblock", i, j)
                    R.street[(key, 2)] = ("pinblock", i, j)
        R.setup_hard(terms)
        R._air_hard = set()
        t0 = time.time()
        ok = R.route_all(terms, iters=iters, verbose=verbose)
        if verbose:
            print(f"  маршрутизация: {'успех' if ok else 'НЕУДАЧА '+str(R.failed)}, {time.time()-t0:.1f} c")
        if not ok:
            return False
        srcmap = {name: [self._pinnode(src)] for name, (src, sinks) in self.nets.items()}
        R.assign_repeaters(srcmap)
        return True

    def _pinnode(self, pin):
        i, j = self.node_of(pin[0], pin[1])
        return (i, j, 0)

    def emit(self):
        """записать провода в общую сетку (без повторной записи пиновых клеток)"""
        tmp = Grid()
        self.R.emit(tmp)
        for p, b in tmp.b.items():
            if p not in self.g.b:
                self.g.b[p] = b
        return len(tmp.b)
