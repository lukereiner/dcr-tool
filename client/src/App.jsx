import React, { useState, useMemo } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';

// Helper: Convert column index to A1 letter (0 -> A, 1 -> B, etc.)
function colIndexToA1(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export default function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [tabName, setTabName] = useState('Cable Replacement');
  const [sheetData, setSheetData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [globalFilter, setGlobalFilter] = useState('');
  const [editingCell, setEditingCell] = useState(null);

  // Controlled pagination state prevents undefined read errors
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
      setStatusMessage('Login failed.');
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
      setStatusMessage(`Loaded ${(data.values || []).length} rows.`);
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Safe table data transformation
  const { columns, tableData } = useMemo(() => {
    if (!sheetData || sheetData.length === 0) {
      return { columns: [], tableData: [] };
    }

    const [headerRow, ...bodyRows] = sheetData;

    const cols = (headerRow || []).map((colName, cIndex) => ({
      accessorKey: `col_${cIndex}`,
      header: colName || `Col ${colIndexToA1(cIndex)}`,
      cell: (info) => info.getValue() ?? '',
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

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      globalFilter,
      pagination,
    },
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const handleSaveCell = async () => {
    if (!editingCell || !accessToken) return;
    const { cellA1, value } = editingCell;
    setStatusMessage(`Saving ${cellA1}...`);

    const previousData = [...sheetData];
    const updated = [...sheetData];
    const rIdx = editingCell.sheetRow - 1;
    const cIdx = editingCell.colIndex;

    if (updated[rIdx]) {
      updated[rIdx][cIdx] = value;
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
      setStatusMessage(`Failed: ${err.message}`);
    }
  };

  const pageCount = table.getPageCount();

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>DCR Sheet Manager</h2>

      {/* Control Bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        {!accessToken ? (
          <button
            onClick={() => login()}
            style={{ padding: '8px 16px', background: '#4285F4', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Sign in with Google
          </button>
        ) : (
          <>
            <select value={tabName} onChange={(e) => setTabName(e.target.value)} style={{ padding: '6px' }}>
              <option value="Cable Replacement">Cable Replacement</option>
              <option value="QC Responses">QC Responses</option>
              <option value="Pole Transfers Form">Pole Transfers Form</option>
              <option value="Do's & Don'ts">Do's & Don'ts</option>
            </select>
            <button onClick={fetchSheet} disabled={loading} style={{ padding: '6px 14px', cursor: 'pointer' }}>
              {loading ? 'Fetching...' : 'Load Sheet'}
            </button>
            <input
              type="text"
              placeholder="Search all columns..."
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              style={{ padding: '6px 12px', minWidth: '220px' }}
            />
          </>
        )}
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div style={{ padding: '8px 12px', background: '#f5f5f5', borderLeft: '4px solid #4285F4', marginBottom: '12px' }}>
          {statusMessage}
        </div>
      )}

      {/* Edit bar */}
      {editingCell && (
        <div style={{ marginBottom: '12px', padding: '10px', background: '#eef6ff', border: '1px solid #b8daff', borderRadius: '4px' }}>
          <strong>Edit Cell {editingCell.cellA1}: </strong>
          <input
            type="text"
            value={editingCell.value}
            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
            style={{ margin: '0 8px', padding: '4px 8px' }}
          />
          <button onClick={handleSaveCell} style={{ padding: '4px 10px', marginRight: '6px' }}>Save</button>
          <button onClick={() => setEditingCell(null)} style={{ padding: '4px 10px' }}>Cancel</button>
        </div>
      )}

      {/* Table grid */}
      {tableData.length > 0 ? (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', maxHeight: '65vh' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#fafafa', zIndex: 1 }}>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        style={{
                          borderBottom: '2px solid #ddd',
                          borderRight: '1px solid #eee',
                          padding: '8px 10px',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    {row.getVisibleCells().map((cell, colIndex) => {
                      const sheetRow = row.original._rowIndex;
                      const cellA1 = `${colIndexToA1(colIndex)}${sheetRow}`;
                      return (
                        <td
                          key={cell.id}
                          onClick={() => setEditingCell({ cellA1, value: cell.getValue(), sheetRow, colIndex })}
                          style={{
                            padding: '6px 10px',
                            borderRight: '1px solid #f0f0f0',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                          title={`Click to edit ${cellA1}`}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </button>
            <span>
              Page <strong>{pagination.pageIndex + 1}</strong> of {pageCount > 0 ? pageCount : 1}
            </span>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </button>
            <select
              value={pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              style={{ marginLeft: '12px' }}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  Show {size} rows
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        accessToken && !loading && (
          <p style={{ color: '#666' }}>Click "Load Sheet" above to fetch the records.</p>
        )
      )}
    </div>
  );
}