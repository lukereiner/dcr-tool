import express from "express";
import cors from "cors";
import { google } from "googleapis";
import dotenv from "dotenv";
import NodeCache from "node-cache";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { Readable } from "stream";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

const upload = multer({
  storage: multer.memoryStorage(),
});

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const pendingRequests = new Map();

app.use(cors());
app.use(express.json());

const MASTER_SPREADSHEET_ID = "1TrsDRv-aoCxPLzCp0ma6JlwamJPT13JuKuIda-5Uvdg";
const DATA_VAL_TAB = "Data Val (Cable Replacement)";
const FORM_RESPONSES_TAB = "DCR Form Responses";
const FORM_RESPONSES_DATA_VAL_TAB = "Data Val (DCR Responses)";
const MAIN_TAB = "Cable Replacement";

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
      `[GOOGLE API RETRY] HTTP ${status} on ${err.config?.url}. Retrying attempt #${attempt}...`,
    );
  },
};

const getSheetsClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }
  const token = authHeader.split(" ")[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });

  return google.sheets({
    version: "v4",
    auth: oauth2Client,
    retryConfig: googleRetryConfig,
  });
};

const getDriveClient = (authHeader) => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }
  const token = authHeader.split(" ")[1];
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });

  return google.drive({
    version: "v3",
    auth: oauth2Client,
    retryConfig: googleRetryConfig,
  });
};

