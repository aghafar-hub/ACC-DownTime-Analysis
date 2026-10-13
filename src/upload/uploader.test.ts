import { describe, expect, it } from 'vitest';
import { uploaderName } from './uploader';

describe('upload history: who uploaded', () => {
  const names = new Map([['U-1', 'Demo Engineer']]);
  const name = (id: string) => names.get(id) ?? id; // like useUserNames: the id back when it has no name

  it('says You for your own uploads, the name when the list has it, else Another user (never a raw id)', () => {
    expect(uploaderName('U-ME', 'U-ME', name)).toBe('You');
    expect(uploaderName('U-1', 'U-ME', name)).toBe('Demo Engineer');
    expect(uploaderName('U-2', 'U-ME', name)).toBe('Another user');
    expect(uploaderName('U-2', undefined, name)).toBe('Another user');
    expect(uploaderName('', 'U-ME', name)).toBe('Unknown');
  });
});
