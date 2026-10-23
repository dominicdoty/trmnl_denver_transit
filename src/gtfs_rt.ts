import protobuf from "protobufjs/minimal";

/**
 * Minimal GTFS-realtime (TripUpdate) reader.
 *
 * Decoding the whole RTD feed with `gtfs-realtime-bindings` materializes ~430
 * entities and ~12k stop time updates per request. This module walks the raw
 * wire format instead and keeps only the arrival updates for one
 * (route, stop) pair.
 *
 * Wire layout used here (transit_realtime.FeedMessage):
 *   FeedMessage.entity        = 2
 *   FeedEntity.tripUpdate     = 3
 *   TripUpdate.trip           = 1
 *   TripUpdate.stopTimeUpdate = 2
 *   TripUpdate.vehicle        = 3
 *   TripDescriptor.routeId    = 5
 *   StopTimeUpdate.stopId     = 4
 *   StopTimeUpdate.arrival    = 2
 *   StopTimeEvent.time        = 2
 *   VehicleDescriptor.label   = 2
 */

const FEED_ENTITY = 2;
const ENTITY_TRIP_UPDATE = 3;
const TRIP_UPDATE_TRIP = 1;
const TRIP_UPDATE_STOP_TIME_UPDATE = 2;
const TRIP_UPDATE_VEHICLE = 3;
const TRIP_DESCRIPTOR_ROUTE_ID = 5;
const STOP_TIME_UPDATE_ARRIVAL = 2;
const STOP_TIME_UPDATE_STOP_ID = 4;
const STOP_TIME_EVENT_TIME = 2;
const VEHICLE_DESCRIPTOR_LABEL = 2;

export interface StopUpdate {
  /** Arrival time as a UNIX timestamp in seconds. */
  arrivalSeconds: number;
  /** Vehicle label split on commas (GTFS-RT has no car list field). */
  cars: string[];
}

/**
 * Reads `len` bytes at the reader's position as UTF-8.
 *
 * `protobufjs`'s `reader.string()` always consumes a length prefix first, so it
 * cannot be used after the length has already been read. `utf8.read` also takes
 * (buffer, start, END) — not a length — hence `start + len`.
 */
function readString(
  reader: protobuf.Reader,
  len: number
): string {
  const start = reader.pos;
  reader.pos += len;
  return protobuf.util.utf8.read(reader.buf, start, start + len);
}

/** protobufjs yields a Long when long.js is configured, a number otherwise. */
function readInt64(reader: protobuf.Reader): number {
  const raw = reader.int64() as number | { toNumber(): number };
  return typeof raw === "number" ? raw : raw.toNumber();
}

export function extractStopUpdates(
  bytes: Uint8Array,
  routeId: string,
  stopId: string
): StopUpdate[] {
  const results: StopUpdate[] = [];
  const reader = new protobuf.Reader(bytes);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if ((tag >>> 3) !== FEED_ENTITY || (tag & 7) !== 2) {
      reader.skipType(tag & 7);
      continue;
    }

    const entityLen = reader.uint32();
    const entityStart = reader.pos;
    const entityEnd = entityStart + entityLen;

    // Parse each entity from its own reader so a malformed entity can only
    // damage itself, never desync the walk over the rest of the feed.
    const entity = new protobuf.Reader(bytes.subarray(entityStart, entityEnd));
    let matchedRoute = false;
    let cars: string[] = [];
    const arrivals: number[] = [];

    while (entity.pos < entity.len) {
      const entityTag = entity.uint32();
      if ((entityTag >>> 3) !== ENTITY_TRIP_UPDATE || (entityTag & 7) !== 2) {
        entity.skipType(entityTag & 7);
        continue;
      }

      const tripUpdateLen = entity.uint32();
      const tripUpdateStart = entity.pos;
      const tripUpdateEnd = tripUpdateStart + tripUpdateLen;

      // `trip` is field 1 and therefore appears before `stopTimeUpdate`
      // (field 2). Read the route first and, when it doesn't match, jump
      // straight past the whole tripUpdate instead of walking its ~27 stop
      // time updates.
      matchedRoute = false;
      while (entity.pos < tripUpdateEnd) {
        const tripUpdateTag = entity.uint32();
        const field = tripUpdateTag >>> 3;
        if ((tripUpdateTag & 7) !== 2) {
          entity.skipType(tripUpdateTag & 7);
          continue;
        }

        const len = entity.uint32();
        const fieldEnd = entity.pos + len;

        if (field === TRIP_UPDATE_TRIP) {
          while (entity.pos < fieldEnd) {
            const tripTag = entity.uint32();
            if ((tripTag >>> 3) === TRIP_DESCRIPTOR_ROUTE_ID && (tripTag & 7) === 2) {
              const routeLen = entity.uint32();
              if (readString(entity, routeLen) === routeId) matchedRoute = true;
            } else {
              entity.skipType(tripTag & 7);
            }
          }
        } else if (!matchedRoute) {
          entity.pos = fieldEnd;
          continue;
        } else if (field === TRIP_UPDATE_VEHICLE) {
          while (entity.pos < fieldEnd) {
            const vehicleTag = entity.uint32();
            if ((vehicleTag >>> 3) === VEHICLE_DESCRIPTOR_LABEL && (vehicleTag & 7) === 2) {
              const labelLen = entity.uint32();
              cars = readString(entity, labelLen).split(",");
            } else {
              entity.skipType(vehicleTag & 7);
            }
          }
        } else if (field === TRIP_UPDATE_STOP_TIME_UPDATE) {
          let matchedStop = false;
          let arrivalSeconds: number | null = null;

          while (entity.pos < fieldEnd) {
            const stopTag = entity.uint32();
            const stopField = stopTag >>> 3;
            if ((stopTag & 7) !== 2) {
              entity.skipType(stopTag & 7);
              continue;
            }
            const stopLen = entity.uint32();
            const stopEnd = entity.pos + stopLen;
            if (stopField === STOP_TIME_UPDATE_STOP_ID) {
              if (readString(entity, stopLen) === stopId) matchedStop = true;
            } else if (stopField === STOP_TIME_UPDATE_ARRIVAL) {
              while (entity.pos < stopEnd) {
                const eventTag = entity.uint32();
                if ((eventTag >>> 3) === STOP_TIME_EVENT_TIME && (eventTag & 7) === 0) {
                  arrivalSeconds = readInt64(entity);
                } else {
                  entity.skipType(eventTag & 7);
                }
              }
            }
            entity.pos = stopEnd;
          }

          if (matchedStop && arrivalSeconds !== null) arrivals.push(arrivalSeconds);
        }

        // Always resume at the end of this field, whatever was parsed inside.
        entity.pos = fieldEnd;
      }

      if (matchedRoute) {
        for (const arrivalSeconds of arrivals.splice(0)) {
          results.push({ arrivalSeconds, cars });
        }
      }

      entity.pos = tripUpdateEnd;
    }

    reader.pos = entityEnd;
  }

  return results;
}
