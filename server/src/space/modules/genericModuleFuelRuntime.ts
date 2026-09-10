const path = require("path");

const {
  getFuelStacksForShipStorage,
  getFuelQuantityFromStacks,
  consumeFuelFromShipStorage,
} = require(path.join(__dirname, "./sharedFuelRuntime"));

function getCargoFuelStacks(entity, fuelTypeID, callbacks: Record<string, any> = {}) {
  return getFuelStacksForShipStorage(entity, fuelTypeID, callbacks);
}

function consumeShipModuleFuel(entity, fuelTypeID, quantity, callbacks: Record<string, any> = {}) {
  return consumeFuelFromShipStorage(entity, fuelTypeID, quantity, callbacks);
}

module.exports = {
  getCargoFuelStacks,
  getFuelStacksForShipStorage,
  getFuelQuantityFromStacks,
  consumeShipModuleFuel,
};
