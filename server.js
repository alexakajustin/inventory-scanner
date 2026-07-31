const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const cors = require('cors');
const { generateCerts } = require('./generate-cert');
const db = require('./db');
const SnipeITClient = require('./snipeit-client');

// Helper to get a configured Snipe-IT client
function getSnipeClient() {
  const url = db.getSetting('snipeit_url');
  const key = db.getSetting('snipeit_apikey');
  if (!url || !key) return null;
  return new SnipeITClient(url, key);
}

const app = express();
const HTTP_PORT = 8180;
const HTTPS_PORT = 8181;

// ── Middleware ────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Barcode Lookup ──────────────────────────────────────────

// ── API: Barcode / S/N / QR Lookup ───────────────────────────────

app.post('/api/log-ocr', (req, res) => {
  console.log(`\n🤖 [OCR DETECTAT]:\n====================\n${req.body.text}\n====================\n`);
  res.json({ success: true });
});

app.post('/api/ocr-scan', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Fără imagine' });

  try {
    const formData = new URLSearchParams();
    formData.append('base64Image', image);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2'); // Deep Learning Engine 2 for numbers/S/N
    formData.append('scale', 'true');
    formData.append('detectOrientation', 'true');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'apikey': 'helloworld',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    });

    const data = await response.json();
    if (data && data.ParsedResults && data.ParsedResults.length > 0) {
      const parsedText = data.ParsedResults[0].ParsedText || '';
      console.log(`\n🤖 [OCR ENGINE 2 HIGH-PRECISION]:\n====================\n${parsedText}\n====================\n`);
      return res.json({ text: parsedText });
    } else {
      console.error("❌ OCR.space a returnat o eroare sau n-a gasit nimic:", data);
      return res.json({ text: '' });
    }
  } catch (err) {
    console.error("OCR API error:", err);
    return res.status(500).json({ error: err.message });
  }
});

if (fs.existsSync('.env')) {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace('\r', '');
  });
}

// --- GEMINI AI CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash"
];

async function executeGeminiWithFallback(payload) {
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      
      if (data.error) {
        const errType = data.error.status || data.error.code || 'ERROR';
        console.warn(`⚠️ [${errType}] Model ${model} a eșuat. Trecem la următorul...`);
        lastError = data.error;
        continue; // Fallback to next model for ANY error (404, 503, 429, etc)
      }
      
      console.log(`✅ Succes cu modelul: ${model}`);
      return { data };
    } catch (err) {
      console.error(`❌ Network/Fetch error cu modelul ${model}:`, err);
      lastError = err;
    }
  }
  return { error: lastError || { message: 'Toate modelele au picat.', code: 429 } };
}

async function askGeminiText(text) {
  if (GEMINI_API_KEY === "PUNE_CHEIA_AICI" || !GEMINI_API_KEY) return null;
  const prompt = `
Analizează textul următor (informații obținute de la un cod de bare pentru un produs hardware/IT).
Extrage informațiile și răspunde STRICT cu un obiect JSON valid, fără formatare markdown, care să conțină:
- "manufacturer": Producătorul.
- "model": Modelul sau capacitatea produsului.
- "part_number": Part Number (P/N), dacă există.
- "category": Alege CEA MAI POTRIVITĂ categorie STRICT din: Laptop, Desktop, Server, Workstation, Monitor, CPU, GPU, RAM, SSD, HDD, Motherboard, Power Supply, Router, Switch, Access Point, Firewall, NAS, Keyboard, Mouse, Headset, Webcam, Docking Station, Printer, Scanner, Projector, Phone - VoIP, Smartphone, Tablet, Chair, Desk, Cabinet, Toolbox, Cable, Adapter, UPS. TREBUIE să alegi una din ele, ghicește dacă nu ești sigur. NU pune Uncategorized.
- "estimated_price": Estimează prețul de piață (în RON) pentru acest produs. Returnează DOAR un număr întreg. TREBUIE să dai un preț estimat, oricât de vag. Nu pune null.
Dacă nu găsești restul (producător, model, etc), poți pune null pentru ele.

Date produs:
${text}
  `;
  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    };
    
    const result = await executeGeminiWithFallback(payload);
    if (result.error) {
       console.error("❌ Gemini API Error in UPC lookup:", result.error);
       return null;
    }
    
    const data = result.data;
    let rawText = data.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    
    return JSON.parse(rawText);
  } catch (err) {
    console.error("❌ Gemini Text Parse Error:", err);
    return null;
  }
}

