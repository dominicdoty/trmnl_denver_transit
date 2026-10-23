# Denver Transit TRMNL Backend

Arrival times for a given RTD `stop_id` and `route_id`, formatted for a TRMNL display.

Scheduled times come from a pre-baked copy of RTD's static GTFS feed; real-time
delays come from RTD's GTFS Realtime feed.

## Usage

```
GET /?stop_id=25427&route_id=103W
```

```json
{
  "stopDisplayName": "Auraria West Station",
  "routeDisplayName": "W",
  "trains": [
    {
      "cars": [],
      "scheduledTime": "8:43 PM",
      "actualTime": "8:43 PM",
      "minutesToArrival": 9.5,
      "isLate": false
    }
  ]
}
```

Both `stop_id` and `route_id` are required; anything else returns `400`. An
unknown pair returns `200` with an empty `trains` array.

Optional `stop_display_name` / `route_display_name` query params override the
names baked from the GTFS feed.

Responses are sent with `Cache-Control: public, max-age=20`. RTD republishes its
real-time feed every 30 seconds, so this never serves a stale feed tick.

### Coverage

Rail only (`route_type` 0/1/2): 10 routes, 140 stops, 215 `(route, stop)` pairs.
Bus routes are not baked, so querying one returns an empty `trains` array.

Find valid IDs in the baked tables:

```sh
grep -o '"[0-9A-Z]*|[0-9]*"' src/gtfs_schedule.ts | head
```

## Setup

```txt
npm install
npm run import-gtfs   # rebuild src/gtfs_schedule.ts from RTD's static feed
npm run dev
```

```txt
npm run deploy
```

`import-gtfs` downloads the full static feed (~11 MB) and rewrites
`src/gtfs_schedule.ts`. That file is committed, because deploys don't rebuild it.

## How it works

| File | Purpose |
| --- | --- |
| `src/index.ts` | Hono route: reads query, composes the response |
| `src/schedule.ts` | Service selection, scheduled arrival lookup, Denver-local time |
| `src/gtfs_rt.ts` | Reads RTD's real-time protobuf feed |
| `src/gtfs_schedule.ts` | Generated schedule data — do not edit by hand |
| `src/import_gtfs_data.js` | Generates `src/gtfs_schedule.ts` |

### Real-time parsing

`gtfs_rt.ts` walks the protobuf wire format directly instead of materializing
the whole feed. Decoding all ~446 entities and ~12k stop time updates costs
roughly 5 ms of CPU per request, which is most of a Worker's budget for a single
call.

Because `trip` (field 1) is encoded before `stopTimeUpdate` (field 2), the route
id is readable before the stop times. An entity for another route is therefore
skipped with a single varint read rather than by walking its ~27 stop time
updates.

Parsing one `(route, stop)` pair takes about 0.24 ms. The implementation is
checked against [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings)
over every `(route, stop)` pair in a live feed.

Two details worth knowing if you modify it:

- `protobufjs`'s `reader.string()` consumes its own length prefix. If you have
  already read the length, use `utf8.read(buf, start, start + len)` instead.
  Note that the third argument is an **end** offset, not a length.
- Every nested message loop must restore `reader.pos` to its own end bound
  afterwards, or the next field is read from the wrong place.

## Known limitations

- **The baked schedule goes stale.** Re-run `npm run import-gtfs` when RTD
  publishes a new feed (they do so about weekly). Nothing currently checks
  currentness, and trips added since the last import will not appear.
- **Holidays use weekday service.** The baked calendar carries day-of-week flags
  only. RTD's feed publishes no `calendar_dates` exceptions today, so holidays
  run weekday schedules for any day RTD runs reduced service.
- **`cars` is usually empty.** GTFS Realtime has no car-count field; the value
  comes from splitting the vehicle label on commas, and most RTD vehicles don't
  encode it.
