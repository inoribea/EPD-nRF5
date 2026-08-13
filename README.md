# EPD-nRF5

E-paper display calendar firmware with support for Chinese lunar calendar, solar terms, and holiday schedules. It can also transmit images via Bluetooth to the e-paper display for use as a digital photo frame. The calendar interface is adapted for common 4.2-inch and 7.5-inch e-paper resolutions, and the same firmware can drive different screen sizes (screen size and driver can be switched online through the web interface).

Supported MCUs: `nrf51822` / `nrf51802` / `nrf52811` / `nrf52810`. For e-paper displays, it supports common `UC81xx` / `SSD16xx` series drivers (black & white / 3-color / 4-color). It also supports custom pin mapping from the e-paper display to the MCU, sleep/wake functionality (NFC / wireless charger), and Bluetooth OTA firmware updates.

![](docs/images/3.jpg)

## Web Interface

This project includes a local web interface implemented with Web Bluetooth API. Open `html/index.html` directly in Chrome or Edge on your computer to connect to and transfer images to the display.

![](docs/images/0.jpg)

The local web interface supports multiple image dithering algorithms and allows you to doodle on images and add text. In addition to displaying images as a digital photo frame, it can also switch to calendar mode to display monthly calendars, Chinese lunar calendar solar terms, holidays, and work schedule adjustments.

## AIUsage E-Ink Dashboard

The local image-transfer page can render an AIUsage dashboard to the display and refresh it on a timer. The browser fetches the usage data, draws the dashboard onto the existing image canvas, dithers it for the selected panel, and sends it through the existing Web Bluetooth image-transfer path. No firmware changes are required for this feature.

### Requirements

- A Chromium-based browser with Web Bluetooth support: Chrome or Edge on desktop.
- The e-paper device must already be running this project's image-transfer firmware.
- [AIUsage](https://github.com/juliantanx/aiusage) installed locally and its dashboard server running:

  ```bash
  aiusage serve
  ```

- Node.js 20 or newer for the OpenChamber quota bridge.
- OpenChamber running locally on `127.0.0.1:4096` with OpenCode Go and Kimi Code quota access configured.

### Start the Local Services

Start AIUsage first. It provides the local usage endpoints on port `3847`:

```bash
aiusage serve
```

In a second terminal, start the loopback-only OpenChamber quota bridge from the repository root:

```bash
node tools/openchamber-quota-bridge.mjs
```

The bridge listens only on `127.0.0.1:8788`. It reads the OpenChamber desktop client credential locally, queries OpenChamber's OpenCode Go monthly and Kimi Code weekly quota routes, and exposes only each quota's `usedPercent` and reset time to the dashboard. It never sends a credential to the browser or stores one in this repository.

### Open the Dashboard and Send an Image

1. Open **only** the local file [`html/index.html`](html/index.html) in Chrome or Edge.
2. Click **Connect** and select the e-paper device from the browser picker.
3. Ensure the **Driver** dropdown matches the physical display. If the device reports an unsupported driver ID, select the model that previously worked for image transfers.
4. In **AIUsage timed image transfer**, keep the default API URL unless your AIUsage server uses a different port:

   ```text
   http://localhost:3847/api/summary?range=month
   ```

5. Click **Send now** to render and transfer one dashboard image. Wait for the e-paper refresh to complete before sending another image.
6. Set the interval in minutes and click **Start timer** to repeat the same fetch, render, dither, and Bluetooth transfer automatically. Keep the browser tab open while the timer is active; browsers may throttle background tabs.

### Dashboard Content

The dashboard is optimized for black/white or black/white/red panels:

- Cost, session count, and active-day count for the selected AIUsage range.
- A daily trend chart using the latest 30 reported dates, with black dashed token usage and red solid cost usage.
- Compact Codex weekly, Kimi Code weekly, and OpenCode Go monthly quota bars. The displayed percentage and fill represent **remaining** quota, not used quota.
- Up to four models in the order returned by AIUsage for the selected range.
- A centered local render timestamp in the header.

AIUsage data is read from its local API endpoints: `/api/summary`, `/api/tokens`, `/api/cost`, `/api/models`, and `/api/quotas`. The OpenCode Go monthly quota is supplied separately by the local OpenChamber bridge because AIUsage does not provide an OpenCode Go quota provider.

### Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `AIUsage send failed: Failed to fetch` | Verify that `aiusage serve` is running and that the API URL points to `http://localhost:3847/api/summary?range=month`. |
| `OpenCode Go monthly quota` shows `UNAVAILABLE` | Start `node tools/openchamber-quota-bridge.mjs`, ensure OpenChamber is running on port `4096`, and verify that OpenCode Go quota access is configured in OpenChamber. |
| `Kimi Code weekly quota` shows `N/A` | Configure the `kimi-for-coding` provider in OpenChamber, then restart `node tools/openchamber-quota-bridge.mjs`. |
| The Driver field is empty or image transfer reports an invalid driver | Choose the correct display driver manually, then retry the transfer. |
| The device cannot be selected | Use Chrome or Edge, confirm Bluetooth is enabled, and reconnect from the local `html/index.html` page. |
| The timer stops refreshing | Keep the local dashboard page open and avoid backgrounding it for extended periods. |

## Supported Devices

[View Documentation](docs/devices.md).

## Development

[View Documentation](docs/develop.md).

## Acknowledgments

This project uses or references code from the following projects:

- [ZinggJM/GxEPD2](https://github.com/ZinggJM/GxEPD2)
- [waveshareteam/e-Paper](https://github.com/waveshareteam/e-Paper)
- [atc1441/ATC_TLSR_Paper](https://github.com/atc1441/ATC_TLSR_Paper)
