'use strict';

let allDrugs = [];
let currentResults = [];
let debounceTimer = null;
let lastQuery = '';
let formularyDate = '';

// ─── Init ────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('formulary.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allDrugs = data.drugs;
    formularyDate = data.generated;

    document.getElementById('generated-date').textContent = `Formulary date: ${data.generated}`;
    document.getElementById('data-info').textContent =
      `Formulary date: ${data.generated} \u00b7 ${allDrugs.length} entries`;

    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(input.value), 150);
    });

    window.addEventListener('hashchange', router);
    router();

    if (!window.location.hash.startsWith('#drug/')) {
      input.focus();
    }
  } catch (e) {
    document.getElementById('prompt-message').innerHTML =
      '<p style="color:#ef4444">Error loading formulary data. Make sure formulary.json is present.</p>';
  }
}

// ─── Router ───────────────────────────────────────────────────
function router() {
  const match = window.location.hash.match(/^#drug\/(\d{8})$/);
  if (match) {
    const drug = allDrugs.find(d => d.products.some(p => p.din === match[1]));
    if (drug) {
      renderDrugView(drug);
      return;
    }
  }
  renderSearchView();
}

// ─── Search view ──────────────────────────────────────────────
function renderSearchView() {
  show('header-search-mode');
  hide('header-drug-mode');
  show('search-main');
  hide('drug-view');
  document.title = 'ODB Formulary Search';

  const input = document.getElementById('search-input');
  if (lastQuery && input.value !== lastQuery) {
    input.value = lastQuery;
    search(lastQuery);
  }
  input.focus();
}

// ─── Drug view ────────────────────────────────────────────────
function renderDrugView(drug) {
  hide('header-search-mode');
  show('header-drug-mode');
  hide('search-main');
  show('drug-view');

  document.getElementById('drug-nav-title').textContent =
    `${drug.genericName} \u00b7 ${drug.strength} \u00b7 ${drug.form}`;
  document.title = `${drug.genericName} \u2014 ODB Formulary`;

  document.getElementById('drug-view').innerHTML = buildDrugPage(drug);
  window.scrollTo(0, 0);
}

function buildDrugPage(drug) {
  let h = '';

  // Print-only title block (hidden on screen)
  h += '<div class="print-title">';
  h += `<div class="print-title-name">${esc(drug.genericName)}</div>`;
  h += `<div class="print-title-meta">${esc(drug.category)} \u2014 ${esc(drug.strength)} \u2014 ${esc(drug.form)}</div>`;
  h += `<div class="print-title-source">Ontario Drug Benefit Formulary \u2014 ${esc(formularyDate)}</div>`;
  h += '</div>';

  // Screen drug header
  h += '<div class="drug-page-header">';
  h += `<div class="drug-page-name">${esc(drug.genericName)}</div>`;
  h += `<div class="drug-page-meta">${esc(drug.category)} \u2014 ${esc(drug.strength)} \u2014 ${esc(drug.form)}</div>`;
  h += '<div class="drug-page-badges">';
  h += statusBadge(drug.status);
  if (drug.luCodes && drug.luCodes.length) {
    h += ' ' + drug.luCodes.map(c => `<span class="lu-code">${esc(c)}</span>`).join(' ');
  }
  if (drug.luPeriod) h += ' ' + periodPill(drug.luPeriod);
  h += '</div>';
  h += '</div>';

  // Detail content
  h += buildDetail(drug);

  return h;
}

function navigateToDrug(drug) {
  lastQuery = document.getElementById('search-input').value;
  if (!drug.products || !drug.products.length) return;
  window.location.hash = `#drug/${drug.products[0].din}`;
}

function goBack() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
  renderSearchView();
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

  // Auto-navigate when the query is exactly an 8-digit DIN
  if (/^\d{8}$/.test(query) && shown.length === 1) {
    navigateToDrug(shown[0]);
  }
}

// ─── Render table ─────────────────────────────────────────────
function renderTable(drugs) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';

  drugs.forEach((drug) => {
    const row = document.createElement('tr');
    row.className = 'drug-row';

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

    row.addEventListener('click', () => navigateToDrug(drug));
    tbody.appendChild(row);
  });
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
        h += `<tr class="lu-row-criteria"><td class="lu-code-cell">${esc(note.reasonForUseId)}</td><td>${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      } else {
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
  lastQuery = '';
  input.focus();
  search('');
}

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
