'use strict';

// ─── State ────────────────────────────────────────────────────
// allDrugs: full list loaded from formulary.json on startup
// currentResults: the filtered subset currently shown in the search table
// debounceTimer: used to delay search until the user stops typing
// lastQuery: remembered so we can restore the search when navigating back
// formularyDate: shown in the print title block (e.g. "2026-02-25")
let allDrugs = [];
let currentResults = [];
let debounceTimer = null;
let lastQuery = '';
let formularyDate = '';

// ─── Init ────────────────────────────────────────────────────
// Fetches formulary.json, wires up the search input, and kicks off routing.
async function init() {
  try {
    const res = await fetch('formulary.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allDrugs = data.drugs;
    formularyDate = data.generated;

    // Populate the formulary date shown in the header and footer
    document.getElementById('generated-date').textContent = `Formulary date: ${data.generated}`;
    document.getElementById('data-info').textContent =
      `Formulary date: ${data.generated} \u00b7 ${allDrugs.length} entries`;

    // Debounce the search input so we don't filter on every keystroke
    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(input.value), 150);
    });

    // Listen for back/forward navigation and handle hash-based routing
    window.addEventListener('hashchange', router);
    router();

    // Only auto-focus the search box if we're not already deep-linking to a drug
    if (!window.location.hash.startsWith('#drug/')) {
      input.focus();
    }
  } catch (e) {
    document.getElementById('prompt-message').innerHTML =
      '<p style="color:#ef4444">Error loading formulary data. Make sure formulary.json is present.</p>';
  }
}

// ─── Router ───────────────────────────────────────────────────
// Reads the URL hash to decide which view to show.
// #drug/<8-digit DIN>  →  drug detail page for that DIN
// anything else        →  search view
function router() {
  const match = window.location.hash.match(/^#drug\/(\d{8})$/);
  if (match) {
    // Look up the drug whose product list contains this DIN
    const drug = allDrugs.find(d => d.products.some(p => p.din === match[1]));
    if (drug) {
      renderDrugView(drug);
      return;
    }
  }
  renderSearchView();
}

// ─── Search view ──────────────────────────────────────────────
// Shows the search UI and restores the previous query if there was one.
function renderSearchView() {
  show('header-search-mode');
  hide('header-drug-mode');
  show('search-main');
  hide('drug-view');
  document.title = 'ODB Formulary Search';

  // Restore the last search so the user doesn't lose their place
  const input = document.getElementById('search-input');
  if (lastQuery && input.value !== lastQuery) {
    input.value = lastQuery;
    search(lastQuery);
  }
  input.focus();
}

// ─── Drug view ────────────────────────────────────────────────
// Hides the search UI and renders the full drug detail page.
function renderDrugView(drug) {
  hide('header-search-mode');
  show('header-drug-mode');
  hide('search-main');
  show('drug-view');

  // Update the sticky header to show the drug name as a breadcrumb
  document.getElementById('drug-nav-title').textContent =
    `${drug.genericName} \u00b7 ${drug.strength} \u00b7 ${drug.form}`;
  document.title = `${drug.genericName} \u2014 ODB Formulary`;

  document.getElementById('drug-view').innerHTML = buildDrugPage(drug);
  window.scrollTo(0, 0);
}

// Builds the full HTML for the drug detail page.
// Includes a hidden print-only title block and a visible screen header,
// followed by the shared detail content (LU criteria, products, notes).
function buildDrugPage(drug) {
  let h = '';

  // Deduplicate brand names from all products (e.g. "Breo Ellipta, generic X")
  const brandNames = [...new Set(drug.products.map(p => p.name))].join(', ');

  // ── Print-only title block ───────────────────────────────────
  // This is hidden on screen (display:none) and only appears when printing.
  // It replaces the sticky header with a clean document title for faxing.
  h += '<div class="print-title">';
  if (brandNames) h += `<div class="print-title-brands">${esc(brandNames)}</div>`;
  h += `<div class="print-title-name">${esc(drug.genericName)}</div>`;
  h += `<div class="print-title-meta">${esc(drug.category)} \u2014 ${esc(drug.strength)} \u2014 ${esc(drug.form)}</div>`;
  h += `<div class="print-title-source">Ontario Drug Benefit Formulary \u2014 ${esc(formularyDate)}</div>`;
  h += '</div>';

  // ── Screen header ────────────────────────────────────────────
  // Shows brand names prominently, with the generic name and
  // ODB status / LU codes / auth period below.
  h += '<div class="drug-page-header">';
  if (brandNames) h += `<div class="drug-page-brands">${esc(brandNames)}</div>`;
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

  // ── Detail sections (LU criteria, products, therapeutic note) ─
  h += buildDetail(drug);

  return h;
}

// Sets the URL hash to navigate to a drug's detail page.
// Saves the current search query so it can be restored on back navigation.
// Uses the first product's DIN as the unique route key (e.g. #drug/02012345).
function navigateToDrug(drug) {
  lastQuery = document.getElementById('search-input').value;
  if (!drug.products || !drug.products.length) return;
  window.location.hash = `#drug/${drug.products[0].din}`;
}

// Clears the hash from the URL and returns to the search view.
// Uses replaceState so the browser back button goes back to the
// previous page rather than to a blank hash.
function goBack() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
  renderSearchView();
}

