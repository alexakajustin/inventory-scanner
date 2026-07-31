// ══════════════════════════════════════════════════════════════
// Snipe-IT API Client
// ══════════════════════════════════════════════════════════════

class SnipeITClient {
  constructor(baseUrl, apiKey) {
    // Remove trailing slash
    this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
    this.apiKey = apiKey || '';
  }

  // ── Generic API call ─────────────────────────────────────────

  async request(method, endpoint, body = null) {
    const url = `${this.baseUrl}/api/v1${endpoint}`;

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const resp = await fetch(url, options);
    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data.messages
        ? (typeof data.messages === 'string' ? data.messages : JSON.stringify(data.messages))
        : `HTTP ${resp.status}`;
      throw new Error(errMsg);
    }

    return data;
  }

  // ── Test connection ──────────────────────────────────────────

  async testConnection() {
    try {
      const data = await this.request('GET', '/users/me');
      return {
        success: true,
        user: data.name || data.username || 'Unknown',
        message: `Conectat ca "${data.name || data.username}"`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Eroare: ${err.message}`,
      };
    }
  }

  // ── Status Labels ────────────────────────────────────────────

  async getDeployableStatusId() {
    const data = await this.request('GET', '/statuslabels?limit=50');

    if (data.rows && data.rows.length > 0) {
      // Find a "deployable" status
      const deployable = data.rows.find(s =>
        s.type === 'deployable' ||
        (s.name && s.name.toLowerCase().includes('deploy'))
      );
      if (deployable) return deployable.id;

      // Fallback: return first status
      return data.rows[0].id;
    }

    throw new Error('Nu există status labels în Snipe-IT. Creează cel puțin unul (ex: "Ready to Deploy").');
  }

  // ── Categories ───────────────────────────────────────────────

  async findOrCreateCategory(name) {
    if (!name || name === 'Uncategorized') name = 'Other';

    // Search existing
    const search = await this.request('GET', `/categories?search=${encodeURIComponent(name)}&limit=50`);

    if (search.rows && search.rows.length > 0) {
      const exact = search.rows.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (exact) return exact.id;
    }

    // Create new
    console.log(`📂 Creez categorie în Snipe-IT: "${name}"`);
    const created = await this.request('POST', '/categories', {
      name: name,
      category_type: 'asset',
    });

    if (created.payload && created.payload.id) {
      return created.payload.id;
    }

    throw new Error(`Nu am putut crea categoria "${name}"`);
  }

  // ── Manufacturers ────────────────────────────────────────────

  async findOrCreateManufacturer(name) {
    if (!name) name = 'Unknown';

    const search = await this.request('GET', `/manufacturers?search=${encodeURIComponent(name)}&limit=50`);

    if (search.rows && search.rows.length > 0) {
      const exact = search.rows.find(m => m.name.toLowerCase() === name.toLowerCase());
      if (exact) return exact.id;
    }

    console.log(`🏭 Creez producător în Snipe-IT: "${name}"`);
    const created = await this.request('POST', '/manufacturers', {
      name: name,
    });

    if (created.payload && created.payload.id) {
      return created.payload.id;
    }

    throw new Error(`Nu am putut crea producătorul "${name}"`);
  }

  // ── Models ───────────────────────────────────────────────────

  async findOrCreateModel(name, categoryId, manufacturerId) {
    if (!name) name = 'Generic Model';

    const search = await this.request('GET', `/models?search=${encodeURIComponent(name)}&limit=50`);

    if (search.rows && search.rows.length > 0) {
      const exact = search.rows.find(m => m.name.toLowerCase() === name.toLowerCase());
      if (exact) return exact.id;
    }

    console.log(`📦 Creez model în Snipe-IT: "${name}"`);
    const created = await this.request('POST', '/models', {
      name: name,
      category_id: categoryId,
      manufacturer_id: manufacturerId,
    });

    if (created.payload && created.payload.id) {
      return created.payload.id;
    }

    throw new Error(`Nu am putut crea modelul "${name}"`);
  }

  // ── Create Asset (hardware) ──────────────────────────────────

  async createHardware(asset, modelId, statusId) {
    const payload = {
      asset_tag: asset.asset_tag,
      model_id: modelId,
      status_id: statusId,
    };

    if (asset.name) payload.name = asset.name;
    if (asset.serial) payload.serial = asset.serial;
    if (asset.purchase_cost) payload.purchase_cost = String(asset.purchase_cost);
    if (asset.notes) payload.notes = asset.notes;

    const created = await this.request('POST', '/hardware', payload);

    if (created.payload && created.payload.id) {
      return created.payload.id;
    }

    throw new Error('Nu am putut crea asset-ul în Snipe-IT');
  }

  // ── Update Asset (hardware) ──────────────────────────────────

  async updateHardware(id, asset, modelId, statusId) {
    const payload = {};
    if (asset.asset_tag) payload.asset_tag = asset.asset_tag;
    if (modelId) payload.model_id = modelId;
    if (statusId) payload.status_id = statusId;
    if (asset.name) payload.name = asset.name;
    if (asset.serial) payload.serial = asset.serial;
    if (asset.purchase_cost) payload.purchase_cost = String(asset.purchase_cost);
    if (asset.notes) payload.notes = asset.notes;

    const updated = await this.request('PATCH', `/hardware/${id}`, payload);

    if (updated.payload && updated.payload.id) {
      return updated.payload.id;
    }

    throw new Error(`Nu am putut actualiza asset-ul ${id} în Snipe-IT`);
  }

  // ── Find Asset ───────────────────────────────────────────────
  
  async findAssetBySerial(serial) {
    if (!serial) return null;
    try {
      const search = await this.request('GET', `/hardware/byserial/${encodeURIComponent(serial)}`);
      if (search.rows && search.rows.length > 0) {
        return search.rows[0];
      }
    } catch (e) {
      // Fallback search format if byserial endpoint doesn't work in this Snipe-IT version
      const fallbackSearch = await this.request('GET', `/hardware?search=${encodeURIComponent(serial)}`);
      if (fallbackSearch.rows && fallbackSearch.rows.length > 0) {
        const exact = fallbackSearch.rows.find(a => a.serial === serial);
        if (exact) return exact;
      }
    }
    return null;
  }

  async findAssetByTag(tag) {
    if (!tag) return null;
    try {
      const search = await this.request('GET', `/hardware/bytag/${encodeURIComponent(tag)}`);
      if (search.id) return search; // bytag usually returns the direct object if exact match
    } catch(e) {
      const fallbackSearch = await this.request('GET', `/hardware?search=${encodeURIComponent(tag)}`);
      if (fallbackSearch.rows && fallbackSearch.rows.length > 0) {
        const exact = fallbackSearch.rows.find(a => a.asset_tag === tag);
        if (exact) return exact;
      }
    }
    return null;
  }

  // ── Orchestrator: push a complete asset ──────────────────────

  async pushAsset(localAsset) {
    console.log(`\n🚀 Pushing asset "${localAsset.name}" to Snipe-IT...`);

    // Step 1: Status label
    const statusId = await this.getDeployableStatusId();
    console.log(`  ✅ Status ID: ${statusId}`);

    // Step 2: Category
    const categoryId = await this.findOrCreateCategory(localAsset.category);
    console.log(`  ✅ Category: ${localAsset.category} (ID: ${categoryId})`);

    // Step 3: Manufacturer
    const manufacturerId = await this.findOrCreateManufacturer(localAsset.manufacturer);
    console.log(`  ✅ Manufacturer: ${localAsset.manufacturer} (ID: ${manufacturerId})`);

    // Step 4: Model
    const modelName = localAsset.model_name || localAsset.name || 'Generic';
    const modelId = await this.findOrCreateModel(modelName, categoryId, manufacturerId);
    console.log(`  ✅ Model: ${modelName} (ID: ${modelId})`);

    if (localAsset.purchase_cost) {
       console.log(`  💲 Purchase Cost: ${localAsset.purchase_cost} RON`);
    }

    // Step 5: Check if it already exists (if pushed via API from elsewhere)
    let snipeitId = localAsset.snipeit_id;
    if (snipeitId) {
       console.log(`  🔄 Actualizez asset-ul existent în Snipe-IT (ID: ${snipeitId})...`);
       await this.updateHardware(snipeitId, localAsset, modelId, statusId);
       console.log(`  ✅ Asset actualizat cu succes.`);
    } else {
       // Create asset
       snipeitId = await this.createHardware(localAsset, modelId, statusId);
       console.log(`  ✅ Asset creat în Snipe-IT cu ID: ${snipeitId}`);
    }

    return snipeitId;
  }

  // ── Pull All Assets ──────────────────────────────────────────

  async pullAllAssets() {
    console.log(`\n📥 Downloading assets from Snipe-IT...`);
    let allAssets = [];
    let offset = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
      const data = await this.request('GET', `/hardware?limit=${limit}&offset=${offset}`);
      if (data.rows && data.rows.length > 0) {
        allAssets = allAssets.concat(data.rows);
        offset += limit;
      } else {
        hasMore = false;
      }
      
      if (data.total !== undefined && allAssets.length >= data.total) {
        hasMore = false;
      }
    }

    console.log(`✅ Downloaded ${allAssets.length} assets from Snipe-IT.`);
    return allAssets;
  }
}

module.exports = SnipeITClient;
