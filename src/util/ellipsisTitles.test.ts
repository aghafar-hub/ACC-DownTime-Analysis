import { describe, expect, it } from 'vitest';
import { fullText, isTruncated } from './ellipsisTitles';

const box = (sw: number, cw: number, sh = 20, ch = 20) => ({ scrollWidth: sw, clientWidth: cw, scrollHeight: sh, clientHeight: ch });

describe('tooltip for text cut off with an ellipsis', () => {
  it('a one-line ellipsis counts only when the text is wider than its box', () => {
    expect(isTruncated(box(240, 120), { textOverflow: 'ellipsis', webkitLineClamp: 'none' })).toBe(true);
    expect(isTruncated(box(120, 120), { textOverflow: 'ellipsis', webkitLineClamp: 'none' })).toBe(false);
    expect(isTruncated(box(121, 120), { textOverflow: 'ellipsis', webkitLineClamp: 'none' })).toBe(false); // rounding
    expect(isTruncated(box(240, 120), { textOverflow: 'clip', webkitLineClamp: 'none' })).toBe(false);
  });
  it('a line clamp counts when the text is taller than its box', () => {
    expect(isTruncated(box(100, 100, 80, 40), { textOverflow: 'clip', webkitLineClamp: '2' })).toBe(true);
    expect(isTruncated(box(100, 100, 40, 40), { textOverflow: 'clip', webkitLineClamp: '2' })).toBe(false);
  });
  it('the full text is the visible text on one line', () => {
    expect(fullText('  Kiln 1\n   main   drive ')).toBe('Kiln 1 main drive');
    expect(fullText(null)).toBe('');
  });
});
