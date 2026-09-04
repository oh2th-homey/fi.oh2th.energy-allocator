# Homey SDK notes (cached)

Facts gathered from the Homey Apps SDK docs and verified against this project's
`homey app validate` / local `node_modules`. Kept here so we don't have to re-fetch.

Sources:

- Guide: <https://apps.developer.homey.app/>
- JS reference: <https://apps-sdk-v3.developer.homey.app/>
- Machine-readable dump: <https://apps.developer.homey.app/llms-full.txt>
- App Store guidelines: <https://apps.developer.homey.app/app-store/guidelines> (readme section `#1-3-readme`)

## Toolchain (this machine)

- `homey` CLI 4.4.3 at `/usr/bin/homey`.
- `homey app validate` works offline. `homey app run` needs a Homey on the LAN.
- Node 24. SDK apps are **plain JavaScript** (no TypeScript build); `@types/homey`
  is only editor tooling.

## Homey Compose

- Edit `.homeycompose/app.json` (+ the split files below); the root `app.json` is
  generated on every `validate` / `run` / `build` — never edit it.
- Capabilities: `.homeycompose/capabilities/<id>.json`.
- App-wide flow: `.homeycompose/flow/{triggers,conditions,actions}/<id>.json`.
- Per-driver files in `drivers/<id>/`:
  - `driver.compose.json` — manifest (name, class, capabilities, images, pair …).
    Folder name is the driver id; no `id` field needed.
  - `driver.settings.compose.json` — device settings schema.
  - `driver.flow.compose.json` — `{ "triggers": [...], "conditions": [...], "actions": [...] }`.
    Compose auto-adds a `device` arg **and** `"filter": "driver_id=<id>"` to every
    card, so the card is scoped to that driver and shows under the device. Two
    drivers cannot both define the same card id.
  - `pair/*.html` — custom pairing views.
  - `assets/` — `icon.svg` + `images/{small,large,xlarge}.png`.

## Icons & images

- Icons: single-colour **black on transparent** SVG, simple bold shapes, no
  gradients/opacity (Homey tints them). App + each driver need `assets/icon.svg`.
- App images PNG: 250×175 / 500×350 / 1000×700.
- Driver images PNG: 75×75 / 500×500 / 1000×1000.
- Custom capabilities with `uiComponent: "sensor"` need an `icon` (SVG path).

## Capabilities

- Custom capability JSON fields used/known-valid: `type` (`number|boolean|string|enum`),
  `title`, `units`, `decimals`, `min`, `max`, `step`, `getable`, `setable`,
  `uiComponent` (`sensor|toggle|slider|thermostat|media|color|battery|picker|ternary|button|null`),
  `uiQuickAction`, `icon`, `insightsTitleTrue/False`, `values` (enum).
  Number capabilities get Insights automatically (disable with
  `capabilitiesOptions.<id>.preventInsights`).
- **Sub-capabilities**: dot notation, e.g. `meter_power.grid`. They inherit the
  parent capability's type/unit/formatting and DON'T auto-generate Flow cards.
- `meter_power` is cumulative kWh, **always monotonic** (never signed).
- An `energy` object in `driver.compose.json` is required for real energy meters
  (bare `meter_power`, imported/exported, cumulative P1, home battery, EV, …).
  A device that only has `meter_power.<sub>` sub-capabilities and class `sensor`
  validated at `publish` level **without** an `energy` object (confirmed here).
- **Maintenance action**: add a `button.<name>` capability and configure it in
  `capabilitiesOptions`:

  ```json
  "button.reset_meter": {
    "maintenanceAction": true,
    "title": { "en": "…" },
    "desc": { "en": "…" }
  }
  ```

  Handle with `this.registerCapabilityListener('button.reset_meter', async () => { … })`.

## node-homey-api (`homey-api` npm package)

- Needs the `homey:manager:api` permission (flagged for stricter App Store review).

- ```js
  const { HomeyAPI } = require("homey-api");
  this.homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });
  const devices = await this.homeyApi.devices.getDevices(); // { [id]: Device }
  const one = await this.homeyApi.devices.getDevice({ id }); // pass `{ id }`
  ```

- `Device` shape: `.id`, `.name`, `.zoneName`, `.driverId`, `.capabilities`
  (array of ids incl. sub-caps), `.capabilitiesObj[capId] = { value, lastUpdated, title, … }`.
- Read a value: `device.capabilitiesObj?.[capId]?.value`.
- Polling `getDevices()` each interval is fine for slow meters; realtime events
  need `await api.devices.connect()` and capability instances.

## App API (`/api.js`) + settings page

- `/api.js` exports an **object** of async handlers; the function name maps to
  `<method><Name>` → `METHOD /name` (first letter of the remainder lower-cased):

  ```js
  module.exports = {
    async getMeterDevices({ homey }) { return homey.app.getMeterDevices(); }, // GET /meterDevices
    async getConfig({ homey }) { … },                                          // GET /config
    async putConfig({ homey, body }) { … },                                    // PUT /config
  };
  ```

  Handler arg: `{ homey, params, query, body }`; reach the app via `homey.app`.
  Verb prefixes: `get`→GET, `post`/`add`/`create`→POST, `put`/`update`→PUT,
  `delete`→DELETE. Avoid `set*` (not a recognised verb) — used `putConfig` here.

- Settings page (`settings/index.html`): `onHomeyReady(Homey)` → `Homey.ready()`,
  then `Homey.api('GET'|'PUT'|…, '/path', body|null, (err, result) => {})`.
  `Homey.get(key, cb)` / `Homey.set(key, value, cb)` read/write ManagerSettings.
- App side: `this.homey.settings.get/set(key)`, and
  `this.homey.settings.on('set', (key) => {})` fires on UI-side changes (also
  restart logic explicitly after our own `set`, to be safe).

## Pairing

- `driver.compose.json` `"pair"`: array of views. For "pick an existing device"
  use the built-in templates:

  ```json
  "pair": [
    { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
    { "id": "add_devices", "template": "add_devices" }
  ]
  ```

- `list_devices` calls `Driver.onPairListDevices()` → return
  `[{ name, data: { …unique immutable id… } }]`. Put the monitored device id in
  `data` so the same device can't be added twice.
- Custom views: `{ "template": "custom", "id": "...", "html": "..." }` + a file in
  `pair/`, driven by `Driver.onPair(session)` with `session.setHandler(event, fn)`.

## Flow (device-scoped) usage

- Trigger defined in `driver.flow.compose.json`:
  `this.homey.flow.getDeviceTriggerCard('<id>').trigger(device, tokens)`.
- Condition: `this.homey.flow.getConditionCard('<id>').registerRunListener(async (args) => …)`
  — `args.device` is the Homey device, plus your own args.

## README / App Store

- `README.txt` (root) = store long description: **plain text only**, no Markdown,
  no URLs, no feature/Flow lists, no changelog; 1–2 short paragraphs. Localise as
  `README.<lang>.txt` (en, nl, de, fr, it, sv, no, es, da, ru, pl, ko, ar).
- `app.json` `description` = separate catchy one-liner; must not reuse the app
  name or readme text.
- `README.md` is developer-only (GitHub); Homey ignores it.
- Changelog: `.homeychangelog.json`.
