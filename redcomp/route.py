"""Канальный маршрутизатор для шин: вертикальные участки на y=0, дорожки (треки) на y=2.

Канал идёт вдоль оси u (направление потока), дорожки лежат вдоль оси v.
frame='z': u = +Z, v = +X.  frame='x': u = +X, v = +Z.
Сигналы входят в (v_src, 0, u0) и выходят в (v_dst, 0, u_end).
"""
from .grid import Grid


class Frame:
    def __init__(self, axis):
        assert axis in ("z", "x")
        self.axis = axis

    def p(self, u, y, v):
        return (v, y, u) if self.axis == "z" else (u, y, v)

    @property
    def flow(self):
        return "south" if self.axis == "z" else "east"


def _line(g, fr, u_a, u_b, v, y=0, step_rep=12, mat="stone", rep=True):
    """прямая пыль вдоль u от u_a до u_b (включительно) на (v,y), с повторителями"""
    n = 0
    for u in range(u_a, u_b + 1):
        x, yy, z = fr.p(u, y, v)
        n += 1
        if rep and n >= step_rep and u not in (u_a, u_b):
            g.repeater(x, yy, z, fr.flow); n = 0
        else:
            g.dust(x, yy, z)


def channel(g: Grid, fr: Frame, u0, nets, mat="stone", rep_every=12):
    """nets: список (name, v_src, [v_dst,...]). Возвращает u_end, trackrows.
    Дорожка k лежит на u = u0 + 3 + 4*k. Сквозная связь (один v, один dst) — прямая линия."""
    # разделим на прямые и ломаные
    straight = [(n, s, d) for (n, s, d) in nets if len(d) == 1 and d[0] == s]
    bent = [(n, s, d) for (n, s, d) in nets if not (len(d) == 1 and d[0] == s)]
    # назначение дорожек: жадно по левому краю; зазор >=2 между пролётами на одной дорожке
    spans = []
    for (n, s, d) in bent:
        vs = [s] + list(d)
        spans.append((min(vs), max(vs), n, s, d))
    spans.sort()
    tracks = []     # список (v_max занятый)
    assign = {}
    for (lo, hi, n, s, d) in spans:
        for k, last in enumerate(tracks):
            if lo >= last + 3:        # >=2 свободных клетки между (чтобы пыль не касалась)
                tracks[k] = hi; assign[n] = k; break
        else:
            tracks.append(hi); assign[n] = len(tracks) - 1
    T = len(tracks)
    u_end = u0 + 3 + 4 * T + 1
    # проверка коллизий столбцов
    used = {}
    for (n, s, d) in straight:
        used.setdefault(s, []).append((n, u0, u_end))
    for (n, s, d) in bent:
        tk = u0 + 3 + 4 * assign[n]
        used.setdefault(s, []).append((n + ":src", u0, tk - 2))
        for dv in d:
            used.setdefault(dv, []).append((n + ":dst", tk + 2, u_end))
    for v, lst in used.items():
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                a, b = lst[i], lst[j]
                if not (a[2] < b[1] or b[2] < a[1]):
                    raise ValueError(f"канал: пересечение сегментов столбца v={v}: {a} / {b}")
    # соседние столбцы (расстояние 1) с перекрытием по u — запрещено
    vs_sorted = sorted(used)
    for v in vs_sorted:
        if v + 1 in used:
            for a in used[v]:
                for b in used[v + 1]:
                    if not (a[2] < b[1] or b[2] < a[1]):
                        raise ValueError(f"канал: соседние столбцы {v},{v+1} пересекаются по u: {a} {b}")
    # рисуем
    for (n, s, d) in straight:
        _line(g, fr, u0, u_end, s, mat=mat, step_rep=rep_every)
    for (n, s, d) in bent:
        k = assign[n]
        tk = u0 + 3 + 4 * k
        vs = [s] + list(d)
        lo, hi = min(vs), max(vs)
        # исток: вниз до tk-2 (y=0), рампа вверх
        _line(g, fr, u0, tk - 3, s, mat=mat, step_rep=rep_every)
        x, y, z = fr.p(tk - 2, 0, s); g.repeater(x, y, z, fr.flow)
        x, y, z = fr.p(tk - 1, 0, s); g.solid(x, y, z, mat)
        x, y, z = fr.p(tk - 1, 1, s); g.dust(x, y, z)
        # дорожка y=2 со стеной y=1
        for v in range(lo, hi + 1):
            x, y, z = fr.p(tk, 1, v); g.solid(x, y, z, mat)
        flow_p = "east" if fr.axis == "z" else "south"
        flow_m = "west" if fr.axis == "z" else "north"
        for v in range(lo, hi + 1):
            x, y, z = fr.p(tk, 2, v); g.dust(x, y, z)
        for (rng, flow) in ((range(s + rep_every, hi, rep_every), flow_p), (range(s - rep_every, lo, -rep_every), flow_m)):
            for v in rng:
                if v in d:
                    continue
                x, y, z = fr.p(tk, 2, v); g.repeater(x, y, z, flow)
        # приёмники: рампа вниз
        for dv in d:
            x, y, z = fr.p(tk + 1, 0, dv); g.solid(x, y, z, mat)
            x, y, z = fr.p(tk + 1, 1, dv); g.dust(x, y, z)
            x, y, z = fr.p(tk + 2, 0, dv); g.repeater(x, y, z, fr.flow)
            _line(g, fr, tk + 3, u_end, dv, mat=mat, step_rep=rep_every)
    return u_end, assign
