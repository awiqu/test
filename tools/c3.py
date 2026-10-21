import sys, time, pickle; sys.path.insert(0,'/home/user/test')
from redcomp.grid import Grid, Block
from redcomp.sim import Server
from redcomp.core import Core, build_core
from redcomp.isa import Cpu, OPCODES, sext
S=Server(); O=(0,-60,0)
data=pickle.load(open('/tmp/mc/core_routed.pkl','rb'))
g=Grid()
for p,(n,props) in data.items(): g.b[p]=Block(n,props)
core=Core(); build_core(core)
P=core.ports
def at(mod,name): x,z,d=P[(mod,name)]; return (x,0,z)
def drive_ext(name,on):
    x,z,d=P[("ext",name)]
    S.cmd(f"setblock {x} {O[1]} {z-1} minecraft:{'redstone_block' if on else 'air'}")
def sig(p):
    return S.is_on(p,g,O)
def word(op,rd=0,ra=0,rb=0,imm=0):
    w=OPCODES[op]<<12
    if op=="LDI": w|=rd<<9|(imm&0xFF)
    elif op in("ADDI",): w|=rd<<9|ra<<6|(imm&0x3F)
    elif op in("JMP",): w|=imm&0x1FF
    elif op=="JCC": w|=rd<<9|(imm&0x1FF)
    elif op in("OUT",): w|=rd<<9|ra<<6
    else: w|=rd<<9|ra<<6|rb<<3
    return w
def setIR(w):
    for k in range(16): drive_ext(f"I{k}",bool(w>>k&1))
def pulse(n,width=160):
    drive_ext(n,True); S.step(width); drive_ext(n,False); S.step(width)
def readres():
    return sum(int(sig(at("RES",f"q{k}")))<<k for k in range(8))
def readflags():
    return sig(at("FLG","q0")), sig(at("FLG","q1"))
def exec_(w,settle):
    setIR(w); S.step(settle)
    pulse("p1"); pulse("p2"); pulse("p3")
if __name__=="__main__":
    settle=int(sys.argv[1]) if len(sys.argv)>1 else 200
    for n in ("p1","p2","p3","rst"): drive_ext(n,False)
    S.step(300)
    prog=[word("LDI",1,imm=0x5A),word("LDI",2,imm=0x3C),word("ADD",3,1,2),word("SUB",4,1,2),word("AND",5,1,2),
          word("OR",6,1,2),word("XOR",7,1,2),word("SHR",0,1),word("CMP",0,1,1),word("ADDI",1,1,imm=5)]
    cpu=Cpu(rom=[0]*512)
    allok=True
    for w in prog:
        before=list(cpu.regs); zc=(cpu.z,cpu.c)
        cpu.rom[cpu.pc]=w; cpu.step()
        exec_(w,settle)
        got=readres(); fl=readflags()
        # ожидаемое: значение, записанное в rd (если команда пишет) – иначе пропускаем
        exp=None
        for r in range(8):
            if cpu.regs[r]!=before[r]: exp=cpu.regs[r]
        print(f"{w:04x}: RES={got:02x} (эмулятор {exp if exp is None else format(exp,'02x')}) Z,C={fl} эмулятор {(cpu.z,cpu.c)}",flush=True)
    # чтение регистров обратно через OR rd=0
    for r in range(1,8):
        exec_(word("OR",0,r,r),settle)
        print(f"r{r}: {readres():02x} эмулятор {cpu.regs[r]:02x}",flush=True)
