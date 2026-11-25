import React, { useState, useMemo } from "react";
import { useToast } from "../../context/ToastContext";
import { parseNumericCell } from "./CellSelectionTools";
import {
  getFiscalYearFromLabel,
  downloadTableCsv,
  copyTableToClipboard,
} from "./masterExportUtils";

const CHART_METRICS = [
  { key: "cable", colIdx: 1, label: "Cable Replacements" },
  { key: "relocates", colIdx: 2, label: "Forced Relocates" },
  { key: "poles", colIdx: 3, label: "Pole Transfers" },
  { key: "qcInvoices", colIdx: 6, label: "Amt QC Invoices" },
];

export default function MasterSummaryDashboard({
  summary,
  onControlChange,
  isUpdating,
}) {
  const { showToast } = useToast();
  const {
    year = "",
    region = "",
    regionOptions = [],
    rows = [],
  } = summary || {};

  const [periodFilter, setPeriodFilter] = useState("ACTIVE");
  const [selectedMetricKey, setSelectedMetricKey] = useState("cable");
  const [hoveredIdx, setHoveredIdx] = useState(null);

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

  // Reflect the active pill filter in the KPI cards above
  const filteredKpis = useMemo(() => {
    let cableSum = 0;
    let relocatesSum = 0;
    let polesSum = 0;
    let totalInvoicesSum = 0;
    let qcInvoicesSum = 0;

    visibleRows.forEach((r) => {
      cableSum += parseNumericCell(r[1])?.value ?? 0;
      relocatesSum += parseNumericCell(r[2])?.value ?? 0;
      polesSum += parseNumericCell(r[3])?.value ?? 0;
      totalInvoicesSum += parseNumericCell(r[5])?.value ?? 0;
      qcInvoicesSum += parseNumericCell(r[6])?.value ?? 0;
    });

    const qcRate =
      totalInvoicesSum > 0
        ? `${((qcInvoicesSum / totalInvoicesSum) * 100).toFixed(2)}%`
        : "0.00%";

    const fmtInt = (n) =>
      n.toLocaleString("en-US", {
        minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
        maximumFractionDigits: 2,
      });

    const scopeLabel =
      periodFilter === "ACTIVE"
        ? "Active months"
        : periodFilter === "ALL"
          ? "All months"
          : periodFilter;

    return [
      {
        title: "Cable Replacements",
        value: fmtInt(cableSum),
        sub: `${scopeLabel} (${visibleRows.length} mo)`,
      },
      {
        title: "Forced Relocates",
        value: fmtInt(relocatesSum),
        sub: `${scopeLabel} total`,
      },
      {
        title: "Pole Transfers",
        value: fmtInt(polesSum),
        sub: `${scopeLabel} total`,
      },
      {
        title: "QC Invoice Rate",
        value: qcRate,
        sub: `${fmtInt(qcInvoicesSum)} QC of ${fmtInt(totalInvoicesSum)} invoices`,
      },
    ];
  }, [visibleRows, periodFilter]);

  const activeMetric =
    CHART_METRICS.find((m) => m.key === selectedMetricKey) || CHART_METRICS[0];

  const chartPoints = useMemo(() => {
    const source = visibleRows.length > 0 ? visibleRows : dataRows.slice(0, 12);
    return source.map((r) => {
      const parsed = parseNumericCell(r[activeMetric.colIdx]);
      return {
        label: String(r[0] || "").trim(),
        rawDisplay: r[activeMetric.colIdx] ?? "0",
        value: parsed ? parsed.value : 0,
        qcPct: r[4] || "—",
      };
    });
  }, [visibleRows, dataRows, activeMetric]);

  const maxChartVal = useMemo(() => {
    const max = Math.max(...chartPoints.map((p) => p.value), 0);
    return max > 0 ? max : 1;
  }, [chartPoints]);

  const handleCopyReport = async () => {
    try {
      const exportRows = [
        ...visibleRows,
        ...(totalsRow.length ? [totalsRow] : []),
      ];
      await copyTableToClipboard(
        `${region} — Summary (${year}) [${periodFilter}]`,
        headers,
        exportRows,
      );
      showToast("Copied Summary report to clipboard", "success");
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
    downloadTableCsv(
      `Summary_${safeRegion}_${year || "Report"}.csv`,
      headers,
      exportRows,
    );
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

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="dash-summary-region"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              Region:
            </label>
            <select
              id="dash-summary-region"
              value={region}
              disabled={isUpdating}
              onChange={(e) => onControlChange("Summary", "C2", e.target.value)}
              className="dcr-select"
              style={{ minWidth: "190px", fontWeight: 600 }}
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

          {/* Fiscal / Activity Filter Pills */}
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

        {/* Report Export Actions */}
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

      {/* Scrollable Executive Dashboard Body */}
      <div
        style={{
          overflowY: "auto",
          flex: 1,
          minHeight: 0,
          padding: "18px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          opacity: isUpdating ? 0.6 : 1,
          transition: "opacity 0.15s ease",
        }}
      >
        {/* 4 KPI Cards (reflect active pill filter) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "14px",
          }}
        >
          {filteredKpis.map((card) => (
            <div
              key={card.title}
              style={{
                background: "var(--bg-card-subtle)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "14px 18px",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  letterSpacing: "0.03em",
                }}
              >
                {card.title}
              </div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginTop: "6px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {card.value}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-subtle)",
                  marginTop: "4px",
                }}
              >
                {card.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Interactive Monthly Trend Chart */}
        <div
          style={{
            background: "var(--bg-card-subtle)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 18px",
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
                Monthly Trend — {activeMetric.label}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Hover any bar for monthly details or switch metrics
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {CHART_METRICS.map((m) => {
                const isSelected = m.key === selectedMetricKey;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setSelectedMetricKey(m.key)}
                    className="btn-secondary"
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      fontWeight: isSelected ? 700 : 500,
                      borderColor: isSelected
                        ? "var(--btn-primary-bg, #1a73e8)"
                        : undefined,
                      color: isSelected
                        ? "var(--btn-primary-bg, #1a73e8)"
                        : undefined,
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {chartPoints.length === 0 ? (
            <div
              style={{
                padding: "28px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "13px",
              }}
            >
              No activity recorded for this filter.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: "12px",
                height: "185px",
                paddingTop: "30px",
                paddingLeft: "16px",
                paddingRight: "16px",
                overflowX: "auto",
              }}
            >
              {chartPoints.map((pt, idx) => {
                const heightPct = Math.max(
                  pt.value > 0 ? 8 : 2,
                  Math.round((pt.value / maxChartVal) * 100),
                );
                const isHovered = hoveredIdx === idx;
                const isFirst = idx === 0;
                const isLast = idx === chartPoints.length - 1;

                const tooltipPositionStyle = isFirst
                  ? { left: "0px", transform: "none" }
                  : isLast
                    ? { right: "0px", transform: "none" }
                    : { left: "50%", transform: "translateX(-50%)" };

                return (
                  <div
                    key={pt.label || idx}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    style={{
                      flex: "1 0 60px",
                      maxWidth: "115px",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      position: "relative",
                      cursor: "default",
                    }}
                  >
                    {isHovered && (
                      <div
                        style={{
                          position: "absolute",
                          top: "-26px",
                          ...tooltipPositionStyle,
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          padding: "4px 8px",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "var(--text-main)",
                          whiteSpace: "nowrap",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.14)",
                          zIndex: 10,
                        }}
                      >
                        {pt.label}: {pt.rawDisplay} • QC {pt.qcPct}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--text-main)",
                        marginBottom: "4px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pt.rawDisplay}
                    </div>

                    <div
                      style={{
                        width: "100%",
                        maxWidth: "46px",
                        height: `${heightPct}%`,
                        background:
                          pt.value > 0
                            ? isHovered
                              ? "#1557b0"
                              : "var(--btn-primary-bg, #1a73e8)"
                            : "var(--border-color)",
                        borderRadius: "5px 5px 0 0",
                        transition: "height 0.25s ease, background 0.15s ease",
                      }}
                    />

                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        marginTop: "6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pt.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Clean Filtered Breakdown Table */}
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div style={{ overflowX: "auto" }}>
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
                        padding: "10px 14px",
                        borderRight: "1px solid var(--border-subtle)",
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
                      colSpan={headers.length}
                      style={{
                        padding: "24px",
                        textAlign: "center",
                        color: "var(--text-muted)",
                      }}
                    >
                      No active months match the current filter.
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
                            padding: "8px 14px",
                            borderRight: "1px solid var(--border-subtle)",
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
                          padding: "10px 14px",
                          borderRight: "1px solid var(--border-subtle)",
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
    </div>
  );
}