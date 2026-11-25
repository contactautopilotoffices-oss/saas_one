#pragma once

/**
 * LovyanGFX panel definition for the Waveshare ESP32-S3-Touch-LCD-7B (7", 1024x600, RGB565).
 *
 * ---------------------------------------------------------------------------
 * VERIFY BEFORE THE FIRST FLASH
 * ---------------------------------------------------------------------------
 * These pins are Waveshare's published map for the 7" ESP32-S3 panels. Waveshare revises these
 * boards, and the 7 / 7B / 7C variants differ. If the screen stays black or shows garbage,
 * diff this against your board's own wiki page before changing anything else -- a wrong RGB pin
 * shows as a scrambled panel, never as a crash.
 *
 *   Wiki: https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-7B
 *
 * Note what is NOT here: the backlight. On these boards it hangs off the CH422G I/O expander
 * (EXIO2), not a GPIO, which is why the sketch drives it over I2C instead. Guides that tell you
 * to set "backlight GPIO 2" are misreading EXIO2 as GPIO2.
 *
 * Also note GPIO19/20 are deliberately absent: on the ESP32-S3 those are the native USB D-/D+
 * lines. Any guide that puts touch I2C on 19/20 breaks the USB port.
 */

#define LGFX_USE_V1
#include <LovyanGFX.hpp>

class LGFX_Waveshare7B : public lgfx::LGFX_Device {
    lgfx::Bus_RGB _bus;
    lgfx::Panel_RGB _panel;
    lgfx::Touch_GT911 _touch;

public:
    LGFX_Waveshare7B(void)
    {
        {
            auto cfg = _panel.config();
            cfg.memory_width = 1024;
            cfg.memory_height = 600;
            cfg.panel_width = 1024;
            cfg.panel_height = 600;
            cfg.offset_x = 0;
            cfg.offset_y = 0;
            _panel.config(cfg);
        }

        {
            /* The 1024x600x16bpp framebuffer is ~1.2MB, so it must live in PSRAM.
               This is why the board must be set to OPI PSRAM in the IDE. */
            auto cfg = _panel.config_detail();
            cfg.use_psram = 1;
            _panel.config_detail(cfg);
        }

        {
            auto cfg = _bus.config();
            cfg.panel = &_panel;

            /* RGB565, LSB first: d0-d4 blue, d5-d10 green, d11-d15 red. */
            cfg.pin_d0 = 14; /* B0 */
            cfg.pin_d1 = 38; /* B1 */
            cfg.pin_d2 = 18; /* B2 */
            cfg.pin_d3 = 17; /* B3 */
            cfg.pin_d4 = 10; /* B4 */

            cfg.pin_d5 = 39; /* G0 */
            cfg.pin_d6 = 0;  /* G1 */
            cfg.pin_d7 = 45; /* G2 */
            cfg.pin_d8 = 48; /* G3 */
            cfg.pin_d9 = 47; /* G4 */
            cfg.pin_d10 = 21; /* G5 */

            cfg.pin_d11 = 1;  /* R0 */
            cfg.pin_d12 = 2;  /* R1 */
            cfg.pin_d13 = 42; /* R2 */
            cfg.pin_d14 = 41; /* R3 */
            cfg.pin_d15 = 40; /* R4 */

            cfg.pin_henable = 5;
            cfg.pin_vsync = 3;
            cfg.pin_hsync = 46;
            cfg.pin_pclk = 7;
            cfg.freq_write = 16000000;

            cfg.hsync_polarity = 0;
            cfg.hsync_front_porch = 160;
            cfg.hsync_pulse_width = 10;
            cfg.hsync_back_porch = 160;

            cfg.vsync_polarity = 0;
            cfg.vsync_front_porch = 12;
            cfg.vsync_pulse_width = 10;
            cfg.vsync_back_porch = 23;

            cfg.pclk_active_neg = 1;
            cfg.de_idle_high = 0;
            cfg.pclk_idle_high = 0;

            _bus.config(cfg);
        }

        _panel.setBus(&_bus);

        {
            /*
             * GT911 capacitive touch, 5-point, on the same I2C pins as the CH422G expander.
             *
             * The sketch drives the CH422G with Arduino's Wire on port 0, so the touch gets
             * port 1 on the same two pins. Electrically that is one bus with two controllers:
             * fine here because the expander is only written at boot and on a backlight change,
             * while touch is polled. IF TOUCH NEVER RESPONDS, this is the first thing to try:
             * move it to i2c_port 0 and set bus_shared = true.
             *
             * Note the pins: 8 and 9. Not 19/20 — those are the ESP32-S3's native USB D-/D+.
             */
            auto cfg = _touch.config();
            cfg.x_min = 0;
            cfg.x_max = 1023;
            cfg.y_min = 0;
            cfg.y_max = 599;
            cfg.pin_int = -1; /* polled; INT runs through the expander on this board */
            cfg.pin_rst = -1;
            cfg.bus_shared = false;
            cfg.offset_rotation = 0;
            cfg.i2c_port = 1;
            cfg.pin_sda = 8;
            cfg.pin_scl = 9;
            cfg.freq = 400000;
            /* GT911 answers on 0x5D or 0x14 depending on how it was strapped at reset. */
            cfg.i2c_addr = 0x5D;
            _touch.config(cfg);
            _panel.setTouch(&_touch);
        }

        setPanel(&_panel);
    }
};
