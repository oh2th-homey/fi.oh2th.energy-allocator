'use strict';

const Homey = require('homey');

module.exports = class HouseAllocationDriver extends Homey.Driver {

  /**
   * Offers the whole-house allocator while none exists.
   * @returns {{name:string, data:{id:string}}[]}
   */
  async onPairListDevices() {
    if (this.getDevices().length > 0) return [];

    return [
      {
        name: 'House Energy Allocation',
        data: { id: 'whole-house' },
      },
    ];
  }
};
