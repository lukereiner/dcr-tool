import React, { useState, useMemo, useEffect, useCallback } from "react";

export function parseNumericCell(rawVal) {
  if (rawVal === null || rawVal === undefined) return null;
  const trimmed = String(rawVal).trim();
  if (!trimmed || trimmed === "—" || trimmed === "-" || trimmed === "N/A") {
    return null;
  }

  const isPct = trimmed.endsWith("%");
  const cleaned = trimmed.replace(/[$,%\s]/g, "");
  if (!cleaned || Number.isNaN(Number(cleaned))) {
    return null;
  }

  return {
    value: Number(cleaned),
    isPct,
  };
}

export function useTableCellSelection({
  rowCount,
  colCount,
  getCellValue,
  containerRef,
  isDisabled = false,
  onSelectionChange,
}) {
  const [selection, setSelection] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setIsDragging(false);
  }, []);

  // Reset selection if table dimensions change (e.g., filter or region/system switch)
  useEffect(() => {
    setSelection(null);
    setIsDragging(false);
  }, [rowCount, colCount]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleDocumentMouseDown = (e) => {
      if (!selection) return;
      if (
        e.target.closest(".selection-summary-inline") ||
        (containerRef?.current && containerRef.current.contains(e.target))
      ) {
        return;
      }
      setSelection(null);
    };

    const handleKeyDown = (e) => {
      if (!selection) return;
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "c" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName,
        )
      ) {
        const minR = Math.min(selection.startRow, selection.endRow);
        const maxR = Math.max(selection.startRow, selection.endRow);
        const minC = Math.min(selection.startCol, selection.endCol);
        const maxC = Math.max(selection.startCol, selection.endCol);

        if (minR === maxR && minC === maxC) return;

        const lines = [];
        for (let r = minR; r <= maxR; r++) {
          const rowVals = [];
          for (let c = minC; c <= maxC; c++) {
            rowVals.push(getCellValue(r, c) ?? "");
          }
          lines.push(rowVals.join("\t"));
        }
        navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
      }
    };

    window.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleDocumentMouseDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selection, containerRef, getCellValue]);

  const handleCellMouseDown = useCallback(
    (rIdx, cIdx, e) => {
      if (isDisabled || e.button !== 0) return;

      if (e.shiftKey && selection) {
        setSelection((prev) => ({
          ...prev,
          endRow: rIdx,
          endCol: cIdx,
        }));
        return;
      }

      setSelection({
        startRow: rIdx,
        startCol: cIdx,
        endRow: rIdx,
        endCol: cIdx,
      });
      setIsDragging(true);
    },
    [isDisabled, selection],
  );

  const handleCellMouseEnter = useCallback(
    (rIdx, cIdx) => {
      if (!isDragging || isDisabled) return;
      setSelection((prev) =>
        prev
          ? {
              ...prev,
              endRow: rIdx,
              endCol: cIdx,
            }
          : null,
      );
    },
    [isDragging, isDisabled],
  );

  const isCellSelected = useCallback(
    (rIdx, cIdx) => {
      if (!selection) return false;
      const minR = Math.min(selection.startRow, selection.endRow);
      const maxR = Math.max(selection.startRow, selection.endRow);
      const minC = Math.min(selection.startCol, selection.endCol);
      const maxC = Math.max(selection.startCol, selection.endCol);
      return rIdx >= minR && rIdx <= maxR && cIdx >= minC && cIdx <= maxC;
    },
    [selection],
  );

  const stats = useMemo(() => {
    if (!selection) return null;

    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);

    const totalSelectedCells = (maxR - minR + 1) * (maxC - minC + 1);
    if (totalSelectedCells <= 1) return null;

    const parsedNumbers = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const parsed = parseNumericCell(getCellValue(r, c));
        if (parsed !== null) {
          parsedNumbers.push(parsed);
        }
      }
    }

    if (parsedNumbers.length === 0) return null;

    const sum = parsedNumbers.reduce((acc, item) => acc + item.value, 0);
    const avg = sum / parsedNumbers.length;
    const allPercent = parsedNumbers.every((item) => item.isPct);

    const formatNum = (n) => {
      const formatted = n.toLocaleString("en-US", {
        minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
        maximumFractionDigits: 2,
      });
      return allPercent ? `${formatted}%` : formatted;
    };

    return {
      sumFormatted: formatNum(sum),
      avgFormatted: formatNum(avg),
      count: parsedNumbers.length,
    };
  }, [selection, getCellValue]);

  useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(stats, clearSelection);
    }
  }, [stats, clearSelection, onSelectionChange]);

  return {
    isDragging,
    handleCellMouseDown,
    handleCellMouseEnter,
    isCellSelected,
    clearSelection,
    stats,
  };
}

export function SelectionSummaryInline({ stats, onClear }) {
  if (!stats) return null;

  return (
    <div
      className="selection-summary-inline"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "12px",
        padding: "4px 10px",
        borderRadius: "6px",
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        fontSize: "12px",
        color: "var(--text-main)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
          Sum:
        </span>
        <strong
          style={{
            color: "var(--text-main)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {stats.sumFormatted}
        </strong>
      </div>

      <span style={{ color: "var(--border-color)" }}>|</span>

      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
          Avg:
        </span>
        <strong
          style={{
            color: "var(--text-main)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {stats.avgFormatted}
        </strong>
      </div>

      <span style={{ color: "var(--border-color)" }}>|</span>

      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
          Count:
        </span>
        <strong
          style={{
            color: "var(--text-main)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {stats.count}
        </strong>
      </div>

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          title="Clear selection (Esc)"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "12px",
            padding: "0 2px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}