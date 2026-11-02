import * as XLSX from 'xlsx';

export function downloadExcel(filename, headers, rows, sheetName = 'Members', { summaryRows = [] } = {}) {
  const matrix = summaryRows.length ? [...summaryRows, [], headers, ...rows] : [headers, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const columnCount = headers.length;
  const headerRow = summaryRows.length ? summaryRows.length + 2 : 1;

  sheet['!cols'] = headers.map((header, columnIndex) => {
    const longestValue = matrix.reduce((length, row) => Math.max(length, String(row[columnIndex] ?? '').length), String(header).length);
    return { wch: Math.min(Math.max(longestValue + 2, 12), 48) };
  });

  if (rows.length) sheet['!autofilter'] = { ref: `A${headerRow}:${XLSX.utils.encode_col(columnCount - 1)}${headerRow + rows.length}` };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx', compression: true });
}
