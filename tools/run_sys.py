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
    x, z, d = ports[("panel", f"lev{i}")]
    S.cmd(f"setblock {x} {Y} {z+1} minecraft:lever[face=floor,facing=north,powered={'true' if on else 'false'}]")

def run_lamp():
    x, z, d = ports[("panel", "runlamp")]
    return test(x, 0, z + 1, "minecraft:redstone_lamp[lit=true]")

def regs():
    ox, oz = plan["regA"]
    out = []
    for r in range(8):
        v = 0
        for k in range(8):
            if test(ox + 8 + 10 * r, 0, oz + 10 + 8 * k, "minecraft:repeater[powered=true]"):
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
            if test(ox + 2 + 4 * i, 0, oz + 6 + 4 * j, "minecraft:copper_bulb[lit=true]"):
                on.append((i, j))
    return on

if __name__ == "__main__":
    if "--setup" in sys.argv:
        setup()
    cpu = Cpu(rom=words[:], levers=0); cpu.run(5000)
    print("эмулятор: шагов", cpu.steps, "регистры", [hex(r) for r in cpu.regs], "цифры", [hex(d) for d in cpu.digits],
          "пиксели", [(x, y) for y in range(32) for x in range(32) if cpu.fb[y][x]], flush=True)
    t = time.time()
    print("RESET"); press("bRst"); S.step(int(sys.argv[sys.argv.index("--wait")+1]) if "--wait" in sys.argv else 4000)
    print("после RESET: run", run_lamp(), "регистры", [hex(r) for r in regs()], flush=True)
    print("START"); press("bStart")
    waited = 0
    while waited < 60000:
        S.step(1000); waited += 1000
        print(f"  t={waited} run={run_lamp()}", flush=True)
        if not run_lamp() and waited > 3000:
            break
    S.step(1000)
    print("регистры", [hex(r) for r in regs()])
    print("цифры   ", [hex(d) for d in digits()])
    print("пиксели ", pixels())
    print("время", round(time.time() - t), "c")
