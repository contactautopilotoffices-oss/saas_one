/**
 * Autopilot — Meeting Room Door Panel
 * Waveshare ESP32-S3-Touch-LCD-7B (7", 1024x600)
 *
 * Display-only. This sketch never writes anything: it polls one read-only endpoint and draws the
 * room's day. A panel in a corridor has no signed-in user, so it is given no power to book,
 * cancel or change anything.
 *
 *   GET /api/public/room-display/<roomId>
 *
 * The server is also the clock. The payload carries `now_min` (minutes past midnight IST), and
 * the sketch ticks forward from that with millis() between polls, so there is no NTP, no
 * timezone config and no RTC to drift.
 *
 * Layout mirrors frontend/components/meeting-rooms/RoomDisplayScreen.tsx at the same
 * coordinates, so the panel and a browser show the same screen.
 *
 * Libraries (Library Manager):
 *   - LovyanGFX    by lovyan03
 *   - ArduinoJson  by Benoit Blanchon  (v7)
 *
 * Board settings are in README.md. PSRAM MUST be set to OPI.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Preferences.h>
#include "lgfx_waveshare_7b.h"

/* ========================= CONFIGURE THESE ========================= */

static const char *WIFI_SSID = "Your_Office_WiFi";   /* 2.4GHz only */
static const char *WIFI_PASS = "Your_WiFi_Password";

/* Your app's origin. No trailing slash. */
static const char *SERVER_BASE = "https://app.autopilotoffices.com";

/*
 * properties.id for THE BUILDING this panel is in — not a room.
 *
 * Every panel in a property takes this same value, so one firmware image serves the whole site.
 * The first time a panel boots it lists the property's rooms and asks which door it is on; the
 * answer is kept in NVS and it goes straight to that room from then on. Hold ROOMS in the header
 * for three seconds to pick again, e.g. when a panel is moved.
 */
static const char *PROPERTY_ID = "00000000-0000-0000-0000-000000000000";

/* =================================================================== */

static const uint32_t POLL_MS = 30000;
static const uint8_t MAX_ROWS = 8;

/* ---- geometry: keep in step with RoomDisplayScreen.tsx ---- */
static const int SCREEN_W = 1024;
static const int SCREEN_H = 600;
static const int TOPBAR_H = 62;
static const int LEFT_W = 320;
static const int ROW_PITCH = 52;
static const int ROW_H = 46;
static const int ROWS_TOP = 145;

LGFX_Waveshare7B lcd;

/* ---- palette (matches the web screen) ---- */
static uint16_t C_BG_RIGHT, C_BG_LEFT, C_TOPBAR, C_TEXT, C_DIM, C_FAINT;
static uint16_t C_BUSY, C_BUSY_SOFT, C_FREE, C_FREE_SOFT, C_NEXT, C_INK, C_HAIR, C_ROWBG;

static void initPalette()
{
    C_BG_RIGHT  = lcd.color565(0x0B, 0x0F, 0x12);
    C_BG_LEFT   = lcd.color565(0x14, 0x1A, 0x20);
    C_TOPBAR    = lcd.color565(0x0E, 0x13, 0x18);
    C_TEXT      = lcd.color565(0xFF, 0xFF, 0xFF);
    C_DIM       = lcd.color565(0x8A, 0x94, 0x9C);
    C_FAINT     = lcd.color565(0x5A, 0x64, 0x6C);
    C_BUSY      = lcd.color565(0xF7, 0x86, 0x1D);
    C_BUSY_SOFT = lcd.color565(0x2E, 0x1F, 0x0B); /* orange at 13% over the dark bg */
    C_FREE      = lcd.color565(0x3D, 0xD6, 0x8C);
    C_FREE_SOFT = lcd.color565(0x11, 0x2A, 0x1F);
    C_NEXT      = lcd.color565(0x3B, 0x82, 0xF6);
    C_INK       = lcd.color565(0x1A, 0x12, 0x06); /* text on orange */
    C_HAIR      = lcd.color565(0x1D, 0x24, 0x2A);
    C_ROWBG     = lcd.color565(0x12, 0x17, 0x1B);
}

/* ========================= model ========================= */

struct Row {
    char start[6];
    char end[6];
    char text[48];    /* booked_by, or the "Free, 30 min" label */
    char sub[48];     /* company and/or the booker's note; empty when neither */
    bool isFree;
    uint8_t state; /* 0 done, 1 now, 2 next, 3 upcoming */
};

struct RoomState {
    char roomName[48];
    char metaLine[64];
    char propertyName[48];

