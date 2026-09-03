'use strict';

module.exports = {

  async getMeterDevices({ homey }) {
    return homey.app.getMeterDevices();
  },

  async getConfig({ homey }) {
    return homey.app.getConfig();
  },

  async putConfig({ homey, body }) {
    return homey.app.setConfig(body);
  },
};
