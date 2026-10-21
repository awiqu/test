"""Ассемблер RC-8 -> слова ПЗУ."""
import re, sys
from .isa import OPCODES, COND, SYS_HLT, ROM_WORDS

class AsmError(Exception):
    pass

REGS = {f"R{i}": i for i in range(8)}

def _reg(tok, line):
    t = tok.strip().upper()
    if t not in REGS:
        raise AsmError(f"{line}: ожидался регистр R0..R7, получено '{tok}'")
    return REGS[t]

def _num(tok, labels, line, lo, hi, what="число"):
    t = tok.strip()
    if t in labels:
        v = labels[t]
    else:
        try:
            v = int(t, 0)
        except ValueError:
            raise AsmError(f"{line}: неизвестная метка или число '{tok}'")
    if not (lo <= v <= hi):
        raise AsmError(f"{line}: {what} {v} вне диапазона {lo}..{hi}")
    return v

def assemble(text, return_listing=False):
    lines = []
    for n, raw in enumerate(text.splitlines(), 1):
        s = raw.split(";")[0].strip()
        if s:
            lines.append((n, s))
    # проход 1: метки
    labels, pc, items = {}, 0, []
    for n, s in lines:
        while True:
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", s)
            if not m:
                break
            labels[m.group(1)] = pc
            s = m.group(2)
        if not s:
            continue
        if s.lower().startswith(".org"):
            pc = int(s.split()[1], 0)
            continue
        if s.lower().startswith(".word"):
            for t in s.split(None, 1)[1].split(","):
                items.append((n, pc, ".word", [t.strip()])); pc += 1
            continue
        parts = s.split(None, 1)
        mn = parts[0].upper()
        args = [a.strip() for a in parts[1].split(",")] if len(parts) > 1 else []
        items.append((n, pc, mn, args)); pc += 1
    if pc > ROM_WORDS:
        raise AsmError(f"программа не помещается в ПЗУ: {pc} > {ROM_WORDS}")
    rom = [0] * ROM_WORDS
    listing = []
    for n, addr, mn, a in items:
        w = _encode(n, mn, a, labels)
        rom[addr] = w
        listing.append((addr, w, n, mn, a))
    if return_listing:
        return rom, labels, listing
    return rom

def _encode(n, mn, a, labels):
    def need(k):
        if len(a) != k:
            raise AsmError(f"{n}: {mn} ожидает {k} операндов")
    if mn == ".WORD":
        return _num(a[0], labels, n, 0, 0xFFFF)
    if mn == "NOP":  need(0); return 0
    if mn == "HLT":  need(0); return SYS_HLT
    if mn == "LDI":
        need(2); return (1 << 12) | (_reg(a[0], n) << 9) | _num(a[1], labels, n, -128, 255, "imm8") & 0xFF
    if mn in ("ADD", "SUB", "AND", "OR", "XOR", "ADC"):
        need(3); return (OPCODES[mn] << 12) | (_reg(a[0], n) << 9) | (_reg(a[1], n) << 6) | (_reg(a[2], n) << 3)
    if mn == "SHR":
        need(2); return (OPCODES[mn] << 12) | (_reg(a[0], n) << 9) | (_reg(a[1], n) << 6)
    if mn == "SHL":      # псевдокоманда: сдвиг влево = ADD rd, ra, ra
        need(2); return _encode(n, "ADD", [a[0], a[1], a[1]], labels)
    if mn == "ADDI":
        need(3); return (9 << 12) | (_reg(a[0], n) << 9) | (_reg(a[1], n) << 6) | (_num(a[2], labels, n, -32, 31, "imm6") & 0x3F)
    if mn == "CMP":
        need(2); return (10 << 12) | (_reg(a[0], n) << 6) | (_reg(a[1], n) << 3)
    if mn == "JMP":
        need(1); return (11 << 12) | _num(a[0], labels, n, 0, 511, "адрес")
    if mn in COND:
        need(1); return (12 << 12) | (COND[mn] << 9) | _num(a[0], labels, n, 0, 511, "адрес")
    if mn == "IN":
        need(1); return (13 << 12) | (_reg(a[0], n) << 9)
    if mn == "OUT":
        need(2)
        d = a[0].upper().lstrip("D")
        if not d.isdigit() or int(d) > 2:
            raise AsmError(f"{n}: OUT ожидает D0, D1 или D2")
        return (14 << 12) | (int(d) << 9) | (_reg(a[1], n) << 6)
    if mn == "PLOT":
        need(2); return (15 << 12) | (_reg(a[0], n) << 6) | (_reg(a[1], n) << 3)
    # псевдокоманды
    if mn == "MOV":  need(2); return _encode(n, "OR", [a[0], a[1], a[1]], labels)
    if mn == "INC":  need(1); return _encode(n, "ADDI", [a[0], a[0], "1"], labels)
    if mn == "DEC":  need(1); return _encode(n, "ADDI", [a[0], a[0], "-1"], labels)
    if mn == "CLR":  need(1); return _encode(n, "LDI", [a[0], "0"], labels)
    raise AsmError(f"{n}: неизвестная команда '{mn}'")

def disasm(w):
    from .isa import sext
    names = {v: k for k, v in OPCODES.items()}
    op = w >> 12; rd, ra, rb = (w >> 9) & 7, (w >> 6) & 7, (w >> 3) & 7
    n = names[op]
    if n == "SYS": return "HLT" if (w & 7) == 1 else "NOP"
    if n == "LDI": return f"LDI R{rd}, {w & 0xFF}"
    if n in ("ADD", "SUB", "AND", "OR", "XOR", "ADC"): return f"{n} R{rd}, R{ra}, R{rb}"
    if n == "SHR": return f"{n} R{rd}, R{ra}"
    if n == "ADDI": return f"ADDI R{rd}, R{ra}, {sext(w & 0x3F, 6)}"
    if n == "CMP": return f"CMP R{ra}, R{rb}"
    if n == "JMP": return f"JMP {w & 0x1FF}"
    if n == "JCC": return f"{['JZ','JNZ','JC','JNC'][rd] if rd < 4 else 'J?'} {w & 0x1FF}"
    if n == "IN": return f"IN R{rd}"
    if n == "OUT": return f"OUT D{rd}, R{ra}"
    if n == "PLOT": return f"PLOT R{ra}, R{rb}"
