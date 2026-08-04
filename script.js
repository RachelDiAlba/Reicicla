const API_URL = 'https://script.google.com/macros/s/AKfycbz1JMd7IgAScrqjlSZ25QlIkOI6OBxbgtptdrLGXSdJuk6qz2P8MTxWgB_Z-vlZXUY/exec';
const MAP_REFRESH_INTERVAL_MS = 30000;

let mapInstance = null;
let markersLayer = null;
let refreshIntervalId = null;
let lastPayloadSignature = '';

document.addEventListener('DOMContentLoaded', () => {
  initMapPage();
});

function initMapPage() {
  const mapElement = document.getElementById('map');
  if (!mapElement || typeof L === 'undefined') return;

  if (!mapInstance) {
    mapInstance = L.map('map').setView([10.59901, -66.9346], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
  }

  loadReportsIntoMap(false);

  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
  }

  refreshIntervalId = setInterval(() => {
    loadReportsIntoMap(true);
  }, MAP_REFRESH_INTERVAL_MS);
}

async function loadReportsIntoMap(isAutoRefresh = false) {
  const statusElement = document.getElementById('reportes-estado');

  if (!isAutoRefresh) {
    updateStatus(statusElement, 'Cargando reportes…');
  }

  try {
    const data = await fetchJson(buildNoCacheUrl(API_URL));

    if (!data || data.ok === false) {
      clearMarkers();
      updateStatus(statusElement, data && data.error ? data.error : 'No se pudieron cargar los reportes.');
      return;
    }

    const reports = (data.rows || [])
      .map(normalizeReport)
      .filter(Boolean)
      .filter(report => isValidCoordinate(report.lat, report.lng));

    if (!reports.length) {
      clearMarkers();
      updateStatus(statusElement, 'Aún no hay reportes con coordenadas válidas.');
      return;
    }

    const uniqueReports = deduplicateReports(reports);
    const signature = buildSignature(uniqueReports, data.updatedAt);

    if (signature === lastPayloadSignature && isAutoRefresh) {
      updateStatus(statusElement, `${uniqueReports.length} reporte(s) cargado(s).`);
      return;
    }

    lastPayloadSignature = signature;
    renderMarkers(uniqueReports);
    updateStatus(statusElement, `${uniqueReports.length} reporte(s) cargado(s).`);
  } catch (error) {
    console.error(error);
    updateStatus(statusElement, 'No se pudieron cargar los reportes en este momento.');
  }
}

function renderMarkers(reports) {
  if (!mapInstance || !markersLayer) return;

  clearMarkers();

  const bounds = [];

  reports.forEach(report => {
    const marker = L.marker([report.lat, report.lng]);
    marker.bindPopup(buildPopup(report));
    marker.addTo(markersLayer);
    bounds.push([report.lat, report.lng]);
  });

  if (!bounds.length) return;

  if (bounds.length === 1) {
    mapInstance.setView(bounds[0], 14);
  } else {
    mapInstance.fitBounds(bounds, { padding: [30, 30] });
  }
}

