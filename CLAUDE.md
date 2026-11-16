# DIY OBD-II Scanner: guide for Claude Code

A phone-based car scanner in the spirit of the Topdon AD500: engine codes, freeze frame, readiness, live data,
Mode 06 misfire counts and full monitor test results (pass/fail vs limits), fuel trims, **all-systems scan (ABS / airbag / body modules)** with manufacturer data
(Toyota first), a vehicle card (NHTSA VIN decode + photo), a fuel & MPG tracker, and CarPlay / Lock Screen
live gauges. Apple-style UI (SF fonts, grouped lists, sheets, dark/light).

## The owner's setup (design for this first)
- **Vehicle:** 2007 Toyota Tacoma PreRunner Double Cab, 4.0 L V6 (1GR-FE), ~273k miles, CAN 11-bit/500k.
  Known codes: P0441, P0455, P0504. `web/sim_car.py tacoma2007` simulates it.
- **Adapter:** Bluetooth LE ELM327 clone named **V011**. Its exact services are unknown, so the code tries every
  notify+write channel (FFF0 first).
- **Phone:** iPhone, iOS 26.3.1 (doesn't want to update). Today the app runs in the **Bluefy** browser (Web
  Bluetooth). The native app is sideloaded with SideStore + iloader from a personal Windows PC (free Apple ID:
  7-day re-sign, 3 apps / 10 app IDs a week). The owner works from a phone a lot, so keep instructions phone-friendly.

## Layout
```
web/            the app (single-page, vanilla JS, no framework, no bundler)
  app.html      markup + CSS + SVG icons; placeholders /*__DB__*/ /*__CORE__*/ /*__HEALTH__*/ /*__APP__*/
  core.js       transports (BleTransport = Web Bluetooth, NativeTransport = iPhone app bridge), SerialBase,
                Elm (ELM327/STN command layer, OBD services, ISO-TP), AllSystems (UDS 0x19/0x14, KWP 0x18/0x13,
                module addressing incl. Toyota 0x750 + extended address)
  health.js     DriveHealth: pure logic (no DOM) that watches live readings during a drive and raises
                findings (urgent / warn / watch) on sustained patterns: fuel trims, warm-up, charging, rear O2,
                knock, idle, misfires, new pending codes. Takes timestamps from the caller so tests fast-forward.
  db.js         VEHICLE_DB (per-make modules, warnings, enhanced PIDs, DTC text) + DTC_GENERIC
  app.js        UI, screens, polling, vehicle card, fuel/MPG, CarPlay gauges feed, Drive Health glue, custom alerts,
                charts (up to 3 readings, own scales, drag cursor) and recordings (search for the "// -----" markers).
                Navigation: a floating tab bar (Home · Live · Diagnose · Log). Each tab has its own stack in
                `S.stacks[tab]`; `S.stack` is a getter for the current tab, so `push`/`pop`/`top()` work as before.
                `showStack()` redraws a tab without animation. Swipe from the left edge pops; sheets drag down to close.
                The last tab and segment choices are saved (`scanner.tab`, `scanner.seg.*`).
                `pushH` keeps HT = [time, value] for the last 10 min: graphs and alert recordings read it.
                Recordings and alert rules live in localStorage (`scanner.recs`, `scanner.alerts.*`), metric values.
  build.py      concatenates everything into ../index.html
  sim_car.py    ELM327 + car simulator (stdin/stdout) used by the tests
  test_core.js  core.js against the simulator
  tests/        jsdom end-to-end tests (see Testing)
index.html      GENERATED. GitHub Pages serves it (Bluefy URL) and the iOS build bundles it. Commit it.
ios/            native wrapper, built by XcodeGen on GitHub Actions (no local Mac needed)
  project.yml   targets: Scanner (app, iOS 16.2) + ScannerGauges (widget extension, iOS 18)
  Sources/      AppDelegate, WebViewController (WKWebView + message bridge), BLEBridge (CoreBluetooth),
                LiveGauges (ActivityKit), GaugePoller (reads gauges itself while the phone is locked)
  Shared/       GaugeAttributes (Live Activity model, in both targets)
  Gauges/       the Live Activity UI (Lock Screen, CarPlay Dashboard = .small family, Dynamic Island)
.github/workflows/Build.yml   on push to main: xcodegen, unsigned xcodebuild, Scanner.ipa -> release "latest"
```

## Build, test, ship
- `npm install` once (jsdom), then **`npm test`**: rebuilds index.html and runs every suite. Needs Python 3
  (`PYTHON` env var overrides; Windows defaults to `python`).
