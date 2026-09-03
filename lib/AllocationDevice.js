'use strict';

const Homey = require('homey');
const SmoothingWindow = require('./SmoothingWindow');

const ENERGY_CAPS = ['meter_power.grid', 'meter_power.pv', 'meter_power.bat'];
const SHARE_CAPS = ['th_grid_share', 'th_self_sufficiency'];

/**
 * Shared behaviour for the two allocator device types. Subclasses implement
 * {@link AllocationDevice#getMonitoredDeviceId}:
 *   - device-allocation returns the id of the device it follows
 *   - house-allocation returns null (it receives the whole-house split directly)
 */
class AllocationDevice extends Homey.Device {

  async onInit() {
    this.window = new SmoothingWindow(this._smoothingMs());
    this._lastTriggeredShare = null;

    await this._ensureCapabilities();

    this.registerCapabilityListener('button.reset_meter', async () => this.resetMeters());

    try {
      this._shareChangedTrigger = this.homey.flow.getDeviceTriggerCard('grid_share_changed');
    } catch (err) {
      this._shareChangedTrigger = null; // driver has no such Flow card
    }

    this.homey.app.registerConsumer(this);
    this.setAvailable().catch(this.error);
    this.log(`initialised (monitoredDeviceId=${this.getMonitoredDeviceId() || 'none'})`);
  }

  onDeleted() {
    this.homey.app.unregisterConsumer(this);
  }

  /** @returns {string|null} */
  getMonitoredDeviceId() {
    return null;
  }

  _smoothingMs() {
    const cfg = this.homey.app.getConfig();
    return Math.max(1, cfg.smoothingMinutes || 5) * 60 * 1000;
  }

  async _ensureCapabilities() {
    for (const cap of [...ENERGY_CAPS, ...SHARE_CAPS, 'button.reset_meter']) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap).catch(this.error);
      }
    }
    for (const cap of ENERGY_CAPS) {
      if (typeof this.getCapabilityValue(cap) !== 'number') {
        await this.setCapabilityValue(cap, 0).catch(this.error);
      }
    }
  }

  /**
   * Called by the app once per sampling interval with this consumer's share of
   * the interval's energy.
   *
   * @param {{grid:number, pv:number, bat:number, total:number}} allocation
   */
  async applyAllocation({ grid, pv, bat, total }) {
    await this._bump('meter_power.grid', grid);
    await this._bump('meter_power.pv', pv);
    await this._bump('meter_power.bat', bat);

    this.window.setWindow(this._smoothingMs());
    this.window.add({ grid, pv, bat, total });

    const shares = this.window.shares();
    if (!shares) return;

    const gridShare = round(shares.gridShare, 1);
    const selfSufficiency = round(shares.selfSufficiency, 1);
    await this.setCapabilityValue('th_grid_share', gridShare).catch(this.error);
    await this.setCapabilityValue('th_self_sufficiency', selfSufficiency).catch(this.error);

    this._maybeTriggerShareChanged(gridShare, selfSufficiency);
  }

  async _bump(cap, amount) {
    if (!amount || amount <= 0) return;
    const current = this.getCapabilityValue(cap) || 0;
    await this.setCapabilityValue(cap, current + amount).catch(this.error);
  }

  _maybeTriggerShareChanged(gridShare, selfSufficiency) {
    const cfg = this.homey.app.getConfig();
    const threshold = Math.max(0, cfg.shareChangeThreshold || 0);

    if (this._lastTriggeredShare !== null
      && Math.abs(gridShare - this._lastTriggeredShare) < threshold) {
      return;
    }
    this._lastTriggeredShare = gridShare;

    this._shareChangedTrigger
      .trigger(this, { grid_share: gridShare, self_sufficiency: selfSufficiency })
      .catch(this.error);
  }

  async resetMeters() {
    this.window.clear();
    this._lastTriggeredShare = null;
    for (const cap of ENERGY_CAPS) {
      await this.setCapabilityValue(cap, 0).catch(this.error);
    }
    for (const cap of SHARE_CAPS) {
      await this.setCapabilityValue(cap, null).catch(this.error);
    }
    this.log('allocation meters reset');
  }
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

AllocationDevice.ENERGY_CAPS = ENERGY_CAPS;
AllocationDevice.SHARE_CAPS = SHARE_CAPS;

module.exports = AllocationDevice;
