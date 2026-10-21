"""Экспорт сетки блоков: ванильные структуры .nbt (+датапак /place template), Sponge .schem, .litematic."""
import gzip, io, json, os, struct
from .grid import Grid

DATA_VERSION = 4903          # Minecraft 26.2


# ---------------------------------------------------------------- NBT
def _s(b, v):
    e = v.encode("utf-8")
    b.write(struct.pack(">H", len(e))); b.write(e)


class T:
    """типизированные обёртки NBT"""
    class Byte(int): pass
    class Short(int): pass
    class Int(int): pass
    class Long(int): pass
    class ByteArray(bytes): pass
    class IntArray(list): pass
    class LongArray(list): pass

    class List:
        def __init__(self, tag, items): self.tag, self.items = tag, items


def _tag_of(v):
    if isinstance(v, T.Byte): return 1
    if isinstance(v, T.Short): return 2
    if isinstance(v, T.Long): return 4
    if isinstance(v, bool): return 1
    if isinstance(v, int): return 3
    if isinstance(v, float): return 6
    if isinstance(v, T.ByteArray): return 7
    if isinstance(v, str): return 8
    if isinstance(v, T.List): return 9
    if isinstance(v, dict): return 10
    if isinstance(v, T.IntArray): return 11
    if isinstance(v, T.LongArray): return 12
    raise TypeError(type(v))


def _payload(b, v):
    t = _tag_of(v)
    if t == 1: b.write(struct.pack(">b", int(v)))
    elif t == 2: b.write(struct.pack(">h", int(v)))
    elif t == 3: b.write(struct.pack(">i", int(v)))
    elif t == 4: b.write(struct.pack(">q", int(v)))
    elif t == 6: b.write(struct.pack(">d", v))
    elif t == 7: b.write(struct.pack(">i", len(v))); b.write(bytes(v))
    elif t == 8: _s(b, v)
    elif t == 9:
        b.write(struct.pack(">bi", v.tag, len(v.items)))
        for it in v.items: _payload(b, it)
    elif t == 10:
        for k, x in v.items():
            b.write(struct.pack(">b", _tag_of(x))); _s(b, k); _payload(b, x)
        b.write(b"\x00")
    elif t == 11:
        b.write(struct.pack(">i", len(v)))
        for x in v: b.write(struct.pack(">i", x))
    elif t == 12:
        b.write(struct.pack(">i", len(v)))
        for x in v: b.write(struct.pack(">q", x))


def nbt_bytes(root: dict, name="", compress=True):
    b = io.BytesIO()
    b.write(b"\x0a"); _s(b, name); _payload(b, root)
    raw = b.getvalue()
    return gzip.compress(raw, 6, mtime=0) if compress else raw


