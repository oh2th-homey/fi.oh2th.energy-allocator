# Energy Allocator — Homey App

## Status

**Implementation in progress.** v1 scaffold is built and passes
`homey app validate` at `publish` level. Not yet run on hardware.

## References

- Homey Apps SDK guide: <https://apps.developer.homey.app/>
- Homey Apps SDK v3 JavaScript reference: <https://apps-sdk-v3.developer.homey.app/>
- **Cached SDK facts / gotchas: [docs/homey-sdk-notes.md](docs/homey-sdk-notes.md)**
  — read this before touching compose files, the API, pairing, flow, or icons.

## App identity

- id: `fi.oh2th.energy-allocator`
- SDK 3, `runtime: nodejs`, `platforms: ["local"]`, `compatibility >=13.0.0`
- category: `energy`
- description: "Estimate the split of grid, solar, and battery energy a device consumes."
- Homey Compose project: edit `.homeycompose/app.json`, never the generated `app.json`.
- `README.txt` = App Store long description: plain text only (no Markdown, no URLs,
  no feature/Flow lists, no changelog), 1–2 short paragraphs. Localized as
  `README.<lang>.txt`. `app.json` `description` is a separate catchy one-liner that
  must not repeat the app name or readme text. `README.md` is developer-only
  (GitHub), not used by Homey.

## Goal

A virtual device that estimates, for one or more monitored devices, how much of the
energy each device consumes came from the **grid**, from **PV/solar**, and from the
**home battery** (battery source optional; could also be an EV/V2G charger).

Inputs: the configured `meter_power(.x)` capabilities of the grid / PV / battery
source devices, plus the `meter_power(.x)` counter(s) each monitored allocator
was paired to — one, or several summed for a summary allocator (see "Sources"
below for exact capability handling).

Outputs (per monitored device):

- `meter_power.total` (device-allocation only — grid+pv+bat combined),
  `meter_power.grid`, `meter_power.pv`, and (when battery configured)
  `meter_power.bat`
- share capabilities (`measure_grid_share`, `measure_self_sufficiency`)

Requires the `homey:manager:api` permission to enumerate and read other apps' devices.

## Homey capability semantics

- `meter_power` (kWh, cumulative) is **always monotonic non-decreasing** — never
  signed. Direction (import vs. export, charge vs. discharge) is carried by
  **separate** capabilities/sub-capabilities, not by sign.
- Allocation uses **kWh counters only** — `meter_power(.x)`. `measure_power` (W) is
  not used for allocation (kWh counters are more reliable end-to-end from source to
  consumer). It may later back a live power-breakdown capability, nothing more.
- Direction capability ids are **not standardized**. Older drivers (e.g. HomeWizard
  P1, pre-dating the standard caps) use `meter_power.consumed` /
  `meter_power.returned`; newer ones `meter_power.imported` / `meter_power.exported`.
  The user maps each role to whatever capability the chosen device exposes.

## Capability strategy

Prefer **standard** Homey capabilities (and their sub-capabilities) wherever
possible — they bring sensible defaults for icons, units, Insights and Flow
cards. Only define custom capabilities where no standard one fits.

- Energy outputs use standard `meter_power` sub-capabilities: `meter_power.total`
  (device-allocation only — the monitored counter(s)' combined total, i.e.
  exactly `grid + pv + bat`), `meter_power.grid`, `meter_power.pv`,
  `meter_power.bat`. No bare `meter_power` and no `energy` object on **either**
  driver — deliberately keeps these synthetic figures out of Homey Energy so
  they can't double-count the real meters they're derived from (a
  device-allocation device mirrors/sums other devices' own already-counted
  `meter_power`; a bare `meter_power` + `energy` object would enroll it as an
  independent consumer in the Homey Energy report, counting that consumption
  twice).
- Meter reset uses a **standard maintenance-action** `button.reset_meter`
  (`maintenanceAction: true` in `capabilitiesOptions`), not a settings button.
- Share values: no standard percentage capability exists, so two custom
  capabilities using the `measure_` prefix (instantaneous measurement, matching
  Homey convention; generic names, no app-specific wording so other apps/devices
  can adopt them):
  - `measure_grid_share` — number, `%`, 0–100, `uiComponent: sensor`, own icon.
  - `measure_self_sufficiency` — same shape.

## Method

On a timer, sample each source/monitored `meter_power(.x)` capability, derive the
per-interval counter delta, then allocate.

