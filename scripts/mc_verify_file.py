"""
Сквозная проверка готового .litematic на настоящем сервере: файл → litemapy → setblock → перебор рычагов → лампы.
Пример: python3 scripts/mc_verify_file.py docs/examples/example.litematic --example
(--example сверяет с таблицей истинности схемы-образца: w0 = ¬x·y, w1 = ¬x·y·z)
Нужен litemapy: pip install --target /tmp/lmpkg litemapy
"""
import itertools
import os
import sys
import time

sys.path.insert(0, '/tmp/lmpkg')
sys.path.insert(0, os.path.dirname(__file__))
from litemapy import Schematic  # noqa: E402
from rcon import Rcon  # noqa: E402
from mc_verify import OX, OY, OZ, sprint, state_str  # noqa: E402


def main():
    path = sys.argv[1]
    sch = Schematic.load(path)
    reg = list(sch.regions.values())[0]
    print(f'Файл: {os.path.basename(path)} | Version {sch.lm_version}.{sch.lm_subversion} | DataVersion {sch.mc_version} | размер {reg.width}x{reg.height}x{reg.length}')
    blocks = []
    for x in reg.xrange():
        for y in reg.yrange():
            for z in reg.zrange():
                b = reg[x, y, z]
                if b.id == 'minecraft:air':
                    continue
                props = {k: str(v) for k, v in b.properties()}
                blocks.append((x - reg.xrange().start, y - reg.yrange().start, z - reg.zrange().start, b.id, props))
    r = Rcon()
    sx, sy, sz = reg.width, reg.height, reg.length
    r.cmd('forceload remove all')
    r.cmd(f'forceload add {OX - 2} {OZ - 2} {OX + sx + 2} {OZ + sz + 2}')
    sprint(r, 5)
    for y in range(OY - 1, OY + sy + 2):
        r.cmd(f'fill {OX - 1} {y} {OZ - 1} {OX + sx + 1} {y} {OZ + sz + 1} minecraft:air')
    sprint(r, 5)
    solid = ('stone', 'concrete', 'wool', 'planks', 'bricks', 'terracotta', 'andesite', 'deepslate', 'quartz', 'cobblestone')
    order = sorted(blocks, key=lambda b: (0 if any(s in b[3] for s in solid) else 1, b[1], b[2], b[0]))
    for x, y, z, n, p in order:
        r.cmd(f'setblock {OX + x} {OY + y} {OZ + z} {state_str(n, p)}')
    sprint(r, 200)
    levers = sorted([b for b in blocks if b[3] in ('minecraft:lever', 'minecraft:stone_button')], key=lambda b: (b[2], b[0]))
    lamps = sorted([b for b in blocks if b[3] == 'minecraft:redstone_lamp'], key=lambda b: (b[2], b[0]))
    print(f'рычагов: {len(levers)}, ламп: {len(lamps)}, блоков: {len(blocks)}')
    ok = True
    for combo in itertools.product([False, True], repeat=len(levers)):
        for (x, y, z, n, p), on in zip(levers, combo):
            props = dict(p)
            props['powered'] = 'true' if on else 'false'
            r.cmd(f'setblock {OX + x} {OY + y} {OZ + z} {state_str(n, props)}')
        sprint(r, 240)
        got = []
        for x, y, z, _, _ in lamps:
            res = r.cmd(f'execute if block {OX + x} {OY + y} {OZ + z} minecraft:redstone_lamp[lit=true]')
            got.append(res.startswith('Test passed'))
        line = ' '.join(str(int(v)) for v in combo) + '  →  ' + ' '.join(str(int(v)) for v in got)
        if '--example' in sys.argv and len(combo) == 3 and len(got) == 2:
            x_, y_, z_ = combo
            want = [(not x_) and y_, (not x_) and y_ and z_]
            if list(map(bool, got)) != list(map(bool, want)):
                ok = False
                line += f'   ✗ ожидалось {int(want[0])} {int(want[1])}'
        print(line)
    print('OK: файл ведёт себя как задумано' if ok else 'ПРОВАЛ')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
