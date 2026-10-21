import sys, time; sys.path.insert(0,'/home/user/test')
from redcomp.sim import Server
S=Server()
X0,X1,Z0,Z1=-2,552,-2,536
for xa in range(X0,X1,192):
    for za in range(Z0,Z1,192):
        S.cmd(f"forceload add {xa} {za} {min(xa+191,X1)} {min(za+191,Z1)}")
S.step(40)
for xa in range(X0,X1+1,128):
    for za in range(Z0,Z1+1,128):
        S.cmd(f"fill {xa} -61 {za} {min(xa+127,X1)} -61 {min(za+127,Z1)} minecraft:stone")
print(S.cmd("execute positioned 0 -60 0 run function rc8core:build")[:80])
S.step(300)
