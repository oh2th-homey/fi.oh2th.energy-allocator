'use strict';

const Homey = require('homey');

module.exports = class DeviceAllocationDriver extends Homey.Driver {

  /**
   * Lists one entry per `meter_power(.x)` counter on every eligible device, so a
   * device that exposes several energy meters (e.g. `meter_power.consumed` and
   * `meter_power.produced`) can be added once per counter. Entries whose exact
   * device + capability pair is already followed are hidden; the same device
   * with a different capability stays selectable.
   */
  async onPairListDevices() {
    const meterDevices = await this.homey.app.getMeterDevices();
    const taken = new Set(
      this.getDevices().map((device) => {
        const data = device.getData();
        return `${data.deviceId}::${data.capability || 'meter_power'}`;
      }),
    );

    const results = [];
    for (const device of meterDevices) {
      const multiple = device.capabilities.length > 1;
      for (const cap of device.capabilities) {
        if (taken.has(`${device.id}::${cap.id}`)) continue;
        const label = multiple ? `${device.name} (${cap.title})` : device.name;
        results.push({
          name: `${label} allocation`,
          data: { deviceId: device.id, capability: cap.id },
        });
      }
    }

    return results;
  }
};