Energy balance per interval:

    ΔPV + ΔGridImport + ΔBatDischarge  =  ΔHouse + ΔGridExport + ΔBatCharge

House source split: drain sources against non-house sinks in priority order
(export served PV→battery→grid; battery charge served PV→grid), leaving
`houseGrid / housePv / houseBat` summing to ΔHouse.

Per monitored device: `Δdevice × houseX / ΔHouse` accumulated into the device's
`meter_power.grid/.pv/.bat`, plus the share capabilities.

## Decisions

### Sources

Allocation is driven entirely by kWh counters (`meter_power(.x)`). The Homey device
picker is used to choose devices; for each role the user then maps the specific
`meter_power` / `meter_power.*` capability that device exposes.

- **Grid**: exactly ONE grid meter device. User maps the imported-energy capability
  (required) and the exported-energy capability (**optional** — unset ⇒ export = 0).
  Any id is allowed (`meter_power`, `.consumed`/`.returned`, `.imported`/`.exported`, …).
- **PV**: one or more devices, each a single monotonic production `meter_power(.x)`;
  deltas summed.
- **Battery**: one or more devices (home battery, EV, V2G). Each device needs BOTH
  a monotonic charge-energy and discharge-energy capability (**both required**);
  deltas summed across devices.

### Counter / reset robustness (critical — meters reset at any time)

- Every tracked counter (each source device AND each monitored device) keeps its
  own stored baseline.
- If **any** tracked counter decreases between samples (reset to 0 or re-seeded),
  **discard the entire interval's allocation**, re-baseline every counter to its
  current value, and continue. Never add negative energy.
- When summing multiple devices for a source, detect resets per contributing
  device, not on the sum.
- Also guard against absurd `Δt` (missed polls / app restart) and stale or
  undefined capability values.

### Sampling

- Timer poll every `SAMPLE_INTERVAL_SECONDS` (300 s / 5 min), **fixed** in
  `lib/constants.js`. Not user-configurable: coarse meters (e.g. a PV inverter
  reporting `meter_power` to 0.1 kWh) barely move over a short interval at low
  power, which produced a stream of zero-delta "skipped" intervals. The only
  user-tunable number left is the Flow trigger threshold.
- Share values: smoothed over a trailing window of `SMOOTHING_INTERVALS` (5)
  sample intervals = 25 min. Also fixed. `_smoothingMs()` in
  `lib/AllocationDevice.js` = `SAMPLE_INTERVAL_SECONDS × SMOOTHING_INTERVALS`.

### Devices / topology