    bool busy;
    bool hasCurrent;
    char curBookedBy[48];
    char curCompany[48];  /* empty when the booking has no company */
    char curComment[64];  /* empty when the booker left no note */
    char curStart[6];
    char curEnd[6];
    int curEndsInMin;
    int curPct;

    bool hasNext;
    char nextBookedBy[48];
    char nextCompany[48];
    char nextStart[6];

    int freeForMin; /* -1 when busy / day over */

    char dateLabel[40];
    int nowMin;

    Row rows[MAX_ROWS];
    uint8_t rowCount;
};

static RoomState g_state;
static bool g_haveData = false;
static uint8_t g_failures = 0;
static int g_lastDrawnMin = -1;

/* ---- the property's rooms, for the picker ---- */
#define MAX_PICKER_ROOMS 12

struct PickerRoom {
    char id[40];
    char name[48];
    char meta[64];
};

static PickerRoom g_rooms[MAX_PICKER_ROOMS];
static uint8_t g_roomCount = 0;
static char g_propertyName[48] = "";

/* The room this panel is assigned to (its door), and the one currently on screen. */
static char g_homeRoomId[40] = "";
static char g_viewRoomId[40] = "";

/* Screen the panel is on. */
enum Screen { SCREEN_PICKER, SCREEN_SCHEDULE };
static Screen g_screen = SCREEN_PICKER;

/* Overlay room list on top of the schedule. */
static bool g_menuOpen = false;

/* Millis when the view wandered off the home room; 0 when at home. */
static uint32_t g_awaySince = 0;
static const uint32_t AUTO_RETURN_MS = 60000;

/* ---- NVS: remembers which door this panel is on across reboots ---- */
static Preferences g_prefs;

static void loadAssignedRoom()
{
    g_prefs.begin("doorpanel", true);
    String saved = g_prefs.getString("roomId", "");
    g_prefs.end();
    strlcpy(g_homeRoomId, saved.c_str(), sizeof(g_homeRoomId));
}

static void saveAssignedRoom(const char *id)
{
    g_prefs.begin("doorpanel", false);
    g_prefs.putString("roomId", id);
    g_prefs.end();
    strlcpy(g_homeRoomId, id, sizeof(g_homeRoomId));
}

static void clearAssignedRoom()
{
    g_prefs.begin("doorpanel", false);
    g_prefs.remove("roomId");
    g_prefs.end();
    g_homeRoomId[0] = '\0';
}

/* Server clock, carried forward locally between polls. */
static int g_serverNowMin = 0;
static uint32_t g_syncMillis = 0;

static int localNowMin()
{
    if (!g_haveData) return 0;
    uint32_t elapsed = (millis() - g_syncMillis) / 60000UL;
    return (g_serverNowMin + (int)elapsed) % 1440;
}

/* ========================= CH422G backlight ========================= */
/*
 * The backlight, the LCD reset and the touch reset all hang off a CH422G I/O expander on I2C,
 * not off GPIOs. The chip cannot be read back, so the output byte is shadowed here -- writing a
 * bare value would drop the reset lines along with the backlight.
 *
 * Register addresses are the 7-bit forms of Waveshare's published ones:
 *   WR_SET 0x48 -> 0x24   (mode: enable IO outputs)
 *   WR_IO  0x70 -> 0x38   (the output byte)
 */
static const uint8_t CH422G_MODE_ADDR = 0x24;
static const uint8_t CH422G_IO_ADDR = 0x38;
static uint8_t g_exioShadow = 0x00;

static void ch422gWrite(uint8_t addr, uint8_t value)
{
    Wire.beginTransmission(addr);
    Wire.write(value);
    Wire.endTransmission();
}

static void ch422gBegin()
{
    Wire.begin(8, 9, 400000); /* SDA 8, SCL 9 — NOT 19/20, those are native USB */
    delay(20);
    ch422gWrite(CH422G_MODE_ADDR, 0x01); /* IO pins as outputs */
    delay(10);
    /* All high: backlight on, LCD and touch resets released. */
    g_exioShadow = 0x3F;
    ch422gWrite(CH422G_IO_ADDR, g_exioShadow);
    delay(20);
}

static void backlight(bool on)
{
    if (on) g_exioShadow |= (1 << 2);   /* EXIO2 */
    else    g_exioShadow &= ~(1 << 2);
    ch422gWrite(CH422G_IO_ADDR, g_exioShadow);
}

/* ========================= drawing helpers ========================= */

