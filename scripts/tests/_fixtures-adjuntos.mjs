// Generadores de archivos REALES (no simulados) para las pruebas de adjuntos: PDF de texto con varias páginas, XLSX (exceljs), DOCX (jszip) e imágenes mínimas.
export function pdfTexto(paginas) {
  const objs = []; const kids = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let n = 4;
  for (const texto of paginas) {
    const lineas = texto.split('\n').map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${l.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`).join('\n');
    const cont = n; const pag = n + 1; objs[cont] = `<< /Length ${Buffer.byteLength(lineas, 'latin1')} >>\nstream\n${lineas}\nendstream`;
    objs[pag] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${cont} 0 R >>`; kids.push(`${pag} 0 R`); n += 2;
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${paginas.length} >>`;
  let out = '%PDF-1.4\n'; const off = [];
  for (let i = 1; i < objs.length; i += 1) { off[i] = Buffer.byteLength(out, 'latin1'); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${off.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
export async function xlsx(hojas) {
  const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook();
  for (const [nombre, filas] of Object.entries(hojas)) { const ws = wb.addWorksheet(nombre); for (const f of filas) ws.addRow(f); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function docx(parrafos, { conMacros = false } = {}) {
  const JSZip = (await import('jszip')).default; const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parrafos.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  if (conMacros) z.file('word/vbaProject.bin', 'x');
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
}
export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
