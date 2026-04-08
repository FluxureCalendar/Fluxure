import { PRIORITY_BY_LABEL, COLOR_BY_NAME, COLOR_NAMES, STATUS_FILTER_MAP } from '@fluxure/shared';

// ─── Types ───────────────────────────────────────────────────

export interface ParsedFilters {
  type: string | null; // ItemType value or null
  priority: number | null; // Priority numeric value
  color: string | null; // hex color
  status: { field: 'status' | 'enabled'; value: string[] | boolean } | null;
  dateRange: [Date, Date] | null; // [start, end] inclusive
  timeMinutes: number | null; // minutes since midnight
  scope: 'settings' | 'nav' | null;
  freeText: string; // remaining text after filters extracted
}

// ─── Multi-word date expressions ─────────────────────────────

const MULTI_WORD_DATES: Record<string, string[]> = {
  this: ['week', 'month'],
  next: ['week', 'month'],
  last: ['week'],
};

// Valid type: filter values (Focus excluded — singleton config)
const VALID_TYPES = new Set(['habit', 'task', 'meeting', 'event']);

// ─── Tokenizer ───────────────────────────────────────────────

export function parseQuery(input: string): ParsedFilters {
  const filters: ParsedFilters = {
    type: null,
    priority: null,
    color: null,
    status: null,
    dateRange: null,
    timeMinutes: null,
    scope: null,
    freeText: '',
  };

  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const freeTextParts: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    const colonIdx = token.indexOf(':');

    if (colonIdx > 0) {
      const prefix = token.slice(0, colonIdx).toLowerCase();
      let value = token.slice(colonIdx + 1).toLowerCase();

      // Handle hyphenated multi-word: date:this-week → this week
      value = value.replace(/-/g, ' ').trim();

      // Lookahead for multi-word date values
      if (prefix === 'date' && MULTI_WORD_DATES[value]) {
        const nextToken = tokens[i + 1]?.toLowerCase();
        if (nextToken && MULTI_WORD_DATES[value].includes(nextToken)) {
          value = `${value} ${nextToken}`;
          i++; // consume next token
        }
      }

      switch (prefix) {
        case 'type':
          if (VALID_TYPES.has(value)) filters.type = value;
          break;
        case 'priority': {
          const num = PRIORITY_BY_LABEL[value] ?? (value.match(/^[1-4]$/) ? Number(value) : null);
          if (num !== null) filters.priority = num;
          break;
        }
        case 'color': {
          if (value.startsWith('#')) {
            filters.color = value;
          } else {
            const hex = COLOR_BY_NAME[value];
            if (hex) filters.color = hex;
          }
          break;
        }
        case 'status': {
          const mapping = STATUS_FILTER_MAP[value];
          if (mapping) filters.status = mapping;
          break;
        }
        case 'date':
          filters.dateRange = parseDateExpression(value);
          break;
        case 'time':
          filters.timeMinutes = parseTimeExpression(value);
          break;
        case 'in':
          if (value === 'settings' || value === 'nav') filters.scope = value;
          break;
        default:
          freeTextParts.push(token);
      }
    } else {
      freeTextParts.push(token);
    }
    i++;
  }

  filters.freeText = freeTextParts.join(' ').trim();
  return filters;
}

// ─── Active prefix detection (for guidance UI) ──────────────

export interface ActivePrefix {
  prefix: string;
  partial: string; // what the user typed after the colon
}

/** Detect if the user is actively typing a filter prefix (for showing completions) */
export function getActivePrefix(input: string): ActivePrefix | null {
  const tokens = input.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (!last) return null;

  // Lone colon → show all filters
  if (last === ':') return { prefix: ':', partial: '' };

  const colonIdx = last.indexOf(':');
  if (colonIdx > 0) {
    const prefix = last.slice(0, colonIdx).toLowerCase();
    const partial = last.slice(colonIdx + 1).toLowerCase();
    const known = ['type', 'priority', 'color', 'status', 'date', 'time', 'in'];
    if (known.includes(prefix)) {
      return { prefix, partial };
    }
  }
  return null;
}

