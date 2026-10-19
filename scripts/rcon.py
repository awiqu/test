"""Минимальный клиент RCON (протокол Source) для проверки схем на настоящем сервере Minecraft."""
import socket
import struct


class Rcon:
    def __init__(self, host='127.0.0.1', port=25575, password='redlogic'):
        self.sock = socket.create_connection((host, port), timeout=60)
        self._id = 0
        self._send(3, password)
        rid, _, _ = self._recv()
        if rid == -1:
            raise RuntimeError('RCON: неверный пароль')

    def _send(self, ptype, payload):
        self._id += 1
        data = struct.pack('<ii', self._id, ptype) + payload.encode('utf8') + b'\x00\x00'
        self.sock.sendall(struct.pack('<i', len(data)) + data)
        return self._id

    def _recv(self):
        raw = b''
        while len(raw) < 4:
            chunk = self.sock.recv(4 - len(raw))
            if not chunk:
                raise RuntimeError('RCON: соединение закрыто')
            raw += chunk
        (length,) = struct.unpack('<i', raw)
        body = b''
        while len(body) < length:
            body += self.sock.recv(length - len(body))
        rid, ptype = struct.unpack('<ii', body[:8])
        return rid, ptype, body[8:-2].decode('utf8', 'replace')

    def cmd(self, command):
        self._send(2, command)
        _, _, text = self._recv()
        return text

    def close(self):
        self.sock.close()
