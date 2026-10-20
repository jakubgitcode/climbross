# climbross

A free, unofficial web app for Climbro hangboards. It connects over Web Bluetooth and measures force per hand, recording the true peak. There's no account: your profile and history are stored only on your phone.

**Use it:** https://jakubgitcode.github.io/climbross/ in Chrome on Android, then choose "Add to Home screen". Close the official Climbro app first, because the board accepts only one connection at a time.

- Left / Right / Both measurements with peak, average, time under load, % of body weight and % of your max
- History with per-hand bests and left/right asymmetry
- JSON export and import for backups
- Works offline once loaded
- Needs Chrome on Android; iPhone browsers don't support Web Bluetooth

Not affiliated with Climbro. Provided as is, with no warranty.

## Training / game

Open **Trening / Gra** to choose an editable endurance or repeaters preset, or play a force-controlled flight game. Set a target in kg (for example 20 kg) or as a percentage of the selected hand's saved maximum (for example 20%). Both hands use a separate saved maximum. Set work/rest duration, repetitions, sets, rest between sets, and the target tolerance. Save named plans locally; JSON export/import includes plans and results.

In the flight game, force controls altitude. Hold within the green target band to earn one star per second. Rest intervals award no points, and exceeding the target gives no bonus. Sessions include a five-second preparation countdown.

Disconnects, missing readings and backgrounding interrupt the session. Save completed or interrupted sessions to History. Training does not overwrite profile maxima. Demo results are labelled and excluded from personal bests. Presets are editable examples, not personalized training recommendations. Check zero, known-weight readings and calibration on your board before relying on force targets.

## Development checks

No build step is required. With Node.js installed, run `node --test tests/training.test.mjs` for force targets, intervals, scoring and interruption tests. The browser workflow test (`tests/browser.cjs`) requires Playwright and Chromium (its executable path is configured near the start of the test). It checks the game, training, saved results, plans, JSON backups and offline support under the Pages subpath.
