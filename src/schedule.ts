import { DATA } from "./gtfs_schedule.js";

/**
 * Scheduled departures for a (route, stop) pair, resolved against the service
 * calendar baked into `gtfs_schedule.ts`.
 */

export interface ScheduledArrival {
  /** Minutes since local midnight. */
  minutes: number;
}

export interface ServiceDate {
  weekday: string;
  year: number;
  month: number;
  day: number;
  minutesOfDay: number;
  /** Milliseconds the local wall clock is ahead of UTC at this instant. */
  offsetMs: number;
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  hour12: false,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Current wall-clock time in Denver, derived without a timezone library. */
export function localNow(now: Date): ServiceDate {
  const parts = dateFmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl renders midnight as 24 in some locales; normalise it to 0.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  // The same parts, reinterpreted as UTC, give the local wall clock; the gap
  // to the real instant is the timezone offset. Deriving it here avoids a
  // second formatToParts call per request.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  return {
    weekday: get("weekday"),
    year,
    month,
    day,
    minutesOfDay: hour * 60 + minute,
    offsetMs: asUtc - Math.floor(now.getTime() / 60000) * 60000,
  };
}

/**
 * Services running today. The baked calendar carries the day-of-week columns
 * from `calendar.txt` as [sun, mon, tue, wed, thu, fri, sat].
 */
function servicesForToday(local: ServiceDate): string[] {
  const index = WEEKDAY_NAMES.indexOf(local.weekday);
  if (index < 0) return [];
  return DATA.services.filter(
    (service) => DATA.serviceDays[service]?.[index] === 1
  );
}

/**
 * Returns the next `limit` scheduled arrivals at `stopId` on `routeId`,
 * as minutes since local midnight (may exceed 1440 for after-midnight trips).
 */
export function upcomingArrivals(
  routeId: string,
  stopId: string,
  limit: number,
  local: ServiceDate
): number[] {
  const schedule = DATA.schedules[`${routeId}|${stopId}`];
  if (!schedule) return [];

  const services = servicesForToday(local);
  if (services.length === 0) return [];

  const seen = new Set<number>();
  for (const service of services) {
    for (const minutes of schedule[service] ?? []) seen.add(minutes);
  }

  const sorted = [...seen].sort((a, b) => a - b);
  const today = sorted.filter((m) => m >= local.minutesOfDay);
  const tomorrow = sorted.map((m) => m + 1440);

  return [...today, ...tomorrow].slice(0, limit);
}

/**
 * Converts minutes-since-midnight back to a real Date.
 *
 * `Date.UTC` gives us the *wall clock* as if it were UTC; the true instant is
 * that value minus Denver's offset at that moment, so the result renders back
 * to the same local time.
 */
export function minutesToDate(
  minutes: number,
  local: ServiceDate
): Date {
  const wallClock = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    0,
    minutes,
    0,
    0
  );
  return new Date(wallClock - local.offsetMs);
}
