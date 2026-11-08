import type { ISODate } from '@settle/shared';

export interface Clock {
  now(): Date;
  todayISO(): ISODate;
}

function formatDateToIso(date: Date): ISODate {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  todayISO(): ISODate {
    return formatDateToIso(this.now());
  }
}

export class FixedClock implements Clock {
  private readonly fixedDate: Date;

  constructor(timestampOrIso: string | Date | number) {
    this.fixedDate = new Date(timestampOrIso);
  }

  now(): Date {
    return new Date(this.fixedDate.getTime());
  }

  todayISO(): ISODate {
    return formatDateToIso(this.fixedDate);
  }
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function addDays(dateIso: ISODate, days: number): ISODate {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateToIso(d);
}

export function getWeekdayName(dateIso: ISODate): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()] ?? 'Unknown';
}

export function generateCalendarTable(asOfIso: ISODate, daysCount = 14): string {
  const rows: string[] = [
    '| Date | Day of Week |',
    '| --- | --- |',
  ];
  for (let i = 0; i < daysCount; i++) {
    const dIso = addDays(asOfIso, i);
    const dayName = getWeekdayName(dIso);
    rows.push(`| ${dIso} | ${dayName} |`);
  }
  return rows.join('\n');
}

export function findNextWeekdayIso(asOfIso: ISODate, weekdayName: string): ISODate | null {
  const target = weekdayName.trim().toLowerCase();
  for (let i = 0; i < 14; i++) {
    const dIso = addDays(asOfIso, i);
    const dayName = getWeekdayName(dIso).toLowerCase();
    if (dayName === target) {
      return dIso;
    }
  }
  return null;
}


