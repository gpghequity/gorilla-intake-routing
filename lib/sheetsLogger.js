// lib/sheetsLogger.js
//
// Appends submission rows to Google Sheets via service-account auth.
// GOOGLE_SERVICE_ACCOUNT_JSON — full JSON blob of the service account key.
// GOOGLE_SHEETS_ID            — spreadsheet ID (from the URL).
//
// Resilience contract: never throws. Returns { ok: true } on success,
// { ok: false, error } on every failure including missing config.
// Callers MUST fire-and-forget — never await in a blocking path.

'use strict';

const TABS = {
  SELLER:  'Intake — Sellers',
  BUYER:   'Intake — Buyers',
  AGENT:   'Intake — Agents'
};

let _google = null;
function googleapis() {
  if (!_google) _google = require('googleapis').google;
  return _google;
}

let _cachedSheets = null;
let _cachedFingerprint = null;

function buildAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' };
  let creds;
  try { creds = JSON.parse(json); }
  catch (e) { return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message }; }
  if (!creds.client_email || !creds.private_key) {
    return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key' };
  }
  const auth = new (googleapis()).auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return { auth, fingerprint: creds.client_email };
}

function getSheets() {
  const r = buildAuth();
  if (r.error) return { error: r.error };
  if (_cachedSheets && _cachedFingerprint === r.fingerprint) {
    return { sheets: _cachedSheets };
  }
  _cachedSheets = googleapis().sheets({ version: 'v4', auth: r.auth });
  _cachedFingerprint = r.fingerprint;
  return { sheets: _cachedSheets };
}

async function appendRow(tabName, rowValues) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) return { ok: false, error: 'GOOGLE_SHEETS_ID not set' };
  const r = getSheets();
  if (r.error) return { ok: false, error: r.error };
  try {
    await r.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tabName}'!A:ZZ`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowValues] }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'sheets append failed' };
  }
}

// Build a flat row for a seller submission
function sellerRow(sub) {
  const p = sub.payload || {};
  return [
    sub.id,
    sub.submitted_at || new Date().toISOString(),
    p.full_name   || p.name   || '',
    p.email       || '',
    p.phone       || '',
    p.address     || '',
    p.city        || '',
    p.state       || '',
    p.zip         || '',
    p.property_type || '',
    p.asking_price || '',
    p.condition    || '',
    p.motivation   || '',
    p.listed_flag !== undefined ? p.listed_flag : (sub.listed_flag ? 'yes' : 'no'),
    p.storage_flag !== undefined ? p.storage_flag : (sub.storage_flag ? 'yes' : 'no'),
    sub.status     || 'new',
    p.notes        || p.message || p.additional_info || ''
  ];
}

// Build a flat row for a buyer submission
function buyerRow(sub) {
  const p = sub.payload || {};
  const types = Array.isArray(p.property_types) ? p.property_types.join(', ') : (p.property_types || '');
  return [
    sub.id,
    sub.submitted_at || new Date().toISOString(),
    p.full_name   || p.name   || '',
    p.email       || '',
    p.phone       || '',
    p.min_price   || p.budget_min || '',
    p.max_price   || p.budget_max || '',
    types,
    p.financing   || p.finance_type || '',
    p.timeline    || '',
    p.notes       || p.message || p.additional_info || ''
  ];
}

// Build a flat row for an agent/join submission
function agentRow(sub) {
  const p = sub.payload || {};
  const focus = Array.isArray(p.focus) ? p.focus.join(', ') : (p.focus || '');
  return [
    sub.id,
    sub.submitted_at || new Date().toISOString(),
    p.full_name   || p.name   || '',
    p.email       || '',
    p.phone       || '',
    p.license_number || p.license || '',
    p.license_state  || '',
    p.years_experience || '',
    focus,
    p.notes       || p.message || p.additional_info || ''
  ];
}

async function logSeller(sub) {
  try {
    const row = sellerRow(sub);
    const result = await appendRow(TABS.SELLER, row);
    if (!result.ok) console.error('[sheetsLogger] seller append failed:', result.error);
    return result;
  } catch (e) {
    console.error('[sheetsLogger] logSeller threw:', e.message);
    return { ok: false, error: e.message };
  }
}

async function logBuyer(sub) {
  try {
    const row = buyerRow(sub);
    const result = await appendRow(TABS.BUYER, row);
    if (!result.ok) console.error('[sheetsLogger] buyer append failed:', result.error);
    return result;
  } catch (e) {
    console.error('[sheetsLogger] logBuyer threw:', e.message);
    return { ok: false, error: e.message };
  }
}

async function logAgent(sub) {
  try {
    const row = agentRow(sub);
    const result = await appendRow(TABS.AGENT, row);
    if (!result.ok) console.error('[sheetsLogger] agent append failed:', result.error);
    return result;
  } catch (e) {
    console.error('[sheetsLogger] logAgent threw:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { logSeller, logBuyer, logAgent, TABS };
