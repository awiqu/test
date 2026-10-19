import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'fflate';
import { writeFileSync } from 'node:fs';
import { exampleCircuit } from '../src/model/circuit';
import { compile, defaultSettings } from '../src/compiler/compile';
import { buildLitematic, packBlockStates } from '../src/export/litematic';
import { readNbt } from '../src/export/nbt';

describe('litematic export', () => {
  it('packs block states like Litematica', () => {
    // 3 бита на запись: 21 запись в первом long + кусок во втором
    const idx = new Uint16Array(30);
    for (let i = 0; i < 30; i++) idx[i] = (i % 7) + 1;
    const packed = packBlockStates(idx, 3);
    expect(packed.length).toBe(Math.ceil(90 / 64));
    // обратная распаковка
    const bits = 3;
    for (let i = 0; i < 30; i++) {
      const start = i * bits;
      const a = start >> 6;
      const o = BigInt(start & 63);
      let v = BigInt.asUintN(64, packed[a]) >> o;
      if (Number(o) + bits > 64) v |= BigInt.asUintN(64, packed[a + 1]) << (64n - o);
      expect(Number(v & 7n)).toBe(idx[i]);
    }
  });

  it('writes a valid file for the example circuit', () => {
    const res = compile(exampleCircuit(), defaultSettings());
    expect(res.ok).toBe(true);
    const s = defaultSettings();
    const bytes = buildLitematic(res.structure!, { name: 'RedLogic example', author: 'RedLogic', description: 'x,y,z → w0,w1', dataVersion: s.dataVersion, now: 1700000000000 });
    writeFileSync('/home/user/test/docs/examples/example.litematic', bytes);
    const root = readNbt(gunzipSync(bytes));
    expect((root.Version as { v: number }).v).toBe(6);
    expect((root.MinecraftDataVersion as { v: number }).v).toBe(4903);
    // дамп для независимой проверки через litemapy
    writeFileSync(
      '/tmp/example.blocks.json',
      JSON.stringify({
        size: [res.structure!.sx, res.structure!.sy, res.structure!.sz],
        blocks: res.structure!.blocks.map((b) => [b.x, b.y, b.z, b.spec.name, b.spec.props ?? {}]),
      }),
    );
  });
});

describe('safeFileName', () => {
  it('transliterates Cyrillic so browsers keep the download name', async () => {
    const { safeFileName } = await import('../src/export/litematic');
    expect(safeFileName('Мини-4 Счётчик')).toBe('Mini-4_Schetchik');
    expect(safeFileName('Моя схема')).toBe('Moya_shema');
    expect(safeFileName('  a/b:c  ')).toBe('a_b_c');
    expect(safeFileName('')).toBe('redlogic');
    expect(safeFileName('???')).toBe('redlogic');
  });
});
