function sanitizeSheetName(name, index) {
  const fallback = `Sheet${index + 1}`
  const base = String(name || fallback)
    .replace(/[:\\/?*\[\]]/g, ' ')
    .trim()

  return (base || fallback).slice(0, 31)
}

function normalizeRows(rows) {
  if (Array.isArray(rows) && rows.length) return rows
  return [{ Info: 'No data available for this sheet.' }]
}

export async function downloadWorkbook(fileName, sheets) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()

  ;(sheets || []).forEach((sheet, index) => {
    const worksheet = XLSX.utils.json_to_sheet(normalizeRows(sheet?.rows))
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      sanitizeSheetName(sheet?.name, index)
    )
  })

  XLSX.writeFile(workbook, fileName || 'sla-export.xlsx')
}
