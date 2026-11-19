import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geminiTextStream } from '../js/stream.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('stream conserva el texto en todos los límites de bytes y un evento final sin salto de línea', async () => {
  const wire = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '¡Explicación completa!' }] } }] }) + '\r\n\r\n' +
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '\nSegunda parte.' }] } }] });
  const bytes = new TextEncoder().encode(wire);
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  let text = '';
  for await (const chunk of geminiTextStream(new Response(stream))) text += chunk;
  assert.equal(text, '¡Explicación completa!\nSegunda parte.');
});

test('una respuesta bloqueada del proveedor se informa como error y no como éxito vacío', async () => {
  const response = new Response('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n');
  await assert.rejects(async () => { for await (const _chunk of geminiTextStream(response)) {} }, /no puede responder/);
});

test('el cliente apunta a Supabase y no incluye rutas de funciones Netlify', () => {
  const api = read('../js/api.js');
  const ai = read('../js/views/ia.js');
  const config = read('../js/config.js');
  assert.match(config, /functions\/v1/);
  assert.match(api, /x-studia-session/);
  assert.doesNotMatch(api, /\.netlify\/functions/);
  assert.doesNotMatch(ai, /\.netlify\/functions/);
});

test('los adjuntos del chat usan URLs firmadas y mantienen el máximo de 300 MB', () => {
  const api = read('../js/api.js');
  const backend = read('../supabase/functions/app-api/index.ts');
  assert.match(api, /300 \* 1024 \* 1024/);
  assert.match(api, /signedUrl/);
  assert.match(backend, /MAX_FILE = 300 \* 1024 \* 1024/);
  assert.match(backend, /createSignedUpload/);
  assert.match(backend, /createSignedDownload/);
});

test('las cargas tienen cuotas y se contabiliza el tamaño real de Storage en servidor', () => {
  const backend = read('../supabase/functions/app-api/index.ts');
  assert.match(backend, /MAX_USER_STORAGE/);
  assert.match(backend, /MAX_STUDIA_STORAGE_BYTES/);
  assert.match(backend, /listStoredSizes/);
  assert.match(backend, /MAX_UPLOADS_PER_HOUR = 100/);
  assert.match(backend, /ORPHAN_TTL/);
});

test('las claves privadas no se guardan en el archivo de configuración del frontend', () => {
  const config = read('../js/config.js');
  assert.match(config, /SUPABASE_ANON_KEY/);
  assert.doesNotMatch(config, /SERVICE_ROLE_KEY\s*=|GEMINI_API_KEY\s*=|ADMIN_PASSWORD\s*=/);
});