app.post('/api/parse-ocr', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });
  
  if (GEMINI_API_KEY === "PUNE_CHEIA_AICI" || !GEMINI_API_KEY) {
     return res.status(500).json({ error: 'Gemini API Key lipseste din server.js! Pune cheia în variabila GEMINI_API_KEY.' });
  }

  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    
    const prompt = `
Analizează imaginea de mai jos, care conține o componentă hardware/echipament IT (sau eticheta acesteia).
Extrage informațiile de pe etichetă și răspunde STRICT cu un obiect JSON valid, fără formatare markdown, care să conțină următoarele chei:
- "manufacturer": Producătorul (ex. SAMSUNG, KINGMAX, ASUS, CORSAIR, Goobay). Dacă nu-l găsești, pune null.
- "model": Modelul sau capacitatea produsului (ex. 850 EVO 250GB, MZ-75E250). Dacă nu-l găsești, pune null.
- "serial": Numărul de serie (Serial Number / S/N). FOARTE IMPORTANT: Chiar dacă nu scrie explicit "S/N", dacă observi un șir de caractere/cifre (ex. lângă un cod de bare) care identifică produsul, extrage-l aici! Ignoră codurile WWN (ex. 500...). Dacă nu găsești nimic care să semene a serie sau cod de bare, pune null.
- "part_number": Part Number (P/N / Art. No), dacă există. Altfel null.
- "category": Alege CEA MAI POTRIVITĂ categorie STRICT din următoarea listă: Laptop, Desktop, Server, Workstation, Monitor, CPU, GPU, RAM, SSD, HDD, Motherboard, Power Supply, Router, Switch, Access Point, Firewall, NAS, Keyboard, Mouse, Headset, Webcam, Docking Station, Printer, Scanner, Projector, Phone - VoIP, Smartphone, Tablet, Chair, Desk, Cabinet, Toolbox, Cable, Adapter, UPS. TREBUIE să alegi una, ghicește dacă nu ești sigur.
- "estimated_price": Estimează prețul de piață (în RON) pentru acest produs. Returnează DOAR un număr întreg (ex. 150, 45, 2000). TREBUIE să estimezi un preț oricât de vag. Nu pune null.
    `;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const result = await executeGeminiWithFallback(payload);

    if (result.error) {
        console.error("Gemini API Error:", result.error);
        if (result.error.code === 429 || (result.error.status && result.error.status.includes('EXHAUSTED'))) {
           return res.status(429).json({ error: 'Toate modelele (3.6, 3.5, 3.1, etc.) și-au atins limita de scanări. Te rog așteaptă un minut!' });
        }
        return res.status(500).json({ error: result.error.message || 'Eroare necunoscută API Gemini' });
    }

    const data = result.data;
    const aiText = data.candidates[0].content.parts[0].text;
    const rawText = aiText.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(rawText);
    
    console.log(`\n🧠 [GEMINI AI VISION PARSED]:\n====================\n${JSON.stringify(parsed, null, 2)}\n====================\n`);
    return res.json(parsed);

  } catch (err) {
    console.error("Gemini Parse error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get(['/api/lookup', '/api/lookup/:barcode(*)'], async (req, res) => {
  let barcode = req.params.barcode || req.query.barcode || req.query.code;

  if (!barcode || !barcode.trim()) {
    return res.status(400).json({ error: 'Cod invalid' });
  }

  barcode = barcode.trim();

  // Verificăm dacă Auto-Scan este oprit din client
  const autoscanParam = req.query.autoscan;
  const isManual = req.query.manual === 'true' || req.query.manual === '1';
  
  if (autoscanParam === 'false' && !isManual) {
    console.log(`⏸️ [BACKEND] Auto-Scan este OPRIT pe client. Refuzăm căutarea automată Snipe-IT/Cache pentru: ${barcode}`);
    return res.json({ found: false, autoscanDisabled: true, barcode });
  }
  let parsedSerial = null;
  let parsedBarcode = barcode;

  if (barcode.startsWith('http://') || barcode.startsWith('https://')) {
    try {
      const u = new URL(barcode);
      const snParam = u.searchParams.get('sn') || u.searchParams.get('serial') || u.searchParams.get('code') || u.searchParams.get('asset');
      if (snParam) parsedSerial = snParam;
    } catch(e) {}
  } else if (/^(s\/n|sn|serial)[:\s-]+/i.test(barcode)) {
    parsedSerial = barcode.replace(/^(s\/n|sn|serial)[:\s-]+/i, '').trim();
  }

  // Check Snipe-IT First!
  const snipeClient = getSnipeClient();
  if (snipeClient) {
    console.log(`🌐 Caut în Snipe-IT seria sau eticheta: ${parsedSerial || barcode}...`);
    try {
      let snipeAsset = null;
      if (parsedSerial) {
        snipeAsset = await snipeClient.findAssetBySerial(parsedSerial);
      }
      if (!snipeAsset) {
        snipeAsset = await snipeClient.findAssetByTag(barcode); // If barcode is actually an asset tag
      }
      if (!snipeAsset && !parsedSerial) {
        snipeAsset = await snipeClient.findAssetBySerial(barcode); // Sometimes barcode IS the serial
      }

      if (snipeAsset) {
        console.log(`✅ Găsit în Snipe-IT! ID: ${snipeAsset.id}, Nume: ${snipeAsset.name}`);
        const result = {
          source: 'snipeit',
          found: true,
          snipeit_id: snipeAsset.id,
          barcode: barcode,
          parsedSerial: snipeAsset.serial || parsedSerial,
          name: snipeAsset.name || '',
          manufacturer: snipeAsset.model?.manufacturer?.name || '',
          model_name: snipeAsset.model?.name || '',
          category: snipeAsset.category?.name || '',
          notes: snipeAsset.notes || '',
          lowest_price: snipeAsset.purchase_cost || '',
          raw_snipeit: snipeAsset,
        };
        // Also cache it locally to speed up future lookups
        db.setCachedLookup(barcode, result);
        return res.json(result);
      }
    } catch (err) {
       console.error(`⚠️ Eroare la căutarea în Snipe-IT: ${err.message}`);
    }
  }

  // Check cache locally
  const cached = db.getCachedLookup(barcode);
  if (cached) {
    console.log(`📦 Cache hit for barcode: ${barcode}`);

    let updatedCache = false;
    if (cached.image_url) {
      if (cached.image_url.startsWith('http://') || cached.image_url.startsWith('https://')) {
        const localPath = await downloadImage(cached.image_url, barcode);
        if (localPath) {
          cached.image_url = localPath;
          updatedCache = true;
        }
      } else if (cached.image_url.startsWith('/images/')) {
        const localFilePath = path.join(__dirname, 'public', cached.image_url);
        if (!fs.existsSync(localFilePath) && cached.raw && cached.raw.images && cached.raw.images.length > 0) {
          const localPath = await downloadImage(cached.raw.images[0], barcode);
          if (localPath) {
            cached.image_url = localPath;
            updatedCache = true;
          }
        }
      }
    }

    if (!cached.ai) {
      console.log(`🤖 Cache-ul e vechi (fără AI). Facem cerere Gemini pentru codul: ${barcode}...`);
      let textToParse = '';
      if (cached.found) {
         textToParse = `Nume: ${cached.name || ''}\nBrand: ${cached.manufacturer || ''}\nModel: ${cached.model_name || ''}\nDescriere: ${cached.description || ''}`;
      } else {
         textToParse = `Cod scanat: ${barcode}\n(Încearcă să deduci producător, model, categorie sau preț, altfel inventează/ghicește o categorie IT și un preț mediu)`;
      }
      
      const aiData = await askGeminiText(textToParse);
      if (aiData) {
         console.log(`🧠 [GEMINI AI UPGRADE PARSED]:\n====================\n${JSON.stringify(aiData, null, 2)}\n====================\n`);
         cached.ai = aiData;
         
         if (cached.found) {
           if (aiData.manufacturer) cached.manufacturer = aiData.manufacturer;
           if (aiData.model) cached.model_name = aiData.model;
           if (aiData.category && aiData.category !== 'Uncategorized') cached.category = aiData.category;
           if (aiData.estimated_price) cached.lowest_price = aiData.estimated_price;
         }
         updatedCache = true;
      }
    }

    if (updatedCache) {
      db.setCachedLookup(barcode, cached);
    }

    return res.json({ source: 'cache', ...cached, parsedSerial });
  }

  // Only query UPCitemdb if it looks like a numeric UPC/EAN (8-14 digits)
  const isNumericBarcode = /^\d{8,14}$/.test(barcode);

  if (!isNumericBarcode) {
    console.log(`ℹ️ Non-numeric code or S/N/QR scanned (${barcode}), skipping UPC lookup.`);
    let notFound = { found: false, barcode: barcode, parsedSerial };
    
    // Fallback la Gemini direct pe codul brut
    const textToParse = `Cod scanat: ${barcode}\n(Nu este un cod UPC valid. Încearcă să deduci producător, model, categorie sau preț dacă recunoști vreo componentă în acest cod, altfel inventează/ghicește o categorie IT și un preț mediu)`;
    console.log(`🤖 Cerere Gemini (fallback brut) pentru codul: ${barcode}...`);
    const aiData = await askGeminiText(textToParse);
    if (aiData) {
       console.log(`🧠 [GEMINI AI FALLBACK PARSED]:\n====================\n${JSON.stringify(aiData, null, 2)}\n====================\n`);
       notFound.ai = aiData;
    }
    db.setCachedLookup(barcode, notFound);
    return res.json({ source: 'local', ...notFound });
  }

  try {
    console.log(`🔍 Looking up barcode: ${barcode}`);

    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      let notFound = { source: 'api', found: false, barcode: barcode, parsedSerial };
      if (response.status === 429) {
        notFound.warning = 'Limita de căutări UPC API atinsă.';
      }
      
      const textToParse = `Cod scanat: ${barcode}\n(Nu a putut fi găsit în baza UPC. Ghicește o categorie și un preț estimativ)`;
      console.log(`🤖 Cerere Gemini (fallback API fail) pentru codul: ${barcode}...`);
      const aiData = await askGeminiText(textToParse);
      if (aiData) {
         console.log(`🧠 [GEMINI AI FALLBACK PARSED]:\n====================\n${JSON.stringify(aiData, null, 2)}\n====================\n`);
         notFound.ai = aiData;
      }
      db.setCachedLookup(barcode, notFound);
      return res.json(notFound);
    }

    const data = await response.json();

    if (data.code === 'OK' && data.items && data.items.length > 0) {
      const item = data.items[0];

      let image_url = (item.images && item.images.length > 0) ? item.images[0] : null;

      if (image_url) {
        const localPath = await downloadImage(image_url, barcode);
        if (localPath) {
          image_url = localPath;
        }
      }

      const result = {
        found: true,
        barcode: barcode,
        parsedSerial: parsedSerial,
        name: item.title || 'Unknown Product',
        manufacturer: item.brand || extractBrand(item.title),
        model_name: item.model || extractModel(item.title),
        model_number: item.model || '',
        category: item.category || guessCategory(item.title),
        description: item.description || '',
        image_url: image_url,
        lowest_price: item.lowest_recorded_price || null,
        highest_price: item.highest_recorded_price || null,
        raw: item,
      };
      
      // Enhance with Gemini!
      const textToParse = `Nume: ${item.title}\nBrand: ${item.brand || ''}\nModel: ${item.model || ''}\nDescriere: ${item.description || ''}`;
      console.log(`🤖 Cerere Gemini pentru codul de bare: ${barcode}...`);
      const aiData = await askGeminiText(textToParse);
      
      if (aiData) {
         console.log(`🧠 [GEMINI AI UPC PARSED]:\n====================\n${JSON.stringify(aiData, null, 2)}\n====================\n`);
         result.ai = aiData;
         // Overwrite basic guesses with AI guesses if AI found something better
         if (aiData.manufacturer) result.manufacturer = aiData.manufacturer;
         if (aiData.model) result.model_name = aiData.model;
         if (aiData.category && aiData.category !== 'Uncategorized') result.category = aiData.category;
         if (aiData.estimated_price) result.lowest_price = aiData.estimated_price;
      } else {
         result.warning = "⚠️ Gemini AI a atins limita de cereri pe minut. Prețul și categoria sunt date brute (nefiltrate).";
      }

      db.setCachedLookup(barcode, result);

      return res.json({ source: 'api', ...result });
    } else {
      let notFound = { found: false, barcode: barcode, parsedSerial };
      const textToParse = `Cod scanat: ${barcode}\n(Produs inexistent în UPC. Ghicește o categorie și un preț estimativ)`;
      console.log(`🤖 Cerere Gemini (fallback API empty) pentru codul: ${barcode}...`);
      const aiData = await askGeminiText(textToParse);
      if (aiData) {
         console.log(`🧠 [GEMINI AI FALLBACK PARSED]:\n====================\n${JSON.stringify(aiData, null, 2)}\n====================\n`);
         notFound.ai = aiData;
      }
      db.setCachedLookup(barcode, notFound);
      return res.json({ source: 'api', ...notFound });
    }
  } catch (err) {
    console.error('❌ Lookup error:', err.message);
    return res.json({ source: 'api', found: false, barcode: barcode, parsedSerial, error: err.message });
  }
});

