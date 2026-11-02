import React, { useState, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import DCRReview from './components/DCRReview';

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

function MainDashboard({ accessToken, setAccessToken }) {
  const navigate = useNavigate();
  const [tabName, setTabName] = useState('Cable Replacement');
  const [sheetData, setSheetData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState(null);
  const [previewPhotoId, setPreviewPhotoId] = useState(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    onSuccess: (token) => {
      setAccessToken(token.access_token);
      setStatusMessage('Signed in successfully.');
    },
    onError: () => setStatusMessage('Google sign-in failed.'),
  });

  const fetchSheet = async () => {
    if (!accessToken) return;
    setLoading(true);
    setStatusMessage('Loading...');
    try {
      const res = await fetch(`/api/sheet?tab=${encodeURIComponent(tabName)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
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
      <h2 style={{ margin: '0 0 16px 0' }}>DCR Operations Dashboard</h2>

      {/* Control Bar */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        {!accessToken ? (
          <button
            onClick={() => login()}
            style={{ padding: '10px 18px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
          >
            Sign in with Google
          </button>
        ) : (
          <>
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
              {loading ? 'Fetching...' : 'Load Sheet'}
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
          </>
        )}
      </div>

      {statusMessage && (
        <div style={{ padding: '8px 14px', background: '#f8f9fa', borderLeft: '4px solid #1a73e8', marginBottom: '14px', fontSize: '14px' }}>
          {statusMessage}
        </div>
      )}

      {/* Inline Editor */}
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

      {/* Grid */}
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
                        const isColY = cIdx === 24; // Column Y (DCR ID)
                        const driveIds = extractDriveFileIds(cellValue);

                        // If Column Y in Cable Replacement, link directly to /dcr/:id
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
                                title="Open Manager Review Page"
                              >
                                {cellValue} ↗
                              </button>
                            </td>
                          );
                        }

                        // Drive Photo Preview Button
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

          {/* Pagination */}
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

      {/* Drive Photo Modal */}
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

export default function App() {
  const [accessToken, setAccessToken] = useState(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainDashboard accessToken={accessToken} setAccessToken={setAccessToken} />} />
        <Route path="/dcr/:dcrId" element={<DCRReview accessToken={accessToken} />} />
      </Routes>
    </BrowserRouter>
  );
}