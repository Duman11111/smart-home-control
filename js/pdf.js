import { rooms, entryRoom, getRoomDevices, roomStates, history, energyUse, format } from './state.js';

const pdfDateOptions = { timeZone: 'Asia/Qyzylorda' };
const pdfDateTime = new Intl.DateTimeFormat('kk-KZ', {
  ...pdfDateOptions, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});

let pdfLibrary;
let cachedFontBase64;
let lastPdfUrl;

async function getPdfFontBase64() {
  if (cachedFontBase64) return cachedFontBase64;
  const response = await fetch('assets/fonts/NotoSans-Regular.ttf');
  if (!response.ok) throw Error('Font load failed');
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  cachedFontBase64 = btoa(binary);
  return cachedFontBase64;
}

function getPdfLibrary() {
  if (pdfLibrary) return pdfLibrary;
  pdfLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
    script.crossOrigin = 'anonymous';
    script.integrity = 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3';
    script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(Error('PDF generator unavailable'));
    script.onerror = () => reject(Error('Could not load the PDF generator'));
    document.head.append(script);
  }).catch(error => {
    pdfLibrary = null;
    throw error;
  });
  return pdfLibrary;
}

function buildMonitoringPdf(Pdf, fontBase64, snapshots, generatedAt) {
  const doc = new Pdf({ unit:'mm', format:'a4', compress:true, putOnlyUsedFonts:true });
  doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
  doc.addFont('NotoSans-Regular.ttf', 'Noto Sans', 'normal');
  doc.setFont('Noto Sans', 'normal');
  doc.setProperties({ title:'Ақылды үй мониторингі', subject:'Құрылғылар мен датчиктер есебі', creator:'Smart Home Control' });
  const width = 210, margin = 16, content = width - margin * 2;
  const ink = '#28221e', muted = '#665950', accent = '#79502e';
  const rule = '#e6dacb', panel = '#fbf7f1';
  const stamp = pdfDateTime.format(generatedAt);
  const quantity = (value, unit = '') => Number.isFinite(value) ? format.format(value) + (unit ? ' ' + unit : '') : '–';
  const write = (value, x, y, size, color = ink, options) => {
    doc.setFontSize(size).setTextColor(color).text(String(value), x, y, options);
  };
  const header = (title, subtitle) => {
    doc.setFillColor('#39271d').rect(0, 0, width, 38, 'F');
    write('SMART HOME CONTROL', margin, 10, 9, '#f0c795');
    write(title, margin, 26, 21, '#fff4e7');
    write(stamp, width - margin, 10, 9, '#f3dbc4', { align:'right' });
    write(subtitle, margin, 47, 10, muted);
  };

  const total = snapshots.reduce((sum, room) => sum + room.records.length, 0);
  header('Ақылды үй мониторингі', snapshots.length + ' бөлме • ' + total + ' тарих жазбасы • Браузердегі ағымдағы деректер');
  const cardWidth = (content - 6) / 2;
  snapshots.forEach((room, index) => {
    const left = margin + (index % 2) * (cardWidth + 6);
    const top = 55 + Math.floor(index / 2) * 104;
    const valueX = left + cardWidth - 5;
    doc.setFillColor(panel).setDrawColor(rule).roundedRect(left, top, cardWidth, 98, 3, 3, 'FD');
    write(room.name, left + 5, top + 10, 14, accent);
    write('Температура: ' + quantity(room.air, '°C'), left + 5, top + 19, 9);
    write('Ылғал: ' + quantity(room.humidity, '%'), valueX, top + 19, 9, ink, { align:'right' });
    write('Жарық: ' + quantity(room.lux, 'лк'), left + 5, top + 26, 9);
    write('Қуат: ' + quantity(room.power, 'кВт'), valueX, top + 26, 9, ink, { align:'right' });
    doc.setDrawColor(rule).line(left + 5, top + 31, valueX, top + 31);
    room.equipment.forEach(([label, value], row) => {
      const y = top + 39 + row * 5.7;
      write(label, left + 5, y, 9, muted);
      write(value, valueX, y, 9, ink, { align:'right' });
    });
    write('Тарих: ' + room.records.length + ' жазба', left + 5, top + 93, 8.5, accent);
  });

  const columns = [
    ['Күні мен уақыты', 19], ['°C', 63], ['%', 80], ['лк', 96], ['кВт', 113], ['Әрекет', 135]
  ];
  for (const room of snapshots) {
    if (!room.records.length) continue;
    const startTable = () => {
      doc.addPage();
      header('Өлшемдер тарихы', room.name + ' • ' + room.records.length + ' жазба • Жаңасынан ескісіне қарай');
      doc.setFillColor('#eee1d2').roundedRect(margin, 54, content, 9, 1.5, 1.5, 'F');
      columns.forEach(([label, x]) => write(label, x, 60, 8.5, accent));
      return 64;
    };
    let y = startTable();
    [...room.records].reverse().forEach((record, index) => {
      doc.setFontSize(8.5);
      const action = doc.splitTextToSize(String(record.action || 'Өлшем жазылды'), 55);
      const rowHeight = Math.max(7, 4.1 + 3.5 * action.length);
      if (y + rowHeight > 275) y = startTable();
      if (index % 2 === 0) doc.setFillColor(panel).rect(margin, y, content, rowHeight, 'F');
      const when = new Date(record.at);
      const values = [
        Number.isFinite(when.valueOf()) ? pdfDateTime.format(when) : '–',
        quantity(record.air), quantity(record.humidity), quantity(record.lux), quantity(record.power)
      ];
      values.forEach((value, col) => write(value, columns[col][1], y + 4.9, 8.5, col === 0 ? muted : ink));
      action.forEach((line, lineIndex) => write(line, columns[5][1], y + 4.9 + lineIndex * 3.5, 8.5));
      y += rowHeight;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page).setDrawColor(rule).line(margin, 282, width - margin, 282);
    write('Smart Home Control • IoT есебі', margin, 288, 8.5, muted);
    write(page + ' / ' + pages, width - margin, 288, 8.5, muted, { align:'right' });
  }
  return doc;
}

export function initPdfExport(pdfDownloadButton, pdfDownloadStatus, roomDataReady) {
  pdfDownloadButton.addEventListener('click', async () => {
    pdfDownloadButton.disabled = true;
    pdfDownloadStatus.textContent = 'PDF есебі дайындалып жатыр…';
    try {
      const [Pdf, fontBase64] = await Promise.all([getPdfLibrary(), getPdfFontBase64(), roomDataReady]);
      const generatedAt = new Date();
      const snapshots = rooms.map((name, index) => {
        const state = roomStates[index];
        const equipment = getRoomDevices(index).map(([key, label, , on, off]) => [label, state[key] ? on : off]);
        if (index === entryRoom) equipment.push(['Есік', state.door ? 'Ашық' : 'Жабық']);
        equipment.push(['Автоматты басқару', state.auto ? 'Қосулы' : 'Өшірулі']);
        return { name, air: state.air, humidity: state.humidity, lux: state.lux, power: energyUse(state, index), equipment, records: [...history[index]] };
      });
      const fileDate = generatedAt.toLocaleDateString('sv-SE', pdfDateOptions);
      const blob = buildMonitoringPdf(Pdf, fontBase64, snapshots, generatedAt).output('blob');
      if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl);
      lastPdfUrl = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = lastPdfUrl;
      download.download = 'smart-home-monitoring-' + fileDate + '.pdf';
      download.textContent = 'Файлды қайта жүктеу';
      pdfDownloadStatus.replaceChildren('PDF дайын · ' + snapshots.length + ' бөлме · ', download);
      download.click();
    } catch {
      pdfDownloadStatus.textContent = 'PDF жасалмады. Интернет байланысын тексеріп, қайталап көріңіз.';
    } finally {
      pdfDownloadButton.disabled = false;
    }
  });
}
