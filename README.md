# Energy Allocator

Estimate the split of grid, solar, and battery energy a device consumes.

A [Homey](https://homey.app/) app that adds virtual devices which attribute the
energy a device consumes to its real origin — the **grid**, **PV/solar**, or a
**home battery** (or EV / V2G) — using the `meter_power` (kWh) counters of devices
you already own.

> This is the developer README. The text shown on the Homey App Store lives in
> [`README.txt`](README.txt); localized variants are `README.<lang>.txt`.

## How it works

On a timer (default ~60 s) the app samples the configured kWh counters and works
with per-interval deltas. Each interval it solves the household energy balance

```
ΔPV + ΔGridImport + ΔBatDischarge  =  ΔHouse + ΔGridExport + ΔBatCharge
```

and drains sources against non-house sinks in priority order (export served
PV → battery → grid; battery charging served PV → grid). What remains is the
grid / solar / battery split of house consumption. Each monitored device's own
delta is then attributed in the same proportions and accumulated.

Only kWh counters are used — `measure_power` (W) is deliberately avoided because
cumulative meters are more reliable end to end.

### Robustness

`meter_power` counters can be reset or re-seeded at any time. Every tracked
counter (sources and monitored devices) keeps its own baseline; if any counter
decreases, or the balance is inconsistent, or the sample gap is implausible, the
whole interval is discarded and the baselines are re-synced. Reported shares are
smoothed over a trailing ~5 minute window so dropped intervals are not visible.

## Devices

| Driver | Purpose |
| --- | --- |
| `device-allocation` | One device per monitored device; per-device grid/solar/battery energy and shares. |
| `house-allocation` | One aggregate device for whole-home consumption (ΔHouse) from the energy balance. |

### Capabilities

- `meter_power.grid`, `meter_power.pv`, `meter_power.bat` — allocated energy
  (standard `meter_power` sub-capabilities).
- `th_grid_share` (%) — grid energy / total consumed.
- `th_self_sufficiency` (%) — (solar + battery) energy / total consumed.
- `button.reset_meter` — maintenance action to reset the allocation counters.

## Configuration

Source meters (one grid meter, one or more PV devices, one or more battery
devices) and the capability that represents each role are chosen in the app
settings, with optional per-device overrides. Capability ids for import/export
are not standardized across drivers (e.g. HomeWizard P1 uses
`meter_power.consumed` / `meter_power.returned`), so each role is mapped
explicitly. Grid export is optional and treated as zero when not mapped; battery
devices require both a charge and a discharge counter.

## Requirements

- Homey Pro with app platform compatibility `>=13.0.0`.
- The `homey:manager:api` permission (declared by the app) to enumerate and read
  other apps' devices.

## Development

```bash
npm install
homey app run        # run on a local Homey Pro
homey app validate    # validate against the publish level
```

This is a [Homey Compose](https://apps.developer.homey.app/the-basics/app/composing-an-app)
project: edit files under `.homeycompose/`, never the generated `app.json`.

## References

- Homey Apps SDK guide — https://apps.developer.homey.app/
- Homey Apps SDK v3 JavaScript reference — https://apps-sdk-v3.developer.homey.app/

## Author

Tapio Heiskanen (oh2th@iki.fi)
