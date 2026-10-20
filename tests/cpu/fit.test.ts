import { describe, it, expect } from 'vitest';
import { boardFit } from '../../src/cpu/fit';

describe('board fit to render and simulation distance', () => {
  it('small board fits the default simulation distance', () => {
    const f = boardFit({ x: 213, z: 275 });
    expect(f.level).toBe('ok');
    expect(f.chunks).toBe(9);
  });

  it('a board needing more than the default simulation distance warns', () => {
    const f = boardFit({ x: 347, z: 380 });
    expect(f.level).toBe('warn');
    expect(f.chunks).toBe(12);
    expect(boardFit({ x: 407, z: 416 })).toMatchObject({ level: 'bad', chunks: 13 });
  });

  it('thresholds: 320 blocks is 10 chunks from the center, 321 needs 11', () => {
    expect(boardFit({ x: 320, z: 10 })).toMatchObject({ chunks: 10, level: 'ok' });
    expect(boardFit({ x: 10, z: 321 })).toMatchObject({ chunks: 11, level: 'warn' });
    expect(boardFit({ x: 384, z: 10 })).toMatchObject({ chunks: 12, level: 'warn' });
    expect(boardFit({ x: 385, z: 10 })).toMatchObject({ chunks: 13, level: 'bad' });
  });
});
