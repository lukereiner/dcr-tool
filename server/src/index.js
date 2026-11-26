import express from "express";
import cors from "cors";
import crypto from "crypto";
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

const SESSION_COOKIE_NAME = "dcr_session";
const INACTIVITY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours sliding inactivity timeout
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh access token 5 min before expiry
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

const upload = multer({
  storage: multer.memoryStorage(),
});

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const pendingRequests = new Map();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());

const MASTER_SPREADSHEET_ID = "1TrsDRv-aoCxPLzCp0ma6JlwamJPT13JuKuIda-5Uvdg";
const DATA_VAL_TAB = "Data Val (Cable Replacement)";
const FORM_RESPONSES_TAB = "Cable Replacement Responses";
const FORM_RESPONSES_DATA_VAL_TAB = "Data Val (Cable Replacement Responses)";
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

function getEncryptionKey() {
  if (!SESSION_SECRET) {
    throw new Error("Missing SESSION_SECRET in server environment.");
  }
  return crypto.createHash("sha256").update(SESSION_SECRET).digest();
}

function encryptSessionPayload(payload) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSessionPayload(tokenStr) {
  if (!tokenStr || typeof tokenStr !== "string") return null;
  const parts = tokenStr.split(".");
  if (parts.length !== 3) return null;

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], "base64url");
    const authTag = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;

  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const name = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    cookies[name] = val;
  });

  return cookies;
}

function isHttpsRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return proto === "https";
}

