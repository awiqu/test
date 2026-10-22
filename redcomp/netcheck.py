"""Офлайн-проверка проложенных цепей: достижимость стоков от источника и уровень сигнала (пыль/повторители)."""
import heapq
from .grid import Grid

DV = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
OPP = {"north": "south", "south": "north", "east": "west", "west": "east"}
FACE_FLOW = {"north": (0, 1), "south": (0, -1), "east": (-1, 0), "west": (1, 0)}   # facing -> куда течёт выход (противоположно facing)


def _flow(b):
    dx, dz = FACE_FLOW[b.props["facing"]]
    return dx, dz


def neighbors(g: Grid, p, level, decay=True):
    """(следующая клетка, новый уровень) от клетки p с уровнем level (пыль p несёт level)."""
    x, y, z = p
    b = g.b[p]
    res = []
    if b.name == "redstone_wire":
        for d, (dx, dz) in DV.items():
            c = b.props.get(d, "none")
            if c == "none":
                continue
            if c == "up":
                cands = [(x + dx, y + 1, z + dz)]
            else:
                cands = [(x + dx, y, z + dz), (x + dx, y - 1, z + dz)]
            for q in cands:
                nb = g.b.get(q)
                if nb is None:
                    continue
                if nb.name == "redstone_wire":
                    if not decay or level - 1 >= 1:
                        res.append((q, level - 1 if decay else level))
                    break
                if nb.name in ("repeater", "comparator") and q[1] == y:
                    fx, fz = _flow(nb)
                    # вход повторителя — со стороны, противоположной потоку: клетка p должна лежать «сзади»
                    if (x, z) == (q[0] - fx, q[2] - fz):
                        res.append((q, level))
                    break
    elif b.name == "repeater":
        fx, fz = _flow(b)
        q = (x + fx, y, z + fz)
        nb = g.b.get(q)
        if nb is not None and nb.name == "redstone_wire":
            res.append((q, 15))
        elif nb is not None and nb.name == "repeater":
            res.append((q, 15))
        # выход на твёрдый блок: пыль сверху и по бокам получает питание
        if nb is not None and nb.name not in ("redstone_wire", "repeater", "comparator"):
            for q2 in ((q[0], q[1] + 1, q[2]),):
                n2 = g.b.get(q2)
                if n2 is not None and n2.name == "redstone_wire":
                    res.append((q2, 15))
    return res


def reach(g: Grid, src, start_level=15):
    """лучший достижимый уровень в каждой клетке"""
    best = {}
    pq = [(-start_level, src)]
    while pq:
        nl, p = heapq.heappop(pq)
        lv = -nl
        if best.get(p, 0) >= lv:
            continue
        best[p] = lv
        for q, l2 in neighbors(g, p, lv):
            if best.get(q, 0) < l2:
                heapq.heappush(pq, (-l2, q))
    return best


def cells_of(g: Grid, src):
    """все клетки, электрически связанные с источником (без учёта затухания)"""
    seen = {src}
    st = [src]
    while st:
        p = st.pop()
        if p != src and g.b[p].name in ("repeater", "comparator"):
            continue                       # граница компонента: за повторитель не идём (это не замыкание)
        for q, _ in neighbors(g, p, 15, decay=False):
            if q not in seen:
                seen.add(q); st.append(q)
    return seen


def find_shorts(g: Grid, nets, verbose=True, net_y=None):
    """замыкания между цепями: клетка достижима из источников двух разных цепей"""
    owner, shorts = {}, []
    net_y = net_y or {}
    for name, src, sinks in nets:
        for c in cells_of(g, (src[0], net_y.get(name, [0])[0], src[1])):
            if c in owner and owner[c] != name:
                shorts.append((owner[c], name, c))
            else:
                owner[c] = name
    if verbose:
        for sh in shorts[:20]:
            print("  ЗАМЫКАНИЕ:", sh)
        print(f"find_shorts: {len(shorts)}")
    return shorts


def check_nets(g: Grid, nets, weak=(), verbose=True, net_y=None):
    """nets: [(name, (x,z,dir), [(x,z,dir)...])]; возвращает список проблем"""
    problems = []
    net_y = net_y or {}
    for name, src, sinks in nets:
        ys = net_y.get(name) or [0] * (1 + len(sinks))
        sp = (src[0], ys[0], src[1])
        lvl = 15
        best = reach(g, sp, lvl)
        for sk, yk in zip(sinks, ys[1:]):
            q = (sk[0], yk, sk[1])
            l = best.get(q, 0)
            if l < 1:
                problems.append((name, "сток недостижим", q))
            elif l < 13:
                problems.append((name, f"слабый сигнал {l}", q))
    if verbose:
        for p in problems[:40]:
            print("  ПРОБЛЕМА:", p)
        print(f"netcheck: проблем {len(problems)} из {len(nets)} цепей")
    return problems
