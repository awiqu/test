import sys, time, random; sys.path.insert(0,'/home/user/test')
from redcomp.lab import Lab
from redcomp.core import Core
from redcomp.glr import GlobalRouter
from redcomp.rom import build_rom, ADDR
from redcomp.netcheck import check_nets
random.seed(7)
words=[random.randrange(65536) for _ in range(512)]
core=Core()
for k in range(9): core.ext(f"A{k}",10+8*k,0,"S")
info=build_rom(core,10,50,words)
for k in range(9):
    core.net(f"A{k}",("ext",f"A{k}"),[(f"rom.c{b}",f"a{k}") for b in range(4)])
bb=info["bbox"]; print("bbox",bb)
W=(bb[2]//2+3)*2; H=(bb[3]//2+3)*2
t=time.time()
gr=GlobalRouter(core.g,0,0,W,H); gr.mark_obstacles(); gr.weak=set(core.weak)
for name,src,sinks in core.nets: gr.add_net(name,src,sinks)
ok=gr.route(iters=40,verbose=True); print("route",ok,time.time()-t,getattr(gr.R,"failed",None))
assert ok
gr.emit(); core.g.fix_wires()
check_nets(core.g,core.nets)
import pickle; pickle.dump((words,),open('/tmp/mc/rom_words.pkl','wb'))
L=Lab(origin=(2000,-60,0),size=(W+4,6,H+4))
for a in range(-10,H+10,150):
    for b in range(1990,2000+W+10,150):
        L.S.cmd(f"forceload add {b} {a} {min(b+149,2000+W+10)} {a+149}")
L.S.step(40)
g=L.reset(); g.b.update(core.g.b)
t=time.time(); L.build(); print("loaded",len(g.b),time.time()-t,flush=True); L.run(1200)
P=core.ports
def at(m,n): x,z,d=P[(m,n)]; return (x,0,z)
def setaddr(a):
    for k in range(9):
        x,z,d=P[("ext",f"A{k}")]; L.drive((x,0,z-1),bool(a>>k&1))
def readI():
    return sum(int(L.sig(at("rom",f"I{k}")))<<k for k in range(16))
bad=0
tests=[0,1,127,128,255,256,383,384,511]+random.sample(range(512),14)
for a in tests:
    setaddr(a); L.run(700)
    got=readI()
    ok_=got==words[a]; bad+=not ok_
    print(f"addr {a:3d}: {got:04x} (ожид. {words[a]:04x})", "OK" if ok_ else "FAIL",flush=True)
print("bad",bad)
