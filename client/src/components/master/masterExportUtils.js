const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};


// Maps labels like "Sep 26" -> "FY27", "Oct 27" -> "FY28", "Sep 28" -> "FY29"
export function getFiscalYearFromLabel(dateLabel) {
  const clean = String(dateLabel || "").trim();
  const match = clean.match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (!match) return "Other";


  const monthStr = match[1].toLowerCase();
  const yearTwoDigit = Number(match[2]);
  const monthIdx = MONTH_INDEX[monthStr];


  if (monthIdx === undefined || Number.isNaN(yearTwoDigit)) return "Other";


  // Fiscal year runs Sep -> Aug (Sep 26 - Aug 27 = FY27)
  const fyNumber = monthIdx >= 8 ? yearTwoDigit + 1 : yearTwoDigit;
  return `FY${fyNumber}`;
}


export function downloadTableCsv(filename, headers, rows) {
  const escapeCell = (val) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };


  const csvLines = [
    headers.map(escapeCell).join(","),
    ...rows.map((r) => r.map(escapeCell).join(",")),
  ];


  const blob = new Blob([csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


export async function copyTableToClipboard(titleLine, headers, rows) {
  const lines = [];
  if (titleLine) lines.push(titleLine);
  lines.push(headers.join("\t"));
  rows.forEach((r) => {
    lines.push(r.map((cell) => String(cell ?? "")).join("\t"));
  });


  await navigator.clipboard.writeText(lines.join("\n"));
}