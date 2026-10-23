import { Hono } from "hono";
import { StatusCodes } from "http-status-codes";
import { extractStopUpdates } from "./gtfs_rt.js";
import { DATA } from "./gtfs_schedule.js";
import { localNow, minutesToDate, upcomingArrivals } from "./schedule.js";
import { GTFSRT_URL } from "./config.js";

const app = new Hono();
const tFmt = new Intl.DateTimeFormat([], {
  timeZone: "America/Denver",
  hour12: true,
  timeStyle: "short",
});
const DEFAULT_CARS: string[] = [];

app.get("/", async (c) => {
  const {
    stop_display_name,
    route_display_name,
    stop_id,
    route_id,
  } = c.req.query();

  // Ensure we have both stop + route defined
  if (!stop_id || !route_id) {
    return c.text(
      `${StatusCodes.BAD_REQUEST}: route_id and stop_id both required at this moment`,
      StatusCodes.BAD_REQUEST
    );
  }

  interface Train {
    cars: string[];
    scheduledTime: Date;
    actualTime: Date;
    isLate: boolean;
  }

  // Names come from the baked schedule unless the caller overrides them.
  const stopName = stop_display_name ?? DATA.stops[stop_id] ?? "Stop";
  const routeName = route_display_name ?? DATA.routes[route_id] ?? "Route";

  // Scheduled departures come from the baked GTFS schedule.
  const now = new Date(Date.now());
  const local = localNow(now);
  const scheduled = upcomingArrivals(route_id, stop_id, 10, local);

  const trains: Train[] = scheduled.map((minutes) => {
    const scheduledTime = minutesToDate(minutes, local);
    return {
      cars: DEFAULT_CARS,
      scheduledTime,
      actualTime: scheduledTime,
      isLate: false,
    };
  });

  // Fetch real time status data
  const resp = await fetch(GTFSRT_URL, { method: "GET", redirect: "follow" });
  const body = new Uint8Array(await resp.arrayBuffer());
  const stopUpdates = extractStopUpdates(body, route_id, stop_id);

  // Match each live arrival to the nearest scheduled slot ahead of it.
  for (const update of stopUpdates) {
    const arrivalTime = new Date(update.arrivalSeconds * 1000);
    for (const train of trains) {
      const tDeltaMin =
        (arrivalTime.getTime() - train.scheduledTime.getTime()) / 1000 / 60;
      if (tDeltaMin > 0 && tDeltaMin < 15) {
        train.cars = update.cars;
        train.actualTime = arrivalTime;
        train.isLate = true;
      }
    }
  }

  const trainJson = trains.map((v) => ({
    cars: v.cars,
    scheduledTime: tFmt.format(v.scheduledTime),
    actualTime: tFmt.format(v.actualTime),
    minutesToArrival: Math.round(
      ((v.actualTime.getTime() - now.getTime()) / 60000) * 10
    ) / 10,
    isLate: v.isLate,
  }));

  // RTD republishes every 30s, so a 20s cache can never serve data older
  // than a single feed tick.
  return c.json(
    {
      stopDisplayName: stopName,
      routeDisplayName: routeName,
      trains: trainJson,
    },
    200,
    { "Cache-Control": "public, max-age=20" }
  );
});

export default app;
