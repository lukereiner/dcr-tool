import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AuthContext } from "../App";
import { useToast } from "../context/ToastContext";

function extractDriveFolderId(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/folders\/([a-zA-Z0-9_-]{25,})/);
  return match ? match[1] : null;
}

function ButtonSpinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        border: "2px solid rgba(255, 255, 255, 0.4)",
        borderTop: "2px solid #ffffff",
        borderRadius: "50%",
        animation: "btnSpin 0.7s linear infinite",
      }}
    />
  );
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
  const [savingField, setSavingField] = useState(null);
  const [dynamicDropdowns, setDynamicDropdowns] = useState(
    propDropdownOptions || {},
  );

  // Track expanded state for Section 2 spec cards
  const [expandedFields, setExpandedFields] = useState({});

  const [photos, setPhotos] = useState([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");

  const toggleFieldExpand = (colLetter) => {
    setExpandedFields((prev) => ({
      ...prev,
      [colLetter]: !prev[colLetter],
    }));
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
      const res = await fetch(`/api/drive/folder/${folderId}/images`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.files) {
        setPhotos(data.files);
        setActivePhotoIndex(0);
      }
    } catch (err) {
      console.error("Failed to load folder images:", err);
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

  // Update dynamic dropdowns if props change
  useEffect(() => {
    if (propDropdownOptions) {
      setDynamicDropdowns((prev) => ({ ...prev, ...propDropdownOptions }));
    }
  }, [propDropdownOptions]);

  const handleSaveField = async (colLetter, colHeader, colIndex) => {
    if (!dcrData) return;
    const value = formValues[colLetter] ?? "";
    setSavingField(colLetter);

    try {
      const res = await fetch(`/api/dcr/${encodeURIComponent(dcrId)}/cell`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ colLetter, value }),
      });

      if (res.status === 401) {
        logout(true);
        return;
      }

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      showToast(`Saved ${colHeader} (${result.cell}) successfully!`, "success");
      if (onRecordUpdated) {
        onRecordUpdated(dcrData.sheetRowNumber, colIndex, value);
      }
    } catch (err) {
      showToast(`Failed to save ${colHeader}: ${err.message}`, "error");
    } finally {
      setSavingField(null);
    }
  };

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


        /* Header clamped to exactly 2 lines max with ellipsis */
        .spec-header-clamped {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.35;
          height: 2.7em;
        }


        /* Value clamped to 2 lines max when collapsed */
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
        <button onClick={() => navigate("/coordinator")} className="btn-secondary">
          ← Back to All Records
        </button>
        <span style={{ fontSize: "13px", color: "var(--text-subtle)" }}>
          Sheet Row #{dcrData.sheetRowNumber}
        </span>
      </div>

      {/* Header Banner */}
      <div
        style={{
          background: "var(--btn-primary-bg)",
          color: "#ffffff",
          padding: "16px 20px",
          borderRadius: "8px",
          marginBottom: "24px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "24px" }}>{dcrId}</h1>
        <p style={{ margin: "4px 0 0 0", opacity: 0.9, fontSize: "14px" }}>
          Cable Replacement Review & Operational Workspace
        </p>
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
          {managerSignOffs.map((f) => {
            const isSaving = savingField === f.colLetter;
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
                    display: "block",
                    fontWeight: 600,
                    fontSize: "13px",
                    marginBottom: "6px",
                    color: "var(--text-main)",
                  }}
                >
                  {f.header} ({f.colLetter})
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    className="dcr-input"
                    value={formValues[f.colLetter] ?? ""}
                    onChange={(e) =>
                      setFormValues({
                        ...formValues,
                        [f.colLetter]: e.target.value,
                      })
                    }
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={() =>
                      handleSaveField(f.colLetter, f.header, f.colIndex)
                    }
                    disabled={isSaving}
                    className="btn-primary"
                    style={{ minWidth: "72px" }}
                  >
                    {isSaving ? <ButtonSpinner /> : "Save"}
                  </button>
                </div>
              </div>
            );
          })}
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
                {/* Top-pinned Column Label (Max 2 lines with ellipsis) */}
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

                {/* Bottom-pinned Value Block */}
                <div style={{ marginTop: "auto" }}>
                  {isLong && !isExpanded ? (
                    /* Collapsed: 2-line max with 'More ▼' anchored on line 2 */
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
                    /* Normal or Expanded State */
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

      {/* Section 3: Dedicated Inspection Photo Carousel */}
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
          <div>
            <h3
              style={{ margin: 0, fontSize: "16px", color: "var(--text-main)" }}
            >
              Inspection Photos (Cols U, V, W)
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {photos.length > 0
                ? `${photos.length} photos loaded from submitted folder`
                : "Drive Folder Inspection Gallery"}
            </span>
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
            Scanning Drive folder for inspection photos...
          </div>
        ) : photos.length === 0 ? (
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
              ? "No image files detected in this folder link."
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
              const isSaving = savingField === f.colLetter;

              // Resolve options: dynamic response -> app prop -> default fallback
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

              // If options exist, guarantee any historical saved value is preserved as an option
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
                      display: "block",
                      fontWeight: 600,
                      fontSize: "13px",
                      marginBottom: "6px",
                      color: "var(--text-main)",
                    }}
                  >
                    {f.header} ({f.colLetter})
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {dropdownOptions ? (
                      <select
                        className="dcr-select"
                        value={currentValue}
                        onChange={(e) =>
                          setFormValues({
                            ...formValues,
                            [f.colLetter]: e.target.value,
                          })
                        }
                        style={{ flex: 1 }}
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
                          setFormValues({
                            ...formValues,
                            [f.colLetter]: e.target.value,
                          })
                        }
                        style={{ flex: 1 }}
                      />
                    )}

                    <button
                      onClick={() =>
                        handleSaveField(f.colLetter, f.header, f.colIndex)
                      }
                      disabled={isSaving}
                      className="btn-primary"
                      style={{ minWidth: "72px" }}
                    >
                      {isSaving ? <ButtonSpinner /> : "Save"}
                    </button>
                  </div>
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
              style={{ margin: 0, fontSize: "16px", color: "var(--text-main)" }}
            >
              {commentsField.header || "Comments"} ({commentsField.colLetter})
            </h3>
          </div>

          <textarea
            rows={5}
            className="dcr-textarea"
            value={formValues[commentsField.colLetter] ?? ""}
            onChange={(e) =>
              setFormValues({
                ...formValues,
                [commentsField.colLetter]: e.target.value,
              })
            }
            placeholder="Enter review remarks, coordinator notes, or reason for status update..."
            style={{ width: "100%", marginBottom: "12px", resize: "vertical" }}
          />

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() =>
                handleSaveField(
                  commentsField.colLetter,
                  commentsField.header,
                  commentsField.colIndex,
                )
              }
              disabled={savingField === commentsField.colLetter}
              className="btn-primary"
              style={{
                minWidth: "120px",
                padding: "8px 20px",
                fontWeight: 600,
              }}
            >
              {savingField === commentsField.colLetter ? (
                <ButtonSpinner />
              ) : (
                "Save Comments"
              )}
            </button>
          </div>
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
