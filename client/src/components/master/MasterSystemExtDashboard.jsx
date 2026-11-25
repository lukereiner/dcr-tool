import React, { useState, useMemo } from "react";
import { useToast } from "../../context/ToastContext";
import { parseNumericCell } from "./CellSelectionTools";
import {
  getFiscalYearFromLabel,
  downloadTableCsv,
  copyTableToClipboard,
} from "./masterExportUtils";

const BASELINE_GROUPS = [
  { label: "Coax Aerial Miles", startIdx: 1, endIdx: 1 },
  { label: "Coax U/G Miles", startIdx: 3, endIdx: 3 },
  { label: "Total Fiber Miles", startIdx: 5, endIdx: 5 },
  { label: "FTTH Aerial Miles", startIdx: 9, endIdx: 9 },
  { label: "FTTH U/G Miles", startIdx: 11, endIdx: 11 },
  { label: "Homes Passed", startIdx: 13, endIdx: 13, isInteger: true },
];

const PLANT_CATEGORIES = [
  { label: "Coax Aerial", footageIdx: 1, milesIdx: 2 },
  { label: "Coax U/G", footageIdx: 3, milesIdx: 4 },
  { label: "Fiber Aerial", footageIdx: 5, milesIdx: 6 },
  { label: "Fiber U/G", footageIdx: 7, milesIdx: 8 },
  { label: "FTTH Aerial", footageIdx: 9, milesIdx: 10 },
  { label: "FTTH U/G", footageIdx: 11, milesIdx: 12 },
];

const EXTRA_METRIC_DEFS = [
  { label: "Homes Passed", idx: 13, isInteger: true },
  { label: "ROE Homes Passed", idx: 14, isInteger: true },
  { label: "Drop: Coax", idx: 15, isInteger: true },
  { label: "Drop: Fiber", idx: 16, isInteger: true },
  { label: "Dwelling: Residential", idx: 17, isInteger: true },
  { label: "Dwelling: Comm / Carrier", idx: 18, isInteger: true },
];

function formatMetricNumber(num, isInteger = false) {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: isInteger ? 0 : 2,
  });
}

