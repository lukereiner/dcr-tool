import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AuthContext } from "../App";
import { useToast } from "../context/ToastContext";

function extractDriveFolderId(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/folders\/([a-zA-Z0-9_-]{25,})/);
  return match ? match[1] : null;
}

function decodeHtmlEntities(text) {
  if (!text || typeof text !== "string") return "";
  const txt = document.createElement("textarea");
  txt.innerHTML = text;
  return txt.value;
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

const FORM_RESPONSE_DROPDOWN_FALLBACKS = {
  E: ["Cleveland", "Columbus"],
  H: ["Yes", "No"],
  I: ["N/A", "1", "2", "3", "4", "5", "6", "7"],
  J: [
    "Cut or Damaged",
    "Noise / Microreflection",
    "Cable Not Meeting Spec",
    "Long Drop Eliminator",
    "Print Update Only",
  ],
  Q: ["Aerial", "Underground", "Both"],
  R: ["Coax", "Fiber", "Both"],
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

// Auto-expanding compact textarea (starts at 1 line and expands as text grows)
function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  isExpanded,
  onToggleExpand,
  className = "dcr-input",
  style = {},
}) {
  const textareaRef = useRef(null);
  const [needsExpand, setNeedsExpand] = useState(false);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Measure full natural content height
    el.style.height = "auto";
    const fullHeight = el.scrollHeight;

    // Two lines at 13px * 1.4 line-height (~36px) + 14px vertical padding = ~50px
    const twoLineMaxHeight = 52;
    const isOverflowing = fullHeight > twoLineMaxHeight + 4;
    setNeedsExpand(isOverflowing);

    if (isExpanded) {
      el.style.height = `${Math.max(38, fullHeight)}px`;
      el.style.overflowY = "hidden";
    } else if (isOverflowing) {
      el.style.height = `${twoLineMaxHeight}px`;
      el.style.overflowY = "hidden";
    } else {
      // Single-line content stays at exact 38px to align with inputs and dropdowns
      el.style.height = `${Math.max(38, fullHeight)}px`;
      el.style.overflowY = "hidden";
    }
  }, [isExpanded]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, isExpanded, adjustHeight]);

  useEffect(() => {
    window.addEventListener("resize", adjustHeight);
    return () => window.removeEventListener("resize", adjustHeight);
  }, [adjustHeight]);

  return (
    <div>
      <textarea
        ref={textareaRef}
        rows={1}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e);
          adjustHeight();
        }}
        style={{
          width: "100%",
          minHeight: "38px",
          padding: "7px 10px",
          fontSize: "13px",
          lineHeight: "1.4",
          margin: 0,
          resize: "none",
          fontFamily: "inherit",
          boxSizing: "border-box",
          display: "block",
          ...style,
        }}
      />
      {needsExpand && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "4px",
          }}
        >
          <button
            type="button"
            onClick={onToggleExpand}
            className="spec-expand-btn"
          >
            {isExpanded ? "Less ▲" : "More ▼"}
          </button>
        </div>
      )}
    </div>
  );
}

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
        flexShrink: 0,
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

function AutoSaveHeaderStatus({ status, onRetry }) {
  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    fontWeight: 500,
    padding: "6px 14px",
    borderRadius: "20px",
    transition: "all 0.2s ease",
  };

  return (
    <>
      <style>{`
        .autosave-pill {
          background: var(--bg-card);
          color: var(--text-main);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-card, 0 1px 3px rgba(0, 0, 0, 0.05));
        }
        .autosave-pill .pill-text {
          color: var(--text-muted);
        }
        .autosave-pill .check-icon {
          color: #16a34a;
        }
        .autosave-pill .dirty-dot {
          background: #eab308;
          box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.2);
        }

        [data-theme='dark'] .autosave-pill {
          background: #1e2530;
          border: 1px solid #3b4554;
          box-shadow: 0 0 8px rgba(0, 0, 0, 0.35);
        }
        [data-theme='dark'] .autosave-pill .pill-text {
          color: #e2e8f0;
        }
        [data-theme='dark'] .autosave-pill .check-icon {
          color: #4ade80;
        }
        [data-theme='dark'] .autosave-pill .dirty-dot {
          background: #facc15;
          box-shadow: 0 0 6px rgba(250, 204, 21, 0.5);
        }
        [data-theme='dark'] .autosave-pill-error {
          background: rgba(239, 68, 68, 0.2) !important;
          border-color: rgba(239, 68, 68, 0.6) !important;
        }
        [data-theme='dark'] .autosave-pill-error .error-text {
          color: #fca5a5 !important;
        }
      `}</style>

      {status === "saving" && (
        <div className="autosave-pill" style={baseStyle}>
          <span
            style={{
              display: "inline-block",
              width: "12px",
              height: "12px",
              border: "2px solid rgba(96, 165, 250, 0.3)",
              borderTop: "2px solid #60a5fa",
              borderRadius: "50%",
              animation: "btnSpin 0.7s linear infinite",
            }}
          />
          <span className="pill-text">Saving changes...</span>
        </div>
      )}

      {status === "dirty" && (
        <div className="autosave-pill" style={baseStyle}>
          <span
            className="dirty-dot"
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              display: "inline-block",
            }}
          />
          <span className="pill-text">Unsaved changes</span>
        </div>
      )}

      {status === "error" && (
        <div
          className="autosave-pill autosave-pill-error"
          style={{
            ...baseStyle,
            background: "rgba(239, 68, 68, 0.1)",
            borderColor: "rgba(239, 68, 68, 0.35)",
          }}
        >
          <span
            className="error-text"
            style={{ color: "#ef4444", fontWeight: 600 }}
          >
            ⚠️ Auto-save failed
          </span>
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
      )}

      {(status === "idle" || status === "saved" || !status) && (
        <div className="autosave-pill" style={baseStyle}>
          <span
            className="check-icon"
            style={{
              fontSize: "14px",
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            ✓
          </span>
          <span className="pill-text">All changes saved</span>
        </div>
      )}
    </>
  );
}

// Reusable Inline Comment Composer (New, Reply, or Edit)
function InlineCommentComposer({
  initialValue = "",
  placeholder = "Add a comment...",
  buttonText = "Save",
  onSave,
  onCancel,
  autoFocus = true,
}) {
  const [text, setText] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await onSave(text.trim());
    setSubmitting(false);
    setText("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginTop: "8px",
      }}
    >
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        style={{
          width: "100%",
          fontSize: "13px",
          padding: "8px 10px",
          borderRadius: "6px",
          border: "1px solid var(--border-color)",
          background: "var(--bg-input)",
          color: "var(--text-main)",
          outline: "none",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              background: "none",
              border: "none",
              fontSize: "12px",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="btn-primary"
          style={{
            fontSize: "12px",
            padding: "4px 12px",
            borderRadius: "4px",
          }}
        >
          {submitting ? "..." : buttonText}
        </button>
      </div>
    </form>
  );
}

