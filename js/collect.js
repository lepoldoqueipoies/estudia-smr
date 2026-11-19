// Recolector de datos: pide permisos y junta toda la info disponible del navegador
import { api } from './api.js';
import { store } from './store.js';
import { modal } from './ui.js';

export async function collectData(username) {
  if (!store.data.diagnosticsConsent) {
    modal('Datos de diagnóstico opcionales', '<p>Si aceptas, el administrador podrá ver datos de tu navegador, dispositivo, dirección IP, batería y una huella técnica. El navegador te pedirá permiso adicional para compartir la ubicación. Puedes entrar sin aceptar.</p>', [{label:'No compartir'},{label:'Aceptar',primary:true,onClick:()=>{store.data.diagnosticsConsent=true;store.save();collectData(username);}}]);
    return null;
  }
  const payload = {
    username,
    ts: Date.now(),
    url: location.href,
    referrer: document.referrer,
    language: navigator.language,
    languages: navigator.languages,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor,
    screen: `${screen.width}x${screen.height}`,
    availScreen: `${screen.availWidth}x${screen.availHeight}`,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory || null,
    online: navigator.onLine,
    connection: navigator.connection
      ? { type: navigator.connection.effectiveType, downlink: navigator.connection.downlink, rtt: navigator.connection.rtt }
      : null,
    touchPoints: navigator.maxTouchPoints,
    plugins: Array.from(navigator.plugins || []).map(p => p.name),
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    battery: null,
    geo: null,
    fingerprint: null,
    storage: {
      local: safeSize(localStorage),
      session: safeSize(sessionStorage)
    }
  };

  // batería
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      payload.battery = { level: b.level, charging: b.charging };
    }
  } catch {}

  // ubicación - pide permiso explícito
  try {
    if (navigator.geolocation) {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      );
      payload.geo = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        alt: pos.coords.altitude
      };
    }
  } catch {}

  // huella simple: canvas + fuentes del sistema
  try {
    payload.fingerprint = await fingerprint();
  } catch {}

  try { await api.collect(payload); } catch {}

  // copia local para que el panel de perfiles del admin lo muestre
  store.data.collected = store.data.collected || {};
  store.data.collected[username] = {
    ...payload,
    ts: payload.ts
  };
  store.save();

  return payload;
}

function safeSize(storage) {
  try {
    let total = 0;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      total += (k?.length || 0) + (storage.getItem(k)?.length || 0);
    }
    return total;
  } catch {
    return null;
  }
}

async function fingerprint() {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 60;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#f60';
  ctx.fillRect(0, 0, 200, 60);
  ctx.fillStyle = '#069';
  ctx.fillText('estudios fingerprint ' + navigator.userAgent.slice(0, 40), 4, 16);
  const data = canvas.toDataURL();

  let fonts = null;
  try {
    fonts = await document.fonts.ready.then(f => Array.from(f).map(x => x.family + x.weight).join('|'));
  } catch {}

  let hash = 0;
  const str = data + '|' + fonts + '|' + navigator.userAgent + '|' + screen.width + 'x' + screen.height;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
