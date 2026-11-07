import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// 5-minute TTL for cached sheet data
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// In-flight request deduplication map
const pendingRequests = new Map();

app.use(cors());
app.use(express.json());

// Master Configuration Sheet containing RegionConfig and UserConfig tabs
const MASTER_SPREADSHEET_ID = '1TrsDRv-aoCxPLzCp0ma6JlwamJPT13JuKuIda-5Uvdg';
const DATA_VAL_TAB = 'Data Val (Cable Replacement)';

// Exponential backoff & jitter configuration for Google APIs
const googleRetryConfig = {
  retry: 4,
  retryDelay: (err) => {
    const currentAttempt = err.config?.currentRetryAttempt || 1;
    const baseDelay = 1000 * Math.pow(2, currentAttempt - 1);
    const jitter = Math.floor(Math.random() * 500);
    return baseDelay + jitter;
  },
  statusCodesToRetry: [
    [429, 429],
    [500, 503],
  ],
  onRetryAttempt: (err) => {
    const status = err.response?.status || err.code;
    const attempt = err.config?.currentRetryAttempt || 1;
    console.warn(
      `[GOOGLE API RETRY] HTTP ${status} encountered on ${err.config?.url}. Backing off and retrying attempt #${attempt}...`
    );
  },
};

const getSheetsClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });

  return google.sheets({
    version: 'v4',
    auth: oauth2Client,
    retryConfig: googleRetryConfig,
  });
};

const getDriveClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });

  return google.drive({
    version: 'v3',
    auth: oauth2Client,
    retryConfig: googleRetryConfig,
  });
};