static void drawLogo(int x, int y, int h)
{
    /* The Autopilot mark, straight from autopilot-logo-white.svg:
       outer triangle (0,40)(16,0)(32,40), with the notch (8,40)(16,16)(24,40) punched out.
       Drawn geometrically so there is no image to flash. */
    float s = (float)h / 40.0f;
    lcd.fillTriangle(x, y + h, x + (int)(16 * s), y, x + (int)(32 * s), y + h, C_TEXT);
    lcd.fillTriangle(x + (int)(8 * s), y + h, x + (int)(16 * s), y + (int)(16 * s),
                     x + (int)(24 * s), y + h, C_TOPBAR);
}

static void textAt(int x, int y, const char *s, uint16_t colour, const lgfx::IFont *font,
                   float size = 1.0f)
{
    lcd.setFont(font);
    lcd.setTextSize(size);
    lcd.setTextColor(colour);
    lcd.setTextDatum(textdatum_t::top_left);
    lcd.drawString(s, x, y);
}

static void textRight(int x, int y, const char *s, uint16_t colour, const lgfx::IFont *font,
                      float size = 1.0f)
{
    lcd.setFont(font);
    lcd.setTextSize(size);
    lcd.setTextColor(colour);
    lcd.setTextDatum(textdatum_t::top_right);
    lcd.drawString(s, x, y);
}

/** Truncates with an ellipsis so a long tenant name cannot run off the panel. */
static void textClipped(int x, int y, const char *s, int maxW, uint16_t colour,
                        const lgfx::IFont *font, float size = 1.0f)
{
    lcd.setFont(font);
    lcd.setTextSize(size);
    if (lcd.textWidth(s) <= maxW) {
        textAt(x, y, s, colour, font, size);
        return;
    }
    char buf[64];
    strlcpy(buf, s, sizeof(buf));
    int len = strlen(buf);
    while (len > 1) {
        buf[--len] = '\0';
        char probe[68];
        snprintf(probe, sizeof(probe), "%s…", buf);
        if (lcd.textWidth(probe) <= maxW) {
            textAt(x, y, probe, colour, font, size);
            return;
        }
    }
    textAt(x, y, "…", colour, font, size);
}

static void drawBadge(int rightX, int y, const char *label, uint16_t bg, uint16_t fg)
{
    lcd.setFont(&fonts::FreeSansBold9pt7b);
    lcd.setTextSize(1.0f);
    int w = lcd.textWidth(label) + 20;
    int h = 24;
    int x = rightX - w;
    lcd.fillRoundRect(x, y, w, h, h / 2, bg);
    lcd.setTextColor(fg);
    lcd.setTextDatum(textdatum_t::middle_center);
    lcd.drawString(label, x + w / 2, y + h / 2);
}

/* ========================= screen sections ========================= */

static void drawTopBar()
{
    lcd.fillRect(0, 0, SCREEN_W, TOPBAR_H, C_TOPBAR);
    lcd.drawFastHLine(0, TOPBAR_H - 1, SCREEN_W, C_HAIR);

    drawLogo(28, 18, 26);
    textAt(60, 22, "AUTOPILOT", C_TEXT, &fonts::FreeSansBold12pt7b);

    if (g_state.propertyName[0]) {
        textAt(188, 24, "|", C_FAINT, &fonts::FreeSans9pt7b);
        textClipped(204, 24, g_state.propertyName, 360, C_DIM, &fonts::FreeSans12pt7b);
    }

    /* ROOMS tap target — keep in step with headerRoomsHit(). */
    if (g_screen == SCREEN_SCHEDULE && g_roomCount > 1) {
        lcd.fillRoundRect(SCREEN_W - 230, 16, 110, 30, 8, C_ROWBG);
        textAt(SCREEN_W - 212, 23, "ROOMS", C_DIM, &fonts::FreeSansBold9pt7b);
    }

    bool live = g_failures == 0;
    lcd.fillCircle(SCREEN_W - 104, TOPBAR_H / 2, 4, live ? C_FREE : C_BUSY);
    textAt(SCREEN_W - 92, 24, live ? "Live" : "Offline", C_FAINT, &fonts::FreeSans9pt7b);
}

