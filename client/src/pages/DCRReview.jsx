import React, { useState, useEffect, useContext, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AuthContext } from "../App";
import { useToast } from "../context/ToastContext";

function extractDriveFolderId(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/folders\/([a-zA-Z0-9_-]{25,})/);
  return match ? match[1] : null;
}

const DROPDOWN_FIELD_OPTIONS = {
  Z: ["Approved", "Denied"],
  AE: [
    "Dante Hawkins",
    "David Firewick",
    "Jason Jones",
    "James Naumann",
    "Larry Burruel",
    "Jose Diaz",
    "Roy Ray",
    "Steve McGraw",
    "Jeremy Borreson",
  ],
  AG: [
    "Pre Construction",
    "Permitting in Process",
    "Under Construction",
    "Maintenance Tie",
    "Completed",
    "Canceled",
  ],
  AL: ["Yes", "No"],
};

function getFileBadge(mimeType, name) {
  if (mimeType?.startsWith("image/")) {
    return {
      label: "IMG",
      bg: "#e0f2fe",
      text: "#0369a1",
      darkBg: "#082f49",
      darkText: "#7dd3fc",
    };
  }
  if (mimeType?.includes("pdf") || name?.endsWith(".pdf")) {
    return {
      label: "PDF",
      bg: "#fee2e2",
      text: "#b91c1c",
      darkBg: "#450a0a",
      darkText: "#fca5a5",
    };
  }
  if (
    mimeType?.includes("sheet") ||
    mimeType?.includes("excel") ||
    name?.endsWith(".xlsx") ||
    name?.endsWith(".csv")
  ) {
    return {
      label: "SHEET",
      bg: "#dcfce7",
      text: "#15803d",
      darkBg: "#052e16",
      darkText: "#86efac",
    };
  }
  if (name?.endsWith(".dwg") || name?.endsWith(".dxf")) {
    return {
      label: "CAD",
      bg: "#fef3c7",
      text: "#b45309",
      darkBg: "#451a03",
      darkText: "#fcd34d",
    };
  }
  return {
    label: "FILE",
    bg: "#f3f4f6",
    text: "#4b5563",
    darkBg: "#1f2937",
    darkText: "#9ca3af",
  };
}

