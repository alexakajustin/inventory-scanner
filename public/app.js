// ══════════════════════════════════════════════════════════════
// Snipe-IT Barcode Scanner — Frontend Logic
// ══════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  let scanner = null;
  let isScanning = false;
  let isProcessingScan = false;

  // ── DOM Elements ─────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    // Tabs
    tabs: $$('.tab'),
    tabContents: $$('.tab-content'),
    // Scanner
    btnStartScan: $('#btn-start-scan'),
    btnStopScan: $('#btn-stop-scan'),
    scannerContainer: $('#scanner-container'),
    manualBarcode: $('#manual-barcode'),
    btnManualLookup: $('#btn-manual-lookup'),
    // Result
    scanResult: $('#scan-result'),
    resultStatus: $('#result-status'),
    resultImageWrapper: $('#result-image-wrapper'),
    resultImage: $('#result-image'),
    btnCloseResult: $('#btn-close-result'),
    assetForm: $('#asset-form'),
    btnScanAnother: $('#btn-scan-another'),
    // Fields
    fieldName: $('#field-name'),
    fieldManufacturer: $('#field-manufacturer'),
    fieldModel: $('#field-model'),
    fieldModelNumber: $('#field-model-number'),
    btnSearchPrice: $('#btn-search-price'),
    fieldCategory: $('#field-category'),
    fieldSerial: $('#field-serial'),
    fieldCost: $('#field-cost'),
    fieldBarcode: $('#field-barcode'),
    fieldNotes: $('#field-notes'),
    // Inventory
    searchInput: $('#search-input'),
    inventoryList: $('#inventory-list'),
    // Export
    btnExport: $('#btn-export'),
    btnSaveServer: $('#btn-save-server'),
    serverSaveStatus: $('#server-save-status'),
    statTotal: $('#stat-total'),
    statManufacturers: $('#stat-manufacturers'),
    statCategories: $('#stat-categories'),
    // Header
    // Toast
    toast: $('#toast'),
    toastIcon: $('#toast-icon'),
    toastMessage: $('#toast-message'),
    // Edit Modal
    editModal: $('#edit-modal'),
    btnCloseEdit: $('#btn-close-edit'),
    editForm: $('#edit-form'),
    editId: $('#edit-id'),
    editName: $('#edit-name'),
    editManufacturer: $('#edit-manufacturer'),
    editModel: $('#edit-model'),
    editModelNumber: $('#edit-model-number'),
    editCategory: $('#edit-category'),
    editSerial: $('#edit-serial'),
    editCost: $('#edit-cost'),
    editBarcode: $('#edit-barcode'),
    editNotes: $('#edit-notes'),
    // Settings
    settingUrl: $('#setting-url'),
    settingApikey: $('#setting-apikey'),
    settingAutosync: $('#setting-autosync'),
    btnSaveSettings: $('#btn-save-settings'),
    btnTestConnection: $('#btn-test-connection'),
    connectionStatus: $('#connection-status'),
    apikeyHint: $('#apikey-hint'),
    // Sync
    btnSyncAll: $('#btn-sync-all'),
    syncAllStatus: $('#sync-all-status'),
  };

  // ── Google Price Search Link ────────────────────────────────

  function updateSearchLink() {
    const model = els.fieldModel.value.trim();
    const manufacturer = els.fieldManufacturer.value.trim();
    const query = [manufacturer, model, 'pret'].filter(Boolean).join(' ');
    if (query && query !== 'pret') {
      els.btnSearchPrice.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      els.btnSearchPrice.style.opacity = '1';
      els.btnSearchPrice.style.pointerEvents = 'auto';
    } else {
      els.btnSearchPrice.href = '#';
      els.btnSearchPrice.style.opacity = '0.3';
      els.btnSearchPrice.style.pointerEvents = 'none';
    }
  }

  els.fieldModel.addEventListener('input', updateSearchLink);
  els.fieldManufacturer.addEventListener('input', updateSearchLink);

  // ── Tab Navigation ───────────────────────────────────────────

  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      els.tabs.forEach(t => t.classList.remove('active'));
      els.tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      $(`#content-${target}`).classList.add('active');

      // Refresh data when switching tabs
      if (target === 'inventory') loadInventory();
      if (target === 'export') loadStats();
      if (target === 'settings') loadSettings();
    });
  });

  // ── Barcode Scanner ──────────────────────────────────────────

  els.btnStartScan.addEventListener('click', startScanner);
  els.btnStopScan.addEventListener('click', stopScanner);

  async function startScanner() {
    if (isScanning) return;

    try {
      scanner = new Html5Qrcode('reader');

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        showToast('❌', 'Nu s-a găsit nicio cameră', 'error');
        return;
      }

      // Prefer back camera
      let cameraId = cameras[0].id;
      for (const cam of cameras) {
        if (cam.label && cam.label.toLowerCase().includes('back')) {
          cameraId = cam.id;
          break;
        }
        if (cam.label && cam.label.toLowerCase().includes('environment')) {
          cameraId = cam.id;
          break;
        }
      }

      await scanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          aspectRatio: 1.5,
        },
        onScanSuccess,
        () => {} // ignore scan failures (normal during scanning)
      );

      isScanning = true;
      els.btnStartScan.style.display = 'none';
      els.btnStopScan.style.display = '';
      els.scannerContainer.classList.add('scanning');

    } catch (err) {
      console.error('Scanner error:', err);
      showToast('❌', 'Eroare cameră: ' + (err.message || err), 'error');
    }
  }

  async function stopScanner() {
    if (!isScanning || !scanner) return;

    try {
      await scanner.stop();
    } catch (e) {
      // ignore
    }

    isScanning = false;
    els.btnStartScan.style.display = '';
    els.btnStopScan.style.display = 'none';
    els.scannerContainer.classList.remove('scanning');
  }

  async function onScanSuccess(decodedText) {
    if (isProcessingScan) return;
    isProcessingScan = true;

    // Stop scanner immediately to prevent double-scans
    await stopScanner();

    // Vibrate for feedback
    if (navigator.vibrate) navigator.vibrate(200);

    await lookupBarcode(decodedText);
  }

  // ── Manual Input ─────────────────────────────────────────────

  els.btnManualLookup.addEventListener('click', () => {
    const code = els.manualBarcode.value.trim();
    if (code) lookupBarcode(code);
  });

  els.manualBarcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = els.manualBarcode.value.trim();
      if (code) lookupBarcode(code);
    }
  });

  // ── Barcode Lookup ───────────────────────────────────────────

  async function lookupBarcode(barcode) {
    // Show loading state
    showResult({
      found: null, // loading
      barcode,
    });

    try {
      const resp = await fetch(`/api/lookup/${encodeURIComponent(barcode)}`);
      const data = await resp.json();

      if (resp.ok) {
        showResult(data);
      } else {
        showResult({ found: false, barcode, error: data.error });
        if (data.error) showToast('⚠️', data.error, 'error');
      }
    } catch (err) {
      console.error('Lookup error:', err);
      showResult({ found: false, barcode });
      showToast('❌', 'Eroare la lookup', 'error');
    }
  }

  // ── Show Result ──────────────────────────────────────────────

  function showResult(data) {
    els.scanResult.style.display = 'block';
    els.scanResult.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const statusEl = els.resultStatus;

    if (data.found === null) {
      // Loading
      statusEl.innerHTML = '<span class="spinner"></span><span class="status-text">Se caută...</span>';
      statusEl.className = 'result-status';
      return;
    }

    if (data.found) {
      statusEl.innerHTML = '<span class="status-icon">✅</span><span class="status-text">Produs găsit!</span>';
      statusEl.className = 'result-status found';

      // Fill form
      els.fieldName.value = data.name || '';
      els.fieldManufacturer.value = data.manufacturer || '';
      els.fieldModel.value = data.model_name || '';
      els.fieldModelNumber.value = data.model_number || '';
      els.fieldBarcode.value = data.barcode || '';

      // Set category
      if (data.category) {
        const catOption = [...els.fieldCategory.options].find(
          o => o.value.toLowerCase() === data.category.toLowerCase()
        );
        if (catOption) {
          els.fieldCategory.value = catOption.value;
        }
      }

      // Price
      if (data.lowest_price) {
        els.fieldCost.value = data.lowest_price;
      }

      // Image
      if (data.image_url) {
        els.resultImage.onerror = () => {
          console.warn('Image failed to load:', data.image_url);
          els.resultImageWrapper.style.display = 'none';
        };
        els.resultImage.onload = () => {
          els.resultImageWrapper.style.display = 'block';
        };
        els.resultImage.src = data.image_url;
      } else {
        els.resultImageWrapper.style.display = 'none';
        els.resultImage.src = '';
      }

      // Source indicator
      if (data.source === 'cache') {
        showToast('📦', 'Rezultat din cache (nu s-a consumat API call)', 'success');
      }

      updateSearchLink();

    } else {
      statusEl.innerHTML = '<span class="status-icon">⚠️</span><span class="status-text">Produsul nu a fost găsit — completează manual</span>';
      statusEl.className = 'result-status not-found';

      // Clear form but keep barcode
      els.fieldName.value = '';
      els.fieldManufacturer.value = '';
      els.fieldModel.value = '';
      els.fieldModelNumber.value = '';
      els.fieldBarcode.value = data.barcode || '';
      els.fieldCategory.value = 'Uncategorized';
      els.fieldSerial.value = '';
      els.fieldCost.value = '';
      els.fieldNotes.value = '';
      els.resultImageWrapper.style.display = 'none';
      els.resultImage.src = '';

      // Focus name field for quick manual entry
      setTimeout(() => els.fieldName.focus(), 300);

      updateSearchLink();
    }
  }

  // ── Close Result / Scan Another ──────────────────────────────

  els.btnCloseResult.addEventListener('click', () => {
    els.scanResult.style.display = 'none';
    resetForm();
  });

  els.btnScanAnother.addEventListener('click', () => {
    els.scanResult.style.display = 'none';
    resetForm();
    startScanner();
  });

  function resetForm() {
    isProcessingScan = false;
    els.assetForm.reset();
    els.resultImageWrapper.style.display = 'none';
    els.resultImage.src = '';
  }

  // ── Save Asset ───────────────────────────────────────────────

  els.assetForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = els.fieldName.value.trim();
    if (!name) {
      showToast('⚠️', 'Numele produsului este obligatoriu', 'error');
      els.fieldName.focus();
      return;
    }

    const asset = {
      barcode: els.fieldBarcode.value.trim() || null,
      serial: els.fieldSerial.value.trim() || null,
      name,
      manufacturer: els.fieldManufacturer.value.trim() || null,
      model_name: els.fieldModel.value.trim() || null,
      model_number: els.fieldModelNumber.value.trim() || null,
      category: els.fieldCategory.value,
      purchase_cost: els.fieldCost.value ? parseFloat(els.fieldCost.value) : null,
      notes: els.fieldNotes.value.trim() || null,
      image_url: els.resultImage.src || null,
    };

    try {
      const resp = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asset),
      });

      const data = await resp.json();

      if (resp.ok) {
        showToast('✅', `Asset salvat! Tag: ${data.asset_tag}`, 'success');
        els.scanResult.style.display = 'none';
        resetForm();
        updateAssetCount();
      } else {
        showToast('❌', data.error || 'Eroare la salvare', 'error');
      }
    } catch (err) {
      console.error('Save error:', err);
      showToast('❌', 'Eroare la salvare', 'error');
    }
  });

  // ── Inventory List ───────────────────────────────────────────

  let searchTimeout;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadInventory, 300);
  });

  async function loadInventory() {
    const query = els.searchInput.value.trim();
    const url = query ? `/api/assets?q=${encodeURIComponent(query)}` : '/api/assets';

    try {
      const resp = await fetch(url);
      const data = await resp.json();
      renderInventory(data.assets);
    } catch (err) {
      console.error('Load error:', err);
    }
  }

  function renderInventory(assets) {
    if (!assets || assets.length === 0) {
      els.inventoryList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📦</span>
          <p>Niciun asset găsit</p>
          <p class="empty-sub">Scanează un cod de bare pentru a începe</p>
        </div>
      `;
      return;
    }

    els.inventoryList.innerHTML = assets.map(a => `
      <div class="asset-card" data-id="${a.id}">
        <div class="asset-thumb">${getCategoryIcon(a.category)}</div>
        <div class="asset-info">
          <div class="asset-name">
            ${escapeHtml(a.name)}
            ${a.snipeit_id
              ? `<span class="sync-badge synced">🟢 Synced</span>`
              : `<span class="sync-badge unsynced">🔴 Local</span>`}
          </div>
          <div class="asset-meta">
            ${a.manufacturer ? `<span>${escapeHtml(a.manufacturer)}</span>` : ''}
            ${a.category ? `<span>${escapeHtml(a.category)}</span>` : ''}
            ${a.serial ? `<span>S/N: ${escapeHtml(a.serial)}</span>` : ''}
          </div>
        </div>
        <span class="asset-tag-badge">${escapeHtml(a.asset_tag || '')}</span>
        <div class="asset-actions">
          ${!a.snipeit_id ? `<button class="btn-icon btn-push" data-id="${a.id}" title="Push to Snipe-IT">🚀</button>` : ''}
          <button class="btn-icon btn-edit" data-id="${a.id}" title="Editează">✏️</button>
          <button class="btn-icon btn-delete" data-id="${a.id}" title="Șterge">🗑️</button>
        </div>
      </div>
    `).join('');

    // Delete handlers
    els.inventoryList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDelete(parseInt(btn.dataset.id));
      });
    });

    // Edit handlers
    els.inventoryList.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(parseInt(btn.dataset.id));
      });
    });

    // Push to Snipe-IT handlers
    els.inventoryList.querySelectorAll('.btn-push').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        btn.textContent = '⏳';
        btn.disabled = true;
        try {
          const resp = await fetch(`/api/snipeit/push/${id}`, { method: 'POST' });
          const data = await resp.json();
          if (resp.ok) {
            showToast('✅', `Sincronizat cu Snipe-IT (ID: ${data.snipeit_id})`, 'success');
            loadInventory();
          } else {
            showToast('❌', data.error || 'Eroare la sincronizare', 'error');
            btn.textContent = '🚀';
            btn.disabled = false;
          }
        } catch (err) {
          showToast('❌', 'Eroare la sincronizare', 'error');
          btn.textContent = '🚀';
          btn.disabled = false;
        }
      });
    });
  }

  function getCategoryIcon(category) {
    const icons = {
      'Laptop': '💻',
      'Desktop': '🖥️',
      'Workstation': '🖥️',
      'Monitor': '🖥️',
      'RAM': '🧩',
      'SSD': '💾',
      'HDD': '💿',
      'Switch': '🔀',
      'Router': '📡',
      'Access Point': '📶',
      'Firewall': '🛡️',
      'Server': '🗄️',
      'UPS': '🔋',
      'Printer': '🖨️',
      'Scanner': '📠',
      'Keyboard': '⌨️',
      'Mouse': '🖱️',
      'Headset': '🎧',
      'Webcam': '📷',
      'Docking Station': '🔌',
      'Smartphone': '📱',
      'Tablet': '📱',
      'Cable': '🔌',
      'Adapter': '🔌',
      'NAS': '🗄️',
      'Projector': '📽️',
      'Phone - VoIP': '☎️',
    };
    return icons[category] || '📦';
  }

  // ── Delete Asset ─────────────────────────────────────────────

  function confirmDelete(id) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>🗑️ Șterge asset?</h3>
        <p>Această acțiune este ireversibilă.</p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="confirm-cancel">Anulează</button>
          <button class="btn btn-danger" id="confirm-delete">Șterge</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#confirm-cancel').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.querySelector('#confirm-delete').addEventListener('click', async () => {
      overlay.remove();
      try {
        const resp = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
        if (resp.ok) {
          showToast('✅', 'Asset șters', 'success');
          loadInventory();
          updateAssetCount();
        } else {
          showToast('❌', 'Eroare la ștergere', 'error');
        }
      } catch (err) {
        showToast('❌', 'Eroare la ștergere', 'error');
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── Edit Asset ───────────────────────────────────────────────

  async function openEditModal(id) {
    try {
      const resp = await fetch(`/api/assets/${id}`);
      if (!resp.ok) throw new Error('Asset not found');
      const asset = await resp.json();

      // Populate form
      els.editId.value = asset.id;
      els.editName.value = asset.name || '';
      els.editManufacturer.value = asset.manufacturer || '';
      els.editModel.value = asset.model_name || '';
      els.editModelNumber.value = asset.model_number || '';
      els.editBarcode.value = asset.barcode || '';
      els.editSerial.value = asset.serial || '';
      els.editCost.value = asset.purchase_cost || '';
      els.editNotes.value = asset.notes || '';
      
      if (asset.category) {
        const catOption = [...els.editCategory.options].find(
          o => o.value.toLowerCase() === asset.category.toLowerCase()
        );
        if (catOption) els.editCategory.value = catOption.value;
      }

      els.editModal.style.display = 'flex';
    } catch (err) {
      console.error(err);
      showToast('❌', 'Eroare la încărcare asset', 'error');
    }
  }

  els.btnCloseEdit.addEventListener('click', () => {
    els.editModal.style.display = 'none';
  });

  els.editModal.addEventListener('click', (e) => {
    if (e.target === els.editModal) els.editModal.style.display = 'none';
  });

  els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = els.editId.value;
    const asset = {
      name: els.editName.value.trim(),
      manufacturer: els.editManufacturer.value.trim() || null,
      model_name: els.editModel.value.trim() || null,
      model_number: els.editModelNumber.value.trim() || null,
      category: els.editCategory.value,
      barcode: els.editBarcode.value.trim() || null,
      serial: els.editSerial.value.trim() || null,
      purchase_cost: els.editCost.value ? parseFloat(els.editCost.value) : null,
      notes: els.editNotes.value.trim() || null,
    };

    if (!asset.name) return;

    try {
      const resp = await fetch(`/api/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asset),
      });

      if (resp.ok) {
        showToast('✅', 'Asset actualizat', 'success');
        els.editModal.style.display = 'none';
        loadInventory();
      } else {
        showToast('❌', 'Eroare la actualizare', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('❌', 'Eroare la actualizare', 'error');
    }
  });

  // ── Export ────────────────────────────────────────────────────

  els.btnExport.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/export/csv');
      if (!resp.ok) {
        const data = await resp.json();
        showToast('⚠️', data.error || 'Eroare la export', 'error');
        return;
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snipeit-import-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('✅', 'CSV descărcat!', 'success');
    } catch (err) {
      console.error('Export error:', err);
      showToast('❌', 'Eroare la export', 'error');
    }
  });

  // Server-side save
  els.btnSaveServer.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/export/save', { method: 'POST' });
      const data = await resp.json();

      if (resp.ok) {
        showToast('✅', 'CSV salvat pe server!', 'success');
        els.serverSaveStatus.style.display = 'block';
        els.serverSaveStatus.className = 'server-save-status success';
        els.serverSaveStatus.innerHTML = `
          <strong>💾 Salvat cu succes!</strong><br>
          <span>📁 ${data.path}</span><br>
          <span>📦 ${data.assets} asset-uri exportate</span>
        `;
      } else {
        showToast('⚠️', data.error || 'Eroare la salvare', 'error');
        els.serverSaveStatus.style.display = 'block';
        els.serverSaveStatus.className = 'server-save-status error';
        els.serverSaveStatus.textContent = data.error || 'Eroare la salvare';
      }
    } catch (err) {
      console.error('Server save error:', err);
      showToast('❌', 'Eroare la salvare pe server', 'error');
    }
  });

  async function loadStats() {
    try {
      const resp = await fetch('/api/stats');
      const data = await resp.json();

      els.statTotal.textContent = data.total;
      els.statManufacturers.textContent = data.manufacturers;
      els.statCategories.textContent = data.categories;
    } catch (err) {
      console.error('Stats error:', err);
    }
  }

  // ── Asset Count Badge ────────────────────────────────────────

  async function updateAssetCount() {
    try {
      const resp = await fetch('/api/stats');
      const data = await resp.json();
      els.assetCount.textContent = data.total;
    } catch {
      // ignore
    }
  }

  // ── Toast Notifications ──────────────────────────────────────

  let toastTimer;
  function showToast(icon, message, type = 'success') {
    clearTimeout(toastTimer);

    els.toastIcon.textContent = icon;
    els.toastMessage.textContent = message;
    els.toast.className = `toast ${type}`;
    els.toast.style.display = 'flex';
    els.toast.style.animation = 'toastIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)';

    toastTimer = setTimeout(() => {
      els.toast.style.animation = 'toastOut 0.3s cubic-bezier(0.22, 1, 0.36, 1)';
      setTimeout(() => {
        els.toast.style.display = 'none';
      }, 280);
    }, 3000);
  }

  // ── Helpers ──────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Init ─────────────────────────────────────────────────────

  updateAssetCount();

  // ── Settings ────────────────────────────────────────────────

  async function loadSettings() {
    try {
      const resp = await fetch('/api/settings');
      const data = await resp.json();

      els.settingUrl.value = data.snipeit_url || '';
      els.settingAutosync.checked = data.snipeit_autosync === 'true';

      if (data.snipeit_apikey_set === 'true') {
        els.settingApikey.placeholder = `Salvat (${data.snipeit_apikey_masked})`;
        els.apikeyHint.textContent = '✅ API Key setat — lasă gol dacă nu vrei să-l schimbi';
      }
    } catch (err) {
      console.error('Settings load error:', err);
    }
  }

  els.btnSaveSettings.addEventListener('click', async () => {
    const payload = {
      snipeit_url: els.settingUrl.value.trim(),
      snipeit_autosync: els.settingAutosync.checked,
    };

    const apikey = els.settingApikey.value.trim();
    if (apikey) payload.snipeit_apikey = apikey;

    try {
      const resp = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (resp.ok) {
        showToast('✅', 'Setări salvate!', 'success');
        els.settingApikey.value = '';
        loadSettings();
      } else {
        showToast('❌', 'Eroare la salvare', 'error');
      }
    } catch (err) {
      showToast('❌', 'Eroare la salvare', 'error');
    }
  });

  els.btnTestConnection.addEventListener('click', async () => {
    els.connectionStatus.style.display = 'block';
    els.connectionStatus.className = 'server-save-status';
    els.connectionStatus.innerHTML = '<strong>⏳ Se testează conexiunea...</strong>';

    try {
      const resp = await fetch('/api/snipeit/test', { method: 'POST' });
      const data = await resp.json();

      if (data.success) {
        els.connectionStatus.className = 'server-save-status success';
        els.connectionStatus.innerHTML = `<strong>✅ Conexiune reușită!</strong><br><span>${data.message}</span>`;
      } else {
        els.connectionStatus.className = 'server-save-status error';
        els.connectionStatus.innerHTML = `<strong>❌ Conexiune eșuată</strong><br><span>${data.message}</span>`;
      }
    } catch (err) {
      els.connectionStatus.className = 'server-save-status error';
      els.connectionStatus.innerHTML = '<strong>❌ Eroare de rețea</strong>';
    }
  });

  // ── Sync All ────────────────────────────────────────────────

  els.btnSyncAll.addEventListener('click', async () => {
    els.btnSyncAll.disabled = true;
    els.btnSyncAll.textContent = '⏳ Se sincronizează...';
    els.syncAllStatus.style.display = 'block';
    els.syncAllStatus.className = 'server-save-status';
    els.syncAllStatus.innerHTML = '<strong>⏳ Se trimit asset-urile nesincronizate către Snipe-IT...</strong>';

    try {
      const resp = await fetch('/api/snipeit/push-all', { method: 'POST' });
      const data = await resp.json();

      if (resp.ok) {
        if (data.synced > 0) {
          els.syncAllStatus.className = 'server-save-status success';
          let html = `<strong>✅ Sincronizare completă!</strong><br>`;
          html += `<span>📦 ${data.synced}/${data.total} asset-uri trimise</span>`;
          if (data.failed > 0) {
            html += `<br><span>⚠️ ${data.failed} au eșuat</span>`;
            data.errors.forEach(e => {
              html += `<br><small>• ${e.name}: ${e.error}</small>`;
            });
          }
          els.syncAllStatus.innerHTML = html;
          showToast('✅', `${data.synced} asset-uri sincronizate!`, 'success');
        } else {
          els.syncAllStatus.className = 'server-save-status success';
          els.syncAllStatus.innerHTML = `<strong>✅ ${data.message || 'Totul e sincronizat!'}</strong>`;
          showToast('✅', 'Toate asset-urile sunt deja sincronizate', 'success');
        }
      } else {
        els.syncAllStatus.className = 'server-save-status error';
        els.syncAllStatus.innerHTML = `<strong>❌ ${data.error}</strong>`;
        showToast('❌', data.error, 'error');
      }
    } catch (err) {
      els.syncAllStatus.className = 'server-save-status error';
      els.syncAllStatus.innerHTML = '<strong>❌ Eroare de rețea</strong>';
      showToast('❌', 'Eroare la sincronizare', 'error');
    }

    els.btnSyncAll.disabled = false;
    els.btnSyncAll.innerHTML = '<span>🚀</span> Sync All to Snipe-IT';
  });

})();
