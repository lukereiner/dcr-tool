import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  parseNumericCell,
  useTableCellSelection,
} from "./CellSelectionTools";

function colIndexToA1(index) {
  let letter = "";
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

const FROZEN_DATA_COLS = {
  0: { width: 195, left: 44 }, // Region
  1: { width: 115, left: 239 }, // Sub Region
  2: { width: 225, left: 354, isLastFrozen: true }, // System
};

export default function MasterMileage({
  mileage,
  onSaveCell,
  onSelectionChange,
}) {
  const { rows = [], totals = [] } = mileage || {};

  const [searchQuery, setSearchQuery] = useState("");
  const [editingCell, setEditingCell] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const tableContainerRef = useRef(null);

  const headers = rows[0] || [
    "Region",
    "Sub Region",
    "System",
    "Coax Aerial Miles",
    "Coax U/G Miles",
    "Fiber Miles",
    "FTTH Aerial Miles",
    "FTTH U/G Miles",
    "Homes Passed",
  ];

  // Attach original Google Sheet row numbers (row 2 is headers, so index 0 of slice(1) is row 3)
  const indexedBodyRows = useMemo(() => {
    if (rows.length <= 1) return [];
    return rows.slice(1).map((row, idx) => ({
      row,
      sheetRowNumber: idx + 3,
    }));
  }, [rows]);

  const isFiltered = searchQuery.trim().length > 0;

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return indexedBodyRows;
    return indexedBodyRows.filter(({ row }) =>
      row.some((cell) => String(cell || "").toLowerCase().includes(q)),
    );
  }, [indexedBodyRows, searchQuery]);

  // Dynamically sum visible filteredRows for Cols D..I (indices 3..8) when a filter is active
  const displayedTotals = useMemo(() => {
    if (!isFiltered) {
      return [0, 1, 2, 3, 4, 5].map((tIdx) => totals[tIdx] ?? "0");
    }

    return [3, 4, 5, 6, 7, 8].map((colIdx) => {
      let sum = 0;
      let hasDecimals = false;

      filteredRows.forEach(({ row }) => {
        const parsed = parseNumericCell(row[colIdx]);
        if (parsed !== null) {
          sum += parsed.value;
          if (!Number.isInteger(parsed.value)) {
            hasDecimals = true;
          }
        }
      });

      if (colIdx === 8 && !hasDecimals) {
        return sum.toLocaleString("en-US", { maximumFractionDigits: 0 });
      }

      return sum.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    });
  }, [isFiltered, filteredRows, totals]);

  const getCellValue = useCallback(
    (rIdx, cIdx) => filteredRows[rIdx]?.row?.[cIdx] ?? "",
    [filteredRows],
  );

  const {
    isDragging,
    handleCellMouseDown,
    handleCellMouseEnter,
    isCellSelected,
    clearSelection,
  } = useTableCellSelection({
    rowCount: filteredRows.length,
    colCount: headers.length,
    getCellValue,
    containerRef: tableContainerRef,
    isDisabled: Boolean(editingCell),
    onSelectionChange,
  });

  const handleCommitEdit = async () => {
    if (!editingCell || isSaving) return;
    setIsSaving(true);
    try {
      const ok = await onSaveCell(
        editingCell.cellA1,
        editingCell.value,
        editingCell.sheetRowNumber,
        editingCell.colIndex,
      );
      if (ok) {
        setEditingCell(null);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Filter & Inline Cell Editor Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-card-subtle)",
          flexWrap: "wrap",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            flex: "1 1 260px",
            maxWidth: "380px",
          }}
        >
          <input
            type="text"
            placeholder="Filter by Region, Sub Region, or System..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="dcr-input"
            style={{
              width: "100%",
              paddingRight: searchQuery ? "30px" : "12px",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: "8px",
                background: "transparent",
                border: "none",
                color: "var(--text-subtle)",
                cursor: "pointer",
                fontSize: "14px",
              }}
              title="Clear filter"
            >
              ✕
            </button>
          )}
        </div>

        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          Double-click any cell to edit • Showing{" "}
          {filteredRows.length} of {indexedBodyRows.length} rows
        </span>
      </div>

      {/* Inline Editor Bar */}
      {editingCell && (
        <div
          style={{
            padding: "10px 18px",
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "13px", color: "var(--text-main)" }}>
            Editing <strong>{editingCell.cellA1}</strong> (
            {editingCell.contextLabel}):
          </span>
          <input
            type="text"
            value={editingCell.value}
            autoFocus
            disabled={isSaving}
            onChange={(e) =>
              setEditingCell({ ...editingCell, value: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommitEdit();
              if (e.key === "Escape" && !isSaving) setEditingCell(null);
            }}
            className="dcr-input"
            style={{ minWidth: "220px" }}
          />
          <button
            type="button"
            disabled={isSaving}
            onClick={handleCommitEdit}
            className="btn-primary"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => setEditingCell(null)}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Mileage Table Grid (A2:I119) + Sticky Totals Footer */}
      <div
        ref={tableContainerRef}
        style={{
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          userSelect: isDragging ? "none" : "auto",
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: "13px",
          }}
        >
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "var(--bg-card-subtle)",
              zIndex: 3,
              borderBottom: "2px solid var(--border-color)",
            }}
          >
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 5,
                  background: "var(--bg-card-subtle)",
                  borderRight: "1px solid var(--border-subtle)",
                  padding: "10px 8px",
                  width: "44px",
                  minWidth: "44px",
                  maxWidth: "44px",
                  boxSizing: "border-box",
                  color: "var(--text-subtle)",
                  textAlign: "center",
                  fontSize: "12px",
                }}
              >
                #
              </th>
              {headers.map((header, idx) => {
                const frozen = FROZEN_DATA_COLS[idx];
                return (
                  <th
                    key={idx}
                    style={{
                      position: frozen ? "sticky" : undefined,
                      left: frozen ? `${frozen.left}px` : undefined,
                      zIndex: frozen ? 5 : undefined,
                      background: "var(--bg-card-subtle)",
                      width: frozen ? `${frozen.width}px` : undefined,
                      minWidth: frozen ? `${frozen.width}px` : undefined,
                      maxWidth: frozen ? `${frozen.width}px` : undefined,
                      boxSizing: "border-box",
                      padding: "10px 14px",
                      borderRight: frozen?.isLastFrozen
                        ? "2px solid var(--border-color)"
                        : "1px solid var(--border-subtle)",
                      textAlign: idx < 3 ? "left" : "right",
                      whiteSpace: "nowrap",
                      fontWeight: 600,
                      color: "var(--text-main)",
                    }}
                  >
                    {header}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length + 1}
                  style={{
                    padding: "40px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  No mileage rows match your filter.
                </td>
              </tr>
            ) : (
              filteredRows.map(({ row, sheetRowNumber }, rIdx) => {
                const contextLabel = [row[0], row[2]]
                  .filter(Boolean)
                  .join(" • ");
                return (
                  <tr key={sheetRowNumber} className="master-table-row">
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 2,
                        backgroundColor: "inherit",
                        borderRight: "1px solid var(--border-subtle)",
                        padding: "8px 8px",
                        width: "44px",
                        minWidth: "44px",
                        maxWidth: "44px",
                        boxSizing: "border-box",
                        color: "var(--text-subtle)",
                        textAlign: "center",
                        fontSize: "11px",
                      }}
                    >
                      {sheetRowNumber}
                    </td>
                    {headers.map((_, cIdx) => {
                      const cellValue = row[cIdx] ?? "";
                      const cellA1 = `${colIndexToA1(cIdx)}${sheetRowNumber}`;
                      const isActiveEdit = editingCell?.cellA1 === cellA1;
                      const selected = isCellSelected(rIdx, cIdx);
                      const frozen = FROZEN_DATA_COLS[cIdx];

                      return (
                        <td
                          key={cIdx}
                          onMouseDown={(e) =>
                            handleCellMouseDown(rIdx, cIdx, e)
                          }
                          onMouseEnter={() => handleCellMouseEnter(rIdx, cIdx)}
                          onDoubleClick={() => {
                            clearSelection();
                            setEditingCell({
                              cellA1,
                              value: cellValue,
                              sheetRowNumber,
                              colIndex: cIdx,
                              contextLabel:
                                contextLabel || `Row ${sheetRowNumber}`,
                            });
                          }}
                          className={`master-cell-editable ${
                            frozen ? "master-sticky-cell" : ""
                          } ${selected ? "master-cell-selected" : ""}`}
                          title={
                            frozen && cellValue
                              ? `${cellValue} (Double-click to edit ${cellA1})`
                              : `Double-click to edit ${cellA1}`
                          }
                          style={{
                            position: frozen ? "sticky" : undefined,
                            left: frozen ? `${frozen.left}px` : undefined,
                            zIndex: frozen ? 2 : undefined,
                            backgroundColor: frozen ? "inherit" : undefined,
                            width: frozen ? `${frozen.width}px` : undefined,
                            minWidth: frozen ? `${frozen.width}px` : undefined,
                            maxWidth: frozen ? `${frozen.width}px` : undefined,
                            overflow: frozen ? "hidden" : undefined,
                            textOverflow: frozen ? "ellipsis" : undefined,
                            boxSizing: "border-box",
                            padding: "8px 14px",
                            borderRight: frozen?.isLastFrozen
                              ? "2px solid var(--border-color)"
                              : "1px solid var(--border-subtle)",
                            whiteSpace: "nowrap",
                            textAlign: cIdx < 3 ? "left" : "right",
                            fontVariantNumeric:
                              cIdx >= 3 ? "tabular-nums" : undefined,
                            color: "var(--text-main)",
                            outline: isActiveEdit
                              ? "2px solid var(--btn-primary-bg)"
                              : undefined,
                            outlineOffset: isActiveEdit ? "-2px" : undefined,
                          }}
                        >
                          {cellValue}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Sticky Totals Footer */}
          <tfoot
            style={{
              position: "sticky",
              bottom: 0,
              background: "var(--bg-card-subtle)",
              borderTop: "2px solid var(--border-color)",
              zIndex: 3,
              fontWeight: 700,
            }}
          >
            <tr>
              <td
                colSpan={4}
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 5,
                  background: "var(--bg-card-subtle)",
                  padding: "10px 14px",
                  borderRight: "2px solid var(--border-color)",
                  textAlign: "right",
                  color: "var(--text-main)",
                  whiteSpace: "nowrap",
                }}
              >
                {isFiltered ? "Filtered Total" : "Total"}
              </td>
              {displayedTotals.map((totalVal, tIdx) => (
                <td
                  key={tIdx}
                  style={{
                    padding: "10px 14px",
                    borderRight: "1px solid var(--border-subtle)",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-main)",
                  }}
                >
                  {totalVal}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}