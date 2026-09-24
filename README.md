# Margin

A private, adaptive study planner. Plain JavaScript, CSS, Vite, and `ical.js`. No account, backend, API key, or runtime network dependency.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
cd app
npm ci
npm run dev
```

Open the printed localhost URL. The first visit loads a clearly labeled sample calendar.

For offline use, build and open the production preview once:

```sh
npm run build
npm run preview
```

Wait for **ready offline** in the footer. The cached app then reloads without the server or an internet connection, on the same browser and origin. Initial dependency installation needs internet. Development mode does not cache the app.

## Use

1. Import one or more `.ics` files from Google or Apple Calendar. Google exports a ZIP; extract it first. Importing your first calendar replaces the sample and its check-ins.
2. Set your weekly goal, session length, preferred time, study hours, and study days.
3. The planner automatically fits sessions into free time, leaving 15-minute buffers. It never schedules new sessions in the past.
4. Mark sessions done or skipped. Future plans adapt; Undo reverses a check-in. Sessions without feedback remain pending rather than being treated as failures.
5. Export the displayed week's study sessions as `.ics`, then import them into your calendar app. Reimport your calendar when commitments change. Importing the same filename replaces its previous snapshot.
6. Choose an environment manually, or enable browser location. Choose a label and **Remember here** to recognize that place later. Location runs only while the page is open; it must be enabled again after reload.

## Adaptation

Each candidate uses a score: **70% time-of-day history + 20% weekday history + 10% environment/time history**. A smoothed completion rate adds two prior observations to avoid overreacting to a single check-in. Preferred times begin with a 0.70 prior; other times use 0.45. Weekday and environment priors are 0.50. Each session already on a day subtracts 0.08 to spread study time across the week. Ties favor earlier slots.

These weights are prototype choices, not a validated prediction of behavior. The selected environment is an assumption for planned sessions, not a forecast of future location. Only explicit completed/skipped feedback trains the scores.

## Boundaries

- Calendar integration is file-based, not automatic account synchronization. No notifications or background calendar access.
- Imports support recurring events, exceptions, cancellations, all-day events, UTC/floating times, and embedded `VTIMEZONE` definitions. Missing time zone definitions are rejected rather than guessed. Hourly or more frequent recurrence is unsupported. Limits: 2 MB per file and 20,000 expanded occurrences per import window.
- Only full sessions are planned. A goal not divisible by session length may leave minutes unplanned. An overloaded calendar reports the shortfall.
- Imported events outside study hours still block the appropriate time but may fall outside the calendar's visible hours. All-day events occupy the entire day.
- Data lives in browser `localStorage`. It does not sync across devices and is lost if browser data is cleared. Storage failures are reported. Use Calendar connection → Clear this device’s data to remove it.
- Coordinates are transient unless you explicitly remember a place. Saved places and session environment labels remain local. Location requires HTTPS or localhost and browser/OS permission; GPS may be unavailable offline or indoors. No geocoding or background tracking.
- A saved place matches only when its distance plus reported GPS uncertainty is within 250 m. Saving requires uncertainty at most 150 m. These are conservative prototype thresholds.
- Nothing is published. The server binds to `127.0.0.1`.

## Checks and source

```sh
cd app
npm test
npm run build
```

- `src/planner.js`: availability, scoring, session feedback, place distance.
- `src/calendar.js`: iCalendar parsing, recurrence expansion, export, sample data.
- `src/main.js`: interface, local persistence, optional location.
- `build-offline.js`: production service worker with versioned asset caching.
- `test/`: scheduler and calendar boundary checks.

Calendar instructions follow [Google Calendar](https://support.google.com/calendar/answer/37111) and [Apple Calendar](https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac). Recurrence handling uses [ical.js](https://kewisch.github.io/ical.js/api/ICAL.Event.html). Offline and location behavior follow the browser [Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) and [Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition) APIs.
