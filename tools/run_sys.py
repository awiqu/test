"""Запуск собранного компьютера на тестовом сервере и сверка с эмулятором.
python3 tools/run_sys.py DP_DIR [name]   (сервер уже запущен с этим датапаком в world/datapacks)"""
import sys, os, time, pickle
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.sim import Server
from redcomp.isa import Cpu

dp = os.environ.get("RC8_DP") or (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "/tmp/mc/dp")
name = os.environ.get("RC8_NAME", "rc8")
meta = pickle.load(open(os.path.join(dp, name + "_meta.pkl"), "rb"))
plan, ports, words = meta["plan"], meta["ports"], meta["words"]
floors = meta.get("floor_y", {})            # модуль -> высота этажа (y)
S = Server()
Y = -60                                  # y=0 сетки
def blk(x, y, z): return (x, Y + y, z)

def test(x, y, z, state):
    return "passed" in S.cmd(f"execute if block {x} {Y+y} {z} {state}")

lo = (min(b[0] for b in meta["mod_bbox"].values()), min(b[1] for b in meta["mod_bbox"].values()))
hi = (max(b[2] for b in meta["mod_bbox"].values()), max(b[3] for b in meta["mod_bbox"].values()))

def setup(world_ready=False):
    X0, Z0, X1, Z1 = lo[0] - 8, lo[1] - 8, hi[0] + 8, hi[1] + 8
    for xa in range(X0, X1, 192):
        for za in range(Z0, Z1, 192):
            S.cmd(f"forceload add {xa} {za} {min(xa+191,X1)} {min(za+191,Z1)}")
    S.step(40)
    for xa in range(X0, X1 + 1, 128):
        for za in range(Z0, Z1 + 1, 128):
            S.cmd(f"fill {xa} {Y-1} {za} {min(xa+127,X1)} {Y-1} {min(za+127,Z1)} minecraft:stone")
    print(S.cmd(f"execute positioned 0 {Y} 0 run function {name}:build")[:60], flush=True)
    if "--auto" in sys.argv:
        S.step(9000)                      # автосброс датапака отрабатывает сам (later1/later2/rst_press...)
    else:
        S.step(450)
        S.cmd(f"execute positioned 0 {Y} 0 run function {name}:refresh"); S.step(450)
        S.cmd(f"execute positioned 0 {Y} 0 run function {name}:refresh"); S.step(450)

def press(btn, hold=24):
    x, z, d = ports[("panel", btn)]
    # кнопка стоит на y=0, z+2 от пина (пыль z, z+1, кнопка z+2)
    S.cmd(f"setblock {x} {Y} {z+2} minecraft:stone_button[face=floor,facing=north,powered=true]")
    S.step(hold)
    S.cmd(f"setblock {x} {Y} {z+2} minecraft:stone_button[face=floor,facing=north,powered=false]")

def lever(i, on):
    x, z, d = ports[("panel", i if isinstance(i, str) else f"lev{i}")]
    S.cmd(f"setblock {x} {Y} {z+1} minecraft:lever[face=floor,facing=north,powered={'true' if on else 'false'}]")

def run_lamp():
    x, z, d = ports[("panel", "runlamp")]
    return test(x, 0, z + 1, "minecraft:redstone_lamp[lit=true]")

def regs():
    ox, oz = plan["regA"]
    oy = floors.get("regA", 0)
    out = []
    for r in range(8):
        v = 0
        for k in range(8):
            if test(ox + 8 + 10 * r, oy, oz + 10 + 8 * k, "minecraft:repeater[powered=true]"):
                v |= 1 << k
        out.append(v)
    return out

SEGPOS = {"a": (6, 0), "b": (8, 3), "c": (8, 9), "d": (6, 12), "e": (4, 9), "f": (4, 3), "g": (6, 6), "p": (10, 12)}
def digits():
    res = []
    for d in range(3):
        ox, oz = plan[f"dgt{d}"]
        v = 0
        for i, nm in enumerate("abcdefgp"):
            dx, dz = SEGPOS[nm]
            if test(ox + dx, 0, oz + dz, "minecraft:redstone_lamp[lit=true]"):
                v |= 1 << i
        res.append(v)
    return res

def pixels():
    ox, oz = plan["pixels"]
    on = []
    for j in range(32):
        for i in range(32):
            if test(ox + 2 + 4 * i, 0, oz + 6 + 4 * j, "minecraft:waxed_copper_bulb[lit=true]"):
                on.append((i, j))
    return on

if __name__ == "__main__":
    if "--setup" in sys.argv:
        setup()
    if "--asm" in sys.argv:
        from redcomp.asm import assemble
        words = assemble(open(sys.argv[sys.argv.index("--asm") + 1]).read())
        if "--loadrom" in sys.argv:
            S.cmd("reload"); S.step(20)
            print(S.cmd(f"execute positioned 0 {Y} 0 run function {name}_rom:load")[:80]); S.step(450)
            S.cmd(f"execute positioned 0 {Y} 0 run function {name}:refresh"); S.step(450)
            S.cmd(f"execute positioned 0 {Y} 0 run function {name}:clear_display"); S.step(100)
            press("bRst"); S.step(4000); press("bRst"); S.step(4000)
    LEV = int(sys.argv[sys.argv.index("--lev") + 1]) if "--lev" in sys.argv else 0
    cpu = Cpu(rom=words[:], levers=LEV); cpu.run(5000)
    print("эмулятор: шагов", cpu.steps, "регистры", [hex(r) for r in cpu.regs], "цифры", [hex(d) for d in cpu.digits],
          "пиксели", [(x, y) for y in range(32) for x in range(32) if cpu.fb[y][x]], flush=True)
    t = time.time()
    w = int(sys.argv[sys.argv.index("--wait")+1]) if "--wait" in sys.argv else 4000
    for k in range(0 if "--auto" in sys.argv else (2 if "--rst2" in sys.argv else 1)):
        print("RESET"); press("bRst"); S.step(w)
        pc = sum((1 if (S.power((ports[("PCL", f"q{i}")][0], Y + 0, ports[("PCL", f"q{i}")][1]), None, (0, 0, 0)) or 0) > 0 else 0) << i for i in range(0)) if False else None
        print("после RESET: run", run_lamp(), "регистры", [hex(r) for r in regs()], flush=True)
    if "--lev" in sys.argv:
        for i in range(4):
            lever(i, bool(LEV >> i & 1))
        S.step(300)
    if "--slow" in sys.argv:
        lever("slow", True); S.step(300); print("рычаг SLOW включён")
    print("START"); press("bStart")
    waited = 0
    while waited < 250000:
        S.step(1000); waited += 1000
        print(f"  t={waited} run={run_lamp()}", flush=True)
        if not run_lamp() and waited > 3000:
            break
    S.step(1000)
    print("регистры", [hex(r) for r in regs()])
    print("цифры   ", [hex(d) for d in digits()])
    print("пиксели ", pixels())
    print("время", round(time.time() - t), "c")
