import React, { useState, useMemo } from "react";
import { useToast } from "../../context/ToastContext";
import { parseNumericCell } from "./CellSelectionTools";
import { downloadTableCsv, copyTableToClipboard } from "./masterExportUtils";

const PLANT_SEGMENTS = [
  { colIdx: 3, label: "Coax Aerial", color: "#3b82f6" },
  { colIdx: 4, label: "Coax U/G", color: "#64748b" },
  { colIdx: 5, label: "Fiber", color: "#10b981" },
  { colIdx: 6, label: "FTTH Aerial", color: "#f59e0b" },
  { colIdx: 7, label: "FTTH U/G", color: "#8b5cf6" },
];

export default function MasterMileageDashboard({ mileage }) {
  const { showToast } = useToast();
  const { rows = [] } = mileage || {};

  const [selectedRegion, setSelectedRegion] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRegions, setExpandedRegions] = useState({});

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

  const bodyRows = useMemo(() => (rows.length > 1 ? rows.slice(1) : []), [rows]);

  const regionOptions = useMemo(() => {
    const set = new Set();
    bodyRows.forEach((row) => {
      const r = String(row[0] || "").trim();
      if (r) set.add(r);
    });
    return Array.from(set);
  }, [bodyRows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bodyRows.filter((row) => {
      const rowRegion = String(row[0] || "").trim();
      if (selectedRegion !== "ALL" && rowRegion !== selectedRegion) {
        return false;
      }
      if (!q) return true;
      return row.some((cell) => String(cell || "").toLowerCase().includes(q));
    });
  }, [bodyRows, selectedRegion, searchQuery]);

  const metrics = useMemo(() => {
    const colSums = [0, 0, 0, 0, 0, 0];

    filteredRows.forEach((row) => {
      for (let i = 0; i < 6; i++) {
        const parsed = parseNumericCell(row[i + 3]);
        if (parsed !== null) {
          colSums[i] += parsed.value;
        }
      }
    });

    const totalMiles =
      colSums[0] + colSums[1] + colSums[2] + colSums[3] + colSums[4];
    const fiberAndFtthMiles = colSums[2] + colSums[3] + colSums[4];
    const fiberSharePct =
      totalMiles > 0
        ? ((fiberAndFtthMiles / totalMiles) * 100).toFixed(1)
        : "0.0";

    return {
      colSums,
      totalMiles,
      fiberAndFtthMiles,
      fiberSharePct,
      homesPassed: colSums[5],
    };
  }, [filteredRows]);

  const regionGroups = useMemo(() => {
    const map = new Map();

    filteredRows.forEach((row) => {
      const regionName = String(row[0] || "Unassigned").trim() || "Unassigned";
      if (!map.has(regionName)) {
        map.set(regionName, {
          regionName,
          systems: [],
          sums: [0, 0, 0, 0, 0, 0],
        });
      }
      const entry = map.get(regionName);
      entry.systems.push(row);
      for (let i = 0; i < 6; i++) {
        const parsed = parseNumericCell(row[i + 3]);
        if (parsed !== null) {
          entry.sums[i] += parsed.value;
        }
      }
    });

    return Array.from(map.values());
  }, [filteredRows]);

  const toggleRegion = (regionName) => {
    setExpandedRegions((prev) => ({
      ...prev,
      [regionName]: !prev[regionName],
    }));
  };

  const formatMiles = (n) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatInt = (n) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const handleCopyReport = async () => {
    try {
      const rollupHeaders = ["Region", "Systems", ...headers.slice(3)];
      const rollupRows = regionGroups.map((g) => [
        g.regionName,
        g.systems.length,
        ...g.sums.map((val, i) => (i === 5 ? formatInt(val) : formatMiles(val))),
      ]);
      await copyTableToClipboard(
        `Mileage Table — Rollup (${selectedRegion})`,
        rollupHeaders,
        rollupRows,
      );
      showToast("Copied Regional Mileage rollup to clipboard", "success");
    } catch {
      showToast("Failed to copy report", "error");
    }
  };

  const handleExportCsv = () => {
    downloadTableCsv("Mileage_Table_Export.csv", headers, filteredRows);
  };

  const autoExpandAll =
    selectedRegion !== "ALL" || searchQuery.trim().length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Top Filter & Export Header */}
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
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flex: "1 1 360px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="dash-mileage-region"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              Region:
            </label>
            <select
              id="dash-mileage-region"
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="dcr-select"
              style={{ minWidth: "200px", fontWeight: 600 }}
            >
              <option value="ALL">All Regions</option>
              {regionOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              flex: "1 1 220px",
              maxWidth: "320px",
            }}
          >
            <input
              type="text"
              placeholder="Filter Sub Region or System..."
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
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={handleCopyReport}
            className="btn-secondary"
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            Copy Region Rollup
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

      {/* Dashboard Body: Fixed Summary Cards + Internal Scrolling Table */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          padding: "16px 18px",
          gap: "14px",
        }}
      >
        {/* Footprint KPI Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "14px",
            flexShrink: 0,
          }}
        >
          <div
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
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Total Plant Miles
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--text-main)",
                marginTop: "4px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatMiles(metrics.totalMiles)}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-subtle)",
                marginTop: "2px",
              }}
            >
              Across {filteredRows.length} systems in {regionGroups.length}{" "}
              {regionGroups.length === 1 ? "region" : "regions"}
            </div>
          </div>

          <div
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
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Fiber & FTTH Miles
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--text-main)",
                marginTop: "4px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatMiles(metrics.fiberAndFtthMiles)}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-subtle)",
                marginTop: "2px",
              }}
            >
              {metrics.fiberSharePct}% of total plant miles
            </div>
          </div>

          <div
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
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Coax Miles (Aerial + U/G)
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--text-main)",
                marginTop: "4px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatMiles(metrics.colSums[0] + metrics.colSums[1])}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-subtle)",
                marginTop: "2px",
              }}
            >
              Aerial: {formatMiles(metrics.colSums[0])} • U/G:{" "}
              {formatMiles(metrics.colSums[1])}
            </div>
          </div>

          <div
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
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Total Homes Passed
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--text-main)",
                marginTop: "4px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatInt(metrics.homesPassed)}
            </div>
          </div>
        </div>

        {/* Visual Plant Composition Bar */}
        <div
          style={{
            background: "var(--bg-card-subtle)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "12px 16px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--text-main)",
              marginBottom: "8px",
            }}
          >
            Plant Composition by Mileage Type
          </div>

          <div
            style={{
              display: "flex",
              height: "12px",
              borderRadius: "6px",
              overflow: "hidden",
              background: "var(--border-color)",
              marginBottom: "8px",
            }}
          >
            {PLANT_SEGMENTS.map((seg, idx) => {
              const val = metrics.colSums[idx];
              const pct =
                metrics.totalMiles > 0 ? (val / metrics.totalMiles) * 100 : 0;
              if (pct <= 0) return null;
              return (
                <div
                  key={seg.label}
                  title={`${seg.label}: ${formatMiles(val)} mi (${pct.toFixed(1)}%)`}
                  style={{
                    width: `${pct}%`,
                    background: seg.color,
                    transition: "width 0.25s ease",
                  }}
                />
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {PLANT_SEGMENTS.map((seg, idx) => {
              const val = metrics.colSums[idx];
              const pct =
                metrics.totalMiles > 0
                  ? ((val / metrics.totalMiles) * 100).toFixed(1)
                  : "0.0";
              return (
                <div
                  key={seg.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "var(--text-main)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "2px",
                      background: seg.color,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--text-muted)" }}>{seg.label}:</span>
                  <strong>{formatMiles(val)}</strong>
                  <span style={{ color: "var(--text-subtle)" }}>({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Internal Scrolling Region Rollup Table with Sticky Headers */}
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflow: "auto",
            flex: 1,
            minHeight: "200px",
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
                borderBottom: "2px solid var(--border-color)",
                zIndex: 2,
              }}
            >
              <tr>
                <th
                  style={{
                    padding: "10px 14px",
                    borderRight: "1px solid var(--border-subtle)",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "var(--text-main)",
                    whiteSpace: "nowrap",
                    background: "var(--bg-card-subtle)",
                  }}
                >
                  Region / System
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    borderRight: "1px solid var(--border-subtle)",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "var(--text-main)",
                    whiteSpace: "nowrap",
                    background: "var(--bg-card-subtle)",
                  }}
                >
                  Sub Region / Count
                </th>
                {headers.slice(3).map((h, idx) => (
                  <th
                    key={idx}
                    style={{
                      padding: "10px 12px",
                      borderRight: "1px solid var(--border-subtle)",
                      textAlign: "right",
                      fontWeight: 600,
                      color: "var(--text-main)",
                      whiteSpace: "nowrap",
                      background: "var(--bg-card-subtle)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regionGroups.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      padding: "28px",
                      textAlign: "center",
                      color: "var(--text-muted)",
                    }}
                  >
                    No regions match your filter.
                  </td>
                </tr>
              ) : (
                regionGroups.map((group) => {
                  const isExpanded =
                    Boolean(expandedRegions[group.regionName]) || autoExpandAll;

                  return (
                    <React.Fragment key={group.regionName}>
                      <tr
                        onClick={() => toggleRegion(group.regionName)}
                        className="master-table-row"
                        style={{
                          borderBottom: "1px solid var(--border-subtle)",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 14px",
                            borderRight: "1px solid var(--border-subtle)",
                            color: "var(--text-main)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: "16px",
                              fontSize: "11px",
                              color: "var(--text-muted)",
                            }}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </span>
                          {group.regionName}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            borderRight: "1px solid var(--border-subtle)",
                            color: "var(--text-muted)",
                            fontSize: "12px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {group.systems.length} system
                          {group.systems.length === 1 ? "" : "s"}
                        </td>
                        {group.sums.map((val, idx) => (
                          <td
                            key={idx}
                            style={{
                              padding: "10px 12px",
                              borderRight: "1px solid var(--border-subtle)",
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                              color: "var(--text-main)",
                            }}
                          >
                            {idx === 5 ? formatInt(val) : formatMiles(val)}
                          </td>
                        ))}
                      </tr>

                      {isExpanded &&
                        group.systems.map((sysRow, sIdx) => (
                          <tr
                            key={`${group.regionName}-${sIdx}`}
                            style={{
                              background: "var(--bg-card)",
                              borderBottom: "1px solid var(--border-subtle)",
                              fontSize: "12px",
                            }}
                          >
                            <td
                              style={{
                                padding: "7px 14px 7px 32px",
                                borderRight: "1px solid var(--border-subtle)",
                                color: "var(--text-main)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {sysRow[2] || "—"}
                            </td>
                            <td
                              style={{
                                padding: "7px 12px",
                                borderRight: "1px solid var(--border-subtle)",
                                color: "var(--text-muted)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {sysRow[1] || "—"}
                            </td>
                            {[3, 4, 5, 6, 7, 8].map((colIdx) => (
                              <td
                                key={colIdx}
                                style={{
                                  padding: "7px 12px",
                                  borderRight: "1px solid var(--border-subtle)",
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  fontVariantNumeric: "tabular-nums",
                                  color: "var(--text-muted)",
                                }}
                              >
                                {sysRow[colIdx] ?? "0"}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}