static void drawLeftPanel()
{
    lcd.fillRect(0, TOPBAR_H, LEFT_W, SCREEN_H - TOPBAR_H, C_BG_LEFT);
    lcd.drawFastVLine(LEFT_W - 1, TOPBAR_H, SCREEN_H - TOPBAR_H, C_HAIR);

    const int x = 24;
    const int w = LEFT_W - 48;

    /* Says plainly that this is not the room the panel is mounted outside. */
    int nameY = 86;
    if (g_awaySince) {
        lcd.fillRoundRect(x, 74, w, 26, 6, C_ROWBG);
        textAt(x + 10, 79, "VIEWING ANOTHER ROOM", C_NEXT, &fonts::FreeSansBold9pt7b);
        nameY = 110;
    }

    textClipped(x, nameY, g_state.roomName, w, C_TEXT, &fonts::FreeSansBold24pt7b);
    if (g_state.metaLine[0]) {
        textClipped(x, nameY + 42, g_state.metaLine, w, C_FAINT, &fonts::FreeSans9pt7b);
    }

    /* Status pill */
    const int pillY = 162;
    const int pillH = 48;
    lcd.fillRoundRect(x, pillY, w, pillH, 12, g_state.busy ? C_BUSY : C_FREE_SOFT);
    lcd.fillCircle(x + 20, pillY + pillH / 2, 5, g_state.busy ? C_INK : C_FREE);
    textAt(x + 34, pillY + 14, g_state.busy ? "IN USE" : "AVAILABLE",
           g_state.busy ? C_INK : C_FREE, &fonts::FreeSansBold12pt7b);

    char rightLabel[24] = "";
    if (g_state.busy && g_state.hasCurrent) {
        snprintf(rightLabel, sizeof(rightLabel), "%d min left", g_state.curEndsInMin);
    } else if (g_state.freeForMin > 0) {
        snprintf(rightLabel, sizeof(rightLabel), "%d min free", g_state.freeForMin);
    } else {
        strlcpy(rightLabel, "rest of day", sizeof(rightLabel));
    }
    textRight(x + w - 14, pillY + 17, rightLabel, g_state.busy ? C_INK : C_FREE,
              &fonts::FreeSans9pt7b);

    /* Who has it, or what is next */
    if (g_state.busy && g_state.hasCurrent) {
        textAt(x, 230, "BOOKED BY", C_FAINT, &fonts::FreeSans9pt7b);
        textClipped(x, 252, g_state.curBookedBy, w, C_TEXT, &fonts::FreeSansBold18pt7b);

        /* Company and note each only take a line when the booking actually carries one. */
        int y = 288;
        if (g_state.curCompany[0]) {
            textClipped(x, y, g_state.curCompany, w, C_DIM, &fonts::FreeSans12pt7b);
            y += 26;
        }
        if (g_state.curComment[0]) {
            textClipped(x, y, g_state.curComment, w, C_DIM, &fonts::FreeSans9pt7b);
            y += 22;
        }

        char range[20];
        snprintf(range, sizeof(range), "%s to %s", g_state.curStart, g_state.curEnd);
        textAt(x, y, range, C_DIM, &fonts::FreeSans12pt7b);

        /* Progress through the meeting */
        const int barY = y + 32;
        lcd.fillRoundRect(x, barY, w, 7, 3, C_HAIR);
        int filled = (w * g_state.curPct) / 100;
        if (filled > 0) lcd.fillRoundRect(x, barY, filled, 7, 3, C_BUSY);

        textAt(x, barY + 14, g_state.curStart, C_FAINT, &fonts::FreeSans9pt7b);
        textRight(x + w, barY + 14, g_state.curEnd, C_FAINT, &fonts::FreeSans9pt7b);
    } else {
        textAt(x, 236, "FREE UNTIL", C_FAINT, &fonts::FreeSans9pt7b);
        textAt(x, 258, g_state.hasNext ? g_state.nextStart : "End of day", C_TEXT,
               &fonts::FreeSansBold18pt7b);
        if (g_state.hasNext) {
            char then[64];
            snprintf(then, sizeof(then), "Then %s", g_state.nextBookedBy);
            textClipped(x, 300, then, w, C_DIM, &fonts::FreeSans12pt7b);
            if (g_state.nextCompany[0]) {
                textClipped(x, 324, g_state.nextCompany, w, C_FAINT, &fonts::FreeSans9pt7b);
            }
        }
    }

    textAt(x, SCREEN_H - 44, "Book in the Autopilot app", C_FAINT, &fonts::FreeSans9pt7b);
}

static void drawClock()
{
    char buf[8];
    int m = localNowMin();
    snprintf(buf, sizeof(buf), "%02d:%02d", m / 60, m % 60);

    /* Repaint only the clock's own box so the minute tick costs nothing. */
    lcd.fillRect(SCREEN_W - 190, 74, 162, 48, C_BG_RIGHT);
    textRight(SCREEN_W - 28, 74, buf, C_TEXT, &fonts::FreeSansBold24pt7b, 1.3f);
    g_lastDrawnMin = m;
}

