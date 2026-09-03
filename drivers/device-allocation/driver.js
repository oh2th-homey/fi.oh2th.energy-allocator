'use strict';

const Homey = require('homey');

module.exports = class DeviceAllocationDriver extends Homey.Driver {

  async onInit() {
    this.homey.flow.getConditionCard('grid_share_above')
      .registerRunListener(async (args) => {
        const value = args.device.getCapabilityValue('th_grid_share');
        return typeof value === 'number' && value > args.percent;
      });
  }

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
        name: device.name,
        data: { deviceId: device.id },
      }));
  }
};
