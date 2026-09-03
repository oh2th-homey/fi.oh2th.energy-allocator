'use strict';

/** Energy smaller than this (kWh) is treated as zero / rounding noise. */
const EPS = 1e-6;

/**
 * Split one interval of house consumption into grid / solar / battery energy.
 *
 * All inputs are non-negative kWh deltas measured over the same interval.
 * The house balance is:
 *
 *   ΔHouse = pv + gridImport + batDischarge − gridExport − batCharge
 *
 * Non-house sinks are served from the sources in a fixed priority order, and
 * whatever source energy is left over is what the house actually consumed:
 *
 *   - battery charging is served by PV first, then grid import
 *   - export to grid is served by PV first, then battery discharge, then grid import
 *
 * @param {object} deltas
 * @param {number} deltas.gridImport
 * @param {number} deltas.gridExport
 * @param {number} deltas.pv
 * @param {number} deltas.batCharge
 * @param {number} deltas.batDischarge
 * @returns {{ok: boolean, reason?: string, houseTotal: number, houseGrid?: number, housePv?: number, houseBat?: number}}
 */
function computeHouseSplit({ gridImport, gridExport, pv, batCharge, batDischarge }) {
  const houseTotal = pv + gridImport + batDischarge - gridExport - batCharge;

  if (houseTotal <= EPS) {
    return { ok: false, reason: 'non-positive house consumption', houseTotal };
  }

  let p = pv;
  let d = batDischarge;
  let i = gridImport;

  // Battery charging: PV first, then grid import.
  let c = batCharge;
  const cFromPv = Math.min(p, c); p -= cFromPv; c -= cFromPv;
  const cFromGrid = Math.min(i, c); i -= cFromGrid; c -= cFromGrid;

  // Export to grid: PV first, then battery discharge, then grid import (pass-through).
  let x = gridExport;
  const xFromPv = Math.min(p, x); p -= xFromPv; x -= xFromPv;
  const xFromBat = Math.min(d, x); d -= xFromBat; x -= xFromBat;
  const xFromGrid = Math.min(i, x); i -= xFromGrid; x -= xFromGrid;

  if (c > EPS || x > EPS) {
    return { ok: false, reason: 'inconsistent energy balance', houseTotal };
  }

  // Remaining source energy served the house; by construction i + p + d === houseTotal.
  return {
    ok: true,
    houseTotal,
    houseGrid: Math.max(0, i),
    housePv: Math.max(0, p),
    houseBat: Math.max(0, d),
  };
}

/**
 * Attribute a single consumer's interval consumption in the same proportions as
 * the whole-house split.
 *
 * @param {number} deviceDelta kWh the device consumed this interval (>= 0)
 * @param {{houseTotal:number, houseGrid:number, housePv:number, houseBat:number}} split
 * @returns {{grid:number, pv:number, bat:number, total:number}}
 */
function attribute(deviceDelta, split) {
  const f = deviceDelta / split.houseTotal;
  return {
    grid: split.houseGrid * f,
    pv: split.housePv * f,
    bat: split.houseBat * f,
    total: deviceDelta,
  };
}

module.exports = { computeHouseSplit, attribute, EPS };