def nbt_read(data: bytes):
    """минимальный читатель (для проверки собственных файлов)"""
    if data[:2] == b"\x1f\x8b": data = gzip.decompress(data)
    pos = [0]

    def rd(fmt):
        n = struct.calcsize(fmt); v = struct.unpack_from(fmt, data, pos[0]); pos[0] += n; return v[0]

    def rstr():
        n = rd(">H"); s = data[pos[0]:pos[0] + n].decode(); pos[0] += n; return s

    def payload(t):
        if t == 1: return rd(">b")
        if t == 2: return rd(">h")
        if t == 3: return rd(">i")
        if t == 4: return rd(">q")
        if t == 5: return rd(">f")
        if t == 6: return rd(">d")
        if t == 7:
            n = rd(">i"); v = data[pos[0]:pos[0] + n]; pos[0] += n; return v
        if t == 8: return rstr()
        if t == 9:
            tt = rd(">b"); n = rd(">i"); return [payload(tt) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = rd(">b")
                if tt == 0: return d
                k = rstr(); d[k] = payload(tt)
        if t == 11:
            n = rd(">i"); return [rd(">i") for _ in range(n)]
        if t == 12:
            n = rd(">i"); return [rd(">q") for _ in range(n)]
        raise ValueError(t)

    t = rd(">b"); rstr()
    return payload(t)


# ---------------------------------------------------------------- вспомогательное
def _props_str(v):
    if isinstance(v, bool): return "true" if v else "false"
    return str(v)


def bounds(g: Grid):
    xs = [p[0] for p in g.b]; ys = [p[1] for p in g.b]; zs = [p[2] for p in g.b]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


# ---------------------------------------------------------------- ванильная структура
def structure_nbt(blocks: dict, origin, size):
    """blocks: {(x,y,z): Block}; origin — угол (мин), size — (sx,sy,sz). Возвращает байты .nbt"""
    pal, plist, out = {}, [], []
    ox, oy, oz = origin
    for (x, y, z), b in blocks.items():
        key = (b.name, tuple(sorted((k, _props_str(v)) for k, v in b.props.items())))
        if key not in pal:
            pal[key] = len(plist)
            e = {"Name": "minecraft:" + b.name}
            if key[1]:
                e["Properties"] = {k: v for k, v in key[1]}
            plist.append(e)
        out.append({"pos": T.List(3, [T.Int(x - ox), T.Int(y - oy), T.Int(z - oz)]), "state": T.Int(pal[key])})
    root = {"DataVersion": T.Int(DATA_VERSION),
            "size": T.List(3, [T.Int(s) for s in size]),
            "palette": T.List(10, plist),
            "blocks": T.List(10, out),
            "entities": T.List(10, [])}
    return nbt_bytes(root)


def tiles(g: Grid, tile=96):
    """разбить сетку на плитки по (x,z): {(ti,tj): ((x0,y0,z0),(sx,sy,sz), blocks)}"""
    (x0, y0, z0), (x1, y1, z1) = bounds(g)
    res = {}
    for p, b in g.b.items():
        ti, tj = (p[0] - x0) // tile, (p[2] - z0) // tile
        res.setdefault((ti, tj), {})[p] = b
    out = {}
    for (ti, tj), bl in res.items():
        ox, oz = x0 + ti * tile, z0 + tj * tile
        sx = max(p[0] for p in bl) - ox + 1
        sz = max(p[2] for p in bl) - oz + 1
        out[(ti, tj)] = ((ox, y0, oz), (sx, y1 - y0 + 1, sz), bl)
    return out


def write_datapack(g: Grid, outdir, name="rc8", tile=96, base=(0, 0, 0), anchor=(0, 0, 0)):
    """датапак: data/<name>/structure/*.nbt + function/build.mcfunction (размещает плитки относительно ~ ~ ~
    и затем /clone на месте — чтобы сработали обновления блоков). Возвращает число плиток."""
    ns = name
    root = os.path.join(outdir, name)
    os.makedirs(os.path.join(root, "data", ns, "structure"), exist_ok=True)
    os.makedirs(os.path.join(root, "data", ns, "function"), exist_ok=True)
    with open(os.path.join(root, "pack.mcmeta"), "w") as f:
        json.dump({"pack": {"description": f"{name}: redstone computer",
                            "min_format": [107, 1], "max_format": [107, 1]}}, f)
    gx0, gy0, gz0 = anchor          # координата сетки, которая попадёт в ~ ~ ~
    lines = [f"# {name}: построить компьютер; координата сетки {anchor} попадает в ~ ~ ~"]
    tl = tiles(g, tile)
    upd = []
    for (ti, tj), ((ox, oy, oz), (sx, sy, sz), bl) in sorted(tl.items()):
        fn = f"t{ti}_{tj}"
        with open(os.path.join(root, "data", ns, "structure", fn + ".nbt"), "wb") as f:
            f.write(structure_nbt(bl, (ox, oy, oz), (sx, sy, sz)))
        dx, dy, dz = ox - gx0 + base[0], oy - gy0 + base[1], oz - gz0 + base[2]
        lines.append(f"place template {ns}:{fn} ~{dx} ~{dy} ~{dz}")
        upd.append(f"clone ~{dx} ~{dy} ~{dz} ~{dx+sx-1} ~{dy+sy-1} ~{dz+sz-1} ~{dx} ~{dy} ~{dz} replace force")
    lines += ["# второй проход: обновления соседей, чтобы факелы/повторители/компараторы начали работать"] + upd
    lines += [f"schedule function {ns}:refresh 400t"]
    with open(os.path.join(root, "data", ns, "function", "build.mcfunction"), "w") as f:
        f.write("\n".join(lines) + "\n")
    # refresh: ещё один пасс обновлений (факелы, «выгоревшие» из-за стартовых переходных процессов, перезажигаются)
    with open(os.path.join(root, "data", ns, "function", "refresh.mcfunction"), "w") as f:
        f.write("\n".join(upd) + "\n")
    return len(tl)
