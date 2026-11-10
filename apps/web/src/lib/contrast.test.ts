import { describe, it, expect } from 'vitest';

/**
 * Calculates relative luminance per WCAG 2.1 specs.
 */
function getLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates WCAG contrast ratio between two hex colors.
 */
function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Design Token WCAG AA Contrast Verification', () => {
  const TOKENS = {
    ink: '#0F172A',
    muted: '#475569',
    canvas: '#F8FAFC',
    surface: '#FFFFFF',
    accent: '#1D4ED8',
    green: '#166534',
    greenBg: '#F0FDF4',
    amber: '#92400E',
    amberBg: '#FFFBEB',
    red: '#B91C1C',
    redBg: '#FEF2F2',
  };

  const PAIRS: [string, string, string][] = [
    ['Ink text on Surface background', TOKENS.ink, TOKENS.surface],
    ['Ink text on Canvas background', TOKENS.ink, TOKENS.canvas],
    ['Muted text on Surface background', TOKENS.muted, TOKENS.surface],
    ['Muted text on Canvas background', TOKENS.muted, TOKENS.canvas],
    ['Primary Accent on Surface background', TOKENS.accent, TOKENS.surface],
    ['White text on Primary Accent button', TOKENS.surface, TOKENS.accent],
    ['Green text on Green badge background', TOKENS.green, TOKENS.greenBg],
    ['Amber text on Amber badge background', TOKENS.amber, TOKENS.amberBg],
    ['Red text on Red badge background', TOKENS.red, TOKENS.redBg],
  ];

  PAIRS.forEach(([description, foreground, background]) => {
    it(`verifies >= 4.5:1 contrast for ${description} (${foreground} on ${background})`, () => {
      const ratio = getContrastRatio(foreground, background);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });
});