static void drawRow(const Row &row, int y)
{
    const int x = 348;
    const int w = SCREEN_W - 28 - x;

    bool isNow = !row.isFree && row.state == 1;
    bool isDone = !row.isFree && row.state == 0;

    lcd.fillRoundRect(x, y, w, ROW_H, 8, isNow ? C_BUSY_SOFT : C_ROWBG);
    if (isNow) lcd.fillRect(x, y + 4, 3, ROW_H - 8, C_BUSY);

    uint16_t timeCol = isNow ? C_BUSY : (row.isFree ? C_FREE : (isDone ? C_FAINT : C_DIM));
    uint16_t titleCol = row.isFree ? C_FREE : (isDone ? C_FAINT : C_TEXT);

    /* Time, stacked on two lines so long tenant names get the width. */
    char line1[10];
    snprintf(line1, sizeof(line1), "%s to", row.start);
    textAt(x + 14, y + 6, line1, timeCol, &fonts::FreeSansBold9pt7b);
    textAt(x + 14, y + 24, row.end, timeCol, &fonts::FreeSansBold9pt7b);

    int titleX = x + 88;
    int titleMax = w - 88 - 110;

    /* With a company or a note, the name moves up to make room for a second line. */
    if (row.sub[0]) {
        textClipped(titleX, y + 5, row.text, titleMax, titleCol, &fonts::FreeSansBold12pt7b);
        textClipped(titleX, y + 27, row.sub, titleMax, isDone ? C_FAINT : C_DIM,
                    &fonts::FreeSans9pt7b);
    } else {
        textClipped(titleX, y + 13, row.text, titleMax, titleCol, &fonts::FreeSansBold12pt7b);
    }

    if (isNow) {
        drawBadge(x + w - 14, y + 11, "NOW", C_BUSY, C_INK);
    } else if (!row.isFree && row.state == 2) {
        drawBadge(x + w - 14, y + 11, "UP NEXT", C_NEXT, C_TEXT);
    } else if (isDone) {
        textRight(x + w - 14, y + 15, "Done", C_FAINT, &fonts::FreeSans9pt7b);
    }
}

static void drawRightPanel()
{
    lcd.fillRect(LEFT_W, TOPBAR_H, SCREEN_W - LEFT_W, SCREEN_H - TOPBAR_H, C_BG_RIGHT);

    textAt(348, 80, "TODAY", C_FAINT, &fonts::FreeSans9pt7b);
    textAt(348, 100, g_state.dateLabel, C_TEXT, &fonts::FreeSansBold18pt7b);
    drawClock();

    if (g_state.rowCount == 0) {
        textAt(348, 240, "Nothing booked today", C_FAINT, &fonts::FreeSansBold18pt7b);
        textAt(348, 276, "The room is free all day", C_FAINT, &fonts::FreeSans12pt7b);
        return;
    }

    for (uint8_t i = 0; i < g_state.rowCount; i++) {
        drawRow(g_state.rows[i], ROWS_TOP + i * ROW_PITCH);
    }
}

static void drawAll()
{
    drawTopBar();
    drawLeftPanel();
    drawRightPanel();
}

static void drawMessage(const char *title, const char *detail)
{
    lcd.fillScreen(C_BG_RIGHT);
    drawTopBar();
    lcd.setTextDatum(textdatum_t::middle_center);
    lcd.setFont(&fonts::FreeSansBold18pt7b);
    lcd.setTextSize(1.0f);
    lcd.setTextColor(C_TEXT);
    lcd.drawString(title, SCREEN_W / 2, SCREEN_H / 2 - 16);
    lcd.setFont(&fonts::FreeSans12pt7b);
    lcd.setTextColor(C_DIM);
    lcd.drawString(detail, SCREEN_W / 2, SCREEN_H / 2 + 22);
}

/* ========================= network ========================= */

static void connectWifi()
{
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    uint32_t startedAt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
        delay(250);
    }
}

/** One GET, parsed into `doc`. Shared by the schedule feed and the room list. */
static bool httpGetJson(const char *url, JsonDocument &doc)
{
    if (WiFi.status() != WL_CONNECTED) {
        connectWifi();
        if (WiFi.status() != WL_CONNECTED) return false;
    }

    WiFiClientSecure client;
    /*
     * The feed is public and read-only and the panel sends no credentials, so an unverified
     * TLS session leaks nothing. It does mean someone on the network could serve a FAKE
     * schedule. When you want that closed too, replace this with:
     *     client.setCACert(YOUR_ROOT_CA_PEM);
     */
    client.setInsecure();
    client.setTimeout(10);

    HTTPClient http;
    if (!http.begin(client, url)) return false;
    http.setTimeout(10000);

    int code = http.GET();
    if (code != 200) {
        http.end();
        return false;
    }

    DeserializationError err = deserializeJson(doc, http.getStream());
    http.end();
    return !err;
}

