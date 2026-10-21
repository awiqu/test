import sys, time; sys.path.insert(0,'/home/user/test')
from redcomp.lab import Lab
from redcomp.core import Core
from redcomp.glr import GlobalRouter
from redcomp.seq import build_seq, INS
core=Core()
BT=["bStart","bStop","bStep","bRst","hlt"]
for k,n in enumerate(BT): core.ext(n,10+8*k,0,"S")
info=build_seq(core,10,10)
for n in BT: core.net(n,("ext",n),[("seq.ctl",n)])
bb=info["bbox"]; print("bbox",bb, {k:v for k,v in info["ticks"].items()})
W=(bb[2]//2+3)*2; H=(bb[3]//2+3)*2
gr=GlobalRouter(core.g,0,0,W,H); gr.mark_obstacles(); gr.weak=set(core.weak)
for name,src,sinks in core.nets: gr.add_net(name,src,sinks)
ok=gr.route(iters=40,verbose=False); print("route",ok)
assert ok
gr.emit()
from redcomp.netcheck import check_nets
core.g.fix_wires()
check_nets(core.g,core.nets)
L=Lab(origin=(2000,-60,0),size=(W+4,6,H+4))
[L.S.cmd(f"forceload add 1990 {a} 2200 {a+150}") for a in (-10,141,292)]; L.S.step(40)
g=L.reset(); g.b.update(core.g.b)
L.build(); L.g=g; L.run(600)
P=core.ports
def at(m,n): x,z,d=P[(m,n)]; return (x,0,z)
def press(n,w=20):
    x,z,d=P[("ext",n)]; L.drive((x,0,z-1),True); L.run(w); L.drive((x,0,z-1),False)
sigs={"run":at("seq.ctl","run"),"rstl":at("seq.ctl","rstl"),"q":at("seq.ctl","q"),"p1":at("seq.d1","out"),"p2":at("seq.d2","out"),"p3":at("seq.d3","out"),"fb":at("seq.d4","out")}
def trace(T,step=4):
    prev=None; t=0; out=[]
    while t<T:
        s={k:int(L.sig(p)) for k,p in sigs.items()}
        if s!=prev: out.append((t,s)); prev=s
        L.run(step); t+=step
    return out
def show(tr):
    last=None
    for t,s in tr:
        print(f" t={t:4d}", ' '.join(f"{k}={v}" for k,v in s.items()))
print("начальное:",{k:int(L.sig(p)) for k,p in sigs.items()})
print("== RESET"); press("bRst"); show(trace(700))
print("== STEP"); press("bStep"); show(trace(700))
print("== START"); press("bStart"); tr=trace(1500); show(tr)
print("== STOP"); press("bStop"); show(trace(900))
