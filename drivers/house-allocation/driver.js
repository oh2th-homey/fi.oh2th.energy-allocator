'use strict';

const Homey = require('homey');

module.exports = class HouseAllocationDriver extends Homey.Driver {

  /**
   * There is exactly one whole-house allocator. Offer it only while none exists.
   */
  async onPairListDevices() {
    if (this.getDevices().length > 0) return [];

    return [
      {
        name: 'Whole House Energy Allocation',
        data: { id: 'whole-house' },
      },
    ];
  }
};