export default function MasterSystemExtDashboard({
  systemExt,
  onControlChange,
  isUpdating,
}) {
  const { showToast } = useToast();
  const {
    region = "",
    system = "",
    regionOptions = [],
    systemOptions = [],
    startingMileageRow = [],
    endingMileageRow = [],
    rows = [],
  } = systemExt || {};

  const [periodFilter, setPeriodFilter] = useState("ACTIVE");
  const [unitMode, setUnitMode] = useState("miles");

  const resolvedRegionOptions = useMemo(() => {
    const opts = [...regionOptions];
    if (region && !opts.includes(region)) opts.unshift(region);
    return opts;
  }, [regionOptions, region]);

  const resolvedSystemOptions = useMemo(() => {
    const opts = [...systemOptions];
    if (system && !opts.includes(system)) opts.unshift(system);
    return opts;
  }, [systemOptions, system]);

  const headers = rows[0] || [];
  const bodyRows = rows.length > 1 ? rows.slice(1) : [];
  const dataRows = bodyRows.length > 0 ? bodyRows.slice(0, -1) : [];
  const totalsRow = bodyRows.length > 0 ? bodyRows[bodyRows.length - 1] : [];

  const availableFiscalYears = useMemo(() => {
    const set = new Set();
    dataRows.forEach((r) => {
      const fy = getFiscalYearFromLabel(r[0]);
      if (fy !== "Other") set.add(fy);
    });
    return Array.from(set);
  }, [dataRows]);

  const isRowActive = (row) => {
    for (let c = 1; c < headers.length; c++) {
      const parsed = parseNumericCell(row[c]);
      if (parsed && parsed.value !== 0) return true;
    }
    return false;
  };

  const visibleRows = useMemo(() => {
    if (periodFilter === "ALL") return dataRows;
    if (periodFilter === "ACTIVE") return dataRows.filter(isRowActive);
    return dataRows.filter((r) => getFiscalYearFromLabel(r[0]) === periodFilter);
  }, [dataRows, periodFilter]);

  const activeMonthCount = useMemo(
    () => dataRows.filter(isRowActive).length,
    [dataRows],
  );

  // Sum visibleRows for each column (1..18) so KPI cards reflect the selected pill filter
  const filteredColSums = useMemo(() => {
    const sums = Array(headers.length).fill(0);
    visibleRows.forEach((row) => {
      for (let c = 1; c < headers.length; c++) {
        const parsed = parseNumericCell(row[c]);
        if (parsed !== null) {
          sums[c] += parsed.value;
        }
      }
    });
    return sums;
  }, [visibleRows, headers.length]);

  const baselineCards = useMemo(() => {
    return BASELINE_GROUPS.map((grp) => {
      const startRaw = startingMileageRow[grp.startIdx] ?? "—";
      const endRaw = endingMileageRow[grp.endIdx] ?? "—";
      const startNum = parseNumericCell(startRaw)?.value ?? 0;
      const endNum = parseNumericCell(endRaw)?.value ?? 0;
      const delta = endNum - startNum;

      const deltaFormatted =
        delta === 0
          ? "0"
          : `${delta > 0 ? "+" : ""}${formatMetricNumber(delta, grp.isInteger)}`;

      return {
        label: grp.label,
        startRaw,
        endRaw,
        deltaFormatted,
      };
    });
  }, [startingMileageRow, endingMileageRow]);

  const handleCopyReport = async () => {
    try {
      const exportRows = [
        ...visibleRows,
        ...(totalsRow.length ? [totalsRow] : []),
      ];
      await copyTableToClipboard(
        `${region} (${system}) — System Ext Data [${periodFilter}]`,
        headers,
        exportRows,
      );
      showToast("Copied System Ext Data to clipboard", "success");
    } catch {
      showToast("Failed to copy report", "error");
    }
  };

  const handleExportCsv = () => {
    const exportRows = [
      ...visibleRows,
      ...(totalsRow.length ? [totalsRow] : []),
    ];
    const safeRegion = (region || "Region").replace(/[^a-zA-Z0-9_-]+/g, "_");
    downloadTableCsv(`System_Ext_${safeRegion}.csv`, headers, exportRows);
  };

  const filterScopeLabel =
    periodFilter === "ACTIVE"
      ? `Active Months (${visibleRows.length})`
      : periodFilter === "ALL"
        ? `All Months (${visibleRows.length})`
        : `${periodFilter}`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Top Control & Export Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-card-subtle)",
          flexWrap: "wrap",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="dash-sysext-region"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              Region:
            </label>
            <select
              id="dash-sysext-region"
              value={region}
              disabled={isUpdating}
              onChange={(e) =>
                onControlChange("System Ext Data", "B2", e.target.value)
              }
              className="dcr-select"
              style={{ minWidth: "180px", fontWeight: 600 }}
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

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="dash-sysext-system"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              System:
            </label>
            <select
              id="dash-sysext-system"
              value={system}
              disabled={isUpdating}
              onChange={(e) =>
                onControlChange("System Ext Data", "B4", e.target.value)
              }
              className="dcr-select"
              style={{ minWidth: "180px", fontWeight: 600 }}
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

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "ACTIVE", label: `Active Months (${activeMonthCount})` },
              ...availableFiscalYears.map((fy) => ({ id: fy, label: fy })),
              { id: "ALL", label: "All Months" },
            ].map((pill) => {
              const active = periodFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setPeriodFilter(pill.id)}
                  style={{
                    padding: "5px 11px",
                    borderRadius: "16px",
                    fontSize: "12px",
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    border: active
                      ? "1px solid var(--btn-primary-bg, #1a73e8)"
                      : "1px solid var(--border-color)",
                    background: active
                      ? "var(--btn-primary-bg, #1a73e8)"
                      : "var(--bg-card)",
                    color: active ? "#ffffff" : "var(--text-muted)",
                  }}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isUpdating && (
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--btn-primary-bg)",
                marginRight: "4px",
              }}
            >
              Recalculating...
            </span>
          )}
          <button
            type="button"
            onClick={handleCopyReport}
            className="btn-secondary"
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            Copy Report
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="btn-secondary"
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Scrollable Dashboard Content */}
      <div
        style={{
          overflow: "auto",
          flex: 1,
          minHeight: "260px",
          padding: "18px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          opacity: isUpdating ? 0.6 : 1,
          transition: "opacity 0.15s ease",
        }}
      >
        {/* F27 Starting vs. Ending Mileage Baseline Cards */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: "10px",
              letterSpacing: "0.03em",
            }}
          >
            F27 Baseline — Starting vs. Ending Plant
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))",
              gap: "12px",
            }}
          >
            {baselineCards.map((card) => (
              <div
                key={card.label}
                style={{
                  background: "var(--bg-card-subtle)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "12px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  {card.label}
                </div>
                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    marginTop: "6px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {card.endRaw}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "12px",
                    color: "var(--text-subtle)",
                    marginTop: "6px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span>Start: {card.startRaw}</span>
                  <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                    Net: {card.deltaFormatted}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Extension Totals Reflecting Active Pill Filter */}
        <div
          style={{
            background: "var(--bg-card-subtle)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 18px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                }}
              >
                Extension Totals — {filterScopeLabel}
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              {[
                { id: "miles", label: "Miles" },
                { id: "footage", label: "Footage" },
              ].map((u) => {
                const active = unitMode === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setUnitMode(u.id)}
                    className="btn-secondary"
                    style={{
                      padding: "4px 12px",
                      fontSize: "12px",
                      fontWeight: active ? 700 : 500,
                      borderColor: active
                        ? "var(--btn-primary-bg, #1a73e8)"
                        : undefined,
                      color: active
                        ? "var(--btn-primary-bg, #1a73e8)"
                        : undefined,
                    }}
                  >
                    {u.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
              gap: "10px",
              marginBottom: "14px",
            }}
          >
            {PLANT_CATEGORIES.map((cat) => {
              const primaryNum =
                filteredColSums[
                  unitMode === "miles" ? cat.milesIdx : cat.footageIdx
                ] ?? 0;
              const secondaryNum =
                filteredColSums[
                  unitMode === "miles" ? cat.footageIdx : cat.milesIdx
                ] ?? 0;

              return (
                <div
                  key={cat.label}
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "6px",
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                    }}
                  >
                    {cat.label}
                  </div>
                  <div
                    style={{
                      fontSize: "18px",
                      fontWeight: 700,
                      color: "var(--text-main)",
                      marginTop: "4px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatMetricNumber(primaryNum, false)}{" "}
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 500,
                        color: "var(--text-muted)",
                      }}
                    >
                      {unitMode === "miles" ? "mi" : "ft"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-subtle)",
                      marginTop: "2px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatMetricNumber(secondaryNum, false)}{" "}
                    {unitMode === "miles" ? "ft" : "mi"}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
              gap: "10px",
              paddingTop: "12px",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            {EXTRA_METRIC_DEFS.map((item) => (
              <div
                key={item.label}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  padding: "8px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    marginTop: "3px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatMetricNumber(filteredColSums[item.idx] ?? 0, item.isInteger)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Filtered Months Table with Frozen First Column */}
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflowX: "auto",
            flexShrink: 0,
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
                background: "var(--bg-card-subtle)",
                borderBottom: "2px solid var(--border-color)",
              }}
            >
              <tr>
                {headers.map((h, idx) => (
                  <th
                    key={idx}
                    style={{
                      position: idx === 0 ? "sticky" : undefined,
                      left: idx === 0 ? 0 : undefined,
                      zIndex: idx === 0 ? 3 : 1,
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
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(1, headers.length)}
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "var(--text-muted)",
                    }}
                  >
                    No active extension months match the current filter.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className="master-table-row"
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    {headers.map((_, cIdx) => (
                      <td
                        key={cIdx}
                        style={{
                          position: cIdx === 0 ? "sticky" : undefined,
                          left: cIdx === 0 ? 0 : undefined,
                          zIndex: cIdx === 0 ? 2 : undefined,
                          background:
                            cIdx === 0 ? "var(--bg-card)" : undefined,
                          padding: "8px 14px",
                          borderRight:
                            cIdx === 0
                              ? "2px solid var(--border-color)"
                              : "1px solid var(--border-subtle)",
                          textAlign: cIdx === 0 ? "left" : "right",
                          whiteSpace: "nowrap",
                          fontWeight: cIdx === 0 ? 600 : 400,
                          fontVariantNumeric:
                            cIdx > 0 ? "tabular-nums" : undefined,
                          color: "var(--text-main)",
                        }}
                      >
                        {row[cIdx] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {totalsRow.length > 0 && (
              <tfoot
                style={{
                  background: "var(--bg-card-subtle)",
                  borderTop: "2px solid var(--border-color)",
                  fontWeight: 700,
                }}
              >
                <tr>
                  {headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      style={{
                        position: cIdx === 0 ? "sticky" : undefined,
                        left: cIdx === 0 ? 0 : undefined,
                        zIndex: cIdx === 0 ? 2 : undefined,
                        background: "var(--bg-card-subtle)",
                        padding: "10px 14px",
                        borderRight:
                          cIdx === 0
                            ? "2px solid var(--border-color)"
                            : "1px solid var(--border-subtle)",
                        textAlign: cIdx === 0 ? "left" : "right",
                        whiteSpace: "nowrap",
                        fontVariantNumeric:
                          cIdx > 0 ? "tabular-nums" : undefined,
                        color: "var(--text-main)",
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
    </div>
  );
}