# Loci v6 — Android App Spec

Nov 1, 2026 · @ANDREW

## Summary

Loci gets an Android app so the phone no longer runs it in a browser tab, and so it can do what a web page can't: watch which app is open, show things over other apps, schedule notifications that fire with Loci closed, and change the screen at night. Three features come with it:

1. **Social media timer.** Open a social app and a small timer floats over it, counting the time spent. It resets only after you've stayed away for a while.
2. **Notifications** for to-dos and study, which fire even when Loci is closed.
3. **Sleep mode.** A bedtime (or a manual switch) that reminds you to sleep, lowers the brightness and puts on a warm, blue-light filter.

The app is a **thin native shell** around the Loci that already exists: a full-screen WebView that opens Loci's Cloudflare address, plus native Kotlin code for the three features. The web app stays the one place where screens are built; the Android part adds a few things it can't do in a browser.

Constraints carry over: no AI, no paid APIs, no account. The app is installed from an APK (sideloaded), not the Play Store. Play's rules on overlays, usage access and background services don't apply, and Loci doesn't pay Google's fee or wait for review. The v5 spec left out "OS-level blocking until the Android app exists". Blocking stays out: the timer only shows the time, it never closes an app.

## Decisions

- **The shell loads the live Cloudflare address, not a copy built into the APK.** Sync works only on that address (`/api/sync/…` and the live socket are same-origin), and web updates keep arriving through `src/update.ts` without a new APK. The service worker keeps working inside the WebView, so after the first open Loci works offline as it does now. A new APK is needed only when the native part changes.
- **Hand-written Kotlin, not Capacitor.** All three features need custom native code (services, overlays, alarms), which Capacitor doesn't provide, and its bridge is meant for files bundled into the app, not a live address. The shell is a few hundred lines with no npm changes. Native code uses plain Android Views, not Compose, since its only screens are small overlays.
- **The timer is a floating pill over the app, not just a notification.** A notification sits in the shade where you don't see it while scrolling, and the point is to see the time pass. The pill needs "Display over other apps". The foreground service needs a notification anyway, so that notification also shows the running time, and without the overlay permission it is all you get.
- **Usage access, not an accessibility service, to see which app is open.** An accessibility service reacts instantly, but Android shows a frightening warning for it, and on Android 13+ a sideloaded app needs "Allow restricted settings" before one can be switched on. Usage access is checked once a second, only while the screen is on, which is cheap and close enough to instant.
- **One social session across all social apps.** Going from Instagram to TikTok continues the same clock. Otherwise hopping between apps would reset it. The clock resets after **5 minutes away** (adjustable, 1–30). Screen off counts as away.
- **Which apps count as social:** apps whose developer declares them as social (Android's `CATEGORY_SOCIAL`), plus a built-in list of well-known ones (Instagram, TikTok, X, Facebook, Snapchat, Reddit, YouTube, Threads, Pinterest, Tumblr, Bluesky, Discord). In Settings you turn any app on or off, so the list is a starting point.
- **Brightness and filter by overlay, with real brightness when allowed.** Android has no public way to switch on its own Night Light, so the warm filter is a full-screen, see-through amber layer that lets touches pass through. The same layer can dim below the lowest brightness setting. If you also grant "Modify system settings", sleep mode turns the real brightness down too (better for battery on OLED screens) and puts it back in the morning. Android 12+ blocks touches through overlays that are more than 80% opaque, so the layer never goes above that.
- **Settings live in the web app, saved on the phone.** A new **Phone** section in Settings appears only inside the app. Its values are sent to the native side, which keeps them (SharedPreferences), because the services run while Loci is closed. They're specific to the device and aren't synced or put in backups, like the v5 event log.
- **The bridge is limited to Loci's address.** The native side uses `WebViewCompat.addWebMessageListener` with only the Cloudflare origin allowed, so no other page loaded in the WebView can reach it. Links to other sites open in the phone's browser, not in the shell.
- **Notifications:** a to-do with a **time** reminds you at that time, and a repeat at every occurrence. You set those times, so the v5 budget doesn't cut them. Dated to-dos without a time, and study, are covered by one **daily summary** (default 09:00, adjustable or off) that shows the current Now card and how many cards are due. That is v5 P1's budget at its default of 1. "When" and "after" to-dos fire only when the app sees them happen, so they never get a timed reminder.
- **App id `io.github.amaasprilla.loci`**, minimum Android 8 (API 26: overlays and app categories start there), target Android 16 (API 36, installed on this PC).

### Made while building D1

- **Toolchain:** Android Gradle Plugin 9.3.3 (its built-in Kotlin, no separate Kotlin plugin) on Gradle 9.8.2, compiled against Android 16.1 (API 36.1), with AndroidX Activity, Core and WebKit. `npm run android` finds Android Studio's Java and the SDK on its own.
- **Back button:** the app calls `window.lociBack()`, which sends the page an Escape: Escape already closes the top sheet, leaves a study session and goes back a screen. On home with nothing open it returns false and Android leaves the app.
- **Attachments in the app** open in another app (a PDF viewer, Photos) through Android's "open with". Backups and the activity log save to Downloads.
- **Settings → Phone in D1** shows the permission lines before their features exist, with a line saying so, so the phone can be set up in one go.

## What the user sees

### First open

The app opens on Loci at its Cloudflare address. The WebView has its own storage, separate from Chrome's, so it starts empty: **Join with a key** (Settings → Sync) brings everything in, or import a backup. A short card on the empty home screen says so, only inside the app.

The Android back button goes back a screen (closes a sheet, then leaves a locus, then on home leaves the app). Attaching files and importing a backup open the phone's file picker. Exporting a backup or saving an attachment saves the file to Downloads and says so in a toast.

### Settings → Phone

Shown only in the app. Each feature has an on/off switch, its options, and a line for each permission it needs: "Allowed" or a button that opens the right system screen ("Allow usage access →"). The line updates when you come back.

### Social media timer

- **The pill.** Opening a social app shows a small glass pill near the top of the screen: `Instagram · 12:34`. It counts up every second, can be dragged to another spot (it remembers where), and tapped to shrink to just the time. It hides while you're in a non-social app or the screen is off, and comes back with the same clock if you return within the reset time.
- **Reset.** Away for the reset time (default 5 min) and the next social app starts again at 0:00.
- **Notification.** The service's ongoing notification reads "Social · 12:34 this session". It is silent and can't be swiped away while the service runs (Android's rule for foreground services).
- **Settings:** on/off, reset time (1–30 min), the app list (each installed app with its icon and a switch; social apps on by default), pill size (normal/small).
- **Today's total**, shown under the switch: "Today: 1 h 12 min in social apps". It's kept on the phone, never synced, and for now there's no history beyond today.

### Notifications

- A to-do with a time: at that time, "Gather receipts" with its locus as the subtitle. Buttons: **Done**, **In 1 hour**. Tapping opens the to-do in Loci.
- The daily summary at its time: the Now card's title and why-line, plus "12 cards due" if there are any. Tapping opens home.
- Notifications are scheduled from the phone's copy of Loci, every time something changes while it's open. A change made on another device arrives when the phone next opens Loci (or while it's open, through sync's live updates). Until then the phone has the old schedule. Fixing this would need a background sync job, which is out of scope.
- Reminders survive a restart of the phone.
- **Settings:** to-do reminders on/off, daily summary time or off.

### Sleep mode

- **Bedtime:** a start and wake time (default 23:30–07:00) and the nights it applies to. A switch, **Sleep now**, starts it straight away until the next wake time.
- **Wind-down:** for 30 min before bedtime the filter fades in from nothing.
- **During sleep, while the screen is on:**
  - the amber filter (strength slider, default 60%) and extra dimming;
  - brightness turned down, if "Modify system settings" is allowed, and put back at wake time or when sleep mode ends;
  - a reminder whenever the screen is turned on, then every 10 minutes it stays on: a notification "00:40 · You're meant to be asleep" and the same line in a pill over whatever is open. The pill fades after 5 seconds.
- **Ending early:** the notification has **I'm up** (ends tonight's sleep mode) and **10 more minutes** (pauses the reminders, not the filter). Turning sleep mode off in Settings ends it too. There's no lock or extra step to switch it off: it's a nudge, not a lock.
- **Settings:** on/off, bedtime and wake time, nights, filter strength, reminder interval (5/10/15/30 min).

## How it works

### Repository layout

`android/` at the repo root: a Gradle project (Kotlin DSL, Android Gradle Plugin, Gradle wrapper), one `app` module. Built with Android Studio's bundled JDK and the SDK already installed on this PC. Nothing in the web build changes. `npm run android` builds the APK (calls `android/gradlew assembleRelease`).

The Cloudflare address is a Gradle property (`lociUrl` in `android/gradle.properties`), so the APK can point at a test address.

### Native side (Kotlin)

| Part | Job |
| --- | --- |
| `MainActivity` | The WebView: opens `lociUrl`, back button, file chooser, downloads, links to other sites go to the browser, the bridge. |
| `Bridge` | Receives messages from the web app (settings, reminder schedule, "open this system screen") and answers (permission states, today's total, installed apps). |
| `WatchService` | Foreground service (type `specialUse`). Runs while the timer or sleep mode is on. Listens for screen on/off. While the screen is on, checks the open app once a second (`UsageStatsManager.queryEvents`), drives the timer pill and the sleep layer. |
| `Overlays` | The timer pill, the sleep layer and the reminder pill (`TYPE_APPLICATION_OVERLAY`). The sleep layer has `FLAG_NOT_TOUCHABLE`, so touches pass through. |
| `Reminders` | Keeps the schedule sent by the web app, sets one exact alarm per reminder (`AlarmManager.setExactAndAllowWhileIdle`), shows the notification, handles Done / In 1 hour. |
| `BootReceiver` | After a restart: sets the alarms again and restarts `WatchService` if a feature is on. |

**Done from a notification while Loci is closed.** The native side can't write to Loci's IndexedDB. It stores the action and opens nothing; the next time Loci opens, the web app reads the queued actions through the bridge and completes the to-dos (then sync carries it to other devices).

### Web side

- `src/android.ts`: knows whether it's inside the app (`window.LociAndroid` exists), sends and receives bridge messages, does nothing in a browser.
- After every change (`onChange`) and on open, builds the reminder schedule for the next 7 days from open to-dos (`dueOf`, `nextOccurrence`) and the daily summary text from the Now card, and sends it. The native side swaps the whole schedule each time, so nothing goes stale.
- Settings → Phone (`src/settings/phone.ts`) in the redesign's look (glass card, mono kicker, pill buttons).
- File saves (backup export, attachments) go through the bridge in the app, since the WebView can't download `blob:` addresses itself.

### Permissions

| Permission | For | How it's granted |
| --- | --- | --- |
| `INTERNET` | Loading Loci, sync | Automatic |
| `POST_NOTIFICATIONS` | All notifications (Android 13+) | Pop-up, asked when you switch a feature on |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Reminders on the minute | Automatic for a sideloaded app; without it, reminders may be a few minutes late |
| `PACKAGE_USAGE_STATS` | Seeing which app is open | System screen "Usage access" |
| `SYSTEM_ALERT_WINDOW` | Timer pill, sleep filter, reminder pill | System screen "Display over other apps" |
| `WRITE_SETTINGS` | Real brightness in sleep mode (optional) | System screen "Modify system settings" |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` | `WatchService` | Automatic |
| `RECEIVE_BOOT_COMPLETED` | Restoring alarms and the service | Automatic |
| `QUERY_ALL_PACKAGES` | Listing installed apps for the timer | Automatic (sideloaded) |

Some phones (Xiaomi, Samsung, Huawei) kill background services to save battery. Settings → Phone shows a line to exclude Loci from battery optimisation if the system reports it isn't.

### Installing and updating

- Release APKs are signed with a key made once on this PC (`android/loci-release.jks`, git-ignored, password in `android/keystore.properties`, also git-ignored). **Back that file up**: Android only installs an update signed with the same key, so losing it means uninstalling (and losing the phone's local data, unless synced) to install again.
- First install: copy the APK to the phone and open it (Android asks to allow installs from that source), or `adb install` over USB.
- Web changes reach the app on their own. Native changes need a new APK installed over the old one, and data is kept.
- A GitHub Actions build that attaches the APK to a release is later work (it needs the signing key as a secret).

## Milestones

Each milestone is committed and reviewed before the next starts.

| # | Ships |
| --- | --- |
| **D0 — Spec** | This file. |
| **D1 — Shell** | `android/` project, WebView on the Cloudflare address, back button, file picker, downloads, links out, icons from `public/`, the bridge with `src/android.ts`, Settings → Phone with the permission lines, signed APK, `npm run android`. Install on the phone. |
| **D2 — Notifications** | Reminder schedule from the web app, exact alarms, to-do and daily summary notifications, Done / In 1 hour with the queued actions, restored after a restart. |
| **D3 — Social media timer** | `WatchService`, usage access check, timer pill and notification, reset after time away, app list, today's total. |
| **D4 — Sleep mode** | Bedtime and Sleep now, wind-down, amber/dim layer, real brightness with "Modify system settings", reminders with I'm up / 10 more minutes. |

## Out of scope

- The Play Store, and iOS.
- Blocking or closing apps, limits that stop you.
- Background sync while Loci is closed (and so reminders for changes made elsewhere until the phone opens Loci).
- Social media history beyond today, and charts of it.
- Switching on Android's own Night Light or Bedtime mode (no public API).
- Moving data from the Chrome copy automatically: sync or a backup does it.

## Open questions

- ~~The Cloudflare address~~: `https://loci.echomathia.workers.dev/` (`lociUrl` in `android/gradle.properties`).
- **Which phone and Android version**, to test the brand's battery rules (D3/D4 depend on them most).
