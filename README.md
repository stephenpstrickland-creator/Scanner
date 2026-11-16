# DIY OBD-II Scanner

A phone scanner for any 1996+ car, with ABS / airbag / body module codes and
manufacturer data (Toyota first). Works with a Bluetooth LE OBD adapter
(ELM327-compatible, e.g. V011, or OBDLink CX).

Two ways to run it:

| | What | How |
|---|---|---|
| **iPhone app** (full screen, own icon) | `ios/` | GitHub builds `Scanner.ipa` automatically → install with SideStore / SideInstaller / AltStore |
| **Web app** | `index.html` | Turn on GitHub Pages → open `https://stephenpstrickland-creator.github.io/Scanner/` in Bluefy |

## Getting the iPhone app
1. Every change to this repo starts **Actions → Build iPhone app** (or tap *Run workflow*).
   It takes about 5 minutes on a GitHub Mac.
2. When it's green, the app is at
   `https://github.com/stephenpstrickland-creator/Scanner/releases/download/latest/Scanner.ipa`
3. Install it with a sideloading app (signs it with your own Apple ID):
   - **iOS 27+:** SideInstaller (no computer) → *Custom .ipa* → paste the link above.
   - **iOS 26:** SideStore / SideInstaller with a pairing file made once on a computer.
   - Free Apple IDs: apps must be re-signed every 7 days (SideStore does it on the phone) and max 3 sideloaded apps.

## Changing the app
The interface is in `web/` (`app.html`, `app.js`, `core.js`, `db.js`).
`python3 web/build.py` rebuilds `index.html`; commit it and the iPhone app rebuilds too.
`node web/test_core.js` tests the diagnostic code against `web/sim_car.py` (a simulated 2007 Tacoma / Honda).

Read-only diagnostics plus code clearing. No resets, coding or actuator tests.
