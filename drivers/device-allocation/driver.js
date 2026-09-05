'use strict';

const Homey = require('homey');

module.exports = class DeviceAllocationDriver extends Homey.Driver {

  /**
   * Three-stage custom pairing:
   *   1. `pair/choose_mode.html` - individual devices (one allocator per
   *      counter) or a summary device (one allocator that sums every counter).
   *   2. `pair/select_devices.html` - filterable checkbox list of physical
   *      devices. Splitting device selection from counter selection keeps this
   *      list short even with hundreds of candidate devices.
   *   3. `pair/select_counters.html` - checkbox list of the selected devices'
   *      `meter_power(.x)` counters, grouped per device; submission behaviour
   *      depends on the chosen mode (see that file).
   *
   * A device/counter already followed by an existing allocator is **not**
   * excluded - the same counter can be added more than once (e.g. to feed
   * several differently-purposed allocators, or to be part of more than one
   * summary device). Each created device gets its own `uid` in `data` so Homey
   * treats it as distinct even when `deviceId` + `capability` repeat.
   *
   * The chosen counter(s) are written to `store` (mutable), not `data`
   * (immutable) - see `onRepair` below, which changes exactly that later.
   * `data.mode` records the pairing mode, which repair cannot change.
   */
  async onPair(session) {
    let mode = 'individual';
    let selectedDeviceIds = [];

    session.setHandler('select_mode', async (value) => {
      mode = value === 'summary' ? 'summary' : 'individual';
    });

    session.setHandler('list_source_devices', async () => {
      const meterDevices = await this.homey.app.getMeterDevices();
      return meterDevices.map((device) => ({ id: device.id, name: device.name, zone: device.zone }));
    });

    session.setHandler('select_source_devices', async (deviceIds) => {
      selectedDeviceIds = Array.isArray(deviceIds) ? deviceIds : [];
    });

    session.setHandler('list_counters', async () => {
      const meterDevices = await this.homey.app.getMeterDevices();

      const groups = meterDevices
        .filter((device) => selectedDeviceIds.includes(device.id))
        .map((device) => ({
          deviceId: device.id,
          name: device.name,
          zone: device.zone,
          multiple: device.capabilities.length > 1,
          capabilities: device.capabilities,
        }));

      return { mode, groups };
    });
  }

  /**
   * Lets the user reselect the source device(s)/counter(s) an existing
   * allocator follows - mirrors pairing's `select_devices` + `select_counters`
   * (see `repair/*.html`), minus the mode question: the pairing mode is fixed
   * for the device's lifetime and only decides whether `select_counters` shows
   * a single-choice (individual) or multi-choice (summary) picker.
   *
   * This never touches the device's `meter_power.grid/.pv/.bat` capability
   * values, so its accumulated totals are untouched by a repair - only the
   * counter(s) `app.js` reads for it going forward change, taking effect on
   * the very next sample tick.
   */
  async onRepair(session, device) {
    const mode = device.getAllocationMode();
    const currentCounters = device.getMonitoredCounters();
    let selectedDeviceIds = Array.from(new Set(currentCounters.map((c) => c.deviceId)));

    session.setHandler('list_source_devices', async () => {
      const meterDevices = await this.homey.app.getMeterDevices();
      return meterDevices.map((d) => ({
        id: d.id,
        name: d.name,
        zone: d.zone,
        selected: selectedDeviceIds.includes(d.id),
      }));
    });

    session.setHandler('select_source_devices', async (deviceIds) => {
      selectedDeviceIds = Array.isArray(deviceIds) ? deviceIds : [];
    });

    session.setHandler('list_counters', async () => {
      const meterDevices = await this.homey.app.getMeterDevices();
      const currentKeys = new Set(currentCounters.map((c) => `${c.deviceId}::${c.capability}`));

      const groups = meterDevices
        .filter((d) => selectedDeviceIds.includes(d.id))
        .map((d) => ({
          deviceId: d.id,
          name: d.name,
          zone: d.zone,
          capabilities: d.capabilities.map((cap) => ({ ...cap, selected: currentKeys.has(`${d.id}::${cap.id}`) })),
        }));

      return { mode, groups };
    });

    session.setHandler('apply_repair', async (payload) => {
      if (mode === 'summary') {
        const counters = Array.isArray(payload && payload.counters) ? payload.counters : [];
        if (counters.length === 0) throw new Error('Select at least one counter.');
        await device.setStoreValue('counters', counters);
      } else {
        const deviceId = payload && payload.deviceId;
        const capability = payload && payload.capability;
        if (!deviceId || !capability) throw new Error('Select a counter.');
        await device.setStoreValue('deviceId', deviceId);
        await device.setStoreValue('capability', capability);
      }
    });
  }
};
