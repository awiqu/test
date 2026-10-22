#!/usr/bin/env python3
"""Ассемблер RC-8.
  python3 tools/rc8asm.py prog.asm                 — листинг
  python3 tools/rc8asm.py prog.asm --hex out.hex   — слова ПЗУ (по одному в строке, 4 hex-цифры)
  python3 tools/rc8asm.py prog.asm --bin out.bin   — 1024 байта (big-endian)
  python3 tools/rc8asm.py prog.asm --run [--lev N] — прогнать на эмуляторе (регистры, цифры, дисплей)
  python3 tools/rc8asm.py --dis 125a               — дизассемблировать слово"""
import sys, os, argparse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.asm import assemble, disasm, AsmError
from redcomp.isa import Cpu

ap = argparse.ArgumentParser()
ap.add_argument("asm", nargs="?")
ap.add_argument("--hex")
ap.add_argument("--bin")
ap.add_argument("--run", action="store_true")
ap.add_argument("--lev", type=int, default=0, help="состояние 4 рычагов (0..15) для --run")
ap.add_argument("--dis")
ap.add_argument("--steps", type=int, default=100000)
a = ap.parse_args()
if a.dis:
    print(disasm(int(a.dis, 16)))
    sys.exit(0)
if not a.asm:
    ap.error("нужен файл программы")
try:
    rom, labels, listing = assemble(open(a.asm).read(), return_listing=True)
except AsmError as e:
    sys.exit(f"Ошибка ассемблера: {e}")
for addr, w, n, mn, args in listing:
    lab = [k for k, v in labels.items() if v == addr]
    print(f"{addr:03x}: {w:04x}  {disasm(w):<20} ; строка {n}" + (f"   <{','.join(lab)}>" if lab else ""))
print(f"; слов: {len(listing)} из 512")
if a.hex:
    open(a.hex, "w").write("".join(f"{w:04x}\n" for w in rom))
if a.bin:
    open(a.bin, "wb").write(b"".join(w.to_bytes(2, "big") for w in rom))
if a.run:
    cpu = Cpu(rom=rom, levers=a.lev)
    cpu.run(a.steps)
    print(f"\nэмулятор: шагов {cpu.steps}, {'остановлен (HLT)' if cpu.halted else 'лимит шагов'}")
    print("регистры:", " ".join(f"R{i}={r:02x}" for i, r in enumerate(cpu.regs)), f"Z={cpu.z} C={cpu.c}")
    print("цифры D0..D2 (код 8 сегментов a..g,dp):", " ".join(f"{d:02x}" for d in cpu.digits))
    if any(any(r) for r in cpu.fb):
        print(cpu.screen())