/** Loads the property's rooms for the picker. Called once at boot. */
static bool fetchRooms()
{
    char url[192];
    snprintf(url, sizeof(url), "%s/api/public/property-display/%s", SERVER_BASE, PROPERTY_ID);

    JsonDocument doc;
    if (!httpGetJson(url, doc)) return false;

    strlcpy(g_propertyName, doc["property"]["name"] | "", sizeof(g_propertyName));

    g_roomCount = 0;
    for (JsonObject r : doc["rooms"].as<JsonArray>()) {
        if (g_roomCount >= MAX_PICKER_ROOMS) break;
        PickerRoom &pr = g_rooms[g_roomCount];
        strlcpy(pr.id, r["id"] | "", sizeof(pr.id));
        strlcpy(pr.name, r["name"] | "", sizeof(pr.name));
        strlcpy(pr.meta, r["meta_line"] | "", sizeof(pr.meta));
        if (pr.id[0]) g_roomCount++;
    }

    return g_roomCount > 0;
}

static bool fetchState(const char *roomId)
{
    char url[192];
    snprintf(url, sizeof(url), "%s/api/public/room-display/%s", SERVER_BASE, roomId);

    JsonDocument doc;
    if (!httpGetJson(url, doc)) return false;

    /* Build into a local copy so a half-parsed payload never reaches the screen. */
    RoomState s = {};
    s.freeForMin = -1;

    JsonObject room = doc["room"];
    if (room.isNull()) return false;

    strlcpy(s.roomName, room["name"] | "", sizeof(s.roomName));
    strlcpy(s.metaLine, room["meta_line"] | "", sizeof(s.metaLine));
    strlcpy(s.propertyName, room["property_name"] | "", sizeof(s.propertyName));
    if (s.roomName[0] == '\0') return false;

    strlcpy(s.dateLabel, doc["date_label"] | "", sizeof(s.dateLabel));
    s.nowMin = doc["now_min"] | 0;
    s.busy = strcmp(doc["state"] | "free", "busy") == 0;

    JsonObject cur = doc["current"];
    if (!cur.isNull()) {
        s.hasCurrent = true;
        strlcpy(s.curBookedBy, cur["booked_by"] | "Reserved", sizeof(s.curBookedBy));
        /* company and comment are null when absent; "" then means "draw nothing". */
        strlcpy(s.curCompany, cur["company"] | "", sizeof(s.curCompany));
        strlcpy(s.curComment, cur["comment"] | "", sizeof(s.curComment));
        strlcpy(s.curStart, cur["start"] | "", sizeof(s.curStart));
        strlcpy(s.curEnd, cur["end"] | "", sizeof(s.curEnd));
        s.curEndsInMin = cur["ends_in_min"] | 0;
        s.curPct = cur["elapsed_pct"] | 0;
    }

    JsonObject nxt = doc["next"];
    if (!nxt.isNull()) {
        s.hasNext = true;
        strlcpy(s.nextBookedBy, nxt["booked_by"] | "Reserved", sizeof(s.nextBookedBy));
        strlcpy(s.nextCompany, nxt["company"] | "", sizeof(s.nextCompany));
        strlcpy(s.nextStart, nxt["start"] | "", sizeof(s.nextStart));
    }

    if (!doc["free_for_min"].isNull()) s.freeForMin = doc["free_for_min"];

    JsonArray agenda = doc["agenda"];
    for (JsonObject r : agenda) {
        if (s.rowCount >= MAX_ROWS) break;
        Row &row = s.rows[s.rowCount];
        bool isFree = strcmp(r["kind"] | "booking", "free") == 0;
        row.isFree = isFree;
        strlcpy(row.start, r["start"] | "", sizeof(row.start));
        strlcpy(row.end, r["end"] | "", sizeof(row.end));
        strlcpy(row.text, isFree ? (r["label"] | "Free") : (r["booked_by"] | "Reserved"),
                sizeof(row.text));

        /* Second line: company, the booker's note, or both. Empty when neither is set. */
        row.sub[0] = '\0';
        if (!isFree) {
            const char *company = r["company"] | "";
            const char *note = r["comment"] | "";
            if (company[0] && note[0]) {
                snprintf(row.sub, sizeof(row.sub), "%s - %s", company, note);
            } else if (company[0]) {
                strlcpy(row.sub, company, sizeof(row.sub));
            } else if (note[0]) {
                strlcpy(row.sub, note, sizeof(row.sub));
            }
        }

        const char *st = r["state"] | "upcoming";
        if (isFree) row.state = 3;
        else if (!strcmp(st, "done")) row.state = 0;
        else if (!strcmp(st, "now")) row.state = 1;
        else if (!strcmp(st, "next")) row.state = 2;
        else row.state = 3;

        s.rowCount++;
    }

    g_state = s;
    g_serverNowMin = s.nowMin;
    g_syncMillis = millis();
    g_haveData = true;
    return true;
}

