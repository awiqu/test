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
        pts = [(i, j, 0) for (i, j) in drivers] + list(ext_pins)
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
        # 2) нагрузки
        remaining = []
        for (g, idx) in loads:
            remaining.append((g, idx))
        if not tree and remaining:
            g, idx = remaining[0]
            for d, (di, dj) in D.items():
                key = self.skey(g.pos, (g.pos[0] + di, g.pos[1] + dj))
                t = (g.pos[0] + di, g.pos[1] + dj)
                if self.street.get((key, 0)) is None and self.inb(*t) and t not in self.gates and self.free_node(t[0], t[1], 0, net):
                    tree.add((t[0], t[1], 0)); self.node[(t[0], t[1], 0)] = net
                    self._claim_input((g, idx), d, key, net)
                    remaining = remaining[1:]
                    break
            else:
                return False
        while remaining:
            best = None
            for item in remaining:
                (g, idx) = item
                cands = []
                for d, (di, dj) in D.items():
                    t = (g.pos[0] + di, g.pos[1] + dj)
                    key = self.skey(g.pos, t)
                    if self.street.get((key, 0)) is not None:
                        continue
                    if not self.inb(*t) or t in self.gates:
                        continue
                    cands.append((d, (t[0], t[1], 0), key))
                if not cands:
                    return False
                res = self.astar(list(tree), [c[1] for c in cands], net)
                if res is None:
                    continue
                path, moves = res
                cost = len(path)
                if best is None or cost < best[0]:
                    best = (cost, item, path, moves, cands)
            if best is None:
                return False
            cost, item, path, moves, cands = best
            self.commit_path(path, moves, net)
            end = path[-1]
            for c in cands:
                if c[1] == end:
                    self._claim_input(item, c[0], c[2], net)
                    break
            tree.update(path)
            remaining.remove(item)
        return True

    def _claim_input(self, gi, d, key, net):
        g, idx = gi
        self.street[(key, 0)] = ("in", net)
        g.in_dirs[idx] = d

    # ---- повторители
    def assign_repeaters(self, sources, every=11):
        """sources: {net: [узлы-источники (i,j,l)]}; заполняет self.reps {(i,j,i2,j2,l): направление потока (от a к b)}"""
        self.reps = {}
        for net, edges in self.edges_of_net.items():
            adj = defaultdict(list)       # узел -> [(узел2, kind, key, l)]
            for (a, b, kind) in edges:
                key = self.skey((a[0], a[1]), (b[0], b[1]))
                adj[a].append((b, kind, key, a[2]))
                adj[b].append((a, kind, key, b[2]))
            srcs = [n for n in sources.get(net, []) if n in adj]
            if not srcs:
                continue
            # BFS: узел -> (счётчик клеток от источника/повторителя)
            dist = {n: 0 for n in srcs}
            from collections import deque
            dq = deque(srcs)
            seen = set(srcs)
            while dq:
                n = dq.popleft()
                for (m, kind, key, l) in adj[n]:
                    if m in seen:
                        continue
                    seen.add(m)
                    c = dist[n] + 2          # средина + узел
                    if kind == "flat" and c >= every:
                        # повторитель на средине (между n и m), поток n -> m
                        self.reps[(key, l, n[:2], m[:2])] = True
                        c = 1                # после повторителя: до узла m одна клетка
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

    def place(self, iters=60000, fixed=None, free_cols=None):
        """fixed: {имя_внешнего_сигнала: (i,j)}"""
        rng = self.rng
        gates = self.nl.gates
        nets = self.nets()
        ext = dict(fixed or {})
        used = set()
        # начальное размещение: случайно по свободным узлам с шагом (чтобы остались улицы)
        cells = [(i, j) for i in range(self.ni) for j in range(self.nj)]
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
                c = (rng.randrange(self.ni), rng.randrange(self.nj))
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

    def route(self, ext_pins=None, order=None, seed=0):
        """ext_pins: {имя: (i,j,l)} позиции внешних входов/выходов. Возвращает Router или None"""
        R = Router(self.ni, self.nj, self.ox, self.oz, self.y0)
        gates = self.nl.gates
        R.place_gates(gates)
        nets = self.nets()
        ext_pins = ext_pins or {}
        names = list(nets.keys())
        for n in ext_pins:
            if n not in nets: names.append(n)
        rng = random.Random(seed)
        def span(n):
            nd = nets.get(n, {"drv": [], "ld": []})
            pts = [(g.pos[0] + D[g.odir][0], g.pos[1] + D[g.odir][1]) for g in nd["drv"]] + [g.pos for g, _ in nd["ld"]]
            if n in ext_pins: pts.append(ext_pins[n][:2])
            if not pts: return 0
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            return (max(xs) - min(xs)) + (max(ys) - min(ys))
        names.sort(key=lambda n: (span(n) + rng.random() * (0 if order is None else order)))
        for name in names:
            nd = nets.get(name, {"drv": [], "ld": []})
            drivers = [(g.pos[0] + D[g.odir][0], g.pos[1] + D[g.odir][1]) for g in nd["drv"]]
            pins = []
            if name in ext_pins:
                pins.append(ext_pins[name])
            ok = R.route_net(name, drivers, nd["ld"], ext_pins=pins)
            if not ok:
                self.failed = name
                return None
        srcmap = {}
        for name in names:
            nd = nets.get(name, {"drv": [], "ld": []})
            srcmap[name] = [(g.pos[0] + D[g.odir][0], g.pos[1] + D[g.odir][1], 0) for g in nd["drv"]]
            if name in ext_pins and name in self.nl.ext_in:
                srcmap[name].append(ext_pins[name])
        R.assign_repeaters(srcmap)
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
