"""Размещение модулей по этажам: отжиг по (x, z, этаж). Юниты на разных этажах могут лежать друг над другом;
«высокие» юниты (ПЗУ-башня) занимают все этажи."""
import math, random


def anneal3(units, mods, nets, nfloors=2, halo=8, iters=60000, seed=1, aspect=1.0, w_bbox=40.0, verbose=True,
            pin_k=1.0, tall=(), fixed_floor=None, w_floor=12.0):
    rnd = random.Random(seed)
    tall = set(tall)
    fixed_floor = dict(fixed_floor or {})
    U = {u.name: u for u in units}
    where = {}
    for u in units:
        for (mn, dx, dz) in u.members:
            where[mn] = (u, dx, dz)
    pos, fl = {}, {}
    h2 = halo // 2

    def margins(u):
        m = lambda d: min(70, h2 + int(pin_k * u.pins[d]))
        return m("W"), m("E"), m("N"), m("S")
    MG = {u.name: margins(u) for u in units}

    def rect(u, p=None):
        px, pz = p if p is not None else pos[u.name]
        l, r, t, b = MG[u.name]
        return (px + u.x0 - l, pz + u.z0 - t, px + u.x1 + r, pz + u.z1 + b)

    def body(u, p=None):
        px, pz = p if p is not None else pos[u.name]
        return (px + u.x0, pz + u.z0, px + u.x1, pz + u.z1)

    def area(a, b):
        w = min(a[2], b[2]) - max(a[0], b[0])
        h = min(a[3], b[3]) - max(a[1], b[1])
        return w * h if w > 0 and h > 0 else 0

    def legal(u, p, f=None, ignore=()):
        """тот же этаж (или высокий юнит): прямоугольники с запасами не пересекаются;
        разные этажи: тела можно ставить друг над другом, но тело не должно заходить в запас (выходы пинов) чужого модуля"""
        f = fl[u.name] if f is None else f
        a, ba = rect(u, p), body(u, p)
        for v in units:
            if v is u or v.name in ignore or v.name not in pos:
                continue
            b, bb = rect(v), body(v)
            if u.name in tall or v.name in tall or fl[v.name] == f:
                if min(a[2], b[2]) - max(a[0], b[0]) > 0 and min(a[3], b[3]) - max(a[1], b[1]) > 0:
                    return False
            else:
                if area(ba, b) != area(ba, bb) or area(bb, a) != area(bb, ba):
                    return False
        return True

    # ---- начальная расстановка: этажи выравниваем по площади, на каждом этаже — «полками»
    order = sorted(units, key=lambda u: -u.h)
    total = sum((u.w + 2 * halo) * (u.h + 2 * halo) for u in units)
    maxw = int(math.sqrt(total / max(1, nfloors)) * 1.25)
    used = [0] * nfloors
    cur_x = [0] * nfloors; cur_z = [0] * nfloors; row_h = [0] * nfloors
    for u in sorted(units, key=lambda u: (u.name not in tall, -u.h)):
        if u.name in fixed_floor:
            f = fixed_floor[u.name]
        elif u.name in tall:
            f = 0
        else:
            f = min(range(nfloors), key=lambda k: used[k])
        fl[u.name] = f
        W = u.w + MG[u.name][0] + MG[u.name][1]
        placed = False
        for _ in range(4000):
            if cur_x[f] + W > maxw and cur_x[f] > 0:
                cur_x[f] = 0; cur_z[f] += row_h[f] + 4; row_h[f] = 0
            c = (2 * ((cur_x[f] + MG[u.name][0] - u.x0) // 2), 2 * ((cur_z[f] + MG[u.name][2] - u.z0) // 2))
            if legal(u, c):
                pos[u.name] = c; placed = True
                cur_x[f] += W + 2
                row_h[f] = max(row_h[f], u.h + MG[u.name][2] + MG[u.name][3])
                break
            cur_x[f] += 10
        assert placed, u.name
        used[f] += u.w * u.h

    def pin(mn, pn):
        u, dx, dz = where[mn]
        px, pz = pos[u.name]
        (xx, zz, d) = mods[mn].ports[pn]
        return px + dx + xx, pz + dz + zz, fl[u.name]

    netpins = [[(mn, pn) for (mn, pn) in [src] + sinks] for (_, src, sinks) in nets]
    by_unit = {u.name: set() for u in units}
    for ni, np_ in enumerate(netpins):
        for (mn, pn) in np_:
            by_unit[where[mn][0].name].add(ni)

    def net_cost(ni):
        xs, zs, fs = [], [], []
        for (mn, pn) in netpins[ni]:
            x_, z_, f_ = pin(mn, pn); xs.append(x_); zs.append(z_); fs.append(f_)
        return (max(xs) - min(xs)) + (max(zs) - min(zs)) + w_floor * (max(fs) - min(fs))

    def bbox_cost():
        rs = [rect(u) for u in units]
        w = max(r[2] for r in rs) - min(r[0] for r in rs)
        h = max(r[3] for r in rs) - min(r[1] for r in rs)
        return w_bbox * (w + h) + 30 * abs(w - h * aspect)

    ncost = [net_cost(i) for i in range(len(netpins))]
    cur = sum(ncost) + bbox_cost()
    best = (cur, dict(pos), dict(fl))
    names = [u.name for u in units]
    movable = [n for n in names if n not in fixed_floor and n not in tall]
    T0 = 2500.0

    def median_target(u):
        xs, zs = [], []
        for ni in by_unit[u.name]:
            for (mn, pn) in netpins[ni]:
                if where[mn][0] is u:
                    continue
                x_, z_, _ = pin(mn, pn); xs.append(x_); zs.append(z_)
        if not xs:
            return None
        xs.sort(); zs.sort()
        return xs[len(xs) // 2], zs[len(zs) // 2]

    def nearest_legal(u, tx, tz, f):
        cx, cz = tx - (u.x0 + u.w // 2), tz - (u.z0 + u.h // 2)
        cx, cz = 2 * (cx // 2), 2 * (cz // 2)
        for rad in range(0, 400, 4):
            cand = [(cx, cz)] if rad == 0 else []
            for k in range(0, 8):
                a = k * math.pi / 4
                cand.append((2 * (int(cx + rad * math.cos(a)) // 2), 2 * (int(cz + rad * math.sin(a)) // 2)))
            rnd.shuffle(cand)
            for c in cand:
                if legal(u, c, f):
                    return c
        return None

    for it in range(iters):
        T = T0 * (1 - it / iters) ** 2 + 1.0
        u = U[rnd.choice(names)]
        old, oldf = pos[u.name], fl[u.name]
        r = rnd.random()
        moved = [u]; olds = {u.name: (old, oldf)}
        if r < 0.18:                                   # прыжок к медиане связей (возможно, на другой этаж)
            t = median_target(u)
            if t is None:
                continue
            f = oldf
            if u.name in movable and nfloors > 1 and rnd.random() < 0.4:
                f = rnd.randrange(nfloors)
            c = nearest_legal(u, t[0] + rnd.randint(-20, 20), t[1] + rnd.randint(-20, 20), f)
            if c is None or (c == old and f == oldf):
                continue
            pos[u.name] = c; fl[u.name] = f
        elif r < 0.30:                                 # обмен позициями юнитов одного этажа
            v = U[rnd.choice(names)]
            if v is u or u.name in tall or v.name in tall or fl[v.name] != oldf:
                continue
            pu, pv = pos[u.name], pos[v.name]
            cu = (pu[0] + u.x0 + u.w // 2, pu[1] + u.z0 + u.h // 2)
            cv = (pv[0] + v.x0 + v.w // 2, pv[1] + v.z0 + v.h // 2)
            nu = (2 * ((cv[0] - u.x0 - u.w // 2) // 2), 2 * ((cv[1] - u.z0 - u.h // 2) // 2))
            nv = (2 * ((cu[0] - v.x0 - v.w // 2) // 2), 2 * ((cu[1] - v.z0 - v.h // 2) // 2))
            pos[u.name] = nu; pos[v.name] = nv
            moved = [u, v]; olds = {u.name: (pu, oldf), v.name: (pv, fl[v.name])}
            if not (legal(u, nu) and legal(v, nv)):
                pos[u.name], pos[v.name] = pu, pv
                continue
        elif r < 0.38 and u.name in movable and nfloors > 1:     # смена этажа на месте
            f = rnd.randrange(nfloors)
            if f == oldf or not legal(u, old, f):
                continue
            fl[u.name] = f
        else:                                          # сдвиг
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
                best = (cur, dict(pos), dict(fl))
        else:
            for ni, c in old_nc.items():
                ncost[ni] = c
            for m in moved:
                pos[m.name], fl[m.name] = olds[m.name]
        if verbose and it % 10000 == 0:
            print(f"  отжиг {it}: {cur:.0f} (лучшее {best[0]:.0f})")
    pos, fl = best[1], best[2]
    out, floors = {}, {}
    for mn, (u, dx, dz) in where.items():
        out[mn] = (pos[u.name][0] + dx, pos[u.name][1] + dz)
        floors[mn] = fl[u.name]
    return out, floors
