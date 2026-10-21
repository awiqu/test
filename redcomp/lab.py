"""Лабораторный стенд: построить схему на сервере, дёргать входы, читать выходы."""
from .grid import Grid
from .sim import Server

class Lab:
    def __init__(self, origin=(0, -60, 0), size=(40, 12, 40), floor=True, server=None):
        self.S = server or Server()
        self.O = origin
        self.size = size
        self.g = Grid()
        self.inputs = {}
        self.floor = floor

    def reset(self):
        ox, oy, oz = self.O
        sx, sy, sz = self.size
        self.S.clear((ox - 1, oy - 1, oz - 1), (ox + sx, oy + sy, oz + sz))
        self.g = Grid()
        if self.floor:                      # пол одной командой fill плитками (не по блоку)
            T = 128
            for xa in range(-1, sx, T):
                for za in range(-1, sz, T):
                    xb, zb = min(xa + T - 1, sx - 1), min(za + T - 1, sz - 1)
                    self.S.cmd(f"fill {ox + xa} {oy - 1} {oz + za} {ox + xb} {oy - 1} {oz + zb} minecraft:stone")
        return self.g

    def build(self, fast=None):
        """загрузка схемы: большие схемы — датапаком (/place template), малые — setblock"""
        if fast is None:
            fast = len(self.g.b) > 4000
        if not fast:
            self.S.load(self.g, self.O)
            return
        import os
        from .export import write_datapack
        self.g.fix_wires()
        base = "/tmp/mc/srv/world/datapacks"
        write_datapack(self.g, base, name="labdp", tile=96)
        first = not getattr(Lab, "_dp_enabled", False)
        self.S.cmd("reload")
        if first:
            self.S.cmd('datapack enable "file/labdp"'); Lab._dp_enabled = True
            self.S.cmd("reload")
        self.S.step(5)
        ox, oy, oz = self.O
        self.S.cmd(f"execute positioned {ox} {oy} {oz} run function labdp:build")
        self.S.step(10)
        self.S.cmd(f"execute positioned {ox} {oy} {oz} run function labdp:refresh")
        self.S.step(10)

    def abs(self, p):
        return (p[0] + self.O[0], p[1] + self.O[1], p[2] + self.O[2])

    def set_block(self, p, name):
        a = self.abs(p)
        self.S.cmd(f"setblock {a[0]} {a[1]} {a[2]} minecraft:{name}")

    def drive(self, p, on):
        self.set_block(p, "redstone_block" if on else "air")

    def run(self, n):
        self.S.step(n)

    def on(self, p):
        return self.S.is_on(p, self.g, self.O)

    def level(self, p):
        return self.S.power(p, self.g, self.O)

    def sig(self, p):
        """логический уровень порта: пыль power>0, повторитель/компаратор powered"""
        b = self.g.get(*p)
        if b is None:
            return False
        if b.name == "redstone_wire":
            return self.level(p) > 0
        return self.on(p)

    def state(self, p):
        """текст блокстейта через /data не доступен -> спрашиваем набором тестов"""
        return None
