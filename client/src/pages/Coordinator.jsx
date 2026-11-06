import { useState, useMemo, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../App";
import { useToast } from "../context/ToastContext";

const DEFAULT_STATUSES = [
  "Pre Construction",
  "Permitting in Process",
  "Under Construction",
  "Maintenance Tie",
  "Completed",
  "Canceled",
];

const STATUS_COLORS = {
  "Pre Construction": {
    bgLight: "#e8eaed",
    textLight: "#3c4043",
    bgDark: "#2c313a",
    textDark: "#d1d5db",
    borderDark: "#4b5563",
  },
  "Permitting in Process": {
    bgLight: "#e8eaed",
    textLight: "#3c4043",
    bgDark: "#2c313a",
    textDark: "#d1d5db",
    borderDark: "#4b5563",
  },
  "Under Construction": {
    bgLight: "#fef7e0",
    textLight: "#b06000",
    bgDark: "#332701",
    textDark: "#fde047",
    borderDark: "#854d0e",
  },
  "Maintenance Tie": {
    bgLight: "#e8eaed",
    textLight: "#3c4043",
    bgDark: "#2c313a",
    textDark: "#d1d5db",
    borderDark: "#4b5563",
  },
  Completed: {
    bgLight: "#ceead6",
    textLight: "#0d652d",
    bgDark: "#052e16",
    textDark: "#86efac",
    borderDark: "#166534",
  },
  Canceled: {
    bgLight: "#18181b",
    textLight: "#f4f4f5",
    bgDark: "#09090b",
    textDark: "#a1a1aa",
    borderDark: "#27272a",
  },
  Unassigned: {
    bgLight: "#fee2e2",
    textLight: "#dc2626",
    bgDark: "#450a0a",
    textDark: "#ff6b6b",
    borderDark: "#ef4444",
  },
};

const SORT_COLUMNS = {
  dcrId: { colIdx: 24, label: "DCR ID", isDate: false },
  dateSubmitted: { colIdx: 2, label: "Date Submitted", isDate: true },
  nodeNum: { colIdx: 12, label: "Node #", isDate: false },
  region: { colIdx: 5, label: "Region", isDate: false },
  contractor: { colIdx: 34, label: "Contractor", isDate: false },
};

const DEFAULT_SORT_CHAIN = [{ key: "dateSubmitted", direction: "desc" }];

export default function Coordinator({
  sheetData,
  onRefresh,
  loading,
  accessToken,
  onStatusUpdated,
  dropdownOptions = {},
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { activeRegion } = useContext(AuthContext);

  const statusOptions = useMemo(() => {
    if (dropdownOptions?.AG && dropdownOptions.AG.length > 0) {
      return dropdownOptions.AG;
    }
    return DEFAULT_STATUSES;
  }, [dropdownOptions]);

  const techOptions = useMemo(() => {
    if (dropdownOptions?.AE && dropdownOptions.AE.length > 0) {
      return dropdownOptions.AE;
    }
    return [];
  }, [dropdownOptions]);

  const [selectedStatuses, setSelectedStatuses] = useState(() => {
    try {
      const saved = localStorage.getItem("coordinator_selected_statuses");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [updatingRow, setUpdatingRow] = useState(null);

  const [selectedTech, setSelectedTech] = useState(() => {
    return localStorage.getItem("coordinator_tech") || "All";
  });

  const [pageSize, setPageSize] = useState(() => {
    const saved = localStorage.getItem("coordinator_page_size");
    return saved ? Number(saved) : 15;
  });

  const [sortChain, setSortChain] = useState(() => {
    try {
      const saved = localStorage.getItem("coordinator_sort_chain");
      return saved ? JSON.parse(saved) : DEFAULT_SORT_CHAIN;
    } catch {
      return DEFAULT_SORT_CHAIN;
    }
  });

  const [page, setPage] = useState(1);

  useEffect(() => {
    localStorage.setItem(
      "coordinator_selected_statuses",
      JSON.stringify(selectedStatuses),
    );
    setPage(1);
  }, [selectedStatuses]);

  useEffect(() => {
    localStorage.setItem("coordinator_tech", selectedTech);
    setPage(1);
  }, [selectedTech]);

  useEffect(() => {
    localStorage.setItem("coordinator_page_size", String(pageSize));
    setPage(1);
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem("coordinator_sort_chain", JSON.stringify(sortChain));
    setPage(1);
  }, [sortChain]);

  const toggleStatus = (status) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status],
    );
  };

  const handleSortClick = (columnKey) => {
    setSortChain((prevChain) => {
      const existingIndex = prevChain.findIndex(
        (item) => item.key === columnKey,
      );

      if (existingIndex === -1) {
        return [{ key: columnKey, direction: "asc" }, ...prevChain];
      }

      const current = prevChain[existingIndex];

      if (current.direction === "asc") {
        const withoutCurrent = prevChain.filter(
          (item) => item.key !== columnKey,
        );
        return [{ key: columnKey, direction: "desc" }, ...withoutCurrent];
      }

      return prevChain.filter((item) => item.key !== columnKey);
    });
  };

  const rows = useMemo(() => {
    if (!sheetData || sheetData.length < 3) return [];
    return sheetData.slice(2);
  }, [sheetData]);

  const kpis = useMemo(() => {
    let totalActive = 0;
    let underConstruction = 0;
    let preConstruction = 0;
    let completed = 0;
    let unassigned = 0;
    const contractorCounts = {};

    rows.forEach((row) => {
      const tech = String(row[30] || "").trim(); // Col AE
      const status = String(row[32] || "").trim(); // Col AG
      const contractor = String(row[34] || "").trim(); // Col AI
      const dcrId = String(row[24] || "").trim(); // Col Y

      if (selectedTech !== "All" && tech !== selectedTech) {
        return;
      }

      if (dcrId && dcrId !== "—" && !status) {
        unassigned++;
      }

      if (status && status !== "Completed" && status !== "Canceled") {
        totalActive++;
      }
      if (status === "Under Construction") underConstruction++;
      if (status === "Pre Construction") preConstruction++;
      if (status === "Completed") completed++;

      if (contractor) {
        contractorCounts[contractor] = (contractorCounts[contractor] || 0) + 1;
      }
    });

    return {
      totalActive,
      underConstruction,
      preConstruction,
      completed,
      unassigned,
      contractorCounts,
    };
  }, [rows, selectedTech]);

  const filteredRows = useMemo(() => {
    const matches = [];
    const hasStatusFilter = selectedStatuses.length > 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const dcrId = String(row[24] || "").trim();
      const tech = String(row[30] || "").trim();
      const status = String(row[32] || "").trim();

      if (!dcrId || dcrId === "—") continue;

      const isRowUnassigned = !status;

      let statusMatch = false;
      if (!hasStatusFilter) {
        statusMatch = true;
      } else {
        const matchSelectedAssigned = selectedStatuses.some(
          (s) => s.toLowerCase() === status.toLowerCase(),
        );
        const matchSelectedUnassigned =
          selectedStatuses.includes("Unassigned") && isRowUnassigned;

        statusMatch = matchSelectedAssigned || matchSelectedUnassigned;
      }

      const techMatch = selectedTech === "All" || tech === selectedTech;

      if (statusMatch && techMatch) {
        matches.push({
          row,
          sheetRowNumber: i + 3,
        });
      }
    }

    if (sortChain.length > 0) {
      matches.sort((a, b) => {
        for (const sortItem of sortChain) {
          const config = SORT_COLUMNS[sortItem.key];
          if (!config) continue;

          const valA = a.row[config.colIdx] ?? "";
          const valB = b.row[config.colIdx] ?? "";

          let comparison = 0;

          if (config.isDate) {
            const timeA = new Date(valA || 0).getTime();
            const timeB = new Date(valB || 0).getTime();
            comparison = timeA - timeB;
          } else {
            comparison = String(valA).localeCompare(String(valB), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          }

          if (comparison !== 0) {
            return sortItem.direction === "asc" ? comparison : -comparison;
          }
        }
        return 0;
      });
    }

    return matches;
  }, [rows, selectedStatuses, selectedTech, sortChain]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  // Update status and supply activeRegion
  const handleStatusChange = async (sheetRowNumber, newStatus) => {
    if (!newStatus || newStatus === "Unassigned") return;
    setUpdatingRow(sheetRowNumber);

    try {
      const res = await fetch("/api/sheet/cell", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          tabName: "Cable Replacement",
          cell: `AG${sheetRowNumber}`,
          value: newStatus,
          region: activeRegion?.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(
        `Row ${sheetRowNumber} status updated to "${newStatus}"`,
        "success",
      );
      if (onStatusUpdated) {
        onStatusUpdated(sheetRowNumber, 32, newStatus);
      }
    } catch (err) {
      showToast(`Failed to update status: ${err.message}`, "error");
    } finally {
      setUpdatingRow(null);
    }
  };

  const renderSortIndicator = (columnKey) => {
    const index = sortChain.findIndex((item) => item.key === columnKey);
    if (index === -1) {
      return (
        <span style={{ opacity: 0.3, marginLeft: "6px", fontSize: "11px" }}>
          ▲▼
        </span>
      );
    }

    const { direction } = sortChain[index];

    return (
      <span
        style={{
          marginLeft: "6px",
          color: "var(--btn-primary-bg)",
          fontWeight: 700,
          fontSize: "12px",
          display: "inline-flex",
          alignItems: "center",
          gap: "2px",
        }}
      >
        <span>{direction === "asc" ? "▲" : "▼"}</span>
      </span>
    );
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
      <style>{`
        .status-pill {
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
          border: 2px solid var(--border-color);
          background: var(--bg-card);
          color: var(--text-muted);
          white-space: nowrap;
          user-select: none;
        }
        .status-pill:hover {
          background: var(--bg-card-subtle);
          color: var(--text-main);
        }
        .status-pill.active {
          border-color: var(--btn-primary-bg);
        }

        :root .status-pill.active {
          background: #e8f0fe;
          color: #1a73e8;
          border-color: #1a73e8;
        }

        [data-theme='dark'] .status-pill.active {
          background: #1e293b;
          color: #60a5fa;
          border-color: #3b82f6;
        }

        .dcr-table-row {
          border-bottom: 1px solid var(--border-subtle);
          transition: background-color 0.15s ease;
        }
        .dcr-table-row:hover {
          background-color: var(--bg-card-subtle);
        }

        .status-select-badge {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          outline: none;
          transition: all 0.15s ease;
        }
        :root .status-select-badge {
          border: 1px solid #dadce0;
        }
        [data-theme='dark'] .status-select-badge {
          border: 1px solid #3f4756;
        }

        .sortable-th {
          cursor: pointer;
          user-select: none;
          transition: background-color 0.15s ease;
        }
        .sortable-th:hover {
          background-color: var(--bg-input);
        }
      `}</style>

      {/* KPI Cards Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Active Builds
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#1a73e8",
              marginTop: "6px",
            }}
          >
            {kpis.totalActive}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-subtle)",
              marginTop: "4px",
            }}
          >
            Excl. completed & canceled
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Under Construction
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#f59e0b",
              marginTop: "6px",
            }}
          >
            {kpis.underConstruction}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-subtle)",
              marginTop: "4px",
            }}
          >
            Actively building
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Pre Construction
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "var(--text-muted)",
              marginTop: "6px",
            }}
          >
            {kpis.preConstruction}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-subtle)",
              marginTop: "4px",
            }}
          >
            Awaiting construction
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Total Completed
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#10b981",
              marginTop: "6px",
            }}
          >
            {kpis.completed}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-subtle)",
              marginTop: "4px",
            }}
          >
            Finished builds
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Unassigned
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#ef4444",
              marginTop: "6px",
            }}
          >
            {kpis.unassigned}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-subtle)",
              marginTop: "4px",
            }}
          >
            Has DCR ID, no status
          </div>
        </div>
      </div>

      {/* Main Focus Section */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[...statusOptions, "Unassigned"].map((status) => {
              const active = selectedStatuses.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className={`status-pill ${active ? "active" : ""}`}
                >
                  {status}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              Technician:
            </label>
            <select
              value={selectedTech}
              onChange={(e) => setSelectedTech(e.target.value)}
              className="dcr-select"
              style={{ minWidth: "200px" }}
            >
              <option value="All">All Technicians</option>
              {techOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Focus Table */}
        <div
          style={{
            overflowX: "auto",
            borderTop: "1px solid var(--border-color)",
            background: "var(--bg-card)",
          }}
        >
          <table
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              fontSize: "13px",
              textAlign: "left",
            }}
          >
            <thead
              style={{
                background: "var(--bg-card-subtle)",
                borderBottom: "2px solid var(--border-color)",
              }}
            >
              <tr>
                <th
                  onClick={() => handleSortClick("dcrId")}
                  className="sortable-th"
                  style={{
                    width: "15%",
                    padding: "10px 16px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                  title="Click to sort by DCR ID"
                >
                  DCR ID {renderSortIndicator("dcrId")}
                </th>
                <th
                  onClick={() => handleSortClick("dateSubmitted")}
                  className="sortable-th"
                  style={{
                    width: "15%",
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                  title="Click to sort by Date Submitted"
                >
                  Date Submitted {renderSortIndicator("dateSubmitted")}
                </th>
                <th
                  onClick={() => handleSortClick("nodeNum")}
                  className="sortable-th"
                  style={{
                    width: "11%",
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                  title="Click to sort by Node #"
                >
                  Node # {renderSortIndicator("nodeNum")}
                </th>
                <th
                  onClick={() => handleSortClick("region")}
                  className="sortable-th"
                  style={{
                    width: "13%",
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                  title="Click to sort by Region"
                >
                  Region {renderSortIndicator("region")}
                </th>
                <th
                  onClick={() => handleSortClick("contractor")}
                  className="sortable-th"
                  style={{
                    width: "17%",
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                  title="Click to sort by Contractor"
                >
                  Contractor {renderSortIndicator("contractor")}
                </th>
                <th
                  style={{
                    width: "19%",
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    width: "10%",
                    padding: "10px 16px",
                    fontWeight: 600,
                    color: "var(--text-main)",
                    textAlign: "center",
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {currentPageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: "40px",
                      textAlign: "center",
                      color: "var(--text-subtle)",
                    }}
                  >
                    {loading
                      ? `Loading records for ${activeRegion?.name || "region"}...`
                      : `No records found matching the active status and technician filters.`}
                  </td>
                </tr>
              ) : (
                currentPageRows.map(({ row, sheetRowNumber }) => {
                  const dcrId = row[24] || "—";
                  const dateSub = row[2] || "—";
                  const nodeNum = row[12] || "—";
                  const region = row[5] || "—";
                  const contractor = row[34] || "—";
                  const currentStatus = String(row[32] || "").trim();
                  const displayStatus = currentStatus || "Unassigned";
                  const badgeTheme =
                    STATUS_COLORS[displayStatus] || STATUS_COLORS["Unassigned"];
                  const isDark =
                    document.documentElement.getAttribute("data-theme") ===
                    "dark";

                  const badgeBg = isDark
                    ? badgeTheme?.bgDark || "var(--bg-card-subtle)"
                    : badgeTheme?.bgLight || "#f1f3f4";
                  const badgeText = isDark
                    ? badgeTheme?.textDark || "var(--text-main)"
                    : badgeTheme?.textLight || "#202124";

                  return (
                    <tr key={sheetRowNumber} className="dcr-table-row">
                      <td style={{ padding: "10px 16px", fontWeight: 600 }}>
                        <button
                          onClick={() =>
                            navigate(`/dcr/${encodeURIComponent(dcrId)}`)
                          }
                          className="btn-secondary"
                          style={{
                            padding: "3px 10px",
                            borderRadius: "4px",
                            fontWeight: 600,
                            color: "var(--btn-primary-bg)",
                            fontSize: "12px",
                          }}
                        >
                          {dcrId} ↗
                        </button>
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "var(--text-muted)",
                        }}
                      >
                        {dateSub}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontWeight: 500,
                          color: "var(--text-main)",
                        }}
                      >
                        {nodeNum}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "var(--text-muted)",
                        }}
                      >
                        {region}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "var(--text-muted)",
                        }}
                      >
                        {contractor}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <select
                          value={currentStatus || ""}
                          disabled={updatingRow === sheetRowNumber}
                          onChange={(e) =>
                            handleStatusChange(sheetRowNumber, e.target.value)
                          }
                          className="status-select-badge"
                          style={{
                            width: "100%",
                            maxWidth: "175px",
                            background: badgeBg,
                            color: badgeText,
                          }}
                        >
                          {!currentStatus && (
                            <option value="" disabled>
                              Unassigned
                            </option>
                          )}
                          {statusOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "center" }}>
                        <button
                          onClick={() =>
                            navigate(`/dcr/${encodeURIComponent(dcrId)}`)
                          }
                          className="btn-secondary"
                          style={{
                            padding: "4px 12px",
                            fontSize: "12px",
                          }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderTop: "1px solid var(--border-color)",
            background: "var(--bg-card-subtle)",
            fontSize: "13px",
            color: "var(--text-muted)",
          }}
        >
          <div>
            Showing {filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, filteredRows.length)} of{" "}
            {filteredRows.length} rows
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary"
              style={{ padding: "5px 12px" }}
            >
              Previous
            </button>
            <span style={{ color: "var(--text-main)" }}>
              Page <strong>{page}</strong> of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
              className="btn-secondary"
              style={{ padding: "5px 12px" }}
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
              style={{ marginLeft: "10px", padding: "4px 8px" }}
            >
              <option value={15}>Show 15</option>
              <option value={25}>Show 25</option>
              <option value={50}>Show 50</option>
              <option value={100}>Show 100</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}