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


// Initialize cache with a 5-minute (300 seconds) Time-To-Live (TTL)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });


app.use(cors());
app.use(express.json());


// Target Google Sheet ID
const SPREADSHEET_ID = '1EP2pkQZm2E1u_ZCqDFNCoS0xie5IfSdlJ-wpPmNCboo';


// Helper: initialize Google Sheets API using the logged-in user's token
const getSheetsClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return google.sheets({ version: 'v4', auth: oauth2Client });
};


// Helper: Convert column index to A1 letter (0 -> A, 1 -> B, 26 -> AA, etc.)
function getColLetter(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}


// Centralized Helper: Fetch from in-memory cache or Google Sheets API
async function getOrFetchSheet(sheets, tabName) {
  const cacheKey = `sheet_${tabName}`;
  if (cache.has(cacheKey)) {
    console.log(`[CACHE HIT] Serving ${tabName} from NodeCache`);
    return cache.get(cacheKey);
  }


  console.log(`[CACHE MISS] Fetching ${tabName} from Google Sheets API...`);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1:ZZ`,
  });


  const values = response.data.values || [];
  cache.set(cacheKey, values);
  return values;
}


// ---------------------------------------------------------------------------
// 1. General Sheet Endpoints (Main Grid)
// ---------------------------------------------------------------------------


// GET: Read an entire tab (routes through central cache helper)
app.get('/api/sheet', async (req, res) => {
  try {
    const tabName = req.query.tab || 'Cable Replacement';
    const forceRefresh = req.query.refresh === 'true';
    const cacheKey = `sheet_${tabName}`;


    // If refresh was requested, evict the entry immediately
    if (forceRefresh) {
      cache.del(cacheKey);
      console.log(`[FORCE REFRESH] Invalidation requested for ${tabName}`);
    }


    // Now check if cache has it (will be false on forceRefresh)
    if (cache.has(cacheKey)) {
      console.log(`[CACHE HIT] Serving ${tabName} from NodeCache`);
      return res.json({ values: cache.get(cacheKey) });
    }


    console.log(`[CACHE MISS] Fetching fresh ${tabName} from Google Sheets API...`);
    const sheets = getSheetsClient(req.headers.authorization);


    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A1:ZZ`,
    });


    const values = response.data.values || [];
    cache.set(cacheKey, values);


    res.json({ values });
  } catch (error) {
    console.error('Error fetching sheet:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});


// POST: Update an arbitrary cell by A1 notation and invalidate cache
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
      requestBody: {
        values: [[value]],
      },
    });


    // Invalidate the cache for this tab so the next GET fetches fresh values
    cache.del(`sheet_${tabName}`);
    console.log(`[CACHE INVALIDATED] Cleared cache for ${tabName} due to cell update at ${cell}`);


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
// 2. Dedicated DCR Endpoints (Manager Review Page)
// ---------------------------------------------------------------------------


// GET: Fetch a single DCR record by Column Y (index 24) using the cached data
app.get('/api/dcr/:dcrId', async (req, res) => {
  try {
    const { dcrId } = req.params;
    const sheets = getSheetsClient(req.headers.authorization);


    // Pulls from cache if Cable Replacement was loaded, 0 Google API calls
    const rows = await getOrFetchSheet(sheets, 'Cable Replacement');


    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cable Replacement sheet is empty' });
    }


    const headers = rows[0];
    const DCR_COL_INDEX = 24; // Column Y is index 24 (0-based)


    // Locate the row matching dcrId in Column Y
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
    const sheetRowNumber = foundIndex + 1; // 1-based index for Google Sheets A1 notation


    // Map each column to header, letter, current value, and edit restrictions
    const fields = headers.map((header, idx) => ({
      colIndex: idx,
      colLetter: getColLetter(idx),
      header: header || `Column ${getColLetter(idx)}`,
      value: targetRow[idx] || '',
      // Columns C (index 2) through Y (index 24) are protected form responses
      isReadOnly: idx >= 2 && idx <= 24,
    }));


    res.json({
      dcrId,
      sheetRowNumber,
      fields,
    });
  } catch (error) {
    console.error('Error fetching DCR details:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});


// POST: Update a specific column for a DCR record by DCR ID and invalidate cache
app.post('/api/dcr/:dcrId/cell', async (req, res) => {
  try {
    const { dcrId } = req.params;
    const { colLetter, value } = req.body;


    if (!colLetter) {
      return res.status(400).json({ error: 'Missing colLetter parameter (e.g. "A", "B", "Z")' });
    }


    const cleanCol = colLetter.trim().toUpperCase();
    const colIndex = cleanCol.charCodeAt(0) - 65;


    // Enforce C (2) through Y (24) guardrail
    if (cleanCol.length === 1 && colIndex >= 2 && colIndex <= 24) {
      return res.status(403).json({
        error: 'Columns C through Y are protected source-of-truth form responses and cannot be edited.',
      });
    }


    const sheets = getSheetsClient(req.headers.authorization);


    // Reuse the cache to find the row number without an extra Sheets read
    const rows = await getOrFetchSheet(sheets, 'Cable Replacement');
    const DCR_COL_INDEX = 24; // Column Y


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


    // Write change to Google Sheets
    const updateResponse = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Cable Replacement'!${targetCell}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[value]],
      },
    });


    // Invalidate the cache so the subsequent GET pulls fresh data
    cache.del('sheet_Cable Replacement');
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
// 3. Static Asset Serving (Production & Render Compatibility)
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