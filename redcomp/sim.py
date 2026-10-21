"""Драйвер живого сервера: загрузка сетки, шаги тиков, чтение состояний."""
import re, sys, time
sys.path.insert(0, "/home/user/test/tools")
from rcon import Rcon
from .grid import Grid

class Server:
    def __init__(self):
        self.r = Rcon()
        self.r.cmd("tick rate 10000")
        self.r.cmd("tick freeze")

    def cmd(self, c): return self.r.cmd(c)

    def gametime(self):
        return int(re.search(r"\d+", self.r.cmd("time query gametime")).group())

    def step(self, n=1):
        """Синхронно прогнать n игровых тиков."""
        g0 = self.gametime()
        self.r.cmd(f"tick step {n}")
        while self.gametime() < g0 + n:
            pass

    def clear(self, lo, hi):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        # fill ограничен 32768 блоками -> режем по слоям
        for y in range(y0, y1 + 1):
            self.r.cmd(f"fill {x0} {y} {z0} {x1} {y} {z1} minecraft:air")

    def load(self, g: Grid, origin=(0, 0, 0), batch=2000):
        ox, oy, oz = origin
        g.fix_wires()
        items = list(g.b.items())
        # сначала твёрдые блоки, потом остальное, пыль в конце
        def prio(it):
            n = it[1].name
            return 2 if n == "redstone_wire" else (1 if n in ("repeater","comparator","redstone_torch","redstone_wall_torch","redstone_lamp","lever") else 0)
        items.sort(key=prio)
        cmds = []
        for (x, y, z), blk in items:
            cmds.append(f"setblock {x+ox} {y+oy} {z+oz} {blk.state_str()}")
        for i in range(0, len(cmds), batch):
            self.r.many(cmds[i:i+batch])

    def test(self, pos, state):
        return "passed" in self.r.cmd(f"execute if block {pos[0]} {pos[1]} {pos[2]} {state}")

    def is_on(self, pos, g: Grid | None = None, origin=(0, 0, 0)):
        """Логическое состояние блока: лампа lit, повторитель powered, пыль power>0 и т.д."""
        x, y, z = pos
        ox, oy, oz = origin
        P = (x + ox, y + oy, z + oz)
        blk = g.get(x, y, z) if g else None
        name = blk.name if blk else None
        if name == "redstone_wire":
            return not self.test(P, "minecraft:redstone_wire[power=0]")
        if name in ("repeater", "comparator"):
            return self.test(P, f"minecraft:{name}[powered=true]")
        if name in ("redstone_lamp", "redstone_torch", "redstone_wall_torch"):
            return self.test(P, f"minecraft:{name}[lit=true]")
        if name == "lever":
            return self.test(P, "minecraft:lever[powered=true]")
        if name == "redstone_block":
            return True
        raise ValueError(f"не знаю как читать {name} at {pos}")

    def power(self, pos, g, origin=(0,0,0)):
        x, y, z = pos; ox, oy, oz = origin
        P = (x + ox, y + oy, z + oz)
        for v in range(15, -1, -1):
            if self.test(P, f"minecraft:redstone_wire[power={v}]"): return v
        return -1
