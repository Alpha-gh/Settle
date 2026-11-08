import type { Id } from '@settle/shared';

export interface IdGen {
  next(prefix?: string): Id;
}

export class DeterministicIdGen implements IdGen {
  private counter = 0;
  private readonly defaultPrefix: string;

  constructor(defaultPrefix = 'id') {
    this.defaultPrefix = defaultPrefix;
  }

  next(prefix?: string): Id {
    this.counter += 1;
    const p = prefix ?? this.defaultPrefix;
    return `${p}_${this.counter}`;
  }

  reset(start = 0): void {
    this.counter = start;
  }
}

