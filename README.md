# climbross

A free, unofficial web app for Climbro hangboards. It connects over Web Bluetooth and measures force per hand, recording the true peak. There's no account: each profile has separate history stored locally, with optional private Azure Blob backup/merge.

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

## Profiles and Azure Blob

Use **Profile** to create and switch between people. Histories, maxima and plans are isolated locally; existing measurements remain in the default profile. Cloud backup is optional and manual. Each profile accepts a private SAS URL for one JSON blob; the public app contains no SAS or account key. A first upload is create-only; later uploads use ETags to protect against overwriting unseen changes from another device. Download/merge before retrying a conflict. Exports and cloud payloads omit local SAS settings.

See [Azure setup](docs/AZURE.md) for private containers, CORS, 30-day service SAS tokens, renewal and limitations. `tools/create-profile-sas.py` writes a token into a private file outside the repository; it never publishes it. Real Azure account setup is required before cloud backups work. Automated cloud tests use a mock.

## Obstacle jump game

Choose **Trening / Gra → Skoki przez przeszkody**. Pull to the configured kg or percentage target to jump, then release below half the target to rearm. Extra force does not increase jump height. Obstacles cleared, collisions and jumps are saved with the result. In Demo, use **Skok (DEMO)**. Work/rest intervals, signal-loss handling and profile separation apply to both games.

Run `node --test tests/training.test.mjs tests/cloud-jump.test.mjs` for clock, score, jump and cloud-condition tests. Browser tests additionally cover local profile isolation, the original database, malformed imports, cloud conflicts against a mock, and offline use.

## Kayak and tug of war

Choose **Trening / Gra → Spływ kajakiem** to paddle through bends, collecting stars and avoiding rocks. Hands alternate between sets.

Choose **Przeciąganie liny** and an easy, medium or hard rival. Each set is one round: reach the line to win early, or finish the set with the rope on your side. The centre is a draw. Rest pauses the rope, and an interrupted round is not scored. Use either hand or both together; the manual demo board also works.

## Climbing and balance

Choose **Wspinaczka** to reach holds by keeping force in the target zone. Hands alternate per set or repetition. Choose **Szalka** to balance a target for two seconds and compare the second hand against the first. Records are kept by game and plan; demo and interrupted sessions are excluded. Optional sound and vibration are off by default.
