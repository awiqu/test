import { gzipSync } from 'fflate';
import { BlockSpec, ExportSettings, Structure } from '../compiler/compile';
import { Tag, nbt, writeNbt } from './nbt';

export const LITEMATIC_VERSION = 6;
export const LITEMATIC_SUBVERSION = 1;

function specKey(s: BlockSpec): string {
  if (!s.props) return s.name;
  return `${s.name}[${Object.keys(s.props)
    .sort()
    .map((k) => `${k}=${s.props![k]}`)
    .join(',')}]`;
}

/** Упаковка индексов палитры в long-массив Litematica (биты идут подряд, без выравнивания). */
export function packBlockStates(indices: Uint16Array, bits: number): BigInt64Array {
  const longs = Math.ceil((indices.length * bits) / 64);
  const words = new Uint32Array(longs * 2 + 2);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v === 0) continue;
    const start = i * bits;
    const w = start >>> 5;
    const o = start & 31;
    words[w] |= (v << o) >>> 0;
    if (o + bits > 32) words[w + 1] |= v >>> (32 - o);
  }
  const out = new BigInt64Array(longs);
  for (let k = 0; k < longs; k++) {
    out[k] = BigInt.asIntN(64, (BigInt(words[2 * k + 1]) << 32n) | BigInt(words[2 * k]));
  }
  return out;
}

export interface LitematicOptions {
  name: string;
  author: string;
  description: string;
  dataVersion: number;
  regionName?: string;
  now?: number;
}

/** Собирает .litematic (gzip NBT) из воксельной структуры. */
export function buildLitematic(structure: Structure, opts: LitematicOptions): Uint8Array {
  const { sx, sy, sz } = structure;
  const volume = sx * sy * sz;
  const palette: BlockSpec[] = [{ name: 'minecraft:air' }];
  const lookup = new Map<string, number>([[specKey(palette[0]), 0]]);
  const indices = new Uint16Array(volume);
  for (const b of structure.blocks) {
    const key = specKey(b.spec);
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = palette.length;
      palette.push(b.spec);
      lookup.set(key, idx);
    }
    indices[(b.y * sz + b.z) * sx + b.x] = idx;
  }
  const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
  const paletteTag = nbt.list(
    'compound',
    palette.map((p) => {
      const c: Record<string, Tag> = { Name: nbt.string(p.name) };
      if (p.props) c.Properties = nbt.compound(Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, nbt.string(v)])));
      return nbt.compound(c);
    }),
  );
  const now = opts.now ?? Date.now();
  const size = (x: number, y: number, z: number): Tag => nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });
  const region = nbt.compound({
    Position: size(0, 0, 0),
    Size: size(sx, sy, sz),
    BlockStatePalette: paletteTag,
    Entities: nbt.list('end', []),
    TileEntities: nbt.list(
      'compound',
      (structure.tileEntities ?? []).map((t) => {
        const c: Record<string, Tag> = { x: nbt.int(t.x), y: nbt.int(t.y), z: nbt.int(t.z), id: nbt.string(t.id) };
        if (t.items)
          c.Items = nbt.list(
            'compound',
            t.items.map((it) => nbt.compound({ Slot: nbt.byte(it.slot), id: nbt.string(it.id), count: nbt.int(it.count) })),
          );
        for (const [k, v] of Object.entries(t.ints ?? {})) c[k] = nbt.int(v);
        return nbt.compound(c);
      }),
    ),
    PendingBlockTicks: nbt.list('end', []),
    PendingFluidTicks: nbt.list('end', []),
    BlockStates: nbt.longArray(packBlockStates(indices, bits)),
  });
  const root = {
    Version: nbt.int(LITEMATIC_VERSION),
    SubVersion: nbt.int(LITEMATIC_SUBVERSION),
    MinecraftDataVersion: nbt.int(opts.dataVersion),
    Metadata: nbt.compound({
      EnclosingSize: size(sx, sy, sz),
      Author: nbt.string(opts.author),
      Description: nbt.string(opts.description),
      Name: nbt.string(opts.name),
      Software: nbt.string('RedLogic'),
      RegionCount: nbt.int(1),
      TimeCreated: nbt.long(now),
      TimeModified: nbt.long(now),
      TotalBlocks: nbt.int(structure.blocks.length),
      TotalVolume: nbt.int(volume),
    }),
    Regions: nbt.compound({ [opts.regionName ?? opts.name]: region }),
  };
  return gzipSync(writeNbt(root), { level: 9 });
}

export function litematicFromSettings(structure: Structure, s: ExportSettings): Uint8Array {
  return buildLitematic(structure, {
    name: s.name || 'RedLogic',
    author: s.author,
    description: s.description,
    dataVersion: s.dataVersion,
  });
}

export function safeFileName(name: string): string {
  return (name || 'redlogic').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 64) || 'redlogic';
}
