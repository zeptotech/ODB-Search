'use strict';

let allDrugs = [];
let currentResults = [];
let debounceTimer = null;

// ─── Init ────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('formulary.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allDrugs = data.drugs;

    document.getElementById('generated-date').textContent = `Formulary date: ${data.generated}`;
    document.getElementById('data-info').textContent =
      `Formulary date: ${data.generated} \u00b7 ${allDrugs.length} entries`;

    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(input.value), 150);
    });

    input.focus();
  } catch (e) {
    document.getElementById('prompt-message').innerHTML =
      '<p style="color:#ef4444">Error loading formulary data. Make sure formulary.json is present.</p>';
  }
}

// ─── Search ──────────────────────────────────────────────────
function search(query) {
  query = query.trim();

  if (!query) {
    show('prompt-message');
    hide('results-container');
    hide('no-results');
    document.getElementById('result-count').textContent = '';
    return;
  }

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);

  currentResults = allDrugs.filter(drug =>
    terms.every(term => drug.searchNames.some(name => name.includes(term)))
  );

  hide('prompt-message');

  if (currentResults.length === 0) {
    hide('results-container');
    show('no-results');
    document.getElementById('result-count').textContent = 'No results';
    return;
  }

  hide('no-results');
  show('results-container');

  const MAX = 500;
  const shown = currentResults.slice(0, MAX);
  document.getElementById('result-count').textContent =
    currentResults.length > MAX
      ? `Showing ${MAX} of ${currentResults.length} results — refine your search`
      : `${currentResults.length} result${currentResults.length !== 1 ? 's' : ''}`;

  renderTable(shown);

  // Auto-expand when the query is exactly an 8-digit DIN
  if (/^\d{8}$/.test(query) && shown.length === 1) {
    const row = document.querySelector('#results-body tr.drug-row');
    if (row) toggleDetail(0, shown[0], row);
  }
}

// ─── Render table ─────────────────────────────────────────────
function renderTable(drugs) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';

  drugs.forEach((drug, idx) => {
    const row = document.createElement('tr');
    row.className = 'drug-row';
    row.dataset.idx = idx;

    const productPreview = productSummary(drug.products);

    row.innerHTML = `
      <td>
        <div class="brand-name">${esc(productPreview)}</div>
        <div class="generic-name">${esc(drug.genericName)}</div>
        <div class="category-label">${esc(drug.category)}</div>
      </td>
      <td>${esc(drug.strength)}</td>
      <td>${esc(drug.form)}</td>
      <td>${statusBadge(drug.status)}</td>
      <td>${drug.luCodes && drug.luCodes.length ? drug.luCodes.map(c => `<span class="lu-code">${esc(c)}</span>`).join(', ') : '<span style="color:#9ca3af">&mdash;</span>'}</td>
      <td>${drug.luPeriod ? periodPill(drug.luPeriod) : '<span style="color:#9ca3af">&mdash;</span>'}</td>
    `;

    row.addEventListener('click', () => toggleDetail(idx, drug, row));
    tbody.appendChild(row);
  });
}

// ─── Detail toggle ────────────────────────────────────────────
function toggleDetail(idx, drug, row) {
  const existing = document.getElementById(`detail-${idx}`);
  if (existing) {
    existing.remove();
    row.classList.remove('expanded');
    return;
  }

  row.classList.add('expanded');

  const detailRow = document.createElement('tr');
  detailRow.id = `detail-${idx}`;
  detailRow.className = 'detail-row';

  const td = document.createElement('td');
  td.colSpan = 6;
  td.innerHTML = buildDetail(drug);

  detailRow.appendChild(td);
  row.insertAdjacentElement('afterend', detailRow);
}

// ─── Build detail HTML ────────────────────────────────────────
function buildDetail(drug) {
  let h = '<div class="detail-content">';

  // ── 1. LU Criteria (most important — shown first) ────────────
  if (drug.luCriteria && drug.luCriteria.length > 0) {
    h += '<div class="detail-section detail-lu">';
    h += '<table class="lu-table">';
    h += '<thead><tr><th class="lu-col-code">LU (Limited Use) Code</th><th>Clinical Criteria</th></tr></thead>';
    h += '<tbody>';

    drug.luCriteria.forEach(note => {
      const text = (note.text || '').trim();
      if (!text) return;

      if (note.type === 'T') {
        // Indication heading — spans both columns
        h += `<tr class="lu-row-indication"><td colspan="2">${esc(text)}</td></tr>`;
      } else if (text.startsWith('LU Authorization Period:')) {
        const period = text.replace('LU Authorization Period:', '').trim();
        const isIndef = period.toLowerCase() === 'indefinite';
        h += `<tr class="lu-row-period${isIndef ? ' indefinite' : ''}"><td colspan="2">LU Authorization Period: <strong>${esc(period)}</strong></td></tr>`;
      } else if (note.type === 'W') {
        h += `<tr class="lu-row-warning"><td colspan="2">${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      } else if (note.type === 'C') {
        h += `<tr class="lu-row-contraindication"><td colspan="2">${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      } else if (note.type === 'N') {
        h += `<tr class="lu-row-note"><td colspan="2"><strong>NOTE:</strong> ${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      } else if (note.reasonForUseId) {
        // Main criteria line — code in left cell
        h += `<tr class="lu-row-criteria"><td class="lu-code-cell">${esc(note.reasonForUseId)}</td><td>${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      } else {
        // Continuation text — empty left cell
        h += `<tr class="lu-row-continuation"><td></td><td>${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      }
    });

    h += '</tbody></table></div>';
  }

  // ── 2. Products / DINs ───────────────────────────────────────
  h += '<div class="detail-section detail-products"><h3>Products &amp; DINs</h3><div class="products-grid">';
  drug.products.forEach(p => {
    const nabClass = p.notABenefit ? ' nab' : '';
    h += `<div class="product-chip${nabClass}">`;
    h += esc(p.name);
    h += `<span class="din"><span class="din-label">DIN</span> ${esc(p.din)}</span>`;
    if (p.notABenefit) h += `<span class="nab-label">not reimbursed</span>`;
    h += '</div>';
    if (p.note) {
      h += `<div class="entry-note" style="width:100%;margin-top:0.3rem">${esc(p.note)}</div>`;
    }
  });
  h += '</div></div>';

  // ── 3. Therapeutic note (least important — shown last) ───────
  if (drug.note) {
    h += `<div class="detail-section detail-thnote"><h3>Therapeutic Notes</h3><div class="entry-note">${esc(drug.note)}</div></div>`;
  }

  h += '</div>';
  return h;
}

// ─── Helpers ──────────────────────────────────────────────────
function statusBadge(status) {
  switch (status) {
    case 'general_benefit': return '<span class="badge badge-gb">General Benefit</span>';
    case 'limited_use':     return '<span class="badge badge-lu">Limited Use</span>';
    case 'not_a_benefit':   return '<span class="badge badge-nab">Not a Benefit</span>';
    default: return esc(status);
  }
}

function periodPill(period) {
  if (!period) return '&mdash;';
  const isIndef = period.toLowerCase().includes('indefinite');
  return `<span class="period-pill${isIndef ? ' indefinite' : ''}">${esc(period)}</span>`;
}

function productSummary(products) {
  if (!products || products.length === 0) return '';
  const names = products.map(p => p.name);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  input.focus();
  search('');
}

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
