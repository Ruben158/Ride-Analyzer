---
name: Mobile sensor sessions
description: Browser background behavior and recovery rules for live phone sensor tracking.
---

Web pages cannot guarantee continuous motion or location callbacks while a phone is locked or the browser tab is backgrounded. Active ride state must be checkpointed in local storage during the session and on visibility/page lifecycle events, then restored on reload. The UI should distinguish recovered elapsed time from sensor-measured intervals instead of silently inventing speed or waiting data.

**Why:** Mobile browsers may pause JavaScript, sensors, or the tab entirely to save battery, and the page can return through a fresh load.

**How to apply:** For future live sensor features, treat the web version as best-effort foreground tracking and use a native mobile artifact when reliable locked-screen/background tracking is required.