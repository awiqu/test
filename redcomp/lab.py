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
        if self.floor:
            for x in range(-1, sx):
                for z in range(-1, sz):
                    self.g.solid(x, -1, z, "stone")
        return self.g

    def build(self):
        self.S.load(self.g, self.O)

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

    def state(self, p):
        """текст блокстейта через /data не доступен -> спрашиваем набором тестов"""
        return None
