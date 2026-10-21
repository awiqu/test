"""Сетка блоков + вычисление состояния редстоуна (как в ванильной игре)."""
from __future__ import annotations
import re

DIRS = {"north": (0, 0, -1), "south": (0, 0, 1), "west": (-1, 0, 0), "east": (1, 0, 0)}
OPP = {"north": "south", "south": "north", "west": "east", "east": "west"}
LEFT = {"north": "west", "west": "south", "south": "east", "east": "north"}   # поворот налево
RIGHT = {v: k for k, v in LEFT.items()}

# блоки, непрозрачные и проводящие сигнал (full opaque cube)
def _is_solid(name: str) -> bool:
    n = name.replace("minecraft:", "")
    return (n.endswith("_concrete") or n.endswith("_wool") or n.endswith("_terracotta")
            or n in ("stone", "smooth_stone", "stone_bricks", "barrel", "dirt", "bedrock",
                     "obsidian", "iron_block", "gold_block", "quartz_block", "bricks",
                     "polished_andesite", "polished_diorite", "polished_granite",
                     "black_concrete", "smooth_quartz", "coal_block", "lapis_block",
                     "netherrack", "cobblestone", "deepslate", "polished_deepslate",
                     "redstone_block_NOT"))
SOURCE_COMPONENTS = ("redstone_torch", "redstone_wall_torch", "lever", "redstone_block",
                     "stone_button", "observer")

class Block:
    __slots__ = ("name", "props")
    def __init__(self, name, props=None):
        self.name = name.replace("minecraft:", "")
        self.props = dict(props or {})
    def state_str(self, with_ns=True):
        s = ("minecraft:" if with_ns else "") + self.name
        if self.props:
            s += "[" + ",".join(f"{k}={v}" for k, v in sorted(self.props.items())) + "]"
        return s
    def __repr__(self): return self.state_str(False)
    def __eq__(self, o): return self.name == o.name and self.props == o.props

class Grid:
    def __init__(self):
        self.b: dict[tuple, Block] = {}

    # ---- базовые операции
    def put(self, x, y, z, name, **props):
        self.b[(x, y, z)] = Block(name, props)
        return self
    def get(self, x, y, z):
        return self.b.get((x, y, z))
    def remove(self, x, y, z):
        self.b.pop((x, y, z), None)

    # ---- удобные конструкторы
    def solid(self, x, y, z, mat="stone"):
        return self.put(x, y, z, mat)
    def dust(self, x, y, z):
        return self.put(x, y, z, "redstone_wire")
    def repeater(self, x, y, z, flow, delay=1):
        """flow = направление потока сигнала (выход). В блокстейте facing = сторона ВХОДА."""
        return self.put(x, y, z, "repeater", facing=OPP[flow], delay=delay, locked="false", powered="false")
    def comparator(self, x, y, z, flow, mode="compare"):
        return self.put(x, y, z, "comparator", facing=OPP[flow], mode=mode, powered="false")
    def torch(self, x, y, z):
        return self.put(x, y, z, "redstone_torch", lit="true")
    def wall_torch(self, x, y, z, facing):
        """facing = в какую сторону смотрит факел (от стены)."""
        return self.put(x, y, z, "redstone_wall_torch", facing=facing, lit="true")
    def lamp(self, x, y, z):
        return self.put(x, y, z, "redstone_lamp", lit="false")
    def lever(self, x, y, z, face="floor", facing="north"):
        return self.put(x, y, z, "lever", face=face, facing=facing, powered="false")
    def rblock(self, x, y, z):
        return self.put(x, y, z, "redstone_block")

    def paste(self, other: "Grid", dx=0, dy=0, dz=0):
        for (x, y, z), blk in other.b.items():
            self.b[(x + dx, y + dy, z + dz)] = Block(blk.name, blk.props)

    def bbox(self):
        xs = [p[0] for p in self.b]; ys = [p[1] for p in self.b]; zs = [p[2] for p in self.b]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    # ---- состояние пыли (точно как RedStoneWireBlock.getConnectionState)
    def is_solid_at(self, p):
        b = self.b.get(p)
        return b is not None and _is_solid(b.name)

    @staticmethod
    def _connects_to(nb, d):
        """shouldConnectTo(state, direction); d=None -> только пыль"""
        n = nb.name
        if n == "redstone_wire":
            return True
        if d is None:
            return False
        if n == "repeater":
            f = nb.props.get("facing")
            return f == d or f == OPP[d]
        if n == "observer":
            return nb.props.get("facing") == d
        return n in ("redstone_torch", "redstone_wall_torch", "lever", "redstone_block",
                     "stone_button", "oak_button", "target", "comparator",
                     "daylight_detector", "tripwire_hook", "lectern")

    def _side(self, p, d):
        x, y, z = p
        dx, _, dz = DIRS[d]
        n = (x + dx, y, z + dz)
        nb = self.b.get(n)
        above_solid = self.is_solid_at((x, y + 1, z))
        if not above_solid:
            if nb is not None and _is_solid(nb.name):          # canSurviveOn (верх сплошного)
                ub = self.b.get((n[0], n[1] + 1, n[2]))
                if ub is not None and self._connects_to(ub, None):
                    return "up"
        if nb is not None and self._connects_to(nb, d):
            return "side"
        if (nb is None or not _is_solid(nb.name)):
            db = self.b.get((n[0], n[1] - 1, n[2]))
            if db is not None and self._connects_to(db, None):
                return "side"
        return "none"

    def fix_wires(self):
        """Проставить north/east/south/west для всей пыли (как это делает игра)."""
        for p, blk in self.b.items():
            if blk.name != "redstone_wire":
                continue
            c = {d: self._side(p, d) for d in DIRS}
            n, s_, e, w = (c[k] != "none" for k in ("north", "south", "east", "west"))
            f5 = not n and not s_
            f6 = not e and not w
            if not w and f5: c["west"] = "side"
            if not e and f5: c["east"] = "side"
            if not n and f6: c["north"] = "side"
            if not s_ and f6: c["south"] = "side"
            blk.props = {**c, "power": 0}
        return self


def ascii_layer(g: "Grid", y, x0, x1, z0, z1):
    sym = {"redstone_wire": "+", "redstone_torch": "T", "redstone_wall_torch": "t", "redstone_lamp": "L",
           "redstone_block": "R", "lever": "l"}
    arrow = {"east": ">", "west": "<", "north": "^", "south": "v"}
    lines = []
    for z in range(z0, z1 + 1):
        row = ""
        for x in range(x0, x1 + 1):
            b = g.get(x, y, z)
            if b is None:
                row += "."
            elif b.name in ("repeater", "comparator"):
                # facing = сторона входа -> стрелка = направление потока
                f = {"north": "south", "south": "north", "east": "west", "west": "east"}[b.props["facing"]]
                row += ("r" if b.name == "repeater" else "c") if False else arrow[f] if b.name == "repeater" else {"east": "}", "west": "{", "north": "A", "south": "V"}[f]
            elif b.name == "redstone_wall_torch":
                row += {"east": "e", "west": "w", "north": "n", "south": "s"}[b.props["facing"]]
            elif b.name in sym:
                row += sym[b.name]
            else:
                row += "#"
        lines.append(f"{z:3d} " + row)
    return "\n".join(lines)
