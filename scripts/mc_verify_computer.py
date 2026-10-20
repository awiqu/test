"""
Проверка собранного компьютера на настоящем сервере Minecraft: .litematic → litemapy → setblock (+ предметы в контейнерах ПЗУ) →
сброс, тактирование рычагом CLK, сверка счётчика команд, аккумулятора, флагов, ОЗУ и ламп с эмулятором.

Подготовка: DUMP_COMPUTER=1 STEPS=14 npx vitest run tests/cpu/dumpComputer.test.ts   (создаёт /tmp/mccomp/*)
Запуск:     python3 scripts/mc_verify_computer.py [каталог, по умолчанию /tmp/mccomp]
Нужны: litemapy (pip install --target /tmp/lmpkg litemapy), сервер с RCON на 25575 и большой куча (-Xmx6G).
"""
import json
import os
import sys
import threading
import time

sys.path.insert(0, '/tmp/lmpkg')
sys.path.insert(0, os.path.dirname(__file__))
from litemapy import Schematic  # noqa: E402
from rcon import Rcon  # noqa: E402
from mc_verify import OX, OY, OZ, sprint, state_str  # noqa: E402


def snbt_items(items):
    return '[' + ','.join('{Slot:%db,id:"%s",count:%d}' % (int(i['Slot']), str(i['id']), int(i['count'])) for i in items) + ']'


