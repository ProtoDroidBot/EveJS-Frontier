let activeIncursions: any[] = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function listActiveIncursions() {
  return cloneValue(activeIncursions);
}

function replaceActiveIncursions(incursions: any[] = []) {
  activeIncursions = Array.isArray(incursions) ? cloneValue(incursions) : [];
}

function resetForTests() {
  activeIncursions = [];
}

module.exports = {
  listActiveIncursions,
  replaceActiveIncursions,
  _testing: {
    resetForTests,
  },
};
