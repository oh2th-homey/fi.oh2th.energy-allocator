'use strict';

const Homey = require('homey');

module.exports = class DeviceAllocationDriver extends Homey.Driver {

  /**
   * Three-stage custom pairing:
   *   1. `pair/choose_mode.html` - individual (one allocator per counter) or
   *      summary (one allocator summing every counter).
   *   2. `pair/select_devices.html` - filterable checkbox list of physical
   *      devices.
   *   3. `pair/select_counters.html` - checkbox list of the selected devices'
   *      `meter_power(.x)` counters, grouped per device; submission behaviour
   *      depends on the chosen mode.
   *
   * A counter already followed by an existing allocator is not excluded and
   * can be selected again; each created device gets its own `uid` in `data`.
   * The chosen counter(s) are written to `store`; `data.mode` records the
   * pairing mode.
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
   * Lets the user reselect the counter(s) an existing allocator follows.
   * Reuses pairing's `select_devices` + `select_counters` steps (see
   * `repair/*.html`), without the mode question: `select_counters` renders a
   * single-choice picker for `individual` mode, multi-choice for `summary`.
   * Updates only `store`; leaves `meter_power.grid/.pv/.bat` untouched.
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
