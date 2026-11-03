import PDFDocument from 'pdfkit';

const C = { ink: '#16191a', graphite: '#1b1f1d', lime: '#a3e635', limeDark: '#4d7c0f', muted: '#5b6460', line: '#d4d8d5', soft: '#f3f5f2', red: '#b91c1c', amber: '#b45309' };
const REL = { confirmado: ['Confirmado', C.limeDark], probable: ['Probable', C.amber], no_verificado: ['No verificado', C.red] };
const LBL = { abierto: 'Abierto', en_curso: 'En curso', suspendido: 'Suspendido', cerrado: 'Cerrado', archivado: 'Archivado', baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica', general: 'General', fraude: 'Fraude', extorsion: 'Extorsión', suplantacion: 'Suplantación', acoso: 'Acoso', verificacion: 'Verificación', ciberseguridad: 'Ciberseguridad', persona_desaparecida: 'Persona desaparecida', otro: 'Otro', exito: 'Éxito', sin_resultados: 'Sin resultados', parcial: 'Parcial', fallido: 'Fallido' };
const lbl = (k) => LBL[k] || k;
const fmtDate = (s) => (s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }) : '—');

/** Genera el PDF del informe y devuelve un Buffer. */
export function buildReportPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 90, bottom: 70, left: 56, right: 56 }, bufferPages: true, info: { Title: data.title, Author: 'Telefónica Intelligence', Subject: `Informe ${data.reportCode} — Expediente ${data.case.code}`, Creator: 'Telefónica Intelligence' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const L = doc.page.margins.left;

    const ensure = (h) => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
    const heading = (n, text) => {
      ensure(60);
      doc.moveDown(0.8);
      const y = doc.y;
      doc.rect(L, y, 4, 16).fill(C.limeDark);
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(13).text(`${n}. ${text}`, L + 12, y + 1, { width: W - 12 });
      doc.moveDown(0.4);
      doc.x = L;
    };
    const para = (text, opts = {}) => {
      doc.fillColor(opts.color || C.ink).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10).text(text || '—', L, doc.y, { width: W, align: opts.align || 'left', lineGap: 2 });
      doc.moveDown(0.3);
    };
    const kv = (rows) => {
      for (const [k, v] of rows) {
        ensure(18);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.muted).text(k, L, y, { width: 150 });
        doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(v ?? '—', L + 155, y, { width: W - 155 });
        doc.y = Math.max(doc.y, y + 14);
      }
      doc.moveDown(0.3);
    };
    const table = (cols, rows, opts = {}) => {
      const widths = cols.map((c) => c.w * W);
      const drawHead = () => {
        ensure(40);
        const y = doc.y;
        doc.rect(L, y, W, 18).fill(C.graphite);
        let x = L;
        cols.forEach((c, i) => { doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(c.label, x + 4, y + 5, { width: widths[i] - 8 }); x += widths[i]; });
        doc.y = y + 18;
      };
      drawHead();
      if (!rows.length) { para(opts.empty || 'Sin registros.', { color: C.muted, size: 9 }); return; }
      rows.forEach((row, ri) => {
        const cells = cols.map((c) => String(typeof c.v === 'function' ? c.v(row) : row[c.v] ?? '—'));
        const h = Math.max(...cells.map((t, i) => doc.font(cols[i].mono ? 'Courier' : 'Helvetica').fontSize(cols[i].mono ? 7 : 8).heightOfString(t, { width: widths[i] - 8 }))) + 8;
        if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHead(); }
        const y = doc.y;
        if (ri % 2 === 0) doc.rect(L, y, W, h).fill(C.soft);
        let x = L;
        cells.forEach((t, i) => {
          const color = cols[i].color ? cols[i].color(row) : C.ink;
          doc.fillColor(color).font(cols[i].mono ? 'Courier' : 'Helvetica').fontSize(cols[i].mono ? 7 : 8).text(t, x + 4, y + 4, { width: widths[i] - 8 });
          x += widths[i];
        });
        doc.y = y + h;
      });
      doc.moveDown(0.5);
      doc.x = L;
    };

    // ---- Portada ----
    doc.rect(0, 0, doc.page.width, 250).fill(C.graphite);
    doc.rect(0, 250, doc.page.width, 4).fill(C.lime);
    doc.fillColor(C.lime).font('Helvetica-Bold').fontSize(11).text('TELEFÓNICA INTELLIGENCE', L, 60, { characterSpacing: 2 });
    doc.fillColor('#cfd6d1').font('Helvetica').fontSize(9).text('Plataforma privada de investigación y análisis telefónico', L, 76);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text(data.title, L, 120, { width: W });
    doc.fillColor('#cfd6d1').font('Helvetica').fontSize(11).text(`Expediente ${data.case.code} — ${data.case.title}`, L, doc.y + 6, { width: W });
    doc.y = 280;
    kv([
      ['Informe N.º', data.reportCode],
      ['Expediente', data.case.code],
      ['Fecha de elaboración', fmtDate(data.generatedAt)],
      ['Elaborado por', data.author],
      ['Organización', data.organization],
      ['Estado del expediente', lbl(data.case.status)],
      ['Clasificación / prioridad', `${lbl(data.case.classification)} / ${lbl(data.case.priority)}`],
      ['Período', `${fmtDate(data.case.opened_at)} — ${data.case.closed_at ? fmtDate(data.case.closed_at) : 'en curso'}`],
    ]);
    if (data.isDemo) para('DOCUMENTO DE DEMOSTRACIÓN — CONTIENE EXCLUSIVAMENTE DATOS FICTICIOS', { bold: true, color: C.red, align: 'center' });
    doc.moveDown(1);
    doc.rect(L, doc.y, W, 54).fill(C.soft);
    doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(
      'Documento confidencial. Elaborado exclusivamente con información de fuentes públicas o legítimamente obtenidas y con datos aportados con consentimiento expreso. Cada resultado indica su fuente y su nivel de confiabilidad (Confirmado / Probable / No verificado). Su distribución debe limitarse a personas autorizadas.',
      L + 10, doc.y + 8, { width: W - 20, lineGap: 1.5 }
    );
    doc.addPage();

    let n = 1;
    heading(n++, 'Resumen ejecutivo');
    para(data.summary);
    heading(n++, 'Objetivo de la investigación');
    para(data.objective);

    if (data.entities.length || data.phones.length) {
      heading(n++, 'Personas, entidades y números asociados');
      if (data.entities.length) table([{ label: 'Tipo', v: 'kind', w: 0.15 }, { label: 'Nombre', v: 'name', w: 0.3 }, { label: 'Rol', v: 'role', w: 0.2 }, { label: 'Identificador', v: 'identifier', w: 0.35 }], data.entities);
      if (data.phones.length) table([{ label: 'Número (E.164)', v: 'e164', w: 0.3 }, { label: 'Descripción', v: 'label', w: 0.45 }, { label: 'Entidad', v: 'entity_name', w: 0.25 }], data.phones);
    }

    heading(n++, 'Consultas realizadas');
    para(`Análisis telefónicos: ${data.phoneQueries.length}. Consultas OSINT: ${data.osintQueries.length}.`, { size: 9, color: C.muted });
    table(
      [{ label: 'Fecha', v: (r) => fmtDate(r.created_at), w: 0.2 }, { label: 'Entrada', v: 'input', w: 0.22 }, { label: 'Resultado', v: 'summary', w: 0.43 }, { label: 'Fuente', v: () => 'libphonenumber (UIT/Google)', w: 0.15 }],
      data.phoneQueries, { empty: 'No se realizaron análisis telefónicos.' }
    );
    table(
      [{ label: 'Fecha', v: (r) => fmtDate(r.created_at), w: 0.2 }, { label: 'Herramienta', v: 'toolLabel', w: 0.22 }, { label: 'Objetivo', v: 'target', w: 0.28 }, { label: 'Estado', v: (r) => lbl(r.status), w: 0.1, color: (r) => (r.status === 'fallido' ? C.red : C.ink) }, { label: 'Fuente', v: 'source', w: 0.2 }],
      data.osintQueries, { empty: 'No se realizaron consultas OSINT.' }
    );

    heading(n++, 'Resultados obtenidos');
    para('Hallazgos registrados con su fuente y nivel de confiabilidad:', { size: 9, color: C.muted });
    table(
      [
        { label: 'Hallazgo', v: (r) => r.title + (r.detail ? `\n${r.detail}` : ''), w: 0.46 },
        { label: 'Confiabilidad', v: (r) => REL[r.reliability]?.[0] || r.reliability, w: 0.14, color: (r) => REL[r.reliability]?.[1] || C.ink },
        { label: 'Fuente', v: (r) => r.source_name + (r.source_url ? `\n${r.source_url}` : ''), w: 0.25 },
        { label: 'Fecha', v: (r) => fmtDate(r.observed_at), w: 0.15 },
      ],
      data.findings, { empty: 'No se registraron hallazgos.' }
    );
    if (data.geo.length) {
      para('Ubicaciones compartidas con consentimiento expreso:', { size: 9, color: C.muted });
      table(
        [{ label: 'Persona', v: 'recipient', w: 0.22 }, { label: 'Consentimiento', v: (r) => fmtDate(r.consent_at), w: 0.2 }, { label: 'Coordenadas', v: (r) => `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}`, w: 0.24 }, { label: 'Precisión', v: (r) => (r.accuracy_m ? `±${Math.round(r.accuracy_m)} m` : '—'), w: 0.12 }, { label: 'Recibida', v: (r) => fmtDate(r.received_at), w: 0.22 }],
        data.geo
      );
    }

    heading(n++, 'Fuentes consultadas');
    table([{ label: 'Fuente', v: 'name', w: 0.55 }, { label: 'Referencia', v: 'url', w: 0.33 }, { label: 'Usos', v: 'count', w: 0.12 }], data.sources, { empty: 'Sin fuentes registradas.' });

    heading(n++, 'Evidencias');
    table(
      [{ label: 'Código', v: 'code', w: 0.13 }, { label: 'Título / archivo', v: (r) => `${r.title}\n${r.original_name}`, w: 0.33 }, { label: 'Origen', v: 'origin', w: 0.14 }, { label: 'Incorporada', v: (r) => fmtDate(r.created_at), w: 0.18 }, { label: 'Tamaño', v: (r) => `${(r.size_bytes / 1024).toFixed(1)} KB`, w: 0.1 }, { label: 'Estado', v: (r) => (r.last_verified_ok === 0 ? 'ALTERADA' : 'Íntegra'), w: 0.12, color: (r) => (r.last_verified_ok === 0 ? C.red : C.limeDark) }],
      data.evidence, { empty: 'El expediente no tiene evidencias.' }
    );

    heading(n++, 'Observaciones');
    para(data.observations);
    if (data.notes.length) {
      para('Observaciones registradas en el expediente:', { size: 9, color: C.muted });
      table([{ label: 'Fecha', v: (r) => fmtDate(r.created_at), w: 0.2 }, { label: 'Autor', v: 'author', w: 0.2 }, { label: 'Observación', v: 'body', w: 0.6 }], data.notes);
    }
    heading(n++, 'Limitaciones');
    para(data.limitations);
    heading(n++, 'Conclusiones');
    para(data.conclusions);

    heading(n++, 'Registro de integridad de evidencias');
    para('Hash SHA-256 calculado al momento de la incorporación y resultado de la última verificación:', { size: 9, color: C.muted });
    table(
      [{ label: 'Código', v: 'code', w: 0.13 }, { label: 'SHA-256', v: 'sha256', w: 0.55, mono: true }, { label: 'Última verificación', v: (r) => (r.last_verified_at ? fmtDate(r.last_verified_at) : 'Sin verificar'), w: 0.2 }, { label: 'Resultado', v: (r) => (r.last_verified_ok == null ? '—' : r.last_verified_ok ? 'Coincide' : 'NO coincide'), w: 0.12, color: (r) => (r.last_verified_ok === 0 ? C.red : C.limeDark) }],
      data.evidence, { empty: 'Sin evidencias para verificar.' }
    );
    doc.moveDown(1);
    ensure(50);
    para(`Huella del contenido del informe (SHA-256 de los datos incluidos): ${data.contentHash}`, { size: 8, color: C.muted });

    // ---- Encabezado y pie en todas las páginas ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      if (i > 0) {
        doc.rect(0, 0, doc.page.width, 50).fill(C.graphite);
        doc.rect(0, 50, doc.page.width, 2).fill(C.lime);
        doc.fillColor(C.lime).font('Helvetica-Bold').fontSize(9).text('TELEFÓNICA INTELLIGENCE', L, 20, { characterSpacing: 1.5, lineBreak: false });
        doc.fillColor('#cfd6d1').font('Helvetica').fontSize(8).text(`${data.reportCode} · Expediente ${data.case.code}`, L, 22, { width: W, align: 'right', lineBreak: false });
      }
      doc.moveTo(L, doc.page.height - 45).lineTo(L + W, doc.page.height - 45).strokeColor(C.line).lineWidth(0.5).stroke();
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5).text(`Confidencial${data.isDemo ? ' · DEMOSTRACIÓN — DATOS FICTICIOS' : ''} · Generado ${fmtDate(data.generatedAt)}`, L, doc.page.height - 38, { width: W / 1.5, lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, L, doc.page.height - 38, { width: W, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
