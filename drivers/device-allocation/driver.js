'use strict';

const Homey = require('homey');

module.exports = class DeviceAllocationDriver extends Homey.Driver {

  /**
   * Two-stage custom pairing (see `pair/select_devices.html` and
   * `pair/select_counters.html`): pick one or more physical devices first, then
   * pick which `meter_power(.x)` counter(s) to add per device. Splitting it this
   * way keeps the first list short even with hundreds of candidate devices,
   * since it lists devices once instead of once per counter.
   *
   * A device/counter already followed by an existing allocator is **not**
   * excluded - the same counter can be added more than once (e.g. to feed
   * several differently-named allocators for different purposes). Each pair
   * view assigns its own `uid` in `data` so Homey treats every allocator as a
   * distinct device even when `deviceId` + `capability` repeat.
   */
  async onPair(session) {
    let selectedDeviceIds = [];

    session.setHandler('list_source_devices', async () => {
      const meterDevices = await this.homey.app.getMeterDevices();
      return meterDevices.map((device) => ({ id: device.id, name: device.name, zone: device.zone }));
    });

    session.setHandler('select_source_devices', async (deviceIds) => {
      selectedDeviceIds = Array.isArray(deviceIds) ? deviceIds : [];
    });

    session.setHandler('list_counters', async () => {
      const meterDevices = await this.homey.app.getMeterDevices();

      return meterDevices
        .filter((device) => selectedDeviceIds.includes(device.id))
        .map((device) => ({
          deviceId: device.id,
          name: device.name,
          zone: device.zone,
          multiple: device.capabilities.length > 1,
          capabilities: device.capabilities,
        }));
    });
  }
};
