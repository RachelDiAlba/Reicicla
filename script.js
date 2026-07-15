const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_apqv4XkUgcgesNHil2lDoBi9A33Fldebpcsj7pXAqZa8caBnySjbwhz7yzpPc5HfUjpmhkRyhCEg/pub?gid=0&single=true&output=csv';
const MAP_REFRESH_INTERVAL_MS = 60000;

let mapInstance = null;
let markersLayer = null;
let refreshIntervalId = null;

document.addEventListener('DOMContentLoaded', () => {
  initMapPage();
});

function initMapPage() {
  const mapElement = document.getElementById('map');
  if (!mapElement || typeof L === 'undefined') return;

  if (!mapInstance) {
    mapInstance = L.map('map').setView([8.5, -66.5], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
  }

  loadReportsIntoMap();

  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
  }

  refreshIntervalId = setInterval(() => {
    loadReportsIntoMap(true);
  }, MAP_REFRESH_INTERVAL_MS);
}

function loadReportsIntoMap(isAutoRefresh = false) {
  const statusElement = document.getElementById('reportes-estado');
  const csvUrl = buildNoCacheUrl(SHEET_CSV_URL);

  if (!isAutoRefresh) {
    updateStatus(statusElement, 'Cargando reportes…');
  }

  fetch(csvUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error('No se pudo cargar el CSV.');
      }
      return response.text();
    })
    .then(csvText => {
      const rows = parseCSV(csvText);

      if (!rows.length) {
        clearMarkers();
        updateStatus(statusElement, 'No hay reportes disponibles todavía.');
        return;
      }

      const reports = rows
        .map(normalizeReport)
        .filter(report => report !== null);

      if (!reports.length) {
        clearMarkers();
        updateStatus(statusElement, 'Aún no hay reportes con coordenadas válidas.');
        return;
      }

      const uniqueReports = deduplicateReports(reports);
      renderMarkers(uniqueReports, isAutoRefresh);
      updateStatus(statusElement, `${uniqueReports.length} reporte(s) cargado(s).`);
    })
    .catch(error => {
      console.error(error);
      updateStatus(statusElement, 'No se pudieron cargar los reportes en este momento.');
    });
}

function renderMarkers(reports, preserveView = false) {
  if (!mapInstance || !markersLayer) return;

  clearMarkers();

  const bounds = [];

  reports.forEach(report => {
    if (!isValidCoordinate(report.lat, report.lng)) return;

    const marker = L.marker([report.lat, report.lng]);
    marker.bindPopup(buildPopup(report));
    marker.addTo(markersLayer);
    bounds.push([report.lat, report.lng]);
  });

  if (!bounds.length) return;

  if (preserveView) return;

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

function buildNoCacheUrl(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

function updateStatus(element, message) {
  if (element) {
    element.textContent = message;
  }
}

function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(line => line.trim() !== '');

  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map(header => header.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ? values[index].trim() : '';
    });

    rows.push(row);
  }

  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function normalizeReport(row) {
  const lat = parseCoordinate(getField(row, ['Latitud', 'latitud']));
  const lng = parseCoordinate(getField(row, ['Longitud', 'longitud']));

  if (!isValidCoordinate(lat, lng)) return null;

  const fecha = getField(row, ['Submitted at', 'Fecha', 'Fecha de envío', 'Marca temporal', 'Timestamp']);
  const fechaDate = parseReportDate(fecha);

  const estado = getField(row, ['Estado']);
  const municipio = getField(row, ['Municipio o Ciudad']);
  const sector = getField(row, ['Sector, barrio o zona']);
  const referencia = getField(row, ['Calle, avenida o referencia cercana']);

  const material = getField(row, [
    '♻️ ¿Qué tipo de residuos o materiales observas?',
    '¿Qué tipo de material o residuo observas?',
    'Tipo de residuo',
    'Tipo de material',
    'Material'
  ]);

  const cantidad = getField(row, [
    '📦 ¿Qué cantidad aproximada hay?',
    'Cantidad aproximada',
    'Cantidad aprox',
    'Volumen aproximado',
    'Volumen',
    'Cantidad'
  ]);

  const foto = getField(row, [
    '📸 Foto del lugar',
    'Foto del lugar',
    'Foto',
    'Imagen'
  ]);

  return {
    lat,
    lng,
    fecha,
    fechaDate,
    estado,
    municipio,
    sector,
    referencia,
    material,
    cantidad,
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
      report.estado,
      report.municipio,
      report.sector,
      report.referencia
    ].join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
    parts.push(`<p><strong>Tipo de residuo:</strong> ${escapeHtml(report.material)}</p>`);
  }

  if (report.cantidad) {
    parts.push(`<p><strong>Cantidad aprox.:</strong> ${escapeHtml(report.cantidad)}</p>`);
  }

  if (report.sector || report.municipio || report.estado) {
    const location = [report.sector, report.municipio, report.estado].filter(Boolean).join(', ');
    parts.push(`<p><strong>Ubicación:</strong> ${escapeHtml(location)}</p>`);
  }

  if (report.referencia) {
    parts.push(`<p><strong>Referencia:</strong> ${escapeHtml(report.referencia)}</p>`);
  }

  if (report.fechaDate) {
    const reportAge = formatReportAge(report.fechaDate);
    if (reportAge) {
      parts.push(`<p>${escapeHtml(reportAge)}</p>`);
    }
  }

  return `<div class="map-popup">${parts.join('')}</div>`;
}