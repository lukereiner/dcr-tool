import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";

const STATUS_OPTIONS = [
  "Pre Construction",
  "Permitting in Process",
  "Under Construction",
  "Maintenance Tie",
  "Completed",
  "Canceled",
];

const STATUS_COLORS = {
  "Pre Construction": { bg: "#e8eaed", text: "#3c4043" },
  "Permitting in Process": { bg: "#e8eaed", text: "#3c4043" },
  "Under Construction": { bg: "#fef7e0", text: "#b06000" },
  "Maintenance Tie": { bg: "#e8eaed", text: "#3c4043" },
  Completed: { bg: "#ceead6", text: "#0d652d" },
  Canceled: { bg: "#fad2cf", text: "#a50e0e" },
};

export default function Dashboard({
  sheetData,
  onRefresh,
  loading,
  accessToken,
  onStatusUpdated,
}) {
  const navigate = useNavigate();
  const [selectedStatus, setSelectedStatus] = useState("Under Construction");
  const [updatingRow, setUpdatingRow] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");

  // Extract body rows
  const rows = useMemo(() => {
    if (!sheetData || sheetData.length < 2) return [];
    return sheetData.slice(1);
  }, [sheetData]);

  // Compute High-Level KPIs
  const kpis = useMemo(() => {
    let totalActive = 0;
    let underConstruction = 0;
    let preConstruction = 0;
    let completed = 0;
    const contractorCounts = {};

    rows.forEach((row) => {
      const status = String(row[32] || "").trim(); // Col AG
      const contractor = String(row[34] || "").trim(); // Col AI

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
  }, [rows]);

// Filter and sort the latest 5 rows matching the selected status
const filteredRows = useMemo(() => {
  const matches = [];


  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = String(row[32] || '').trim(); // Col AG


    if (status.toLowerCase() === selectedStatus.toLowerCase()) {
      matches.push({
        row,
        sheetRowNumber: i + 2, // 1-based index in Google Sheets
      });
    }
  }


  // Sort descending by Date Submitted (Column C / index 2)
  matches.sort((a, b) => {
    const dateA = new Date(a.row[2] || 0);
    const dateB = new Date(b.row[2] || 0);
    return dateB - dateA; // Most recent dates first
  });


  // Limit to top 10 most recent records
  return matches.slice(0, 10);
}, [rows, selectedStatus]);

  // Inline Status update for Column AG
  const handleStatusChange = async (sheetRowNumber, newStatus) => {
    setUpdatingRow(sheetRowNumber);
    setStatusMessage(`Updating row ${sheetRowNumber} to "${newStatus}"...`);

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

      setStatusMessage(
        `Row ${sheetRowNumber} status updated to "${newStatus}".`,
      );
      if (onStatusUpdated) {
        onStatusUpdated(sheetRowNumber, 32, newStatus);
      }
    } catch (err) {
      setStatusMessage(`Failed to update status: ${err.message}`);
    } finally {
      setUpdatingRow(null);
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
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
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#666",
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
          <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
            Excludes completed & canceled
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#666",
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
              color: "#b06000",
              marginTop: "6px",
            }}
          >
            {kpis.underConstruction}
          </div>
          <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
            Active field work
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#666",
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
              color: "#5f6368",
              marginTop: "6px",
            }}
          >
            {kpis.preConstruction}
          </div>
          <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
            Awaiting mobilization
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#666",
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
              color: "#0d652d",
              marginTop: "6px",
            }}
          >
            {kpis.completed}
          </div>
          <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
            Finished DCR records
          </div>
        </div>
      </div>

      {statusMessage && (
        <div
          style={{
            padding: "10px 14px",
            background: "#f8f9fa",
            borderLeft: "4px solid #1a73e8",
            marginBottom: "16px",
            fontSize: "13px",
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* 5-Row Section */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          padding: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >

          {/* Status Toggle Buttons */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {STATUS_OPTIONS.map((status) => {
              const active = selectedStatus === status;
              const styleColor = STATUS_COLORS[status] || {
                bg: "#eee",
                text: "#333",
              };
              return (
                <button
                  key={status}
                  onClick={() => setSelectedStatus(status)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "16px",
                    border: active ? "2px solid #1a73e8" : "1px solid #dadce0",
                    background: active ? styleColor.bg : "#fff",
                    color: active ? styleColor.text : "#5f6368",
                    fontWeight: active ? 600 : 400,
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  {status}
                </button>
              );
            })}
          </div>
        </div>

        {/* 5-Row Table */}
        <div
          style={{
            overflowX: "auto",
            border: "1px solid #eee",
            borderRadius: "6px",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
              textAlign: "left",
            }}
          >
            <thead
              style={{
                background: "#f8f9fa",
                borderBottom: "2px solid #e0e0e0",
              }}
            >
              <tr>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                  }}
                >
                  DCR ID
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                  }}
                >
                  Date Submitted
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                  }}
                >
                  Node #
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                  }}
                >
                  Region
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                  }}
                >
                  Contractor
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                  }}
                >
                  Status (Col AG)
                </th>
                <th
                  style={{
                    padding: "10px 12px",
                    fontWeight: 600,
                    color: "#3c4043",
                    textAlign: "center",
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "#888",
                    }}
                  >
                    {loading
                      ? "Loading records..."
                      : `No records found with status "${selectedStatus}".`}
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ row, sheetRowNumber }) => {
                  const dcrId = row[24] || "—"; // Col Y
                  const dateSub = row[2] || "—"; // Col C
                  const nodeNum = row[12] || "—"; // Col M
                  const region = row[5] || "—"; // Col F
                  const contractor = row[34] || "—"; // Col AI
                  const currentStatus = String(row[32] || "").trim(); // Col AG

                  return (
                    <tr
                      key={sheetRowNumber}
                      style={{ borderBottom: "1px solid #f1f3f4" }}
                    >
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                        <button
                          onClick={() =>
                            navigate(`/dcr/${encodeURIComponent(dcrId)}`)
                          }
                          style={{
                            background: "#e8f0fe",
                            color: "#1a73e8",
                            border: "1px solid #1a73e8",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "bold",
                          }}
                        >
                          {dcrId} ↗
                        </button>
                      </td>
                      <td style={{ padding: "10px 12px", color: "#5f6368" }}>
                        {dateSub}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 500 }}>
                        {nodeNum}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#5f6368" }}>
                        {region}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#5f6368" }}>
                        {contractor}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {/* Inline Status Dropdown */}
                        <select
                          value={currentStatus}
                          disabled={updatingRow === sheetRowNumber}
                          onChange={(e) =>
                            handleStatusChange(sheetRowNumber, e.target.value)
                          }
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid #dadce0",
                            fontSize: "12px",
                            fontWeight: 500,
                            background:
                              STATUS_COLORS[currentStatus]?.bg || "#fff",
                            color: STATUS_COLORS[currentStatus]?.text || "#333",
                            cursor: "pointer",
                          }}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <button
                          onClick={() =>
                            navigate(`/dcr/${encodeURIComponent(dcrId)}`)
                          }
                          style={{
                            padding: "4px 10px",
                            background: "#f1f3f4",
                            border: "1px solid #ccc",
                            borderRadius: "4px",
                            fontSize: "12px",
                            cursor: "pointer",
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

        <div
          style={{
            marginTop: "16px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={() => navigate("/data")}
            style={{
              padding: "8px 16px",
              background: "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "13px",
            }}
          >
            View Full Spreadsheet ({rows.length} rows) →
          </button>
        </div>
      </div>
    </div>
  );
}
