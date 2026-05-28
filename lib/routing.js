const db = require('../db/init');

// Trigger words that indicate a property may already be listed with another brokerage.
// Matched case-insensitively against every text value in the seller payload.
const LISTED_TRIGGERS = [
  'listed',
  'mls',
  'agent',
  'realtor',
  'listing',
  'expires'
];

// Property-type values (from the seller form) that flag the storage vertical.
const STORAGE_PROPERTY_TYPES = ['self_storage', 'self-storage', 'storage'];

// Free-text storage triggers (address, notes, description).
const STORAGE_TEXT_TRIGGERS = ['self storage', 'self-storage'];

function flattenPayloadToStrings(payload) {
  const out = [];
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { out.push(v); return; }
    if (typeof v === 'number' || typeof v === 'boolean') { out.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
  };
  walk(payload);
  return out;
}

function detectListed(payload) {
  const haystack = flattenPayloadToStrings(payload).join(' \n ').toLowerCase();
  // Word-boundary match so "management" doesn't trip "agent".
  return LISTED_TRIGGERS.some((trigger) => {
    const re = new RegExp(`\\b${trigger}\\b`, 'i');
    return re.test(haystack);
  });
}

function detectStorage(payload) {
  const propType = (payload.property_type || '').toString().toLowerCase().trim();
  if (STORAGE_PROPERTY_TYPES.includes(propType)) return true;

  // Check common free-text fields for "self storage" / "self-storage"
  const textFields = [
    payload.property_address,
    payload.address,
    payload.property_description,
    payload.condition_notes,
    payload.notes,
    payload.property_type_other
  ].filter(Boolean).join(' ').toLowerCase();

  return STORAGE_TEXT_TRIGGERS.some((t) => textFields.includes(t));
}

function pickRoundRobinAgent() {
  // Pick the active agent with the oldest last_assigned_at (nulls first).
  const row = db.prepare(`
    SELECT * FROM agents
    WHERE active = 1
    ORDER BY (last_assigned_at IS NULL) DESC, last_assigned_at ASC, created_at ASC
    LIMIT 1
  `).get();
  return row || null;
}

function markAgentAssigned(agentId) {
  db.prepare(`UPDATE agents SET last_assigned_at = datetime('now') WHERE id = ?`).run(agentId);
}

module.exports = {
  detectListed,
  detectStorage,
  pickRoundRobinAgent,
  markAgentAssigned,
  LISTED_TRIGGERS,
  STORAGE_PROPERTY_TYPES
};
