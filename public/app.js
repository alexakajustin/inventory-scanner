// ══════════════════════════════════════════════════════════════
// Snipe-IT Barcode Scanner — Frontend Logic
// ══════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  let scanner = null;
  let isScanning = false;

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
    // Stop scanner immediately to prevent double-scans
    await stopScanner();

    // Vibrate for feedback
    if (navigator.vibrate) navigator.vibrate(200);

    showToast('🔍', `Cod scanat: ${decodedText}`, 'success');
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
        els.resultImage.src = data.image_url;
        els.resultImageWrapper.style.display = 'block';
      } else {
        els.resultImageWrapper.style.display = 'none';
      }

      // Source indicator
      if (data.source === 'cache') {
        showToast('📦', 'Rezultat din cache (nu s-a consumat un API call)', 'success');
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
    els.assetForm.reset();
    els.resultImageWrapper.style.display = 'none';
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
          <div class="asset-name">${escapeHtml(a.name)}</div>
          <div class="asset-meta">
            ${a.manufacturer ? `<span>${escapeHtml(a.manufacturer)}</span>` : ''}
            ${a.category ? `<span>${escapeHtml(a.category)}</span>` : ''}
            ${a.serial ? `<span>S/N: ${escapeHtml(a.serial)}</span>` : ''}
          </div>
        </div>
        <span class="asset-tag-badge">${escapeHtml(a.asset_tag || '')}</span>
        <div class="asset-actions">
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

})();
