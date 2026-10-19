"""
Проверка сгенерированных схем на настоящем сервере Minecraft (по RCON).

1. Размещает блоки схемы командами setblock (так же, как это сделала бы вставка из Litematica).
2. Сравнивает состояние блоков (форма пыли, мощность, факелы, повторители, лампы) с тем, что записано в файл.
3. Перебирает все комбинации входов (переключает рычаги), прокручивает тики и сверяет лампы с таблицей истинности.

Запуск: DUMP=1 npx vitest run tests/dump.test.ts && python3 scripts/mc_verify.py [маска]
"""
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from rcon import Rcon  # noqa: E402

DIR = os.environ.get('DUMP_DIR', '/tmp/mcverify')
OX, OY, OZ = 0, 200, 0


def state_str(name, props):
    if not props:
        return name
    return name + '[' + ','.join(f'{k}={v}' for k, v in props.items()) + ']'


def sprint(r, ticks):
    r.cmd(f'tick sprint {ticks}')
    for _ in range(2000):
        q = r.cmd('tick query').lower()
        if 'sprinting' not in q:
            return
        time.sleep(0.03)
    raise RuntimeError('tick sprint не завершился')


def test_block(r, x, y, z, s):
    return r.cmd(f'execute if block {x} {y} {z} {s}').startswith('Test passed')


def verify(r, path):
    d = json.load(open(path))
    sx, sy, sz = d['size']
    name = d['name']
    # подготовка: подгрузка чанков и очистка
    r.cmd('forceload remove all')
    r.cmd(f'forceload add {OX - 2} {OZ - 2} {OX + sx + 2} {OZ + sz + 2}')
    sprint(r, 5)
    for y in range(OY - 1, OY + sy + 2):
        r.cmd(f'fill {OX - 1} {y} {OZ - 1} {OX + sx + 1} {y} {OZ + sz + 1} minecraft:air')
    sprint(r, 5)
    blocks = d['blocks']
    order = sorted(blocks, key=lambda b: (b[5], b[1], b[2], b[0]))
    for x, y, z, n, p, _ in order:
        r.cmd(f'setblock {OX + x} {OY + y} {OZ + z} {state_str(n, p)}')
    sprint(r, 200)

    # 1) совпадение записанного состояния с тем, что посчитал игровой движок
    mism = []
    for x, y, z, n, p, _ in blocks:
        if not test_block(r, OX + x, OY + y, OZ + z, state_str(n, p)):
            mism.append((x, y, z, n, p))
    diag = []
    for x, y, z, n, p in mism[:6]:
        bad = []
        for k, v in p.items():
            if not test_block(r, OX + x, OY + y, OZ + z, f'{n}[{k}={v}]'):
                bad.append(k)
        diag.append(f'({x},{y},{z}) {n.split(":")[1]} расходятся: {",".join(bad) or "id"}')

    # 2) таблица истинности
    levers = {}
    for label, pos in d['inputs'].items():
        x, y, z = pos
        spec = next(b for b in blocks if b[0] == x and b[1] == y and b[2] == z)
        levers[label] = (pos, spec[3], spec[4])
    fails = []
    for row in d['truth']:
        for label, on in row['in'].items():
            (x, y, z), n, p = levers[label]
            props = dict(p)
            props['powered'] = 'true' if on else 'false'
            r.cmd(f'setblock {OX + x} {OY + y} {OZ + z} {state_str(n, props)}')
        sprint(r, 240)
        for label, want in row['out'].items():
            x, y, z = d['outputs'][label]
            got = test_block(r, OX + x, OY + y, OZ + z, 'minecraft:redstone_lamp[lit=true]')
            if got != want:
                fails.append(f'{row["in"]} → {label}: ожидалось {int(want)}, в игре {int(got)}')
    return name, len(blocks), len(mism), diag, len(d['truth']), fails


def main():
    mask = sys.argv[1] if len(sys.argv) > 1 else ''
    files = sorted(f for f in glob.glob(f'{DIR}/*.json') if mask in os.path.basename(f))
    r = Rcon()
    bad = 0
    for f in files:
        t0 = time.time()
        try:
            name, nb, nm, diag, nv, fails = verify(r, f)
        except Exception as e:  # noqa: BLE001
            print(f'ERROR {os.path.basename(f)}: {e}')
            bad += 1
            r = Rcon()
            continue
        status = 'PASS' if not fails else 'FAIL'
        st_note = '' if nm == 0 else f'  [состояния блоков: {nm}/{nb} отличаются от записанных]'
        print(f'{status}  {name:22s} {nv:3d} комбинаций{st_note}  {time.time() - t0:4.1f}s')
        for dline in diag:
            print('       ', dline)
        for fl in fails[:5]:
            print('        ✗', fl)
        if fails:
            bad += 1
    print('\nВСЕ СХЕМЫ ПРОШЛИ ПРОВЕРКУ НА НАСТОЯЩЕМ СЕРВЕРЕ' if bad == 0 else f'\nПРОВАЛЕНО СХЕМ: {bad}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