// ── API: Assets CRUD ─────────────────────────────────────────────

// Create asset
app.post('/api/assets', async (req, res) => {
  try {
    const result = db.createAsset(req.body);

    // Auto-sync to Snipe-IT if enabled
    let snipeitId = null;
    const autoSync = db.getSetting('snipeit_autosync');
    if (autoSync === 'true') {
      try {
        const client = getSnipeClient();
        if (client) {
          const asset = db.getAssetById(result.id);
          snipeitId = await client.pushAsset(asset);
          db.updateAssetSnipeId(result.id, snipeitId);
          console.log(`✅ Auto-synced to Snipe-IT: ${snipeitId}`);
        }
      } catch (syncErr) {
        console.error('⚠️ Auto-sync failed:', syncErr.message);
        // Don't fail the whole request, asset is still saved locally
      }
    }

    res.status(201).json({ success: true, ...result, snipeit_id: snipeitId });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Asset tag already exists' });
    }
    console.error('❌ Create error:', err.message);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// Get all assets
app.get('/api/assets', (req, res) => {
  const { q } = req.query;
  const assets = q ? db.searchAssets(q) : db.getAllAssets();
  res.json({ count: assets.length, assets });
});

// Get single asset
app.get('/api/assets/:id', (req, res) => {
  const asset = db.getAssetById(parseInt(req.params.id));
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});

// Update asset
app.put('/api/assets/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const updated = db.updateAsset(id, req.body);
  if (!updated) return res.status(404).json({ error: 'Asset not found or no changes' });

  // Auto-sync edit to Snipe-IT if enabled or already synced
  const asset = db.getAssetById(id);
  if (asset && (db.getSetting('snipeit_autosync') === 'true' || asset.snipeit_id)) {
    try {
      const client = getSnipeClient();
      if (client) {
        const snipeitId = await client.pushAsset(asset);
        if (!asset.snipeit_id) {
          db.updateAssetSnipeId(id, snipeitId);
        }
      }
    } catch (syncErr) {
      console.error('⚠️ Auto-sync update failed:', syncErr.message);
    }
  }

  res.json({ success: true });
});

// Delete asset
app.delete('/api/assets/:id', (req, res) => {
  const deleted = db.deleteAsset(parseInt(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Asset not found' });
  res.json({ success: true });
});

// ── API: Export ───────────────────────────────────────────────────

app.get('/api/export/csv', (req, res) => {
  const assets = db.getAllAssets();

  if (assets.length === 0) {
    return res.status(404).json({ error: 'No assets to export' });
  }

  // Snipe-IT compatible CSV headers
  const headers = [
    'Item Name',
    'Asset Tag',
    'Serial Number',
    'Manufacturer',
    'Model Name',
    'Model Number',
    'Category',
    'Status',
    'Purchase Cost',
    'Notes',
  ];

  const rows = assets.map(a => [
    csvEscape(a.name),
    csvEscape(a.asset_tag),
    csvEscape(a.serial),
    csvEscape(a.manufacturer),
    csvEscape(a.model_name),
    csvEscape(a.model_number),
    csvEscape(a.category),
    csvEscape(a.status),
    a.purchase_cost || '',
    csvEscape(a.notes),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="snipeit-import-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// Save CSV to server filesystem
app.post('/api/export/save', (req, res) => {
  const assets = db.getAllAssets();

  if (assets.length === 0) {
    return res.status(404).json({ error: 'No assets to export' });
  }

  const headers = [
    'Item Name', 'Asset Tag', 'Serial Number', 'Manufacturer',
    'Model Name', 'Model Number', 'Category', 'Status', 'Purchase Cost', 'Notes',
  ];

  const rows = assets.map(a => [
    csvEscape(a.name), csvEscape(a.asset_tag), csvEscape(a.serial),
    csvEscape(a.manufacturer), csvEscape(a.model_name), csvEscape(a.model_number),
    csvEscape(a.category), csvEscape(a.status), a.purchase_cost || '', csvEscape(a.notes),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  // Save to exports folder next to server.js
  const exportsDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

  const filename = `snipeit-import-${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = path.join(exportsDir, filename);
  fs.writeFileSync(filePath, csv, 'utf-8');

  console.log(`💾 CSV salvat pe server: ${filePath}`);
  res.json({ success: true, path: filePath, filename, assets: assets.length });
});

// ── API: Stats ───────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const total = db.getAssetCount();
  const assets = db.getAllAssets();
  const manufacturers = [...new Set(assets.map(a => a.manufacturer).filter(Boolean))];
  const categories = [...new Set(assets.map(a => a.category).filter(Boolean))];

  res.json({
    total,
    manufacturers: manufacturers.length,
    categories: categories.length,
    topManufacturers: manufacturers.slice(0, 10),
  });
});

// ── API: Settings ───────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const settings = db.getAllSettings();
  // Don't expose full API key to frontend
  if (settings.snipeit_apikey) {
    const key = settings.snipeit_apikey;
    settings.snipeit_apikey_masked = key.length > 8
      ? key.substring(0, 4) + '...' + key.substring(key.length - 4)
      : '****';
    settings.snipeit_apikey_set = 'true';
  }
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const { snipeit_url, snipeit_apikey, snipeit_autosync } = req.body;

  if (snipeit_url !== undefined) db.setSetting('snipeit_url', snipeit_url.replace(/\/+$/, ''));
  if (snipeit_apikey !== undefined && snipeit_apikey !== '') db.setSetting('snipeit_apikey', snipeit_apikey);
  if (snipeit_autosync !== undefined) db.setSetting('snipeit_autosync', String(snipeit_autosync));

  res.json({ success: true });
});

// ── API: Snipe-IT Integration ───────────────────────────────────

app.post('/api/snipeit/test', async (req, res) => {
  const client = getSnipeClient();
  if (!client) {
    return res.status(400).json({ success: false, message: 'Configurează URL-ul și API Key-ul mai întâi' });
  }
  const result = await client.testConnection();
  res.json(result);
});

app.post('/api/snipeit/push/:id', async (req, res) => {
  const client = getSnipeClient();
  if (!client) {
    return res.status(400).json({ error: 'Snipe-IT nu este configurat' });
  }

  const asset = db.getAssetById(parseInt(req.params.id));
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  if (asset.snipeit_id) {
    return res.status(409).json({ error: 'Asset-ul este deja sincronizat', snipeit_id: asset.snipeit_id });
  }

  try {
    const snipeitId = await client.pushAsset(asset);
    db.updateAssetSnipeId(asset.id, snipeitId);
    res.json({ success: true, snipeit_id: snipeitId });
  } catch (err) {
    console.error('❌ Push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/snipeit/push-all', async (req, res) => {
  const client = getSnipeClient();
  if (!client) {
    return res.status(400).json({ error: 'Snipe-IT nu este configurat' });
  }

  let pulled = 0;
  let pushed = 0;
  const errors = [];

  // Step 1: PULL from Snipe-IT
  try {
    const remoteAssets = await client.pullAllAssets();
    for (const remote of remoteAssets) {
      try {
        db.upsertAssetFromSnipeIT(remote);
        pulled++;
      } catch (dbErr) {
        console.error(`❌ DB Upsert failed for ID ${remote.id}:`, dbErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Pull all failed:', err.message);
    errors.push({ action: 'pull', error: err.message });
  }

  // Step 2: PUSH unsynced assets to Snipe-IT
  const unsynced = db.getUnsyncedAssets();
  for (const asset of unsynced) {
    try {
      const snipeitId = await client.pushAsset(asset);
      db.updateAssetSnipeId(asset.id, snipeitId);
      pushed++;
    } catch (err) {
      console.error(`❌ Push failed for "${asset.name}":`, err.message);
      errors.push({ name: asset.name, action: 'push', error: err.message });
    }
  }

  res.json({
    success: true,
    pulled,
    pushed,
    failed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ── SPA Fallback ─────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Helper Functions ─────────────────────────────────────────────

function extractBrand(title) {
  if (!title) return '';
  const knownBrands = [
    'Samsung', 'Kingston', 'Corsair', 'Crucial', 'Western Digital', 'WD',
    'Seagate', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Gigabyte',
    'Intel', 'AMD', 'NVIDIA', 'LG', 'BenQ', 'ViewSonic', 'Logitech',
    'Microsoft', 'Apple', 'Cisco', 'Ubiquiti', 'MikroTik', 'TP-Link',
    'Netgear', 'APC', 'Eaton', 'Brother', 'Canon', 'Epson', 'Xerox',
    'G.Skill', 'TeamGroup', 'PNY', 'SanDisk', 'Toshiba', 'Hynix',
    'Micron', 'EVGA', 'Sapphire', 'Zotac', 'Razer', 'HyperX',
  ];
  for (const brand of knownBrands) {
    if (title.toLowerCase().includes(brand.toLowerCase())) {
      return brand;
    }
  }
  return title.split(' ')[0]; // Fallback: first word
}

function extractModel(title) {
  if (!title) return '';
  // Remove common brand names and return the rest as model
  const cleaned = title.replace(/\b(Samsung|Kingston|Corsair|Crucial|Western Digital|WD|Dell|HP|Lenovo|Asus|Acer)\b/gi, '').trim();
  // Limit to first 60 chars
  return cleaned.substring(0, 60).trim();
}

function guessCategory(title) {
  if (!title) return 'Uncategorized';
  const t = title.toLowerCase();
  if (t.includes('ram') || t.includes('memory') || t.includes('ddr')) return 'RAM';
  if (t.includes('ssd') || t.includes('solid state')) return 'SSD';
  if (t.includes('hdd') || t.includes('hard drive') || t.includes('hard disk')) return 'HDD';
  if (t.includes('laptop') || t.includes('notebook')) return 'Laptop';
  if (t.includes('desktop') || t.includes('tower') || t.includes('workstation')) return 'Desktop';
  if (t.includes('monitor') || t.includes('display')) return 'Monitor';
  if (t.includes('switch')) return 'Switch';
  if (t.includes('router')) return 'Router';
  if (t.includes('access point') || t.includes('wifi') || t.includes('wi-fi')) return 'Access Point';
  if (t.includes('keyboard')) return 'Keyboard';
  if (t.includes('mouse')) return 'Mouse';
  if (t.includes('headset') || t.includes('headphone')) return 'Headset';
  if (t.includes('webcam') || t.includes('camera')) return 'Webcam';
  if (t.includes('printer')) return 'Printer';
  if (t.includes('scanner')) return 'Scanner';
  if (t.includes('ups') || t.includes('battery backup')) return 'UPS';
  if (t.includes('server')) return 'Server';
  if (t.includes('phone') || t.includes('smartphone')) return 'Smartphone';
  if (t.includes('tablet') || t.includes('ipad')) return 'Tablet';
  if (t.includes('dock')) return 'Docking Station';
  if (t.includes('cable')) return 'Cable';
  if (t.includes('adapter')) return 'Adapter';
  return 'Uncategorized';
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Image Download Helper ────────────────────────────────────────

async function downloadImage(imageUrl, barcode) {
  try {
    const imagesDir = path.join(__dirname, 'public', 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    // Determine extension from URL
    let ext = '.jpg';
    try {
      const urlPath = new URL(imageUrl).pathname;
      const urlExt = path.extname(urlPath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(urlExt)) {
        ext = urlExt;
      }
    } catch { /* ignore */ }

    const filename = `${barcode}${ext}`;
    const filePath = path.join(imagesDir, filename);

    // Don't re-download if already exists
    if (fs.existsSync(filePath)) {
      console.log(`🖼️ Image already exists: ${filename}`);
      return `/images/${filename}`;
    }

    console.log(`🖼️ Downloading image for ${barcode}...`);

    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      console.error(`❌ Image download failed: ${imgResp.status}`);
      return null;
    }

    const buffer = Buffer.from(await imgResp.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ Image saved: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

    return `/images/${filename}`;
  } catch (err) {
    console.error(`❌ Image download error: ${err.message}`);
    return null;
  }
}

// ── Get local network IPs ────────────────────────────────────────

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// ── Start Server ─────────────────────────────────────────────

async function startServer() {
  // Initialize database first
  await db.initDb();
  console.log('✅ Database initialized');

  // HTTP server (for localhost only)
  http.createServer(app).listen(HTTP_PORT, () => {
    console.log(`\n🌐 HTTP server: http://localhost:${HTTP_PORT}`);
  });

  // HTTPS server (for phone access)
  try {
    const certs = generateCerts();
    https.createServer({ key: certs.key, cert: certs.cert }, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      const ips = getLocalIPs();
      console.log(`🔒 HTTPS server: https://localhost:${HTTPS_PORT}`);
      console.log('');
      console.log('📱 Deschide pe telefon (trebuie să fii pe aceeași rețea Wi-Fi):');
      ips.forEach(ip => {
        console.log(`   👉 https://${ip}:${HTTPS_PORT}`);
      });
      console.log('');
      console.log('⚠️  La prima accesare de pe telefon, acceptă avertismentul de certificat SSL.');
      console.log('');
    });
  } catch (err) {
    console.error('❌ Failed to start HTTPS server:', err.message);
    console.log('📱 Phone scanning will not work without HTTPS.');
    console.log('   The HTTP server is still running on localhost.');
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  db.closeDb();
  process.exit(0);
});

startServer();
