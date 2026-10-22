"""Глобальный маршрутизатор на L слоях: провода идут и поверх модулей (слои выше крыши модуля).

Слой l — провод на высоте y0+2l (опора y0+2l-1 при l>0). Соседние слои соединяются рампой по улице.
Модуль закрывает над собой нижние слои (по высоте его блоков и «чувствительным» блокам — лампам),
верхние слои над ним свободны. Геометрия рампы и правила совместимости — как в двухслойном glr.py."""
import os
import subprocess
import time
from collections import defaultdict
from .grid import Grid
from .lattice import Router, D, DIRNAME

PF3_BIN = os.path.join(os.path.dirname(__file__), "..", "build", "pf3")
SENSITIVE = ("redstone_lamp", "copper_bulb", "waxed_copper_bulb", "piston", "sticky_piston", "dropper", "dispenser",
             "hopper", "note_block", "tnt", "powered_rail", "iron_door", "oak_door", "oak_trapdoor", "iron_trapdoor")
SOURCES = ("redstone_torch", "redstone_wall_torch", "lever", "redstone_block", "stone_button", "observer")


class Router3(Router):
    """Данные трассы (узлы/улицы по слоям 0,2,4,…) + вывод блоков для любого числа слоёв."""

    def __init__(self, ni, nj, ox, oz, y0=0, mat="stone"):
        super().__init__(ni, nj, ox, oz, y0, mat)
        self.pin_nodes = {}          # (i, j, y) -> имя цепи
        self.blkL = {}               # (i,j) -> число закрытых нижних слоёв

    def commit_path(self, path, moves, net):
        for n in path:
            self.node[n] = net
        for (a, b), mv in zip(zip(path[:-1], path[1:]), moves):
            if mv[0] == "flat":
                self.street[(mv[1], a[2])] = net
                self.edges_of_net[net].append((a, b, "flat"))
            else:
                lo = min(a[2], b[2])
                self.street[(mv[1], lo)] = net
                self.street[(mv[1], lo + 2)] = net
                self.edges_of_net[net].append((a, b, "ramp"))

    def _put_dust(self, g, x, z, l):
        y = self.y0 + l
        if l > 0:
            g.solid(x, y - 1, z, self.mat)
        g.dust(x, y, z)

    def emit(self, g: Grid):
        y0, mat = self.y0, self.mat
        repmap = {(k2, l2): (p, q) for (k2, l2, p, q) in getattr(self, "reps", {})}
        for (i, j, l), o in self.node.items():
            if isinstance(o, tuple):
                continue
            x, z = self.xz(i, j)
            self._put_dust(g, x, z, l)
        for net, edges in self.edges_of_net.items():
            for (a, b, kind) in edges:
                ax, az = self.xz(a[0], a[1]); bx, bz = self.xz(b[0], b[1])
                mx, mz = (ax + bx) // 2, (az + bz) // 2
                if kind == "flat":
                    key = self.skey((a[0], a[1]), (b[0], b[1]))
                    rp = repmap.get((key, a[2]))
                    if rp is None:
                        self._put_dust(g, mx, mz, a[2])
                    else:
                        (p, q) = rp
                        dd = {(1, 0): "east", (-1, 0): "west", (0, 1): "south", (0, -1): "north"}[(q[0] - p[0], q[1] - p[1])]
                        y = y0 + a[2]
                        if a[2] > 0:
                            g.solid(mx, y - 1, mz, mat)
                        g.repeater(mx, y, mz, dd)
                else:
                    lo = min(a[2], b[2])
                    g.solid(mx, y0 + lo, mz, mat); g.dust(mx, y0 + lo + 1, mz)


    def assign_repeaters(self, sources, every=11, reverse=None, start=None):
        """повторители на плоских улицах каждые ~every клеток, а перед цепочкой рамп — с запасом на всю цепочку
        (на рампе повторителя поставить нельзя, пыль теряет по уровню на клетку)."""
        from collections import deque
        start = start or {}
        self.reps = {}
        self.warn = []
        for net, edges in self.edges_of_net.items():
            adj = defaultdict(list)
            for (a, b, kind) in edges:
                key = self.skey((a[0], a[1]), (b[0], b[1]))
                adj[a].append((b, kind, key, a[2]))
                adj[b].append((a, kind, key, b[2]))
            srcs = [n for n in sources.get(net, []) if n in adj]
            if not srcs:
                continue
            core_edges = set()
            if len(srcs) > 1:
                deg = {n: len(adj[n]) for n in adj}
                alive = set(adj.keys())
                dq0 = deque([n for n in alive if deg[n] <= 1 and n not in srcs])
                while dq0:
                    n = dq0.popleft()
                    if n not in alive:
                        continue
                    alive.discard(n)
                    for (m, kind, key, l) in adj[n]:
                        if m in alive:
                            deg[m] -= 1
                            if deg[m] <= 1 and m not in srcs:
                                dq0.append(m)
                for n in alive:
                    for (m, kind, key, l) in adj[n]:
                        if m in alive:
                            core_edges.add(frozenset((n, m)))
                if len(core_edges) * 2 > 26:
                    self.warn.append((net, "ядро цепи длиннее 13 клеток", len(core_edges) * 2))
            # дерево обхода от источников
            parent, order = {n: None for n in srcs}, []
            dq = deque(srcs)
            while dq:
                n = dq.popleft()
                order.append(n)
                for (m, kind, key, l) in adj[n]:
                    if m not in parent:
                        parent[m] = n
                        dq.append(m)
            run = {n: 0 for n in order}                      # длина самой длинной цепочки рамп вниз по дереву от узла
            for n in reversed(order):
                for (m, kind, key, l) in adj[n]:
                    if parent.get(m) == n and kind == "ramp":
                        run[n] = max(run[n], 1 + run[m])
            dist = {n: start.get(net, 0) for n in srcs}
            for n in order:
                for (m, kind, key, l) in adj[n]:
                    if parent.get(m) != n or m in dist:
                        continue
                    c = dist[n] + 2
                    if kind == "flat" and frozenset((n, m)) not in core_edges and (c >= every or c + 2 * run[m] + 1 > 14):
                        self.reps[(key, l, n[:2], m[:2])] = True
                        c = 1
                    dist[m] = c
                    if c > 14 and kind == "ramp":
                        self.warn.append((net, "затухание на рампах", c))

    def _commit_all(self, terms):
        for net, segs in self.routes.items():
            for path, moves in segs:
                self.commit_path(path, moves, net)
            for p in terms.get(net, []):
                self.node[tuple(p)] = net


