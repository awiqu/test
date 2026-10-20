"""
Лаборатория: расстановка маленьких конструкций на настоящем сервере и чтение состояний.
Координаты относительные (x, y, z) от точки OX, OY, OZ. y=0 — «пол».
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from rcon import Rcon  # noqa: E402

OX, OY, OZ = 16, 200, 16
MARGIN = 16  # допускаются отрицательные относительные координаты до -MARGIN


def st(name, **props):
    """st('repeater', facing='west', delay=1) -> 'minecraft:repeater[delay=1,facing=west]'"""
    n = name if ':' in name else 'minecraft:' + name
    if not props:
        return n
    return n + '[' + ','.join(f'{k}={str(v).lower() if isinstance(v, bool) else v}' for k, v in sorted(props.items())) + ']'


class Lab:
    def __init__(self, size=(40, 14, 40)):
        self.r = Rcon()
        self.size = size
        self.sx, self.sy, self.sz = size
        self.r.cmd('forceload remove all')
        self.r.cmd(f'forceload add {OX - MARGIN} {OZ - MARGIN} {OX + self.sx + 2} {OZ + self.sz + 2}')
        self.tick(5)
        self.clear()

    def clear(self):
        for y in range(-1, self.sy + 1):
            self.r.cmd(f'fill {OX - MARGIN} {OY + y} {OZ - MARGIN} {OX + self.sx + 1} {OY + y} {OZ + self.sz + 1} minecraft:air')
        self.tick(3)

    def tick(self, n):
        self.r.cmd(f'tick sprint {n}')
        for _ in range(4000):
            if 'sprinting' not in self.r.cmd('tick query').lower():
                return
            time.sleep(0.01)
        raise RuntimeError('tick sprint не завершился')

    def put(self, x, y, z, state):
        res = self.r.cmd(f'setblock {OX + x} {OY + y} {OZ + z} {state}')
        if 'Unknown' in res or 'Expected' in res or 'Invalid' in res:  # «Could not set the block» = уже такое состояние
            raise RuntimeError(f'setblock {state}: {res}')

    def build(self, blocks):
        """blocks: список (x, y, z, state). Сначала твёрдые, потом остальное."""
        solid = ('stone', 'concrete', 'wool', 'planks', 'cobblestone', 'terracotta', 'lamp', 'barrel', 'glass')
        order = sorted(blocks, key=lambda b: (0 if any(s in b[3] for s in solid) else 1, b[1]))
        for x, y, z, s in order:
            self.put(x, y, z, s)

    def has(self, x, y, z, state):
        return self.r.cmd(f'execute if block {OX + x} {OY + y} {OZ + z} {state}').startswith('Test passed')

    def dust(self, x, y, z):
        for p in range(16):
            if self.has(x, y, z, f'minecraft:redstone_wire[power={p}]'):
                return p
        return None

    def powered(self, x, y, z, name):
        return self.has(x, y, z, f'minecraft:{name}[powered=true]')

    def locked(self, x, y, z):
        return self.has(x, y, z, 'minecraft:repeater[locked=true]')

    def lit(self, x, y, z, name='redstone_lamp'):
        return self.has(x, y, z, f'minecraft:{name}[lit=true]')

    def comp_out(self, x, y, z):
        t = self.r.cmd(f'data get block {OX + x} {OY + y} {OZ + z} OutputSignal')
        try:
            return int(t.split()[-1])
        except Exception:
            return None

    def barrel(self, x, y, z, items):
        """items: список (слот, id, количество)"""
        body = ','.join('{Slot:%db,id:"%s",count:%d}' % it for it in items)
        self.put(x, y, z, 'minecraft:barrel[facing=up]{Items:[' + body + ']}')


def floor(x0, x1, z0, z1, block='minecraft:stone', y=0):
    return [(x, y, z, block) for x in range(x0, x1 + 1) for z in range(z0, z1 + 1)]
