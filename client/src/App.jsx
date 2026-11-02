import React, { useState, useMemo, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import DCRReview from './components/DCRReview';


export const AuthContext = createContext(null);


function colIndexToA1(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}


function extractDriveFileIds(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [...text.matchAll(/(?:id=|\/d\/)([a-zA-Z0-9_-]{25,})/g)];
  return matches.map((m) => m[1]);
}


// ---------------------------------------------------------------------------
// Login Gateway Component
// ---------------------------------------------------------------------------
function LoginView({ onLoginSuccess, sessionExpired }) {
  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    onSuccess: (tokenResponse) => {
      // Google tokens expire in ~3600 seconds. Buffer by 5 minutes.
      const expiresInMs = (tokenResponse.expires_in || 3600) * 1000 - 300000;
      const expiryTimestamp = Date.now() + expiresInMs;
      
      sessionStorage.setItem('dcr_access_token', tokenResponse.access_token);
      sessionStorage.setItem('dcr_token_expiry', String(expiryTimestamp));
      onLoginSuccess(tokenResponse.access_token);
    },
    onError: (err) => {
      console.error('Google Sign-in failed', err);
    },
  });


  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: '32px 40px', background: '#fff', border: '1px solid #ddd', borderRadius: '8px', textAlign: 'center', maxWidth: '420px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
        <h2 style={{ margin: '0 0 12px 0' }}>DCR Tool Portal</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '24px' }}>
          Sign in with your authorized Google account to review and manage tracking operations.
        </p>


        {sessionExpired && (
          <div style={{ padding: '10px 14px', background: '#fdf3f2', border: '1px solid #f5c6cb', color: '#721c24', borderRadius: '4px', marginBottom: '20px', fontSize: '13px' }}>
            Your session has expired. Please sign in again to continue.
          </div>
        )}


        <button
          onClick={() => login()}
          style={{
            padding: '12px 24px',
            background: '#1a73e8',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '15px',
            fontWeight: 500,
            width: '100%',
          }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main Dashboard Table Component
// ---------------------------------------------------------------------------
function MainDashboard({
  tabName,
  setTabName,
  sheetData,
  setSheetData,
  searchQuery,
  setSearchQuery,
  page,
  setPage,
  pageSize,
  setPageSize,
}) {
  const navigate = useNavigate();
  const { accessToken, logout } = useContext(AuthContext);


  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [editingCell, setEditingCell] = useState(null);
  const [previewPhotoId, setPreviewPhotoId] = useState(null);


  const fetchSheet = async () => {
    if (!accessToken) return;
    setLoading(true);
    setStatusMessage('Loading...');
    try {
      const res = await fetch(`/api/sheet?tab=${encodeURIComponent(tabName)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });


      if (res.status === 401) {
        logout(true);
        return;
      }


      const data = await res.json();
      if (!res.ok) throw new Error(data.error);


      setSheetData(data.values || []);
      setPage(1);
      setStatusMessage(`Loaded ${(data.values || []).length} rows.`);
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };


  // Auto-fetch table if empty on mount
  useEffect(() => {
    if (accessToken && sheetData.length === 0) {
      fetchSheet();
    }
  }, [tabName]);


  const headers = useMemo(() => sheetData[0] || [], [sheetData]);
  const rawRows = useMemo(() => sheetData.slice(1) || [], [sheetData]);


  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rawRows;
    const q = searchQuery.toLowerCase();
    return rawRows.filter((row) =>
      row.some((cell) => String(cell || '').toLowerCase().includes(q))
    );
  }, [rawRows, searchQuery]);


  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);


  const handleSaveCell = async () => {
    if (!editingCell || !accessToken) return;
    const { cellA1, value, sheetRow, colIndex } = editingCell;
    setStatusMessage(`Saving ${cellA1}...`);


    const previous = [...sheetData];
    const updated = sheetData.map((row) => [...row]);
    if (updated[sheetRow - 1]) {
      updated[sheetRow - 1][colIndex] = value;
      setSheetData(updated);
    }


    try {
      const res = await fetch('/api/sheet/cell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ tabName, cell: cellA1, value }),
      });


      if (res.status === 401) {
        logout(true);
        return;
      }


      const result = await res.json();
      if (!res.ok) throw new Error(result.error);


      setStatusMessage(`Saved ${cellA1}!`);
      setEditingCell(null);
    } catch (err) {
      setSheetData(previous);
      setStatusMessage(`Save failed: ${err.message}`);
    }
  };


  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>DCR Operations Dashboard</h2>
        <button
          onClick={() => logout(false)}
          style={{ padding: '6px 12px', background: '#f1f3f4', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
        >
          Sign Out
        </button>
      </div>


      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={tabName}
          onChange={(e) => setTabName(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          <option value="Cable Replacement">Cable Replacement</option>
          <option value="QC Responses">QC Responses</option>
          <option value="Pole Transfers Form">Pole Transfers Form</option>
          <option value="Do's & Don'ts">Do's & Don'ts</option>
        </select>
        <button
          onClick={fetchSheet}
          disabled={loading}
          style={{ padding: '7px 16px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {loading ? 'Fetching...' : 'Reload Tab'}
        </button>
        <input
          type="text"
          placeholder="Search all records..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          style={{ padding: '7px 12px', minWidth: '260px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
      </div>


      {statusMessage && (
        <div style={{ padding: '8px 14px', background: '#f8f9fa', borderLeft: '4px solid #1a73e8', marginBottom: '14px', fontSize: '14px' }}>
          {statusMessage}
        </div>
      )}


      {editingCell && (
        <div style={{ marginBottom: '14px', padding: '12px', background: '#e8f0fe', border: '1px solid #d2e3fc', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Editing <strong>{editingCell.cellA1}</strong>:</span>
          <input
            type="text"
            value={editingCell.value}
            autoFocus
            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCell();
              if (e.key === 'Escape') setEditingCell(null);
            }}
            style={{ padding: '6px 10px', minWidth: '280px', borderRadius: '4px', border: '1px solid #aaa' }}
          />
          <button onClick={handleSaveCell} style={{ padding: '6px 12px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Save
          </button>
          <button onClick={() => setEditingCell(null)} style={{ padding: '6px 12px', background: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}


      {currentPageRows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', maxHeight: '68vh', background: '#fff' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f1f3f4', zIndex: 2 }}>
                <tr>
                  <th style={{ borderBottom: '2px solid #ccc', borderRight: '1px solid #ddd', padding: '8px 10px', width: '40px' }}>#</th>
                  {headers.map((h, i) => (
                    <th key={i} style={{ borderBottom: '2px solid #ccc', borderRight: '1px solid #ddd', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                      {h || `Col ${colIndexToA1(i)}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentPageRows.map((row, rIdx) => {
                  const originalRowIndex = rawRows.indexOf(row) + 2;
                  return (
                    <tr key={rIdx} style={{ borderBottom: '1px solid #eee', background: rIdx % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ borderRight: '1px solid #eee', padding: '6px 10px', color: '#888', textAlign: 'center', fontSize: '11px' }}>
                        {originalRowIndex}
                      </td>
                      {headers.map((_, cIdx) => {
                        const cellValue = row[cIdx] ?? '';
                        const cellA1 = `${colIndexToA1(cIdx)}${originalRowIndex}`;
                        const isColY = cIdx === 24;
                        const driveIds = extractDriveFileIds(cellValue);


                        if (isColY && tabName === 'Cable Replacement' && cellValue) {
                          return (
                            <td key={cIdx} style={{ padding: '6px 10px', borderRight: '1px solid #eee', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => navigate(`/dcr/${encodeURIComponent(cellValue)}`)}
                                style={{
                                  background: '#e8f0fe',
                                  color: '#1a73e8',
                                  border: '1px solid #1a73e8',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontWeight: 'bold',
                                }}
                                title="Open Review Page"
                              >
                                {cellValue} ↗
                              </button>
                            </td>
                          );
                        }


                        if (driveIds.length > 0) {
                          return (
                            <td key={cIdx} style={{ padding: '6px 10px', borderRight: '1px solid #eee', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                {driveIds.map((id, pIdx) => (
                                  <button
                                    key={id}
                                    onClick={() => setPreviewPhotoId(id)}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '11px',
                                      borderRadius: '12px',
                                      background: '#e8f0fe',
                                      color: '#1a73e8',
                                      border: '1px solid #1a73e8',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    📷 Photo {pIdx + 1}
                                  </button>
                                ))}
                              </div>
                            </td>
                          );
                        }


                        return (
                          <td
                            key={cIdx}
                            onClick={() => setEditingCell({ cellA1, value: cellValue, sheetRow: originalRowIndex, colIndex: cIdx })}
                            style={{ padding: '6px 10px', borderRight: '1px solid #eee', whiteSpace: 'nowrap', cursor: 'pointer' }}
                            title={`Click to edit ${cellA1}`}
                          >
                            {cellValue}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>


          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
            <div>
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} rows
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '5px 12px' }}>
                Previous
              </button>
              <span>Page <strong>{page}</strong> of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '5px 12px' }}>
                Next
              </button>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                style={{ marginLeft: '10px', padding: '4px' }}
              >
                <option value={25}>Show 25</option>
                <option value={50}>Show 50</option>
                <option value={100}>Show 100</option>
              </select>
            </div>
          </div>
        </>
      )}


      {previewPhotoId && (
        <div
          onClick={() => setPreviewPhotoId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: '16px', borderRadius: '8px', maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <a href={`https://drive.google.com/file/d/${previewPhotoId}/view`} target="_blank" rel="noreferrer" style={{ color: '#1a73e8', fontWeight: 'bold' }}>
                Open Original in Drive ↗
              </a>
              <button onClick={() => setPreviewPhotoId(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px' }}>
                ✕
              </button>
            </div>
            <img
              src={`https://drive.google.com/thumbnail?id=${previewPhotoId}&sz=w1200`}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = `https://drive.google.com/uc?export=view&id=${previewPhotoId}`;
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Root App with Session Validation & Routing
// ---------------------------------------------------------------------------
export default function App() {
  const [accessToken, setAccessToken] = useState(() => {
    const token = sessionStorage.getItem('dcr_access_token');
    const expiry = Number(sessionStorage.getItem('dcr_token_expiry') || 0);
    if (token && expiry && Date.now() < expiry) {
      return token;
    }
    sessionStorage.removeItem('dcr_access_token');
    sessionStorage.removeItem('dcr_token_expiry');
    return null;
  });


  const [sessionExpired, setSessionExpired] = useState(false);


  // Table state kept in memory across navigations
  const [tabName, setTabName] = useState('Cable Replacement');
  const [sheetData, setSheetData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);


  const logout = (dueToExpiry = false) => {
    sessionStorage.removeItem('dcr_access_token');
    sessionStorage.removeItem('dcr_token_expiry');
    setAccessToken(null);
    setSessionExpired(dueToExpiry);
  };


  const handleLoginSuccess = (token) => {
    setAccessToken(token);
    setSessionExpired(false);
  };


  return (
    <AuthContext.Provider value={{ accessToken, logout }}>
      <BrowserRouter>
        {!accessToken ? (
          <LoginView onLoginSuccess={handleLoginSuccess} sessionExpired={sessionExpired} />
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                <MainDashboard
                  tabName={tabName}
                  setTabName={setTabName}
                  sheetData={sheetData}
                  setSheetData={setSheetData}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  page={page}
                  setPage={setPage}
                  pageSize={pageSize}
                  setPageSize={setPageSize}
                />
              }
            />
            <Route
              path="/dcr/:dcrId"
              element={
                <DCRReview
                  onRecordUpdated={(sheetRowNumber, colIndex, newValue) => {
                    setSheetData((prev) => {
                      if (!prev || prev.length < sheetRowNumber) return prev;
                      const next = prev.map((r) => [...r]);
                      if (next[sheetRowNumber - 1]) {
                        next[sheetRowNumber - 1][colIndex] = newValue;
                      }
                      return next;
                    });
                  }}
                />
              }
            />
          </Routes>
        )}
      </BrowserRouter>
    </AuthContext.Provider>
  );
}