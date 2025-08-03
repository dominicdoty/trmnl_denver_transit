#!/usr/bin/env node

import { config } from "./config.js";
import { closeDb, getRoutes, getStops, importGtfs, openDb } from "gtfs";
import fs from "fs";

const db = openDb(config);
await importGtfs({ ...config, db: db });

const routes = getRoutes({}, [
  "route_id",
  "route_short_name",
  "route_long_name",
  "route_type",
]);
const stops = getStops({}, ["stop_id", "stop_name"]);

fs.writeFileSync(
  "src/gtfs_data.ts",
  `import { Stop, Route } from "gtfs";

interface GtfsData {
  routes: Route[];
  stops: Stop[];
}

export const DATA : GtfsData = ` +
    JSON.stringify({ routes, stops }, undefined, 2)
);
closeDb(db);
