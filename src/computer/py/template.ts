/**
 * Шаблон Python-файла: ассемблер + дизассемблер + эмулятор для сгенерированного компьютера.
 * Метки @@...@@ заменяются в pyexport.ts. Синтаксис ассемблера и семантика полностью совпадают с встроенными (TypeScript).
 */
export const PY_TEMPLATE = String.raw`#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
@@TITLE@@ — ассемблер, дизассемблер и эмулятор.
Файл создан в RedLogic (раздел «Компьютеры»). Его можно править: это ваш собственный ассемблер.

Использование:
  python @@FILE@@ asm  prog.asm [-o prog.hex] [--format hex|bin|json|mem]   ассемблировать
  python @@FILE@@ run  prog.asm [--max-steps N] [--switches N] [--keys TEXT] [--json]  выполнить в эмуляторе
  python @@FILE@@ dis  prog.hex                                            дизассемблировать образ (hex)

Формат ассемблера: метки "name:", комментарии ";" и "//", директивы .org .equ .word .fill .string .ascii,
операнды: регистры r0.., числа (10, 0x1F, 0b101, 'A'), метки и выражения, "#" и "[ ]" необязательны.
Для полей off (BR) указывается АДРЕС назначения — ассемблер сам считает смещение.
"""
import argparse
import json
import math
import re
import sys

SPEC = json.loads(r'''@@SPEC_JSON@@''')
ISA = json.loads(r'''@@ISA_JSON@@''')
ASM_OPTS = json.loads(r'''@@ASM_JSON@@''')

W = SPEC["dataBits"]
MASK = (1 << W) - 1
PC_MASK = (1 << SPEC["pcBits"]) - 1
RAM_MASK = (1 << SPEC["ramAddrBits"]) - 1
INSTR_BITS = SPEC["instrBits"]
OPCODE_BITS = SPEC["opcodeBits"]
REG_COUNT = SPEC["regCount"]
REG_BITS = 0 if REG_COUNT <= 1 else int(math.ceil(math.log2(REG_COUNT)))
ROM_WORDS = SPEC["romWords"]
RAM_WORDS = SPEC["ramWords"]
FLAGS = SPEC["flags"]

DEVICE_PORTS = {
    "leds": ["LEDS"], "switches": ["SWITCH"], "buttons": ["BTN"], "sevenseg": ["SEG"],
    "text": ["TXT", "TXTPOS"], "pixel": ["PX", "PY", "PIX", "PCLR"], "keyboard": ["KEY"],
    "timer": ["TIMER"], "random": ["RAND"], "sound": ["SOUND"], "terminal": ["TERM"],
}


def build_port_map():
    entries = []
    for dev in SPEC["devices"]:
        for off, name in enumerate(DEVICE_PORTS[dev["type"]]):
            entries.append((dev["id"], dev["type"], off, name))
    base = (1 << SPEC["ramAddrBits"]) - len(entries)
    return [dict(device=e[0], type=e[1], off=e[2], name=e[3], addr=base + i) for i, e in enumerate(entries)]


PORT_MAP = build_port_map()
PORTS = {p["name"]: p["addr"] for p in PORT_MAP}

FIELD_BITS = {
    "rd": REG_BITS, "rs": REG_BITS, "rt": REG_BITS,
    "imm": W, "addr": SPEC["ramAddrBits"], "target": SPEC["pcBits"], "off": SPEC["pcBits"],
}


def layout(fmt):
    names = [x.strip().lower() for x in fmt.split(",") if x.strip()]
    shift = INSTR_BITS - OPCODE_BITS
    out = []
    for n in names:
        bits = FIELD_BITS[n]
        shift -= bits
        out.append(dict(name=n, bits=bits, shift=shift, signed=(n == "off")))
    return out


BY_MNEMONIC = {i["mnemonic"].upper(): i for i in ISA}
BY_OPCODE = {i["opcode"]: i for i in ISA}


def encode(inst, vals):
    word = inst["opcode"] << (INSTR_BITS - OPCODE_BITS)
    for f in layout(inst["format"]):
        v = vals.get(f["name"], 0) & ((1 << f["bits"]) - 1)
        word |= v << f["shift"]
    return word


def decode(word):
    opcode = (word >> (INSTR_BITS - OPCODE_BITS)) & ((1 << OPCODE_BITS) - 1)
    inst = BY_OPCODE.get(opcode)
    if inst is None:
        return None
    fields = {}
    for f in layout(inst["format"]):
        v = (word >> f["shift"]) & ((1 << f["bits"]) - 1)
        if f["signed"] and v >= (1 << (f["bits"] - 1)):
            v -= 1 << f["bits"]
        fields[f["name"]] = v
    return inst, fields


# ───────────── Ассемблер ─────────────

class AsmError(Exception):
    pass


def strip_comment(s):
    q = None
    i = 0
    while i < len(s):
        c = s[i]
        if q:
            if c == "\\":
                i += 1
            elif c == q:
                q = None
        else:
            if c in "\"'":
                q = c
            elif c == ";":
                return s[:i]
            elif c == "/" and s[i + 1:i + 2] == "/":
                return s[:i]
        i += 1
    return s


def split_args(s):
    out = []
    depth = 0
    q = None
    cur = ""
    i = 0
    while i < len(s):
        c = s[i]
        if q:
            cur += c
            if c == "\\":
                i += 1
                cur += s[i] if i < len(s) else ""
            elif c == q:
                q = None
        elif c in "\"'":
            q = c
            cur += c
        elif c in "([":
            depth += 1
            cur += c
        elif c in ")]":
            depth -= 1
            cur += c
        elif c == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += c
        i += 1
    if cur.strip() != "" or out:
        out.append(cur.strip())
    return out


def parse_lines(source):
    lines = []
    for idx, raw in enumerate(re.split(r"\r?\n", source)):
        s = strip_comment(raw).strip()
        labels = []
        while True:
            m = re.match(r"^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$", s)
            if not m:
                break
            labels.append(m.group(1))
            s = m.group(2)
        eq = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$", s)
        if eq:
            lines.append(dict(no=idx + 1, labels=labels, op=".equ", args=[eq.group(1), eq.group(2).strip()], text=s))
            continue
        if s == "":
            lines.append(dict(no=idx + 1, labels=labels, op=None, args=[], text=""))
            continue
        m = re.match(r"^(\S+)\s*(.*)$", s)
        lines.append(dict(no=idx + 1, labels=labels, op=m.group(1), args=([] if m.group(2) == "" else split_args(m.group(2))), text=s))
    return lines


def eval_expr(src, lookup, here):
    pos = [0]

    def ws():
        while pos[0] < len(src) and src[pos[0]] in " \t":
            pos[0] += 1

    def peek():
        return src[pos[0]] if pos[0] < len(src) else ""

    def primary():
        ws()
        c = peek()
        if c == "(":
            pos[0] += 1
            v = parse_or()
            ws()
            if peek() != ")":
                raise AsmError("Ожидалось «)»")
            pos[0] += 1
            return v
        if c == "-":
            pos[0] += 1
            return -primary()
        if c == "+":
            pos[0] += 1
            return primary()
        if c == "~":
            pos[0] += 1
            return ~primary()
        if c == "$":
            pos[0] += 1
            return here
        if c == "'":
            m = re.match(r"^'(\\.|[^'\\])'", src[pos[0]:])
            if not m:
                raise AsmError("Неверный символьный литерал")
            pos[0] += len(m.group(0))
            ch = m.group(1)
            if ch[0] == "\\":
                return {"n": 10, "t": 9, "r": 13, "0": 0, "\\": 92, "'": 39}.get(ch[1], ord(ch[1]))
            return ord(ch[0])
        m = re.match(r"^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)", src[pos[0]:])
        if m:
            pos[0] += len(m.group(0))
            t = m.group(0)
            if t[:2].lower() == "0x":
                return int(t[2:], 16)
            if t[:2].lower() == "0b":
                return int(t[2:], 2)
            return int(t, 10)
        m = re.match(r"^[A-Za-z_.][A-Za-z0-9_.]*", src[pos[0]:])
        if m:
            pos[0] += len(m.group(0))
            v = lookup(m.group(0))
            if v is None:
                raise AsmError("Неизвестное имя «%s»" % m.group(0))
            return v
        raise AsmError("Неожиданный символ «%s» в выражении «%s»" % (peek() or "конец", src))

    def binary(nxt, ops):
        def fn():
            l = nxt()
            while True:
                ws()
                op = None
                for o in ops:
                    if src.startswith(o, pos[0]):
                        op = o
                        break
                if op is None:
                    return l
                pos[0] += len(op)
                r = nxt()
                if op == "*":
                    l = l * r
                elif op == "/":
                    if r == 0:
                        raise AsmError("Деление на ноль")
                    l = int(l / r)
                elif op == "%":
                    if r == 0:
                        raise AsmError("Деление на ноль")
                    l = int(math.fmod(l, r))
                elif op == "+":
                    l = l + r
                elif op == "-":
                    l = l - r
                elif op == "<<":
                    l = l * (2 ** r)
                elif op == ">>":
                    l = l // (2 ** r)
                elif op == "&":
                    l = l & r
                elif op == "^":
                    l = l ^ r
                elif op == "|":
                    l = l | r
        return fn

    mul = binary(primary, ["*", "/", "%"])
    add = binary(mul, ["+", "-"])
    shift = binary(add, ["<<", ">>"])
    band = binary(shift, ["&"])
    bxor = binary(band, ["^"])
    parse_or = binary(bxor, ["|"])
    v = parse_or()
    ws()
    if pos[0] < len(src):
        raise AsmError("Лишний текст «%s» в выражении" % src[pos[0]:])
    return v


def strip_operand(op):
    s = op.strip()
    if s.startswith("#"):
        s = s[1:].strip()
    if s.startswith("[") and s.endswith("]"):
        d = 0
        wraps = True
        for i in range(len(s) - 1):
            if s[i] == "[":
                d += 1
            elif s[i] == "]":
                d -= 1
            if d == 0:
                wraps = False
                break
        if wraps:
            s = s[1:-1].strip()
    return s


def unescape_string(s):
    table = {"n": "\n", "t": "\t", "r": "\r", "0": "\0", "\\": "\\", '"': '"'}
    return re.sub(r"\\(.)", lambda m: table.get(m.group(1), m.group(1)), s)


class Assembly:
    def __init__(self):
        self.words = [0] * ROM_WORDS
        self.used = [False] * ROM_WORDS
        self.labels = {}
        self.listing = []
        self.errors = []
        self.warnings = []
        self.size = 0

    def ok(self):
        return not self.errors


def operand_value(f, raw, ev, here):
    if f in ("rd", "rs", "rt"):
        m = re.match(r"^%s(\d+)$" % re.escape(ASM_OPTS["regPrefix"]), raw.strip(), re.I)
        if not m:
            raise AsmError("ожидался регистр %s0…%s%d, получено «%s»" % (ASM_OPTS["regPrefix"], ASM_OPTS["regPrefix"], REG_COUNT - 1, raw))
        n = int(m.group(1))
        if n >= REG_COUNT:
            raise AsmError("регистра %s нет (всего %d)" % (raw, REG_COUNT))
        return n
    v = ev(raw)
    if f == "imm":
        lo = -(1 << (W - 1))
        hi = (1 << W) - 1
        if v < lo or v > hi:
            raise AsmError("значение %d не помещается в %d бит (%d…%d)" % (v, W, lo, hi))
        return v % (1 << W)
    if f == "addr":
        if v < 0 or v >= (1 << SPEC["ramAddrBits"]):
            raise AsmError("адрес %d вне 0…%d" % (v, (1 << SPEC["ramAddrBits"]) - 1))
        return v
    if f == "target":
        if v < 0 or v >= (1 << SPEC["pcBits"]):
            raise AsmError("адрес перехода %d вне 0…%d" % (v, (1 << SPEC["pcBits"]) - 1))
        return v
    off = v - here
    half = 1 << (SPEC["pcBits"] - 1)
    if off < -half or off >= half:
        raise AsmError("переход на %d слишком далёк (смещение %d, допустимо %d…%d)" % (v, off, -half, half - 1))
    return off


def assemble(source):
    res = Assembly()
    case_sensitive = ASM_OPTS.get("caseSensitiveLabels", False)

    def key(n):
        return n if case_sensitive else n.lower()

    def err(line, msg):
        res.errors.append((line, msg))

    def warn(line, msg):
        res.warnings.append((line, msg))

    symbols = {}
    label_line = {}
    for p in PORT_MAP:
        symbols[key(p["name"])] = p["addr"]
    symbols[key("ROM_SIZE")] = ROM_WORDS
    symbols[key("RAM_SIZE")] = RAM_WORDS
    if SPEC["stack"]["enabled"]:
        symbols[key("STACK_TOP")] = RAM_WORDS

    def lookup(n):
        return symbols.get(key(n))

    lines = parse_lines(source)
    items = []
    pc = 0
    for ln in lines:
        for lab in ln["labels"]:
            k = key(lab)
            if k in symbols:
                err(ln["no"], "Имя «%s» уже определено%s" % (lab, " (строка %d)" % label_line[k] if k in label_line else ""))
            else:
                symbols[k] = pc
                res.labels[lab] = pc
                label_line[k] = ln["no"]
        op = ln["op"]
        if not op:
            continue
        if op.startswith("."):
            d = op.lower()
            if d == ".org":
                if len(ln["args"]) != 1:
                    err(ln["no"], ".org принимает один адрес")
                    continue
                try:
                    pc = eval_expr(strip_operand(ln["args"][0]), lookup, pc)
                except AsmError as e:
                    err(ln["no"], str(e))
            elif d in (".equ", ".set"):
                if len(ln["args"]) != 2:
                    err(ln["no"], ".equ принимает имя и значение: .equ ИМЯ, значение")
                    continue
                name = ln["args"][0]
                if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
                    err(ln["no"], "Неверное имя «%s»" % name)
                elif key(name) in symbols:
                    err(ln["no"], "Имя «%s» уже определено" % name)
                else:
                    try:
                        symbols[key(name)] = eval_expr(strip_operand(ln["args"][1]), lookup, pc)
                    except AsmError as e:
                        err(ln["no"], str(e))
            elif d == ".word":
                if len(ln["args"]) == 0:
                    err(ln["no"], ".word требует значения")
                items.append(dict(line=ln, addr=pc, kind="word", args=ln["args"]))
                pc += len(ln["args"])
            elif d == ".fill":
                if len(ln["args"]) < 1 or len(ln["args"]) > 2:
                    err(ln["no"], ".fill: количество[, значение]")
                    continue
                n = 0
                try:
                    n = eval_expr(strip_operand(ln["args"][0]), lookup, pc)
                except AsmError as e:
                    err(ln["no"], str(e))
                items.append(dict(line=ln, addr=pc, kind="fill", args=ln["args"]))
                pc += max(0, n)
            elif d in (".string", ".ascii"):
                m = re.match(r'^"((?:\\.|[^"\\])*)"$', ",".join(ln["args"]).strip())
                if not m:
                    err(ln["no"], "%s ожидает строку в кавычках" % d)
                    continue
                n = len(unescape_string(m.group(1))) + (1 if d == ".string" else 0)
                items.append(dict(line=ln, addr=pc, kind="string", args=[d, m.group(1)]))
                pc += n
            else:
                err(ln["no"], "Неизвестная директива «%s»" % op)
            continue
        inst = BY_MNEMONIC.get(op.upper())
        if inst is None:
            err(ln["no"], "Неизвестная инструкция «%s»" % op)
            continue
        items.append(dict(line=ln, addr=pc, kind="inst", inst=inst, args=ln["args"]))
        pc += 1

    word_mod = 1 << INSTR_BITS

    def emit(addr, w, line):
        if addr < 0 or addr >= ROM_WORDS:
            err(line, "Адрес %d вне ПЗУ (0…%d)" % (addr, ROM_WORDS - 1))
            return
        if res.used[addr]:
            warn(line, "Адрес %d уже занят — значение перезаписано" % addr)
        res.words[addr] = w
        res.used[addr] = True

    for it in items:
        ln = it["line"]
        here = it["addr"]

        def ev(s, here=here):
            return eval_expr(strip_operand(s), lookup, here)

        try:
            if it["kind"] == "word":
                ws_ = [ev(a) % word_mod for a in it["args"]]
                for k, w in enumerate(ws_):
                    emit(here + k, w, ln["no"])
                res.listing.append((ln["no"], here, ws_, ln["text"]))
            elif it["kind"] == "fill":
                n = ev(it["args"][0])
                v = ev(it["args"][1]) if len(it["args"]) > 1 else 0
                ws_ = [v % word_mod] * max(0, n)
                for k, w in enumerate(ws_):
                    emit(here + k, w, ln["no"])
                res.listing.append((ln["no"], here, ws_[:8], ln["text"]))
            elif it["kind"] == "string":
                chars = [ord(c) for c in unescape_string(it["args"][1])]
                if it["args"][0] == ".string":
                    chars.append(0)
                for k, w in enumerate(chars):
                    emit(here + k, w % word_mod, ln["no"])
                res.listing.append((ln["no"], here, chars[:8], ln["text"]))
            else:
                inst = it["inst"]
                need = [x.strip().lower() for x in inst["format"].split(",") if x.strip()]
                if len(it["args"]) != len(need):
                    err(ln["no"], "%s ждёт операндов: %d%s, получено %d" % (inst["mnemonic"], len(need), " (%s)" % ", ".join(need) if need else "", len(it["args"])))
                    continue
                vals = {}
                bad = False
                for k, f in enumerate(need):
                    try:
                        vals[f] = operand_value(f, it["args"][k], ev, here)
                    except AsmError as e:
                        err(ln["no"], "%s, операнд %d (%s): %s" % (inst["mnemonic"], k + 1, f, e))
                        bad = True
                if bad:
                    continue
                w = encode(inst, vals)
                emit(here, w, ln["no"])
                res.listing.append((ln["no"], here, [w], ln["text"]))
        except AsmError as e:
            err(ln["no"], str(e))

    for a in range(len(res.used)):
        if res.used[a]:
            res.size = a + 1
    if pc > ROM_WORDS:
        err(1, "Программа не помещается в ПЗУ: %d слов, доступно %d" % (pc, ROM_WORDS))
    return res


def fmt_operand(name, v):
    if name in ("rd", "rs", "rt"):
        return "%s%d" % (ASM_OPTS["regPrefix"], v)
    if name == "imm":
        return "0x%X" % v if v > 9 else str(v)
    if name == "addr":
        for p in PORT_MAP:
            if p["addr"] == v:
                return p["name"]
        return "0x%X" % v if v > 9 else str(v)
    if name == "target":
        return str(v)
    return ("$+%d" % v) if v >= 0 else ("$%d" % v)


def disassemble(word):
    d = decode(word)
    if d is None:
        return ".word 0x%X   ; неизвестный код" % word
    inst, fields = d
    ops = [fmt_operand(f["name"], fields.get(f["name"], 0)) for f in layout(inst["format"])]
    return inst["mnemonic"] + (" " + ", ".join(ops) if ops else "")


# ───────────── Эмулятор ─────────────

class Devices:
    """Устройства: те же порты и поведение, что и в браузерном эмуляторе."""

    def __init__(self):
        self.leds = 0
        self.switches = 0
        self.buttons = 0
        self.seg = 0
        self.txt_cursor = 0
        self.keys = []
        self.timer = 0
        self.timer_acc = 0
        self.seed = 12345
        self.note = 0
        self.terminal = []
        self.text_opts = {}
        self.pixel_opts = {}
        self.opts = {}
        for d in SPEC["devices"]:
            self.opts[d["type"]] = d.get("options", {})
        t = self.opts.get("text")
        if t:
            self.cols, self.rows = t.get("cols", 16), t.get("rows", 2)
            self.cells = [0] * (self.cols * self.rows)
        p = self.opts.get("pixel")
        if p:
            self.pw, self.ph = p.get("width", 8), p.get("height", 8)
            self.pixels = [0] * (self.pw * self.ph)
            self.px = 0
            self.py = 0
        self.led_mask = (1 << min(self.opts.get("leds", {}).get("count", 8), W)) - 1
        self.sw_mask = (1 << min(self.opts.get("switches", {}).get("count", 8), W)) - 1
        self.btn_mask = (1 << min(self.opts.get("buttons", {}).get("count", 4), W)) - 1
        self.period = max(1, self.opts.get("timer", {}).get("period", 16))

    def scroll(self):
        self.cells = self.cells[self.cols:] + [0] * self.cols

    def read(self, name):
        if name == "LEDS":
            return self.leds
        if name == "SWITCH":
            return self.switches & self.sw_mask
        if name == "BTN":
            return self.buttons & self.btn_mask
        if name == "SEG":
            return self.seg
        if name == "TXTPOS":
            return self.txt_cursor
        if name == "PX":
            return self.px
        if name == "PY":
            return self.py
        if name == "PIX":
            return self.pixels[self.py * self.pw + self.px] if self.px < self.pw and self.py < self.ph else 0
        if name == "KEY":
            return self.keys.pop(0) if self.keys else 0
        if name == "TIMER":
            return self.timer
        if name == "RAND":
            self.seed = (self.seed * 1103515245 + 12345) & 0xFFFFFFFF
            return (self.seed >> 8) & MASK
        return 0

    def write(self, name, v):
        if name == "LEDS":
            self.leds = v & self.led_mask
        elif name == "SEG":
            self.seg = v & MASK
        elif name == "TXT":
            n = self.cols * self.rows
            if v == 12:
                self.cells = [0] * n
                self.txt_cursor = 0
            elif v == 13:
                self.txt_cursor -= self.txt_cursor % self.cols
            elif v == 10:
                self.txt_cursor = (self.txt_cursor // self.cols + 1) * self.cols
                if self.txt_cursor >= n:
                    self.scroll()
                    self.txt_cursor = (self.rows - 1) * self.cols
            elif v == 8:
                if self.txt_cursor > 0:
                    self.txt_cursor -= 1
                    self.cells[self.txt_cursor] = 0
            else:
                self.cells[self.txt_cursor] = v
                self.txt_cursor += 1
                if self.txt_cursor >= n:
                    self.scroll()
                    self.txt_cursor = (self.rows - 1) * self.cols
        elif name == "TXTPOS":
            self.txt_cursor = max(0, min(self.cols * self.rows - 1, v))
        elif name == "PX":
            self.px = v
        elif name == "PY":
            self.py = v
        elif name == "PIX":
            if self.px < self.pw and self.py < self.ph:
                self.pixels[self.py * self.pw + self.px] = v & 1
        elif name == "PCLR":
            self.pixels = [0] * (self.pw * self.ph)
        elif name == "KEY":
            self.keys = []
        elif name == "TIMER":
            self.timer = v & MASK
        elif name == "SOUND":
            self.note = v
        elif name == "TERM":
            if len(self.terminal) < 20000:
                self.terminal.append(chr(v & 0xFF))

    def tick(self, cycles):
        if "timer" in self.opts:
            self.timer_acc += cycles
            while self.timer_acc >= self.period:
                self.timer_acc -= self.period
                self.timer = (self.timer + 1) & MASK

    def text_lines(self):
        out = []
        for r in range(self.rows):
            s = ""
            for c in range(self.cols):
                v = self.cells[r * self.cols + c]
                s += chr(v) if 32 <= v < 127 else " "
            out.append(s)
        return out


class Machine:
    def __init__(self, rom):
        self.rom = rom
        self.R = [0] * REG_COUNT
        self.pc = 0
        self.sp = (RAM_WORDS & RAM_MASK) if SPEC["stack"]["enabled"] else 0
        self.flags = {"Z": 0, "C": 0, "N": 0, "V": 0}
        self.ram = [0] * RAM_WORDS
        self.t = [0, 0, 0, 0]
        self.next_pc = None
        self.halted = False
        self.fault = None
        self.steps = 0
        self.cycles = 0
        self.dev = Devices()
        self.W, self.MASK, self.PC_MASK, self.RAM_MASK, self.PORTS = W, MASK, PC_MASK, RAM_MASK, PORTS
        self.port_at = {p["addr"]: p["name"] for p in PORT_MAP}

    # --- шина данных
    def read(self, addr):
        addr &= RAM_MASK
        if addr < len(self.ram):
            return self.ram[addr]
        name = self.port_at.get(addr)
        return self.dev.read(name) & MASK if name else 0

    def write(self, addr, v):
        addr &= RAM_MASK
        v &= MASK
        if addr < len(self.ram):
            self.ram[addr] = v
            return
        name = self.port_at.get(addr)
        if name:
            self.dev.write(name, v)

    # --- флаги
    def flag(self, n):
        return self.flags[n]

    def set_flag(self, n, v):
        if n in FLAGS:
            self.flags[n] = 1 if v else 0

    def msb(self, x):
        return (x >> (W - 1)) & 1

    def lsb(self, x):
        return x & 1

    def mask(self, x):
        return x & MASK

    def sext(self, x):
        v = x & MASK
        return v - (1 << W) if v & (1 << (W - 1)) else v

    def lt_s(self, a, b):
        return 1 if self.sext(a) < self.sext(b) else 0

    def zn(self, res):
        self.set_flag("Z", 1 if res == 0 else 0)
        self.set_flag("N", self.msb(res))

    # --- АЛУ (семантика флагов совпадает с браузерным эмулятором)
    def alu_add(self, a, b, cin=0):
        a &= MASK
        b &= MASK
        full = a + b + (cin & 1)
        res = full & MASK
        self.set_flag("C", 1 if full > MASK else 0)
        self.set_flag("V", ((~(a ^ b) & (a ^ res)) >> (W - 1)) & 1)
        self.zn(res)
        return res

    def alu_inc(self, a):
        return self.alu_add(a, 1, 0)

    def alu_sub(self, a, b):
        a &= MASK
        b &= MASK
        res = (a - b) & MASK
        self.set_flag("C", 1 if a < b else 0)
        self.set_flag("V", (((a ^ b) & (a ^ res)) >> (W - 1)) & 1)
        self.zn(res)
        return res

    def alu_dec(self, a):
        return self.alu_sub(a, 1)

    def alu_neg(self, a):
        return self.alu_sub(0, a)

    def _logic(self, res):
        self.set_flag("C", 0)
        self.set_flag("V", 0)
        self.zn(res)
        return res

    def alu_and(self, a, b):
        return self._logic((a & MASK) & (b & MASK))

    def alu_or(self, a, b):
        return self._logic((a & MASK) | (b & MASK))

    def alu_xor(self, a, b):
        return self._logic((a & MASK) ^ (b & MASK))

    def alu_not(self, a):
        return self._logic(~a & MASK)

    def _shift(self, kind, a, n):
        res = a & MASK
        n = 1 if n is None else n
        carry = 0
        for _ in range(n):
            if kind == "shl":
                carry = self.msb(res)
                res = (res << 1) & MASK
            elif kind == "shr":
                carry = res & 1
                res = res >> 1
            elif kind == "asr":
                carry = res & 1
                res = (res >> 1) | (res & (1 << (W - 1)))
            elif kind == "rol":
                carry = self.msb(res)
                res = ((res << 1) | carry) & MASK
            else:
                carry = res & 1
                res = (res >> 1) | (carry << (W - 1))
        self.set_flag("C", carry)
        self.set_flag("V", 0)
        self.zn(res)
        return res

    def alu_shl(self, a, n=None):
        return self._shift("shl", a, n)

    def alu_shr(self, a, n=None):
        return self._shift("shr", a, n)

    def alu_asr(self, a, n=None):
        return self._shift("asr", a, n)

    def alu_rol(self, a, n=None):
        return self._shift("rol", a, n)

    def alu_ror(self, a, n=None):
        return self._shift("ror", a, n)

    def alu_mul(self, a, b):
        full = (a & MASK) * (b & MASK)
        res = full & MASK
        self.set_flag("C", 1 if (full >> W) != 0 else 0)
        self.set_flag("V", 0)
        self.zn(res)
        return res

    # --- стек и управление
    def push(self, v):
        self.sp = (self.sp - 1) & RAM_MASK
        self.write(self.sp, v & MASK)

    def pop(self):
        v = self.read(self.sp & RAM_MASK) & MASK
        self.sp = (self.sp + 1) & RAM_MASK
        return v

    def peek(self):
        return self.read(self.sp & RAM_MASK) & MASK

    def do_call(self, target):
        self.push(self.pc + 1)
        self.next_pc = target & PC_MASK

    def ret(self):
        v = self.read(self.sp & RAM_MASK) & MASK
        self.sp = (self.sp + 1) & RAM_MASK
        self.next_pc = v & PC_MASK

    def set_zn(self, x):
        self.zn(x & MASK)

    def set_c(self, x):
        self.set_flag("C", x)

    def set_v(self, x):
        self.set_flag("V", x)

    def skip(self):
        self.next_pc = (self.pc + 2) & PC_MASK

    def halt(self):
        self.halted = True

    def nop(self):
        pass

    def step(self):
        if self.halted:
            return
        if self.pc >= len(self.rom):
            self.fault = "PC=%d вне ПЗУ" % self.pc
            self.halted = True
            return
        d = decode(self.rom[self.pc])
        if d is None:
            self.fault = "Неизвестный код операции в слове 0x%x по адресу %d" % (self.rom[self.pc], self.pc)
            self.halted = True
            return
        inst, fields = d
        self.next_pc = None
        self.t = [0, 0, 0, 0]
        EXEC[inst["opcode"]](self, **{("f_" + k): v for k, v in fields.items()})
        self.steps += 1
        self.cycles += inst["cycles"]
        self.dev.tick(inst["cycles"])
        if not self.halted:
            self.pc = self.next_pc if self.next_pc is not None else (self.pc + 1) & PC_MASK

    def run(self, max_steps=1000000):
        n = 0
        while not self.halted and n < max_steps:
            self.step()
            n += 1
        return n


# ───────────── Описание инструкций (код получен из RTL) ─────────────

@@EXEC_FUNCS@@

EXEC = {
@@EXEC_TABLE@@
}


# ───────────── Командная строка ─────────────

def read_hex(path):
    words = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split(";")[0].strip()
            if line:
                words.append(int(line.split()[0], 16))
    return words


def write_output(res, path, fmt):
    digits = (INSTR_BITS + 3) // 4
    words = res.words[:max(res.size, 1)]
    if fmt == "hex":
        text = "\n".join(format(w, "0%dX" % digits) for w in words) + "\n"
    elif fmt == "bin":
        text = "\n".join(format(w, "0%db" % INSTR_BITS) for w in words) + "\n"
    elif fmt == "mem":
        text = "\n".join("%d: %s" % (i, format(w, "0%dX" % digits)) for i, w in enumerate(words)) + "\n"
    else:
        text = json.dumps({"words": words, "labels": res.labels, "size": res.size, "instrBits": INSTR_BITS}, ensure_ascii=False, indent=2) + "\n"
    if path:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        sys.stdout.write(text)


def report(res):
    for line, msg in res.warnings:
        sys.stderr.write("предупреждение, строка %d: %s\n" % (line, msg))
    for line, msg in res.errors:
        sys.stderr.write("ОШИБКА, строка %d: %s\n" % (line, msg))


def main(argv=None):
    ap = argparse.ArgumentParser(description="@@TITLE@@: ассемблер и эмулятор")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("asm")
    a.add_argument("source")
    a.add_argument("-o", "--output")
    a.add_argument("--format", default="hex", choices=["hex", "bin", "json", "mem"])
    r = sub.add_parser("run")
    r.add_argument("source")
    r.add_argument("--max-steps", type=int, default=1000000)
    r.add_argument("--switches", type=lambda x: int(x, 0), default=0)
    r.add_argument("--keys", default="")
    r.add_argument("--json", action="store_true")
    d = sub.add_parser("dis")
    d.add_argument("image")
    args = ap.parse_args(argv)

    if args.cmd == "dis":
        for i, w in enumerate(read_hex(args.image)):
            print("%04d: %s  %s" % (i, format(w, "0%dX" % ((INSTR_BITS + 3) // 4)), disassemble(w)))
        return 0

    with open(args.source, encoding="utf-8") as f:
        res = assemble(f.read())
    report(res)
    if not res.ok():
        return 1
    if args.cmd == "asm":
        write_output(res, args.output, args.format)
        return 0

    m = Machine(res.words)
    m.dev.switches = args.switches
    m.dev.keys = [ord(c) for c in args.keys]
    n = m.run(args.max_steps)
    state = {
        "halted": m.halted, "fault": m.fault, "steps": m.steps, "cycles": m.cycles, "pc": m.pc, "sp": m.sp,
        "regs": m.R, "flags": {k: m.flags[k] for k in FLAGS}, "ram": m.ram,
        "leds": m.dev.leds, "seg": m.dev.seg, "terminal": "".join(m.dev.terminal),
    }
    if "text" in m.dev.opts:
        state["text"] = m.dev.text_lines()
    if "pixel" in m.dev.opts:
        state["pixels"] = m.dev.pixels
    if args.json:
        print(json.dumps(state, ensure_ascii=False))
    else:
        print("шагов: %d, тактов: %d, остановлен: %s%s" % (m.steps, m.cycles, m.halted, " (%s)" % m.fault if m.fault else ""))
        print("регистры:", m.R, "флаги:", state["flags"])
        if state["terminal"]:
            print("--- терминал ---")
            print(state["terminal"], end="")
        if "text" in state:
            print("--- текстовый экран ---")
            for line in state["text"]:
                print("|" + line + "|")
        if "pixels" in state:
            print("--- пиксели ---")
            for y in range(m.dev.ph):
                print("".join("#" if m.dev.pixels[y * m.dev.pw + x] else "." for x in range(m.dev.pw)))
        print("LEDS=%d SEG=%d" % (m.dev.leds, m.dev.seg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