/* ========================= picker screen ========================= */

/* Three columns of room cards. Geometry is shared with the hit test below. */
static const int PICK_COLS = 3;
static const int PICK_X0 = 40;
static const int PICK_Y0 = 170;
static const int PICK_W = 300;
static const int PICK_H = 86;
static const int PICK_GAP = 14;

static void pickerCardRect(uint8_t i, int &x, int &y)
{
    x = PICK_X0 + (i % PICK_COLS) * (PICK_W + PICK_GAP);
    y = PICK_Y0 + (i / PICK_COLS) * (PICK_H + PICK_GAP);
}

static void drawPicker()
{
    lcd.fillScreen(C_BG_RIGHT);
    drawTopBar();

    textAt(40, 90, "Which room is this panel outside?", C_TEXT, &fonts::FreeSansBold18pt7b);
    textAt(40, 132, "Tap once. This panel remembers it.", C_FAINT, &fonts::FreeSans12pt7b);

    if (g_roomCount == 0) {
        textAt(40, 220, "No rooms found for this property", C_FAINT, &fonts::FreeSansBold12pt7b);
        textAt(40, 250, "Check PROPERTY_ID in the sketch", C_FAINT, &fonts::FreeSans9pt7b);
        return;
    }

    for (uint8_t i = 0; i < g_roomCount; i++) {
        int x, y;
        pickerCardRect(i, x, y);
        bool isHome = g_homeRoomId[0] && strcmp(g_rooms[i].id, g_homeRoomId) == 0;

        lcd.fillRoundRect(x, y, PICK_W, PICK_H, 12, isHome ? C_BUSY_SOFT : C_BG_LEFT);
        if (isHome) lcd.drawRoundRect(x, y, PICK_W, PICK_H, 12, C_BUSY);

        textClipped(x + 18, y + 16, g_rooms[i].name, PICK_W - 36, C_TEXT,
                    &fonts::FreeSansBold12pt7b);
        textClipped(x + 18, y + 50, g_rooms[i].meta, PICK_W - 36, C_FAINT, &fonts::FreeSans9pt7b);
    }
}

/** Which card a tap landed on, or -1. */
static int pickerHit(int tx, int ty)
{
    for (uint8_t i = 0; i < g_roomCount; i++) {
        int x, y;
        pickerCardRect(i, x, y);
        if (tx >= x && tx < x + PICK_W && ty >= y && ty < y + PICK_H) return i;
    }
    return -1;
}

/* ========================= room menu overlay ========================= */

static const int MENU_X = 660;
static const int MENU_Y = TOPBAR_H + 8;
static const int MENU_W = 330;
static const int MENU_ROW_H = 46;

static void drawMenu()
{
    int h = g_roomCount * MENU_ROW_H + 8;
    lcd.fillRoundRect(MENU_X, MENU_Y, MENU_W, h, 12, C_BG_LEFT);
    lcd.drawRoundRect(MENU_X, MENU_Y, MENU_W, h, 12, C_HAIR);

    for (uint8_t i = 0; i < g_roomCount; i++) {
        int y = MENU_Y + 4 + i * MENU_ROW_H;
        bool isCurrent = strcmp(g_rooms[i].id, g_viewRoomId) == 0;
        bool isHome = strcmp(g_rooms[i].id, g_homeRoomId) == 0;

        if (isCurrent) lcd.fillRect(MENU_X + 4, y, MENU_W - 8, MENU_ROW_H - 2, C_ROWBG);
        textClipped(MENU_X + 16, y + 13, g_rooms[i].name, MENU_W - 110,
                    isCurrent ? C_TEXT : C_DIM, &fonts::FreeSansBold12pt7b);
        if (isHome) {
            textRight(MENU_X + MENU_W - 16, y + 16, "THIS DOOR", C_FAINT, &fonts::FreeSans9pt7b);
        }
    }
}

static int menuHit(int tx, int ty)
{
    if (tx < MENU_X || tx > MENU_X + MENU_W) return -1;
    for (uint8_t i = 0; i < g_roomCount; i++) {
        int y = MENU_Y + 4 + i * MENU_ROW_H;
        if (ty >= y && ty < y + MENU_ROW_H) return i;
    }
    return -1;
}

/** The ROOMS tap target in the header. */
static bool headerRoomsHit(int tx, int ty)
{
    return ty < TOPBAR_H && tx > SCREEN_W - 230 && tx < SCREEN_W - 120;
}

/* ========================= arduino ========================= */