- Driver `device-allocation` ("Device Energy Allocation"): one allocator sums
  one or more monitored **counters** each interval (see `lib/AllocationDevice.js`
  `getMonitoredCounters()` → `{deviceId, capability}[]`, summed by `app.js
  tick()`). `device.js` reads the counter(s) from **`store`** (mutable, so
  `onRepair` can change them) with two shapes:
  - individual mode: `store = { deviceId, capability }` — one counter.
  - summary mode: `store = { counters: [{deviceId, capability}, …] }` — several
    counters, summed.

  `data` only carries the immutable pairing identity: `{ mode, uid }`. `mode`
  (`'individual'|'summary'`) is fixed for the device's lifetime — repair can
  change *which* counter(s) it follows but never the mode. `uid` is a random
  string minted at pairing time purely so `data` stays unique when the same
  counter is paired more than once — that's intentional, not blocked, since one
  counter can usefully feed several allocators (e.g. for different Flow
  purposes) or belong to more than one summary device. Devices paired before
  this `data`/`store` split existed have their counter(s) in `data` instead
  (`{deviceId, capability}` or `{counters: […]}`, no `mode`); `device.js` falls
  back to reading those so old devices keep working untouched until their
  first repair, after which the repaired value lives in `store` and `mode` is
  inferred from the old `data` shape (`getAllocationMode()`). Exposes
  `meter_power.grid/.pv/.bat` + share capabilities.
  - **Pairing is three custom stages** (not the built-in `list_devices` +
    `add_devices` templates — with hundreds of candidate devices in the house, a
    flat one-row-per-counter list was unusable):
    Steps 1–2 only navigate onward, so they have no in-page button — Homey's
    pairing chrome already renders Previous/Continue from their manifest
    `navigation.next`; each emits its current selection to the driver on every
    `change` instead, so it's up to date whenever Continue is pressed. Step 3
    does real work (creates the device(s)) and keeps its own button.
    1. `pair/choose_mode.html` — **individual** (one allocator per counter) vs
       **summary** (one allocator summing every selected counter). Recorded in
       `driver.js` `onPair()`'s closure via `select_mode`; carried to step 3
       through the `list_counters` response, not re-asked.
    2. `pair/select_devices.html` — filterable checkbox list of physical devices
       (any `meter_power(.x)` cap; only this app's own devices are excluded),
       one row per **device**. Same for both modes.
    3. `pair/select_counters.html` — for the devices picked in step 2, a
       checkbox list of all their `meter_power(.x)` counters, grouped per
       device. Submit behaviour depends on the mode from step 1: individual
       mode calls `Homey.createDevice()` once per checked counter; summary mode
       calls it once with every checked counter in `store.counters`.
    Selection is carried from step 1 to step 2 via a closure variable in
    `driver.js` `onPair(session)` (`session.setHandler('select_source_devices', …)`
    then `session.setHandler('list_counters', …)`) — see the Pairing section of
    `docs/homey-sdk-notes.md` for the confirmed custom-pair-view API.
  - **Repair** (`driver.js` `onRepair(session, device)`, `repair/select_devices.html`,
    `repair/select_counters.html`) reuses the same two steps to let the user
    reselect the counter(s), pre-checked with the device's current one(s), but
    never shows the mode question — `select_counters` renders a single radio
    choice for an individual-mode device or the usual checkbox-set for a
    summary one, matching whatever `device.getAllocationMode()` already is.
    Submitting calls `device.setStoreValue(...)`, never touching the
    `meter_power.total/.grid/.pv/.bat` capability values, so accumulated totals carry
    on unchanged — only the counter(s) `app.js` reads for this device change,
    effective on the very next sample tick (a brand-new counter simply starts
    its delta from zero on that first tick, per the normal reset-safe baseline
    logic — see "Counter / reset robustness" below).
- Driver `house-allocation` ("House Energy Allocation"): one aggregate
  device representing ΔHouse from the energy balance (split into grid/pv/bat),
  independent of which loads are monitored.

### Capabilities

Both drivers expose `meter_power.grid`, `measure_grid_share`,
`measure_self_sufficiency`, `button.reset_meter` always, plus `meter_power.pv` /
`meter_power.bat` **dynamically**. `device-allocation` additionally exposes
`meter_power.total` (grid+pv+bat combined) always — `house-allocation` doesn't,
to avoid double-counting (see "Capability strategy" above).

- Grid is mandatory, so `meter_power.grid` + the shares + the reset button are
  fixed in each `driver.compose.json` `capabilities` list; `device-allocation`'s
  list also fixes in `meter_power.total`. `lib/AllocationDevice.js`
  `_extraStaticCaps()` is how a driver-specific always-on capability like this
  gets included in the shared `_syncCapabilities()` migration logic (so
  existing paired devices gain it too, not just newly-paired ones) without
  leaking onto the other driver.
- `meter_power.pv` and `meter_power.bat` are **not** in the compose `capabilities`
  list (only in `capabilitiesOptions`, so `addCapability` picks up the title).
  `AllocationDevice._syncCapabilities()` adds `meter_power.pv` when the first solar
  source is configured and removes it when the last one is deleted; same for
  `meter_power.bat` vs. battery sources. `app.js` `syncConsumerCapabilities()`
  drives this from every config change (`settings.on('set')` and `setConfig()`),
  and each device also re-syncs in `onInit()`.
- Re-adding a dynamic capability appends it after `button.reset_meter` in the UI
  (Homey has no reorder API) — cosmetic only. Removing it also drops its stored
  total and Insights history; a later re-add starts the counter from 0.
- `measure_power.*` live breakdown may be added later — `lib/AllocationDevice.js`
  is structured so it can be.
- Cumulative counters otherwise run forever like a real meter.

### Edge cases

- Interval where ΔHouse ≤ 0 but a monitored device shows consumption (inconsistent
  balance): **skip the whole interval's allocation** and re-baseline, same as a
  counter reset. The 5-interval share smoothing absorbs the occasional dropped
  interval; the next interval is expected to be consistent.
- Consequence: skipped intervals are lost from the cumulative
  `meter_power.grid/.pv/.bat` totals, so they can slightly under-count over long
  runs. Accepted — shares are the primary metric.

### Configuration scope

- App-level settings page (`settings/index.html` + `api.js`) configures the source
  devices / capability mappings and the Flow trigger threshold for the whole
  house. Sample interval and smoothing window are fixed constants (`lib/constants.js`).
- Per-allocator-device override: **deferred** (not in v1). App-level only for now.

### Flow cards (shared by both drivers)

Defined **app-wide** in `.homeycompose/flow/` (not per-driver), with a manual
`device` arg whose `filter` is `driver_id=device-allocation|house-allocation` so
the card offers devices from either driver. Still a device Flow card (any card
with a `device` arg is), accessed via `getDeviceTriggerCard`.

- `.homeycompose/flow/triggers/grid_share_changed.json` — **grid share changed**:
  fires when the smoothed grid share moves more than `shareChangeThreshold` points
  since last fire; tokens `grid_share`, `self_sufficiency`. Fired per device from
  `lib/AllocationDevice._maybeTriggerShareChanged()`.

No custom **condition** card: the `measure_grid_share` / `measure_self_sufficiency`
capabilities are exposed as tokens, so Homey's standard Logic condition card
(`{{measure_grid_share}} > 50`) already covers "grid share above X" without a
purpose-built card.

## Build layout

- `app.js` — `EnergyAllocatorApp`: holds config, the consumer registry, and the
  sampling loop (`tick()`); exposes `getMeterDevices()` for the settings page and
  `device-allocation` pairing. `getMeterDevices()` filters out this app's own
  allocator devices (matched by `ownerUri` / `driverId` against
  `homey:app:<manifest.id>`) so their synthetic `meter_power.*` output can't be
  selected as a grid/PV/battery source or monitored — that would create a loop.
- `api.js` — `getMeterDevices` / `getConfig` / `putConfig`.
- `lib/allocation.js` — pure `computeHouseSplit()` + `attribute()` (unit-tested by
  eye; see the priority-drain algorithm).
- `lib/SmoothingWindow.js` — trailing-window energy sums → shares.
- `lib/AllocationDevice.js` — shared device behaviour; subclassed by both drivers,
  which only differ in `getMonitoredDeviceId()`.
- `settings/index.html` — source configuration UI.

### Known v1 limitations / TODO

- Baselines live in memory only — an app restart drops the in-flight interval
  (acceptable per the reset policy).
- `homey app run` on hardware not yet done.
- Placeholder art (`assets/`, `drivers/*/assets/`) — black-on-transparent bar/pie
  motifs; replace before publishing.

### Review findings (for future agent work)

Status: strong v1 architecture, but not yet fully hardened for every runtime edge case.

- Strengths
  - The core allocation model in `lib/allocation.js` is clear, conservative, and aligns well with Homey meter semantics.
  - Counter reset detection in `app.js` is a real strength; skipping inconsistent intervals is preferable to inventing energy.
  - `lib/AllocationDevice.js` keeps shared behavior clean and extensible for future power-breakdown capabilities.
  - Share smoothing in `lib/SmoothingWindow.js` is an appropriate design for UI/Flow stability.

- Risks / follow-ups
  - First-interval distortion: if a monitored device is registered after app startup, it may not have a proper baseline yet. Check the `baselines` setup in `app.js` before treating a new monitored device as an established source.
  - Interval loss: intentionally dropped intervals can slightly under-count cumulative totals over long runs. This is acceptable per the design, but it should remain explicit and not be treated as a bug in normal operation.
  - Test coverage: the allocation logic is subtle and should be covered by unit tests, especially for export precedence, charge precedence, impossible balance conditions, and reset handling.
  - Config validation: `settings/index.html` should reject duplicate mappings and more obviously invalid capability combinations before save.
  - Startup timing: the sampler starts after a short delay; ensure startup and new-device registration cannot generate a false initial spike.

- Recommended next tasks
  1. Add unit tests around `computeHouseSplit()` and `attribute()`.
  2. Harden initial baselining for newly created monitored devices and startup devices.
  3. Strengthen settings validation before persisting config.
  4. Keep the intentional “skip bad intervals” behavior documented and do not silently treat it as a correctness bug.

### Dependencies / permissions (done)

- `homey-api` dependency added; `homey:manager:api` permission set;
  `compatibility >=13.0.0`; `brandColor #3B7A57`.
