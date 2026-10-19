/** Минимальный писатель/читатель NBT (big-endian), достаточный для .litematic. */

export type Tag =
  | { t: 'byte'; v: number }
  | { t: 'short'; v: number }
  | { t: 'int'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'string'; v: string }
  | { t: 'list'; of: Tag['t'] | 'end'; v: Tag[] }
  | { t: 'compound'; v: Record<string, Tag> }
  | { t: 'longArray'; v: BigInt64Array }
  | { t: 'intArray'; v: Int32Array };

export const nbt = {
  byte: (v: number): Tag => ({ t: 'byte', v }),
  short: (v: number): Tag => ({ t: 'short', v }),
  int: (v: number): Tag => ({ t: 'int', v }),
  long: (v: bigint | number): Tag => ({ t: 'long', v: BigInt(v) }),
  string: (v: string): Tag => ({ t: 'string', v }),
  list: (of: Tag['t'] | 'end', v: Tag[]): Tag => ({ t: 'list', of, v }),
  compound: (v: Record<string, Tag>): Tag => ({ t: 'compound', v }),
  longArray: (v: BigInt64Array): Tag => ({ t: 'longArray', v }),
  intArray: (v: Int32Array): Tag => ({ t: 'intArray', v }),
};

const ID: Record<Tag['t'] | 'end', number> = {
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
};

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos++, v);
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v);
    this.pos += 2;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v);
    this.pos += 2;
  }
  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v);
    this.pos += 4;
  }
  i64(v: bigint): void {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v);
    this.pos += 8;
  }
  str(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.u16(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  payload(tag: Tag): void {
    switch (tag.t) {
      case 'byte':
        this.u8(tag.v & 0xff);
        break;
      case 'short':
        this.i16(tag.v);
        break;
      case 'int':
        this.i32(tag.v);
        break;
      case 'long':
        this.i64(tag.v);
        break;
      case 'string':
        this.str(tag.v);
        break;
      case 'list':
        this.u8(ID[tag.v.length === 0 && tag.of === 'end' ? 'end' : tag.of]);
        this.i32(tag.v.length);
        for (const x of tag.v) this.payload(x);
        break;
      case 'compound':
        for (const [k, v] of Object.entries(tag.v)) {
          this.u8(ID[v.t]);
          this.str(k);
          this.payload(v);
        }
        this.u8(0);
        break;
      case 'longArray':
        this.i32(tag.v.length);
        for (let i = 0; i < tag.v.length; i++) this.i64(tag.v[i]);
        break;
      case 'intArray':
        this.i32(tag.v.length);
        for (let i = 0; i < tag.v.length; i++) this.i32(tag.v[i]);
        break;
    }
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Сериализует корневой compound (с пустым именем) в несжатый NBT. */
export function writeNbt(root: Record<string, Tag>): Uint8Array {
  const w = new Writer();
  w.u8(ID.compound);
  w.str('');
  w.payload({ t: 'compound', v: root });
  return w.result();
}

/** Читатель — нужен для тестов и проверки собственного вывода. */
export function readNbt(data: Uint8Array): Record<string, Tag> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const dec = new TextDecoder();
  const str = (): string => {
    const n = view.getUint16(pos);
    pos += 2;
    const s = dec.decode(data.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const rev = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k])) as Record<number, Tag['t'] | 'end'>;
  const payload = (id: number): Tag => {
    switch (rev[id]) {
      case 'byte':
        return { t: 'byte', v: view.getInt8(pos++) };
      case 'short': {
        const v = view.getInt16(pos);
        pos += 2;
        return { t: 'short', v };
      }
      case 'int': {
        const v = view.getInt32(pos);
        pos += 4;
        return { t: 'int', v };
      }
      case 'long': {
        const v = view.getBigInt64(pos);
        pos += 8;
        return { t: 'long', v };
      }
      case 'string':
        return { t: 'string', v: str() };
      case 'list': {
        const of = view.getUint8(pos++);
        const n = view.getInt32(pos);
        pos += 4;
        const v: Tag[] = [];
        for (let i = 0; i < n; i++) v.push(payload(of));
        return { t: 'list', of: rev[of], v };
      }
      case 'compound': {
        const v: Record<string, Tag> = {};
        for (;;) {
          const tid = view.getUint8(pos++);
          if (tid === 0) break;
          const name = str();
          v[name] = payload(tid);
        }
        return { t: 'compound', v };
      }
      case 'longArray': {
        const n = view.getInt32(pos);
        pos += 4;
        const arr = new BigInt64Array(n);
        for (let i = 0; i < n; i++) {
          arr[i] = view.getBigInt64(pos);
          pos += 8;
        }
        return { t: 'longArray', v: arr };
      }
      case 'intArray': {
        const n = view.getInt32(pos);
        pos += 4;
        const arr = new Int32Array(n);
        for (let i = 0; i < n; i++) {
          arr[i] = view.getInt32(pos);
          pos += 4;
        }
        return { t: 'intArray', v: arr };
      }
      default:
        throw new Error(`Неизвестный тег NBT ${id}`);
    }
  };
  const rootId = view.getUint8(pos++);
  if (rootId !== ID.compound) throw new Error('Корень NBT должен быть compound');
  str();
  const root = payload(rootId);
  if (root.t !== 'compound') throw new Error('Корень NBT должен быть compound');
  return root.v;
}
