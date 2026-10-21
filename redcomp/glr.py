"""Глобальный маршрутизатор: соединяет порты готовых модулей на решётке (шаг 2), два слоя + рампы."""
import os
import subprocess
import time
from collections import defaultdict
from .grid import Grid
from .lattice import PFRouter, D

DIRV = {"E": (1, 0), "W": (-1, 0), "S": (0, 1), "N": (0, -1)}


PF_BIN = os.path.join(os.path.dirname(__file__), "..", "build", "pf")


class GlobalRouter:
    def __init__(self, g: Grid, x0, z0, x1, z1, y0=0, margin=1, mat="stone"):
        assert x0 % 2 == 0 and z0 % 2 == 0, "решётка должна быть выровнена по чётным координатам"
        self.g, self.x0, self.z0, self.x1, self.z1, self.y0, self.mat = g, x0, z0, x1, z1, y0, mat
        self.ni = (x1 - x0) // 2 + 1
        self.nj = (z1 - z0) // 2 + 1
        self.R = PFRouter(self.ni, self.nj, x0, z0, y0, mat)
        self.R.pin_nodes = {}          # иначе общий словарь класса между экземплярами
        self.R.blk = frozenset()
        self.nets = {}          # name -> (src_pin, [sink pins])
        self.margin = margin
        self.weak = set()       # цепи со слабым источником: повторитель сразу у источника

    def node_of(self, x, z):
        if (x - self.x0) % 2 or (z - self.z0) % 2:
            raise ValueError(f"порт ({x},{z}) не на узле решётки")
        return ((x - self.x0) // 2, (z - self.z0) // 2)

    def mark_obstacles(self, extra_cells=()):
        """занятые клетки сетки + зазор -> блокированные узлы (по всем слоям)"""
        blk = set()
        occ = set((p[0], p[2]) for p in self.g.b if p[1] >= self.y0)
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
        ok = self._route_cpp(terms, iters, verbose) if os.path.exists(PF_BIN) else R.route_all(terms, iters=iters, verbose=verbose)
        if verbose:
            print(f"  маршрутизация: {'успех' if ok else 'НЕУДАЧА '+str(R.failed)}, {time.time()-t0:.1f} c")
        if not ok:
            return False
        srcmap = {name: [self._pinnode(src)] for name, (src, sinks) in self.nets.items()}
        R.assign_repeaters(srcmap, start={n: 9 for n in self.weak})
        # регенерация перед каждым приёмником: последняя средина улицы -> повторитель в сторону порта
        for name, (src, sinks) in self.nets.items():
            edges = R.edges_of_net.get(name, [])
            for sk in sinks:
                n = self._pinnode(sk)
                inc = [(a, b, kd) for (a, b, kd) in edges if n in (a, b)]
                if len(inc) != 1 or inc[0][2] != "flat":
                    continue
                a, b, kd = inc[0]
                other = b if a == n else a
                key = R.skey((a[0], a[1]), (b[0], b[1]))
                # снять существующие повторители на этой улице и поставить направленный к порту
                for k2 in [k for k in R.reps if k[0] == key and k[1] == n[2]]:
                    del R.reps[k2]
                R.reps[(key, n[2], other[:2], n[:2])] = True
        return True

    def _route_cpp(self, terms, iters, verbose):
        """PathFinder в C++ (redcomp/cpp/pf.cpp), результат кладётся в R.routes как у PFRouter.route_all"""
        R = self.R
        names = list(terms)
        idx = {n: k for k, n in enumerate(names)}
        L = [f"{R.ni} {R.nj}", str(len(R.blk))]
        L += [f"{i} {j}" for (i, j) in R.blk]
        pb = []
        for (key, l), v in R.street.items():
            if l == 0 and isinstance(v, tuple) and v[0] == "pinblock":
                (a, b) = key
                pb.append(f"{a[0]} {a[1]} {0 if b[0] > a[0] or (b == (a[0] + 1, a[1])) else 1}")
        L.append(str(len(pb))); L += pb
        po = [f"{i} {j} {idx[nm]}" for (i, j), nm in R.pin_nodes.items() if nm in idx]
        L.append(str(len(po))); L += po
        nr = []
        for (i, j), nm in R.pin_nodes.items():
            x, z = R.xz(i, j)
            if (x, self.y0 + 1, z) in self.g.b or (x, self.y0 + 2, z) in self.g.b:
                nr.append(f"{i} {j}")           # над пином занято: рампа на нём невозможна
        L.append(str(len(nr))); L += nr
        L.append(str(len(names)))
        for n in names:
            pts = terms[n]
            L.append(str(len(pts)) + " " + " ".join(f"{p[0]} {p[1]}" for p in pts))
        L.append(f"{iters} 0.6 1.6")
        res = subprocess.run([PF_BIN], input="\n".join(L) + "\n", capture_output=True, text=True)
        if verbose:
            print(res.stderr, end="")
        out = res.stdout.split("\n")
        if out[0] != "OK":
            R.failed = out[0]
            R.overuse = [ln for ln in out[1:] if ln.startswith("O ")]
            return False
        R.routes = {}
        cur = None
        for ln in out[1:]:
            if ln.startswith("N "):
                cur = names[int(ln[2:])]
                R.routes[cur] = []
            elif ln == "P":
                R.routes[cur].append(([], []))
            elif ln.startswith("n "):
                _, i, j, l = ln.split()
                R.routes[cur][-1][0].append((int(i), int(j), int(l)))
        for net, segs in R.routes.items():
            for path, moves in segs:
                for a, b in zip(path[:-1], path[1:]):
                    key = R.skey((a[0], a[1]), (b[0], b[1]))
                    if a[2] == b[2]:
                        moves.append(("flat", key))
                    else:
                        low, high = ((a[0], a[1]), (b[0], b[1])) if a[2] == 0 else ((b[0], b[1]), (a[0], a[1]))
                        moves.append(("ramp", key, low, high))
        R._commit_all(terms)
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
