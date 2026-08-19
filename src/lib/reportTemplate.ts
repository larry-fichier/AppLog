// Gabarit de rapport officiel HELIOS (en-tête République du Cameroun bilingue,
// KPI, tableaux, signatures) — utilisé par tous les rapports de l'application
// pour garantir un rendu identique à celui du Chef Service Administratif (CSA).

export interface ReportSection {
  title: string;
  html: string;
}

export interface ReportOptions {
  docTitle: string;
  docSubtitle: string;
  sections: ReportSection[];
  dateStr?: string;
  signatureTitle: string;
}

export function formatReportDate(d: Date = new Date()): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export function formatReportTime(d: Date = new Date()): string {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Construit une rangée de tableau alternée (zébrage clair), les colonnes à partir
// de `centerFrom` sont centrées — reprend le style des tableaux du rapport CSA.
export function tableRows(rows: string[][], centerFrom = 1): string {
  return rows.map((cols, i) => {
    const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
    const cells = cols.map((c, ci) => `<td${ci >= centerFrom ? ' style="text-align:center"' : ""}>${c}</td>`).join("");
    return `<tr style="background:${bg}">${cells}</tr>`;
  }).join("");
}

export function renderTable(headers: string[], bodyHtml: string, centerFrom = 1): string {
  const head = headers.map((h, i) => `<th${i >= centerFrom ? ' class="center"' : ""}>${h}</th>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

export function buildReportHtml(opts: ReportOptions): string {
  const dateStr = opts.dateStr ?? formatReportDate();

  const sectionsHtml = opts.sections.map(s => `
  <div class="section-title">${s.title}</div>
  ${s.html}`).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${opts.docTitle} — ${dateStr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #1e293b; font-size: 11px; background: #fff; }
    @page { size: A4; margin: 1.5cm 1.8cm; }

    /* ── En-tête officielle ── */
    .header-official {
      display: grid;
      grid-template-columns: 1fr 110px 1fr;
      align-items: center;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 2.5px solid #f39c12;
      margin-bottom: 14px;
    }
    .header-fr { text-align: center; line-height: 1.6; }
    .header-en { text-align: center; line-height: 1.6; }
    .header-logo { text-align: center; }
    .header-logo img { width: 100px; height: 100px; object-fit: contain; }
    .header-fr p, .header-en p { font-size: 7.5px; font-weight: bold; color: #1a252f; }
    .header-fr .stars, .header-en .stars { font-size: 6px; color: #94a3b8; font-weight: normal; }
    .header-fr .main, .header-en .main { font-size: 9.5px; font-weight: 900; color: #1a252f; }
    .header-fr .sub-info, .header-en .sub-info { font-size: 7px; font-style: italic; margin-top: 6px; color: #555; text-align: center; }

    /* ── Titre du document ── */
    .doc-title { text-align: center; margin: 12px 0 4px; }
    .doc-title h1 { font-size: 14px; font-weight: 900; text-transform: uppercase; color: #1a252f; letter-spacing: 1px; }
    .doc-title p  { font-size: 9px; color: #64748b; margin-top: 2px; }
    .orange-line  { border: none; border-top: 2px solid #f39c12; margin: 10px 0; }

    /* ── Section titre ── */
    .section-title {
      font-size: 9px; font-weight: 900; text-transform: uppercase;
      letter-spacing: 1.5px; color: #0d1b2a;
      border-left: 3px solid #f39c12;
      padding-left: 8px; margin: 18px 0 8px;
    }

    /* ── KPIs ── */
    .kpis { display: grid; gap: 8px; margin-bottom: 4px; }
    .kpi {
      background: #0d1b2a; border-radius: 6px; padding: 10px 6px;
      text-align: center; color: white;
    }
    .kpi-val { font-size: 22px; font-weight: 900; line-height: 1; }
    .kpi-lbl { font-size: 7px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-top: 3px; }

    /* ── Tableaux ── */
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
    thead tr { background: #0d1b2a; }
    thead th {
      color: white; padding: 7px 8px; text-align: left;
      font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.8px;
      border-bottom: 2px solid #f39c12;
    }
    thead th.center { text-align: center; }
    tbody td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    tbody tr:hover { background: #f1f5f9 !important; }

    /* ── Signature ── */
    .signatures {
      display: flex; justify-content: flex-end;
      margin-top: 36px; padding-top: 16px;
      border-top: 1px solid #e2e8f0;
    }
    .sig-block { text-align: center; width: 45%; }
    .sig-title { font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; color: #1a252f; margin-bottom: 40px; }
    .sig-line { border-top: 1px solid #94a3b8; margin: 0 20px; padding-top: 4px; font-size: 7.5px; color: #94a3b8; }

    /* ── Print ── */
    @media print {
      .no-print { display: none; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- ══ EN-TÊTE OFFICIELLE ══ -->
  <div class="header-official">
    <div class="header-fr">
      <p>REPUBLIQUE DU CAMEROUN</p>
      <p class="stars">************</p>
      <p style="font-style:italic">Paix – Travail – Patrie</p>
      <p class="stars">************</p>
      <p>PRESIDENCE DE LA REPUBLIQUE</p>
      <p class="stars">************</p>
      <p>SERVICES DU CONSEILLER TECHNIQUE</p>
      <p class="stars">************</p>
      <p class="main">PROJET HELIOS</p>
      <p class="stars">************</p>
      <p class="sub-info">Yaoundé, le ${dateStr}</p>
    </div>

    <div class="header-logo">
      <img src="/logo.png" alt="Logo HELIOS" />
    </div>

    <div class="header-en">
      <p>REPUBLIC OF CAMEROON</p>
      <p class="stars">************</p>
      <p style="font-style:italic">Peace – Work – Fatherland</p>
      <p class="stars">************</p>
      <p>PRESIDENCY OF THE REPUBLIC</p>
      <p class="stars">************</p>
      <p>TECHNICAL ADVISOR SERVICES</p>
      <p class="stars">************</p>
      <p class="main">HELIOS PROJECT</p>
      <p class="stars">************</p>
      <p class="sub-info">N° ______/SCT/PRC/HELIOS</p>
    </div>
  </div>

  <!-- ══ TITRE DOCUMENT ══ -->
  <div class="doc-title">
    <h1>${opts.docTitle}</h1>
    <p>${opts.docSubtitle}</p>
  </div>
  <hr class="orange-line" />
  ${sectionsHtml}

  <!-- ══ SIGNATURE ══ -->
  <div class="signatures">
    <div class="sig-block">
      <div class="sig-title">${opts.signatureTitle}</div>
      <div class="sig-line">Signature &amp; Cachet</div>
    </div>
  </div>

</body>
</html>`;
}

export function openReportPrintWindow(html: string): void {
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 800);
  }
}
