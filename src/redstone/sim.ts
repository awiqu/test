import { Grid, K, DX, DZ, isConductor, opp } from '../compiler/voxel';
import { dustShape } from './rules';

/**
 * Упрощённый симулятор редстоуна (установившееся состояние) для проверки сгенерированных схем.
 * Повторяет правила Java Edition: пыль, факелы, повторители, рычаги, лампы;
 * задержки не моделируются — считается итоговое состояние.
 */
export class RedstoneSim {
  readonly g: Grid;
  /** Мощность пыли 0..15. */
  power: Uint8Array;
  /** Факел горит / повторитель включён / лампа горит / рычаг включён. */
  lit: Uint8Array;
  shape: Uint8Array; // по 4 значения на клетку пыли
  private dust: number[] = [];
  private torches: number[] = [];
  private repeaters: number[] = [];
  private lamps: number[] = [];
  levers: number[] = [];

  constructor(g: Grid) {
    this.g = g;
    const n = g.W * g.H * g.D;
    this.power = new Uint8Array(n);
    this.lit = new Uint8Array(n);
    this.shape = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const k = g.kind[i] as K;
      if (k === K.Dust) {
        this.dust.push(i);
        const sh = dustShape(g, g.x(i), g.y(i), g.z(i));
        for (let d = 0; d < 4; d++) this.shape[i * 4 + d] = sh[d];
      } else if (k === K.Torch) {
        this.torches.push(i);
        this.lit[i] = 1;
      } else if (k === K.Repeater) this.repeaters.push(i);
      else if (k === K.Lamp) this.lamps.push(i);
      else if (k === K.Lever || k === K.Button) this.levers.push(i);
    }
  }

  setLever(i: number, on: boolean): void {
    this.lit[i] = on ? 1 : 0;
  }

  /** Горизонтальное направление d: пыль n соединена в эту сторону? */
  private connected(i: number, d: number): boolean {
    return this.shape[i * 4 + d] !== 0;
  }

  /**
   * Сигнал, который источник `m` отдаёт в сторону соседа q-направления (q — направление от соседа к источнику).
   * Для не-проводников (факел, рычаг, повторитель, пыль).
   * `wires` — учитывать ли пыль.
   */
  private emits(mx: number, my: number, mz: number, q: number, wires: boolean): boolean {
    const g = this.g;
    if (!g.inb(mx, my, mz)) return false;
    const m = g.idx(mx, my, mz);
    switch (g.kind[m] as K) {
      case K.Torch:
        // настенный факел: питает всех, кроме блока, к которому прикреплён
        return this.lit[m] === 1 && g.dir[m] !== q;
      case K.Lever:
      case K.Button:
        return this.lit[m] === 1;
      case K.Repeater:
        return this.lit[m] === 1 && g.dir[m] === q;
      case K.Dust: {
        if (!wires || this.power[m] === 0) return false;
        // q — направление от потребителя к пыли; q = 4 (UP) / 5 (DOWN)
        if (q === 4) return true; // пыль над потребителем питает блок под собой
        if (q === 5) return false;
        return this.connected(m, opp(q));
      }
      default:
        return false;
    }
  }

  /** Направление от (x,y,z) к соседу k=0..5: 0-3 горизонталь, 4 вверх, 5 вниз. */
  private nb(x: number, y: number, z: number, k: number): [number, number, number] {
    if (k < 4) return [x + DX[k], y, z + DZ[k]];
    return k === 4 ? [x, y + 1, z] : [x, y - 1, z];
  }

  /** Сильное питание проводящего блока X (без учёта пыли, если wires=false). */
  private strongInto(x: number, y: number, z: number, wires: boolean): boolean {
    const g = this.g;
    for (let k = 0; k < 6; k++) {
      const [nx, ny, nz] = this.nb(x, y, z, k);
      if (!g.inb(nx, ny, nz)) continue;
      const m = g.idx(nx, ny, nz);
      const kind = g.kind[m] as K;
      // q = направление от X к источнику
      if (kind === K.Torch) {
        if (k === 5 && this.lit[m] === 1) return true; // факел под блоком
      } else if (kind === K.Lever || kind === K.Button) {
        if (k === 4 && this.lit[m] === 1) return true; // напольный рычаг на блоке
      } else if (kind === K.Repeater) {
        if (k < 4 && this.lit[m] === 1 && g.dir[m] === k) return true; // повторитель смотрит в блок
      } else if (kind === K.Dust && wires) {
        if (this.emits(nx, ny, nz, k, true)) return true;
      }
    }
    return false;
  }

  /** Подаёт ли что-то сигнал в клетку (x,y,z) со стороны соседа k (Level.getSignal для соседа). */
  private signalFrom(x: number, y: number, z: number, k: number, wires: boolean): boolean {
    const g = this.g;
    const [nx, ny, nz] = this.nb(x, y, z, k);
    if (!g.inb(nx, ny, nz)) return false;
    const kind = g.kind[g.idx(nx, ny, nz)] as K;
    if (isConductor(kind)) return this.strongInto(nx, ny, nz, wires);
    return this.emits(nx, ny, nz, k, wires);
  }

  private computeDust(): void {
    const g = this.g;
    const base = new Uint8Array(this.dust.length);
    for (let a = 0; a < this.dust.length; a++) {
      const i = this.dust[a];
      const x = g.x(i);
      const y = g.y(i);
      const z = g.z(i);
      let p = 0;
      for (let k = 0; k < 6 && p < 15; k++) if (this.signalFrom(x, y, z, k, false)) p = 15;
      base[a] = p;
      this.power[i] = p;
    }
    // релаксация между проводами
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (let a = 0; a < this.dust.length; a++) {
        const i = this.dust[a];
        if (base[a] === 15) continue;
        const x = g.x(i);
        const y = g.y(i);
        const z = g.z(i);
        let j = 0;
        const aboveCond = isConductor(g.kindAt(x, y + 1, z));
        for (let d = 0; d < 4; d++) {
          const mx = x + DX[d];
          const mz = z + DZ[d];
          const mk = g.kindAt(mx, y, mz);
          if (mk === K.Dust) j = Math.max(j, this.power[g.idx(mx, y, mz)]);
          if (isConductor(mk) && !aboveCond) {
            if (g.kindAt(mx, y + 1, mz) === K.Dust) j = Math.max(j, this.power[g.idx(mx, y + 1, mz)]);
          } else if (!isConductor(mk)) {
            if (g.kindAt(mx, y - 1, mz) === K.Dust) j = Math.max(j, this.power[g.idx(mx, y - 1, mz)]);
          }
        }
        const v = Math.max(base[a], j - 1);
        if (v > this.power[i]) {
          this.power[i] = v;
          changed = true;
        }
      }
    }
  }

  /** Питается ли проводящий блок X (для факела/повторителя/лампы): прямой сигнал включая пыль. */
  private blockPowered(x: number, y: number, z: number): boolean {
    return this.strongInto(x, y, z, true);
  }

  /** Один шаг пересчёта. Возвращает true, если что-то изменилось. */
  private step(): boolean {
    const g = this.g;
    this.computeDust();
    let changed = false;
    for (const i of this.torches) {
      const x = g.x(i);
      const y = g.y(i);
      const z = g.z(i);
      const f = g.dir[i];
      const ax = x + DX[opp(f)];
      const az = z + DZ[opp(f)];
      const powered = this.blockPowered(ax, y, az);
      const v = powered ? 0 : 1;
      if (this.lit[i] !== v) {
        this.lit[i] = v;
        changed = true;
      }
    }
    for (const i of this.repeaters) {
      const x = g.x(i);
      const y = g.y(i);
      const z = g.z(i);
      const f = g.dir[i]; // сторона входа
      const bx = x + DX[f];
      const bz = z + DZ[f];
      let input = false;
      const bk = g.kindAt(bx, y, bz);
      if (bk === K.Dust) input = this.power[g.idx(bx, y, bz)] > 0;
      else if (isConductor(bk)) input = this.blockPowered(bx, y, bz);
      else input = this.emits(bx, y, bz, f, true);
      const v = input ? 1 : 0;
      if (this.lit[i] !== v) {
        this.lit[i] = v;
        changed = true;
      }
    }
    for (const i of this.lamps) {
      const x = g.x(i);
      const y = g.y(i);
      const z = g.z(i);
      let on = false;
      for (let k = 0; k < 6 && !on; k++) on = this.signalFrom(x, y, z, k, true);
      const v = on ? 1 : 0;
      if (this.lit[i] !== v) {
        this.lit[i] = v;
        changed = true;
      }
    }
    return changed;
  }

  /** Доводит схему до установившегося состояния. Возвращает false, если колеблется. */
  settle(maxIter = 400): boolean {
    for (let it = 0; it < maxIter; it++) {
      if (!this.step()) return true;
    }
    return false;
  }
}