- `npm run build` only regenerates index.html.
- **Edit files in `web/`, never `index.html` directly.** Rebuild and commit both.
- Push to `main` and two things happen: GitHub Pages updates the Bluefy URL
  (https://stephenpstrickland-creator.github.io/Scanner/, cached up to ~10 min), and Actions builds
  https://github.com/stephenpstrickland-creator/Scanner/releases/download/latest/Scanner.ipa
- **Swift can't be compiled on Windows.** After touching `ios/`, push and check the Actions run (`gh run watch`).
  A failed build leaves the previous release in place.

## Testing
`web/tests/run-all.js` runs:
- `test_core.js`: ELM/ISO-TP/UDS/KWP logic vs the simulator
- `tests/health.js`: Drive Health vs synthetic 25-minute drives, one per fault, plus a healthy drive that must stay quiet
- `tests/e2e.js tacoma2007 1.4b [native]`: the full UI in jsdom over a fake Web Bluetooth device (or the fake
  iPhone bridge with `native`, which also checks the CarPlay gauge feed, lock hand-off and resume)
- `tests/conn.js`: hanging adapter, silent first channel, Cancel, all-silent, and **Bluefy detection**
- `tests/feat.js`: vehicle lookup/photos (mocked fetch), fuel & MPG, fill-ups
- `tests/demo.js`: demo mode in both themes, checks for page errors
- `tests/nav.js`: tab bar, per-tab stacks, badge, offline code lookup, swipe back, sheet drag, remembered tab

Add a test with every fix. `window.__scanner` exposes `S, D, H, HT, F, HL, AL, getRECS, ACT, connect, push, pop, selectTab, getVEH` for tests.

## Things that bit us (don't undo these)
1. **Bluefy has its own `window.webkit.messageHandlers.ble`.** The iPhone app's bridge is named `scannerApp`, and
   the app injects `window.__scannerNative = true`. `NativeTransport.available()` requires the flag, the handler,
   *and* no `navigator.bluetooth`. Checking for a handler alone made Bluefy spin forever on "Looking for adapters".
2. **Every Web Bluetooth await needs a timeout** (`withTimeout` in core.js). `gatt.connect()` hangs forever if the
   adapter is busy, e.g. Car Scanner still connected. Messages tell the user what to do.
3. **Try every notify/write channel.** If ATZ/ATI get no answer (`err.code === 'NOANSWER'`), RealBackend calls
   `nextChannel()` before giving up.
4. **Native bridge contract** (page -> `nativePost({op, ...})`, app -> `window.__nativeBle.*`):
   - ops: `connect`, `write`, `disconnect`, `fetch` (host allow-list in WebViewController), `share`, `theme`,
     `gauges` (`update` | `handoff` | `end`)
   - callbacks: `onStatus`, `onConnected`, `onError`, `onData`, `onDisconnect`, `onResume(json)`
   - Change both sides together.
5. **CarPlay gauges:** a Live Activity can only *start* while the app is on screen; updates work in the
   background. When the page hides, it pauses polling (`S.busy++`) and sends `handoff`. BLEBridge then enters
   `nativeMode` (drops page writes, routes data to GaugePoller), and on return hands back miles/gallons via
   `onResume`. GaugePoller duplicates the formatting and alert rules in app.js (`lgItem` / `lgAlert`), so keep them
   in sync. Needs `UIBackgroundModes: bluetooth-central`.
6. **Scope is read-only diagnostics plus code clearing.** No resets, coding, adaptations or actuator tests.
   Clearing ABS on older Toyotas wipes the VSC zero-point (C1336), and the app warns about it.
7. **Images:** don't bundle copyrighted photos (dealer/listing sites). Runtime sources only: NHTSA (public domain)
   and Wikimedia Commons (credited), or the owner's own photo. A 3D truck model (MakerWorld) was tried and
   dropped. Its license was never confirmed to allow redistribution, and this repo is public.
8. Units: internal values are metric (km/h, °C, kPa). `conv()` / `fmt()` handle display. MPG uses MAF
   (gal/h = MAF × 3600 / (14.7 × 2798.7)) or speed-density as a fallback.

9. **Background jobs take turns.** `job()` queues: pending-code / misfire checks (Drive Health, every 3 min) and the
   test-results load must never land in the middle of an All Systems scan (wrong module headers).
   Drive Health only runs while the page is active; GaugePoller does not run its checks with the phone locked yet.

## Style
Vanilla JS, small functions, no new dependencies in the shipped page (it must stay one self-contained HTML file
that works offline). Match the existing Apple-like look and the `data-act` / `ACT` action pattern. Keep text plain
and friendly; the owner isn't a programmer.
