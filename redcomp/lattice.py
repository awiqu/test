"""Решётчатая матрица NOR-вентилей: нетлист -> размещение -> трассировка -> блоки.

Решётка узлов (i,j) с шагом 2 блока. Улицы — клетки между соседними узлами.
Вентиль NOR = каменный блок в узле, настенный факел на улице-выходе, выходной узел — конец улицы.
Входы — улицы с пылью, смотрящей в блок. Провода на двух слоях: y=0 (на полу) и y=2 (на опорах y=1);
слои соединяются рампой по улице (низ y=0 -> средина y=1 -> верх y=2).
Сеть может иметь несколько драйверов (монтажное ИЛИ факелов).
"""
import heapq, math, random
from collections import defaultdict
from .grid import Grid

D = {"E": (1, 0), "W": (-1, 0), "S": (0, 1), "N": (0, -1)}
OPPD = {"E": "W", "W": "E", "N": "S", "S": "N"}
DIRNAME = {"E": "east", "W": "west", "S": "south", "N": "north"}


class Gate:
    def __init__(self, gid, out, ins):
        assert 1 <= len(ins) <= 3, f"NOR {out}: допустимо 1..3 входа"
        self.gid, self.out, self.ins = gid, out, list(ins)
        self.pos = None
        self.odir = None
        self.in_dirs = {}      # индекс входа -> направление улицы


class Netlist:
    def __init__(self):
        self.gates = []
        self.ext_in = {}       # имя -> None (позиция назначается)
        self.ext_out = set()
        self._n = 0

    def inp(self, name):
        self.ext_in[name] = None
        return name

    def nor(self, out, ins):
        g = Gate(len(self.gates), out, ins if isinstance(ins, (list, tuple)) else [ins])
        self.gates.append(g)
        return out

    def outp(self, name):
        self.ext_out.add(name)
        return name

    def fresh(self, base="n"):
        self._n += 1
        return f"{base}{self._n}"

    # --- удобные макросы (на основе NOR + монтажного ИЛИ)
    def NOT(self, a, out=None):
        out = out or self.fresh("not")
        return self.nor(out, [a])

    def OR(self, *a, out=None):
        """ИЛИ = НЕ(НЕ-ИЛИ): две ступени (если нужен инверсный — использовать nor напрямую)"""
        out = out or self.fresh("or")
        t = self.nor(self.fresh("nor"), list(a))
        return self.nor(out, [t])

    def XOR(self, a, b, out=None):
        """XOR: t1=NOR(a,b); t2=NOR(a,t1); t3=NOR(b,t1); XOR = t2 || t3 (монтажное ИЛИ)"""
        out = out or self.fresh("xor")
        t1 = self.nor(self.fresh("x1"), [a, b])
        self.nor(out, [a, t1])
        self.nor(out, [b, t1])
        return out, t1


