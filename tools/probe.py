"""Зонды для собранного компьютера в живом мире: probe.sig('pulse','p1'), probe.bits('RES','q',8) ..."""
import sys, os, pickle
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.sim import Server
from redcomp.grid import Grid, Block

DP = os.environ.get("RC8_DP", "/tmp/mc/dp")
NAME = os.environ.get("RC8_NAME", "rc8")
meta = pickle.load(open(os.path.join(DP, NAME + "_meta.pkl"), "rb"))
data = pickle.load(open(os.path.join(DP, NAME + "_grid.pkl"), "rb"))
g = Grid()
for p, (n, props) in data.items():
    g.b[p] = Block(n, props)
ports, plan = meta["ports"], meta["plan"]
S = Server()
O = (0, -60, 0)

def at(mod, port):
    x, z, d = ports[(mod, port)]
    return (x, 0, z)

def sig(mod, port):
    p = at(mod, port)
    b = g.get(*p)
    if b is None:
        return None
    if b.name == "redstone_wire":
        return S.power(p, g, O)
    return int(S.is_on(p, g, O))

def bits(mod, pre, n):
    return [sig(mod, f"{pre}{k}") for k in range(n)]

def val(mod, pre, n):
    return sum((1 if (sig(mod, f"{pre}{k}") or 0) > 0 else 0) << k for k in range(n))
