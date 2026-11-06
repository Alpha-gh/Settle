import { describe, it, expect } from 'vitest';
import { formatUsd, formatDate, formatDateShort, humanizeStatus } from './format';

describe('formatUsd', () => {
  it('formats zero cents', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formats 100 cents as $1.00', () => {
    expect(formatUsd(100)).toBe('$1.00');
  });

  it('formats negative amounts correctly using integer math', () => {
    expect(formatUsd(-150)).toBe('-$1.50');
    expect(formatUsd(-5)).toBe('-$0.05');
    expect(formatUsd(-1)).toBe('-$0.01');
    expect(formatUsd(-100)).toBe('-$1.00');
  });

  it('formats large numbers with commas grouping without float drift', () => {
    expect(formatUsd(123456789)).toBe('$1,234,567.89');
    expect(formatUsd(500000)).toBe('$5,000.00');
    expect(formatUsd(1200000)).toBe('$12,000.00');
  });

  it('handles small fractional dollar amounts', () => {
    expect(formatUsd(99)).toBe('$0.99');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(1)).toBe('$0.01');
  });
});

describe('formatDate and formatDateShort', () => {
  it('formats dates in UTC matching sample "Fri 6 Nov"', () => {
    expect(formatDate('2026-11-06')).toBe('Fri 6 Nov');
  });

  it('formats month boundaries without timezone off-by-one', () => {
    expect(formatDate('2026-10-31')).toBe('Sat 31 Oct');
    expect(formatDate('2026-11-01')).toBe('Sun 1 Nov');
    expect(formatDate('2026-12-31')).toBe('Thu 31 Dec');
    expect(formatDate('2027-01-01')).toBe('Fri 1 Jan');
  });

  it('handles leap years correctly', () => {
    expect(formatDate('2024-02-29')).toBe('Thu 29 Feb');
  });

  it('formats short dates (formatDateShort)', () => {
    expect(formatDateShort('2026-11-06')).toBe('Nov 6');
    expect(formatDateShort('2026-10-31')).toBe('Oct 31');
  });
});

describe('humanizeStatus', () => {
  it('humanizes invoice and action statuses verbatim per Rule 4', () => {
    expect(humanizeStatus('AWAITING_APPROVAL')).toBe('Awaiting Approval');
    expect(humanizeStatus('PARTIALLY_PAID')).toBe('Partially Paid');
    expect(humanizeStatus('PROPOSED')).toBe('Proposed');
    expect(humanizeStatus('APPROVED')).toBe('Approved');
    expect(humanizeStatus('EXECUTED')).toBe('Executed');
    expect(humanizeStatus('REJECTED')).toBe('Rejected');
    expect(humanizeStatus('BLOCKED')).toBe('Blocked');
    expect(humanizeStatus('FAILED')).toBe('Failed');
    expect(humanizeStatus('SENT')).toBe('Sent');
    expect(humanizeStatus('PAID')).toBe('Paid');
  });
});

