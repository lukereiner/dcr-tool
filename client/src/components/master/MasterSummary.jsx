import React, { useMemo, useRef, useCallback } from "react";
import { useTableCellSelection } from "./CellSelectionTools";

export default function MasterSummary({
  summary,
  onControlChange,
  isUpdating,
  onSelectionChange,
}) {
  const {
    year = "",
    region = "",
    regionOptions = [],
    rows = [],
  } = summary || {};
  const tableContainerRef = useRef(null);

  const dropdownOptions = useMemo(() => {
    const opts = [...regionOptions];
    if (region && !opts.includes(region)) {
      opts.unshift(region);
    }
    return opts;
  }, [regionOptions, region]);

  const headers = rows[0] || [
    "Date",
    "Cable Replacements",
    "Forced Relocates",
    "Pole Transfers",
    "QC Invoices",
    "Amt of Invoices",
    "Amt QC Invoices",
  ];

  const bodyRows = rows.length > 1 ? rows.slice(1) : [];
  const dataRows = bodyRows.length > 0 ? bodyRows.slice(0, -1) : [];
  const totalsRow = bodyRows.length > 0 ? bodyRows[bodyRows.length - 1] : null;

  const getCellValue = useCallback(
    (rIdx, cIdx) => dataRows[rIdx]?.[cIdx] ?? "",
    [dataRows],
  );

  const {
    isDragging,
    handleCellMouseDown,
    handleCellMouseEnter,
    isCellSelected,
  } = useTableCellSelection({
    rowCount: dataRows.length,
    colCount: headers.length,
    getCellValue,
    containerRef: tableContainerRef,
    isDisabled: isUpdating,
    onSelectionChange,
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Top Control Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-card-subtle)",
          flexWrap: "wrap",
          gap: "16px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          {/* Read-only Year Display (C1) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              Year:
            </span>
            <span
              style={{
                padding: "5px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 700,
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                color: "var(--text-main)",
              }}
            >
              {year || "—"}
            </span>
          </div>

          {/* Interactive Region Dropdown (C2) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="master-summary-region"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              Region:
            </label>
            <select
              id="master-summary-region"
              value={region}
              disabled={isUpdating}
              onChange={(e) => onControlChange("Summary", "C2", e.target.value)}
              className="dcr-select"
              style={{ minWidth: "200px", fontWeight: 600 }}
            >
              {dropdownOptions.length === 0 && (
                <option value={region}>{region || "Loading..."}</option>
              )}
              {dropdownOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isUpdating && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--btn-primary-bg)",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "13px",
                  height: "13px",
                  border: "2px solid rgba(59, 130, 246, 0.25)",
                  borderTop: "2px solid var(--btn-primary-bg, #1a73e8)",
                  borderRadius: "50%",
                  animation: "btnSpin 0.7s linear infinite",
                }}
              />
              <span>Recalculating formulas...</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary Data Grid (B4:H42) */}
      <div
        ref={tableContainerRef}
        style={{
          position: "relative",
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          userSelect: isDragging ? "none" : "auto",
        }}
      >
        {isUpdating && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "var(--bg-card)",
              opacity: 0.55,
              zIndex: 5,
              pointerEvents: "none",
            }}
          />
        )}

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
              zIndex: 2,
              borderBottom: "2px solid var(--border-color)",
            }}
          >
            <tr>
              {headers.map((header, idx) => (
                <th
                  key={idx}
                  style={{
                    padding: "11px 16px",
                    borderRight: "1px solid var(--border-subtle)",
                    textAlign: idx === 0 ? "left" : "right",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {dataRows.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length}
                  style={{
                    padding: "40px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  No summary rows available.
                </td>
              </tr>
            ) : (
              dataRows.map((row, rIdx) => {
                const label = String(row[0] || "").trim();
                const isFiscalBoundary = label.toLowerCase().startsWith("aug ");

                return (
                  <tr
                    key={rIdx}
                    className="master-table-row"
                    style={{
                      borderBottom: isFiscalBoundary
                        ? "2px solid var(--border-color)"
                        : "1px solid var(--border-subtle)",
                    }}
                  >
                    {headers.map((_, cIdx) => {
                      const val = row[cIdx] ?? "";
                      const selected = isCellSelected(rIdx, cIdx);

                      return (
                        <td
                          key={cIdx}
                          onMouseDown={(e) =>
                            handleCellMouseDown(rIdx, cIdx, e)
                          }
                          onMouseEnter={() => handleCellMouseEnter(rIdx, cIdx)}
                          className={selected ? "master-cell-selected" : ""}
                          style={{
                            padding: "8px 16px",
                            borderRight: "1px solid var(--border-subtle)",
                            whiteSpace: "nowrap",
                            textAlign: cIdx === 0 ? "left" : "right",
                            fontWeight: cIdx === 0 ? 600 : 400,
                            fontVariantNumeric:
                              cIdx > 0 ? "tabular-nums" : undefined,
                            color: "var(--text-main)",
                            cursor: "cell",
                          }}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>

          {totalsRow && (
            <tfoot
              style={{
                position: "sticky",
                bottom: 0,
                background: "var(--bg-card-subtle)",
                zIndex: 2,
              }}
            >
              <tr
                style={{
                  borderTop: "2px solid var(--border-color)",
                  fontWeight: 700,
                }}
              >
                {headers.map((_, cIdx) => (
                  <td
                    key={cIdx}
                    style={{
                      padding: "10px 16px",
                      borderRight: "1px solid var(--border-subtle)",
                      textAlign: cIdx === 0 ? "left" : "right",
                      whiteSpace: "nowrap",
                      color: "var(--text-main)",
                      fontVariantNumeric:
                        cIdx > 0 ? "tabular-nums" : undefined,
                    }}
                  >
                    {totalsRow[cIdx] ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}