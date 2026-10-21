"""Размещение модулей отжигом: минимизируем суммарную полупериметровую длину цепей + штраф перекрытий."""
import math, random


class Unit:
    """жёсткая группа модулей: members = [(имя, dx, dz)], размеры в блоках"""
    def __init__(self, name, members, mods):
        self.name, self.members = name, members
        xs0, zs0, xs1, zs1 = [], [], [], []
        for (mn, dx, dz) in members:
            b = mods[mn].bbox()
            xs0.append(b[0] + dx); zs0.append(b[1] + dz); xs1.append(b[2] + dx); zs1.append(b[3] + dz)
        self.x0, self.z0, self.x1, self.z1 = min(xs0), min(zs0), max(xs1), max(zs1)
        self.w, self.h = self.x1 - self.x0 + 1, self.z1 - self.z0 + 1
        cnt = {"W": 0, "E": 0, "N": 0, "S": 0}
        for (mn, dx, dz) in members:
            for (x, z, d) in mods[mn].ports.values():
                cnt[d] += 1
        self.pins = cnt


def make_units(mods, groups):
    """groups: имя_юнита -> [(мод, dx, dz)]; остальные модули — по одному"""
    used = {m for g in groups.values() for (m, _, _) in g}
    units = [Unit(n, g, mods) for n, g in groups.items()]
    units += [Unit(n, [(n, 0, 0)], mods) for n in mods if n not in used]
    return units