function clearMarkers() {
  if (markersLayer) {
    markersLayer.clearLayers();
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo obtener la respuesta.');
  return await response.json();
}

function buildNoCacheUrl(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

function updateStatus(element, message) {
  if (element) element.textContent = message;
}

function normalizeReport(row) {
  const lat = parseCoordinate(getField(row, ['latitud', 'Latitud']));
  const lng = parseCoordinate(getField(row, ['longitud', 'Longitud']));

  const fecha = getField(row, ['Submitted at', 'submitted at', '📅 Fecha', 'Fecha', 'Timestamp', 'Marca temporal']);
  const fechaDate = parseReportDate(fecha);

  const referencia = getField(row, ['📍Referencia cercana (recomendado)', 'Referencia cercana', 'Referencia']);
  const material = getField(row, ['🗑️¿Qué encontraste?', '¿Qué encontraste?', 'Material', 'Tipo de residuo']);
  const cantidad = getField(row, ['📦 Cantidad aproximada', 'Cantidad aproximada', 'Cantidad']);
  const riesgo = getField(row, ['⚠️ ¿Representa un riesgo?', 'Representa un riesgo', 'Riesgo']);
  const riesgoDetalle = getField(row, [
    'Indique el riesgo',
    'Indique el riesgo (Bloquea una vía)',
    'Indique el riesgo (Afecta la salud)',
    'Indique el riesgo (Puede contaminar áreas naturales)',
    'Indique el riesgo (Puede causar accidentes)',
    'Indique el riesgo (Otro)'
  ]);
  const foto = getField(row, ['📸 Foto (recomendado)', 'Foto', 'Imagen']);

  return {
    lat,
    lng,
    fecha,
    fechaDate,
    referencia,
    material,
    cantidad,
    riesgo,
    riesgoDetalle,
    foto
  };
}

function getField(row, possibleNames) {
  for (const name of possibleNames) {
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      return String(row[name] || '').trim();
    }
  }
  return '';
}

function parseCoordinate(value) {
  const text = String(value || '').trim().replace(',', '.');
  const num = parseFloat(text);
  return Number.isFinite(num) ? num : null;
}

function isValidCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function parseReportDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ').trim();

  const isoLikeMatch = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (isoLikeMatch) {
    const year = parseInt(isoLikeMatch[1], 10);
    const month = parseInt(isoLikeMatch[2], 10) - 1;
    const day = parseInt(isoLikeMatch[3], 10);
    const hours = parseInt(isoLikeMatch[4] || '0', 10);
    const minutes = parseInt(isoLikeMatch[5] || '0', 10);
    const seconds = parseInt(isoLikeMatch[6] || '0', 10);
    const parsed = new Date(year, month, day, hours, minutes, seconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const dmyMatch = normalized.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const rawYear = parseInt(dmyMatch[3], 10);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const hours = parseInt(dmyMatch[4] || '0', 10);
    const minutes = parseInt(dmyMatch[5] || '0', 10);
    const seconds = parseInt(dmyMatch[6] || '0', 10);
    const parsed = new Date(year, month, day, hours, minutes, seconds);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
  }

  const directDate = new Date(normalized);
  if (!Number.isNaN(directDate.getTime())) return directDate;

  return null;
}

function formatReportAge(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const reportDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = today.getTime() - reportDay.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Reportado hoy';
  if (diffDays === 1) return 'Reportado hace 1 día';
  return `Reportado hace ${diffDays} días`;
}

function deduplicateReports(reports) {
  const seen = new Set();

  return reports.filter(report => {
    const key = [
      report.fecha,
      report.lat,
      report.lng,
      report.referencia,
      report.material,
      report.cantidad,
      report.riesgo,
      report.riesgoDetalle
    ].join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSignature(reports, updatedAt) {
  return JSON.stringify({
    updatedAt: updatedAt || '',
    items: reports.map(r => [
      r.lat,
      r.lng,
      r.fecha,
      r.referencia,
      r.material,
      r.cantidad,
      r.riesgo,
      r.riesgoDetalle
    ])
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildPopup(report) {
  const parts = [];

  if (report.foto) {
    parts.push(
      `<p><img src="${escapeHtml(report.foto)}" alt="Foto del lugar reportado" style="width:100%; max-width:220px; height:auto; border-radius:12px; display:block; margin-bottom:0.75rem;"></p>`
    );
  }

  if (report.material) {
    parts.push(`<p><strong>Qué se encontró:</strong> ${escapeHtml(report.material)}</p>`);
  }

  if (report.cantidad) {
    parts.push(`<p><strong>Cantidad aprox.:</strong> ${escapeHtml(report.cantidad)}</p>`);
  }

  if (report.referencia) {
    parts.push(`<p><strong>Referencia:</strong> ${escapeHtml(report.referencia)}</p>`);
  }

  if (report.riesgo) {
    parts.push(`<p><strong>Riesgo:</strong> ${escapeHtml(report.riesgo)}</p>`);
  }

  if (report.riesgoDetalle) {
    parts.push(`<p><strong>Detalle:</strong> ${escapeHtml(report.riesgoDetalle)}</p>`);
  }

  if (report.fechaDate) {
    const reportAge = formatReportAge(report.fechaDate);
    if (reportAge) {
      parts.push(`<p>${escapeHtml(reportAge)}</p>`);
    }
  }

  return `<div class="map-popup">${parts.join('')}</div>`;
}
