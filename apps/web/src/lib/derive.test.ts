import { describe, it, expect } from 'vitest';
import { daysOverdue } from './derive';

describe('daysOverdue', () => {
  it('returns 0 when invoice due date is in the future relative to asOf', () => {
    expect(daysOverdue('2026-11-10', '2026-11-02')).toBe(0);
  });

  it('returns 0 when invoice due date is equal to asOf', () => {
    expect(daysOverdue('2026-11-02', '2026-11-02')).toBe(0);
  });

  it('returns whole days overdue when due date has passed', () => {
    expect(daysOverdue('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysOverdue('2026-10-26', '2026-11-02')).toBe(7);
  });

  it('correctly handles month boundaries without UTC drift', () => {
    // 2026-10-31 to 2026-11-02 is exactly 2 days
    expect(daysOverdue('2026-10-31', '2026-11-02')).toBe(2);
    // 2026-09-30 to 2026-10-02 is 2 days
    expect(daysOverdue('2026-09-30', '2026-10-02')).toBe(2);
  });

  it('correctly handles leap year boundaries', () => {
    // 2024 is leap year: Feb has 29 days
    expect(daysOverdue('2024-02-28', '2024-03-01')).toBe(2);
    // 2023 is not leap year: Feb has 28 days
    expect(daysOverdue('2023-02-28', '2023-03-01')).toBe(1);
  });

  it('correctly handles year boundaries', () => {
    expect(daysOverdue('2025-12-30', '2026-01-02')).toBe(3);
  });

  it('throws on invalid date input', () => {
    expect(() => daysOverdue('invalid', '2026-11-02')).toThrow('Invalid date string');
  });
});

