import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";


const DEFAULT_STATUSES = [
  "Pre Construction",
  "Permitting in Process",
  "Under Construction",
  "Maintenance Tie",
  "Completed",
  "Canceled",
];


// Theme-adaptive status styling with fallback borders
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
    bgLight: "#fad2cf",
    textLight: "#a50e0e",
    bgDark: "#370c0c",
    textDark: "#fca5a5",
    borderDark: "#991b1b",
  },
};


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


  // Use dynamic statuses & technicians from Google Sheets validation tab
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


  // Persistent multi-status selection (empty array = show all)
  const [selectedStatuses, setSelectedStatuses] = useState(() => {
    try {
      const saved = localStorage.getItem("coordinator_selected_statuses");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });


  const [updatingRow, setUpdatingRow] = useState(null);


  // Persistent technician filter
  const [selectedTech, setSelectedTech] = useState(() => {
    return localStorage.getItem("coordinator_tech") || "All";
  });


  // Persistent page size (defaults to 15)
  const [pageSize, setPageSize] = useState(() => {
    const saved = localStorage.getItem("coordinator_page_size");
    return saved ? Number(saved) : 15;
  });


  const [page, setPage] = useState(1);


  // Sync state changes to localStorage and reset page
  useEffect(() => {
    localStorage.setItem("coordinator_selected_statuses", JSON.stringify(selectedStatuses));
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


  // Toggle status selection on pill click
  const toggleStatus = (status) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };


  const rows = useMemo(() => {
    if (!sheetData || sheetData.length < 3) return [];
    return sheetData.slice(2);
  }, [sheetData]);


  // KPIs scoped by selected technician
  const kpis = useMemo(() => {
    let totalActive = 0;
    let underConstruction = 0;
    let preConstruction = 0;
    let completed = 0;
    const contractorCounts = {};


    rows.forEach((row) => {
      const tech = String(row[30] || "").trim(); // Col AE
      const status = String(row[32] || "").trim(); // Col AG
      const contractor = String(row[34] || "").trim(); // Col AI


      if (selectedTech !== "All" && tech !== selectedTech) {
        return;
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
      contractorCounts,
    };
  }, [rows, selectedTech]);


  // Filter rows by multi-selected statuses (or all if none selected) AND technician
  const filteredRows = useMemo(() => {
    const matches = [];
    const hasStatusFilter = selectedStatuses.length > 0;


    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tech = String(row[30] || "").trim(); // Col AE
      const status = String(row[32] || "").trim(); // Col AG


      const statusMatch = !hasStatusFilter || selectedStatuses.some(
        (s) => s.toLowerCase() === status.toLowerCase()
      );
      const techMatch = selectedTech === "All" || tech === selectedTech;


      if (statusMatch && techMatch) {
        matches.push({
          row,
          sheetRowNumber: i + 3,
        });
      }
    }


    matches.sort((a, b) => {
      const dateA = new Date(a.row[2] || 0);
      const dateB = new Date(b.row[2] || 0);
      return dateB - dateA;
    });


    return matches;
  }, [rows, selectedStatuses, selectedTech]);


  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);


  const handleStatusChange = async (sheetRowNumber, newStatus) => {
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
        }),
      });


      const data = await res.json();
      if (!res.ok) throw new Error(data.error);


      showToast(
        `Row ${sheetRowNumber} status updated to "${newStatus}"`,
        "success"
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
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Active Builds
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#1a73e8", marginTop: "6px" }}>
            {kpis.totalActive}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)", marginTop: "4px" }}>
            Excludes completed & canceled
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
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Under Construction
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#f59e0b", marginTop: "6px" }}>
            {kpis.underConstruction}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)", marginTop: "4px" }}>
            Active field work
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
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Pre Construction
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-muted)", marginTop: "6px" }}>
            {kpis.preConstruction}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)", marginTop: "4px" }}>
            Awaiting mobilization
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
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
            Total Completed
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#10b981", marginTop: "6px" }}>
            {kpis.completed}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)", marginTop: "4px" }}>
            Finished DCR records
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
          {/* Status Multi-Select Toggle Pills */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {statusOptions.map((status) => {
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


          {/* Technician Dropdown Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
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
                <th style={{ width: "15%", padding: "10px 16px", fontWeight: 600, color: "var(--text-main)" }}>
                  DCR ID
                </th>
                <th style={{ width: "14%", padding: "10px 12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Date Submitted
                </th>
                <th style={{ width: "11%", padding: "10px 12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Node #
                </th>
                <th style={{ width: "13%", padding: "10px 12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Region
                </th>
                <th style={{ width: "18%", padding: "10px 12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Contractor
                </th>
                <th style={{ width: "19%", padding: "10px 12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Status (Col AG)
                </th>
                <th style={{ width: "10%", padding: "10px 16px", fontWeight: 600, color: "var(--text-main)", textAlign: "center" }}>
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
                      ? "Loading records..."
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
                  const isDark =
                    document.documentElement.getAttribute("data-theme") === "dark";
                  const badgeTheme = STATUS_COLORS[currentStatus];


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
                      <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                        {dateSub}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--text-main)" }}>
                        {nodeNum}
                      </td>
                      <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                        {region}
                      </td>
                      <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>
                        {contractor}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <select
                          value={currentStatus}
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
                          {currentStatus && !statusOptions.includes(currentStatus) && (
                            <option value={currentStatus}>{currentStatus}</option>
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
            Showing {filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1}
            –{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} rows
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
              <option value={50}>Show 50</option>
              <option value={100}>Show 100</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}