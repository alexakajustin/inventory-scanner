const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'inventory.db');

let db = null;
let dbReady = null; // Promise that resolves when DB is ready

// ── Initialize ───────────────────────────────────────────────

function initDb() {
  if (dbReady) return dbReady;

  dbReady = (async () => {
    const SQL = await initSqlJs();

    // Load existing DB or create new
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT,
        asset_tag TEXT UNIQUE,
        serial TEXT,
        name TEXT NOT NULL,
        manufacturer TEXT,
        model_name TEXT,
        model_number TEXT,
        category TEXT DEFAULT 'Uncategorized',
        purchase_cost REAL,
        notes TEXT,
        status TEXT DEFAULT 'Ready to Deploy',
        image_url TEXT,
        snipeit_id INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS lookup_cache (
        barcode TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        cached_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Migration: add snipeit_id if it doesn't exist on older DBs
    try {
      db.run('ALTER TABLE assets ADD COLUMN snipeit_id INTEGER DEFAULT NULL');
    } catch { /* column already exists */ }

    saveToFile();
    return db;
  })();

  return dbReady;
}

function saveToFile() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Helper: run query and get all results as objects ──────────

function allRows(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function oneRow(sql, params = []) {
  const rows = allRows(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ── CRUD Operations ──────────────────────────────────────────

function createAsset(asset) {
  const tag = asset.asset_tag || generateAssetTag();

  db.run(`
    INSERT INTO assets (barcode, asset_tag, serial, name, manufacturer, model_name, model_number, category, purchase_cost, notes, status, image_url, snipeit_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    asset.barcode || null,
    tag,
    asset.serial || null,
    asset.name,
    asset.manufacturer || null,
    asset.model_name || null,
    asset.model_number || null,
    asset.category || 'Uncategorized',
    asset.purchase_cost || null,
    asset.notes || null,
    asset.status || 'Ready to Deploy',
    asset.image_url || null,
    asset.snipeit_id || null,
  ]);

  // Get the last inserted ID
  const row = oneRow('SELECT last_insert_rowid() as id');
  saveToFile();

  return { id: row.id, asset_tag: tag };
}

function getAllAssets() {
  return allRows('SELECT * FROM assets ORDER BY created_at DESC');
}

function getAssetById(id) {
  return oneRow('SELECT * FROM assets WHERE id = ?', [id]);
}

function updateAsset(id, fields) {
  const allowed = ['barcode', 'asset_tag', 'serial', 'name', 'manufacturer', 'model_name', 'model_number', 'category', 'purchase_cost', 'notes', 'status', 'image_url', 'snipeit_id'];
  const updates = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }

  if (updates.length === 0) return false;

  updates.push("updated_at = datetime('now', 'localtime')");
  values.push(id);

  const sql = `UPDATE assets SET ${updates.join(', ')} WHERE id = ?`;
  db.run(sql, values);

  const changes = db.getRowsModified();
  if (changes > 0) saveToFile();
  return changes > 0;
}

function deleteAsset(id) {
  db.run('DELETE FROM assets WHERE id = ?', [id]);
  const changes = db.getRowsModified();
  if (changes > 0) saveToFile();
  return changes > 0;
}

function getAssetCount() {
  const row = oneRow('SELECT COUNT(*) as count FROM assets');
  return row ? row.count : 0;
}

function searchAssets(query) {
  const q = `%${query}%`;
  return allRows(`
    SELECT * FROM assets 
    WHERE name LIKE ? OR manufacturer LIKE ? OR model_name LIKE ? OR serial LIKE ? OR barcode LIKE ? OR asset_tag LIKE ?
    ORDER BY created_at DESC
  `, [q, q, q, q, q, q]);
}

// ── Lookup Cache ─────────────────────────────────────────────

function getCachedLookup(barcode) {
  const row = oneRow('SELECT response_json FROM lookup_cache WHERE barcode = ?', [barcode]);
  if (row) {
    try {
      return JSON.parse(row.response_json);
    } catch {
      return null;
    }
  }
  return null;
}

function setCachedLookup(barcode, data) {
  // Use INSERT OR REPLACE
  db.run(`
    INSERT OR REPLACE INTO lookup_cache (barcode, response_json, cached_at)
    VALUES (?, ?, datetime('now', 'localtime'))
  `, [barcode, JSON.stringify(data)]);
  saveToFile();
}

// ── Helpers ──────────────────────────────────────────────────

function generateAssetTag() {
  const row = oneRow("SELECT asset_tag FROM assets WHERE asset_tag LIKE 'ASSET-%' ORDER BY CAST(SUBSTR(asset_tag, 7) AS INTEGER) DESC LIMIT 1");
  let nextNum = 1;
  if (row && row.asset_tag) {
    const num = parseInt(row.asset_tag.substring(6), 10);
    if (!isNaN(num)) nextNum = num + 1;
  }
  return `ASSET-${String(nextNum).padStart(5, '0')}`;
}

function closeDb() {
  if (db) {
    saveToFile();
    db.close();
    db = null;
    dbReady = null;
  }
}

// ── Settings ─────────────────────────────────────────────────

function getSetting(key) {
  const row = oneRow('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  saveToFile();
}

function getAllSettings() {
  const rows = allRows('SELECT key, value FROM settings');
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ── Snipe-IT Helpers ─────────────────────────────────────────

function updateAssetSnipeId(localId, snipeitId) {
  db.run('UPDATE assets SET snipeit_id = ? WHERE id = ?', [snipeitId, localId]);
  saveToFile();
}

function getUnsyncedAssets() {
  return allRows('SELECT * FROM assets WHERE snipeit_id IS NULL ORDER BY created_at DESC');
}

function upsertAssetFromSnipeIT(snipeAsset) {
  if (!snipeAsset || !snipeAsset.id) return;
  const snipeId = snipeAsset.id;
  const tag = snipeAsset.asset_tag;
  const serial = snipeAsset.serial || null;
  const name = snipeAsset.name || (snipeAsset.model ? snipeAsset.model.name : 'Unknown');
  const manufacturer = snipeAsset.manufacturer ? snipeAsset.manufacturer.name : null;
  const model_name = snipeAsset.model ? snipeAsset.model.name : null;
  const category = snipeAsset.category ? snipeAsset.category.name : 'Uncategorized';
  const cost = snipeAsset.purchase_cost ? parseFloat(snipeAsset.purchase_cost) : null;
  const notes = snipeAsset.notes || null;
  const status = snipeAsset.status_label ? snipeAsset.status_label.name : 'Ready to Deploy';

  let localAsset = oneRow('SELECT id FROM assets WHERE snipeit_id = ? OR asset_tag = ?', [snipeId, tag]);

  if (localAsset) {
    updateAsset(localAsset.id, {
      snipeit_id: snipeId,
      asset_tag: tag,
      serial,
      name,
      manufacturer,
      model_name,
      category,
      purchase_cost: cost,
      notes,
      status
    });
  } else {
    db.run(`
      INSERT INTO assets (snipeit_id, asset_tag, serial, name, manufacturer, model_name, category, purchase_cost, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [snipeId, tag, serial, name, manufacturer, model_name, category, cost, notes, status]);
    saveToFile();
  }
}

module.exports = {
  initDb,
  createAsset,
  getAllAssets,
  getAssetById,
  updateAsset,
  deleteAsset,
  getAssetCount,
  searchAssets,
  getCachedLookup,
  setCachedLookup,
  getSetting,
  setSetting,
  getAllSettings,
  updateAssetSnipeId,
  getUnsyncedAssets,
  upsertAssetFromSnipeIT,
  closeDb,
};
