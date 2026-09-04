'use strict';

const AllocationDevice = require('../../lib/AllocationDevice');

module.exports = class DeviceAllocationDevice extends AllocationDevice {

  getMonitoredDeviceId() {
    return this.getData().deviceId || null;
  }

  /**
   * The specific `meter_power(.x)` capability picked during pairing. Devices
   * paired before the capability picker existed have no `capability` in their
   * data, so they fall back to the plain `meter_power`.
   */
  getMonitoredCapability() {
    return this.getData().capability || 'meter_power';
  }
};