// Cell Comment Marker (Amber Triangle + Hover/Pin Popover)
function CellCommentMarker({
  colLetter,
  colHeaderName,
  comment,
  commentsDrawerOpen,
  isPinned,
  isPreview,
  onTriangleClick,
  onMouseEnter,
  onMouseLeave,
  onClose,
  onReply,
  onResolve,
}) {
  const [isReplying, setIsReplying] = useState(false);
  const popoverRef = useRef(null);

  const isVisible = (isPreview || isPinned) && !commentsDrawerOpen;

  return (
    <div
      style={{ position: "absolute", top: 0, right: 0, zIndex: 12 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="cell-comment-triangle"
        onClick={onTriangleClick}
        title={
          commentsDrawerOpen
            ? "Click to focus in sidebar"
            : isPinned
              ? "Click to unpin"
              : "Click to pin comment card"
        }
      />

      {isVisible && comment && (
        <div
          ref={popoverRef}
          className="cell-comment-popover"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
              paddingBottom: "6px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: "var(--btn-primary-bg)",
                fontSize: "12px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "200px",
              }}
              title={colHeaderName}
            >
              {colHeaderName}
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                onClick={() => onResolve(comment.commentId, comment.resolved)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 6px",
                  fontSize: "11px",
                  color: "#16a34a",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Resolve
              </button>
              {isPinned && (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "14px",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    padding: "0 2px",
                  }}
                  title="Close card"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {comment.plainTextQuote && (
            <div
              style={{
                fontSize: "11px",
                fontStyle: "italic",
                color: "var(--text-subtle)",
                marginBottom: "6px",
                borderLeft: "2px solid var(--border-color)",
                paddingLeft: "6px",
              }}
            >
              "{decodeHtmlEntities(comment.plainTextQuote)}"
            </div>
          )}

          <div
            style={{
              color: "var(--text-main)",
              fontSize: "13px",
              lineHeight: "1.4",
              marginBottom: "6px",
              wordBreak: "break-word",
            }}
          >
            {decodeHtmlEntities(comment.text)}
          </div>

          <div
            style={{
              fontSize: "11px",
              color: "var(--text-subtle)",
              marginBottom: "8px",
            }}
          >
            — {comment.authorName || comment.authorEmail}
            {comment.timestamp &&
              ` • ${new Date(comment.timestamp).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })}`}
          </div>

          {comment.replies && comment.replies.length > 0 && (
            <div
              style={{
                borderLeft: "2px solid var(--border-color)",
                paddingLeft: "8px",
                margin: "6px 0 8px 0",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                maxHeight: "140px",
                overflowY: "auto",
              }}
            >
              {comment.replies.map((rep) => (
                <div key={rep.replyId} style={{ fontSize: "12px" }}>
                  <strong
                    style={{
                      color: "var(--btn-primary-bg)",
                      marginRight: "6px",
                    }}
                  >
                    {rep.authorName}:
                  </strong>
                  <span style={{ color: "var(--text-main)" }}>
                    {decodeHtmlEntities(rep.text)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!isReplying ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "6px",
                paddingTop: "6px",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <button
                type="button"
                onClick={() => setIsReplying(true)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontSize: "11px",
                  color: "var(--text-subtle)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Reply...
              </button>
              <a
                href={comment.openInSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "11px",
                  color: "var(--btn-primary-bg)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Open in Sheet ↗
              </a>
            </div>
          ) : (
            <InlineCommentComposer
              placeholder="Reply..."
              buttonText="Reply"
              onSave={async (text) => {
                await onReply(comment.commentId, text);
                setIsReplying(false);
              }}
              onCancel={() => setIsReplying(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function DCRReview({
  onRecordUpdated,
  dropdownOptions: propDropdownOptions,
}) {
  const { dcrId } = useParams();
  const navigate = useNavigate();
  const { accessToken, logout, refreshSignal, activeRegion, userProfile } =
    useContext(AuthContext);
  const { showToast } = useToast();

  const [dcrData, setDcrData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Main sheet ('Cable Replacement') form values
  const [formValues, setFormValues] = useState({});
  // Source-of-truth sheet ('DCR Form Responses') form values
  const [formResponseValues, setFormResponseValues] = useState({});
  const [formResponseDropdowns, setFormResponseDropdowns] = useState(
    FORM_RESPONSE_DROPDOWN_FALLBACKS,
  );

  const [dynamicDropdowns, setDynamicDropdowns] = useState(
    propDropdownOptions || {},
  );
  const [formLinks, setFormLinks] = useState({
    evalFormUrl: "",
    qcFormUrl: "",
  });

  const [comments, setComments] = useState([]);
  const [commentsDrawerOpen, setCommentsDrawerOpen] = useState(false);
  const [showResolvedComments, setShowResolvedComments] = useState(false);

  // Floating Popover States (Hover Preview & Pinning)
  const [hoveredCommentCol, setHoveredCommentCol] = useState(null);
  const [pinnedCommentCol, setPinnedCommentCol] = useState(null);
  const hoverTimeoutRef = useRef(null);

  // States for Sidebar Inline Composers
  const [draftTarget, setDraftTarget] = useState(null);
  const [activeReplyBoxId, setActiveReplyBoxId] = useState(null);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingReplyId, setEditingReplyId] = useState(null);

  // Dirty tracking for 'Cable Replacement'
  const [dirtyFields, setDirtyFields] = useState(new Set());
  const [fieldStatuses, setFieldStatuses] = useState({});

  // Dirty tracking for 'DCR Form Responses'
  const [dirtyFormResponseFields, setDirtyFormResponseFields] = useState(
    new Set(),
  );
  const [formResponseFieldStatuses, setFormResponseFieldStatuses] = useState(
    {},
  );

  const [globalStatus, setGlobalStatus] = useState("idle");

  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;

  const dirtyFieldsRef = useRef(dirtyFields);
  dirtyFieldsRef.current = dirtyFields;

  const formResponseValuesRef = useRef(formResponseValues);
  formResponseValuesRef.current = formResponseValues;

  const dirtyFormResponseFieldsRef = useRef(dirtyFormResponseFields);
  dirtyFormResponseFieldsRef.current = dirtyFormResponseFields;

  const debounceTimerRef = useRef(null);
  const fadeTimersRef = useRef({});
  const inFlightSnapshotRef = useRef(null);

  const [expandedFields, setExpandedFields] = useState({});

  const [contractorDropdownOpen, setContractorDropdownOpen] = useState(false);
  const contractorDropdownRef = useRef(null);

  const [photos, setPhotos] = useState([]);
  const [folderFiles, setFolderFiles] = useState([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");

  // Drag and Drop & Uploading States
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const dragCounterRef = useRef(0);

  // File Delete Confirmation Modal States
  const [fileToDelete, setFileToDelete] = useState(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && fileToDelete && !isDeletingFile) {
        setFileToDelete(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fileToDelete, isDeletingFile]);

  const [driveViewMode, setDriveViewMode] = useState(() => {
    return localStorage.getItem("dcr_drive_view_mode") || "photos";
  });

  useEffect(() => {
    localStorage.setItem("dcr_drive_view_mode", driveViewMode);
  }, [driveViewMode]);

  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (
        pinnedCommentCol &&
        !e.target.closest(".cell-comment-popover") &&
        !e.target.closest(".cell-comment-triangle")
      ) {
        setPinnedCommentCol(null);
      }
      if (
        contractorDropdownRef.current &&
        !contractorDropdownRef.current.contains(e.target)
      ) {
        setContractorDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleGlobalClick);
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, [pinnedCommentCol]);

  const toggleFieldExpand = (colLetter) => {
    setExpandedFields((prev) => ({
      ...prev,
      [colLetter]: !prev[colLetter],
    }));
  };

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (
        dirtyFieldsRef.current.size > 0 ||
        dirtyFormResponseFieldsRef.current.size > 0 ||
        inFlightSnapshotRef.current !== null
      ) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const executeBatchSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const currentDirtyMain = dirtyFieldsRef.current;
    const currentDirtyResp = dirtyFormResponseFieldsRef.current;

    if (
      (currentDirtyMain.size === 0 && currentDirtyResp.size === 0) ||
      !dcrData
    ) {
      return;
    }

    const mainSnapshot = {};
    currentDirtyMain.forEach((colLetter) => {
      mainSnapshot[colLetter] = formValuesRef.current[colLetter] ?? "";
    });

    const respSnapshot = {};
    currentDirtyResp.forEach((colLetter) => {
      respSnapshot[colLetter] = formResponseValuesRef.current[colLetter] ?? "";
    });

    inFlightSnapshotRef.current = { mainSnapshot, respSnapshot };
    setGlobalStatus("saving");

    if (currentDirtyMain.size > 0) {
      setFieldStatuses((prev) => {
        const next = { ...prev };
        currentDirtyMain.forEach((colLetter) => {
          next[colLetter] = "saving";
        });
        return next;
      });
    }

    if (currentDirtyResp.size > 0) {
      setFormResponseFieldStatuses((prev) => {
        const next = { ...prev };
        currentDirtyResp.forEach((colLetter) => {
          next[colLetter] = "saving";
        });
        return next;
      });
    }

    try {
      const res = await fetch(`/api/dcr/${encodeURIComponent(dcrId)}/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          updates: mainSnapshot,
          formResponseUpdates: respSnapshot,
          region: activeRegion?.id,
        }),
      });

      if (res.status === 401) {
        logout(true);
        return;
      }

      const result = await res.json();
      const mainSucceeded = res.ok || result.mainSaved === true;
      const respSucceeded = res.ok || result.formRespSaved === true;

      if (mainSucceeded && Object.keys(mainSnapshot).length > 0) {
        if (onRecordUpdated && dcrData.fields) {
          Object.entries(mainSnapshot).forEach(([colLetter, val]) => {
            const fieldDef = dcrData.fields.find(
              (f) => f.colLetter === colLetter,
            );
            if (fieldDef) {
              onRecordUpdated(dcrData.sheetRowNumber, fieldDef.colIndex, val);
            }
          });
        }

        setDirtyFields((prevDirty) => {
          const nextDirty = new Set(prevDirty);
          const resolvedCols = [];

          Object.keys(mainSnapshot).forEach((colLetter) => {
            if (formValuesRef.current[colLetter] === mainSnapshot[colLetter]) {
              nextDirty.delete(colLetter);
              resolvedCols.push(colLetter);
            }
          });

          setFieldStatuses((prevStatuses) => {
            const nextStatuses = { ...prevStatuses };
            resolvedCols.forEach((colLetter) => {
              nextStatuses[colLetter] = "saved";
              const timerKey = `main_${colLetter}`;
              if (fadeTimersRef.current[timerKey]) {
                clearTimeout(fadeTimersRef.current[timerKey]);
              }
              fadeTimersRef.current[timerKey] = setTimeout(() => {
                setFieldStatuses((curr) =>
                  curr[colLetter] === "saved"
                    ? { ...curr, [colLetter]: "idle" }
                    : curr,
                );
              }, 2500);
            });
            return nextStatuses;
          });

          return nextDirty;
        });
      } else if (!mainSucceeded && Object.keys(mainSnapshot).length > 0) {
        setFieldStatuses((prev) => {
          const next = { ...prev };
          Object.keys(mainSnapshot).forEach((colLetter) => {
            next[colLetter] = "error";
          });
          return next;
        });
      }

      if (respSucceeded && Object.keys(respSnapshot).length > 0) {
        if (onRecordUpdated && dcrData.fields) {
          Object.entries(respSnapshot).forEach(([colLetter, val]) => {
            if (colLetter !== "B" && colLetter !== "W") {
              const fieldDef = dcrData.fields.find(
                (f) => f.colLetter === colLetter,
              );
              if (fieldDef) {
                onRecordUpdated(dcrData.sheetRowNumber, fieldDef.colIndex, val);
              }
            }
          });
        }

        setDirtyFormResponseFields((prevDirty) => {
          const nextDirty = new Set(prevDirty);
          const resolvedCols = [];

          Object.keys(respSnapshot).forEach((colLetter) => {
            if (
              formResponseValuesRef.current[colLetter] ===
              respSnapshot[colLetter]
            ) {
              nextDirty.delete(colLetter);
              resolvedCols.push(colLetter);
            }
          });

          setFormResponseFieldStatuses((prevStatuses) => {
            const nextStatuses = { ...prevStatuses };
            resolvedCols.forEach((colLetter) => {
              nextStatuses[colLetter] = "saved";
              const timerKey = `resp_${colLetter}`;
              if (fadeTimersRef.current[timerKey]) {
                clearTimeout(fadeTimersRef.current[timerKey]);
              }
              fadeTimersRef.current[timerKey] = setTimeout(() => {
                setFormResponseFieldStatuses((curr) =>
                  curr[colLetter] === "saved"
                    ? { ...curr, [colLetter]: "idle" }
                    : curr,
                );
              }, 2500);
            });
            return nextStatuses;
          });

          return nextDirty;
        });
      } else if (!respSucceeded && Object.keys(respSnapshot).length > 0) {
        setFormResponseFieldStatuses((prev) => {
          const next = { ...prev };
          Object.keys(respSnapshot).forEach((colLetter) => {
            next[colLetter] = "error";
          });
          return next;
        });
      }

      if (!res.ok) {
        throw new Error(result.error || "Batch update failed");
      }

      setGlobalStatus("saved");
    } catch (err) {
      console.error("Auto-save error:", err);
      setGlobalStatus("error");
      showToast(`Auto-save error: ${err.message}`, "error");
    } finally {
      inFlightSnapshotRef.current = null;
    }
  }, [
    dcrData,
    dcrId,
    accessToken,
    logout,
    onRecordUpdated,
    showToast,
    activeRegion?.id,
  ]);

  useEffect(() => {
    const handleOnline = () => {
      if (
        dirtyFieldsRef.current.size > 0 ||
        dirtyFormResponseFieldsRef.current.size > 0
      ) {
        executeBatchSave();
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [executeBatchSave]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      Object.values(fadeTimersRef.current).forEach((t) => clearTimeout(t));
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  // Handler for 'Cable Replacement' editable fields
  const handleFieldChange = (colLetter, value) => {
    setFormValues((prev) => ({
      ...prev,
      [colLetter]: value,
    }));

    setDirtyFields((prev) => {
      const next = new Set(prev);
      next.add(colLetter);
      return next;
    });

    const timerKey = `main_${colLetter}`;
    if (fadeTimersRef.current[timerKey]) {
      clearTimeout(fadeTimersRef.current[timerKey]);
      delete fadeTimersRef.current[timerKey];
    }

    setFieldStatuses((prev) => ({
      ...prev,
      [colLetter]: "dirty",
    }));

    setGlobalStatus("dirty");

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      executeBatchSave();
    }, 3000);
  };

  // Handler for 'DCR Form Responses' editable fields (Cols B..W)
  const handleFormResponseChange = (colLetter, value) => {
    setFormResponseValues((prev) => ({
      ...prev,
      [colLetter]: value,
    }));

    setDirtyFormResponseFields((prev) => {
      const next = new Set(prev);
      next.add(colLetter);
      return next;
    });

    const timerKey = `resp_${colLetter}`;
    if (fadeTimersRef.current[timerKey]) {
      clearTimeout(fadeTimersRef.current[timerKey]);
      delete fadeTimersRef.current[timerKey];
    }

    setFormResponseFieldStatuses((prev) => ({
      ...prev,
      [colLetter]: "dirty",
    }));

    setGlobalStatus("dirty");

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      executeBatchSave();
    }, 3000);
  };

  const handleContractorToggle = (colLetter, contractorName) => {
    const currentVal = formValues[colLetter] ?? "";
    const list = currentVal
      ? currentVal
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    let updated;
    if (list.includes(contractorName)) {
      updated = list.filter((c) => c !== contractorName);
    } else {
      updated = [...list, contractorName];
    }

    handleFieldChange(colLetter, updated.join(", "));
  };

  const handleHighlightField = (colLetter) => {
    const el = document.getElementById(`field-card-${colLetter}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("field-highlight-pulse");
      void el.offsetWidth;
      el.classList.add("field-highlight-pulse");
    } else {
      showToast(
        `Field Column ${colLetter} is not visible in current review layout`,
        "info",
      );
    }
  };

  const handleInitiateNewComment = (colLetter, colHeaderName) => {
    setCommentsDrawerOpen(true);
    setDraftTarget({ colLetter, colHeaderName });
    const sidebar = document.getElementById("comments-sidebar");
    if (sidebar) sidebar.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleTriangleClick = (e, colLetter, activeComment) => {
    e.stopPropagation();
    if (commentsDrawerOpen) {
      const el = document.getElementById(
        `sidebar-comment-${activeComment.commentId}`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("field-highlight-pulse");
        void el.offsetWidth;
        el.classList.add("field-highlight-pulse");
      }
      setActiveReplyBoxId(activeComment.commentId);
    } else {
      setPinnedCommentCol((prev) => (prev === colLetter ? null : colLetter));
    }
  };

  const handleTriangleMouseEnter = (colLetter) => {
    if (commentsDrawerOpen) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredCommentCol(colLetter);
  };

  const handleTriangleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCommentCol(null);
    }, 250);
  };

  // --- Drag and Drop File Handlers ---
  const handleFilesDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleFilesDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  };

  const handleFilesDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFilesDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounterRef.current = 0;

    const folderId = extractDriveFolderId(folderUrl);
    if (!folderId) {
      showToast(
        "No Google Drive folder link associated with this DCR record",
        "error",
      );
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await uploadFilesToDrive(folderId, Array.from(e.dataTransfer.files));
    }
  };

  const uploadFilesToDrive = async (folderId, filesToUpload) => {
    setIsUploadingFiles(true);
    try {
      const formData = new FormData();
      filesToUpload.forEach((file) => {
        formData.append("files", file);
      });

      const res = await fetch(`/api/drive/folder/${folderId}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload file(s)");

      showToast(
        `Uploaded ${filesToUpload.length} file(s) to Google Drive`,
        "success",
      );
      await fetchFolderPhotos(folderId);
    } catch (err) {
      console.error("Upload error:", err);
      showToast(`Upload failed: ${err.message}`, "error");
    } finally {
      setIsUploadingFiles(false);
    }
  };

  const confirmDeleteDriveFile = async () => {
    if (!fileToDelete) return;
    const targetFile = fileToDelete;
    const folderId = extractDriveFolderId(folderUrl);

    setIsDeletingFile(true);
    try {
      const res = await fetch(`/api/drive/file/${targetFile.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to move file to trash");

      showToast(`"${targetFile.name}" moved to Google Drive trash`, "success");
      setFileToDelete(null);
      if (folderId) {
        await fetchFolderPhotos(folderId);
      }
    } catch (err) {
      console.error("Delete file error:", err);
      showToast(`Failed to delete file: ${err.message}`, "error");
    } finally {
      setIsDeletingFile(false);
    }
  };

  // --- Comment API Actions ---
  const handlePostNewThread = async (text) => {
    if (!draftTarget) return;
    try {
      const res = await fetch(`/api/dcr/${encodeURIComponent(dcrId)}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          colLetter: draftTarget.colLetter,
          text,
          sheetRowNumber: dcrData?.sheetRowNumber,
          sheetId: dcrData?.sheetId,
          region: activeRegion?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      setDraftTarget(null);
      showToast("Comment posted to Google Sheets", "success");
    } catch (err) {
      showToast(`Failed to post comment: ${err.message}`, "error");
    }
  };

  const handlePostReply = async (commentId, text) => {
    try {
      const res = await fetch(
        `/api/dcr/${encodeURIComponent(dcrId)}/comment/${encodeURIComponent(commentId)}/reply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            text,
            sheetRowNumber: dcrData?.sheetRowNumber,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      setActiveReplyBoxId(null);
      showToast("Reply posted", "success");
    } catch (err) {
      showToast(`Failed to post reply: ${err.message}`, "error");
    }
  };

  const handleEditThread = async (commentId, text) => {
    try {
      const res = await fetch(
        `/api/dcr/${encodeURIComponent(dcrId)}/comment/${encodeURIComponent(commentId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            text,
            sheetRowNumber: dcrData?.sheetRowNumber,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      setEditingCommentId(null);
      showToast("Comment updated", "success");
    } catch (err) {
      showToast(`Failed to update comment: ${err.message}`, "error");
    }
  };

  const handleEditReply = async (commentId, replyId, text) => {
    try {
      const res = await fetch(
        `/api/dcr/${encodeURIComponent(dcrId)}/comment/${encodeURIComponent(commentId)}/reply/${encodeURIComponent(replyId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            text,
            sheetRowNumber: dcrData?.sheetRowNumber,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      setEditingReplyId(null);
      showToast("Reply updated", "success");
    } catch (err) {
      showToast(`Failed to update reply: ${err.message}`, "error");
    }
  };

  const handleDeleteThread = async (commentId) => {
    if (
      !window.confirm(
        "Delete this comment thread and all replies from Google Sheets?",
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/dcr/${encodeURIComponent(dcrId)}/comment/${encodeURIComponent(commentId)}?sheetRowNumber=${dcrData?.sheetRowNumber}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      showToast("Thread deleted", "success");
    } catch (err) {
      showToast(`Failed to delete thread: ${err.message}`, "error");
    }
  };

  const handleDeleteReply = async (commentId, replyId) => {
    if (!window.confirm("Delete this reply?")) return;
    try {
      const res = await fetch(
        `/api/dcr/${encodeURIComponent(dcrId)}/comment/${encodeURIComponent(commentId)}/reply/${encodeURIComponent(replyId)}?sheetRowNumber=${dcrData?.sheetRowNumber}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      showToast("Reply deleted", "success");
    } catch (err) {
      showToast(`Failed to delete reply: ${err.message}`, "error");
    }
  };

  const handleToggleResolve = async (commentId, currentResolvedStatus) => {
    try {
      const res = await fetch(
        `/api/dcr/${encodeURIComponent(dcrId)}/comment/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            commentId,
            resolved: !currentResolvedStatus,
            sheetRowNumber: dcrData?.sheetRowNumber,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(data.comments || []);
      setPinnedCommentCol(null);
      showToast(
        !currentResolvedStatus ? "Thread resolved" : "Thread reopened",
        "success",
      );
    } catch (err) {
      showToast(`Failed to update status: ${err.message}`, "error");
    }
  };

  const loadDcr = async (force = false) => {
    if (!accessToken || !activeRegion) return;
    setLoading(true);
    try {
      const url = `/api/dcr/${encodeURIComponent(dcrId)}?region=${encodeURIComponent(activeRegion.id)}${force ? "&refresh=true" : ""}`;
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
      if (data.dropdownOptions) setDynamicDropdowns(data.dropdownOptions);
      if (data.formResponseDropdownOptions) {
        setFormResponseDropdowns((prev) => ({
          ...prev,
          ...data.formResponseDropdownOptions,
        }));
      }
      if (data.formLinks) setFormLinks(data.formLinks);
      if (data.comments) setComments(data.comments);

      const initialInputs = {};
      (data.fields || []).forEach((f) => {
        initialInputs[f.colLetter] = f.value;
      });
      setFormValues(initialInputs);

      const initialFormRespInputs = {};
      (data.formResponseFields || []).forEach((f) => {
        initialFormRespInputs[f.colLetter] = f.value;
      });
      setFormResponseValues(initialFormRespInputs);

      setDirtyFields(new Set());
      setFieldStatuses({});
      setDirtyFormResponseFields(new Set());
      setFormResponseFieldStatuses({});
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
        if (folderId) fetchFolderPhotos(folderId);
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
    if (activeRegion) loadDcr(false);
  }, [dcrId, accessToken, activeRegion?.id]);
  useEffect(() => {
    if (refreshSignal > lastSignalRef.current) {
      lastSignalRef.current = refreshSignal;
      loadDcr(true);
    }
  }, [refreshSignal]);
  useEffect(() => {
    if (propDropdownOptions)
      setDynamicDropdowns((prev) => ({ ...prev, ...propDropdownOptions }));
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
          DCR record "{dcrId}" could not be found in {activeRegion?.name}.
        </p>
      </div>
    );
  }

  const managerSignOffs = dcrData.fields.filter((f) => f.colIndex < 2);
  const formResponseFields = dcrData.formResponseFields || [];
  const postSpecsFields = dcrData.fields.filter(
    (f) => f.colIndex > 24 && f.colLetter !== "AR",
  );
  const commentsField = dcrData.fields.find((f) => f.colLetter === "AR");
  const activePhoto = photos[activePhotoIndex];

  const visibleComments = showResolvedComments
    ? comments
    : comments.filter((c) => !c.resolved);

  const getActiveCommentForCol = (colLetter) => {
    return (
      comments.find((c) => c.colLetter === colLetter && !c.resolved) || null
    );
  };

  return (
    <div
      style={{
        padding: "24px",
        maxWidth: commentsDrawerOpen ? "1600px" : "1200px",
        margin: "0 auto",
        transition: "max-width 0.2s ease",
      }}
    >
      <style>{`
        @keyframes btnSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes pulseBorder { 0% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(26, 115, 232, 0); } 100% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0); } }

        .field-highlight-pulse {
          animation: pulseBorder 1.8s ease-out;
          border-color: var(--btn-primary-bg, #1a73e8) !important;
        }

        .spec-header-clamped { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; height: 2.7em; }
        .spec-value-clamped { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; }
        .spec-expand-btn { background: none; border: none; padding: 0; color: var(--btn-primary-bg, #1a73e8); font-size: 11px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; outline: none; }
        .spec-expand-btn:hover { text-decoration: underline; }

        .dcr-multi-select-btn { width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; background: var(--bg-card, #ffffff); color: var(--text-main, #202124); border: 1px solid var(--border-color, #dadce0); text-align: left; transition: border-color 0.15s ease, box-shadow 0.15s ease; box-sizing: border-box; outline: none; }
        .dcr-multi-select-btn:hover { border-color: var(--btn-primary-bg, #1a73e8); }
        .dcr-multi-select-popover { position: absolute; top: calc(100% + 4px); left: 0; width: 100%; max-height: 240px; overflow-y: auto; background: var(--bg-card, #ffffff); border: 1px solid var(--border-color, #dadce0); border-radius: 6px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); z-index: 100; padding: 4px 0; box-sizing: border-box; }
        .dcr-multi-select-item { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; font-size: 13px; cursor: pointer; user-select: none; color: var(--text-main, #202124); transition: background-color 0.12s ease; }
        .dcr-multi-select-item:hover { background-color: var(--bg-card-subtle, #f8f9fa); }
        .dcr-multi-select-item.selected { font-weight: 500; color: var(--btn-primary-bg, #1a73e8); }

        .hover-comment-btn { position: absolute; top: 4px; right: 6px; opacity: 0; font-size: 12px; background: var(--bg-card, #ffffff); border: 1px solid var(--border-color, #dadce0); border-radius: 4px; padding: 2px 6px; cursor: pointer; color: var(--text-muted, #5f6368); transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease; z-index: 9; font-weight: bold; }
        .dcr-field-container:hover .hover-comment-btn { opacity: 0.85; }
        .hover-comment-btn:hover { opacity: 1 !important; color: var(--btn-primary-bg, #1a73e8) !important; border-color: var(--btn-primary-bg, #1a73e8) !important; }

        .comment-post-container .post-actions { opacity: 0; transition: opacity 0.15s ease; display: flex; gap: 6px; }
        .comment-post-container:hover .post-actions { opacity: 1; }
        .post-action-btn { background: none; border: none; font-size: 10px; cursor: pointer; padding: 0; text-transform: uppercase; font-weight: 600; }
        .post-action-btn:hover { text-decoration: underline; }

        .cell-comment-triangle {
          width: 0;
          height: 0;
          border-top: 13px solid #f59e0b;
          border-left: 13px solid transparent;
          cursor: pointer;
          transition: transform 0.15s ease, border-top-color 0.15s ease;
        }
        .cell-comment-triangle:hover {
          border-top-color: #d97706;
          transform: scale(1.15);
        }

        .cell-comment-popover {
          position: absolute;
          top: 14px;
          right: 0;
          z-index: 1000;
          width: 290px;
          max-width: 90vw;
          background: var(--bg-card);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
          box-sizing: border-box;
          animation: fieldFadeIn 0.15s ease-out;
        }

        [data-theme='dark'] .cell-comment-popover {
          background: #1e2530;
          border-color: #3b4554;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
        }
        [data-theme='dark'] .dcr-multi-select-btn { background: #1e2530; border-color: #3b4554; color: #e2e8f0; }
        [data-theme='dark'] .dcr-multi-select-popover { background: #1e2530; border-color: #3b4554; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); }
        [data-theme='dark'] .dcr-multi-select-item:hover { background-color: #273142; }
        [data-theme='dark'] .dcr-multi-select-item.selected { color: #60a5fa; }

        .dcr-confirm-modal-card {
          background: var(--bg-card, #ffffff);
          color: var(--text-main, #202124);
          border: 1px solid var(--border-color, #dadce0);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
        }
        [data-theme='dark'] .dcr-confirm-modal-card {
          background: #1e2530;
          color: #f1f5f9;
          border-color: #3b4554;
          box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6);
        }
      `}</style>

      {/* Top Navigation Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => navigate("/coordinator")}
          className="btn-secondary"
        >
          ← Back to All Records
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={() => setCommentsDrawerOpen((prev) => !prev)}
            className="btn-secondary"
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              borderColor:
                visibleComments.length > 0 ? "#f59e0b" : "var(--border-color)",
              background:
                visibleComments.length > 0
                  ? "rgba(245, 158, 11, 0.12)"
                  : "var(--bg-card)",
              color:
                visibleComments.length > 0 ? "#d97706" : "var(--text-main)",
            }}
          >
            <span>💬</span>
            <span>Comments ({visibleComments.length})</span>
          </button>
          <AutoSaveHeaderStatus
            status={globalStatus}
            onRetry={executeBatchSave}
          />
        </div>
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
            {activeRegion?.name} • Sheet Row #{dcrData.sheetRowNumber}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <a
            href={formLinks.evalFormUrl || undefined}
            target={formLinks.evalFormUrl ? "_blank" : undefined}
            rel={formLinks.evalFormUrl ? "noopener noreferrer" : undefined}
            onClick={(e) => {
              if (!formLinks.evalFormUrl) e.preventDefault();
            }}
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
              cursor: formLinks.evalFormUrl ? "pointer" : "default",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Create Eval
          </a>
          <a
            href={formLinks.qcFormUrl || undefined}
            target={formLinks.qcFormUrl ? "_blank" : undefined}
            rel={formLinks.qcFormUrl ? "noopener noreferrer" : undefined}
            onClick={(e) => {
              if (!formLinks.qcFormUrl) e.preventDefault();
            }}
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
              cursor: formLinks.qcFormUrl ? "pointer" : "default",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Create QC
          </a>
        </div>
      </div>

      {/* 70/30 Split Layout Container */}
      <div
        style={{
          display: "flex",
          gap: "24px",
          alignItems: "flex-start",
          width: "100%",
        }}
      >
        {/* Left Pane (70% when drawer open, 100% when closed) */}
        <div
          style={{
            flex: commentsDrawerOpen ? "0 0 70%" : "1 1 100%",
            maxWidth: commentsDrawerOpen ? "70%" : "100%",
            minWidth: 0,
            transition: "flex 0.2s ease, max-width 0.2s ease",
          }}
        >
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
                const activeComment = getActiveCommentForCol(f.colLetter);
                return (
                  <div
                    key={f.colLetter}
                    id={`field-card-${f.colLetter}`}
                    className="dcr-field-container"
                    style={{
                      background: "var(--bg-card-subtle)",
                      padding: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      transition:
                        "border-color 0.2s ease, box-shadow 0.2s ease",
                      position: "relative",
                    }}
                  >
                    {activeComment ? (
                      <CellCommentMarker
                        colLetter={f.colLetter}
                        colHeaderName={f.header}
                        comment={activeComment}
                        commentsDrawerOpen={commentsDrawerOpen}
                        isPinned={pinnedCommentCol === f.colLetter}
                        isPreview={hoveredCommentCol === f.colLetter}
                        onTriangleClick={(e) =>
                          handleTriangleClick(e, f.colLetter, activeComment)
                        }
                        onMouseEnter={() =>
                          handleTriangleMouseEnter(f.colLetter)
                        }
                        onMouseLeave={handleTriangleMouseLeave}
                        onClose={() => setPinnedCommentCol(null)}
                        onReply={handlePostReply}
                        onResolve={handleToggleResolve}
                      />
                    ) : (
                      <button
                        type="button"
                        className="hover-comment-btn"
                        title="Add comment"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInitiateNewComment(f.colLetter, f.header);
                        }}
                      >
                        💬+
                      </button>
                    )}
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
                      onChange={(e) =>
                        handleFieldChange(f.colLetter, e.target.value)
                      }
                      style={{ width: "100%" }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: DCR Form Responses Data (Editable for Manager/Director, Locked for others) */}
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
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "16px",
                  color: "var(--text-main)",
                }}
              >
                {dcrData.canEditFormResponses
                  ? "DCR Form Responses (Cols B through W)"
                  : "Locked DCR Form Data (Cols B through Y)"}
              </h3>
              {dcrData.canEditFormResponses && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "12px",
                    background: "rgba(26, 115, 232, 0.1)",
                    color: "var(--btn-primary-bg, #1a73e8)",
                  }}
                >
                  {dcrData.userRole} Edit Access
                </span>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: "12px",
                alignItems: "stretch",
              }}
            >
              {formResponseFields.map((f) => {
                const isExpanded = !!expandedFields[f.colLetter];
                const currentValue = f.isReadOnly
                  ? String(f.value || "")
                  : (formResponseValues[f.colLetter] ?? "");
                const isLong =
                  currentValue.length > 55 ||
                  currentValue.split("\n").length > 2;

                // Map native comments on shared columns C..S (skip B and W so they don't collide with Cable Replacement B/W)
                const supportsMainSheetComment =
                  f.colIndex >= 2 && f.colIndex <= 18;
                const activeComment = supportsMainSheetComment
                  ? getActiveCommentForCol(f.colLetter)
                  : null;

                // Dropdown options for E, H, I, J, Q, R
                let dropdownOptions = null;
                if (f.inputType === "select") {
                  const rawOptions =
                    formResponseDropdowns[f.colLetter] &&
                    formResponseDropdowns[f.colLetter].length > 0
                      ? formResponseDropdowns[f.colLetter]
                      : FORM_RESPONSE_DROPDOWN_FALLBACKS[f.colLetter] || [];
                  dropdownOptions = [...rawOptions];
                  if (currentValue && !dropdownOptions.includes(currentValue)) {
                    dropdownOptions.unshift(currentValue);
                  }
                }

                return (
                  <div
                    key={`resp-${f.colLetter}`}
                    id={
                      supportsMainSheetComment
                        ? `field-card-${f.colLetter}`
                        : `field-card-resp-${f.colLetter}`
                    }
                    className="dcr-field-container"
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
                      transition:
                        "border-color 0.2s ease, box-shadow 0.2s ease",
                      position: "relative",
                    }}
                  >
                    {supportsMainSheetComment &&
                      (activeComment ? (
                        <CellCommentMarker
                          colLetter={f.colLetter}
                          colHeaderName={f.header}
                          comment={activeComment}
                          commentsDrawerOpen={commentsDrawerOpen}
                          isPinned={pinnedCommentCol === f.colLetter}
                          isPreview={hoveredCommentCol === f.colLetter}
                          onTriangleClick={(e) =>
                            handleTriangleClick(e, f.colLetter, activeComment)
                          }
                          onMouseEnter={() =>
                            handleTriangleMouseEnter(f.colLetter)
                          }
                          onMouseLeave={handleTriangleMouseLeave}
                          onClose={() => setPinnedCommentCol(null)}
                          onReply={handlePostReply}
                          onResolve={handleToggleResolve}
                        />
                      ) : (
                        <button
                          type="button"
                          className="hover-comment-btn"
                          title="Add comment"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInitiateNewComment(f.colLetter, f.header);
                          }}
                        >
                          💬+
                        </button>
                      ))}

                    <div
                      className="spec-header-clamped"
                      style={{
                        fontSize: "11px",
                        color: "var(--text-subtle)",
                        textTransform: "uppercase",
                        marginBottom: "10px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "4px",
                      }}
                      title={`${f.header} (${f.colLetter})`}
                    >
                      <span
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {f.header} ({f.colLetter})
                      </span>
                      {!f.isReadOnly && (
                        <FieldIndicator
                          status={formResponseFieldStatuses[f.colLetter]}
                        />
                      )}
                    </div>

                    <div style={{ marginTop: "auto" }}>
                      {f.isReadOnly ? (
                        isLong && !isExpanded ? (
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
                        )
                      ) : f.inputType === "select" ? (
                        <select
                          className="dcr-select"
                          value={currentValue}
                          onChange={(e) =>
                            handleFormResponseChange(
                              f.colLetter,
                              e.target.value,
                            )
                          }
                          style={{
                            width: "100%",
                            height: "38px",
                            minHeight: "38px",
                            padding: "0 10px",
                            fontSize: "13px",
                            margin: 0,
                            boxSizing: "border-box",
                          }}
                        >
                          <option value="">- Select -</option>
                          {dropdownOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : f.inputType === "text" ? (
                        <input
                          type="text"
                          className="dcr-input"
                          value={currentValue}
                          placeholder={f.placeholder || ""}
                          onChange={(e) =>
                            handleFormResponseChange(
                              f.colLetter,
                              e.target.value,
                            )
                          }
                          style={{
                            width: "100%",
                            height: "38px",
                            minHeight: "38px",
                            padding: "0 10px",
                            fontSize: "13px",
                            margin: 0,
                            boxSizing: "border-box",
                          }}
                        />
                      ) : (
                        <AutoResizeTextarea
                          value={currentValue}
                          placeholder={f.placeholder || ""}
                          isExpanded={isExpanded}
                          onToggleExpand={() => toggleFieldExpand(f.colLetter)}
                          onChange={(e) =>
                            handleFormResponseChange(
                              f.colLetter,
                              e.target.value,
                            )
                          }
                        />
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
                      driveViewMode === "photos"
                        ? "#ffffff"
                        : "var(--text-muted)",
                  }}
                >
                  Photos
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
                      driveViewMode === "files"
                        ? "#ffffff"
                        : "var(--text-muted)",
                  }}
                >
                  Files
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
                      {activePhoto.name} ({activePhotoIndex + 1} of{" "}
                      {photos.length})
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
              )
            ) : (
              /* Files Table with Drag & Drop Overlay Support */
              <div
                onDragEnter={handleFilesDragEnter}
                onDragLeave={handleFilesDragLeave}
                onDragOver={handleFilesDragOver}
                onDrop={handleFilesDrop}
                style={{
                  position: "relative",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  minHeight: "160px",
                }}
              >
                {isDraggingOver && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: "rgba(26, 115, 232, 0.12)",
                      border: "2px dashed var(--btn-primary-bg, #1a73e8)",
                      borderRadius: "6px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 50,
                      backdropFilter: "blur(2px)",
                      pointerEvents: "none",
                    }}
                  >
                    <span style={{ fontSize: "32px", marginBottom: "8px" }}>
                      📥
                    </span>
                    <strong
                      style={{
                        fontSize: "15px",
                        color: "var(--btn-primary-bg, #1a73e8)",
                      }}
                    >
                      Drop files to upload to Google Drive
                    </strong>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--text-muted)",
                        marginTop: "4px",
                      }}
                    >
                      Files will be saved directly into this DCR's folder
                    </span>
                  </div>
                )}

                {isUploadingFiles && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: "rgba(255, 255, 255, 0.85)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 60,
                      borderRadius: "6px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: "28px",
                        height: "28px",
                        border: "3px solid rgba(59, 130, 246, 0.25)",
                        borderTop: "3px solid #3b82f6",
                        borderRadius: "50%",
                        animation: "btnSpin 0.7s linear infinite",
                        marginBottom: "10px",
                      }}
                    />
                    <strong
                      style={{ fontSize: "13px", color: "var(--text-main)" }}
                    >
                      Uploading files to Google Drive...
                    </strong>
                  </div>
                )}

                {folderFiles.length === 0 ? (
                  <div
                    style={{
                      padding: "40px 20px",
                      textAlign: "center",
                      color: "var(--text-subtle)",
                      background: "var(--bg-card-subtle)",
                      borderRadius: "6px",
                    }}
                  >
                    No files found in this Google Drive folder.
                    <div
                      style={{
                        marginTop: "8px",
                        fontSize: "12px",
                        color: "var(--text-muted)",
                      }}
                    >
                      Drag and drop any file here to upload directly to Google
                      Drive.
                    </div>
                  </div>
                ) : (
                  <div style={{ maxHeight: "460px", overflowY: "auto" }}>
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
                          <th style={{ padding: "10px 14px", width: "80px" }}>
                            Type
                          </th>
                          <th style={{ padding: "10px 14px" }}>File Name</th>
                          <th
                            style={{
                              padding: "10px 14px",
                              width: "260px",
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
                            document.documentElement.getAttribute(
                              "data-theme",
                            ) === "dark";
                          const isImg = file.mimeType?.startsWith("image/");
                          return (
                            <tr
                              key={file.id}
                              className="dcr-table-row"
                              style={{
                                borderBottom: "1px solid var(--border-subtle)",
                              }}
                            >
                              <td style={{ padding: "10px 14px" }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: "4px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    background: isDark
                                      ? badge.darkBg
                                      : badge.bg,
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
                                        height: "26px",
                                        padding: "0 10px",
                                        fontSize: "12px",
                                        lineHeight: 1,
                                        whiteSpace: "nowrap",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        boxSizing: "border-box",
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
                                      height: "26px",
                                      padding: "0 10px",
                                      fontSize: "12px",
                                      lineHeight: 1,
                                      textDecoration: "none",
                                      whiteSpace: "nowrap",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      boxSizing: "border-box",
                                    }}
                                  >
                                    Open ↗
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => setFileToDelete(file)}
                                    className="btn-secondary"
                                    style={{
                                      height: "26px",
                                      padding: "0 10px",
                                      fontSize: "12px",
                                      lineHeight: 1,
                                      whiteSpace: "nowrap",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      boxSizing: "border-box",
                                      color: "#dc2626",
                                      borderColor: "rgba(220, 38, 38, 0.3)",
                                      cursor: "pointer",
                                    }}
                                    title="Move to Google Drive trash"
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                      <path d="M10 11v6" />
                                      <path d="M14 11v6" />
                                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                    </svg>
                                  </button>
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
                  const currentValue = formValues[f.colLetter] ?? "";
                  const activeComment = getActiveCommentForCol(f.colLetter);

                  if (f.colLetter === "AI") {
                    const contractorOptions =
                      (dynamicDropdowns?.AI && dynamicDropdowns.AI.length > 0
                        ? dynamicDropdowns.AI
                        : propDropdownOptions?.AI) || [];
                    const selectedList = currentValue
                      ? currentValue
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : [];

                    return (
                      <div
                        key={f.colLetter}
                        id={`field-card-${f.colLetter}`}
                        className="dcr-field-container"
                        ref={contractorDropdownRef}
                        style={{
                          background: "var(--bg-card-subtle)",
                          padding: "12px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-subtle)",
                          position: "relative",
                          transition:
                            "border-color 0.2s ease, box-shadow 0.2s ease",
                        }}
                      >
                        {activeComment ? (
                          <CellCommentMarker
                            colLetter={f.colLetter}
                            colHeaderName={f.header}
                            comment={activeComment}
                            commentsDrawerOpen={commentsDrawerOpen}
                            isPinned={pinnedCommentCol === f.colLetter}
                            isPreview={hoveredCommentCol === f.colLetter}
                            onTriangleClick={(e) =>
                              handleTriangleClick(e, f.colLetter, activeComment)
                            }
                            onMouseEnter={() =>
                              handleTriangleMouseEnter(f.colLetter)
                            }
                            onMouseLeave={handleTriangleMouseLeave}
                            onClose={() => setPinnedCommentCol(null)}
                            onReply={handlePostReply}
                            onResolve={handleToggleResolve}
                          />
                        ) : (
                          <button
                            type="button"
                            className="hover-comment-btn"
                            title="Add comment"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInitiateNewComment(f.colLetter, f.header);
                            }}
                          >
                            💬+
                          </button>
                        )}
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

                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() =>
                              setContractorDropdownOpen((prev) => !prev)
                            }
                            className="dcr-multi-select-btn"
                          >
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginRight: "8px",
                              }}
                            >
                              {selectedList.length === 0
                                ? "- Select Contractor(s) -"
                                : selectedList.join(", ")}
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                                opacity: 0.6,
                                flexShrink: 0,
                              }}
                            >
                              {contractorDropdownOpen ? "▲" : "▼"}
                            </span>
                          </button>

                          {contractorDropdownOpen && (
                            <div className="dcr-multi-select-popover">
                              {contractorOptions.length === 0 ? (
                                <div
                                  style={{
                                    padding: "10px 14px",
                                    fontSize: "12px",
                                    color: "var(--text-subtle)",
                                  }}
                                >
                                  No options in Data Val
                                </div>
                              ) : (
                                contractorOptions.map((opt) => {
                                  const isSelected = selectedList.includes(opt);
                                  return (
                                    <div
                                      key={opt}
                                      onClick={() =>
                                        handleContractorToggle(f.colLetter, opt)
                                      }
                                      className={`dcr-multi-select-item ${isSelected ? "selected" : ""}`}
                                    >
                                      <span>{opt}</span>
                                      {isSelected && (
                                        <span
                                          style={{
                                            color: "#16a34a",
                                            fontWeight: 700,
                                            marginLeft: "8px",
                                          }}
                                        >
                                          ✓
                                        </span>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const rawOptions =
                    dynamicDropdowns[f.colLetter] &&
                    dynamicDropdowns[f.colLetter].length > 0
                      ? dynamicDropdowns[f.colLetter]
                      : propDropdownOptions &&
                          propDropdownOptions[f.colLetter] &&
                          propDropdownOptions[f.colLetter].length > 0
                        ? propDropdownOptions[f.colLetter]
                        : DROPDOWN_FIELD_OPTIONS[f.colLetter];
                  let dropdownOptions = null;
                  if (rawOptions && rawOptions.length > 0) {
                    dropdownOptions = [...rawOptions];
                    if (currentValue && !dropdownOptions.includes(currentValue))
                      dropdownOptions.unshift(currentValue);
                  }

                  return (
                    <div
                      key={f.colLetter}
                      id={`field-card-${f.colLetter}`}
                      className="dcr-field-container"
                      style={{
                        background: "var(--bg-card-subtle)",
                        padding: "12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-subtle)",
                        transition:
                          "border-color 0.2s ease, box-shadow 0.2s ease",
                        position: "relative",
                      }}
                    >
                      {activeComment ? (
                        <CellCommentMarker
                          colLetter={f.colLetter}
                          colHeaderName={f.header}
                          comment={activeComment}
                          commentsDrawerOpen={commentsDrawerOpen}
                          isPinned={pinnedCommentCol === f.colLetter}
                          isPreview={hoveredCommentCol === f.colLetter}
                          onTriangleClick={(e) =>
                            handleTriangleClick(e, f.colLetter, activeComment)
                          }
                          onMouseEnter={() =>
                            handleTriangleMouseEnter(f.colLetter)
                          }
                          onMouseLeave={handleTriangleMouseLeave}
                          onClose={() => setPinnedCommentCol(null)}
                          onReply={handlePostReply}
                          onResolve={handleToggleResolve}
                        />
                      ) : (
                        <button
                          type="button"
                          className="hover-comment-btn"
                          title="Add comment"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInitiateNewComment(f.colLetter, f.header);
                          }}
                        >
                          💬+
                        </button>
                      )}
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
              id={`field-card-${commentsField.colLetter}`}
              className="dcr-field-container"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "16px 20px",
                marginBottom: "24px",
                boxShadow: "var(--shadow-card)",
                transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                position: "relative",
              }}
            >
              {getActiveCommentForCol(commentsField.colLetter) ? (
                <CellCommentMarker
                  colLetter={commentsField.colLetter}
                  colHeaderName={commentsField.header || "Comments"}
                  comment={getActiveCommentForCol(commentsField.colLetter)}
                  commentsDrawerOpen={commentsDrawerOpen}
                  isPinned={pinnedCommentCol === commentsField.colLetter}
                  isPreview={hoveredCommentCol === commentsField.colLetter}
                  onTriangleClick={(e) =>
                    handleTriangleClick(
                      e,
                      commentsField.colLetter,
                      getActiveCommentForCol(commentsField.colLetter),
                    )
                  }
                  onMouseEnter={() =>
                    handleTriangleMouseEnter(commentsField.colLetter)
                  }
                  onMouseLeave={handleTriangleMouseLeave}
                  onClose={() => setPinnedCommentCol(null)}
                  onReply={handlePostReply}
                  onResolve={handleToggleResolve}
                />
              ) : (
                <button
                  type="button"
                  className="hover-comment-btn"
                  title="Add comment"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleInitiateNewComment(
                      commentsField.colLetter,
                      commentsField.header || "Comments",
                    );
                  }}
                >
                  💬+
                </button>
              )}
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
                  {commentsField.header || "Comments"} (
                  {commentsField.colLetter})
                  <FieldIndicator
                    status={fieldStatuses[commentsField.colLetter]}
                  />
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
        </div>

        {/* Right Pane: 30% Sticky Comments & Activity Feed */}
        {commentsDrawerOpen && (
          <div
            id="comments-sidebar"
            style={{
              flex: "0 0 calc(30% - 24px)",
              maxWidth: "calc(30% - 24px)",
              minWidth: "300px",
              position: "sticky",
              top: "20px",
              maxHeight: "calc(100vh - 40px)",
              overflowY: "auto",
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              boxShadow: "var(--shadow-card)",
              padding: "16px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
                borderBottom: "1px solid var(--border-subtle)",
                paddingBottom: "10px",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "15px",
                    color: "var(--text-main)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>💬 Comments</span>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 7px",
                      borderRadius: "10px",
                      background: "var(--bg-card-subtle)",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    {visibleComments.length}
                  </span>
                </h3>
                <div style={{ marginTop: "4px" }}>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "var(--text-subtle)",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showResolvedComments}
                      onChange={(e) =>
                        setShowResolvedComments(e.target.checked)
                      }
                      style={{ margin: 0, cursor: "pointer" }}
                    />
                    Show resolved
                  </label>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCommentsDrawerOpen(false);
                  setDraftTarget(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "16px",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
                title="Close comments pane"
              >
                ✕
              </button>
            </div>

            {draftTarget && (
              <div
                style={{
                  background: "var(--bg-card-subtle)",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "1px solid var(--btn-primary-bg)",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--btn-primary-bg)",
                    marginBottom: "4px",
                  }}
                >
                  New comment on {draftTarget.colHeaderName}
                </div>
                <InlineCommentComposer
                  placeholder="Type a new comment..."
                  buttonText="Post"
                  onSave={handlePostNewThread}
                  onCancel={() => setDraftTarget(null)}
                />
              </div>
            )}

            {visibleComments.length === 0 && !draftTarget ? (
              <div
                style={{
                  padding: "24px 8px",
                  textAlign: "center",
                  color: "var(--text-subtle)",
                  fontSize: "13px",
                  lineHeight: 1.5,
                }}
              >
                {comments.length > 0
                  ? "All active comments have been resolved."
                  : "No active comments on this DCR row. Hover over a field to add one."}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {visibleComments.map((c) => {
                  const fieldData = dcrData?.fields?.find(
                    (f) => f.colLetter === c.colLetter,
                  );
                  const colHeaderName = fieldData
                    ? fieldData.header
                    : `Column ${c.colLetter}`;
                  const isAuthor =
                    userProfile &&
                    c.authorEmail &&
                    c.authorEmail.toLowerCase() ===
                      userProfile.email.toLowerCase();

                  return (
                    <div
                      key={c.commentId}
                      id={`sidebar-comment-${c.commentId}`}
                      style={{
                        background: "var(--bg-card-subtle)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "6px",
                        padding: "12px",
                        fontSize: "13px",
                        opacity: c.resolved ? 0.75 : 1,
                        transition:
                          "border-color 0.2s ease, box-shadow 0.2s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "6px",
                        }}
                      >
                        <span
                          title={colHeaderName}
                          style={{
                            fontWeight: 700,
                            color: "var(--btn-primary-bg)",
                            fontSize: "12px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flex: 1,
                            marginRight: "8px",
                          }}
                        >
                          {colHeaderName}
                        </span>

                        {!c.isNote && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              flexShrink: 0,
                            }}
                          >
                            {c.resolved ? (
                              <>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "#16a34a",
                                    background: "rgba(22, 163, 74, 0.12)",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontWeight: 600,
                                  }}
                                >
                                  ✓ Resolved
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggleResolve(c.commentId, c.resolved)
                                  }
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    cursor: "pointer",
                                    fontSize: "11px",
                                    color: "var(--text-muted)",
                                    fontWeight: 600,
                                  }}
                                >
                                  ↺ Reopen
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleResolve(c.commentId, c.resolved)
                                }
                                className="btn-secondary"
                                style={{
                                  padding: "2px 8px",
                                  fontSize: "11px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                        )}
                        {c.isNote && (
                          <span
                            style={{
                              fontSize: "11px",
                              color: "var(--text-subtle)",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            Note
                          </span>
                        )}
                      </div>

                      <div
                        className="comment-post-container"
                        style={{ position: "relative", marginBottom: "8px" }}
                      >
                        {c.plainTextQuote && (
                          <div
                            style={{
                              fontSize: "11px",
                              fontStyle: "italic",
                              color: "var(--text-subtle)",
                              marginBottom: "4px",
                              borderLeft: "2px solid var(--border-color)",
                              paddingLeft: "6px",
                            }}
                          >
                            "{decodeHtmlEntities(c.plainTextQuote)}"
                          </div>
                        )}

                        {editingCommentId === c.commentId ? (
                          <InlineCommentComposer
                            initialValue={decodeHtmlEntities(c.text)}
                            buttonText="Save"
                            onSave={(newText) =>
                              handleEditThread(c.commentId, newText)
                            }
                            onCancel={() => setEditingCommentId(null)}
                          />
                        ) : (
                          <div>
                            <div
                              style={{
                                color: "var(--text-main)",
                                lineHeight: "1.4",
                                wordBreak: "break-word",
                                marginBottom: "4px",
                              }}
                            >
                              {decodeHtmlEntities(c.text)}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "var(--text-subtle)",
                                }}
                              >
                                — {c.authorName || c.authorEmail}
                                {c.timestamp &&
                                  ` • ${new Date(c.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                              </div>
                              {isAuthor && !c.isNote && (
                                <div className="post-actions">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingCommentId(c.commentId)
                                    }
                                    className="post-action-btn"
                                    style={{ color: "var(--btn-primary-bg)" }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteThread(c.commentId)
                                    }
                                    className="post-action-btn"
                                    style={{ color: "#ef4444" }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {c.replies && c.replies.length > 0 && (
                        <div
                          style={{
                            borderLeft: "2px solid var(--border-color)",
                            paddingLeft: "8px",
                            margin: "6px 0",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          {c.replies.map((rep) => {
                            const isRepAuthor =
                              userProfile &&
                              rep.authorEmail &&
                              rep.authorEmail.toLowerCase() ===
                                userProfile.email.toLowerCase();
                            return (
                              <div
                                key={rep.replyId}
                                className="comment-post-container"
                                style={{
                                  fontSize: "12px",
                                  position: "relative",
                                }}
                              >
                                {editingReplyId === rep.replyId ? (
                                  <InlineCommentComposer
                                    initialValue={decodeHtmlEntities(rep.text)}
                                    buttonText="Save"
                                    onSave={(newText) =>
                                      handleEditReply(
                                        c.commentId,
                                        rep.replyId,
                                        newText,
                                      )
                                    }
                                    onCancel={() => setEditingReplyId(null)}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "flex-start",
                                      gap: "8px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        color: "var(--text-main)",
                                        lineHeight: "1.35",
                                        wordBreak: "break-word",
                                      }}
                                    >
                                      <strong
                                        style={{
                                          color: "var(--btn-primary-bg)",
                                          marginRight: "6px",
                                        }}
                                      >
                                        {rep.authorName}:
                                      </strong>
                                      {decodeHtmlEntities(rep.text)}
                                    </div>
                                    {isRepAuthor && (
                                      <div
                                        className="post-actions"
                                        style={{ flexShrink: 0 }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditingReplyId(rep.replyId)
                                          }
                                          className="post-action-btn"
                                          style={{
                                            color: "var(--btn-primary-bg)",
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteReply(
                                              c.commentId,
                                              rep.replyId,
                                            )
                                          }
                                          className="post-action-btn"
                                          style={{ color: "#ef4444" }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {!c.resolved &&
                        !c.isNote &&
                        activeReplyBoxId !== c.commentId && (
                          <div
                            style={{ marginBottom: "8px", paddingLeft: "10px" }}
                          >
                            <button
                              type="button"
                              onClick={() => setActiveReplyBoxId(c.commentId)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                fontSize: "11px",
                                color: "var(--text-subtle)",
                                cursor: "pointer",
                                fontWeight: 600,
                              }}
                            >
                              Reply...
                            </button>
                          </div>
                        )}

                      {activeReplyBoxId === c.commentId && (
                        <div
                          style={{
                            paddingLeft: "10px",
                            borderLeft: "2px solid var(--btn-primary-bg)",
                            margin: "4px 0 10px 0",
                          }}
                        >
                          <InlineCommentComposer
                            placeholder="Reply..."
                            buttonText="Reply"
                            onSave={(text) =>
                              handlePostReply(c.commentId, text)
                            }
                            onCancel={() => setActiveReplyBoxId(null)}
                          />
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderTop: "1px solid var(--border-subtle)",
                          paddingTop: "8px",
                          marginTop: "4px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            fontWeight: 600,
                            letterSpacing: "0.3px",
                          }}
                        >
                          {c.cellCoordinate}
                        </span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => handleHighlightField(c.colLetter)}
                            className="btn-secondary"
                            style={{
                              padding: "3px 8px",
                              fontSize: "11px",
                              borderRadius: "4px",
                            }}
                          >
                            Highlight
                          </button>
                          <a
                            href={c.openInSheetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary"
                            style={{
                              padding: "3px 8px",
                              fontSize: "11px",
                              borderRadius: "4px",
                              textDecoration: "none",
                              color: "var(--btn-primary-bg)",
                              fontWeight: 600,
                            }}
                          >
                            Open in Sheet ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Drive File Confirmation Modal */}
      {fileToDelete && (
        <div
          onClick={() => {
            if (!isDeletingFile) setFileToDelete(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "20px",
            animation: "fieldFadeIn 0.15s ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="dcr-confirm-modal-card"
            style={{
              width: "100%",
              maxWidth: "420px",
              borderRadius: "10px",
              padding: "22px 24px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "rgba(220, 38, 38, 0.12)",
                  color: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                Move File to Trash?
              </h3>
            </div>

            <p
              style={{
                margin: "0 0 8px 0",
                fontSize: "14px",
                lineHeight: 1.5,
                color: "var(--text-main)",
                wordBreak: "break-word",
              }}
            >
              Are you sure you want to move{" "}
              <strong>"{fileToDelete.name}"</strong> to Google Drive trash?
            </p>
            <p
              style={{
                margin: "0 0 20px 0",
                fontSize: "12px",
                color: "var(--text-muted)",
              }}
            >
              Files in Google Drive trash remain recoverable for 30 days.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                type="button"
                disabled={isDeletingFile}
                onClick={() => setFileToDelete(null)}
                className="btn-secondary"
                style={{
                  padding: "7px 14px",
                  fontSize: "13px",
                  borderRadius: "6px",
                  cursor: isDeletingFile ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingFile}
                onClick={confirmDeleteDriveFile}
                style={{
                  padding: "7px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  borderRadius: "6px",
                  border: "none",
                  background: "#dc2626",
                  color: "#ffffff",
                  cursor: isDeletingFile ? "not-allowed" : "pointer",
                  opacity: isDeletingFile ? 0.75 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isDeletingFile && (
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      border: "2px solid rgba(255, 255, 255, 0.35)",
                      borderTop: "2px solid #ffffff",
                      borderRadius: "50%",
                      animation: "btnSpin 0.7s linear infinite",
                    }}
                  />
                )}
                <span>
                  {isDeletingFile ? "Moving to Trash..." : "Move to Trash"}
                </span>
              </button>
            </div>
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
