import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Disposable originals for native-browser import checks; never real research data.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-import-ui-"));
function write(name: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
}
function pdf(title: string): Buffer {
  const stream = `BT /F1 20 Tf 60 700 Td (${title}) Tj 0 -40 Td /F1 12 Tf (Synthetic import fixture. No real study data.) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
write("workspace/src/evaluation.ts", "export const syntheticMedianLatencyMs = 30;\n");
write("workspace/results/summary.csv", "method,median_latency_ms\nbaseline,40\nrevised,30\n");
write("workspace/notes/protocol.md", "# Synthetic protocol\n\nMeasurements are invented for an import test.\n");
write("workspace/.env", "DO_NOT_IMPORT=synthetic\n");
write("workspace/credentials.json", '{"fixture":"excluded credential filename"}');
write("workspace/node_modules/dependency/index.ts", "export const excluded = true;");
write("pdfs/nested/Study Alpha.pdf", pdf("Synthetic Study Alpha"));
write("pdfs/Study Beta.pdf", pdf("Synthetic Study Beta"));
write("pdfs/not-a-document.pdf", "Invalid PDF fixture");
write("zotero/storage/ABCD1234/Study Alpha.pdf", pdf("Synthetic Study Alpha"));
write("zotero/storage/EFGH5678/Study Beta.pdf", pdf("Synthetic Study Beta"));
console.log(JSON.stringify({ root, workspace: path.join(root, "workspace"), pdfs: path.join(root, "pdfs"), zotero: path.join(root, "zotero/storage") }));
