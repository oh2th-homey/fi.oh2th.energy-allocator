'use strict';

const AllocationDevice = require('../../lib/AllocationDevice');

module.exports = class DeviceAllocationDevice extends AllocationDevice {

  getMonitoredDeviceId() {
    return this.getData().deviceId || null;
  }
};