// ─── Search ──────────────────────────────────────────────────
// Filters allDrugs against the query and renders the results table.
// Each search term must match at least one of the drug's searchNames
// (which include generic name, all brand names, and all DINs).
function search(query) {
  query = query.trim();

  if (!query) {
    show('prompt-message');
    hide('results-container');
    hide('no-results');
    document.getElementById('result-count').textContent = '';
    return;
  }

  // Split into individual words so "flu tab" matches FLUCONAZOLE tablet
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

  // Cap results at 500 to keep the table fast; prompt the user to refine if needed
  const MAX = 500;
  const shown = currentResults.slice(0, MAX);
  document.getElementById('result-count').textContent =
    currentResults.length > MAX
      ? `Showing ${MAX} of ${currentResults.length} results — refine your search`
      : `${currentResults.length} result${currentResults.length !== 1 ? 's' : ''}`;

  renderTable(shown);

  // If the user typed an exact 8-digit DIN and it matched one drug, go straight to it
  if (/^\d{8}$/.test(query) && shown.length === 1) {
    navigateToDrug(shown[0]);
  }
}

// ─── Render table ─────────────────────────────────────────────
// Creates a table row for each drug. Clicking a row navigates to
// that drug's detail page via the hash router.
function renderTable(drugs) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';

  drugs.forEach((drug) => {
    const row = document.createElement('tr');
    row.className = 'drug-row';

    // Show up to 2 brand names in the table; full list is on the detail page
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
// Generates the three detail sections used on the drug detail page:
//   1. LU criteria table (shown first — most clinically important)
//   2. Products & DINs grid
//   3. Therapeutic note (de-emphasized, shown last)
function buildDetail(drug) {
  let h = '<div class="detail-content">';

  // ── 1. LU Criteria ───────────────────────────────────────────
  // Each row in the LU criteria table has a type that controls its style:
  //   T  = indication title (heading row)
  //   R  = main criteria line (has a reasonForUseId / LU code number)
  //   N  = note
  //   W  = warning
  //   C  = contraindication
  //   (no type, no reasonForUseId) = continuation text for the previous criteria
  //   (special text) = "LU Authorization Period: ..." gets its own styled row
  if (drug.luCriteria && drug.luCriteria.length > 0) {
    h += '<div class="detail-section detail-lu">';
    h += '<table class="lu-table">';
    h += '<thead><tr><th class="lu-col-code">LU Code</th><th>Clinical Criteria</th></tr></thead>';
    h += '<tbody>';

    drug.luCriteria.forEach(note => {
      const text = (note.text || '').trim();
      if (!text) return;

      if (note.type === 'T') {
        // Indication heading — spans both columns, styled as a section divider
        h += `<tr class="lu-row-indication"><td colspan="2">${esc(text)}</td></tr>`;
      } else if (text.startsWith('LU Authorization Period:')) {
        // Auth period — extracted and highlighted so it's easy to spot
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
        // Main criteria row — LU code number in the left cell, criteria text on the right
        h += `<tr class="lu-row-criteria"><td class="lu-code-cell">${esc(note.reasonForUseId)}</td><td>${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      } else {
        // Continuation text — left cell empty, right cell continues from the row above
        h += `<tr class="lu-row-continuation"><td></td><td>${esc(text).replace(/\n/g, '<br>')}</td></tr>`;
      }
    });

    h += '</tbody></table></div>';
  }

  // ── 2. Products / DINs ───────────────────────────────────────
  // Lists every brand name and its DIN. Products marked notABenefit
  // (not reimbursed by ODB) are styled differently.
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

  // ── 3. Therapeutic note ──────────────────────────────────────
  // General clinical notes from the formulary (not LU-specific).
  // De-emphasized visually since LU criteria are more actionable.
  if (drug.note) {
    h += `<div class="detail-section detail-thnote"><h3>Therapeutic Notes</h3><div class="entry-note">${esc(drug.note)}</div></div>`;
  }

  h += '</div>';
  return h;
}

// ─── Helpers ──────────────────────────────────────────────────

// Returns a coloured badge HTML string for a drug's ODB benefit status.
function statusBadge(status) {
  switch (status) {
    case 'general_benefit': return '<span class="badge badge-gb">General Benefit</span>';
    case 'limited_use':     return '<span class="badge badge-lu">Limited Use</span>';
    case 'not_a_benefit':   return '<span class="badge badge-nab">Not a Benefit</span>';
    default: return esc(status);
  }
}

// Returns a styled pill for the LU authorization period.
// Indefinite periods get a different colour to stand out.
function periodPill(period) {
  if (!period) return '&mdash;';
  const isIndef = period.toLowerCase().includes('indefinite');
  return `<span class="period-pill${isIndef ? ' indefinite' : ''}">${esc(period)}</span>`;
}

// Returns a short preview of brand names for the search results table.
// Shows up to 2 names; if there are more, appends "+N more".
function productSummary(products) {
  if (!products || products.length === 0) return '';
  const names = products.map(p => p.name);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

// Escapes a string for safe insertion into HTML.
// Prevents XSS from any drug names or criteria text that contain special characters.
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Convenience wrappers to show/hide elements by id.
function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

// Resets the search input and clears the results.
function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  lastQuery = '';
  input.focus();
  search('');
}

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
