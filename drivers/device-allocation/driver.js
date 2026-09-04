'use strict';

const Homey = require('homey');

module.exports = class DeviceAllocationDriver extends Homey.Driver {

  /**
   * Lists Homey devices that expose a plain `meter_power` capability and are not
   * already followed by an allocator device.
   */
  async onPairListDevices() {
    const meterDevices = await this.homey.app.getMeterDevices();
    const taken = new Set(
      this.getDevices().map((device) => device.getData().deviceId),
    );

    return meterDevices
      .filter((device) => device.capabilities.some((cap) => cap.id === 'meter_power'))
      .filter((device) => !taken.has(device.id))
      .map((device) => ({
        name: `${device.name} allocation`,
        data: { deviceId: device.id },
      }));
  }
};
