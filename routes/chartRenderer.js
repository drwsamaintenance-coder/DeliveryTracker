// Renders pie / bar / column chart images (PNG buffers) for the Analytics
// XLSX export. ExcelJS (the library used everywhere else in this app for
// building styled worksheets) has no support for writing native, editable
// Excel chart objects — that's a real gap in the library, not something we
// can configure around. The practical workaround, and the one used here, is
// to draw the chart ourselves with node-canvas and embed the result as a
// picture, the same way the association's logo is embedded elsewhere. It
// looks identical to a native chart in the workbook; it just can't be
// double-clicked to edit its data series afterward.
const { createCanvas } = require('canvas');

const PALETTE = ['#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646', '#4F81BD', '#A5A5A5'];
const OTHERS_COLOR = '#A5A5A5';

function colorFor(label, index) {
  if (label === 'Others') return OTHERS_COLOR;
  return PALETTE[index % PALETTE.length];
}

function money(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

function truncateLabel(label, max = 22) {
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

// data: [{ label, value }], already top-N + Others if applicable.
function renderPieChart(data, { title = 'Supplier Spend Breakdown (%)', width = 720, height = 420 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1C3B6E';
  ctx.font = 'bold 18px "DejaVu Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 30);

  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = width * 0.36, cy = height / 2 + 10, r = Math.min(cx, height / 2) - 40;

  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colorFor(d.label, i);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    const pct = ((d.value / total) * 100);
    if (pct >= 4) {
      const midAngle = angle + slice / 2;
      const lx = cx + Math.cos(midAngle) * r * 0.62;
      const ly = cy + Math.sin(midAngle) * r * 0.62;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px "DejaVu Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${pct.toFixed(0)}%`, lx, ly);
    }
    angle += slice;
  });

  // Legend
  const legendX = width * 0.68, legendYStart = height / 2 - (data.length * 24) / 2;
  ctx.textAlign = 'left';
  data.forEach((d, i) => {
    const y = legendYStart + i * 24;
    ctx.fillStyle = colorFor(d.label, i);
    ctx.fillRect(legendX, y, 14, 14);
    ctx.fillStyle = '#333333';
    ctx.font = '12px "DejaVu Sans", sans-serif';
    const pct = ((d.value / total) * 100).toFixed(1);
    ctx.fillText(`${truncateLabel(d.label)} (${pct}%)`, legendX + 20, y + 11);
  });

  return canvas.toBuffer('image/png');
}

// Vertical bars — supplier names along the x-axis.
function renderColumnChart(data, { title = 'Total Spend by Supplier', width = 760, height = 420 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1C3B6E';
  ctx.font = 'bold 18px "DejaVu Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 30);

  const marginLeft = 70, marginRight = 30, marginTop = 55, marginBottom = 90;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barSlot = plotW / data.length;
  const barWidth = Math.min(barSlot * 0.55, 90);

  // Axis
  ctx.strokeStyle = '#999999';
  ctx.beginPath();
  ctx.moveTo(marginLeft, marginTop);
  ctx.lineTo(marginLeft, marginTop + plotH);
  ctx.lineTo(marginLeft + plotW, marginTop + plotH);
  ctx.stroke();

  data.forEach((d, i) => {
    const barH = (d.value / maxVal) * plotH;
    const x = marginLeft + i * barSlot + (barSlot - barWidth) / 2;
    const y = marginTop + plotH - barH;
    ctx.fillStyle = colorFor(d.label, i);
    ctx.fillRect(x, y, barWidth, barH);

    ctx.fillStyle = '#333333';
    ctx.font = '11px "DejaVu Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(money(d.value), x + barWidth / 2, y - 6);

    ctx.save();
    ctx.translate(x + barWidth / 2, marginTop + plotH + 14);
    ctx.rotate(-Math.PI / 8);
    ctx.textAlign = 'right';
    ctx.fillText(truncateLabel(d.label, 18), 0, 0);
    ctx.restore();
  });

  return canvas.toBuffer('image/png');
}

// Horizontal bars — supplier names along the y-axis (reads top-to-bottom by rank).
function renderBarChart(data, { title = 'Total Spend by Supplier', width = 760, height = 420 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1C3B6E';
  ctx.font = 'bold 18px "DejaVu Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 30);

  const marginLeft = 160, marginRight = 90, marginTop = 55, marginBottom = 30;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barSlot = plotH / data.length;
  const barHeight = Math.min(barSlot * 0.55, 42);

  data.forEach((d, i) => {
    const barW = (d.value / maxVal) * plotW;
    const y = marginTop + i * barSlot + (barSlot - barHeight) / 2;
    ctx.fillStyle = colorFor(d.label, i);
    ctx.fillRect(marginLeft, y, barW, barHeight);

    ctx.fillStyle = '#333333';
    ctx.font = '12px "DejaVu Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(truncateLabel(d.label, 20), marginLeft - 10, y + barHeight / 2 + 4);

    ctx.textAlign = 'left';
    ctx.fillText(money(d.value), marginLeft + barW + 8, y + barHeight / 2 + 4);
  });

  return canvas.toBuffer('image/png');
}

function renderChart(chartType, data, opts) {
  if (chartType === 'column') return renderColumnChart(data, opts);
  if (chartType === 'bar') return renderBarChart(data, opts);
  return renderPieChart(data, opts);
}

module.exports = { renderChart, renderPieChart, renderBarChart, renderColumnChart, PALETTE, colorFor };
