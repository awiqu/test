import sys, pickle, time; sys.path.insert(0,'/home/user/test')
from redcomp.grid import Grid, Block
from redcomp.export import write_datapack
data=pickle.load(open('/tmp/mc/core_routed.pkl','rb'))
g=Grid()
for p,(n,props) in data.items(): g.b[p]=Block(n,props)
g.fix_wires()
t=time.time(); n=write_datapack(g,'/tmp/mc/dp',name='rc8core',tile=96); print("tiles",n,time.time()-t)
