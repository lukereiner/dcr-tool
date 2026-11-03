import { useState, useMemo, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { useToast } from '../context/ToastContext';


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


export default function Data({
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
  fetchSheet,
  loading,
}) {
  const navigate = useNavigate();
  const { accessToken, logout } = useContext(AuthContext);
  const { showToast } = useToast();


  const [editingCell, setEditingCell] = useState(null);
  const [previewPhotoId, setPreviewPhotoId] = useState(null);


  useEffect(() => {
    if (accessToken && (!sheetData || sheetData.length === 0)) {
      fetchSheet();
    }
  }, [accessToken, tabName]);


  const headers = useMemo(() => sheetData[0] || [], [sheetData]);
  const rawRows = useMemo(() => (sheetData.length > 1 ? sheetData.slice(1) : []), [sheetData]);


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


      showToast(`Saved ${cellA1} successfully!`, 'success');
      setEditingCell(null);
    } catch (err) {
      setSheetData(previous);
      showToast(`Save failed: ${err.message}`, 'error');
    }
  };


  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <style>{`
        .sheet-table-row {
          border-bottom: 1px solid var(--border-subtle);
          transition: background-color 0.15s ease;
        }
        .sheet-table-row:nth-child(even) {
          background-color: var(--bg-card);
        }
        .sheet-table-row:nth-child(odd) {
          background-color: var(--bg-card-subtle);
        }
        .sheet-table-row:hover {
          background-color: var(--bg-input);
        }
        .sheet-cell {
          padding: 8px 12px;
          border-right: 1px solid var(--border-subtle);
          white-space: nowrap;
          color: var(--text-main);
          font-size: 13px;
        }
        .sheet-cell-editable {
          cursor: pointer;
        }
        .sheet-cell-editable:hover {
          outline: 1px dashed var(--btn-primary-bg);
          outline-offset: -1px;
        }
      `}</style>


      {/* Control Bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={tabName}
          onChange={(e) => {
            setTabName(e.target.value);
            setPage(1);
          }}
          className="dcr-select"
          style={{ minWidth: '180px' }}
        >
          <option value="Cable Replacement">Cable Replacement</option>
          <option value="QC Responses">QC Responses</option>
          <option value="Pole Transfers Form">Pole Transfers Form</option>
          <option value="Do's & Don'ts">Do's & Don'ts</option>
        </select>


        <button
          onClick={() => fetchSheet(true)}
          disabled={loading}
          className="btn-primary"
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
          className="dcr-input"
          style={{ minWidth: '280px', flex: '1 1 280px', maxWidth: '450px' }}
        />
      </div>


      {/* Inline Editor */}
      {editingCell && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            background: 'var(--bg-card-subtle)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <span style={{ fontSize: '13px', color: 'var(--text-main)' }}>
            Editing <strong>{editingCell.cellA1}</strong>:
          </span>
          <input
            type="text"
            value={editingCell.value}
            autoFocus
            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCell();
              if (e.key === 'Escape') setEditingCell(null);
            }}
            className="dcr-input"
            style={{ minWidth: '300px' }}
          />
          <button onClick={handleSaveCell} className="btn-primary">
            Save
          </button>
          <button onClick={() => setEditingCell(null)} className="btn-secondary">
            Cancel
          </button>
        </div>
      )}


      {/* Grid Table */}
      {currentPageRows.length > 0 ? (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>
              <thead
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg-card-subtle)',
                  zIndex: 2,
                  borderBottom: '2px solid var(--border-color)',
                }}
              >
                <tr>
                  <th
                    style={{
                      borderRight: '1px solid var(--border-subtle)',
                      padding: '10px 12px',
                      width: '45px',
                      color: 'var(--text-subtle)',
                      textAlign: 'center',
                      fontSize: '12px',
                    }}
                  >
                    #
                  </th>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      style={{
                        borderRight: '1px solid var(--border-subtle)',
                        padding: '10px 14px',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        color: 'var(--text-main)',
                        fontWeight: 600,
                      }}
                    >
                      {h || `Col ${colIndexToA1(i)}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentPageRows.map((row, rIdx) => {
                  const originalRowIndex = rawRows.indexOf(row) + 2;
                  return (
                    <tr key={rIdx} className="sheet-table-row">
                      <td
                        style={{
                          borderRight: '1px solid var(--border-subtle)',
                          padding: '8px 10px',
                          color: 'var(--text-subtle)',
                          textAlign: 'center',
                          fontSize: '11px',
                        }}
                      >
                        {originalRowIndex}
                      </td>
                      {headers.map((_, cIdx) => {
                        const cellValue = row[cIdx] ?? '';
                        const cellA1 = `${colIndexToA1(cIdx)}${originalRowIndex}`;
                        const isColY = cIdx === 24;
                        const driveIds = extractDriveFileIds(cellValue);


                        if (isColY && tabName === 'Cable Replacement' && cellValue) {
                          return (
                            <td key={cIdx} className="sheet-cell">
                              <button
                                onClick={() => navigate(`/dcr/${encodeURIComponent(cellValue)}`)}
                                className="btn-secondary"
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: 'var(--btn-primary-bg)',
                                }}
                              >
                                {cellValue} ↗
                              </button>
                            </td>
                          );
                        }


                        if (driveIds.length > 0) {
                          return (
                            <td key={cIdx} className="sheet-cell">
                              <div style={{ display: 'flex', gap: '6px' }}>
                                {driveIds.map((id, pIdx) => (
                                  <button
                                    key={id}
                                    onClick={() => setPreviewPhotoId(id)}
                                    className="btn-secondary"
                                    style={{
                                      padding: '2px 8px',
                                      fontSize: '11px',
                                      borderRadius: '12px',
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
                            onClick={() =>
                              setEditingCell({
                                cellA1,
                                value: cellValue,
                                sheetRow: originalRowIndex,
                                colIndex: cIdx,
                              })
                            }
                            className="sheet-cell sheet-cell-editable"
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


          {/* Pagination Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              borderTop: '1px solid var(--border-color)',
              background: 'var(--bg-card-subtle)',
              fontSize: '13px',
              color: 'var(--text-muted)',
            }}
          >
            <div>
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} rows
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary"
                style={{ padding: '5px 12px' }}
              >
                Previous
              </button>
              <span style={{ color: 'var(--text-main)' }}>
                Page <strong>{page}</strong> of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary"
                style={{ padding: '5px 12px' }}
              >
                Next
              </button>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="dcr-select"
                style={{ marginLeft: '10px', padding: '4px 8px' }}
              >
                <option value={25}>Show 25</option>
                <option value={50}>Show 50</option>
                <option value={100}>Show 100</option>
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
          }}
        >
          {loading ? 'Fetching records...' : 'No records loaded. Click Reload Tab above.'}
        </div>
      )}


      {/* Drive Photo Modal */}
      {previewPhotoId && (
        <div
          onClick={() => setPreviewPhotoId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              padding: '16px',
              borderRadius: '8px',
              maxWidth: '90vw',
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <a
                href={`https://drive.google.com/file/d/${previewPhotoId}/view`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--btn-primary-bg)', fontWeight: 600, textDecoration: 'none' }}
              >
                Open Original in Drive ↗
              </a>
              <button
                onClick={() => setPreviewPhotoId(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: 'var(--text-main)',
                }}
              >
                ✕
              </button>
            </div>
            <img
              src={`/api/drive/file/${previewPhotoId}?token=${encodeURIComponent(accessToken)}`}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: '4px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}