function setSessionCookie(req, res, sessionData) {
  const encryptedValue = encryptSessionPayload(sessionData);
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(encryptedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(INACTIVITY_WINDOW_MS / 1000)}`,
  ];
  if (isHttpsRequest(req)) {
    cookieParts.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(req, res) {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isHttpsRequest(req)) {
    cookieParts.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function createOAuthClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in server environment.",
    );
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    "postmessage",
  );
}

// Validates the 2-hour sliding inactivity window and refreshes access_token if needed
async function resolveActiveSession(req, res) {
  const cookies = parseCookies(req);
  const rawCookie = cookies[SESSION_COOKIE_NAME];
  const session = decryptSessionPayload(rawCookie);

  if (!session || !session.access_token) {
    const err = new Error("Authentication required. Please sign in.");
    err.statusCode = 401;
    throw err;
  }

  const now = Date.now();
  const lastActive = Number(session.lastActive || 0);

  if (!lastActive || now - lastActive > INACTIVITY_WINDOW_MS) {
    clearSessionCookie(req, res);
    const err = new Error(
      "Session expired due to 2 hours of inactivity. Please sign in again.",
    );
    err.statusCode = 401;
    throw err;
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expiry_date: session.expiry_date,
  });

  let updatedAccessToken = session.access_token;
  let updatedExpiryDate = session.expiry_date || now + 3600 * 1000;
  let needsCookieUpdate = true;

  const isExpiringSoon =
    !session.expiry_date ||
    Number(session.expiry_date) - now <= REFRESH_BUFFER_MS;

  if (isExpiringSoon && session.refresh_token) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        updatedAccessToken = credentials.access_token;
        oauth2Client.setCredentials({
          ...credentials,
          refresh_token: credentials.refresh_token || session.refresh_token,
        });
      }
      if (credentials.expiry_date) {
        updatedExpiryDate = credentials.expiry_date;
      }
    } catch (refreshErr) {
      console.warn(
        "[AUTH REFRESH] Failed to refresh Google access token:",
        refreshErr?.message || refreshErr,
      );
      if (session.expiry_date && now >= Number(session.expiry_date)) {
        clearSessionCookie(req, res);
        const err = new Error(
          "Google session expired. Please sign in again.",
        );
        err.statusCode = 401;
        throw err;
      }
    }
  }

  const nextSession = {
    ...session,
    access_token: updatedAccessToken,
    expiry_date: updatedExpiryDate,
    lastActive: now,
  };

  if (needsCookieUpdate && res) {
    setSessionCookie(req, res, nextSession);
  }

  return {
    oauth2Client,
    accessToken: updatedAccessToken,
    email: session.email || "",
  };
}

const getSheetsClientFromSession = (oauth2Client) =>
  google.sheets({
    version: "v4",
    auth: oauth2Client,
    retryConfig: googleRetryConfig,
  });

const getDriveClientFromSession = (oauth2Client) =>
  google.drive({
    version: "v3",
    auth: oauth2Client,
    retryConfig: googleRetryConfig,
  });

async function getUserEmailFromSession(sessionCtx) {
  if (sessionCtx.email) {
    return sessionCtx.email.toLowerCase().trim();
  }

  const cacheKey = `user_email_${sessionCtx.accessToken.substring(0, 24)}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const tokenInfo = await sessionCtx.oauth2Client.getTokenInfo(
    sessionCtx.accessToken,
  );
  const email = (tokenInfo.email || "").toLowerCase().trim();

  if (!email) {
    throw new Error(
      "Unable to extract verified email from Google authorization session.",
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

async function resolveRegionSpreadsheet(req, sheets, sessionCtx) {
  const userEmail = await getUserEmailFromSession(sessionCtx);
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

  const requestedId = (req.query.region || req.body?.region || "")
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

async function getSpreadsheetTabs(sheets, spreadsheetId, forceRefresh = false) {
  const cacheKey = `tabs_${spreadsheetId}`;

  if (forceRefresh) {
    cache.del(cacheKey);
  }

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,hidden)",
  });

  const tabs = (response.data.sheets || [])
    .filter((s) => !s.properties?.hidden)
    .map((s) => s.properties?.title);

  cache.set(cacheKey, tabs, 300);
  return tabs;
}

// ---------------------------------------------------------------------------
// Authentication & Region Discovery Endpoints
// ---------------------------------------------------------------------------

app.post("/api/auth/google", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res
        .status(400)
        .json({ error: "Missing authorization code from Google sign-in." });
    }

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      return res
        .status(400)
        .json({ error: "Google did not return an access token." });
    }

    oauth2Client.setCredentials(tokens);
    let email = "";
    try {
      const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
      email = (tokenInfo.email || "").toLowerCase().trim();
    } catch {
      // Fallback to getTokenInfo later if needed
    }

    const now = Date.now();
    setSessionCookie(req, res, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || "",
      expiry_date: tokens.expiry_date || now + 3600 * 1000,
      email,
      lastActive: now,
    });

    res.json({ authenticated: true, email });
  } catch (error) {
    console.error(
      "Error exchanging Google auth code:",
      error?.response?.data || error.message,
    );
    res.status(401).json({
      error:
        error?.response?.data?.error_description ||
        error?.response?.data?.error ||
        error.message ||
        "Google sign-in failed.",
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ authenticated: false });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const userEmail = await getUserEmailFromSession(sessionCtx);
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
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
    );

    const { values, dropdownOptions, formLinks } =
      await getOrFetchSheetWithValidation(
        sheets,
        spreadsheetId,
        targetRegion.id,
        tabName,
        forceRefresh,
      );

    const tabs = await getSpreadsheetTabs(sheets, spreadsheetId, forceRefresh);

    res.json({ values, dropdownOptions, formLinks, region: targetRegion, tabs });
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
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const { tabName = MAIN_TAB, cell, value } = req.body;

    if (!cell) {
      return res
        .status(400)
        .json({ error: "Missing cell coordinate (e.g. B2)" });
    }

    const { targetRegion, spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
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
const FORM_RESPONSE_HIDDEN_COLS = new Set([19, 20, 21]);

app.get("/api/dcr/:dcrId", async (req, res) => {
  try {
    const { dcrId } = req.params;
    const forceRefresh = req.query.refresh === "true";
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const token = sessionCtx.accessToken;

    const { targetRegion, spreadsheetId, userProfile } =
      await resolveRegionSpreadsheet(req, sheets, sessionCtx);

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
    const DCR_COL_INDEX = 24;

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

    const formRespHeaders = (formResponseRows && formResponseRows[0]) || headers;
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

    const formResponseFields = [];
    for (let formIdx = 1; formIdx <= 24; formIdx++) {
      if (formIdx === 23) continue;
      if (FORM_RESPONSE_HIDDEN_COLS.has(formIdx)) continue;

      const isDcrIdCol = formIdx === 24;
      const mainIdx = isDcrIdCol ? 24 : formIdx + 1;
      const mainColLetter = getColLetter(mainIdx);
      const formRespColLetter = getColLetter(formIdx);
      const isEditable =
        !isDcrIdCol && canEditFormResponses && formRespFoundIndex !== -1;

      let inputType = "textarea";
      let placeholder = "";

      if (formRespColLetter === "B") {
        inputType = "text";
        placeholder = "m/d/yy";
      } else if (formRespColLetter === "D") {
        inputType = "textarea";
        placeholder = "First name, Last name";
      } else if (FORM_RESPONSE_DROPDOWN_COLS.has(formRespColLetter)) {
        inputType = "select";
      } else if (isDcrIdCol) {
        inputType = "text";
      }

      formResponseFields.push({
        colIndex: mainIdx,
        colLetter: mainColLetter,
        formRespColIndex: formIdx,
        formRespColLetter,
        header:
          headers[mainIdx] ||
          formRespHeaders[formIdx] ||
          `Column ${mainColLetter}`,
        value: formRespTargetRow[formIdx] || "",
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
    const { colLetter, text, sheetRowNumber, sheetId } = req.body;
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const token = sessionCtx.accessToken;

    if (!colLetter || !text || !String(text).trim()) {
      return res
        .status(400)
        .json({ error: "Missing colLetter or comment text." });
    }

    const colIndex = colLetterToIndex(colLetter);
    const rowIndex = (Number(sheetRowNumber) || 1) - 1;
    const { spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
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
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const drive = getDriveClientFromSession(sessionCtx.oauth2Client);
    const token = sessionCtx.accessToken;
    const { spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
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
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const token = sessionCtx.accessToken;
    const { spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
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
      const sessionCtx = await resolveActiveSession(req, res);
      const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
      const drive = getDriveClientFromSession(sessionCtx.oauth2Client);
      const token = sessionCtx.accessToken;
      const { spreadsheetId } = await resolveRegionSpreadsheet(
        req,
        sheets,
        sessionCtx,
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
      res.status(error.statusCode || 500).json({
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
      const sessionCtx = await resolveActiveSession(req, res);
      const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
      const drive = getDriveClientFromSession(sessionCtx.oauth2Client);
      const token = sessionCtx.accessToken;
      const { spreadsheetId } = await resolveRegionSpreadsheet(
        req,
        sheets,
        sessionCtx,
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
      res.status(error.statusCode || 500).json({
        error: error?.response?.data?.error?.message || error.message,
      });
    }
  },
);

app.post("/api/dcr/:dcrId/comment/resolve", async (req, res) => {
  try {
    const { commentId, sheetRowNumber, resolved } = req.body;
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const token = sessionCtx.accessToken;
    const { spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
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
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const drive = getDriveClientFromSession(sessionCtx.oauth2Client);
    const token = sessionCtx.accessToken;
    const { spreadsheetId } = await resolveRegionSpreadsheet(
      req,
      sheets,
      sessionCtx,
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
// Batch Update (Executes 'Cable Replacement' & 'DCR Form Responses' independently)
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

    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    const { targetRegion, spreadsheetId, userProfile } =
      await resolveRegionSpreadsheet(req, sheets, sessionCtx);

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
    const sessionCtx = await resolveActiveSession(req, res);
    const drive = getDriveClientFromSession(sessionCtx.oauth2Client);

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        "files(id, name, mimeType, thumbnailLink, webViewLink, size, modifiedTime)",
      pageSize: 100,
      orderBy: "folder,name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = response.data.files || [];
    const images = files.filter(
      (f) => f.mimeType && f.mimeType.startsWith("image/"),
    );

    res.json({ files, images });
  } catch (err) {
    console.error("Error listing folder files:", err);
    const status = err.statusCode || err?.response?.status || 500;
    res
      .status(status)
      .json({ error: err.message || "Failed to list folder files" });
  }
});

const driveSubfolderCache = new NodeCache({ stdTTL: 180, checkperiod: 60 });
const pendingFolderCreations = new Map();

function createAbortError(message = "Upload aborted by client") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function isDriveNotFoundError(err) {
  const status = err?.response?.status || err?.code;
  return Number(status) === 404;
}

function isDriveRateLimitError(err) {
  const status = err?.response?.status || err?.code;
  if (status === 429 || (status >= 500 && status <= 503)) return true;
  if (status === 403) {
    const reason = err?.response?.data?.error?.errors?.[0]?.reason || "";
    const msg = err?.response?.data?.error?.message || err?.message || "";
    return (
      reason === "userRateLimitExceeded" ||
      reason === "rateLimitExceeded" ||
      msg.toLowerCase().includes("rate limit")
    );
  }
  return false;
}

function sleepWithAbort(ms, signal) {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runWithDriveRetry(fn, maxRetries = 5, signal = null) {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") {
        throw createAbortError();
      }
      attempt += 1;
      if (attempt > maxRetries || !isDriveRateLimitError(err)) {
        throw err;
      }
      const delayMs =
        1500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 600);
      console.warn(
        `[DRIVE RATE LIMIT] Retrying attempt #${attempt} in ${delayMs}ms...`,
      );
      await sleepWithAbort(delayMs, signal);
    }
  }
}

async function runWithConcurrency(items, concurrency, worker, signal = null) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        if (signal?.aborted) {
          throw createAbortError();
        }
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

app.post(
  "/api/drive/folder/:folderId/upload",
  upload.array("files"),
  async (req, res) => {
    const abortController = new AbortController();
    const { signal } = abortController;

    const handleClientDisconnect = () => {
      if (!res.writableFinished && !signal.aborted) {
        abortController.abort();
      }
    };

    res.on("close", handleClientDisconnect);
    req.socket?.on("close", handleClientDisconnect);

    try {
      if (signal.aborted || req.socket?.destroyed) {
        return;
      }

      const { folderId } = req.params;
      const sessionCtx = await resolveActiveSession(req, res);
      const drive = getDriveClientFromSession(sessionCtx.oauth2Client);

      let relativePaths = [];
      if (req.body?.relativePaths) {
        try {
          const parsed = JSON.parse(req.body.relativePaths);
          if (Array.isArray(parsed)) relativePaths = parsed;
        } catch {
          // Fallback to originalname if malformed
        }
      }

      let emptyFolders = [];
      if (req.body?.emptyFolders) {
        try {
          const parsed = JSON.parse(req.body.emptyFolders);
          if (Array.isArray(parsed)) emptyFolders = parsed;
        } catch {
          // Ignore if malformed
        }
      }

      if ((!req.files || req.files.length === 0) && emptyFolders.length === 0) {
        return res
          .status(400)
          .json({ error: "No files or folders provided for upload." });
      }

      const ensureDriveFolder = async (dirPath, bypassCache = false) => {
        if (signal.aborted) {
          throw createAbortError();
        }

        const normalized = String(dirPath || "")
          .split("/")
          .map((p) => p.trim())
          .filter(Boolean)
          .join("/");

        if (!normalized) return folderId;

        const cacheKey = `${folderId}::${normalized}`;

        if (bypassCache) {
          driveSubfolderCache.del(cacheKey);
        } else {
          const cachedId = driveSubfolderCache.get(cacheKey);
          if (cachedId) return cachedId;
        }

        const inflightKey = `${cacheKey}::${bypassCache ? "fresh" : "cached"}`;
        if (pendingFolderCreations.has(inflightKey)) {
          return pendingFolderCreations.get(inflightKey);
        }

        const createPromise = (async () => {
          try {
            const parts = normalized.split("/");
            const folderName = parts[parts.length - 1];
            const parentPath = parts.slice(0, -1).join("/");
            const parentId = await ensureDriveFolder(parentPath, bypassCache);

            const safeName = folderName
              .replace(/\\/g, "\\\\")
              .replace(/'/g, "\\'");
            const existingRes = await runWithDriveRetry(
              () =>
                drive.files.list(
                  {
                    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                    fields: "files(id, name)",
                    pageSize: 1,
                    supportsAllDrives: true,
                    includeItemsFromAllDrives: true,
                  },
                  { signal },
                ),
              5,
              signal,
            );

            if (existingRes.data.files && existingRes.data.files.length > 0) {
              const existingId = existingRes.data.files[0].id;
              driveSubfolderCache.set(cacheKey, existingId);
              return existingId;
            }

            const created = await runWithDriveRetry(
              () =>
                drive.files.create(
                  {
                    requestBody: {
                      name: folderName,
                      mimeType: "application/vnd.google-apps.folder",
                      parents: [parentId],
                    },
                    fields: "id, name",
                    supportsAllDrives: true,
                  },
                  { signal },
                ),
              5,
              signal,
            );

            const newId = created.data.id;
            driveSubfolderCache.set(cacheKey, newId);
            return newId;
          } finally {
            pendingFolderCreations.delete(inflightKey);
          }
        })();

        pendingFolderCreations.set(inflightKey, createPromise);
        return createPromise;
      };

      for (const dirPath of emptyFolders) {
        if (signal.aborted) {
          throw createAbortError();
        }
        await ensureDriveFolder(dirPath, true);
      }

      const uploadSingleFileToDrive = (file, targetFileName, targetParentId) =>
        runWithDriveRetry(
          () => {
            const bodyStream = Readable.from(file.buffer);
            const destroyStreamOnAbort = () => {
              if (!bodyStream.destroyed) {
                bodyStream.destroy(createAbortError());
              }
            };
            signal.addEventListener("abort", destroyStreamOnAbort, {
              once: true,
            });

            return drive.files
              .create(
                {
                  requestBody: {
                    name: targetFileName || file.originalname,
                    parents: [targetParentId],
                  },
                  media: {
                    mimeType: file.mimetype || "application/octet-stream",
                    body: bodyStream,
                  },
                  fields: "id, name, mimeType, webViewLink",
                  supportsAllDrives: true,
                },
                { signal },
              )
              .finally(() => {
                signal.removeEventListener("abort", destroyStreamOnAbort);
              });
          },
          5,
          signal,
        );

      const uploaded = await runWithConcurrency(
        req.files || [],
        3,
        async (file, idx) => {
          if (signal.aborted) {
            throw createAbortError();
          }

          const relPath = String(relativePaths[idx] || file.originalname || "");
          const lastSlash = relPath.lastIndexOf("/");
          const dirPath =
            lastSlash !== -1 ? relPath.substring(0, lastSlash) : "";
          const targetFileName =
            lastSlash !== -1
              ? relPath.substring(lastSlash + 1)
              : file.originalname;

          const targetParentId = await ensureDriveFolder(dirPath, false);

          try {
            return await uploadSingleFileToDrive(
              file,
              targetFileName,
              targetParentId,
            );
          } catch (err) {
            if (dirPath && isDriveNotFoundError(err) && !signal.aborted) {
              const freshParentId = await ensureDriveFolder(dirPath, true);
              return await uploadSingleFileToDrive(
                file,
                targetFileName,
                freshParentId,
              );
            }
            throw err;
          }
        },
        signal,
      );

      if (!signal.aborted && !res.headersSent) {
        res.json({
          success: true,
          count: uploaded.length,
        });
      }
    } catch (err) {
      if (signal.aborted || err?.name === "AbortError") {
        console.log("[DRIVE UPLOAD] Upload aborted by client.");
        if (!res.headersSent) {
          res.status(499).end();
        }
        return;
      }
      console.error("Error uploading file(s) to Google Drive:", err);
      const status = err.statusCode || err?.response?.status || 500;
      if (!res.headersSent) {
        res.status(status).json({
          error: err.message || "Failed to upload files to Google Drive",
        });
      }
    } finally {
      res.off("close", handleClientDisconnect);
      req.socket?.off("close", handleClientDisconnect);
    }
  },
);

app.delete("/api/drive/file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const sessionCtx = await resolveActiveSession(req, res);
    const drive = getDriveClientFromSession(sessionCtx.oauth2Client);

    await drive.files.update({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        trashed: true,
      },
    });

    driveSubfolderCache.flushAll();

    res.json({ success: true, message: "File moved to Google Drive trash" });
  } catch (err) {
    console.error("Error moving file to Google Drive trash:", err);
    const status = err.statusCode || err?.response?.status || 500;
    res
      .status(status)
      .json({ error: err.message || "Failed to trash file" });
  }
});

app.get("/api/drive/file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const sessionCtx = await resolveActiveSession(req, res);
    const drive = getDriveClientFromSession(sessionCtx.oauth2Client);

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
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).send("Failed to stream image");
  }
});

// ---------------------------------------------------------------------------
// Master Dashboard Endpoints (Summary, System Ext Data, Mileage Table)
// ---------------------------------------------------------------------------

async function verifyMasterUser(req, res, sheets, sessionCtx) {
  const userEmail = await getUserEmailFromSession(sessionCtx);
  const { users } = await getMasterConfig(sheets, false);
  const userProfile = users.find((u) => u.email === userEmail);

  if (!userProfile) {
    const error = new Error(
      `Account "${userEmail}" is not authorized in UserConfig.`,
    );
    error.statusCode = 403;
    throw error;
  }

  const userRole = String(userProfile.role || "")
    .trim()
    .toUpperCase();
  if (userRole !== "DIRECTOR") {
    const error = new Error(
      "Access denied. Master sheet is restricted to Director role.",
    );
    error.statusCode = 403;
    throw error;
  }

  return { userEmail, userProfile };
}

async function extractDropdownOptionsFromValidation(sheets, cellData) {
  const dv = cellData?.dataValidation;
  if (!dv || !dv.condition) return [];

  const { type, values = [] } = dv.condition;

  if (type === "ONE_OF_LIST") {
    return values
      .map((v) => String(v?.userEnteredValue || "").trim())
      .filter(Boolean);
  }

  if (type === "ONE_OF_RANGE") {
    const rawRange = String(values[0]?.userEnteredValue || "")
      .replace(/^=/, "")
      .trim();
    if (!rawRange) return [];

    try {
      const rangeRes = await sheets.spreadsheets.values.get({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        range: rawRange,
      });
      const flat = (rangeRes.data.values || [])
        .flat()
        .map((val) => String(val || "").trim())
        .filter(Boolean);
      return Array.from(new Set(flat));
    } catch (err) {
      console.warn(
        `[MASTER DROPDOWN] Could not resolve range "${rawRange}":`,
        err.message,
      );
      return [];
    }
  }

  return [];
}

async function resolveMasterDropdownOptions(sheets) {
  try {
    const metaRes = await sheets.spreadsheets.get({
      spreadsheetId: MASTER_SPREADSHEET_ID,
      ranges: [
        "'Summary'!C2",
        "'System Ext Data'!B2",
        "'System Ext Data'!B4",
      ],
      fields: "sheets(properties.title,data.rowData.values.dataValidation)",
    });

    const sheetList = metaRes.data.sheets || [];
    const summarySheet = sheetList.find(
      (s) => s.properties?.title === "Summary",
    );
    const sysExtSheet = sheetList.find(
      (s) => s.properties?.title === "System Ext Data",
    );

    const summaryC2Cell = summarySheet?.data?.[0]?.rowData?.[0]?.values?.[0];
    const sysExtB2Cell = sysExtSheet?.data?.[0]?.rowData?.[0]?.values?.[0];
    const sysExtB4Cell = sysExtSheet?.data?.[1]?.rowData?.[0]?.values?.[0];

    const [summaryRegions, sysExtRegions, sysExtSystems] = await Promise.all([
      extractDropdownOptionsFromValidation(sheets, summaryC2Cell),
      extractDropdownOptionsFromValidation(sheets, sysExtB2Cell),
      extractDropdownOptionsFromValidation(sheets, sysExtB4Cell),
    ]);

    return {
      summaryRegions,
      sysExtRegions,
      sysExtSystems,
    };
  } catch (err) {
    console.warn(
      "[MASTER DROPDOWN] Failed to fetch data validation metadata:",
      err.message,
    );
    return {
      summaryRegions: [],
      sysExtRegions: [],
      sysExtSystems: [],
    };
  }
}

app.get("/api/master", async (req, res) => {
  try {
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    await verifyMasterUser(req, res, sheets, sessionCtx);

    const [batchRes, dropdowns] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        ranges: [
          "'Summary'!C1:C2",
          "'Summary'!B4:H43",
          "'System Ext Data'!B2:B4",
          "'System Ext Data'!C1:U42",
          "'Mileage Table'!A2:I119",
          "'Mileage Table'!D122:I122",
        ],
      }),
      resolveMasterDropdownOptions(sheets),
    ]);

    const ranges = batchRes.data.valueRanges || [];
    const summaryControls = ranges[0]?.values || [];
    const summaryRows = ranges[1]?.values || [];
    const sysExtControls = ranges[2]?.values || [];
    const sysExtAllRows = ranges[3]?.values || [];
    const mileageRows = ranges[4]?.values || [];
    const mileageTotalsRow = ranges[5]?.values?.[0] || [];

    const summaryYear = String(summaryControls[0]?.[0] || "").trim();
    const summaryRegion = String(summaryControls[1]?.[0] || "").trim();

    const sysExtRegion = String(sysExtControls[0]?.[0] || "").trim();
    const sysExtSystem = String(sysExtControls[2]?.[0] || "").trim();

    res.json({
      summary: {
        year: summaryYear,
        region: summaryRegion,
        regionOptions: dropdowns.summaryRegions,
        rows: summaryRows,
      },
      systemExt: {
        region: sysExtRegion,
        system: sysExtSystem,
        regionOptions: dropdowns.sysExtRegions,
        systemOptions: dropdowns.sysExtSystems,
        startingMileageRow: sysExtAllRows[0] || [],
        endingMileageRow: sysExtAllRows[1] || [],
        rows: sysExtAllRows.slice(2),
      },
      mileage: {
        rows: mileageRows,
        totals: mileageTotalsRow,
      },
    });
  } catch (error) {
    console.error(
      "Error fetching Master data:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.post("/api/master/control", async (req, res) => {
  try {
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    await verifyMasterUser(req, res, sheets, sessionCtx);

    const { tab, cell, value } = req.body;
    const cleanCell = String(cell || "")
      .trim()
      .toUpperCase();

    const allowedControls = {
      Summary: new Set(["C2"]),
      "System Ext Data": new Set(["B2", "B4"]),
    };

    if (!allowedControls[tab] || !allowedControls[tab].has(cleanCell)) {
      return res.status(400).json({
        error: `Cell "${tab}!${cleanCell}" is not an allowed Master dropdown control.`,
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: MASTER_SPREADSHEET_ID,
      range: `'${tab}'!${cleanCell}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value ?? ""]] },
    });

    await new Promise((resolve) => setTimeout(resolve, 650));

    if (tab === "Summary") {
      const [batchRes, dropdowns] = await Promise.all([
        sheets.spreadsheets.values.batchGet({
          spreadsheetId: MASTER_SPREADSHEET_ID,
          ranges: ["'Summary'!C1:C2", "'Summary'!B4:H43"],
        }),
        resolveMasterDropdownOptions(sheets),
      ]);

      const ranges = batchRes.data.valueRanges || [];
      const controls = ranges[0]?.values || [];
      const rows = ranges[1]?.values || [];

      return res.json({
        success: true,
        summary: {
          year: String(controls[0]?.[0] || "").trim(),
          region: String(controls[1]?.[0] || "").trim(),
          regionOptions: dropdowns.summaryRegions,
          rows,
        },
      });
    }

    const [batchRes, dropdowns] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        ranges: ["'System Ext Data'!B2:B4", "'System Ext Data'!C1:U42"],
      }),
      resolveMasterDropdownOptions(sheets),
    ]);

    const ranges = batchRes.data.valueRanges || [];
    const controls = ranges[0]?.values || [];
    const allRows = ranges[1]?.values || [];

    return res.json({
      success: true,
      systemExt: {
        region: String(controls[0]?.[0] || "").trim(),
        system: String(controls[2]?.[0] || "").trim(),
        regionOptions: dropdowns.sysExtRegions,
        systemOptions: dropdowns.sysExtSystems,
        startingMileageRow: allRows[0] || [],
        endingMileageRow: allRows[1] || [],
        rows: allRows.slice(2),
      },
    });
  } catch (error) {
    console.error(
      "Error updating Master control:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
  }
});

app.post("/api/master/mileage", async (req, res) => {
  try {
    const sessionCtx = await resolveActiveSession(req, res);
    const sheets = getSheetsClientFromSession(sessionCtx.oauth2Client);
    await verifyMasterUser(req, res, sheets, sessionCtx);

    const { cell, value } = req.body;
    const cleanCell = String(cell || "")
      .trim()
      .toUpperCase();

    if (!/^[A-I]([3-9]|[1-9][0-9]|10[0-9]|11[0-9])$/.test(cleanCell)) {
      return res.status(400).json({
        error: `Cell "${cleanCell}" is outside the editable Mileage Table range (A3:I119).`,
      });
    }

    const updateRes = await sheets.spreadsheets.values.update({
      spreadsheetId: MASTER_SPREADSHEET_ID,
      range: `'Mileage Table'!${cleanCell}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value ?? ""]] },
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    const totalsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: MASTER_SPREADSHEET_ID,
      range: "'Mileage Table'!D122:I122",
    });

    res.json({
      success: true,
      updatedRange: updateRes.data.updatedRange,
      totals: totalsRes.data.values?.[0] || [],
    });
  } catch (error) {
    console.error(
      "Error updating Mileage Table cell:",
      error?.response?.data || error.message,
    );
    const status = error.statusCode || error?.response?.status || 500;
    res.status(status).json({
      error: error?.response?.data?.error?.message || error.message,
    });
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