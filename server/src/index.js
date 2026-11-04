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


// 5-minute TTL
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });


// Prevent duplicate in-flight API requests (cache stampede protection)
const pendingRequests = new Map();


app.use(cors());
app.use(express.json());


const SPREADSHEET_ID = '1EP2pkQZm2E1u_ZCqDFNCoS0xie5IfSdlJ-wpPmNCboo';
const DATA_VAL_TAB = 'Data Val (Cable Replacement)';


const getSheetsClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return google.sheets({ version: 'v4', auth: oauth2Client });
};


const getDriveClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return google.drive({ version: 'v3', auth: oauth2Client });
};


function getColLetter(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}


// Helper to convert validation sheet rows into key-value options dictionary
// Helper to convert validation sheet rows into key-value options dictionary
function parseValidationRows(valRows) {
  const optionsMap = {
    Z: [],
    AE: [],
    AG: [],
    AL: [],
  };


  if (!valRows || valRows.length < 2) return optionsMap;


  const headers = valRows[0] || [];
  const colLetterMapping = {};


  headers.forEach((header, colIdx) => {
    // Match all parentheses groups and pick the LAST one to avoid "(s)" in "Technician(s) (AE)"
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


// Centralized fetch helper with single-call batchGet for data + validation options
async function getOrFetchSheetWithValidation(sheets, tabName, forceRefresh = false) {
  const cacheKey = `sheet_bundle_${tabName}`;


  if (forceRefresh) {
    cache.del(cacheKey);
    console.log(`[FORCE REFRESH] Invalidation requested for ${tabName}`);
  }


  if (cache.has(cacheKey)) {
    console.log(`[CACHE HIT] Serving ${tabName} from NodeCache`);
    return cache.get(cacheKey);
  }


  if (pendingRequests.has(cacheKey)) {
    console.log(`[IN-FLIGHT REUSE] Waiting on pending fetch for ${tabName}`);
    return pendingRequests.get(cacheKey);
  }


  console.log(`[CACHE MISS] Batch-fetching fresh ${tabName} & ${DATA_VAL_TAB}...`);
  const fetchPromise = (async () => {
    try {
      // Single API call retrieving both the target tab and the validation tab together
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
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
// Sheet Endpoints
// ---------------------------------------------------------------------------


app.get('/api/sheet', async (req, res) => {
  try {
    const tabName = req.query.tab || 'Cable Replacement';
    const forceRefresh = req.query.refresh === 'true';
    const sheets = getSheetsClient(req.headers.authorization);


    const { values, dropdownOptions } = await getOrFetchSheetWithValidation(sheets, tabName, forceRefresh);
    res.json({ values, dropdownOptions });
  } catch (error) {
    console.error('Error fetching sheet:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
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


    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!${cell}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });


    cache.del(`sheet_bundle_${tabName}`);
    console.log(`[CACHE INVALIDATED] Cleared cache for ${tabName} due to update at ${cell}`);


    res.json({ success: true, updatedRange: response.data.updatedRange });
  } catch (error) {
    console.error('Error updating cell:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
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


    const { values: rows, dropdownOptions } = await getOrFetchSheetWithValidation(sheets, 'Cable Replacement', forceRefresh);


    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cable Replacement sheet is empty' });
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
      return res.status(404).json({ error: `DCR ID "${dcrId}" not found in Column Y` });
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
    });
  } catch (error) {
    console.error('Error fetching DCR details:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});


app.post('/api/dcr/:dcrId/cell', async (req, res) => {
  try {
    const { dcrId } = req.params;
    const { colLetter, value } = req.body;


    if (!colLetter) {
      return res.status(400).json({ error: 'Missing colLetter parameter (e.g. "A", "B", "Z")' });
    }


    const cleanCol = colLetter.trim().toUpperCase();
    const colIndex = cleanCol.charCodeAt(0) - 65;


    if (cleanCol.length === 1 && colIndex >= 2 && colIndex <= 24) {
      return res.status(403).json({
        error: 'Columns C through Y are protected source-of-truth form responses and cannot be edited.',
      });
    }


    const sheets = getSheetsClient(req.headers.authorization);
    const { values: rows } = await getOrFetchSheetWithValidation(sheets, 'Cable Replacement', false);
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
      return res.status(404).json({ error: `DCR ID "${dcrId}" not found in Column Y` });
    }


    const sheetRowNumber = foundIndex + 1;
    const targetCell = `${cleanCol}${sheetRowNumber}`;


    const updateResponse = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Cable Replacement'!${targetCell}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });


    cache.del('sheet_bundle_Cable Replacement');
    console.log(`[CACHE INVALIDATED] Cleared Cable Replacement cache after updating ${targetCell} for DCR ${dcrId}`);


    res.json({
      success: true,
      updatedRange: updateResponse.data.updatedRange,
      cell: targetCell,
    });
  } catch (error) {
    console.error('Error updating DCR cell:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});


// ---------------------------------------------------------------------------
// Drive Photo Endpoints
// ---------------------------------------------------------------------------


app.get('/api/drive/folder/:folderId/images', async (req, res) => {
  try {
    const { folderId } = req.params;
    const drive = getDriveClient(req.headers.authorization);


    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink, thumbnailLink)',
      pageSize: 50,
      orderBy: 'name',
    });


    const files = response.data.files || [];
    res.json({ files });
  } catch (error) {
    console.error('Error listing folder files:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});


app.get('/api/drive/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);


    if (!token) {
      return res.status(401).send('Missing authorization token');
    }


    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });


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