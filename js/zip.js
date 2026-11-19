// Local, bundled ZIP reader: no third-party CDN scripts receive the document.
import { unzipSync, strFromU8 } from './vendor/fflate.js';
export async function extractOfficeText(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Máximo 15 MB por documento');
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {filter: f => ['word/document.xml','content.xml'].includes(f.name) && f.originalSize <= 30 * 1024 * 1024});
  const data = entries['word/document.xml'] || entries['content.xml'];
  if (!data) throw new Error('El documento no contiene texto compatible');
  const doc = new DOMParser().parseFromString(strFromU8(data),'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Documento dañado');
  const paragraphs = [...doc.getElementsByTagNameNS('*','p')];
  const text = (paragraphs.length ? paragraphs.map(p => p.textContent).join('\n') : doc.documentElement.textContent).trim();
  if (!text) throw new Error('No se ha encontrado texto en el documento');
  return text;
}