def anneal(units, mods, nets, halo=20, iters=60000, seed=1, aspect=1.0, w_bbox=40.0, verbose=True, pin_k=1.0):
    """Отжиг только по допустимым (непересекающимся) положениям: сдвиги, прыжки к медиане связей, обмены."""
    rnd = random.Random(seed)
    U = {u.name: u for u in units}
    where = {}
    for u in units:
        for (mn, dx, dz) in u.members:
            where[mn] = (u, dx, dz)
    pos = {}
    order = sorted(units, key=lambda u: -u.h)
    x = z = rowh = 0
    maxw = int(math.sqrt(sum((u.w + halo) * (u.h + halo) for u in units)) * 1.2)
    for u in order:
        if x + u.w > maxw:
            x, z, rowh = 0, z + rowh + halo, 0
        pos[u.name] = (2 * ((x - u.x0) // 2), 2 * ((z - u.z0) // 2))
        x += u.w + halo; rowh = max(rowh, u.h)

    def pin(mn, pn):
        u, dx, dz = where[mn]
        px, pz = pos[u.name]
        (xx, zz, d) = mods[mn].ports[pn]
        return px + dx + xx, pz + dz + zz

    netpins = [[(mn, pn) for (mn, pn) in [src] + sinks] for (_, src, sinks) in nets]
    by_unit = {u.name: set() for u in units}
    for ni, np_ in enumerate(netpins):
        for (mn, pn) in np_:
            by_unit[where[mn][0].name].add(ni)

    def net_cost(ni):
        xs, zs = [], []
        for (mn, pn) in netpins[ni]:
            x_, z_ = pin(mn, pn); xs.append(x_); zs.append(z_)
        return (max(xs) - min(xs)) + (max(zs) - min(zs))

    h2 = halo // 2

    def margins(u):
        # каждая сторона получает запас под каналы: базовый + по пину (в блоках), не более 70
        m = lambda d: min(70, h2 + int(pin_k * u.pins[d]))
        return m("W"), m("E"), m("N"), m("S")
    MG = {u.name: margins(u) for u in units}

    def rect(u, p=None):
        px, pz = p if p is not None else pos[u.name]
        l, r, t, b = MG[u.name]
        return (px + u.x0 - l, pz + u.z0 - t, px + u.x1 + r, pz + u.z1 + b)

    def legal(u, p, ignore=()):
        a = rect(u, p)
        for v in units:
            if v is u or v.name in ignore:
                continue
            b = rect(v)
            if min(a[2], b[2]) - max(a[0], b[0]) > 0 and min(a[3], b[3]) - max(a[1], b[1]) > 0:
                return False
        return True

    def bbox_cost():
        rs = [rect(u) for u in units]
        w = max(r[2] for r in rs) - min(r[0] for r in rs)
        h = max(r[3] for r in rs) - min(r[1] for r in rs)
        return w_bbox * (w + h) + 30 * abs(w - h * aspect)

    ncost = [net_cost(i) for i in range(len(netpins))]
    cur = sum(ncost) + bbox_cost()
    best = (cur, dict(pos))
    names = [u.name for u in units]
    T0 = 2500.0

    def median_target(u):
        xs, zs = [], []
        for ni in by_unit[u.name]:
            for (mn, pn) in netpins[ni]:
                if where[mn][0] is u:
                    continue
                x_, z_ = pin(mn, pn); xs.append(x_); zs.append(z_)
        if not xs:
            return None
        xs.sort(); zs.sort()
        return xs[len(xs) // 2], zs[len(zs) // 2]

    def nearest_legal(u, tx, tz):
        cx, cz = tx - (u.x0 + u.w // 2), tz - (u.z0 + u.h // 2)
        cx, cz = 2 * (cx // 2), 2 * (cz // 2)
        for rad in range(0, 400, 4):
            cand = [(cx, cz)] if rad == 0 else []
            for k in range(0, 8):
                a = k * math.pi / 4
                cand.append((2 * (int(cx + rad * math.cos(a)) // 2), 2 * (int(cz + rad * math.sin(a)) // 2)))
            rnd.shuffle(cand)
            for c in cand:
                if legal(u, c):
                    return c
        return None

    for it in range(iters):
        T = T0 * (1 - it / iters) ** 2 + 1.0
        u = U[rnd.choice(names)]
        old = pos[u.name]
        r = rnd.random()
        moved = [u]; olds = {u.name: old}
        if r < 0.2:
            t = median_target(u)
            if t is None:
                continue
            c = nearest_legal(u, t[0] + rnd.randint(-20, 20), t[1] + rnd.randint(-20, 20))
            if c is None or c == old:
                continue
            pos[u.name] = c
        elif r < 0.3:
            v = U[rnd.choice(names)]
            if v is u:
                continue
            pu, pv = pos[u.name], pos[v.name]
            cu = (pu[0] + u.x0 + u.w // 2, pu[1] + u.z0 + u.h // 2)
            cv = (pv[0] + v.x0 + v.w // 2, pv[1] + v.z0 + v.h // 2)
            nu = (2 * ((cv[0] - u.x0 - u.w // 2) // 2), 2 * ((cv[1] - u.z0 - u.h // 2) // 2))
            nv = (2 * ((cu[0] - v.x0 - v.w // 2) // 2), 2 * ((cu[1] - v.z0 - v.h // 2) // 2))
            pos[u.name] = nu; pos[v.name] = nv
            moved = [u, v]; olds = {u.name: pu, v.name: pv}
            if not (legal(u, nu) and legal(v, nv)):
                pos[u.name], pos[v.name] = pu, pv
                continue
        else:
            step = int(max(2, rnd.expovariate(1 / (50 * (1 - it / iters) + 4))))
            dx, dz = rnd.choice((-1, 1)) * rnd.randint(0, step), rnd.choice((-1, 1)) * rnd.randint(0, step)
            c = (2 * ((old[0] + dx) // 2), 2 * ((old[1] + dz) // 2))
            if c == old or not legal(u, c):
                continue
            pos[u.name] = c
        nets_t = set()
        for m in moved:
            nets_t |= by_unit[m.name]
        old_nc = {ni: ncost[ni] for ni in nets_t}
        for ni in nets_t:
            ncost[ni] = net_cost(ni)
        new_cur = sum(ncost) + bbox_cost()
        d = new_cur - cur
        if d <= 0 or rnd.random() < math.exp(-d / T):
            cur = new_cur
            if cur < best[0]:
                best = (cur, dict(pos))
        else:
            for ni, c in old_nc.items():
                ncost[ni] = c
            for m in moved:
                pos[m.name] = olds[m.name]
        if verbose and it % 10000 == 0:
            print(f"  отжиг {it}: {cur:.0f} (лучшее {best[0]:.0f})")
    pos = best[1]
    out = {}
    for mn, (u, dx, dz) in where.items():
        out[mn] = (pos[u.name][0] + dx, pos[u.name][1] + dz)
    return out