class Router:
    def __init__(self, ni, nj, ox, oz, y0=0, mat="stone"):
        self.ni, self.nj, self.ox, self.oz, self.y0, self.mat = ni, nj, ox, oz, y0, mat
        self.node = {}       # (i,j,l) -> owner
        self.street = {}     # (key,l) -> owner
        self.no2 = set()     # узлы, где нельзя слой 2 (низ рампы)
        self.gates = {}      # (i,j) -> Gate
        self.edges_of_net = defaultdict(list)   # net -> [(a,b,l, kind)]

    def xz(self, i, j):
        return self.ox + 2 * i, self.oz + 2 * j

    @staticmethod
    def skey(a, b):
        return (a, b) if a <= b else (b, a)

    def inb(self, i, j):
        return 0 <= i < self.ni and 0 <= j < self.nj

    # ---- подготовка
    def place_gates(self, gates):
        for g in gates:
            i, j = g.pos
            assert (i, j) not in self.gates, f"занят узел {g.pos}"
            self.gates[(i, j)] = g
            self.node[(i, j, 0)] = ("G", g.gid)
        for g in gates:
            i, j = g.pos
            di, dj = D[g.odir]
            t = (i + di, j + dj)
            assert self.inb(*t), f"выход {g.out} за пределами"
            assert t not in self.gates, f"выход {g.out} упирается в вентиль"
            self.street[(self.skey((i, j), t), 0)] = ("torch", g.gid)
            self.street[(self.skey((i, j), t), 2)] = ("blocked", g.gid)   # над факелом нельзя
            k = (t[0], t[1], 0)
            if self.node.get(k) not in (None, g.out):
                raise ValueError(f"выходной узел {t} занят {self.node.get(k)}")
            self.node[k] = g.out

    def free_node(self, i, j, l, net):
        o = self.node.get((i, j, l))
        if o is not None and o != net:
            return False
        if l == 2 and (i, j) in self.no2:
            return False
        return True

    def free_street(self, key, l, net):
        o = self.street.get((key, l))
        return o is None or o == net

    # ---- A*
    def _touches_gate(self, key):
        (a, b) = key
        return a in self.gates or b in self.gates

    def neighbors(self, n, net):
        i, j, l = n
        for d, (di, dj) in D.items():
            i2, j2 = i + di, j + dj
            if not self.inb(i2, j2):
                continue
            key = self.skey((i, j), (i2, j2))
            touches = self._touches_gate(key)
            if l == 0 and (i2, j2) in self.gates:
                continue
            # плоский шаг
            if self.free_street(key, l, net) and self.free_node(i2, j2, l, net):
                if not (l == 0 and touches):
                    yield (i2, j2, l), 1.0, ("flat", key)
            # рампа
            if touches or not (self.free_street(key, 0, net) and self.free_street(key, 2, net)):
                continue
            if l == 0:
                low, high = (i, j), (i2, j2)
                if self.node.get((low[0], low[1], 2)) is None and self.free_node(high[0], high[1], 2, net):
                    yield (i2, j2, 2), 3.0, ("ramp", key, low, high)
            else:
                low, high = (i2, j2), (i, j)
                if low not in self.gates and self.free_node(low[0], low[1], 0, net) \
                        and self.node.get((low[0], low[1], 2)) is None:
                    yield (i2, j2, 0), 3.0, ("ramp", key, low, high)

    def astar(self, sources, targets, net):
        tset = set(targets)
        tgt_ij = [(t[0], t[1]) for t in tset]
        def h(n):
            return min(abs(n[0] - a) + abs(n[1] - b) for (a, b) in tgt_ij)
        openq = []
        gscore = {}
        came = {}
        for s in sources:
            gscore[s] = 0.0
            heapq.heappush(openq, (h(s), 0.0, s))
        while openq:
            f, g, n = heapq.heappop(openq)
            if g > gscore.get(n, 1e18):
                continue
            if n in tset:
                path = [n]
                moves = []
                while n in came:
                    p, mv = came[n]
                    moves.append(mv)
                    n = p
                    path.append(n)
                path.reverse(); moves.reverse()
                return path, moves
            for n2, c, mv in self.neighbors(n, net):
                ng = g + c
                if ng < gscore.get(n2, 1e18):
                    gscore[n2] = ng
                    came[n2] = (n, mv)
                    heapq.heappush(openq, (ng + h(n2), ng, n2))
        return None

    def commit_path(self, path, moves, net):
        for n in path:
            self.node[n] = net
        for (a, b), mv in zip(zip(path[:-1], path[1:]), moves):
            if mv[0] == "flat":
                self.street[(mv[1], a[2])] = net
                self.edges_of_net[net].append((a, b, "flat"))
            else:
                key = mv[1]
                self.street[(key, 0)] = net
                self.street[(key, 2)] = net
                self.no2.add(mv[2])
                self.edges_of_net[net].append((a, b, "ramp"))

    def route_net(self, net, drivers, loads, ext_pins=()):
        """drivers: узлы (i,j) слой 0 (выходы вентилей); loads: [(gate, idx)]; ext_pins: [(i,j,l)] внешние выводы"""
        pts = [(i, j, 0) for (i, j) in drivers] + [tuple(p) for p in ext_pins]
        for p in pts:
            if self.node.get(p) not in (None, net):
                return False
            self.node[p] = net
        tree = set()
        fixed_terms = []
        if pts:
            tree.add(pts[0])
            fixed_terms = pts[1:]
        # 1) соединить остальные драйверы/выводы в одну компоненту
        for p in fixed_terms:
            if p in tree:
                continue
            res = self.astar(list(tree), [p], net)
            if res is None:
                return False
            path, moves = res
            self.commit_path(path, moves, net)
            tree.update(path)
        # 2) нагрузки: терминалы уже зарезервированы (g.in_dirs)
        remaining = list(loads)
        targets = {}
        for (g, idx) in remaining:
            d = g.in_dirs[idx]
            t = (g.pos[0] + D[d][0], g.pos[1] + D[d][1], 0)
            targets[(id(g), idx)] = t
        if not tree and remaining:
            (g, idx) = remaining[0]
            tree.add(targets[(id(g), idx)])
            remaining = remaining[1:]
        while remaining:
            best = None
            for item in remaining:
                (g, idx) = item
                t = targets[(id(g), idx)]
                if t in tree:
                    best = (0, item, [t], [])
                    break
                res = self.astar(list(tree), [t], net)
                if res is None:
                    continue
                path, moves = res
                if best is None or len(path) < best[0]:
                    best = (len(path), item, path, moves)
            if best is None:
                return False
            cost, item, path, moves = best
            self.commit_path(path, moves, net)
            tree.update(path)
            remaining.remove(item)
        return True

    def reserve_inputs(self, gates, nets, tp, rng):
        """каждому входу вентиля — своя улица; терминальный узел закрепляется за сетью"""
        centers = {}
        for name, nd in nets.items():
            pts = [tp(g) for g in nd["drv"]] + [g.pos for g, _ in nd["ld"]]
            pts += [p[:2] for p in getattr(self, "_extpins", {}).get(name, [])]
            if pts:
                centers[name] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        order = list(gates)
        rng.shuffle(order)
        for g in order:
            free = []
            for d, (di, dj) in D.items():
                if d == g.odir:
                    continue
                t = (g.pos[0] + di, g.pos[1] + dj)
                if not self.inb(*t) or t in self.gates:
                    continue
                free.append((d, t))
            if len(free) < len(g.ins):
                raise ValueError(f"вентиль {g.out}@{g.pos}: не хватает свободных улиц для входов")
            # перебор назначений (<= 3! вариантов)
            import itertools
            best = None
            for perm in itertools.permutations(free, len(g.ins)):
                cost = 0.0
                okp = True
                for idx, (d, t) in enumerate(perm):
                    net = g.ins[idx]
                    o = self.node.get((t[0], t[1], 0))
                    if o is not None and o != net:
                        okp = False; break
                    c = centers.get(net, t)
                    cost += abs(t[0] - c[0]) + abs(t[1] - c[1])
                if okp and (best is None or cost < best[0]):
                    best = (cost, perm)
            if best is None:
                raise ValueError(f"вентиль {g.out}@{g.pos}: нет совместимых входных узлов")
            for idx, (d, t) in enumerate(best[1]):
                net = g.ins[idx]
                self.node[(t[0], t[1], 0)] = net
                key = self.skey(g.pos, t)
                self.street[(key, 0)] = ("in", net)
                g.in_dirs[idx] = d

    def _claim_input(self, gi, d, key, net):
        g, idx = gi
        self.street[(key, 0)] = ("in", net)
        g.in_dirs[idx] = d

    # ---- повторители
    def assign_repeaters(self, sources, every=11, reverse=None, start=None):
        reverse = reverse or {}
        start = start or {}
        """sources: {net: [узлы-источники (i,j,l)]}. Повторители ставятся наружу от «ядра» цепи
        (минимальное поддерево, соединяющее все источники) — внутри ядра сигнал двунаправленный."""
        self.reps = {}
        self.warn = []
        from collections import deque
        for net, edges in self.edges_of_net.items():
            adj = defaultdict(list)
            for (a, b, kind) in edges:
                key = self.skey((a[0], a[1]), (b[0], b[1]))
                adj[a].append((b, kind, key, a[2]))
                adj[b].append((a, kind, key, b[2]))
            if net in reverse:
                # цепь-сток: корень — внешний пин; повторители направлены К пину
                roots = [p for p in reverse[net] if p in adj]
                if not roots:
                    continue
                dist = {n: 0 for n in roots}
                dq = deque(roots)
                seen = set(roots)
                while dq:
                    n = dq.popleft()
                    for (m, kind, key, l) in adj[n]:
                        if m in seen:
                            continue
                        seen.add(m)
                        c = dist[n] + 2
                        if kind == "flat" and c >= every:
                            # поток от m к n (к корню)
                            self.reps[(key, l, m[:2], n[:2])] = True
                            c = 1
                        dist[m] = c
                        dq.append(m)
                continue
            srcs = [n for n in sources.get(net, []) if n in adj]
            if not srcs:
                continue
            core_edges = set()
            if len(srcs) > 1:
                # обрезаем листья, не являющиеся источниками
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
            dist = {n: start.get(net, 0) for n in srcs}
            dq = deque(srcs)
            seen = set(srcs)
            while dq:
                n = dq.popleft()
                for (m, kind, key, l) in adj[n]:
                    if m in seen:
                        continue
                    seen.add(m)
                    c = dist[n] + 2
                    if kind == "flat" and c >= every and frozenset((n, m)) not in core_edges:
                        self.reps[(key, l, n[:2], m[:2])] = True
                        c = 1
                    dist[m] = c
                    dq.append(m)

    # ---- вывод блоков
    def emit(self, g: Grid):
        y0 = self.y0
        mat = self.mat
        # вентили
        for (i, j), gt in self.gates.items():
            x, z = self.xz(i, j)
            g.solid(x, y0, z, mat)
            di, dj = D[gt.odir]
            g.wall_torch(x + di, y0, z + dj, DIRNAME[gt.odir])
        # пыль на узлах
        for (i, j, l), o in self.node.items():
            if isinstance(o, tuple):
                continue
            x, z = self.xz(i, j)
            self._put_dust(g, x, z, l)
        # улицы
        for (key, l), o in self.street.items():
            if isinstance(o, tuple):
                if o[0] == "in":
                    (a, b) = key
                    mx, mz = self.xz(a[0], a[1])
                    nx, nz = self.xz(b[0], b[1])
                    self._put_dust(g, (mx + nx) // 2, (mz + nz) // 2, 0)
                continue
        done_ramp = set()
        for net, edges in self.edges_of_net.items():
            for (a, b, kind) in edges:
                ax, az = self.xz(a[0], a[1]); bx, bz = self.xz(b[0], b[1])
                mx, mz = (ax + bx) // 2, (az + bz) // 2
                if kind == "flat":
                    key = self.skey((a[0], a[1]), (b[0], b[1]))
                    rp = None
                    for (k2, l2, p, q) in getattr(self, "reps", {}):
                        if k2 == key and l2 == a[2]:
                            rp = (p, q)
                    if rp is None:
                        self._put_dust(g, mx, mz, a[2])
                    else:
                        (p, q) = rp
                        pi, pj = p; qi, qj = q
                        dd = {(1, 0): "east", (-1, 0): "west", (0, 1): "south", (0, -1): "north"}[(qi - pi, qj - pj)]
                        y = self.y0 + a[2]
                        if a[2] == 2:
                            g.solid(mx, y - 1, mz, self.mat)
                        g.repeater(mx, y, mz, dd)
                else:
                    low = a if a[2] == 0 else b
                    lx, lz = self.xz(low[0], low[1])
                    g.solid(mx, y0, mz, mat); g.dust(mx, y0 + 1, mz)

    def _put_dust(self, g, x, z, l):
        y = self.y0 + l
        if l == 2:
            g.solid(x, y - 1, z, self.mat)
        g.dust(x, y, z)


# ======================= размещение и сборка =======================

class Design:
    def __init__(self, nl: Netlist, ni, nj, ox=0, oz=0, y0=0, seed=1):
        self.nl, self.ni, self.nj, self.ox, self.oz, self.y0 = nl, ni, nj, ox, oz, y0
        self.rng = random.Random(seed)
        self.ext_pos = {}        # имя -> (i,j,l)

    # ---- размещение отжигом
    def nets(self):
        d = defaultdict(lambda: {"drv": [], "ld": []})
        for g in self.nl.gates:
            d[g.out]["drv"].append(g)
            for idx, n in enumerate(g.ins):
                d[n]["ld"].append((g, idx))
        return d

    def place(self, iters=60000, fixed=None, free_cols=None, flow_w=0.0):
        """fixed: {имя_внешнего_сигнала: (i,j)}"""
        rng = self.rng
        gates = self.nl.gates
        nets = self.nets()
        ext = dict(fixed or {})
        used = set()
        # начальное размещение: случайно по свободным узлам с шагом (чтобы остались улицы)
        m = getattr(self, "margin", 1)
        cells = [(i, j) for i in range(m, self.ni - m) for j in range(m, self.nj - m)]
        rng.shuffle(cells)
        for g in gates:
            while True:
                c = cells.pop()
                if c in used: continue
                break
            g.pos = c; used.add(c)
            g.odir = rng.choice("EWNS")

        def tpos(g):
            di, dj = D[g.odir]
            return (g.pos[0] + di, g.pos[1] + dj)

        def valid_out(g, occ):
            t = tpos(g)
            return 0 <= t[0] < self.ni and 0 <= t[1] < self.nj and t not in occ

        def cost_all():
            occ = {g.pos: g for g in gates}
            c = 0.0
            for g in gates:
                if not valid_out(g, occ):
                    c += 50
                # свободные улицы: нужно 1 + len(ins)
                free = 0
                for d, (di, dj) in D.items():
                    nb = (g.pos[0] + di, g.pos[1] + dj)
                    if 0 <= nb[0] < self.ni and 0 <= nb[1] < self.nj and nb not in occ:
                        free += 1
                if free < 1 + len(g.ins):
                    c += 30 * (1 + len(g.ins) - free)
            poss = [g.pos for g in gates]
            for ii in range(len(poss)):
                pi_ = poss[ii]
                for jj in range(ii + 1, len(poss)):
                    pj_ = poss[jj]
                    dd_ = abs(pi_[0] - pj_[0]) + abs(pj_[1] - pi_[1])
                    if dd_ == 1:
                        c += 100
                    elif dd_ == 2:
                        c += 6
                    elif dd_ == 3:
                        c += 1.5
            # поток слева направо: нагрузка не левее драйвера
            if flow_w:
                for g in gates:
                    for n_ in g.ins:
                        for dg in nets[n_]["drv"]:
                            back = dg.pos[0] - g.pos[0]
                            if back > -1:
                                c += flow_w * (back + 1)
            tmap = {}
            for g in gates:
                t = tpos(g)
                if t in tmap and tmap[t] != g.out:
                    c += 40
                tmap.setdefault(t, g.out)
            for n_, p_ in ext.items():
                if p_ in tmap and tmap[p_] != n_:
                    c += 40
            for name, nd in nets.items():
                if len(nd["drv"]) > 1:
                    dp = [tpos(g) for g in nd["drv"]]
                    xs_ = [p[0] for p in dp]; ys_ = [p[1] for p in dp]
                    c += 2.5 * ((max(xs_) - min(xs_)) + (max(ys_) - min(ys_)))
                pts = []
                for g in nd["drv"]: pts.append(tpos(g))
                for (g, idx) in nd["ld"]: pts.append(g.pos)
                if name in ext: pts.append(ext[name])
                if len(pts) < 2: continue
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                c += (max(xs) - min(xs)) + (max(ys) - min(ys)) + 0.15 * len(pts)
            # плотность: штраф за соседние вентили (дефицит улиц)
            return c

        cur = cost_all()
        T = 3.0
        for it in range(iters):
            T = 3.0 * (1 - it / iters) + 0.05
            g = rng.choice(gates)
            old = (g.pos, g.odir)
            if rng.random() < 0.7:
                c = (rng.randrange(m, self.ni - m), rng.randrange(m, self.nj - m))
                other = next((h for h in gates if h.pos == c), None)
                if other is not None and other is not g:
                    other.pos, g.pos = g.pos, other.pos
                    new = cost_all()
                    if new <= cur or rng.random() < math.exp((cur - new) / T):
                        cur = new
                    else:
                        other.pos, g.pos = g.pos, other.pos
                    continue
                g.pos = c
            else:
                g.odir = rng.choice("EWNS")
            new = cost_all()
            if new <= cur or rng.random() < math.exp((cur - new) / T):
                cur = new
            else:
                g.pos, g.odir = old
        self.cost = cur
        return cur

    def route(self, ext_pins=None, ext_src=None, order=None, seed=0):
        """ext_pins: {имя: (i,j,l) или [(i,j,l),...]}; ext_src: {имя: [пины-источники]} (по умолчанию: все пины
        внешних входов — источники). Возвращает Router или None."""
        R = Router(self.ni, self.nj, self.ox, self.oz, self.y0)
        gates = self.nl.gates
        R.place_gates(gates)
        nets = self.nets()
        pins = {}
        for n, p in (ext_pins or {}).items():
            pins[n] = [p] if isinstance(p, tuple) else list(p)
        # внешние пины занимают узлы заранее
        for n, pl in pins.items():
            for p in pl:
                if R.node.get(tuple(p)) not in (None, n):
                    raise ValueError(f"пин {n}@{p} конфликтует с {R.node.get(tuple(p))}")
                R.node[tuple(p)] = n
        R._extpins = pins
        def tp0(g):
            return (g.pos[0] + D[g.odir][0], g.pos[1] + D[g.odir][1])
        last_err = None
        for attempt in range(60):
            # откат предыдущей попытки
            for k in [k for k, v in R.street.items() if isinstance(v, tuple) and v[0] == "in"]:
                del R.street[k]
            for g in gates:
                g.in_dirs = {}
            for k in [k for k, v in R.node.items() if not isinstance(v, tuple) and k[2] == 0]:
                if not any(k[:2] == p[:2] for pl in pins.values() for p in pl) and not any(tp0(g)[:2] == k[:2] for g in gates):
                    del R.node[k]
            try:
                R.reserve_inputs(gates, nets, tp0, random.Random(seed * 100 + attempt))
                last_err = None
                break
            except ValueError as e:
                last_err = e
        if last_err is not None:
            self.failed = str(last_err)
            self.R = R
            return None
        names = list(nets.keys())
        for n in pins:
            if n not in nets: names.append(n)
        rng = random.Random(seed)
        def tp(g):
            return (g.pos[0] + D[g.odir][0], g.pos[1] + D[g.odir][1])
        def span(n):
            nd = nets.get(n, {"drv": [], "ld": []})
            pts = [tp(g) for g in nd["drv"]] + [g.pos for g, _ in nd["ld"]] + [p[:2] for p in pins.get(n, [])]
            if not pts: return 0
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            return (max(xs) - min(xs)) + (max(ys) - min(ys))
        names.sort(key=lambda n: (span(n) + rng.random() * (0 if order is None else order)))
        # внешние пины сначала занимают узлы
        for name in names:
            nd = nets.get(name, {"drv": [], "ld": []})
            drivers = [tp(g) for g in nd["drv"]]
            ok = R.route_net(name, drivers, nd["ld"], ext_pins=pins.get(name, []))
            if not ok:
                self.failed = name
                self.R = R
                return None
        srcmap = {}
        for name in names:
            nd = nets.get(name, {"drv": [], "ld": []})
            srcmap[name] = [(tp(g)[0], tp(g)[1], 0) for g in nd["drv"]]
            if ext_src is not None and name in ext_src:
                srcmap[name] += list(ext_src[name])
            elif name in self.nl.ext_in:
                srcmap[name] += pins.get(name, [])
        R.assign_repeaters(srcmap)
        self.R = R
        return R

def dump(R: Router, d: "Design"):
    """ASCII-картинка решётки"""
    W = R.ni * 2 - 1; H = R.nj * 2 - 1
    rows = [[" "] * (W * 2) for _ in range(H)]
    out = []
    for j in range(R.nj):
        line = ""
        for i in range(R.ni):
            gt = R.gates.get((i, j))
            if gt:
                ch = f"[{gt.out[:2]:<2}]"
            else:
                o = R.node.get((i, j, 0)); o2 = R.node.get((i, j, 2))
                ch = " ." if (o is None and o2 is None) else " " + (("o" if o else " ") if True else "")
                ch = (("0" if o is not None else " ") + ("2" if o2 is not None else " ")).ljust(4)
            line += ch
            # улица вправо
            if i + 1 < R.ni:
                key = R.skey((i, j), (i + 1, j))
                s0 = R.street.get((key, 0)); s2 = R.street.get((key, 2))
                line += ("-" if s0 is not None and s0 != ("blocked", 0) else " ") + ("=" if s2 is not None else " ")
        out.append(line)
        if j + 1 < R.nj:
            line = ""
            for i in range(R.ni):
                key = R.skey((i, j), (i, j + 1))
                s0 = R.street.get((key, 0)); s2 = R.street.get((key, 2))
                line += ("|" if s0 is not None else " ") + ("#" if s2 is not None else " ")
                line += "    "
            out.append(line)
    return "\n".join(out)


# ======================= PathFinder (негоциируемая трассировка) =======================

class PFRouter(Router):
    """Router с итеративной трассировкой. Жёсткие ресурсы: узлы вентилей, пины, терминалы входов/выходов,
    улицы факелов/входов. Мягкие: остальные узлы и улицы на слоях 0/2 (ёмкость 1)."""

    blk = frozenset()          # заблокированные узлы (i,j) — препятствия (модули)
    pin_nodes = {}             # (i,j) -> имя сети

    def _node_ok(self, i, j, net):
        if (i, j) in self.blk:
            return self.pin_nodes.get((i, j)) == net
        return True

    def setup_hard(self, nets_spec):
        """nets_spec: name -> {'terms': [узлы слой0 (i,j,l)], ...} — все терминалы уже занимают узлы (self.node)"""
        self.hard_node = {}
        for k, v in self.node.items():
            self.hard_node[k] = v
        self.hard_street = dict(self.street)
        self.use = defaultdict(set)       # ресурс -> множество сетей
        self.hist = defaultdict(float)
        self.routes = {}                  # net -> (path-list of (path,moves))

    # ресурсы
    @staticmethod
    def rn(i, j, l):
        return ("n", i, j, l)

    @staticmethod
    def rs(key, l):
        return ("s", key, l)

    def _hard_blocked_node(self, i, j, l, net):
        o = self.hard_node.get((i, j, l))
        return o is not None and o != net

    def _hard_blocked_street(self, key, l, net):
        o = self.hard_street.get((key, l))
        if o is None:
            return False
        if isinstance(o, tuple) and o[0] == "in" and o[1] == net:
            return False
        return True

    def pf_neighbors(self, n, net, pf):
        i, j, l = n
        for d, (di, dj) in D.items():
            i2, j2 = i + di, j + dj
            if not self.inb(i2, j2):
                continue
            key = self.skey((i, j), (i2, j2))
            touches = self._touches_gate(key)
            if l == 0 and (i2, j2) in self.gates:
                continue
            # плоский
            if not (l == 0 and touches) and not self._hard_blocked_street(key, l, net) \
                    and not self._hard_blocked_node(i2, j2, l, net) and self._node_ok(i2, j2, net) \
                    and key not in self._cur_ramp \
                    and not (l == 2 and ((i2, j2) in self._cur_low or (i, j) in self._cur_low)):
                if not (l == 2 and (i2, j2) in self._air_hard) and not (l == 2 and (i, j) in self._air_hard):
                    res = [self.rn(i2, j2, l), self.rs(key, l)]
                    yield (i2, j2, l), self._cost(res, net, pf), ("flat", key)
            # рампа
            if touches:
                continue
            if self._hard_blocked_street(key, 0, net) or self._hard_blocked_street(key, 2, net):
                continue
            if l == 0:
                low, high = (i, j), (i2, j2)
            else:
                low, high = (i2, j2), (i, j)
            if low in self.gates or (high in self.gates and False):
                continue
            if not (self._node_ok(low[0], low[1], net) and self._node_ok(high[0], high[1], net)):
                continue
            if self._hard_blocked_node(low[0], low[1], 0, net) or self._hard_blocked_node(high[0], high[1], 2, net) \
                    or self._hard_blocked_node(low[0], low[1], 2, net):
                continue
            if self.hard_node.get((low[0], low[1], 2)) is not None:
                continue
            if key in self._cur_flat or low in self._cur_d2:
                continue
            res = [self.rs(key, 0), self.rs(key, 2), self.rn(low[0], low[1], 2), self.rn(high[0], high[1], 2),
                   self.rn(low[0], low[1], 0)]
            target = (i2, j2, 2) if l == 0 else (i2, j2, 0)
            yield target, self._cost(res, net, pf) + 2.0, ("ramp", key, low, high)

    def _cost(self, res, net, pf):
        c = 0.0
        for r in res:
            users = self.use.get(r)
            others = 0
            if users:
                others = len(users - {net})
            c += (1.0 + self.hist[r]) * (1.0 + pf * others)
        return c

    def pf_astar(self, sources, target, net, pf):
        tgt = (target[0], target[1])
        def h(n):
            return abs(n[0] - tgt[0]) + abs(n[1] - tgt[1])
        openq = []
        gscore = {}
        came = {}
        for s in sources:
            gscore[s] = 0.0
            heapq.heappush(openq, (h(s), 0.0, s))
        while openq:
            f, g, n = heapq.heappop(openq)
            if g > gscore.get(n, 1e18):
                continue
            if n == target:
                path = [n]; moves = []
                while n in came:
                    p, mv = came[n]
                    moves.append(mv); n = p; path.append(n)
                path.reverse(); moves.reverse()
                return path, moves
            lastkey = came[n][1][1] if n in came else None
            for n2, c, mv in self.pf_neighbors(n, net, pf):
                if mv[1] == lastkey:
                    continue
                ng = g + c
                if ng < gscore.get(n2, 1e18):
                    gscore[n2] = ng
                    came[n2] = (n, mv)
                    heapq.heappush(openq, (ng + h(n2), ng, n2))
        return None

    def _path_resources(self, path, moves):
        res = []
        for n in path:
            res.append(self.rn(*n))
        for (a, b), mv in zip(zip(path[:-1], path[1:]), moves):
            if mv[0] == "flat":
                res.append(self.rs(mv[1], a[2]))
            else:
                key, low, high = mv[1], mv[2], mv[3]
                res += [self.rs(key, 0), self.rs(key, 2), self.rn(low[0], low[1], 2)]
        return res

    def route_all(self, terms, iters=40, pf0=0.6, pf_mult=1.6, order=None, verbose=False):
        """terms: net -> [терминальные узлы (i,j,l)]; возвращает True при успехе."""
        self._air_hard = set()
        self._cur_ramp, self._cur_flat, self._cur_low, self._cur_d2 = set(), set(), set(), set()
        names = list(terms.keys())
        def span(n):
            pts = terms[n]
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            return (max(xs) - min(xs)) + (max(ys) - min(ys))
        names.sort(key=span)
        pf = pf0
        for it in range(iters):
            for net in names:
                # rip-up
                for r in self._net_res.get(net, ()) if hasattr(self, "_net_res") else ():
                    self.use[r].discard(net)
                if not hasattr(self, "_net_res"):
                    self._net_res = {}
                pts = [tuple(p) for p in terms[net]]
                if len(pts) < 2:
                    self._net_res[net] = set(self.rn(*p) for p in pts)
                    for r in self._net_res[net]:
                        self.use[r].add(net)
                    self.routes[net] = []
                    continue
                tree = {pts[0]}
                rest = list(pts[1:])
                res_all = {self.rn(*pts[0])}
                segs = []
                self._cur_ramp, self._cur_flat, self._cur_low, self._cur_d2 = set(), set(), set(), set()
                if pts[0][2] == 2:
                    self._cur_d2.add((pts[0][0], pts[0][1]))
                while rest:
                    best = None
                    for t in rest:
                        r_ = self.pf_astar(list(tree), t, net, pf)
                        if r_ is None:
                            continue
                        cost = len(r_[0])
                        if best is None or cost < best[0]:
                            best = (cost, t, r_)
                    if best is None:
                        self.failed = net
                        return False
                    _, t, (path, moves) = best
                    segs.append((path, moves))
                    tree.update(path)
                    for n_ in path:
                        if n_[2] == 2:
                            self._cur_d2.add((n_[0], n_[1]))
                    for (a_, b_), mv in zip(zip(path[:-1], path[1:]), moves):
                        if mv[0] == "ramp":
                            self._cur_ramp.add(mv[1]); self._cur_low.add(mv[2])
                        else:
                            self._cur_flat.add(mv[1])
                    res_all.update(self._path_resources(path, moves))
                    rest.remove(t)
                # занимаем
                for r in res_all:
                    self.use[r].add(net)
                self._net_res[net] = res_all
                self.routes[net] = segs
            # перегрузка
            over = [r for r, u in self.use.items() if len(u) > 1]
            if verbose:
                print(f"  итерация {it}: перегрузка {len(over)}, pf={pf:.2f}")
            if not over:
                self._commit_all(terms)
                return True
            for r in over:
                self.hist[r] += 0.5 * (len(self.use[r]) - 1)
            pf *= pf_mult
        self.failed = "перегрузка не снята"
        return False

    def _commit_all(self, terms):
        for net, segs in self.routes.items():
            for path, moves in segs:
                self.commit_path(path, moves, net)
            for p in terms.get(net, []):
                self.node[tuple(p)] = net


def _design_route_pf(self, ext_pins=None, ext_src=None, seed=0, iters=60, verbose=False):
    """PathFinder-маршрутизация. Возвращает Router или None"""
    R = PFRouter(self.ni, self.nj, self.ox, self.oz, self.y0)
    gates = self.nl.gates
    R.place_gates(gates)
    nets = self.nets()
    pins = {}
    for n, p in (ext_pins or {}).items():
        pins[n] = [tuple(p)] if isinstance(p, tuple) else [tuple(q) for q in p]
    for n, pl in pins.items():
        for p in pl:
            if R.node.get(p) not in (None, n):
                raise ValueError(f"пин {n}@{p} конфликтует с {R.node.get(p)}")
            R.node[p] = n
    R._extpins = pins
    def tp0(g):
        return (g.pos[0] + D[g.odir][0], g.pos[1] + D[g.odir][1])
    last_err = None
    for attempt in range(80):
        for k in [k for k, v in R.street.items() if isinstance(v, tuple) and v[0] == "in"]:
            del R.street[k]
        for g in gates:
            g.in_dirs = {}
        keep = set((p[0], p[1]) for pl in pins.values() for p in pl) | set(tp0(g) for g in gates)
        for k in [k for k, v in R.node.items() if not isinstance(v, tuple) and k[2] == 0 and (k[0], k[1]) not in keep]:
            del R.node[k]
        try:
            R.reserve_inputs(gates, nets, tp0, random.Random(seed * 100 + attempt))
            last_err = None
            break
        except ValueError as e:
            last_err = e
    if last_err is not None:
        self.failed = str(last_err); self.R = R
        return None
    terms = {}
    for name, nd in nets.items():
        ts = [(tp0(g)[0], tp0(g)[1], 0) for g in nd["drv"]]
        for (g, idx) in nd["ld"]:
            dd = g.in_dirs[idx]
            ts.append((g.pos[0] + D[dd][0], g.pos[1] + D[dd][1], 0))
        ts += pins.get(name, [])
        # убрать дубликаты, сохранить порядок
        seen = []
        for t in ts:
            if t not in seen:
                seen.append(t)
        terms[name] = seen
    for n in pins:
        if n not in terms:
            terms[n] = list(dict.fromkeys(pins[n]))
    R.setup_hard(terms)
    ok = R.route_all(terms, iters=iters, verbose=verbose)
    if not ok:
        self.failed = R.failed; self.R = R
        return None
    srcmap = {}
    for name, nd in nets.items():
        srcmap[name] = [(tp0(g)[0], tp0(g)[1], 0) for g in nd["drv"]]
    for name in set(list(srcmap) + list(pins)):
        srcmap.setdefault(name, [])
        if ext_src is not None and name in ext_src:
            srcmap[name] += [tuple(p) for p in ext_src[name]]
        elif name in self.nl.ext_in:
            srcmap[name] += pins.get(name, [])
    reverse = {}
    for name, nd in nets.items():
        if nd["drv"] and not nd["ld"] and name in pins:
            reverse[name] = list(pins[name])
    R.assign_repeaters(srcmap, reverse=reverse)
    self.R = R
    return R

Design.route_pf = _design_route_pf
