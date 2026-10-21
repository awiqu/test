"""Декодер команд на ПЛМ: код операции -> линии управления."""
from .pla import PLA
from .isa import OPCODES

# множества кодов операций для каждого сигнала
def _ops(*names):
    return {OPCODES[n] for n in names}

ARITH = _ops("LDI", "ADD", "SUB", "ADC", "ADDI", "CMP")
SIGNALS = {
    "sub":    _ops("SUB", "CMP"),
    "fS":     ARITH,
    "fAND":   _ops("AND"), "fOR": _ops("OR"), "fXOR": _ops("XOR"), "fSHR": _ops("SHR"), "fIN": _ops("IN"),
    "isimm":  _ops("LDI", "ADDI"), "isldi": _ops("LDI"), "isaddi": _ops("ADDI"),
    "enA":    set(range(16)) - _ops("LDI"),
    "enB":    set(range(16)) - _ops("LDI", "ADDI"),
    "wr":     _ops("LDI", "ADD", "SUB", "AND", "OR", "XOR", "SHR", "ADC", "ADDI", "IN"),
    "setf":   _ops("ADD", "SUB", "AND", "OR", "XOR", "SHR", "ADC", "ADDI", "CMP"),
    "isadc":  _ops("ADC"),
    "isjmp":  _ops("JMP"), "isjcc": _ops("JCC"),
    "isout":  _ops("OUT"), "isplot": _ops("PLOT"),
}
# выходы с инверсией (активный низкий уровень), вычисляются как дополнение множества
INVERTED = {"nsub": "sub", "nfS": "fS", "nfAND": "fAND", "nfOR": "fOR", "nfXOR": "fXOR", "nfSHR": "fSHR", "nfIN": "fIN"}

def signal_values(op, i0=0):
    """эталон: значения всех выходов для кода операции"""
    v = {k: int(op in s) for k, s in SIGNALS.items()}
    for n, b in INVERTED.items():
        v[n] = 1 - v[b]
    v["ishlt"] = int(op == OPCODES["SYS"] and i0 == 1)
    return v

def control_outputs():
    outs = {}
    for k, s in SIGNALS.items():
        outs[k] = [[(f"op{b}", (op >> b) & 1) for b in range(4)] for op in sorted(s)]
    for n, b in INVERTED.items():
        s = set(range(16)) - SIGNALS[b]
        outs[n] = [[(f"op{bb}", (op >> bb) & 1) for bb in range(4)] for op in sorted(s)]
    # HLT: SYS и I0
    outs["ishlt"] = [[("op0", 0), ("op1", 0), ("op2", 0), ("op3", 0), ("i0", 1)]]
    return outs

def build_control(g, ox, oz):
    outs = control_outputs()
    return PLA(g, ox, oz, ["op0", "op1", "op2", "op3", "i0"], outs)
