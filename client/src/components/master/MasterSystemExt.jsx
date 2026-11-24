import React, { useMemo, useRef, useCallback } from "react";
import { useTableCellSelection } from "./CellSelectionTools";

export default function MasterSystemExt({
  systemExt,
  onControlChange,
  isUpdating,
  onSelectionChange,
}) {
  const {
    region = "",
    system = "",
    regionOptions = [],
    systemOptions = [],
    rows = [],
  } = systemExt || {};

  const tableContainerRef = useRef(null);

  const resolvedRegionOptions = useMemo(() => {
    const opts = [...regionOptions];
    if (region && !opts.includes(region)) {
      opts.unshift(region);
    }
    return opts;
  }, [regionOptions, region]);

  const resolvedSystemOptions = useMemo(() => {
    const opts = [...systemOptions];
    if (system && !opts.includes(system)) {
      opts.unshift(system);
    }
    return opts;
  }, [systemOptions, system]);

  const headers = rows[0] || [];
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
      {/* Top Control Header (B2 Region & B4 System) */}
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
          {/* Region Dropdown (B2) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="master-sysext-region"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              Region:
            </label>
            <select
              id="master-sysext-region"
              value={region}
              disabled={isUpdating}
              onChange={(e) =>
                onControlChange("System Ext Data", "B2", e.target.value)
              }
              className="dcr-select"
              style={{ minWidth: "200px", fontWeight: 600 }}
            >
              {resolvedRegionOptions.length === 0 && (
                <option value={region}>{region || "Loading..."}</option>
              )}
              {resolvedRegionOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* System Dropdown (B4) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="master-sysext-system"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              System:
            </label>
            <select
              id="master-sysext-system"
              value={system}
              disabled={isUpdating}
              onChange={(e) =>
                onControlChange("System Ext Data", "B4", e.target.value)
              }
              className="dcr-select"
              style={{ minWidth: "200px", fontWeight: 600 }}
            >
              {resolvedSystemOptions.length === 0 && (
                <option value={system}>{system || "Loading..."}</option>
              )}
              {resolvedSystemOptions.map((opt) => (
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

      {/* System Ext Data Grid (C3:U42) */}
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
              zIndex: 3,
              borderBottom: "2px solid var(--border-color)",
            }}
          >
            <tr>
              {headers.map((header, idx) => (
                <th
                  key={idx}
                  style={{
                    position: idx === 0 ? "sticky" : undefined,
                    left: idx === 0 ? 0 : undefined,
                    zIndex: idx === 0 ? 4 : undefined,
                    background: "var(--bg-card-subtle)",
                    padding: "10px 14px",
                    borderRight:
                      idx === 0
                        ? "2px solid var(--border-color)"
                        : "1px solid var(--border-subtle)",
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
                  colSpan={Math.max(1, headers.length)}
                  style={{
                    padding: "40px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  No System Ext Data rows available.
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
                            position: cIdx === 0 ? "sticky" : undefined,
                            left: cIdx === 0 ? 0 : undefined,
                            zIndex: cIdx === 0 ? 1 : undefined,
                            background:
                              cIdx === 0 && !selected
                                ? "var(--bg-card)"
                                : undefined,
                            padding: "8px 14px",
                            borderRight:
                              cIdx === 0
                                ? "2px solid var(--border-color)"
                                : "1px solid var(--border-subtle)",
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
                zIndex: 3,
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
                      position: cIdx === 0 ? "sticky" : undefined,
                      left: cIdx === 0 ? 0 : undefined,
                      zIndex: cIdx === 0 ? 4 : undefined,
                      background: "var(--bg-card-subtle)",
                      padding: "10px 14px",
                      borderRight:
                        cIdx === 0
                          ? "2px solid var(--border-color)"
                          : "1px solid var(--border-subtle)",
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