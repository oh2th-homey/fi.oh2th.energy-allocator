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
source devices, plus each monitored device's `meter_power` (see "Sources" below for
exact capability handling).

Outputs (per monitored device):

- `meter_power.grid`, `meter_power.pv`, and (when battery configured) `meter_power.bat`
- share capabilities (`th_grid_share`, `th_self_sufficiency`)

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

- Energy outputs use standard `meter_power` sub-capabilities: `meter_power.grid`,
  `meter_power.pv`, `meter_power.bat`. No bare `meter_power` and no `energy`
  object — deliberately keeps these synthetic figures out of Homey Energy so they
  can't double-count the real meters.
- Meter reset uses a **standard maintenance-action** `button.reset_meter`
  (`maintenanceAction: true` in `capabilitiesOptions`), not a settings button.
- Share values: no standard percentage capability exists, so two custom
  capabilities under the author's reusable `th_` namespace (generic, no
  app-specific wording, so other apps/devices can adopt them):
  - `th_grid_share` — number, `%`, 0–100, `uiComponent: sensor`, own icon.
  - `th_self_sufficiency` — same shape.

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

- Timer poll, default ~60 s interval (configurable).
- Share values: near-instantaneous, smoothed over a trailing ~5 min window
  (rolling average of the last ~5 samples at a 1 min interval).

### Devices / topology

- Driver `device-allocation` ("Device Energy Allocation"): one device per
  monitored device (bound via the device picker), exposing
  `meter_power.grid/.pv/.bat` + share capabilities.
- Driver `house-allocation` ("Whole House Energy Allocation"): one aggregate
  device representing ΔHouse from the energy balance (split into grid/pv/bat),
  independent of which loads are monitored.

### Capabilities

Both drivers expose the same set:
`meter_power.grid`, `meter_power.pv`, `meter_power.bat`, `th_grid_share`,
`th_self_sufficiency`, `button.reset_meter`. See "Capability strategy" above.

- `measure_power.*` live breakdown may be added later — `lib/AllocationDevice.js`
  is structured so it can be.
- Cumulative counters otherwise run forever like a real meter.

### Edge cases

- Interval where ΔHouse ≤ 0 but a monitored device shows consumption (inconsistent
  balance): **skip the whole interval's allocation** and re-baseline, same as a
  counter reset. The ~5 min share smoothing absorbs the occasional dropped
  interval; the next interval is expected to be consistent.
- Consequence: skipped intervals are lost from the cumulative
  `meter_power.grid/.pv/.bat` totals, so they can slightly under-count over long
  runs. Accepted — shares are the primary metric.

### Configuration scope

- App-level settings page (`settings/index.html` + `api.js`) configures the source
  devices / capability mappings and the sampling numbers for the whole house.
- Per-allocator-device override: **deferred** (not in v1). App-level only for now.

### Flow cards (driver `device-allocation` only in v1)

Defined in `drivers/device-allocation/driver.flow.compose.json`, so Compose scopes
them to that driver. The `house-allocation` device has no custom Flow cards yet
(still gets Insights on every capability).

- Trigger **grid share changed** — fires when the smoothed grid share moves more
  than `shareChangeThreshold` points since last fire; tokens `grid_share`,
  `self_sufficiency`.
- Condition **grid share is/isn't above [percent] %**.

## Build layout

- `app.js` — `EnergyAllocatorApp`: holds config, the consumer registry, and the
  sampling loop (`tick()`); exposes `getMeterDevices()` for the settings page.
- `api.js` — `getMeterDevices` / `getConfig` / `putConfig`.
- `lib/allocation.js` — pure `computeHouseSplit()` + `attribute()` (unit-tested by
  eye; see the priority-drain algorithm).
- `lib/SmoothingWindow.js` — trailing-window energy sums → shares.
- `lib/AllocationDevice.js` — shared device behaviour; subclassed by both drivers,
  which only differ in `getMonitoredDeviceId()`.
- `settings/index.html` — source configuration UI.
- `tools/make-assets.js` (`npm run assets`) — regenerates placeholder PNGs.

### Known v1 limitations / TODO

- Monitored devices must expose a **plain `meter_power`** capability (pairing
  filters to those). No sub-capability picker for the monitored device yet.
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
