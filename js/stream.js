// Complete SSE events may span arbitrary network packets (including UTF-8 characters).
export async function* geminiTextStream(response) {
  if (!response.body) throw new Error('Gemini no devolvió una respuesta');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', emitted = false;
  function parse(event) {
    const raw = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!raw || raw === '[DONE]') return '';
    const json = JSON.parse(raw);
    if (json.error) throw new Error(json.error.message || 'Error de Gemini');
    const candidate = json.candidates?.[0];
    if (json.promptFeedback?.blockReason || ['SAFETY','RECITATION','PROHIBITED_CONTENT'].includes(candidate?.finishReason)) throw new Error('Gemini no puede responder a esta solicitud');
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Gemini alcanzó el límite de la respuesta');
    return (candidate?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  }
  try {
    while (true) {
      const {done,value} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value,{stream:true});
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const text = parse(buffer.slice(0,match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (text) { emitted=true; yield text; }
      }
      if (done) break;
    }
    if (buffer.trim()) { const text=parse(buffer); if (text) {emitted=true;yield text;} }
    if (!emitted) throw new Error('Gemini terminó sin devolver texto');
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
