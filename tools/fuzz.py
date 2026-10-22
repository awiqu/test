"""Генератор случайной программы для сверки постройки с эмулятором: fuzz.py SEED N > prog.asm"""
import sys, random
seed, n = int(sys.argv[1]), int(sys.argv[2])
rnd = random.Random(seed)
R = lambda: f"R{rnd.randrange(8)}"
out = ["; случайная программа (seed %d)" % seed]
for r in range(8):
    out.append(f"        LDI  R{r}, {rnd.randrange(256)}")
lab = 0
for i in range(n):
    k = rnd.random()
    if k < 0.45:
        op = rnd.choice(["ADD", "SUB", "AND", "OR", "XOR", "ADC"])
        out.append(f"        {op}  {R()}, {R()}, {R()}")
    elif k < 0.55:
        out.append(f"        SHR  {R()}, {R()}")
    elif k < 0.62:
        out.append(f"        ADDI {R()}, {R()}, {rnd.randrange(-32, 32)}")
    elif k < 0.67:
        out.append(f"        CMP  {R()}, {R()}")
    elif k < 0.72:
        out.append(f"        LDI  {R()}, {rnd.randrange(256)}")
    elif k < 0.77:
        out.append(f"        IN   {R()}")
    elif k < 0.85:
        out.append(f"        OUT  D{rnd.randrange(3)}, {R()}")
    elif k < 0.92:
        out.append(f"        PLOT {R()}, {R()}")
    else:                                   # условный переход вперёд через одну команду
        c = rnd.choice(["JZ", "JNZ", "JC", "JNC"])
        out.append(f"        {c}   L{lab}")
        out.append(f"        ADD  {R()}, {R()}, {R()}")
        out.append(f"L{lab}:")
        lab += 1
out.append("        HLT")
print("\n".join(out))
