// ══════════════════════════════════════════════════════════════
// Snipe-IT Barcode Scanner — Frontend Logic
// ══════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  let scanner = null;
  let ocrWorker = null;
  let isScanning = false;
  let isProcessingScan = false;
  let scanTarget = 'lookup'; // 'lookup' or 'serial'

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
    btnOcrScan: $('#btn-ocr-scan'),
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
    btnScanSn: $('#btn-scan-sn'),
    btnCopyBarcodeToSerial: $('#btn-copy-barcode-to-serial'),
    btnCopySerialToBarcode: $('#btn-copy-serial-to-barcode'),
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

  // ── Field Copy & Scan Actions ───────────────────────────────

  if (els.btnCopyBarcodeToSerial) {
    els.btnCopyBarcodeToSerial.addEventListener('click', () => {
      const val = els.fieldBarcode.value.trim();
      if (val) {
        els.fieldSerial.value = val;
        showToast('📋', 'Codul de bare a fost copiat în Serial Number', 'success');
      } else {
        showToast('⚠️', 'Câmpul Cod de bare este gol', 'error');
      }
    });
  }

  if (els.btnCopySerialToBarcode) {
    els.btnCopySerialToBarcode.addEventListener('click', () => {
      const val = els.fieldSerial.value.trim();
      if (val) {
        els.fieldBarcode.value = val;
        showToast('📋', 'Serial Number a fost copiat în Cod de bare', 'success');
      } else {
        showToast('⚠️', 'Câmpul Serial Number este gol', 'error');
      }
    });
  }

  if (els.btnScanSn) {
    els.btnScanSn.addEventListener('click', () => {
      startScanner('serial');
      els.scannerContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

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

  // ── Barcode & QR Scanner ─────────────────────────────────────

  els.btnStartScan.addEventListener('click', () => startScanner('lookup'));
  els.btnStopScan.addEventListener('click', stopScanner);
  if (els.btnOcrScan) {
    els.btnOcrScan.addEventListener('click', doOcrScan);
  }

  async function startScanner(target = 'lookup') {
    if (isScanning) return;
    scanTarget = target;

    try {
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.UPC_A
      ];

      scanner = new Html5Qrcode('reader', { formatsToSupport });

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          videoConstraints: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        },
        onScanSuccess,
        () => {} // ignore scan failures (normal during scanning)
      );

      isScanning = true;
      els.btnStartScan.style.display = 'none';
      els.btnStopScan.style.display = '';
      if (els.btnOcrScan) els.btnOcrScan.style.display = '';
      els.scannerContainer.classList.add('scanning');
      
      const scanLabel = target === 'serial' ? 'Scanați S/N sau apăsați butonul OCR' : 'Scanați Cod de bare / QR';
      showToast('📷', scanLabel, 'info');

      // Initialize OCR worker in background
      if (!ocrWorker && window.Tesseract) {
        initOcrWorker();
      }

    } catch (err) {
      console.error('Scanner error:', err);
      showToast('❌', 'Eroare cameră: ' + (err.message || err), 'error');
      stopScanner();
    }
  }

  async function initOcrWorker() {
    try {
      ocrWorker = await Tesseract.createWorker('eng');
      await ocrWorker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/- ',
      });
    } catch (e) {
      console.error("OCR init error:", e);
    }
  }

  async function doOcrScan() {
    if (!scanner || !isScanning) return;
    
    // Pause barcode scanner so it doesn't accidentally read random barcodes (like WWN) while we process OCR
    try {
      scanner.pause();
    } catch(e) {}

    // Get the video element from html5-qrcode
    const video = document.querySelector('#reader video');
    if (!video) {
      showToast('❌', 'Nu pot captura imaginea video', 'error');
      try { scanner.resume(); } catch(e) {}
      return;
    }

    try {
      if (els.btnOcrScan) els.btnOcrScan.disabled = true;
      showToast('🤖', 'Analizez imaginea cu Neural Engine 2...', 'info');

      // Create a canvas to grab high-res frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64Image = canvas.toDataURL('image/jpeg', 0.8);

      // Send base64 frame to Server OCR Engine 2
      const res = await fetch('/api/ocr-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });

      const data = await res.json();
      const text = data.text || '';
      
      // Smart S/N Extractor on High Quality OCR text
      function extractSmartSN(rawText) {
          // 1. Try explicit markers (S/N, SN, SIN, Serial, etc)
          const snRegex = /(?:S[\/\\I\|]?N|Serial|S\/N|S N)[\s:\-\.]*([A-Z0-9]{8,20})/i;
          let match = rawText.match(snRegex);
          if (match && match[1]) return match[1].replace(/[^A-Z0-9]/ig, '');
          
          // 2. Collect all plausible words
          const words = rawText.split(/[\s,\|»\n]+/).map(w => w.replace(/[^A-Z0-9]/ig, ''));
          const candidates = words.filter(w => w.length >= 8 && w.length <= 20);
          
          // 3. Filter out WWN (starts with 500, 16 hex chars) and purely numeric (EAN/UPC)
          const validCandidates = candidates.filter(w => {
              const isWWN = /^500[0-9A-F]{13}$/i.test(w);
              const isNumeric = /^\d+$/.test(w);
              return !isWWN && !isNumeric;
          });
          
          if (validCandidates.length > 0) {
              // Prefer strings with mixed letters and numbers
              validCandidates.sort((a, b) => {
                 let scoreA = (a.match(/[A-Z]/i) ? 1 : 0) + (a.match(/[0-9]/) ? 1 : 0);
                 let scoreB = (b.match(/[A-Z]/i) ? 1 : 0) + (b.match(/[0-9]/) ? 1 : 0);
                 return scoreB - scoreA;
              });
              return validCandidates[0];
          }
          
          return candidates.length > 0 ? candidates[0] : null;
      }

      const finalSN = extractSmartSN(text);

      if (finalSN) {
        showToast('✅', `Neural OCR S/N: ${finalSN}`, 'success');
        onScanSuccess(finalSN);
      } else {
        showToast('⚠️', 'Nu s-a găsit S/N în imagine.', 'error');
        console.log("Neural OCR Text:\n", text);
      }
    } catch (err) {
      console.error('OCR Error:', err);
      showToast('❌', 'Eroare OCR: ' + err.message, 'error');
    } finally {
      if (els.btnOcrScan) els.btnOcrScan.disabled = false;
      try { scanner.resume(); } catch(e) {}
    }
  }

  async function stopScanner() {
    if (!isScanning) return;
    isScanning = false;
    
    try {
      if (scanner) {
        await scanner.stop();
        scanner.clear();
      }
    } catch (e) {}

    els.btnStartScan.style.display = '';
    els.btnStopScan.style.display = 'none';
    if (els.btnOcrScan) els.btnOcrScan.style.display = 'none';
    els.scannerContainer.classList.remove('scanning');
  }

  async function onScanSuccess(decodedText) {
    if (isProcessingScan) return;

    // Smart Filter: Ignore WWN & EAN when explicitly hunting for Serial Number
    if (scanTarget === 'serial') {
      const isWWN = /^500[0-9A-F]{13}$/i.test(decodedText);
      const isUPCEAN = /^\d{12,14}$/.test(decodedText);
      if (isWWN || isUPCEAN) {
        console.log(`Ignorat automat cod EAN/WWN nedorit: ${decodedText}`);
        return; // Scanner keeps running!
      }
    }

    isProcessingScan = true;

    // Stop scanner immediately to prevent double-scans
    await stopScanner();

    // Vibrate for feedback
    if (navigator.vibrate) navigator.vibrate(200);

    if (scanTarget === 'serial') {
      isProcessingScan = false;
      els.fieldSerial.value = decodedText;
      showToast('✅', `S/N scanat: ${decodedText}`, 'success');
      scanTarget = 'lookup';
      if (els.scanResult.style.display !== 'none') {
        els.scanResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

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
      const resp = await fetch(`/api/lookup?barcode=${encodeURIComponent(barcode)}`);
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
      if (data.parsedSerial) {
        els.fieldSerial.value = data.parsedSerial;
      }

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
      if (data.warning) {
        statusEl.innerHTML = `<span class="status-icon">⚠️</span><span class="status-text">${data.warning}</span>`;
        statusEl.className = 'result-status not-found';
      } else {
        statusEl.innerHTML = '<span class="status-icon">ℹ️</span><span class="status-text">Cod preluat (S/N / QR / Barcode) — completează detaliile</span>';
        statusEl.className = 'result-status not-found';
      }

      // Clear form but keep barcode and auto-detect S/N
      els.fieldName.value = '';
      els.fieldManufacturer.value = '';
      els.fieldModel.value = '';
      els.fieldModelNumber.value = '';
      els.fieldBarcode.value = data.barcode || '';
      els.fieldCategory.value = 'Uncategorized';
      
      const isLikelySerial = data.parsedSerial || (data.barcode && !/^\d{8,14}$/.test(data.barcode));
      els.fieldSerial.value = data.parsedSerial || (isLikelySerial ? data.barcode : '');

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