static void showRoom(const char *roomId)
{
    strlcpy(g_viewRoomId, roomId, sizeof(g_viewRoomId));
    g_awaySince = strcmp(roomId, g_homeRoomId) == 0 ? 0 : millis();

    if (fetchState(roomId)) {
        g_failures = 0;
        g_screen = SCREEN_SCHEDULE;
        lcd.fillScreen(C_BG_RIGHT);
        drawAll();
    } else {
        drawMessage("Cannot reach server", "Check SERVER_BASE and the network");
    }
}

void setup()
{
    Serial.begin(115200);

    ch422gBegin();

    initPalette();

    lcd.init();
    lcd.setRotation(0);
    lcd.fillScreen(C_BG_RIGHT);

    /* Backlight comes up only once there is a frame to look at. */
    backlight(true);

    loadAssignedRoom();

    drawMessage("Connecting", WIFI_SSID);
    connectWifi();

    if (WiFi.status() != WL_CONNECTED) {
        drawMessage("No Wi-Fi", "Check the SSID and password in the sketch");
        return;
    }

    drawMessage("Loading rooms", SERVER_BASE);
    if (!fetchRooms()) {
        drawMessage("Cannot reach server", "Check SERVER_BASE and PROPERTY_ID");
        return;
    }

    /* A room assigned on a previous boot may since have been removed from the property. */
    bool homeStillExists = false;
    for (uint8_t i = 0; i < g_roomCount; i++) {
        if (strcmp(g_rooms[i].id, g_homeRoomId) == 0) homeStillExists = true;
    }

    if (g_homeRoomId[0] && homeStillExists) {
        showRoom(g_homeRoomId);
    } else {
        if (g_homeRoomId[0]) clearAssignedRoom();
        g_screen = SCREEN_PICKER;
        drawPicker();
    }
}

/**
 * One tap, debounced to the release edge so a held finger does not fire repeatedly.
 * Returns true and fills x/y once per touch, plus how long it was held.
 */
static bool readTap(int &x, int &y, uint32_t &heldMs)
{
    static bool wasDown = false;
    static uint32_t downAt = 0;
    static int lastX = 0, lastY = 0;

    uint16_t tx, ty;
    bool down = lcd.getTouch(&tx, &ty);

    if (down) {
        if (!wasDown) downAt = millis();
        wasDown = true;
        lastX = tx;
        lastY = ty;
        return false;
    }

    if (wasDown) {
        wasDown = false;
        x = lastX;
        y = lastY;
        heldMs = millis() - downAt;
        return true;
    }

    return false;
}

void loop()
{
    static uint32_t lastPoll = 0;

    /* ---- touch ---- */
    int tx, ty;
    uint32_t held;
    if (readTap(tx, ty, held)) {
        if (g_screen == SCREEN_PICKER) {
            int hit = pickerHit(tx, ty);
            if (hit >= 0) {
                saveAssignedRoom(g_rooms[hit].id);
                showRoom(g_rooms[hit].id);
            }
        } else if (g_menuOpen) {
            int hit = menuHit(tx, ty);
            g_menuOpen = false;
            if (hit >= 0) {
                showRoom(g_rooms[hit].id);
            } else {
                /* Tapped away: close the overlay by repainting underneath. */
                lcd.fillScreen(C_BG_RIGHT);
                drawAll();
            }
        } else if (headerRoomsHit(tx, ty)) {
            /* A long hold re-assigns which door this panel is on. */
            if (held >= 3000) {
                clearAssignedRoom();
                g_screen = SCREEN_PICKER;
                drawPicker();
            } else if (g_roomCount > 1) {
                g_menuOpen = true;
                drawMenu();
            }
        }
    }

    if (g_screen != SCREEN_SCHEDULE) {
        delay(50);
        return;
    }

    /* Cheap minute tick: repaint just the clock between polls. */
    if (g_haveData && !g_menuOpen && localNowMin() != g_lastDrawnMin) {
        drawClock();
    }

    /* A panel left showing another room misinforms everyone walking past. Go home. */
    if (g_awaySince && !g_menuOpen && millis() - g_awaySince >= AUTO_RETURN_MS) {
        showRoom(g_homeRoomId);
    }

    if (millis() - lastPoll >= POLL_MS) {
        lastPoll = millis();

        if (fetchState(g_viewRoomId)) {
            g_failures = 0;
            if (!g_menuOpen) drawAll();
        } else if (++g_failures >= 4) {
            /* Several misses running: say so rather than leave a stale day on the wall. */
            if (g_haveData) {
                drawTopBar();
            } else {
                drawMessage("Cannot reach server", "Retrying…");
            }
        }
    }

    delay(50);
}
