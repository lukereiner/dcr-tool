import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
} from "react";
import { AuthContext } from "../App";
import { useToast } from "../context/ToastContext";
import MasterSummary from "../components/master/MasterSummary";
import MasterSystemExt from "../components/master/MasterSystemExt";
import MasterMileage from "../components/master/MasterMileage";
import { SelectionSummaryInline } from "../components/master/CellSelectionTools";

const MASTER_TABS = ["Summary", "System Ext Data", "Mileage Table"];

export default function Master() {
  const { accessToken, logout, refreshSignal, userProfile } =
    useContext(AuthContext);
  const { showToast } = useToast();

  const isDirector =
    String(userProfile?.role || "")
      .trim()
      .toUpperCase() === "DIRECTOR";

  const [activeTab, setActiveTab] = useState("Summary");
  const [loading, setLoading] = useState(true);
  const [isUpdatingControl, setIsUpdatingControl] = useState(false);

  const [selectionInfo, setSelectionInfo] = useState({
    stats: null,
    clearSelection: null,
  });

  const handleSelectionChange = useCallback((stats, clearSelection) => {
    setSelectionInfo({ stats, clearSelection });
  }, []);

  const [masterData, setMasterData] = useState({
    summary: { year: "", region: "", regionOptions: [], rows: [] },
    systemExt: {
      region: "",
      system: "",
      regionOptions: [],
      systemOptions: [],
      rows: [],
    },
    mileage: { rows: [], totals: [] },
  });

  const fetchMasterData = useCallback(
    async (showSuccessToast = false) => {
      if (!accessToken || !isDirector) return;
      setLoading(true);
      try {
        const res = await fetch("/api/master", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (res.status === 401) {
          logout(true);
          return;
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load Master data");

        setMasterData({
          summary: data.summary || {
            year: "",
            region: "",
            regionOptions: [],
            rows: [],
          },
          systemExt: data.systemExt || {
            region: "",
            system: "",
            regionOptions: [],
            systemOptions: [],
            rows: [],
          },
          mileage: data.mileage || { rows: [], totals: [] },
        });

        if (showSuccessToast) {
          showToast("Master sheet refreshed", "success");
        }
      } catch (err) {
        showToast(`Failed to load Master sheet: ${err.message}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [accessToken, isDirector, logout, showToast],
  );

  useEffect(() => {
    fetchMasterData(false);
  }, [fetchMasterData]);

  const lastSignalRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal > lastSignalRef.current) {
      lastSignalRef.current = refreshSignal;
      fetchMasterData(true);
    }
  }, [refreshSignal, fetchMasterData]);

  const handleControlChange = async (tab, cell, value) => {
    if (!accessToken) return;

    setMasterData((prev) => {
      if (tab === "Summary") {
        return {
          ...prev,
          summary: { ...prev.summary, region: value },
        };
      }
      return {
        ...prev,
        systemExt: {
          ...prev.systemExt,
          ...(cell === "B2" ? { region: value } : { system: value }),
        },
      };
    });

    setIsUpdatingControl(true);
    try {
      const res = await fetch("/api/master/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ tab, cell, value }),
      });

      if (res.status === 401) {
        logout(true);
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update control");

      setMasterData((prev) => ({
        ...prev,
        ...(data.summary ? { summary: data.summary } : {}),
        ...(data.systemExt ? { systemExt: data.systemExt } : {}),
      }));
    } catch (err) {
      showToast(`Failed to update ${tab} filter: ${err.message}`, "error");
      await fetchMasterData(false);
    } finally {
      setIsUpdatingControl(false);
    }
  };

  const handleSaveMileageCell = async (
    cellA1,
    value,
    sheetRowNumber,
    colIndex,
  ) => {
    if (!accessToken) return false;

    const previousRows = masterData.mileage.rows;
    const targetIdx = sheetRowNumber - 2;

    const optimisticRows = previousRows.map((r, idx) => {
      if (idx !== targetIdx) return r;
      const copy = [...r];
      copy[colIndex] = value;
      return copy;
    });

    setMasterData((prev) => ({
      ...prev,
      mileage: {
        ...prev.mileage,
        rows: optimisticRows,
      },
    }));

    try {
      const res = await fetch("/api/master/mileage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ cell: cellA1, value }),
      });

      if (res.status === 401) {
        logout(true);
        return false;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save cell");

      setMasterData((prev) => ({
        ...prev,
        mileage: {
          ...prev.mileage,
          totals: Array.isArray(data.totals) ? data.totals : prev.mileage.totals,
        },
      }));

      showToast(`Saved ${cellA1} and updated totals`, "success");
      return true;
    } catch (err) {
      setMasterData((prev) => ({
        ...prev,
        mileage: {
          ...prev.mileage,
          rows: previousRows,
        },
      }));
      showToast(`Save failed: ${err.message}`, "error");
      return false;
    }
  };

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
      <style>{`
        @keyframes btnSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .master-table-row {
          transition: background-color 0.15s ease;
        }
        .master-table-row:nth-child(even) {
          background-color: var(--bg-card);
        }
        .master-table-row:nth-child(odd) {
          background-color: var(--bg-card-subtle);
        }
        .master-table-row:hover {
          background-color: var(--bg-input);
        }

        .master-cell-editable {
          cursor: pointer;
        }
        .master-cell-editable:hover {
          outline: 1px dashed var(--btn-primary-bg);
          outline-offset: -1px;
        }

        .master-cell-selected {
          background-color: rgba(26, 115, 232, 0.14) !important;
          outline: 1px solid rgba(26, 115, 232, 0.55);
          outline-offset: -1px;
        }
        [data-theme='dark'] .master-cell-selected {
          background-color: rgba(96, 165, 250, 0.22) !important;
          outline: 1px solid rgba(96, 165, 250, 0.6);
        }

        .master-tab-btn:not(.active):hover {
          background-color: var(--bg-input) !important;
          color: var(--text-main) !important;
        }

        .master-sticky-cell.master-cell-selected {
          background: linear-gradient(
              rgba(26, 115, 232, 0.16),
              rgba(26, 115, 232, 0.16)
            ),
            var(--bg-card) !important;
        }
        [data-theme='dark'] .master-sticky-cell.master-cell-selected {
          background: linear-gradient(
              rgba(96, 165, 250, 0.24),
              rgba(96, 165, 250, 0.24)
            ),
            var(--bg-card) !important;
        }
      `}</style>

      {/* Main Master Sheet Card */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "78vh",
          minHeight: "520px",
        }}
      >
        {loading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "14px",
            }}
          >
            Loading Master Sheet data...
          </div>
        ) : activeTab === "Summary" ? (
          <MasterSummary
            summary={masterData.summary}
            onControlChange={handleControlChange}
            isUpdating={isUpdatingControl}
            onSelectionChange={handleSelectionChange}
          />
        ) : activeTab === "System Ext Data" ? (
          <MasterSystemExt
            systemExt={masterData.systemExt}
            onControlChange={handleControlChange}
            isUpdating={isUpdatingControl}
            onSelectionChange={handleSelectionChange}
          />
        ) : (
          <MasterMileage
            mileage={masterData.mileage}
            onSaveCell={handleSaveMileageCell}
            onSelectionChange={handleSelectionChange}
          />
        )}

        {/* Google Sheets Style Bottom Tab Bar + Far-Right Selection Stats */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--bg-card-subtle)",
            borderTop: "1px solid var(--border-color)",
            padding: "0 12px 0 8px",
            flexShrink: 0,
            gap: "12px",
            minHeight: "41px",
          }}
        >
          {/* Left: Sheet Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              overflowX: "auto",
            }}
          >
            {MASTER_TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    if (!isActive) {
                      setActiveTab(tab);
                      setSelectionInfo({ stats: null, clearSelection: null });
                    }
                  }}
                  className={`master-tab-btn ${isActive ? "active" : ""}`}
                  style={{
                    padding: "10px 18px",
                    background: isActive ? "var(--bg-card)" : "transparent",
                    color: isActive
                      ? "var(--btn-primary-bg, #1a73e8)"
                      : "var(--text-muted)",
                    border: "none",
                    borderTop: isActive
                      ? "2px solid var(--btn-primary-bg, #1a73e8)"
                      : "2px solid transparent",
                    borderRight: "1px solid var(--border-color)",
                    borderLeft: isActive
                      ? "1px solid var(--border-color)"
                      : "none",
                    fontSize: "13px",
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.1s ease",
                    outline: "none",
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Right: Highlight-to-Sum Stats */}
          {selectionInfo.stats && (
            <SelectionSummaryInline
              stats={selectionInfo.stats}
              onClear={selectionInfo.clearSelection}
            />
          )}
        </div>
      </div>
    </div>
  );
}