class GlobalRouter3:
    def __init__(self, g: Grid, x0, z0, x1, z1, y0=0, layers=6, mat="stone"):
        assert x0 % 2 == 0 and z0 % 2 == 0, "решётка должна быть выровнена по чётным координатам"
        self.g, self.x0, self.z0, self.x1, self.z1, self.y0, self.mat = g, x0, z0, x1, z1, y0, mat
        self.L = layers
        self.ni = (x1 - x0) // 2 + 1
        self.nj = (z1 - z0) // 2 + 1
        self.R = Router3(self.ni, self.nj, x0, z0, y0, mat)
        self.nets = {}
        self.weak = set()
        self.net_y = {}                  # цепь -> [высоты пинов (чётные): источник, стоки...]

    def node_of(self, x, z):
        if (x - self.x0) % 2 or (z - self.z0) % 2:
            raise ValueError(f"порт ({x},{z}) не на узле решётки")
        return ((x - self.x0) // 2, (z - self.z0) // 2)

    def mark_obstacles(self, extra_cells=()):
        """для каждого узла — число закрытых нижних слоёв: слой l занимает y=2l-1 (опора) и 2l (пыль) +-1 по y
        и 3x3 клеток вокруг узла; кроме того, слой над лампой/лампой-медной закрыт (опора под током включила бы её)"""
        y0 = self.y0
        col = defaultdict(list)                       # (x,z) -> [(y_rel, name)]
        for (x, y, z), b in self.g.b.items():
            if y >= y0:
                col[(x, z)].append((y - y0, b.name))
        for (x, z) in extra_cells:
            col[(x, z)].append((0, "stone"))
        blk = {}
        for (x, z), lst in col.items():
            closed = 0
            for (y, name) in lst:
                # блок на высоте y пересекается со слоем l, если 2l-1 <= y <= 2l+1; прочие слои закрываем префиксом
                closed = max(closed, (y + 1) // 2 + 1)
                if (name in SENSITIVE or name in ("redstone_torch", "redstone_wall_torch")) and y % 2 == 0:
                    closed = max(closed, (y + 2) // 2 + 1)       # опора слоя прямо над лампой (зажжётся) или факелом (факел питает блок над собой)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    xx, zz = x + dx, z + dz
                    if (xx - self.x0) % 2 == 0 and (zz - self.z0) % 2 == 0:
                        i, j = (xx - self.x0) // 2, (zz - self.z0) // 2
                        if 0 <= i < self.ni and 0 <= j < self.nj:
                            blk[(i, j)] = max(blk.get((i, j), 0), closed)
        self.R.blkL = blk
        self.R.blk = frozenset(blk)
        return blk

    def add_net(self, name, src, sinks, ys=None):
        self.nets[name] = (src, list(sinks))
        self.net_y[name] = list(ys) if ys else [0] * (1 + len(sinks))

    def route(self, iters=60, verbose=True, seed=0):
        R = self.R
        terms = {}
        pin_dirs = {}
        for name, (src, sinks) in self.nets.items():
            pl = []
            for (x, z, d), y in zip([src] + sinks, self.net_y[name]):
                i, j = self.node_of(x, z)
                node = (i, j, y)
                key = node
                if key in R.pin_nodes and R.pin_nodes[key] != name:
                    raise ValueError(f"порт ({x},{z}) занят сетью {R.pin_nodes[key]}, а нужен {name}")
                R.pin_nodes[key] = name
                R.node[node] = name
                pin_dirs.setdefault(key, set()).add(d)
                pl.append(node)
            terms[name] = pl
        R.pin_dirs = pin_dirs
        t0 = time.time()
        ok = self._route_cpp(terms, iters, verbose)
        if verbose:
            print(f"  маршрутизация: {'успех' if ok else 'НЕУДАЧА ' + str(getattr(R, 'failed', ''))}, {time.time() - t0:.1f} c")
        if not ok:
            return False
        R.routes_done = True
        srcmap = {name: [self._pinnode(src, self.net_y[name][0])] for name, (src, sinks) in self.nets.items()}
        R.assign_repeaters(srcmap, start={n: 9 for n in self.weak})
        # регенерация перед каждым приёмником: последняя средина улицы -> повторитель в сторону порта
        for name, (src, sinks) in self.nets.items():
            edges = R.edges_of_net.get(name, [])
            for sk, yk in zip(sinks, self.net_y[name][1:]):
                n = self._pinnode(sk, yk)
                inc = [(a, b, kd) for (a, b, kd) in edges if n in (a, b)]
                if len(inc) != 1 or inc[0][2] != "flat":
                    continue
                a, b, kd = inc[0]
                other = b if a == n else a
                key = R.skey((a[0], a[1]), (b[0], b[1]))
                for k2 in [k for k in R.reps if k[0] == key and k[1] == n[2]]:
                    del R.reps[k2]
                R.reps[(key, n[2], other[:2], n[:2])] = True
        return True

    def _route_cpp(self, terms, iters, verbose):
        R = self.R
        names = list(terms)
        idx = {n: k for k, n in enumerate(names)}
        L = [f"{R.ni} {R.nj} {self.L}", str(len(R.blkL))]
        L += [f"{i} {j} {min(nl, self.L)}" for (i, j), nl in R.blkL.items()]
        pb = []
        for (i, j, y), dirs in R.pin_dirs.items():
            for d, (di, dj) in D.items():
                if d not in dirs:
                    pb.append(f"{i} {j} {0 if d == 'E' else 1 if d == 'S' else 2 if d == 'W' else 3} {y // 2}")
        L.append(str(len(pb))); L += pb
        po = [f"{i} {j} {idx[nm]} {y // 2}" for (i, j, y), nm in R.pin_nodes.items() if nm in idx]
        L.append(str(len(po))); L += po
        L.append(str(len(names)))
        for n in names:
            pts = terms[n]
            L.append(str(len(pts)) + " " + " ".join(f"{p[0]} {p[1]} {p[2] // 2}" for p in pts))
        L.append(f"{iters} 0.6 1.6")
        res = subprocess.run([PF3_BIN], input="\n".join(L) + "\n", capture_output=True, text=True)
        if verbose:
            print(res.stderr, end="")
        out = res.stdout.split("\n")
        if out[0] != "OK":
            R.failed = out[0]
            R.overuse = [ln for ln in out[1:] if ln.startswith("O ")]
            R.fail_terms = [(int(ln.split()[1]), int(ln.split()[2])) for ln in out[1:] if ln.startswith("T ")]
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
                R.routes[cur][-1][0].append((int(i), int(j), 2 * int(l)))
        for net, segs in R.routes.items():
            for path, moves in segs:
                for a, b in zip(path[:-1], path[1:]):
                    key = R.skey((a[0], a[1]), (b[0], b[1]))
                    if a[2] == b[2]:
                        moves.append(("flat", key))
                    else:
                        low, high = ((a[0], a[1]), (b[0], b[1])) if a[2] < b[2] else ((b[0], b[1]), (a[0], a[1]))
                        moves.append(("ramp", key, low, high))
        R._commit_all(terms)
        return True

    def _pinnode(self, pin, y=0):
        i, j = self.node_of(pin[0], pin[1])
        return (i, j, y)

    def emit(self):
        tmp = Grid()
        self.R.emit(tmp)
        for p, b in tmp.b.items():
            if p not in self.g.b:
                self.g.b[p] = b
        return len(tmp.b)
