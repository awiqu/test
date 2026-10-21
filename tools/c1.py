import sys, time; sys.path.insert(0,'/home/user/test')
from redcomp.core import Core, build_core
from redcomp.glr import GlobalRouter
t=time.time()
core=Core(); build_core(core)
print("modules built",round(time.time()-t,1),"s; nets",len(core.nets),"cells",len(core.g.b))
lo,hi=core.g.bbox(); print("bbox",lo,hi)
import pickle
gr=GlobalRouter(core.g,0,0,560,552)
t=time.time(); gr.mark_obstacles(); print("obstacles",len(gr.R.blk),round(time.time()-t,1),"s")
for name,src,sinks in core.nets:
    gr.add_net(name,src,sinks)
import re
gr.weak={n for n,_,_ in core.nets if re.match(r'^(r\d|cout\d|na\d|RA\d|RB\d)$',n)}
ok=gr.route(iters=40,verbose=True)
print("ROUTED" if ok else "FAILED",gr.R.failed if not ok else "")
if ok:
    n=gr.emit(); print("wire blocks",n)
    pickle.dump({p:(b.name,dict(b.props)) for p,b in core.g.b.items()}, open('/tmp/mc/core_routed.pkl','wb'))
