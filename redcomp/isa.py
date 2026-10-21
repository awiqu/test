"""Архитектура RC-8: 8 регистров x 8 бит, 16-битные команды, ПЗУ 512 слов, 16 команд.

Формат слова (биты 15..0):
  [15:12] код операции
  R-тип : [11:9] rd  [8:6] ra  [5:3] rb  [2:0] 0
  I-тип : LDI  [11:9] rd [7:0] imm8 ;  ADDI [11:9] rd [8:6] ra [5:0] imm6 (знаковое)
  J-тип : JMP [8:0] адрес ;  Jcc [11:9] условие [8:0] адрес
"""
from dataclasses import dataclass, field

OPCODES = {
    "SYS": 0, "LDI": 1, "ADD": 2, "SUB": 3, "AND": 4, "OR": 5, "XOR": 6, "SHL": 7,
    "SHR": 8, "ADDI": 9, "CMP": 10, "JMP": 11, "JCC": 12, "IN": 13, "OUT": 14, "PLOT": 15,
}
SYS_NOP, SYS_HLT = 0, 1
COND = {"JZ": 0, "JNZ": 1, "JC": 2, "JNC": 3}
ROM_WORDS = 512

def sext(v, bits):
    v &= (1 << bits) - 1
    return v - (1 << bits) if v >> (bits - 1) else v

@dataclass
class Cpu:
    rom: list
    levers: int = 0                     # 4 бита
    regs: list = field(default_factory=lambda: [0] * 8)
    pc: int = 0
    z: int = 0
    c: int = 0
    halted: bool = False
    fb: list = field(default_factory=lambda: [[0] * 32 for _ in range(32)])  # fb[y][x]
    digits: list = field(default_factory=lambda: [0, 0, 0])   # 8-сегментные коды (a..g, dp = бит 7)
    steps: int = 0
    trace: list = field(default_factory=list)

    HEX7 = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71]

    def alu(self, op, a, b):
        if op in ("ADD", "ADDI", "LDI"):
            r = a + b; c = r >> 8
        elif op in ("SUB", "CMP"):
            r = a + ((~b) & 0xFF) + 1; c = r >> 8       # C = нет займа (a>=b)
        elif op == "AND": r = a & b; c = 0
        elif op == "OR":  r = a | b; c = 0
        elif op == "XOR": r = a ^ b; c = 0
        elif op == "SHL": r = a << 1; c = r >> 8
        elif op == "SHR": r = a >> 1; c = a & 1
        else: raise ValueError(op)
        return r & 0xFF, c

    def step(self):
        if self.halted:
            return False
        w = self.rom[self.pc] & 0xFFFF
        op = w >> 12
        rd, ra, rb = (w >> 9) & 7, (w >> 6) & 7, (w >> 3) & 7
        pc_next = (self.pc + 1) % ROM_WORDS
        R = self.regs
        name = {v: k for k, v in OPCODES.items()}[op]
        wr = None
        if name == "SYS":
            if (w & 7) == SYS_HLT:
                self.halted = True
        elif name == "LDI":
            wr = w & 0xFF
        elif name in ("ADD", "SUB", "AND", "OR", "XOR"):
            wr, c = self.alu(name, R[ra], R[rb]); self.c = c; self.z = int(wr == 0)
        elif name in ("SHL", "SHR"):
            wr, c = self.alu(name, R[ra], 0); self.c = c; self.z = int(wr == 0)
        elif name == "ADDI":
            wr, c = self.alu("ADDI", R[ra], sext(w & 0x3F, 6) & 0xFF); self.c = c; self.z = int(wr == 0)
        elif name == "CMP":
            r, c = self.alu("CMP", R[ra], R[rb]); self.c = c; self.z = int(r == 0)
        elif name == "JMP":
            pc_next = w & 0x1FF
        elif name == "JCC":
            cond = rd
            take = [self.z == 1, self.z == 0, self.c == 1, self.c == 0, False, False, False, False][cond]
            if take:
                pc_next = w & 0x1FF
        elif name == "IN":
            wr = self.levers & 0xF
        elif name == "OUT":
            if rd < 3:
                v = R[ra]
                self.digits[rd] = self.HEX7[v & 0xF] | (0x80 if v & 0x80 else 0)
        elif name == "PLOT":
            x, y = R[ra] & 31, R[rb] & 31
            self.fb[y][x] ^= 1
        if wr is not None:
            R[rd] = wr & 0xFF
        self.pc = pc_next
        self.steps += 1
        return not self.halted

    def run(self, max_steps=100000):
        while self.steps < max_steps and self.step():
            pass
        return self

    def screen(self):
        return "\n".join("".join("#" if p else "." for p in row) for row in self.fb)
