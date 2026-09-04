# Energy Allocator

Estimate the split of grid, solar, and battery energy a device consumes.

A [Homey](https://homey.app/) app that adds virtual devices which attribute the
energy a device consumes to its real origin — the **grid**, **PV/solar**, or a
**home battery** (or EV / V2G) — using the `meter_power` (kWh) counters of devices
you already own.

## Requirements

- Homey Pro with app platform compatibility `>=13.0.0`.
- The `homey:manager:api` permission (declared by the app) to enumerate and read
  other apps' devices.

## How it works

On a timer (default ~60 s) the app samples the configured kWh counters and works
with per-interval deltas. Each interval it solves the household energy balance

```text
ΔPV + ΔGridImport + ΔBatDischarge  =  ΔHouse + ΔGridExport + ΔBatCharge
```

and first sets aside energy used for other purposes, such as sending power back
to the grid or charging the battery, in a fixed order (export served
PV → battery → grid; battery charging served PV → grid). What remains is the
grid / solar / battery split of house consumption. Each monitored device's own
delta is then attributed in the same proportions and accumulated.

### Robustness

`meter_power` counters can be reset or re-seeded at any time. Every tracked
counter (sources and monitored devices) keeps its own baseline; if any counter
decreases, or the balance is inconsistent, or the sample gap is implausible, the
whole interval is discarded and the baselines are re-synced. Reported shares are
smoothed over a trailing ~5 minute window so dropped intervals are not visible.

## Configuration

The app has one shared configuration in its app settings. It applies to every
allocator device and defines the meters used for the whole home:

- Select one grid meter and map its imported-energy capability. Exported energy
  is optional and is treated as zero when no export capability is selected.
- Add one or more PV devices and map each device's production-energy capability.
- Add one or more battery or EV devices and map both the charge- and
  discharge-energy capabilities for each one.
- Set the sampling interval, share smoothing period, and Flow trigger threshold.

Capability ids for import and export are not standardized across drivers (for
example, HomeWizard P1 uses `meter_power.consumed` and
`meter_power.returned`), so each role must be mapped explicitly.

## Devices

| Driver              | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `device-allocation` | One device per monitored device; per-device grid/solar/battery energy and shares. |
| `house-allocation`  | One aggregate device for whole-home consumption (ΔHouse) from the energy balance. |

### Capabilities

- `meter_power.grid`, `meter_power.pv`, `meter_power.bat` — allocated energy
- `th_grid_share` (%) — grid energy / total consumed.
- `th_self_sufficiency` (%) — (solar + battery) energy / total consumed.
- `button.reset_meter` — maintenance action to reset the allocation counters.

## Author

Tapio Heiskanen

## License

This project is licensed under the [MIT License](LICENSE).

## Icon Attribution

Some icons are adapted from [The Noun Project](https://thenounproject.com/):

- Icongeek26
- apixlabs
- Pictogramma
- Icon Designer
