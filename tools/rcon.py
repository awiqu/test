"""Минимальный RCON-клиент для тестов на живом сервере Minecraft."""
import socket, struct, time

class Rcon:
    def __init__(self, host="127.0.0.1", port=25575, password="test"):
        self.s = socket.create_connection((host, port))
        self._id = 0
        self._send(3, password)
        self._recv()

    def _send(self, typ, body):
        self._id += 1
        b = body.encode()
        pkt = struct.pack("<iii", len(b) + 10, self._id, typ) + b + b"\0\0"
        self.s.sendall(pkt)

    def _recv(self):
        hdr = b""
        while len(hdr) < 4:
            hdr += self.s.recv(4 - len(hdr))
        (n,) = struct.unpack("<i", hdr)
        data = b""
        while len(data) < n:
            data += self.s.recv(n - len(data))
        return data[8:-2].decode(errors="replace")

    def cmd(self, c):
        self._send(2, c)
        return self._recv()

    def many(self, cmds):
        """Последовательно (ванильный RCON не принимает склеенные пакеты)."""
        return [self.cmd(c) for c in cmds]