// Inline Sub-component: Field Status Indicator
function FieldIndicator({ status }) {
  if (!status || status === "idle" || status === "dirty") {
    return null;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        marginLeft: "6px",
        verticalAlign: "middle",
      }}
    >
      {status === "saving" && (
        <span
          style={{
            display: "inline-block",
            width: "12px",
            height: "12px",
            border: "2px solid rgba(59, 130, 246, 0.25)",
            borderTop: "2px solid #3b82f6",
            borderRadius: "50%",
            animation: "btnSpin 0.7s linear infinite",
          }}
        />
      )}

      {status === "saved" && (
        <svg
          style={{
            width: "14px",
            height: "14px",
            color: "#16a34a",
            animation: "fieldFadeIn 0.2s ease-out",
          }}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}

      {status === "error" && (
        <svg
          style={{
            width: "14px",
            height: "14px",
            color: "#dc2626",
            animation: "fieldFadeIn 0.2s ease-out",
          }}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </span>
  );
}

// Inline Sub-component: Header Auto-Save Pill
function AutoSaveHeaderStatus({ status, onRetry }) {
  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    fontWeight: 500,
    padding: "6px 14px",
    borderRadius: "20px",
    background: "var(--bg-card)",
    color: "var(--text-main)",
    border: "1px solid var(--border-color)",
    boxShadow: "var(--shadow-card, 0 1px 3px rgba(0, 0, 0, 0.05))",
    transition: "all 0.2s ease",
  };


  if (status === "saving") {
    return (
      <div style={baseStyle}>
        <span
          style={{
            display: "inline-block",
            width: "12px",
            height: "12px",
            border: "2px solid rgba(59, 130, 246, 0.25)",
            borderTop: "2px solid var(--btn-primary-bg, #2563eb)",
            borderRadius: "50%",
            animation: "btnSpin 0.7s linear infinite",
          }}
        />
        <span style={{ color: "var(--text-muted)" }}>Saving changes...</span>
      </div>
    );
  }


  if (status === "dirty") {
    return (
      <div style={baseStyle}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "#eab308",
            display: "inline-block",
            boxShadow: "0 0 0 2px rgba(234, 179, 8, 0.2)",
          }}
        />
        <span style={{ color: "var(--text-muted)" }}>Unsaved changes</span>
      </div>
    );
  }


  if (status === "error") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "rgba(239, 68, 68, 0.1)",
          borderColor: "rgba(239, 68, 68, 0.35)",
        }}
      >
        <span style={{ color: "#ef4444", fontWeight: 600 }}>⚠️ Auto-save failed</span>
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: "#ef4444",
            color: "#ffffff",
            border: "none",
            borderRadius: "4px",
            padding: "2px 8px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            marginLeft: "2px",
          }}
        >
          Retry
        </button>
      </div>
    );
  }


  return (
    <div style={baseStyle}>
      <span
        style={{
          color: "#16a34a",
          fontSize: "14px",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        ✓
      </span>
      <span style={{ color: "var(--text-muted)" }}>All changes saved</span>
    </div>
  );
}

export default function DCRReview({
  onRecordUpdated,
  dropdownOptions: propDropdownOptions,
}) {
  const { dcrId } = useParams();
  const navigate = useNavigate();
  const { accessToken, logout, refreshSignal } = useContext(AuthContext);
  const { showToast } = useToast();

  const [dcrData, setDcrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formValues, setFormValues] = useState({});
  const [dynamicDropdowns, setDynamicDropdowns] = useState(
    propDropdownOptions || {},
  );

  // Auto-Save States & Tracking
  const [dirtyFields, setDirtyFields] = useState(new Set());
  const [fieldStatuses, setFieldStatuses] = useState({});
  const [globalStatus, setGlobalStatus] = useState("idle"); // 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;

  const dirtyFieldsRef = useRef(dirtyFields);
  dirtyFieldsRef.current = dirtyFields;

  const debounceTimerRef = useRef(null);
  const fadeTimersRef = useRef({});
  const inFlightSnapshotRef = useRef(null);

  // Section 2 card expansions
  const [expandedFields, setExpandedFields] = useState({});

  // Media view states
  const [photos, setPhotos] = useState([]);
  const [folderFiles, setFolderFiles] = useState([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");

  const [driveViewMode, setDriveViewMode] = useState(() => {
    return localStorage.getItem("dcr_drive_view_mode") || "photos";
  });

  useEffect(() => {
    localStorage.setItem("dcr_drive_view_mode", driveViewMode);
  }, [driveViewMode]);

  const toggleFieldExpand = (colLetter) => {
    setExpandedFields((prev) => ({
      ...prev,
      [colLetter]: !prev[colLetter],
    }));
  };

  // Edge Case: Alert user if they close tab while changes are pending
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (dirtyFieldsRef.current.size > 0 || inFlightSnapshotRef.current !== null) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Core Auto-Save Dispatcher
  const executeBatchSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const currentDirty = dirtyFieldsRef.current;
    if (currentDirty.size === 0 || !dcrData) return;

    // Snapshot unpersisted dirty fields
    const snapshot = {};
    currentDirty.forEach((colLetter) => {
      snapshot[colLetter] = formValuesRef.current[colLetter] ?? "";
    });

    inFlightSnapshotRef.current = snapshot;
    setGlobalStatus("saving");

    // Set field indicators to saving
    setFieldStatuses((prev) => {
      const next = { ...prev };
      currentDirty.forEach((colLetter) => {
        next[colLetter] = "saving";
      });
      return next;
    });

    try {
      const res = await fetch(`/api/dcr/${encodeURIComponent(dcrId)}/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ updates: snapshot }),
      });

      if (res.status === 401) {
        logout(true);
        return;
      }

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Batch update failed");

      setGlobalStatus("saved");

      // Sync updated values to parent App state
      if (onRecordUpdated && dcrData.fields) {
        Object.entries(snapshot).forEach(([colLetter, val]) => {
          const fieldDef = dcrData.fields.find((f) => f.colLetter === colLetter);
          if (fieldDef) {
            onRecordUpdated(dcrData.sheetRowNumber, fieldDef.colIndex, val);
          }
        });
      }

      // Race Condition Defense: compare snapshot with active local state
      setDirtyFields((prevDirty) => {
        const nextDirty = new Set(prevDirty);
        const resolvedCols = [];

        Object.keys(snapshot).forEach((colLetter) => {
          if (formValuesRef.current[colLetter] === snapshot[colLetter]) {
            nextDirty.delete(colLetter);
            resolvedCols.push(colLetter);
          }
        });

        // Trigger green checkmark with 2.5s auto-fade
        setFieldStatuses((prevStatuses) => {
          const nextStatuses = { ...prevStatuses };

          resolvedCols.forEach((colLetter) => {
            nextStatuses[colLetter] = "saved";

            if (fadeTimersRef.current[colLetter]) {
              clearTimeout(fadeTimersRef.current[colLetter]);
            }

            fadeTimersRef.current[colLetter] = setTimeout(() => {
              setFieldStatuses((curr) => {
                if (curr[colLetter] === "saved") {
                  return { ...curr, [colLetter]: "idle" };
                }
                return curr;
              });
            }, 2500);
          });

          return nextStatuses;
        });

        // If user typed in another field during network transit, re-queue debounce
        if (nextDirty.size > 0) {
          setGlobalStatus("dirty");
          debounceTimerRef.current = setTimeout(executeBatchSave, 3000);
        }

        return nextDirty;
      });
    } catch (err) {
      console.error("Auto-save error:", err);
      setGlobalStatus("error");
      showToast(`Auto-save error: ${err.message}`, "error");

      setFieldStatuses((prev) => {
        const next = { ...prev };
        Object.keys(snapshot).forEach((colLetter) => {
          next[colLetter] = "error";
        });
        return next;
      });
    } finally {
      inFlightSnapshotRef.current = null;
    }
  }, [dcrData, dcrId, accessToken, logout, onRecordUpdated, showToast]);

  // Edge Case: Auto-retry pending saves once network returns
  useEffect(() => {
    const handleOnline = () => {
      if (dirtyFieldsRef.current.size > 0) {
        executeBatchSave();
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [executeBatchSave]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      Object.values(fadeTimersRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Input change handler: clears indicator immediately and restarts 3s debounce
  const handleFieldChange = (colLetter, value) => {
    // 1. Update local state
    setFormValues((prev) => ({
      ...prev,
      [colLetter]: value,
    }));

    // 2. Mark dirty
    setDirtyFields((prev) => {
      const next = new Set(prev);
      next.add(colLetter);
      return next;
    });

    // 3. Reset existing fade timers & clear visual status immediately
    if (fadeTimersRef.current[colLetter]) {
      clearTimeout(fadeTimersRef.current[colLetter]);
      delete fadeTimersRef.current[colLetter];
    }

    setFieldStatuses((prev) => ({
      ...prev,
      [colLetter]: "dirty",
    }));

    setGlobalStatus("dirty");

    // 4. Reset debounce timer (3 seconds)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      executeBatchSave();
    }, 3000);
  };

  const loadDcr = async (force = false) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const url = `/api/dcr/${encodeURIComponent(dcrId)}${force ? "?refresh=true" : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 401) {
        logout(true);
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setDcrData(data);
      if (data.dropdownOptions) {
        setDynamicDropdowns(data.dropdownOptions);
      }
      const initialInputs = {};
      data.fields.forEach((f) => {
        initialInputs[f.colLetter] = f.value;
      });
      setFormValues(initialInputs);
      setDirtyFields(new Set());
      setFieldStatuses({});
      setGlobalStatus("idle");

      if (force) {
        showToast(
          `DCR #${dcrId} refreshed directly from Google Sheets`,
          "success",
        );
      }

      const folderField = data.fields.find(
        (f) =>
          [20, 21, 22].includes(f.colIndex) &&
          f.value &&
          f.value.includes("drive.google.com"),
      );

      if (folderField) {
        setFolderUrl(folderField.value);
        const folderId = extractDriveFolderId(folderField.value);
        if (folderId) {
          fetchFolderPhotos(folderId);
        }
      } else {
        setPhotos([]);
        setFolderUrl("");
      }
    } catch (err) {
      showToast(`Failed to load DCR: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchFolderPhotos = async (folderId) => {
    setPhotosLoading(true);
    try {
      const res = await fetch(`/api/drive/folder/${folderId}/files`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok) {
        const allFiles = data.files || [];
        const imgFiles =
          data.images ||
          allFiles.filter((f) => f.mimeType?.startsWith("image/"));
        setFolderFiles(allFiles);
        setPhotos(imgFiles);
        setActivePhotoIndex(0);
      }
    } catch (err) {
      console.error("Failed to load folder files:", err);
    } finally {
      setPhotosLoading(false);
    }
  };

  const lastSignalRef = React.useRef(refreshSignal);

  useEffect(() => {
    loadDcr(false);
  }, [dcrId, accessToken]);

  useEffect(() => {
    if (refreshSignal > lastSignalRef.current) {
      lastSignalRef.current = refreshSignal;
      loadDcr(true);
    }
  }, [refreshSignal]);

  useEffect(() => {
    if (propDropdownOptions) {
      setDynamicDropdowns((prev) => ({ ...prev, ...propDropdownOptions }));
    }
  }, [propDropdownOptions]);

  if (loading) {
    return (
      <div style={{ padding: "30px", color: "var(--text-main)" }}>
        <h2>Loading DCR #{dcrId}...</h2>
      </div>
    );
  }

  if (!dcrData) {
    return (
      <div style={{ padding: "30px" }}>
        <button
          onClick={() => navigate("/coordinator")}
          className="btn-secondary"
          style={{ marginBottom: "16px" }}
        >
          ← Back to All Records
        </button>
        <p style={{ color: "#d93025" }}>
          DCR record "{dcrId}" could not be found.
        </p>
      </div>
    );
  }

  const managerSignOffs = dcrData.fields.filter((f) => f.colIndex < 2);
  const readOnlySpecs = dcrData.fields.filter(
    (f) => f.isReadOnly && ![20, 21, 22].includes(f.colIndex),
  );
  const postSpecsFields = dcrData.fields.filter(
    (f) => f.colIndex > 24 && f.colLetter !== "AR",
  );
  const commentsField = dcrData.fields.find((f) => f.colLetter === "AR");
  const activePhoto = photos[activePhotoIndex];

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <style>{`
        @keyframes btnSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fieldFadeIn {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }

        .spec-header-clamped {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.35;
          height: 2.7em;
        }

        .spec-value-clamped {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .spec-expand-btn {
          background: none;
          border: none;
          padding: 0;
          color: var(--btn-primary-bg);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }
        .spec-expand-btn:hover {
          text-decoration: underline;
        }
      `}</style>

      {/* Top Navigation Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <button
          onClick={() => navigate("/coordinator")}
          className="btn-secondary"
        >
          ← Back to All Records
        </button>

                  {/* Global Auto-Save Status */}
          <AutoSaveHeaderStatus
            status={globalStatus}
            onRetry={executeBatchSave}
          />
      </div>

      {/* Header Banner */}
      <div
        style={{
          background: "var(--btn-primary-bg)",
          color: "#ffffff",
          padding: "16px 20px",
          borderRadius: "8px",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "24px" }}>{dcrId}</h1>
          <p style={{ margin: "4px 0 0 0", opacity: 0.9, fontSize: "14px" }}>
            Sheet Row #{dcrData.sheetRowNumber}
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>


          {/* External Google Forms Links */}
          <a
            href="https://forms.gle/Vq7dhmYNdWbYwbb46"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 16px",
              background: "#ffffff",
              color: "var(--btn-primary-bg)",
              fontWeight: 600,
              fontSize: "14px",
              borderRadius: "6px",
              textDecoration: "none",
              display: "inline-block",
              transition: "opacity 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Submit Eval
          </a>

          <a
            href="https://forms.gle/8BmH22qpjA9wvMY66"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 16px",
              background: "#ffffff",
              color: "var(--btn-primary-bg)",
              fontWeight: 600,
              fontSize: "14px",
              borderRadius: "6px",
              textDecoration: "none",
              display: "inline-block",
              transition: "opacity 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Submit QC
          </a>
        </div>
      </div>

      {/* Section 1: Manager Sign-offs (Columns A & B) */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "16px 20px",
          marginBottom: "24px",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <h3
          style={{
            margin: "0 0 12px 0",
            color: "var(--btn-primary-bg)",
            fontSize: "16px",
          }}
        >
          Manager Approval & Sign-Off (Cols A & B)
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "16px",
          }}
        >
          {managerSignOffs.map((f) => (
            <div
              key={f.colLetter}
              style={{
                background: "var(--bg-card-subtle)",
                padding: "12px",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontWeight: 600,
                  fontSize: "13px",
                  marginBottom: "6px",
                  color: "var(--text-main)",
                }}
              >
                <span>
                  {f.header} ({f.colLetter})
                </span>
                <FieldIndicator status={fieldStatuses[f.colLetter]} />
              </label>
              <input
                type="text"
                className="dcr-input"
                value={formValues[f.colLetter] ?? ""}
                onChange={(e) => handleFieldChange(f.colLetter, e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Locked Form Specs */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "16px 20px",
          marginBottom: "24px",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
          }}
        >
          <h3
            style={{ margin: 0, fontSize: "16px", color: "var(--text-main)" }}
          >
            Locked DCR Form Data (Cols C through Y)
          </h3>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "12px",
            alignItems: "stretch",
          }}
        >
          {readOnlySpecs.map((f) => {
            const isExpanded = !!expandedFields[f.colLetter];
            const textValue = String(f.value || "");
            const isLong =
              textValue.length > 55 || textValue.split("\n").length > 2;

            return (
              <div
                key={f.colLetter}
                style={{
                  background: "var(--bg-card-subtle)",
                  border: "1px solid var(--border-subtle)",
                  padding: "12px",
                  borderRadius: "6px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  height: "100%",
                  boxSizing: "border-box",
                }}
              >
                <div
                  className="spec-header-clamped"
                  style={{
                    fontSize: "11px",
                    color: "var(--text-subtle)",
                    textTransform: "uppercase",
                    marginBottom: "10px",
                  }}
                  title={`${f.header} (${f.colLetter})`}
                >
                  {f.header} ({f.colLetter})
                </div>

                <div style={{ marginTop: "auto" }}>
                  {isLong && !isExpanded ? (
                    <div
                      style={{
                        position: "relative",
                        lineHeight: "1.4",
                        maxHeight: "2.8em",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        className="spec-value-clamped"
                        style={{
                          fontSize: "14px",
                          fontWeight: 500,
                          wordBreak: "break-word",
                          color: f.value
                            ? "var(--text-main)"
                            : "var(--text-subtle)",
                          lineHeight: "1.4",
                          paddingRight: "62px",
                        }}
                      >
                        {f.value || "—"}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleFieldExpand(f.colLetter)}
                        className="spec-expand-btn"
                        style={{
                          position: "absolute",
                          right: 0,
                          bottom: 0,
                          background: "var(--bg-card-subtle)",
                          paddingLeft: "6px",
                          lineHeight: "1.4",
                        }}
                      >
                        More ▼
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 500,
                          wordBreak: "break-word",
                          color: f.value
                            ? "var(--text-main)"
                            : "var(--text-subtle)",
                          lineHeight: "1.4",
                        }}
                      >
                        {f.value || "—"}
                      </div>
                      {isLong && isExpanded && (
                        <button
                          type="button"
                          onClick={() => toggleFieldExpand(f.colLetter)}
                          className="spec-expand-btn"
                          style={{ marginTop: "4px" }}
                        >
                          Less ▲
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Media & Drive Folder Explorer */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "24px",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              background: "var(--bg-card-subtle)",
              padding: "3px",
              borderRadius: "24px",
              border: "1px solid var(--border-color)",
            }}
          >
            <button
              type="button"
              onClick={() => setDriveViewMode("photos")}
              style={{
                border: "none",
                outline: "none",
                cursor: "pointer",
                padding: "6px 18px",
                borderRadius: "20px",
                fontSize: "13px",
                fontWeight: 600,
                transition: "all 0.2s ease",
                background:
                  driveViewMode === "photos"
                    ? "var(--btn-primary-bg)"
                    : "transparent",
                color:
                  driveViewMode === "photos" ? "#ffffff" : "var(--text-muted)",
              }}
            >
              Photos {photos.length > 0 && `(${photos.length})`}
            </button>
            <button
              type="button"
              onClick={() => setDriveViewMode("files")}
              style={{
                border: "none",
                outline: "none",
                cursor: "pointer",
                padding: "6px 18px",
                borderRadius: "20px",
                fontSize: "13px",
                fontWeight: 600,
                transition: "all 0.2s ease",
                background:
                  driveViewMode === "files"
                    ? "var(--btn-primary-bg)"
                    : "transparent",
                color:
                  driveViewMode === "files" ? "#ffffff" : "var(--text-muted)",
              }}
            >
              Files {folderFiles.length > 0 && `(${folderFiles.length})`}
            </button>
          </div>

          {folderUrl && (
            <a
              href={folderUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
              style={{
                textDecoration: "none",
                borderRadius: "16px",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              📁 Open Folder in Google Drive ↗
            </a>
          )}
        </div>

        {photosLoading ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "var(--text-muted)",
              background: "var(--bg-card-subtle)",
              borderRadius: "6px",
            }}
          >
            Loading folder contents from Google Drive...
          </div>
        ) : driveViewMode === "photos" ? (
          photos.length === 0 ? (
            <div
              style={{
                padding: "30px",
                textAlign: "center",
                color: "var(--text-subtle)",
                background: "var(--bg-card-subtle)",
                borderRadius: "6px",
              }}
            >
              {folderUrl
                ? "No photo files found in this folder."
                : "No photo folder attached to this DCR."}
            </div>
          ) : (
            <div>
              <div
                style={{
                  position: "relative",
                  background: "#0a0a0a",
                  borderRadius: "8px",
                  height: "460px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() =>
                    setActivePhotoIndex((prev) =>
                      prev > 0 ? prev - 1 : photos.length - 1,
                    )
                  }
                  style={{
                    position: "absolute",
                    left: "16px",
                    zIndex: 2,
                    background: "rgba(0,0,0,0.6)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "50%",
                    width: "40px",
                    height: "40px",
                    cursor: "pointer",
                    fontSize: "18px",
                  }}
                >
                  ◀
                </button>

                <img
                  src={`/api/drive/file/${activePhoto.id}?token=${encodeURIComponent(accessToken)}`}
                  alt={activePhoto.name}
                  onClick={() => setLightboxOpen(true)}
                  style={{
                    maxHeight: "100%",
                    maxWidth: "100%",
                    objectFit: "contain",
                    cursor: "zoom-in",
                  }}
                  title="Click to view full screen"
                />

                <button
                  onClick={() =>
                    setActivePhotoIndex((prev) =>
                      prev < photos.length - 1 ? prev + 1 : 0,
                    )
                  }
                  style={{
                    position: "absolute",
                    right: "16px",
                    zIndex: 2,
                    background: "rgba(0,0,0,0.6)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "50%",
                    width: "40px",
                    height: "40px",
                    cursor: "pointer",
                    fontSize: "18px",
                  }}
                >
                  ▶
                </button>

                <div
                  style={{
                    position: "absolute",
                    bottom: "12px",
                    background: "rgba(0,0,0,0.75)",
                    color: "#ffffff",
                    padding: "4px 14px",
                    borderRadius: "16px",
                    fontSize: "12px",
                    zIndex: 2,
                    pointerEvents: "none",
                  }}
                >
                  {activePhoto.name} ({activePhotoIndex + 1} of {photos.length})
                </div>
              </div>

              {/* Thumbnails */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  overflowX: "auto",
                  marginTop: "12px",
                  paddingBottom: "6px",
                }}
              >
                {photos.map((photo, idx) => (
                  <div
                    key={photo.id}
                    onClick={() => setActivePhotoIndex(idx)}
                    style={{
                      flexShrink: 0,
                      width: "80px",
                      height: "60px",
                      borderRadius: "4px",
                      overflow: "hidden",
                      cursor: "pointer",
                      border:
                        idx === activePhotoIndex
                          ? "2px solid var(--btn-primary-bg)"
                          : "1px solid var(--border-color)",
                      opacity: idx === activePhotoIndex ? 1 : 0.6,
                    }}
                  >
                    <img
                      src={`/api/drive/file/${photo.id}?token=${encodeURIComponent(accessToken)}`}
                      alt={photo.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        ) : folderFiles.length === 0 ? (
          <div
            style={{
              padding: "30px",
              textAlign: "center",
              color: "var(--text-subtle)",
              background: "var(--bg-card-subtle)",
              borderRadius: "6px",
            }}
          >
            No files found in this Google Drive folder.
          </div>
        ) : (
          <div
            style={{
              maxHeight: "460px",
              overflowY: "auto",
              border: "1px solid var(--border-subtle)",
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
                  background: "var(--bg-card-subtle)",
                  borderBottom: "1px solid var(--border-color)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                <tr>
                  <th style={{ padding: "10px 14px", width: "80px" }}>Type</th>
                  <th style={{ padding: "10px 14px" }}>File Name</th>
                  <th
                    style={{
                      padding: "10px 14px",
                      width: "210px",
                      textAlign: "right",
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {folderFiles.map((file) => {
                  const badge = getFileBadge(file.mimeType, file.name);
                  const isDark =
                    document.documentElement.getAttribute("data-theme") ===
                    "dark";
                  const isImg = file.mimeType?.startsWith("image/");

                  return (
                    <tr
                      key={file.id}
                      className="dcr-table-row"
                      style={{ borderBottom: "1px solid var(--border-subtle)" }}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: isDark ? badge.darkBg : badge.bg,
                            color: isDark ? badge.darkText : badge.text,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontWeight: 500,
                          color: "var(--text-main)",
                          wordBreak: "break-all",
                        }}
                      >
                        {file.name}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "8px",
                          }}
                        >
                          {isImg && (
                            <button
                              type="button"
                              onClick={() => {
                                const photoIdx = photos.findIndex(
                                  (p) => p.id === file.id,
                                );
                                if (photoIdx !== -1)
                                  setActivePhotoIndex(photoIdx);
                                setDriveViewMode("photos");
                              }}
                              className="btn-secondary"
                              style={{
                                padding: "4px 10px",
                                fontSize: "12px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              View Photo
                            </button>
                          )}
                          <a
                            href={
                              file.webViewLink ||
                              `https://drive.google.com/file/d/${file.id}/view`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary"
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              textDecoration: "none",
                              whiteSpace: "nowrap",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            Open ↗
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 4: Post-Spec Processing Fields */}
      {postSpecsFields.length > 0 && (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            marginBottom: "24px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <h3
            style={{
              margin: "0 0 12px 0",
              fontSize: "16px",
              color: "var(--text-main)",
            }}
          >
            Downstream Processing & Workday Tracking (Col Z+)
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {postSpecsFields.map((f) => {
              const rawOptions =
                dynamicDropdowns[f.colLetter] &&
                dynamicDropdowns[f.colLetter].length > 0
                  ? dynamicDropdowns[f.colLetter]
                  : propDropdownOptions &&
                      propDropdownOptions[f.colLetter] &&
                      propDropdownOptions[f.colLetter].length > 0
                    ? propDropdownOptions[f.colLetter]
                    : DROPDOWN_FIELD_OPTIONS[f.colLetter];

              const currentValue = formValues[f.colLetter] ?? "";

              let dropdownOptions = null;
              if (rawOptions && rawOptions.length > 0) {
                dropdownOptions = [...rawOptions];
                if (currentValue && !dropdownOptions.includes(currentValue)) {
                  dropdownOptions.unshift(currentValue);
                }
              }

              return (
                <div
                  key={f.colLetter}
                  style={{
                    background: "var(--bg-card-subtle)",
                    padding: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontWeight: 600,
                      fontSize: "13px",
                      marginBottom: "6px",
                      color: "var(--text-main)",
                    }}
                  >
                    <span>
                      {f.header} ({f.colLetter})
                    </span>
                    <FieldIndicator status={fieldStatuses[f.colLetter]} />
                  </label>

                  {dropdownOptions ? (
                    <select
                      className="dcr-select"
                      value={currentValue}
                      onChange={(e) =>
                        handleFieldChange(f.colLetter, e.target.value)
                      }
                      style={{ width: "100%" }}
                    >
                      <option value="">- Select -</option>
                      {dropdownOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="dcr-input"
                      value={currentValue}
                      onChange={(e) =>
                        handleFieldChange(f.colLetter, e.target.value)
                      }
                      style={{ width: "100%" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 5: Dedicated Full-Width Comments (Column AR) */}
      {commentsField && (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "16px 20px",
            marginBottom: "24px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "16px",
                color: "var(--text-main)",
                display: "flex",
                alignItems: "center",
              }}
            >
              {commentsField.header || "Comments"} ({commentsField.colLetter})
              <FieldIndicator status={fieldStatuses[commentsField.colLetter]} />
            </h3>
          </div>

          <textarea
            rows={5}
            className="dcr-textarea"
            value={formValues[commentsField.colLetter] ?? ""}
            onChange={(e) =>
              handleFieldChange(commentsField.colLetter, e.target.value)
            }
            placeholder="Enter review remarks, coordinator notes, or reason for status update..."
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {lightboxOpen && activePhoto && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "95vw",
              maxHeight: "95vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "10px",
              }}
            >
              <a
                href={
                  activePhoto.webViewLink ||
                  `https://drive.google.com/file/d/${activePhoto.id}/view`
                }
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "#ffffff",
                  textDecoration: "underline",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Open Original in Drive ↗
              </a>
              <button
                onClick={() => setLightboxOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "24px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <img
              src={`/api/drive/file/${activePhoto.id}?token=${encodeURIComponent(accessToken)}`}
              alt={activePhoto.name}
              style={{
                maxWidth: "100%",
                maxHeight: "85vh",
                objectFit: "contain",
                borderRadius: "4px",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}