def run_parallel(pool, cmds):
    """Команды слоя делятся между соединениями RCON (сервер не принимает конвейер из нескольких пакетов в одном чтении)."""
    n = len(pool)
    out = [None] * len(cmds)

    def work(k):
        r = pool[k]
        for idx in range(k * len(cmds) // n, (k + 1) * len(cmds) // n):
            out[idx] = r.cmd(cmds[idx])

    ts = [threading.Thread(target=work, args=(k,)) for k in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return out


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mccomp'
    ex = json.load(open(os.path.join(d, 'expect.json')))
    sch = Schematic.load(os.path.join(d, 'computer.litematic'))
    reg = list(sch.regions.values())[0]
    sx, sy, sz = reg.width, reg.height, reg.length
    print(f'Файл: DataVersion {sch.mc_version} | {sx}x{sy}x{sz} | TileEntities: {len(reg.tile_entities)}', flush=True)
    tiles = {}
    for t in reg.tile_entities:
        n = t.to_nbt()
        tiles[(int(n['x']), int(n['y']), int(n['z']))] = n
    x0, y0, z0 = reg.xrange().start, reg.yrange().start, reg.zrange().start
    t0 = time.time()
    blocks = []
    for x in reg.xrange():
        for y in reg.yrange():
            for z in reg.zrange():
                b = reg[x, y, z]
                if b.id == 'minecraft:air':
                    continue
                blocks.append((x - x0, y - y0, z - z0, b.id, {k: str(v) for k, v in b.properties()}))
    print(f'Блоков: {len(blocks)} (чтение {time.time() - t0:.0f} с)', flush=True)
    by_pos = {(b[0], b[1], b[2]): b for b in blocks}

    r = Rcon()
    r.cmd('forceload remove all')
    band = max(1, 250 // (-(-(sx + 3) // 16))) * 16  # forceload принимает не более 256 чанков за команду
    for z in range(0, sz + 4, band):
        res = r.cmd(f'forceload add {OX} {OZ + z} {OX + sx + 2} {OZ + min(z + band - 1, sz + 3)}')
        if 'Added' not in res and 'ed' not in res:
            print('forceload:', res)
    print('forceload ok, ждём загрузку чанков…', flush=True)
    sprint(r, 40)

    # очистка области (предыдущие запуски): fill не принимает больше 32768 блоков за раз
    pool0 = Rcon()
    for x in range(0, sx + 2, 60):
        for z in range(0, sz + 2, 60):
            pool0.cmd(f'fill {OX + x} {OY - 1} {OZ + z} {OX + min(x + 59, sx + 1)} {OY + sy + 1} {OZ + min(z + 59, sz + 1)} minecraft:air')
    pool0.cmd('kill @e[type=minecraft:item]')  # содержимое снесённых контейнеров выпадает предметами и тормозит сервер
    sprint(r, 5)

    solid = ('stone', 'concrete', 'wool', 'planks', 'bricks', 'terracotta', 'andesite', 'deepslate', 'quartz', 'cobblestone', 'barrel', 'chest', 'hopper', 'dropper', 'dispenser')
    def cmd_of(b):
        x, y, z, n, p = b
        s = state_str(n, p)
        t = tiles.get((x, y, z))
        if t is not None and 'Items' in t:
            s += '{Items:' + snbt_items(t['Items']) + '}'
        elif t is not None and 'OutputSignal' in t:
            s += '{OutputSignal:%d}' % int(t['OutputSignal'])
        return f'setblock {OX + x} {OY + y} {OZ + z} {s}'

    is_solid = lambda b: any(sn in b[3] for sn in solid)
    groups = []
    for want in (True, False):
        for y in sorted({b[1] for b in blocks}):
            layer = [b for b in blocks if b[1] == y and is_solid(b) == want]
            layer.sort(key=lambda b: (b[2], b[0]))
            if layer:
                groups.append(layer)
    pool = [Rcon() for _ in range(8)]
    t0 = time.time()
    bad = 0
    done = 0
    for layer in groups:
        res = run_parallel(pool, [cmd_of(b) for b in layer])
        for b, rr in zip(layer, res):
            if 'Unknown' in rr or 'Expected' in rr or 'Invalid' in rr or 'Cannot' in rr:
                bad += 1
                if bad <= 5:
                    print('setblock:', rr, cmd_of(b)[:120])
        done += len(layer)
        print(f'  размещено {done}/{len(blocks)} ({time.time() - t0:.0f} с)', flush=True)
    print(f'Размещено; ошибок команд: {bad}', flush=True)
    t0 = time.time()
    sprint(r, 400)
    print(f'Прогрев 400 тиков: {time.time() - t0:.1f} с', flush=True)

    def lever(pos, on):
        b = by_pos[tuple(pos)]
        props = dict(b[4])
        props['powered'] = 'true' if on else 'false'
        r.cmd(f'setblock {OX + pos[0]} {OY + pos[1]} {OZ + pos[2]} {state_str(b[3], props)}')

    def dust_on(pos):
        res = r.cmd(f'execute if block {OX + pos[0]} {OY + pos[1]} {OZ + pos[2]} minecraft:redstone_wire[power=0]')
        return not res.startswith('Test passed')

    def rep_on(pos):
        return r.cmd(f'execute if block {OX + pos[0]} {OY + pos[1]} {OZ + pos[2]} minecraft:repeater[powered=true]').startswith('Test passed')

    def lamp_on(pos):
        return r.cmd(f'execute if block {OX + pos[0]} {OY + pos[1]} {OZ + pos[2]} minecraft:redstone_lamp[lit=true]').startswith('Test passed')

    def bits(cells, fn):
        return sum((1 if fn(c) else 0) << i for i, c in enumerate(cells))

    half = max(int(ex['halfPeriod'] or 1000), 800)
    for inp in ex['inputs']:
        if inp['port'] == 'SWITCH':
            lever(inp['pos'], ((ex['switches'] >> inp['bit']) & 1) == 1)

    def cycle():
        lever(ex['clk'], True)
        sprint(r, half)
        lever(ex['clk'], False)
        sprint(r, half)

    t0 = time.time()
    lever(ex['reset'], True)
    sprint(r, max(800, half))
    cycle()
    cycle()
    lever(ex['reset'], False)
    sprint(r, max(800, half))
    pc0 = bits(ex['pc'], dust_on)
    print(f'после сброса: PC={pc0} A={bits(ex["a"], dust_on)} ({time.time() - t0:.0f} с)', flush=True)
    ok = pc0 == 0
    for k, step in enumerate(ex['steps']):
        cycle()
        pc = bits(ex['pc'], dust_on)
        a = bits(ex['a'], dust_on)
        flags = {f: dust_on(p) for f, p in ex['flags'].items()}
        ram = {}
        for name, cells in ex['ram'].items():
            m = name[2:-1] if name.startswith('M[') else None
            if m is not None:
                ram[int(m)] = bits(cells, rep_on)
        errs = []
        for r, cells in ex.get('regs', {}).items():
            got = bits(cells, dust_on)
            if got != step['regs'][int(r)]:
                errs.append(f'R{r} {got} != {step["regs"][int(r)]}')
        if pc != step['pc']:
            errs.append(f'PC {pc} != {step["pc"]}')
        if ex['a'] and a != step['a']:
            errs.append(f'A {a} != {step["a"]}')
        for f, v in flags.items():
            if int(v) != step['flags'].get(f, 0):
                errs.append(f'{f} {int(v)} != {step["flags"].get(f)}')
        for addr, v in ram.items():
            if v != step['ram'][addr]:
                errs.append(f'M[{addr}] {v} != {step["ram"][addr]}')
        for port, key in (('LEDS', 'leds'), ('SEG', 'seg')):
            ls = [l for l in ex['lamps'] if l['port'] == port]
            if ls and step.get(key) is not None:
                val = sum((1 if lamp_on(l['pos']) else 0) << l['bit'] for l in ls)
                if val != step[key]:
                    errs.append(f'{port} {val} != {step[key]}')
        print(f'шаг {k}: PC={pc} A={a} ' + ('OK' if not errs else 'ОШИБКА ' + '; '.join(errs)) + f' ({time.time() - t0:.0f} с)', flush=True)
        if errs:
            ok = False
    print('РЕЗУЛЬТАТ:', 'совпало с эмулятором' if ok else 'РАСХОЖДЕНИЕ')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
