# Meeting Room Door Panel — firmware

Display-only schedule screen for the **Waveshare ESP32-S3-Touch-LCD-7B** (7", 1024×600).

The panel polls one read-only endpoint every 30 seconds and draws the room's day. It has **no
write path** — it cannot book, cancel or change anything, by design, because a screen in a
corridor has no signed-in user.

```
GET /api/public/room-display/<roomId>
```

| File | What it is |
|---|---|
| `room_display.ino` | The sketch: Wi-Fi, polling, JSON, and the whole screen |
| `lgfx_waveshare_7b.h` | LovyanGFX panel definition (RGB pins and timings) |

The layout mirrors `frontend/components/meeting-rooms/RoomDisplayScreen.tsx` at the same
coordinates, so you can preview and sign off the design in a browser at
`/display/room/<roomId>` before anything is flashed.

---

## 1. Install the toolchain

Nothing is installed on this machine yet — you need all three:

1. **Arduino IDE 2.x** — <https://www.arduino.cc/en/software>
2. **ESP32 board support** — Arduino IDE → *Boards Manager* → install **`esp32` by Espressif
   Systems** (3.0.x or later).
3. **Libraries** — Arduino IDE → *Library Manager*:
   - **LovyanGFX** by lovyan03
   - **ArduinoJson** by Benoît Blanchon (**v7**, not v6 — the sketch uses `JsonDocument`)

If the board doesn't appear as a COM port after plugging it in, install the USB-serial driver —
**CP210x** (Silicon Labs) or **CH340**, depending on the bridge chip on your board.

## 2. Fill in the three settings

Top of `room_display.ino`:

```cpp
static const char *WIFI_SSID   = "Your_Office_WiFi";    // 2.4GHz — the ESP32-S3 has no 5GHz radio
static const char *WIFI_PASS   = "Your_WiFi_Password";
static const char *SERVER_BASE = "https://app.autopilotoffices.com";  // no trailing slash
static const char *ROOM_ID     = "0000...";             // meeting_rooms.id — one per panel
```

**Getting the room UUID.** Open the room in the app and take the id from the URL, or run this
read-only query against your Supabase project:

```sql
select r.id, r.name, p.name as property
from meeting_rooms r
join properties p on p.id = r.property_id
where r.status = 'active'
order by p.name, r.name;
```

Each panel gets its own `ROOM_ID`. Everything else is identical, so flashing ten rooms means
changing one line ten times.

Before flashing, paste that id into `/display/room/<roomId>` in a browser. If the browser shows
the right room, the panel will too — same endpoint, same data.

## 3. Board settings (Tools menu)

These matter. The 1024×600 framebuffer is ~1.2MB and **must** live in PSRAM:

| Setting | Value |
|---|---|
| Board | **ESP32S3 Dev Module** |
| PSRAM | **OPI PSRAM** ← wrong value here = blank screen |
| Flash Size | **16MB (128Mb)** |
| Partition Scheme | **16M Flash (3MB APP/9.9MB FATFS)** |
| Upload Speed | 921600 |
| USB CDC On Boot | **Disabled** if flashing through the UART port |
| Port | your board's COM port |

> **USB CDC On Boot:** leave it *Disabled* when you flash and monitor through the **UART**
> port (the CH340/CP210x one). Enabling it sends `Serial` to the native USB port instead, and
> your Serial Monitor goes silent — which looks exactly like a dead board.

## 4. Flash

Connect a **data-capable** USB-C cable (not a charge-only one) to the **UART** port, pick the
COM port, and press Upload.

If upload fails to start, hold **BOOT**, tap **RESET**, release **BOOT**, and upload again.

## 5. What you should see

1. `Connecting` + your SSID
2. `Loading schedule` + your server URL
3. The schedule screen

Then it refreshes every 30 seconds. The **Live** dot in the top bar turns orange and reads
`Offline` after four consecutive failed polls, so a panel that has lost the server is obvious
from across the corridor rather than quietly showing yesterday.

---

## Notes

**No NTP, no RTC.** The server is the clock — the payload carries `now_min` (minutes past
midnight IST) and the sketch ticks forward from it with `millis()`. Nothing to configure and
nothing to drift.

**The logo is drawn, not flashed.** `drawLogo()` reproduces the path from
`public/autopilot-logo-white.svg` with two triangles, so there's no image asset in the build.

**TLS is unverified** (`client.setInsecure()`). The feed is public and read-only and the panel
sends no credentials, so nothing leaks — but someone on the network could serve a *fake*
schedule. To close that, swap in `client.setCACert(...)` with your server's root CA.

**Pins.** Every board-specific value is in `lgfx_waveshare_7b.h`. Waveshare revises these boards
and the 7 / 7B / 7C variants differ, so if the screen is black or scrambled, diff that file
against your board's wiki page first. Two traps worth knowing:

- **GPIO19/20 are the native USB D−/D+ lines.** Guides that put touch I²C there break the USB port.
- **The backlight is on the CH422G expander (EXIO2), not a GPIO.** Guides saying "backlight
  GPIO 2" are misreading EXIO2 as GPIO2.

**Touch is not used.** The board has a 5-point GT911 digitizer, but this build ignores it — the
panel is display-only until booking-from-the-screen is designed properly (whose credits get
charged is the hard part, not the tapping).
