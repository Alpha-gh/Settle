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