// ─── Date Parser ─────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function parseDateExpression(value: string): [Date, Date] | null {
  const now = new Date();
  const today = startOfDay(now);

  // Named expressions
  switch (value) {
    case 'today':
      return [today, endOfDay(now)];
    case 'tomorrow': {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return [d, endOfDay(d)];
    }
    case 'yesterday': {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return [d, endOfDay(d)];
    }
    case 'this week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(today);
      monday.setDate(monday.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return [monday, endOfDay(sunday)];
    }
    case 'next week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? 1 : 8 - day;
      const monday = new Date(today);
      monday.setDate(monday.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return [monday, endOfDay(sunday)];
    }
    case 'last week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -13 : -6 - day;
      const monday = new Date(today);
      monday.setDate(monday.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return [monday, endOfDay(sunday)];
    }
    case 'this month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return [first, endOfDay(last)];
    }
    case 'next month': {
      const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return [first, endOfDay(last)];
    }
  }

  // ISO: 2026-03-25
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const d = new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
    return [startOfDay(d), endOfDay(d)];
  }

  // Named month: "mar 25", "25 mar", "march 25"
  const namedMonthMatch =
    value.match(/^([a-z]+)\s+(\d{1,2})$/) || value.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (namedMonthMatch) {
    const [, a, b] = namedMonthMatch;
    const monthStr = a.match(/^[a-z]/) ? a : b;
    const dayStr = a.match(/^\d/) ? a : b;
    const month = MONTH_NAMES[monthStr];
    if (month !== undefined) {
      const d = new Date(now.getFullYear(), month, +dayStr);
      return [startOfDay(d), endOfDay(d)];
    }
  }

  // Numeric formats: dd/mm, mm/dd, dd-mm, dd.mm (2-part)
  const twoPartMatch = value.match(/^(\d{1,2})[/\-.](\d{1,2})$/);
  if (twoPartMatch) {
    const [, a, b] = twoPartMatch;
    const year = now.getFullYear();
    // Both interpretations: a/b as dd/mm and mm/dd
    const dates: Date[] = [];
    const dmDate = new Date(year, +b - 1, +a);
    if (dmDate.getMonth() === +b - 1 && dmDate.getDate() === +a) dates.push(dmDate);
    const mdDate = new Date(year, +a - 1, +b);
    if (+a !== +b && mdDate.getMonth() === +a - 1 && mdDate.getDate() === +b) dates.push(mdDate);

    if (dates.length === 1) return [startOfDay(dates[0]), endOfDay(dates[0])];
    if (dates.length === 2) {
      // Ambiguous: return the wider range covering both
      const sorted = dates.sort((x, y) => x.getTime() - y.getTime());
      return [startOfDay(sorted[0]), endOfDay(sorted[sorted.length - 1])];
    }
  }

  // Numeric formats with year: dd/mm/yyyy, mm/dd/yyyy
  const threePartMatch = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (threePartMatch) {
    const [, a, b, c] = threePartMatch;
    let year = +c;
    if (year < 100) year += 2000;
    const dates: Date[] = [];
    const dmDate = new Date(year, +b - 1, +a);
    if (dmDate.getMonth() === +b - 1) dates.push(dmDate);
    const mdDate = new Date(year, +a - 1, +b);
    if (+a !== +b && mdDate.getMonth() === +a - 1) dates.push(mdDate);

    if (dates.length >= 1) {
      const sorted = dates.sort((x, y) => x.getTime() - y.getTime());
      return [startOfDay(sorted[0]), endOfDay(sorted[sorted.length - 1])];
    }
  }

  return null;
}

// ─── Time Parser ─────────────────────────────────────────────

export function parseTimeExpression(value: string): number | null {
  // 12-hour: 9am, 2:30pm, 11:00am
  const match12 = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (match12) {
    let hours = +match12[1];
    const minutes = match12[2] ? +match12[2] : 0;
    const period = match12[3].toLowerCase();
    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 24-hour: 14:00, 09:00, 9:00
  const match24 = value.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = +match24[1];
    const minutes = +match24[2];
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  return null;
}

// ─── Validation helpers (for guidance UI) ────────────────────

export function getValidationError(prefix: string, value: string): string | null {
  if (!value) return null;
  switch (prefix) {
    case 'type':
      if (!VALID_TYPES.has(value)) return `Unknown type — try ${[...VALID_TYPES].join(', ')}`;
      break;
    case 'priority':
      if (!PRIORITY_BY_LABEL[value] && !value.match(/^[1-4]$/)) {
        return 'Unknown priority — try low, medium, high, critical';
      }
      break;
    case 'color':
      if (!value.startsWith('#') && !COLOR_BY_NAME[value]) {
        return `Unknown color — try ${Object.values(COLOR_NAMES)
          .map((n) => n.toLowerCase())
          .join(', ')}`;
      }
      break;
    case 'status':
      if (!STATUS_FILTER_MAP[value]) return 'Unknown status — try open, done, enabled, disabled';
      break;
    case 'date':
      if (!parseDateExpression(value))
        return 'Unknown date — try today, tomorrow, this-week, or a date like 25/03';
      break;
    case 'time':
      if (parseTimeExpression(value) === null) return 'Unknown time — try 9am, 2:30pm, or 14:00';
      break;
    case 'in':
      if (value !== 'settings' && value !== 'nav') return 'Unknown scope — try settings or nav';
      break;
  }
  return null;
}
