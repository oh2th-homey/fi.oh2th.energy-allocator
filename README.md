# Energy Allocator

https://homey.app/a/fi.oh2th.energy-allocator/test

Your home uses energy from several places at once - the grid, solar panels, and a home battery. This app looks at the meters you already have and works out how much of each device's energy came from the grid, from solar, and from the battery.

To do this, it needs permission to manage other devices, so it can read their energy meters (`meter_power`). Homey will ask you to approve this when you install the app.

## How it works

Every 5 minutes, the app reads your grid, solar, and battery meters, plus the meters of the devices you're following, and splits each device's usage the same way the house's energy balances:

    solar + grid import + battery discharge = house use + grid export + battery charge

If a meter looks reset, the numbers don't add up, or Homey or the app restarts mid-interval, that reading is skipped rather than guessed. Cumulative totals can then lag very slightly behind reality, but the Grid allocation / Self-sufficiency percentages aren't affected, since they're smoothed and self-correcting.

## What you need

- **A grid meter** that reports imported energy (required). Exported energy is optional - leave it unset if your meter doesn't report it, or you don't export any.
- **Solar and/or battery meters** (optional) - add as many as you have.
- **Devices to follow**, each with its own energy meter (most smart plugs, EV chargers, heat pumps, etc. have one).

## Two kinds of devices

- **Device Energy Allocation** - follows one meter, or (in *summary* mode) several meters added together, e.g. three heating circuits combined into one "Heating" device.
- **Whole House Energy Allocation** - one device for the whole home's split, no matter which devices you're following. Add it once.

## Setting it up

1. Open the app's **Settings**. Choose your grid meter's import capability (and export, if it has one). Add your solar and/or battery meters the same way.
2. Add a **Whole House Energy Allocation** device for the household total, and/or one or more **Device Energy Allocation** devices for specific appliances. Pairing asks you to pick individual or summary mode, then the meter(s) to follow.
3. Picked the wrong device or meter? No need to delete and start over - use **Repair** on the device to change it. Nothing resets; the totals keep counting from the new source.

## What you'll get

Each device shows:

- Its **grid**, **solar**, and **battery** energy (kWh), plus a **total** (Device Energy Allocation only). The battery figure is just energy that left the battery; its original grid/solar mix isn't tracked here.
- **Grid allocation** and **Self-sufficiency** (%) - what share of a device's energy over the last 30 minutes came from the grid versus from solar and/or the battery. Self-sufficiency is just 100% minus Grid allocation; both are smoothed over that window so they don't jump around.
- **"Energy share changed"** and **"Energy allocation changed"** Flow triggers.
- A **"Reset allocation meters"** maintenance action (in the device's menu) to set its counters back to zero.
- **Repair** (also in the device's menu) to change which meter(s) it follows without losing its totals.

## Useful links

- [FAQ and Hints](https://community.homey.app/t/159148/2)
- [TODO](https://community.homey.app/t/159148/3)
- [Known Issues](https://community.homey.app/t/159148/4)

---

## Repository info

- **Requirements**: Homey Pro, firmware `>=13.0.0`. The app needs permission to manage other devices, so it can read their energy meters.
- **Author**: Tapio Heiskanen
- **License**: [MIT](LICENSE)
- **Icon attribution**: some icons adapted from [The Noun Project](https://thenounproject.com/) - Icongeek26, apixlabs, Pictogramma, Icon Designer.
