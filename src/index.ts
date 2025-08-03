import { Hono } from "hono";
import { StatusCodes } from "http-status-codes";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
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
    stop_display_name = "Stop",
    route_display_name = "Route",
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

  // Formulate Scheduled stops
  // TODO: This is hard coded for my stop right now
  const stopMinutes = [8, 23, 38, 53];
  const now = new Date(Date.now());

  let trains: Train[] = Array.prototype
    .concat(
      stopMinutes.filter((v) => v > now.getMinutes()),
      stopMinutes.map((v) => v + 1 * 60),
      stopMinutes.map((v) => v + 2 * 60),
      stopMinutes.map((v) => v + 3 * 60)
    )
    .slice(0, 10)
    .map((v) => {
      let hourZero = new Date(now);
      hourZero.setMinutes(0, 0, 0);
      const arrivalTime = new Date(hourZero.getTime() + v * 60 * 1000);
      const arrivalDeltaMinutes =
        arrivalTime.getTime() - now.getTime() / 1000 / 60;
      return {
        cars: DEFAULT_CARS,
        scheduledTime: arrivalTime,
        actualTime: arrivalTime,
        isLate: false,
      };
    });

  // Fetch real time status data
  const resp = await fetch(GTFSRT_URL, { method: "GET", redirect: "follow" });
  const body = await resp.arrayBuffer();
  const update = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(body)
  );

  // Find updates on route
  const routeEnts = update.entity.filter(
    (v) => v.tripUpdate?.trip.routeId == route_id
  );

  // Find stopTimeUpdates that are applicable to our stop
  for (let ent of routeEnts) {
    for (let stopTimeUpdate of ent.tripUpdate?.stopTimeUpdate ?? []) {
      if (stopTimeUpdate.stopId == stop_id) {
        const uTime = (stopTimeUpdate.arrival?.time ?? 0) as number;
        const arrivalTime = new Date(uTime * 1000);
        const cars = ent.tripUpdate?.vehicle?.label?.split(",") ?? DEFAULT_CARS;

        for (let train of trains) {
          const tDeltaMin =
            (arrivalTime.getTime() - train.scheduledTime.getTime()) / 1000 / 60;
          if (tDeltaMin > 0 && tDeltaMin < 15) {
            train.cars = cars;
            train.actualTime = arrivalTime;
            train.isLate = true;
          }
        }
      }
    }
  }

  const trainJson = trains.map((v) => ({
    cars: v.cars,
    scheduledTime: tFmt.format(v.scheduledTime),
    actualTime: tFmt.format(v.actualTime),
    minutesToArrival: (v.actualTime.getTime() - now.getTime()) / 1000 / 60,
    isLate: v.isLate,
  }));

  return c.json({
    stopDisplayName: stop_display_name,
    routeDisplayName: route_display_name,
    trains: trainJson,
  });
});

export default app;
