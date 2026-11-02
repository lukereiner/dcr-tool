import React, { useState, useMemo } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';

// Helper: Convert column index to A1 notation (0 -> A, 1 -> B, etc.)
function colIndexToA1(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

// Helper: Extract Google Drive file IDs from cell text (handles comma-separated links)
function extractDriveFileIds(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [...text.matchAll(/(?:id=|\/d\/)([a-zA-Z0-9_-]{25,})/g)];
  return matches.map((m) => m[1]);
}

export default function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [tabName, setTabName] = useState('QC Responses');
  const [sheetData, setSheetData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [globalFilter, setGlobalFilter] = useState('');
  const [editingCell, setEditingCell] = useState(null);

  // Modal preview state for Drive images
  const [previewPhotoId, setPreviewPhotoId] = useState(null);

  // Pagination state
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 50,
  });

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    onSuccess: (token) => {
      setAccessToken(token.access_token);
      setStatusMessage('Signed in successfully.');
    },
    onError: (err) => {
      console.error(err);
      setStatusMessage('Sign-in failed.');
    },
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
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
      setStatusMessage(`Loaded ${(data.values || []).length} rows.`);
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Build column definitions and structured rows
  const { columns, tableData } = useMemo(() => {
    if (!sheetData || sheetData.length === 0) return { columns: [], tableData: [] };

    const [headerRow, ...bodyRows] = sheetData;

    const cols = (headerRow || []).map((colName, cIndex) => ({
      accessorKey: `col_${cIndex}`,
      header: colName || `Col ${colIndexToA1(cIndex)}`,
      cell: (info) => {
        const val = info.getValue() ?? '';
        const driveIds = extractDriveFileIds(val);

        // If cell contains Drive photo URLs, render interactive preview chips
        if (driveIds.length > 0) {
          return (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
              {driveIds.map((id, idx) => (
                <button
                  key={id}
                  onClick={() => setPreviewPhotoId(id)}
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    borderRadius: '12px',
                    border: '1px solid #1a73e8',
                    background: '#e8f0fe',
                    color: '#1a73e8',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                  }}
                  title="Click to preview photo"
                >
                  📷 Photo {idx + 1}
                </button>
              ))}
            </div>
          );
        }

        return String(val);
      },
    }));

    const rows = (bodyRows || []).map((row, rIndex) => {
      const rowObj = { _rowIndex: rIndex + 2 };
      (headerRow || []).forEach((_, cIndex) => {
        rowObj[`col_${cIndex}`] = row[cIndex] ?? '';
      });
      return rowObj;
    });

    return { columns: cols, tableData: rows };
  }, [sheetData]);

  // Fast client-side global filtering
  const filteredData = useMemo(() => {
    if (!globalFilter.trim()) return tableData;
    const query = globalFilter.toLowerCase();
    return tableData.filter((row) =>
      Object.entries(row).some(
        ([key, val]) => key !== '_rowIndex' && String(val).toLowerCase().includes(query)
      )
    );
  }, [tableData, globalFilter]);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Cell Update logic
  const handleSaveCell = async () => {
    if (!editingCell || !accessToken) return;
    const { cellA1, value, sheetRow, colIndex } = editingCell;
    setStatusMessage(`Saving ${cellA1}...`);

    const previousData = [...sheetData];
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
      setSheetData(previousData);
      setStatusMessage(`Save failed: ${err.message}`);
    }
  };

  // Slice rows for the current page
  const pageStart = pagination.pageIndex * pagination.pageSize;
  const pagedRows = table.getRowModel().rows.slice(pageStart, pageStart + pagination.pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredData.length / pagination.pageSize));

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h2 style={{ margin: '0 0 16px 0' }}>DCR Sheet Manager</h2>

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
              <option value="QC Responses">QC Responses</option>
              <option value="Cable Replacement">Cable Replacement</option>
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
              placeholder="Search across all rows..."
              value={globalFilter}
              onChange={(e) => {
                setGlobalFilter(e.target.value);
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              style={{ padding: '7px 12px', minWidth: '260px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </>
        )}
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div style={{ padding: '8px 14px', background: '#f8f9fa', borderLeft: '4px solid #1a73e8', marginBottom: '14px', fontSize: '14px' }}>
          {statusMessage}
        </div>
      )}

      {/* Cell Editor Bar */}
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
            Save (Enter)
          </button>
          <button onClick={() => setEditingCell(null)} style={{ padding: '6px 12px', background: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Grid Layout */}
      {pagedRows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', maxHeight: '68vh', background: '#fff' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f1f3f4', zIndex: 2 }}>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    <th style={{ borderBottom: '2px solid #ccc', borderRight: '1px solid #ddd', padding: '8px 10px', textAlign: 'center', width: '40px' }}>
                      #
                    </th>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        style={{ borderBottom: '2px solid #ccc', borderRight: '1px solid #ddd', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {pagedRows.map((row, rIdx) => {
                  const sheetRow = row.original._rowIndex;
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid #eee', background: rIdx % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ borderRight: '1px solid #eee', padding: '6px 10px', color: '#888', textAlign: 'center', fontSize: '11px' }}>
                        {sheetRow}
                      </td>
                      {row.getVisibleCells().map((cell, cIdx) => {
                        const cellA1 = `${colIndexToA1(cIdx)}${sheetRow}`;
                        const rawVal = row.original[`col_${cIdx}`] ?? '';
                        return (
                          <td
                            key={cell.id}
                            onClick={() =>
                              setEditingCell({
                                cellA1,
                                value: rawVal,
                                sheetRow,
                                colIndex: cIdx,
                              })
                            }
                            style={{ padding: '6px 10px', borderRight: '1px solid #eee', whiteSpace: 'nowrap', cursor: 'pointer' }}
                            title={`Click to edit ${cellA1}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
            <div>
              Showing {pageStart + 1}–{Math.min(pageStart + pagination.pageSize, filteredData.length)} of {filteredData.length} rows
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setPagination((prev) => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))}
                disabled={pagination.pageIndex === 0}
                style={{ padding: '5px 12px' }}
              >
                Previous
              </button>
              <span>
                Page <strong>{pagination.pageIndex + 1}</strong> of {totalPages}
              </span>
              <button
                onClick={() => setPagination((prev) => ({ ...prev, pageIndex: Math.min(totalPages - 1, prev.pageIndex + 1) }))}
                disabled={pagination.pageIndex >= totalPages - 1}
                style={{ padding: '5px 12px' }}
              >
                Next
              </button>
              <select
                value={pagination.pageSize}
                onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
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

      {/* Photo Preview Modal */}
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
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: '16px',
              borderRadius: '8px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '12px' }}>
              <a
                href={`https://drive.google.com/file/d/${previewPhotoId}/view`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 'bold' }}
              >
                Open Original in Google Drive ↗
              </a>
              <button
                onClick={() => setPreviewPhotoId(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                ✕ Close
              </button>
            </div>
            <img
              src={`https://drive.google.com/thumbnail?id=${previewPhotoId}&sz=w1200`}
              alt="Inspection Upload Preview"
              style={{
                maxWidth: '100%',
                maxHeight: '75vh',
                objectFit: 'contain',
                borderRadius: '4px',
              }}
              onError={(e) => {
                e.target.onerror = null;
                // Fallback direct webContent link if thumbnail endpoint encounters restricted file types
                e.target.src = `https://drive.google.com/uc?export=view&id=${previewPhotoId}`;
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}