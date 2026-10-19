"""
Проверка ПЗУ из бочек на настоящем сервере: файл .litematic → litemapy → setblock (+ предметы в бочках) →
сила сигнала за каждым компаратором должна совпадать с ниббл-значением из карты (JSON).
Пример: python3 scripts/mc_verify_rom.py docs/examples/rom_example.litematic /tmp/rom_example.json
Нужен litemapy: pip install --target /tmp/lmpkg litemapy
"""
import json
import os
import sys

sys.path.insert(0, '/tmp/lmpkg')
sys.path.insert(0, os.path.dirname(__file__))
from litemapy import Schematic  # noqa: E402
from rcon import Rcon  # noqa: E402
from mc_verify import OX, OY, OZ, sprint, state_str  # noqa: E402


def snbt_items(items):
    parts = []
    for it in items:
        parts.append('{Slot:%db,id:"%s",count:%d}' % (int(it['Slot']), str(it['id']), int(it['count'])))
    return '[' + ','.join(parts) + ']'


def main():
    path, mapfile = sys.argv[1], sys.argv[2]
    want = json.load(open(mapfile))
    sch = Schematic.load(path)
    reg = list(sch.regions.values())[0]
    print(f'Файл: {os.path.basename(path)} | DataVersion {sch.mc_version} | {reg.width}x{reg.height}x{reg.length} | TileEntities: {len(reg.tile_entities)}')
    tiles = {}
    for t in reg.tile_entities:
        n = t.to_nbt()
        tiles[(int(n['x']), int(n['y']), int(n['z']))] = n
    x0, y0, z0 = reg.xrange().start, reg.yrange().start, reg.zrange().start
    blocks = []
    for x in reg.xrange():
        for y in reg.yrange():
            for z in reg.zrange():
                b = reg[x, y, z]
                if b.id == 'minecraft:air':
                    continue
                blocks.append((x - x0, y - y0, z - z0, b.id, {k: str(v) for k, v in b.properties()}))
    r = Rcon()
    sx, sy, sz = reg.width, reg.height, reg.length
    r.cmd('forceload remove all')
    r.cmd(f'forceload add {OX - 2} {OZ - 2} {OX + sx + 2} {OZ + sz + 2}')
    sprint(r, 5)
    for y in range(OY - 1, OY + sy + 2):
        r.cmd(f'fill {OX - 1} {y} {OZ - 1} {OX + sx + 1} {y} {OZ + sz + 1} minecraft:air')
    sprint(r, 5)
    order = sorted(blocks, key=lambda b: (0 if b[1] == 0 else 1, b[1], b[2], b[0]))
    for x, y, z, n, p in order:
        s = state_str(n, p)
        t = tiles.get((x, y, z))
        if t is not None and 'Items' in t:
            s += '{Items:' + snbt_items(t['Items']) + '}'
        elif t is not None and 'OutputSignal' in t:
            s += '{OutputSignal:%d}' % int(t['OutputSignal'])
        res = r.cmd(f'setblock {OX + x} {OY + y} {OZ + z} {s}')
        if 'Could not' in res or 'Unknown' in res or 'Expected' in res:
            print('setblock:', res, s[:120])
    sprint(r, 60)
    bad = 0
    total = 0
    for e in want.get('map') or want['barrels']:
        for b in e['barrels']:
            total += 1
            ax, ay, az = OX + b['x'] + 2, OY + b['y'], OZ + b['z']
            ok = r.cmd(f'execute if block {ax} {ay} {az} minecraft:redstone_wire[power={b["nibble"]}]').startswith('Test passed')
            if not ok:
                bad += 1
                if bad <= 10:
                    print(f'✗ адрес {e["address"]} бочка ({b["x"]},{b["y"]},{b["z"]}): ожидалась мощность {b["nibble"]}')
    print(f'Бочек проверено: {total}, расхождений: {bad}')
    print('OK: ПЗУ читается компараторами как задумано' if bad == 0 else 'ПРОВАЛ')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    main()