// Retrieve and cache user email from OAuth access token
async function getUserEmailFromAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const cacheKey = `user_email_${token.substring(0, 24)}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  const tokenInfo = await oauth2Client.getTokenInfo(token);
  const email = (tokenInfo.email || '').toLowerCase().trim();

  if (!email) {
    throw new Error('Unable to extract verified email from Google authorization token.');
  }

  cache.set(cacheKey, email, 600); // Cache email resolution for 10 minutes
  return email;
}

// Fetch and cache Master Configuration (RegionConfig & UserConfig)
async function getMasterConfig(sheets, forceRefresh = false) {
  const cacheKey = 'master_config_bundle';

  if (forceRefresh) {
    cache.del(cacheKey);
  }

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  console.log('[MASTER CONFIG] Batch-fetching RegionConfig and UserConfig...');
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: MASTER_SPREADSHEET_ID,
    ranges: ["'RegionConfig'!A1:Z", "'UserConfig'!A1:Z"],
  });

  const valueRanges = response.data.valueRanges || [];
  const regionRows = valueRanges[0]?.values || [];
  const userRows = valueRanges[1]?.values || [];

  // Dynamic Header Mapping for RegionConfig (Col A: Region ID, Col B: Region Name, Col C: Spreadsheet ID, Col D: Folder ID)
  const regHeaders = (regionRows[0] || []).map((h) => String(h || '').trim().toLowerCase());
  let idCol = regHeaders.findIndex(
    (h) => h === 'region id' || (h.includes('id') && !h.includes('sheet') && !h.includes('folder'))
  );
  if (idCol === -1) idCol = 0;
  let nameCol = regHeaders.findIndex((h) => h.includes('name'));
  if (nameCol === -1) nameCol = 1;
  let sheetIdCol = regHeaders.findIndex((h) => h.includes('sheet'));
  if (sheetIdCol === -1) sheetIdCol = 2;
  let folderIdCol = regHeaders.findIndex((h) => h.includes('folder'));
  if (folderIdCol === -1) folderIdCol = 3;

  const regions = [];
  if (regionRows.length > 1) {
    for (let r = 1; r < regionRows.length; r++) {
      const row = regionRows[r];
      const id = String(row[idCol] || '').trim().toLowerCase();
      const name = String(row[nameCol] || '').trim();
      const spreadsheetId = String(row[sheetIdCol] || '').trim();
      const folderId = folderIdCol !== -1 ? String(row[folderIdCol] || '').trim() : '';

      // Skip entries without spreadsheet IDs and exclude the master configuration sheet itself
      if (id && spreadsheetId && id !== 'master' && spreadsheetId !== MASTER_SPREADSHEET_ID) {
        regions.push({ id, name: name || id, spreadsheetId, folderId });
      }
    }
  }

  // Dynamic Header Mapping for UserConfig (Finds Email, Role, and Region columns regardless of Name columns)
  const userHeaders = (userRows[0] || []).map((h) => String(h || '').trim().toLowerCase());
  let emailCol = userHeaders.findIndex((h) => h.includes('email'));
  let roleCol = userHeaders.findIndex((h) => h.includes('role') || h.includes('title'));
  let regionCol = userHeaders.findIndex((h) => h.includes('region'));

  // Intelligent fallback if headers aren't explicitly named
  if (emailCol === -1) {
    if (userRows.length > 1) {
      emailCol = userRows[1].findIndex((val) => String(val || '').includes('@'));
    }
    if (emailCol === -1) emailCol = 2; // Column C
  }
  if (roleCol === -1) roleCol = 3;   // Column D
  if (regionCol === -1) regionCol = 4; // Column E

  const users = [];
  if (userRows.length > 1) {
    for (let r = 1; r < userRows.length; r++) {
      const row = userRows[r];
      const email = String(row[emailCol] || '').trim().toLowerCase();
      const role = String(row[roleCol] || '').trim();
      const allowedRegions = String(row[regionCol] || '').trim();
      if (email) {
        users.push({ email, role: role || 'User', regions: allowedRegions });
      }
    }
  }

  console.log(
    `[MASTER CONFIG] Successfully loaded ${regions.length} active regions and ${users.length} authorized users.`
  );

  const bundle = { regions, users };
  cache.set(cacheKey, bundle, 300); // Cache master config for 5 minutes
  return bundle;
}

// Authorize user email and resolve target region spreadsheet
async function resolveRegionSpreadsheet(req, sheets) {
  const userEmail = await getUserEmailFromAuth(req.headers.authorization);
  const { regions, users } = await getMasterConfig(sheets, false);

  const userProfile = users.find((u) => u.email === userEmail);
  if (!userProfile) {
    const error = new Error(`Account "${userEmail}" is not authorized in UserConfig. Please contact an administrator.`);
    error.statusCode = 403;
    throw error;
  }

  // Calculate user's authorized regions
  let userAllowedRegions = [];
  const regionConfigString = (userProfile.regions || '').toUpperCase();
  const roleString = (userProfile.role || '').toUpperCase();

  if (regionConfigString === 'ALL' || roleString === 'DIRECTOR') {
    userAllowedRegions = regions;
  } else {
    const allowedKeys = (userProfile.regions || '')
      .split(',')
      .map((k) => k.trim().toLowerCase());
    userAllowedRegions = regions.filter(
      (r) => allowedKeys.includes(r.id.toLowerCase()) || allowedKeys.includes(r.name.toLowerCase())
    );
  }

  if (userAllowedRegions.length === 0) {
    const error = new Error(`No region assignments found for ${userEmail}.`);
    error.statusCode = 403;
    throw error;
  }

  // Identify requested region (query param or body)
  const requestedId = (req.query.region || req.body.region || '').trim().toLowerCase();

  let targetRegion = null;
  if (!requestedId) {
    targetRegion = userAllowedRegions[0];
  } else {
    targetRegion = userAllowedRegions.find(
      (r) => r.id.toLowerCase() === requestedId || r.name.toLowerCase() === requestedId
    );
  }

  if (!targetRegion) {
    const error = new Error(`You do not have access permissions for region "${requestedId}".`);
    error.statusCode = 403;
    throw error;
  }

  return {
    targetRegion,
    spreadsheetId: targetRegion.spreadsheetId,
    userProfile,
  };
}

function getColLetter(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function parseValidationRows(valRows) {
  const optionsMap = {
    Z: [],
    AE: [],
    AG: [],
    AI: [], // Contractor options
    AL: [],
  };


  if (!valRows || valRows.length < 2) return optionsMap;


  const headers = valRows[0] || [];
  const colLetterMapping = {};


  headers.forEach((header, colIdx) => {
    const matches = [...String(header || '').matchAll(/\(([A-Z]+)\)/gi)];
    if (matches.length > 0) {
      const colLetter = matches[matches.length - 1][1].toUpperCase();
      colLetterMapping[colIdx] = colLetter;
      if (!optionsMap[colLetter]) {
        optionsMap[colLetter] = [];
      }
    }
  });


  for (let r = 1; r < valRows.length; r++) {
    const row = valRows[r];
    Object.entries(colLetterMapping).forEach(([colIdx, colLetter]) => {
      const val = row[colIdx] ? String(row[colIdx]).trim() : '';
      if (val && !optionsMap[colLetter].includes(val)) {
        optionsMap[colLetter].push(val);
      }
    });
  }


  return optionsMap;
}

// Fetch region sheet with Data Val tab
async function getOrFetchSheetWithValidation(sheets, spreadsheetId, regionId, tabName, forceRefresh = false) {
  const cacheKey = `sheet_bundle_${regionId}_${tabName}`;

  if (forceRefresh) {
    cache.del(cacheKey);
    console.log(`[FORCE REFRESH] Invalidation requested for ${regionId} - ${tabName}`);
  }

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  console.log(`[CACHE MISS] Fetching ${regionId} sheet (${tabName} & ${DATA_VAL_TAB})...`);
  const fetchPromise = (async () => {
    try {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [`'${tabName}'!A1:ZZ`, `'${DATA_VAL_TAB}'!A1:Z`],
      });

      const valueRanges = response.data.valueRanges || [];
      const values = valueRanges[0]?.values || [];
      const valRows = valueRanges[1]?.values || [];

      const dropdownOptions = parseValidationRows(valRows);
      const bundle = { values, dropdownOptions };

      cache.set(cacheKey, bundle);
      return bundle;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

// ---------------------------------------------------------------------------
// Authentication & Region Discovery Endpoint
// ---------------------------------------------------------------------------

app.get('/api/auth/me', async (req, res) => {
  try {
    const sheets = getSheetsClient(req.headers.authorization);
    const userEmail = await getUserEmailFromAuth(req.headers.authorization);
    const { regions, users } = await getMasterConfig(sheets, false);

    const userProfile = users.find((u) => u.email === userEmail);
    if (!userProfile) {
      return res.status(403).json({
        error: `Account (${userEmail}) is not authorized in UserConfig. Please contact an administrator.`,
      });
    }

    let allowedRegions = [];
    const regionString = (userProfile.regions || '').toUpperCase();
    const roleString = (userProfile.role || '').toUpperCase();

    if (regionString === 'ALL' || roleString === 'DIRECTOR') {
      allowedRegions = regions;
    } else {
      const allowedKeys = (userProfile.regions || '')
        .split(',')
        .map((k) => k.trim().toLowerCase());
      allowedRegions = regions.filter(
        (r) => allowedKeys.includes(r.id.toLowerCase()) || allowedKeys.includes(r.name.toLowerCase())
      );
    }

    if (allowedRegions.length === 0) {
      return res.status(403).json({
        error: `No regional sheet access assigned for account "${userEmail}".`,
      });
    }

    console.log(
      `[AUTH] User "${userEmail}" authenticated successfully as "${userProfile.role}". Regions: ${allowedRegions.map((r) => r.name).join(', ')}`
    );

    res.json({
      email: userEmail,
      role: userProfile.role,
      allowedRegions: allowedRegions.map((r) => ({ id: r.id, name: r.name })),
    });
  } catch (error) {
    console.error('Error in /api/auth/me:', error?.response?.data || error.message);
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Sheet Endpoints
// ---------------------------------------------------------------------------

app.get('/api/sheet', async (req, res) => {
  try {
    const tabName = req.query.tab || 'Cable Replacement';
    const forceRefresh = req.query.refresh === 'true';
    const sheets = getSheetsClient(req.headers.authorization);

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(req, sheets);

    const { values, dropdownOptions } = await getOrFetchSheetWithValidation(
      sheets,
      spreadsheetId,
      targetRegion.id,
      tabName,
      forceRefresh
    );

    res.json({ values, dropdownOptions, region: targetRegion });
  } catch (error) {
    console.error('Error fetching sheet:', error?.response?.data || error.message);
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.post('/api/sheet/cell', async (req, res) => {
  try {
    const sheets = getSheetsClient(req.headers.authorization);
    const { tabName = 'Cable Replacement', cell, value } = req.body;

    if (!cell) {
      return res.status(400).json({ error: 'Missing cell coordinate (e.g. B2)' });
    }

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(req, sheets);

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!${cell}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });

    cache.del(`sheet_bundle_${targetRegion.id}_${tabName}`);
    res.json({ success: true, updatedRange: response.data.updatedRange });
  } catch (error) {
    console.error('Error updating cell:', error?.response?.data || error.message);
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Dedicated DCR Endpoints
// ---------------------------------------------------------------------------

app.get('/api/dcr/:dcrId', async (req, res) => {
  try {
    const { dcrId } = req.params;
    const forceRefresh = req.query.refresh === 'true';
    const sheets = getSheetsClient(req.headers.authorization);

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(req, sheets);

    const { values: rows, dropdownOptions } = await getOrFetchSheetWithValidation(
      sheets,
      spreadsheetId,
      targetRegion.id,
      'Cable Replacement',
      forceRefresh
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `Sheet for region ${targetRegion.name} is empty` });
    }

    const headers = rows[0];
    const DCR_COL_INDEX = 24; // Col Y

    let foundIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const cellVal = String(rows[i][DCR_COL_INDEX] || '').trim();
      if (cellVal.toLowerCase() === String(dcrId).trim().toLowerCase()) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      return res.status(404).json({ error: `DCR ID "${dcrId}" not found in ${targetRegion.name}` });
    }

    const targetRow = rows[foundIndex];
    const sheetRowNumber = foundIndex + 1;

    const fields = headers.map((header, idx) => ({
      colIndex: idx,
      colLetter: getColLetter(idx),
      header: header || `Column ${getColLetter(idx)}`,
      value: targetRow[idx] || '',
      isReadOnly: idx >= 2 && idx <= 24,
    }));

    res.json({
      dcrId,
      sheetRowNumber,
      fields,
      dropdownOptions,
      region: targetRegion,
    });
  } catch (error) {
    console.error('Error fetching DCR details:', error?.response?.data || error.message);
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.post('/api/dcr/:dcrId/batch', async (req, res) => {
  try {
    const { dcrId } = req.params;
    const { updates } = req.body;

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.json({ success: true, message: 'No updates to persist' });
    }

    for (const colLetter of Object.keys(updates)) {
      const cleanCol = colLetter.trim().toUpperCase();
      const colIndex = cleanCol.charCodeAt(0) - 65;
      if (cleanCol.length === 1 && colIndex >= 2 && colIndex <= 24) {
        return res.status(403).json({
          error: `Column ${cleanCol} is protected form data and cannot be edited.`,
        });
      }
    }

    const sheets = getSheetsClient(req.headers.authorization);
    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(req, sheets);

    const { values: rows } = await getOrFetchSheetWithValidation(
      sheets,
      spreadsheetId,
      targetRegion.id,
      'Cable Replacement',
      false
    );
    const DCR_COL_INDEX = 24;

    let foundIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const cellVal = String(rows[i][DCR_COL_INDEX] || '').trim();
      if (cellVal.toLowerCase() === String(dcrId).trim().toLowerCase()) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      return res.status(404).json({ error: `DCR ID "${dcrId}" not found in ${targetRegion.name}` });
    }

    const sheetRowNumber = foundIndex + 1;

    const data = Object.entries(updates).map(([colLetter, value]) => ({
      range: `'Cable Replacement'!${colLetter.trim().toUpperCase()}${sheetRowNumber}`,
      values: [[value ?? '']],
    }));

    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    cache.del(`sheet_bundle_${targetRegion.id}_Cable Replacement`);
    console.log(`[CACHE INVALIDATED] Cleared cache for ${targetRegion.name} after batch update for ${dcrId}`);

    res.json({
      success: true,
      totalUpdatedCells: response.data.totalUpdatedCells,
      updatedRow: sheetRowNumber,
    });
  } catch (error) {
    console.error('Error batch updating DCR:', error?.response?.data || error.message);
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Drive Photo Endpoints
// ---------------------------------------------------------------------------

app.get('/api/drive/folder/:folderId/files', async (req, res) => {
  try {
    const { folderId } = req.params;
    const authHeader = req.headers.authorization;
    const drive = getDriveClient(authHeader);

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, thumbnailLink, webViewLink, size, modifiedTime)',
      pageSize: 100,
      orderBy: 'folder,name',
    });

    const files = response.data.files || [];
    const images = files.filter((f) => f.mimeType && f.mimeType.startsWith('image/'));

    res.json({ files, images });
  } catch (err) {
    console.error('Error listing folder files:', err);
    res.status(500).json({ error: err.message || 'Failed to list folder files' });
  }
});

app.get('/api/drive/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const authHeader = req.headers.authorization || (req.query.token ? `Bearer ${req.query.token}` : null);

    if (!authHeader) {
      return res.status(401).send('Missing authorization token');
    }

    const drive = getDriveClient(authHeader);

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');

    response.data.pipe(res);
  } catch (error) {
    console.error('Error streaming drive file:', error?.response?.data || error.message);
    res.status(500).send('Failed to stream image');
  }
});

// ---------------------------------------------------------------------------
// Static Asset Serving
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));

  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});