async function getUserEmailFromAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }
  const token = authHeader.split(" ")[1];
  const cacheKey = `user_email_${token.substring(0, 24)}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  const tokenInfo = await oauth2Client.getTokenInfo(token);
  const email = (tokenInfo.email || "").toLowerCase().trim();

  if (!email) {
    throw new Error(
      "Unable to extract verified email from Google authorization token.",
    );
  }

  cache.set(cacheKey, email, 600);
  return email;
}

async function getMasterConfig(sheets, forceRefresh = false) {
  const cacheKey = "master_config_bundle";

  if (forceRefresh) {
    cache.del(cacheKey);
  }

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  console.log("[MASTER CONFIG] Batch-fetching RegionConfig and UserConfig...");
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: MASTER_SPREADSHEET_ID,
    ranges: ["'RegionConfig'!A1:Z", "'UserConfig'!A1:Z"],
  });

  const valueRanges = response.data.valueRanges || [];
  const regionRows = valueRanges[0]?.values || [];
  const userRows = valueRanges[1]?.values || [];

  const regHeaders = (regionRows[0] || []).map((h) =>
    String(h || "")
      .trim()
      .toLowerCase(),
  );
  let idCol = regHeaders.findIndex(
    (h) =>
      h === "region id" ||
      (h.includes("id") && !h.includes("sheet") && !h.includes("folder")),
  );
  if (idCol === -1) idCol = 0;
  let nameCol = regHeaders.findIndex((h) => h.includes("name"));
  if (nameCol === -1) nameCol = 1;
  let sheetIdCol = regHeaders.findIndex((h) => h.includes("sheet"));
  if (sheetIdCol === -1) sheetIdCol = 2;
  let folderIdCol = regHeaders.findIndex((h) => h.includes("folder"));
  if (folderIdCol === -1) folderIdCol = 3;

  const regions = [];
  if (regionRows.length > 1) {
    for (let r = 1; r < regionRows.length; r++) {
      const row = regionRows[r];
      const id = String(row[idCol] || "")
        .trim()
        .toLowerCase();
      const name = String(row[nameCol] || "").trim();
      const spreadsheetId = String(row[sheetIdCol] || "").trim();
      const folderId =
        folderIdCol !== -1 ? String(row[folderIdCol] || "").trim() : "";

      if (
        id &&
        spreadsheetId &&
        id !== "master" &&
        spreadsheetId !== MASTER_SPREADSHEET_ID
      ) {
        regions.push({ id, name: name || id, spreadsheetId, folderId });
      }
    }
  }

  const userHeaders = (userRows[0] || []).map((h) =>
    String(h || "")
      .trim()
      .toLowerCase(),
  );
  let emailCol = userHeaders.findIndex((h) => h.includes("email"));
  let roleCol = userHeaders.findIndex(
    (h) => h.includes("role") || h.includes("title"),
  );
  let regionCol = userHeaders.findIndex((h) => h.includes("region"));

  if (emailCol === -1) {
    if (userRows.length > 1) {
      emailCol = userRows[1].findIndex((val) =>
        String(val || "").includes("@"),
      );
    }
    if (emailCol === -1) emailCol = 2;
  }
  if (roleCol === -1) roleCol = 3;
  if (regionCol === -1) regionCol = 4;

  const users = [];
  if (userRows.length > 1) {
    for (let r = 1; r < userRows.length; r++) {
      const row = userRows[r];
      const email = String(row[emailCol] || "")
        .trim()
        .toLowerCase();
      const role = String(row[roleCol] || "").trim();
      const allowedRegions = String(row[regionCol] || "").trim();
      if (email) {
        users.push({ email, role: role || "User", regions: allowedRegions });
      }
    }
  }

  const bundle = { regions, users };
  cache.set(cacheKey, bundle, 300);
  return bundle;
}

async function resolveRegionSpreadsheet(req, sheets) {
  const userEmail = await getUserEmailFromAuth(req.headers.authorization);
  const { regions, users } = await getMasterConfig(sheets, false);

  const userProfile = users.find((u) => u.email === userEmail);
  if (!userProfile) {
    const error = new Error(
      `Account "${userEmail}" is not authorized in UserConfig.`,
    );
    error.statusCode = 403;
    throw error;
  }

  let userAllowedRegions = [];
  const regionConfigString = (userProfile.regions || "").toUpperCase();
  const roleString = (userProfile.role || "").toUpperCase();

  if (regionConfigString === "ALL" || roleString === "DIRECTOR") {
    userAllowedRegions = regions;
  } else {
    const allowedKeys = (userProfile.regions || "")
      .split(",")
      .map((k) => k.trim().toLowerCase());
    userAllowedRegions = regions.filter(
      (r) =>
        allowedKeys.includes(r.id.toLowerCase()) ||
        allowedKeys.includes(r.name.toLowerCase()),
    );
  }

  if (userAllowedRegions.length === 0) {
    const error = new Error(`No region assignments found for ${userEmail}.`);
    error.statusCode = 403;
    throw error;
  }

  const requestedId = (req.query.region || req.body.region || "")
    .trim()
    .toLowerCase();

  let targetRegion = null;
  if (!requestedId) {
    targetRegion = userAllowedRegions[0];
  } else {
    targetRegion = userAllowedRegions.find(
      (r) =>
        r.id.toLowerCase() === requestedId ||
        r.name.toLowerCase() === requestedId,
    );
  }

  if (!targetRegion) {
    const error = new Error(
      `You do not have access permissions for region "${requestedId}".`,
    );
    error.statusCode = 403;
    throw error;
  }

  return {
    targetRegion,
    spreadsheetId: targetRegion.spreadsheetId,
    userProfile,
    userEmail,
  };
}

function getColLetter(index) {
  let letter = "";
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function colLetterToIndex(colLetter) {
  const cleanCol = String(colLetter || "")
    .trim()
    .toUpperCase();
  let colIndex = 0;
  for (let i = 0; i < cleanCol.length; i++) {
    colIndex = colIndex * 26 + (cleanCol.charCodeAt(i) - 64);
  }
  return colIndex - 1;
}

function parseValidationRows(valRows, defaultKeys = {}) {
  const optionsMap = { ...defaultKeys };

  const formLinks = {
    evalFormUrl: "",
    qcFormUrl: "",
  };

  if (!valRows || valRows.length === 0) {
    return { dropdownOptions: optionsMap, formLinks };
  }

  const headers = valRows[0] || [];
  const colLetterMapping = {};

  let evalColIndex = headers.findIndex((h) =>
    String(h || "")
      .toLowerCase()
      .includes("eval"),
  );
  if (evalColIndex === -1) evalColIndex = 5;

  let qcColIndex = headers.findIndex((h) =>
    String(h || "")
      .toLowerCase()
      .includes("qc"),
  );
  if (qcColIndex === -1) qcColIndex = 6;

  if (valRows.length > 1) {
    const row2 = valRows[1] || [];
    formLinks.evalFormUrl = String(row2[evalColIndex] || "").trim();
    formLinks.qcFormUrl = String(row2[qcColIndex] || "").trim();
  }

  headers.forEach((header, colIdx) => {
    const matches = [...String(header || "").matchAll(/\(([A-Z]+)\)/gi)];
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
      const val = row[colIdx] ? String(row[colIdx]).trim() : "";
      if (val && !optionsMap[colLetter].includes(val)) {
        optionsMap[colLetter].push(val);
      }
    });
  }

  return { dropdownOptions: optionsMap, formLinks };
}

async function getOrFetchSheetWithValidation(
  sheets,
  spreadsheetId,
  regionId,
  tabName,
  forceRefresh = false,
) {
  const cacheKey = `sheet_bundle_${regionId}_${tabName}`;

  if (forceRefresh) {
    cache.del(cacheKey);
  }

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const ranges = [
        `'${tabName}'!A1:ZZ`,
        `'${DATA_VAL_TAB}'!A1:Z`,
        `'${FORM_RESPONSES_TAB}'!A1:Z`,
        `'${FORM_RESPONSES_DATA_VAL_TAB}'!A1:Z`,
      ];

      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });

      const valueRanges = response.data.valueRanges || [];
      const values = valueRanges[0]?.values || [];
      const valRows = valueRanges[1]?.values || [];
      const formResponseRows = valueRanges[2]?.values || [];
      const formResponseValRows = valueRanges[3]?.values || [];

      const { dropdownOptions, formLinks } = parseValidationRows(valRows, {
        Z: [],
        AE: [],
        AG: [],
        AI: [],
        AL: [],
      });

      const { dropdownOptions: formResponseDropdownOptions } =
        parseValidationRows(formResponseValRows, {
          E: [],
          H: [],
          I: [],
          J: [],
          Q: [],
          R: [],
        });

      const bundle = {
        values,
        dropdownOptions,
        formLinks,
        formResponseRows,
        formResponseDropdownOptions,
      };

      cache.set(cacheKey, bundle);
      return bundle;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

// Fetch native cell comments from Google Sheets for the active DCR row and construct deep links
async function getNativeCellComments(
  token,
  spreadsheetId,
  sheetTitle,
  targetRowIndex,
  sheetRowNumber,
) {
  const comments = [];
  let targetSheetId = 0;

  try {
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED&fields=sheets(properties(sheetId,title),commentAnchors),comments`;
    const sheetsRes = await fetch(sheetsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!sheetsRes.ok) {
      console.warn(
        "[COMMENTS] Sheets API returned error:",
        sheetsRes.status,
        sheetsRes.statusText,
      );
      return { comments: [], sheetId: 0 };
    }

    const sData = await sheetsRes.json();
    const targetSheet = (sData.sheets || []).find(
      (s) => s.properties?.title === sheetTitle,
    );

    targetSheetId = targetSheet?.properties?.sheetId ?? 0;
    const anchors = targetSheet?.commentAnchors || [];
    const allThreads = sData.comments || [];

    const rowAnchors = anchors.filter((a) => {
      const r = a.range || a.gridRange;
      return (
        r &&
        r.startRowIndex !== undefined &&
        Number(r.startRowIndex) === Number(targetRowIndex)
      );
    });

    rowAnchors.forEach((anchor) => {
      const r = anchor.range || anchor.gridRange;
      const colIdx =
        r && r.startColumnIndex !== undefined ? Number(r.startColumnIndex) : 0;
      const colLetter = getColLetter(colIdx);
      const cellCoordinate = `${colLetter}${sheetRowNumber}`;
      const openInSheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${targetSheetId}&range=${cellCoordinate}`;

      const thread = allThreads.find(
        (t) =>
          (t.anchorId &&
            anchor.anchorId &&
            String(t.anchorId) === String(anchor.anchorId)) ||
          (t.commentId &&
            anchor.commentId &&
            String(t.commentId) === String(anchor.commentId)),
      );

      if (thread) {
        const headPost =
          thread.headPost || (thread.posts && thread.posts[0]) || {};
        const rawReplies =
          thread.replies || (thread.posts && thread.posts.slice(1)) || [];

        const validReplies = rawReplies
          .filter(
            (rep) =>
              rep && rep.content && String(rep.content).trim().length > 0,
          )
          .map((rep, rIdx) => ({
            replyId: rep.postId || rep.id || `rep_${rIdx}`,
            text: rep.content || "",
            authorName:
              rep.author?.displayName ||
              (rep.author?.emailAddress || "").split("@")[0] ||
              "User",
            authorEmail: rep.author?.emailAddress || "",
            timestamp: rep.createTime || "",
          }));

        const isResolved =
          String(thread.status || "").toUpperCase() === "RESOLVED" ||
          thread.resolved === true;

        comments.push({
          commentId: thread.commentId,
          colLetter,
          cellCoordinate,
          plainTextQuote: thread.plainTextQuote || "",
          text: headPost.content || "",
          authorName:
            headPost.author?.displayName ||
            (headPost.author?.emailAddress || "").split("@")[0] ||
            "User",
          authorEmail: headPost.author?.emailAddress || "",
          timestamp: headPost.createTime || "",
          resolved: isResolved,
          openInSheetUrl,
          replies: validReplies,
        });
      }
    });

    comments.sort((a, b) => {
      const timeA = Math.max(
        new Date(a.timestamp || 0).getTime(),
        ...a.replies.map((r) => new Date(r.timestamp || 0).getTime()),
      );
      const timeB = Math.max(
        new Date(b.timestamp || 0).getTime(),
        ...b.replies.map((r) => new Date(r.timestamp || 0).getTime()),
      );
      return timeB - timeA;
    });

    return { comments, sheetId: targetSheetId };
  } catch (err) {
    console.warn(
      "[COMMENTS] Error querying native cell comments:",
      err.message,
    );
    return { comments: [], sheetId: targetSheetId };
  }
}

// ---------------------------------------------------------------------------
// Authentication & Region Discovery Endpoint
// ---------------------------------------------------------------------------

app.get("/api/auth/me", async (req, res) => {
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
    const regionString = (userProfile.regions || "").toUpperCase();
    const roleString = (userProfile.role || "").toUpperCase();

    if (regionString === "ALL" || roleString === "DIRECTOR") {
      allowedRegions = regions;
    } else {
      const allowedKeys = (userProfile.regions || "")
        .split(",")
        .map((k) => k.trim().toLowerCase());
      allowedRegions = regions.filter(
        (r) =>
          allowedKeys.includes(r.id.toLowerCase()) ||
          allowedKeys.includes(r.name.toLowerCase()),
      );
    }

    if (allowedRegions.length === 0) {
      return res.status(403).json({
        error: `No regional sheet access assigned for account "${userEmail}".`,
      });
    }

    res.json({
      email: userEmail,
      role: userProfile.role,
      allowedRegions: allowedRegions.map((r) => ({ id: r.id, name: r.name })),
    });
  } catch (error) {
    console.error(
      "Error in /api/auth/me:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Sheet Endpoints
// ---------------------------------------------------------------------------

app.get("/api/sheet", async (req, res) => {
  try {
    const tabName = req.query.tab || MAIN_TAB;
    const forceRefresh = req.query.refresh === "true";
    const sheets = getSheetsClient(req.headers.authorization);

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    const { values, dropdownOptions, formLinks } =
      await getOrFetchSheetWithValidation(
        sheets,
        spreadsheetId,
        targetRegion.id,
        tabName,
        forceRefresh,
      );

    res.json({ values, dropdownOptions, formLinks, region: targetRegion });
  } catch (error) {
    console.error(
      "Error fetching sheet:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.post("/api/sheet/cell", async (req, res) => {
  try {
    const sheets = getSheetsClient(req.headers.authorization);
    const { tabName = MAIN_TAB, cell, value } = req.body;

    if (!cell) {
      return res
        .status(400)
        .json({ error: "Missing cell coordinate (e.g. B2)" });
    }

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!${cell}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });

    cache.del(`sheet_bundle_${targetRegion.id}_${tabName}`);
    res.json({ success: true, updatedRange: response.data.updatedRange });
  } catch (error) {
    console.error(
      "Error updating cell:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Dedicated DCR & Comment Operations (Sheets API batchUpdate)
// ---------------------------------------------------------------------------

const FORM_RESPONSE_DROPDOWN_COLS = new Set(["E", "H", "I", "J", "Q", "R"]);
const FORM_RESPONSE_HIDDEN_COLS = new Set([19, 20, 21]); // T, U, V

app.get("/api/dcr/:dcrId", async (req, res) => {
  try {
    const { dcrId } = req.params;
    const forceRefresh = req.query.refresh === "true";
    const sheets = getSheetsClient(req.headers.authorization);
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : "";

    const { targetRegion, spreadsheetId, userProfile } =
      await resolveRegionSpreadsheet(req, sheets);

    const userRole = String(userProfile?.role || "")
      .trim()
      .toUpperCase();
    const canEditFormResponses =
      userRole === "DIRECTOR" || userRole === "MANAGER";

    const {
      values: rows,
      dropdownOptions,
      formLinks,
      formResponseRows,
      formResponseDropdownOptions,
    } = await getOrFetchSheetWithValidation(
      sheets,
      spreadsheetId,
      targetRegion.id,
      MAIN_TAB,
      forceRefresh,
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: `Sheet for region ${targetRegion.name} is empty` });
    }

    const headers = rows[0];
    const DCR_COL_INDEX = 24; // Column Y

    let foundIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const cellVal = String(rows[i][DCR_COL_INDEX] || "").trim();
      if (cellVal.toLowerCase() === String(dcrId).trim().toLowerCase()) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      return res
        .status(404)
        .json({ error: `DCR ID "${dcrId}" not found in ${targetRegion.name}` });
    }

    const targetRow = rows[foundIndex];
    const sheetRowNumber = foundIndex + 1;

    // Independently search 'DCR Form Responses' Column Y for the matching DCR ID row
    let formRespFoundIndex = -1;
    if (formResponseRows && formResponseRows.length > 1) {
      for (let i = 1; i < formResponseRows.length; i++) {
        const cellVal = String(formResponseRows[i][DCR_COL_INDEX] || "").trim();
        if (cellVal.toLowerCase() === String(dcrId).trim().toLowerCase()) {
          formRespFoundIndex = i;
          break;
        }
      }
    }

    const formRespHeaders =
      (formResponseRows && formResponseRows[0]) || headers;
    const formRespTargetRow =
      formRespFoundIndex !== -1
        ? formResponseRows[formRespFoundIndex]
        : targetRow;
    const formResponsesSheetRowNumber =
      formRespFoundIndex !== -1 ? formRespFoundIndex + 1 : null;

    const { comments, sheetId: targetSheetId } = await getNativeCellComments(
      token,
      spreadsheetId,
      MAIN_TAB,
      foundIndex,
      sheetRowNumber,
    );

    const fields = headers.map((header, idx) => ({
      colIndex: idx,
      colLetter: getColLetter(idx),
      header: header || `Column ${getColLetter(idx)}`,
      value: targetRow[idx] || "",
      isReadOnly: idx >= 2 && idx <= 24,
    }));

    // Build 'DCR Form Responses' fields: Cols B (1) through W (22) excluding T, U, V (19, 20, 21), plus read-only Y (24)
    const formResponseFields = [];
    for (let idx = 1; idx <= 24; idx++) {
      if (idx === 23) continue; // Exclude X
      if (FORM_RESPONSE_HIDDEN_COLS.has(idx)) continue; // Exclude T (19), U (20), V (21)

      const colLetter = getColLetter(idx);
      const isDcrIdCol = idx === 24; // Column Y is strictly read-only for everyone
      const isEditable =
        !isDcrIdCol && canEditFormResponses && formRespFoundIndex !== -1;

      let inputType = "textarea";
      let placeholder = "";

      if (colLetter === "B") {
        inputType = "text";
        placeholder = "m/d/yy";
      } else if (colLetter === "D") {
        inputType = "textarea";
        placeholder = "First name, Last name";
      } else if (FORM_RESPONSE_DROPDOWN_COLS.has(colLetter)) {
        inputType = "select";
      } else if (isDcrIdCol) {
        inputType = "text";
      }

      formResponseFields.push({
        colIndex: idx,
        colLetter,
        header: formRespHeaders[idx] || headers[idx] || `Column ${colLetter}`,
        value: formRespTargetRow[idx] || "",
        isReadOnly: !isEditable,
        inputType,
        placeholder,
      });
    }

    res.json({
      dcrId,
      sheetRowNumber,
      formResponsesSheetRowNumber,
      sheetId: targetSheetId,
      canEditFormResponses,
      userRole: userProfile?.role || "User",
      fields,
      formResponseFields,
      dropdownOptions,
      formResponseDropdownOptions,
      formLinks,
      region: targetRegion,
      comments,
    });
  } catch (error) {
    console.error(
      "Error fetching DCR details:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.post("/api/dcr/:dcrId/comment", async (req, res) => {
  try {
    const { dcrId } = req.params;
    const { colLetter, text, sheetRowNumber, sheetId } = req.body;
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : "";

    if (!colLetter || !text || !String(text).trim()) {
      return res
        .status(400)
        .json({ error: "Missing colLetter or comment text." });
    }

    const colIndex = colLetterToIndex(colLetter);
    const rowIndex = (Number(sheetRowNumber) || 1) - 1;
    const sheets = getSheetsClient(req.headers.authorization);
    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertComment: {
              content: text.trim(),
              coordinate: {
                sheetId: Number(sheetId) || 0,
                rowIndex,
                columnIndex: colIndex,
              },
            },
          },
        ],
      },
    });

    const { comments: updatedComments } = await getNativeCellComments(
      token,
      spreadsheetId,
      MAIN_TAB,
      rowIndex,
      sheetRowNumber,
    );
    res.json({ success: true, comments: updatedComments });
  } catch (error) {
    console.error(
      "Error adding native comment:",
      error?.response?.data || error.message,
    );
    res
      .status(error.statusCode || 500)
      .json({ error: error?.response?.data?.error?.message || error.message });
  }
});

app.patch("/api/dcr/:dcrId/comment/:commentId", async (req, res) => {
  try {
    const { commentId } = req.params;
    const { text, sheetRowNumber } = req.body;
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : "";

    const sheets = getSheetsClient(req.headers.authorization);
    const drive = getDriveClient(req.headers.authorization);
    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    await drive.comments.update({
      fileId: spreadsheetId,
      commentId,
      fields: "id",
      requestBody: { content: text.trim() },
    });

    const rowIndex = (Number(sheetRowNumber) || 1) - 1;
    const { comments: updatedComments } = await getNativeCellComments(
      token,
      spreadsheetId,
      MAIN_TAB,
      rowIndex,
      sheetRowNumber,
    );
    res.json({ success: true, comments: updatedComments });
  } catch (error) {
    console.error(
      "Error editing comment:",
      error?.response?.data || error.message,
    );
    res
      .status(error.statusCode || 500)
      .json({ error: error?.response?.data?.error?.message || error.message });
  }
});

app.post("/api/dcr/:dcrId/comment/:commentId/reply", async (req, res) => {
  try {
    const { commentId } = req.params;
    const { text, sheetRowNumber } = req.body;
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : "";

    const sheets = getSheetsClient(req.headers.authorization);
    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addCommentReply: {
              commentId,
              post: {
                content: text.trim(),
              },
            },
          },
        ],
      },
    });

    const rowIndex = (Number(sheetRowNumber) || 1) - 1;
    const { comments: updatedComments } = await getNativeCellComments(
      token,
      spreadsheetId,
      MAIN_TAB,
      rowIndex,
      sheetRowNumber,
    );
    res.json({ success: true, comments: updatedComments });
  } catch (error) {
    console.error(
      "Error replying to comment:",
      error?.response?.data || error.message,
    );
    res
      .status(error.statusCode || 500)
      .json({ error: error?.response?.data?.error?.message || error.message });
  }
});

app.patch(
  "/api/dcr/:dcrId/comment/:commentId/reply/:replyId",
  async (req, res) => {
    try {
      const { commentId, replyId } = req.params;
      const { text, sheetRowNumber } = req.body;
      const token = req.headers.authorization
        ? req.headers.authorization.split(" ")[1]
        : "";

      const sheets = getSheetsClient(req.headers.authorization);
      const drive = getDriveClient(req.headers.authorization);
      const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
        req,
        sheets,
      );

      await drive.replies.update({
        fileId: spreadsheetId,
        commentId,
        replyId,
        fields: "id",
        requestBody: { content: text.trim() },
      });

      const rowIndex = (Number(sheetRowNumber) || 1) - 1;
      const { comments: updatedComments } = await getNativeCellComments(
        token,
        spreadsheetId,
        MAIN_TAB,
        rowIndex,
        sheetRowNumber,
      );
      res.json({ success: true, comments: updatedComments });
    } catch (error) {
      console.error(
        "Error editing reply:",
        error?.response?.data || error.message,
      );
      res
        .status(error.statusCode || 500)
        .json({
          error: error?.response?.data?.error?.message || error.message,
        });
    }
  },
);

app.delete(
  "/api/dcr/:dcrId/comment/:commentId/reply/:replyId",
  async (req, res) => {
    try {
      const { commentId, replyId } = req.params;
      const sheetRowNumber = req.query.sheetRowNumber;
      const token = req.headers.authorization
        ? req.headers.authorization.split(" ")[1]
        : "";

      const sheets = getSheetsClient(req.headers.authorization);
      const drive = getDriveClient(req.headers.authorization);
      const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
        req,
        sheets,
      );

      await drive.replies.delete({
        fileId: spreadsheetId,
        commentId,
        replyId,
      });

      const rowIndex = (Number(sheetRowNumber) || 1) - 1;
      const { comments: updatedComments } = await getNativeCellComments(
        token,
        spreadsheetId,
        MAIN_TAB,
        rowIndex,
        sheetRowNumber,
      );
      res.json({ success: true, comments: updatedComments });
    } catch (error) {
      console.error(
        "Error deleting reply:",
        error?.response?.data || error.message,
      );
      res
        .status(error.statusCode || 500)
        .json({
          error: error?.response?.data?.error?.message || error.message,
        });
    }
  },
);

app.post("/api/dcr/:dcrId/comment/resolve", async (req, res) => {
  try {
    const { commentId, sheetRowNumber, resolved } = req.body;
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : "";

    const sheets = getSheetsClient(req.headers.authorization);
    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addCommentReply: {
              commentId,
              post: {
                commentAction: Boolean(resolved) ? "RESOLVE" : "REOPEN",
              },
            },
          },
        ],
      },
    });

    const rowIndex = (Number(sheetRowNumber) || 1) - 1;
    const { comments: updatedComments } = await getNativeCellComments(
      token,
      spreadsheetId,
      MAIN_TAB,
      rowIndex,
      sheetRowNumber,
    );

    res.json({ success: true, comments: updatedComments });
  } catch (error) {
    console.error(
      "Error resolving native comment:",
      error?.response?.data || error.message,
    );
    res
      .status(error.statusCode || 500)
      .json({ error: error?.response?.data?.error?.message || error.message });
  }
});

app.delete("/api/dcr/:dcrId/comment/:commentId", async (req, res) => {
  try {
    const { commentId } = req.params;
    const sheetRowNumber = req.query.sheetRowNumber;
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : "";

    const sheets = getSheetsClient(req.headers.authorization);
    const drive = getDriveClient(req.headers.authorization);
    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
    );

    await drive.comments.delete({
      fileId: spreadsheetId,
      commentId,
    });

    const rowIndex = (Number(sheetRowNumber) || 1) - 1;
    const { comments: updatedComments } = await getNativeCellComments(
      token,
      spreadsheetId,
      MAIN_TAB,
      rowIndex,
      sheetRowNumber,
    );
    res.json({ success: true, comments: updatedComments });
  } catch (error) {
    console.error(
      "Error deleting native comment:",
      error?.response?.data || error.message,
    );
    res
      .status(error.statusCode || 500)
      .json({ error: error?.response?.data?.error?.message || error.message });
  }
});

// ---------------------------------------------------------------------------
// Batch Update (Supports both 'Cable Replacement' & 'DCR Form Responses')
// ---------------------------------------------------------------------------

app.post("/api/dcr/:dcrId/batch", async (req, res) => {
  try {
    const { dcrId } = req.params;
    const { updates = {}, formResponseUpdates = {} } = req.body;

    const hasMainUpdates =
      updates && typeof updates === "object" && Object.keys(updates).length > 0;
    const hasFormRespUpdates =
      formResponseUpdates &&
      typeof formResponseUpdates === "object" &&
      Object.keys(formResponseUpdates).length > 0;

    if (!hasMainUpdates && !hasFormRespUpdates) {
      return res.json({ success: true, message: "No updates to persist" });
    }

    if (hasMainUpdates) {
      for (const colLetter of Object.keys(updates)) {
        const cleanCol = colLetter.trim().toUpperCase();
        const colIndex = colLetterToIndex(cleanCol);
        if (colIndex >= 2 && colIndex <= 24) {
          return res.status(403).json({
            error: `Column ${cleanCol} on ${MAIN_TAB} is protected form data and cannot be edited directly.`,
          });
        }
      }
    }

    const sheets = getSheetsClient(req.headers.authorization);
    const { targetRegion, spreadsheetId, userProfile } =
      await resolveRegionSpreadsheet(req, sheets);

    const userRole = String(userProfile?.role || "")
      .trim()
      .toUpperCase();
    const canEditFormResponses =
      userRole === "DIRECTOR" || userRole === "MANAGER";

    if (hasFormRespUpdates) {
      if (!canEditFormResponses) {
        return res.status(403).json({
          error:
            "Only users with a Director or Manager role can edit DCR Form Responses.",
        });
      }

      for (const colLetter of Object.keys(formResponseUpdates)) {
        const cleanCol = colLetter.trim().toUpperCase();
        const colIndex = colLetterToIndex(cleanCol);

        if (colIndex === 24) {
          return res.status(403).json({
            error:
              "Column Y (DCR ID) is strictly read-only and cannot be edited.",
          });
        }

        if (
          colIndex < 1 ||
          colIndex > 22 ||
          FORM_RESPONSE_HIDDEN_COLS.has(colIndex)
        ) {
          return res.status(403).json({
            error: `Column ${cleanCol} is not editable in ${FORM_RESPONSES_TAB}.`,
          });
        }
      }
    }

    const { values: rows, formResponseRows } =
      await getOrFetchSheetWithValidation(
        sheets,
        spreadsheetId,
        targetRegion.id,
        MAIN_TAB,
        false,
      );
    const DCR_COL_INDEX = 24;

    const mainData = [];
    const formRespData = [];
    let updatedMainRow = null;
    let updatedFormRespRow = null;

    if (hasMainUpdates) {
      let foundIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        const cellVal = String(rows[i][DCR_COL_INDEX] || "").trim();
        if (cellVal.toLowerCase() === String(dcrId).trim().toLowerCase()) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex === -1) {
        return res.status(404).json({
          error: `DCR ID "${dcrId}" not found in ${MAIN_TAB} (${targetRegion.name})`,
        });
      }

      updatedMainRow = foundIndex + 1;
      Object.entries(updates).forEach(([colLetter, value]) => {
        mainData.push({
          range: `'${MAIN_TAB}'!${colLetter.trim().toUpperCase()}${updatedMainRow}`,
          values: [[value ?? ""]],
        });
      });
    }

    if (hasFormRespUpdates) {
      let formRespFoundIndex = -1;
      for (let i = 1; i < (formResponseRows || []).length; i++) {
        const cellVal = String(formResponseRows[i][DCR_COL_INDEX] || "").trim();
        if (cellVal.toLowerCase() === String(dcrId).trim().toLowerCase()) {
          formRespFoundIndex = i;
          break;
        }
      }

      if (formRespFoundIndex === -1) {
        return res.status(404).json({
          error: `DCR ID "${dcrId}" not found in ${FORM_RESPONSES_TAB} (${targetRegion.name})`,
        });
      }

      updatedFormRespRow = formRespFoundIndex + 1;
      Object.entries(formResponseUpdates).forEach(([colLetter, value]) => {
        formRespData.push({
          range: `'${FORM_RESPONSES_TAB}'!${colLetter.trim().toUpperCase()}${updatedFormRespRow}`,
          values: [[value ?? ""]],
        });
      });
    }

    const [mainResult, formRespResult] = await Promise.allSettled([
      mainData.length > 0
        ? sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "USER_ENTERED",
              data: mainData,
            },
          })
        : Promise.resolve(null),
      formRespData.length > 0
        ? sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "USER_ENTERED",
              data: formRespData,
            },
          })
        : Promise.resolve(null),
    ]);

    const mainSaved =
      mainData.length === 0 || mainResult.status === "fulfilled";
    const formRespSaved =
      formRespData.length === 0 || formRespResult.status === "fulfilled";

    if (
      (mainData.length > 0 && mainSaved) ||
      (formRespData.length > 0 && formRespSaved)
    ) {
      cache.del(`sheet_bundle_${targetRegion.id}_${MAIN_TAB}`);
    }

    if (!mainSaved || !formRespSaved) {
      const rawErr =
        (!formRespSaved &&
          (formRespResult.reason?.response?.data?.error?.message ||
            formRespResult.reason?.message)) ||
        (!mainSaved &&
          (mainResult.reason?.response?.data?.error?.message ||
            mainResult.reason?.message)) ||
        "Batch update failed";

      const friendlyError =
        !formRespSaved && rawErr.toLowerCase().includes("protected cell")
          ? `Google Sheets tab "${FORM_RESPONSES_TAB}" is protected. Ask the spreadsheet owner to add your Google account to "Data → Protect sheets and ranges" for "${FORM_RESPONSES_TAB}".`
          : rawErr;

      return res.status(400).json({
        success: false,
        error: friendlyError,
        mainSaved,
        formRespSaved,
        updatedRow: mainSaved ? updatedMainRow : null,
        updatedFormResponseRow: formRespSaved ? updatedFormRespRow : null,
      });
    }

    res.json({
      success: true,
      mainSaved: true,
      formRespSaved: true,
      totalUpdatedCells:
        (mainResult.value?.data?.totalUpdatedCells || 0) +
        (formRespResult.value?.data?.totalUpdatedCells || 0),
      updatedRow: updatedMainRow,
      updatedFormResponseRow: updatedFormRespRow,
    });
  } catch (error) {
    console.error(
      "Error batch updating DCR:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Drive Photo & File Management Endpoints (Upload, List, Stream, Trash)
// ---------------------------------------------------------------------------

app.get("/api/drive/folder/:folderId/files", async (req, res) => {
  try {
    const { folderId } = req.params;
    const authHeader = req.headers.authorization;
    const drive = getDriveClient(authHeader);

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        "files(id, name, mimeType, thumbnailLink, webViewLink, size, modifiedTime)",
      pageSize: 100,
      orderBy: "folder,name",
    });

    const files = response.data.files || [];
    const images = files.filter(
      (f) => f.mimeType && f.mimeType.startsWith("image/"),
    );

    res.json({ files, images });
  } catch (err) {
    console.error("Error listing folder files:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to list folder files" });
  }
});

app.post(
  "/api/drive/folder/:folderId/upload",
  upload.array("files"),
  async (req, res) => {
    try {
      const { folderId } = req.params;
      const authHeader = req.headers.authorization;
      const drive = getDriveClient(authHeader);

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files provided for upload." });
      }

      const uploadPromises = req.files.map((file) => {
        const fileMetadata = {
          name: file.originalname,
          parents: [folderId],
        };
        const media = {
          mimeType: file.mimetype || "application/octet-stream",
          body: Readable.from(file.buffer),
        };

        return drive.files.create({
          requestBody: fileMetadata,
          media,
          fields: "id, name, mimeType, webViewLink",
        });
      });

      const uploaded = await Promise.all(uploadPromises);
      res.json({ success: true, count: uploaded.length });
    } catch (err) {
      console.error("Error uploading file(s) to Google Drive:", err);
      res
        .status(500)
        .json({
          error: err.message || "Failed to upload files to Google Drive",
        });
    }
  },
);

app.delete("/api/drive/file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const authHeader = req.headers.authorization;
    const drive = getDriveClient(authHeader);

    await drive.files.update({
      fileId,
      requestBody: {
        trashed: true,
      },
    });

    res.json({ success: true, message: "File moved to Google Drive trash" });
  } catch (err) {
    console.error("Error moving file to Google Drive trash:", err);
    res.status(500).json({ error: err.message || "Failed to trash file" });
  }
});

app.get("/api/drive/file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const authHeader =
      req.headers.authorization ||
      (req.query.token ? `Bearer ${req.query.token}` : null);

    if (!authHeader) {
      return res.status(401).send("Missing authorization token");
    }

    const drive = getDriveClient(authHeader);

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );

    if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }
    res.setHeader("Cache-Control", "private, max-age=86400");

    response.data.pipe(res);
  } catch (error) {
    console.error(
      "Error streaming drive file:",
      error?.response?.data || error.message,
    );
    res.status(500).send("Failed to stream image");
  }
});

// ---------------------------------------------------------------------------
// Static Asset Serving
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV === "production") {
  const clientDistPath = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDistPath));

  app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
