import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize cache with a 45-second Time-To-Live (TTL)
const cache = new NodeCache({ stdTTL: 45, checkperiod: 60 });

app.use(cors());
app.use(express.json());

// Target Google Sheet ID from your URL
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

// GET: Read an entire tab with cache check
app.get('/api/sheet', async (req, res) => {
  try {
    const tabName = req.query.tab || 'Cable Replacement';
    const cacheKey = `sheet_${tabName}`;

    // 1. Check if data is already cached
    if (cache.has(cacheKey)) {
      console.log(`[CACHE HIT] Returning ${tabName} from in-memory cache`);
      return res.json({ values: cache.get(cacheKey) });
    }

    // 2. Cache miss: fetch from Google Sheets API
    console.log(`[CACHE MISS] Fetching ${tabName} from Google Sheets API...`);
    const sheets = getSheetsClient(req.headers.authorization);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A1:Z`,
    });

    const values = response.data.values || [];

    // 3. Store in cache for 45 seconds
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

// POST: Update a specific cell and invalidate the cache
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

    // Invalidate the cache for this tab so the next GET fetches the updated data
    const cacheKey = `sheet_${tabName}`;
    cache.del(cacheKey);
    console.log(`[CACHE INVALIDATED] Cleared cache for ${tabName} due to cell update`);

    res.json({ success: true, updatedRange: response.data.updatedRange });
  } catch (error) {
    console.error('Error updating cell:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});