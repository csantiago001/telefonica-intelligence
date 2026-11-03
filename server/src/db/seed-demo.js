// Datos de DEMOSTRACIÓN — todos ficticios. Solo se cargan con APP_MODE=demo y en una base de datos separada.
// Dominios: example.com/.org/.net (reservados por RFC 2606). Personas y números: inventados.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, encrypt, sha256 } from '../lib/crypto.js';
import { analyzePhone } from '../lib/phone.js';
import { setSetting } from '../lib/settings.js';
import { consentText } from '../routes/geo.js';
import { buildReportPdf } from '../lib/pdf.js';
import { DEFAULT_LIMITATIONS } from '../routes/reports.js';

const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 3600e3).toISOString();
const DEMO_TAG = '[DEMO] ';

export async function seedDemo(db, config) {
  if (db.get('SELECT COUNT(*) n FROM users').n > 0) return false;
  setSetting(db, 'system.organization', 'Unidad de Investigación (DEMOSTRACIÓN)');
  const role = (k) => db.get('SELECT id FROM roles WHERE key = ?', k).id;
  const mkUser = (u, name, r, pw, credits) =>
    db.run(
      'INSERT INTO users (username, full_name, email, password_hash, role_id, credits, is_demo, password_changed_at, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
      u, name, `${u}@example.com`, hashPassword(pw), role(r), credits, ago(40), ago(40), ago(0), ago(1)
    ).lastInsertRowid;
  const admin = mkUser('admin.demo', 'Laura Méndez (ficticia)', 'admin', 'Demo2026admin', 5000);
  const analyst = mkUser('analista.demo', 'Andrés Rojas (ficticio)', 'analista', 'Demo2026analista', 480);
  const viewer = mkUser('consultor.demo', 'Camila Ortiz (ficticia)', 'consultor', 'Demo2026consultor', 0);
  for (const [uid, amt] of [[admin, 5000], [analyst, 500]]) {
    db.run("INSERT INTO credit_transactions (user_id, amount, balance_after, kind, note, performed_by, is_demo, created_at) VALUES (?, ?, ?, 'asignacion', 'Saldo inicial de demostración', ?, 1, ?)", uid, amt, amt, admin, ago(40));
  }

  const cases = [
    ['Suplantación de entidad bancaria por SMS', 'fraude', 'alta', 'en_curso', 'Determinar el origen de mensajes que suplantan a un banco ficticio y documentar los dominios usados.', ['smishing', 'dominios'], 26],
    ['Llamadas de extorsión a comerciante', 'extorsion', 'critica', 'abierto', 'Analizar números reportados por la víctima y organizar evidencias para la denuncia.', ['extorsion', 'llamadas'], 12],
    ['Verificación de identidad de proveedor', 'verificacion', 'media', 'cerrado', 'Verificar la existencia pública de la empresa proveedora y su dominio.', ['due-diligence'], 38],
    ['Perfil falso en marketplace', 'suplantacion', 'media', 'en_curso', 'Recopilar evidencias públicas de un anuncio fraudulento.', ['marketplace'], 9],
    ['Acoso telefónico reiterado', 'acoso', 'alta', 'suspendido', 'Organizar el registro de llamadas aportado por la persona afectada.', ['acoso'], 20],
    ['Revisión de dominio sospechoso', 'ciberseguridad', 'baja', 'archivado', 'Evaluar registros públicos de un dominio reportado.', ['phishing'], 45],
    ['Localización consentida de familiar', 'persona_desaparecida', 'alta', 'cerrado', 'Coordinar con el familiar el envío voluntario de su ubicación mediante enlace con consentimiento.', ['consentimiento'], 6],
  ];
  const caseIds = [];
  cases.forEach(([title, cls, prio, status, obj, tags, d], i) => {
    const code = `TI-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`;
    const id = db.run(
      'INSERT INTO cases (code, title, description, objective, classification, priority, status, tags, opened_at, closed_at, owner_id, created_by, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      code, DEMO_TAG + title, 'Expediente ficticio creado para demostrar la plataforma. Ninguna persona, número ni entidad corresponde a datos reales.', obj, cls, prio, status, JSON.stringify(tags), ago(d), ['cerrado', 'archivado'].includes(status) ? ago(Math.max(0, d - 5)) : null, i % 2 ? analyst : admin, admin, ago(d), ago(Math.max(0, d - 3))
    ).lastInsertRowid;
    caseIds.push(id);
    db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', id, 'creado', `Expediente ${code} creado`, admin, ago(d));
    if (status !== 'abierto') db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', id, 'estado', `abierto → ${status}. Motivo: avance de la investigación (demo)`, analyst, ago(Math.max(0, d - 4)));
  });

  const entities = [
    [0, 'organizacion', 'Banco Ficticio S.A.', 'Entidad suplantada', 'NIT 000.000.000-0 (ficticio)'],
    [0, 'dominio', 'banco-ficticio-seguro.example', 'Dominio usado en SMS', 'example (reservado)'],
    [1, 'persona', 'Comerciante afectado (ficticio)', 'Víctima', 'CC ficticia 0000'],
    [1, 'persona', 'Desconocido', 'Presunto extorsionista', '—'],
    [2, 'organizacion', 'Proveedora Ejemplo Ltda.', 'Proveedor', 'example.org'],
    [3, 'cuenta', 'vendedor_falso_123', 'Perfil anunciante', 'Marketplace ficticio'],
    [6, 'persona', 'Familiar (ficticio)', 'Persona que comparte ubicación', 'Consentimiento expreso'],
  ];
  for (const [ci, kind, name, roleTxt, ident] of entities) db.run('INSERT INTO case_entities (case_id, kind, name, role, identifier, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', caseIds[ci], kind, name, roleTxt, ident, 'Dato ficticio de demostración', analyst, ago(10));

  const phones = [
    [0, '+57 300 555 0101'], [0, '+57 310 555 0102'], [1, '+57 320 555 0199'], [1, '+57 601 555 0123'], [1, '+52 55 5555 0100'], [3, '+57 315 555 0177'], [4, '+57 301 555 0144'], [4, '+34 600 555 010'], [6, '+57 304 555 0166'],
  ];
  const extraPhones = ['+1 202 555 0143', '+57 604 555 0110', '+44 20 7946 0958', '12345', '+57 300 555', '+57 605 555 0188', '+51 1 555 0100', '+54 11 5555 0101'];
  let pq = 0;
  phones.forEach(([ci, num], i) => {
    const a = analyzePhone(num, 'CO');
    const when = ago(i * 3 % 28, i);
    const qid = db.run('INSERT INTO phone_queries (input, default_country, e164, valid, country, result, case_id, user_id, credits_used, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)', num, 'CO', a.e164 || null, a.valid ? 1 : 0, a.country || null, JSON.stringify(a), caseIds[ci], analyst, when).lastInsertRowid;
    if (a.e164) db.run('INSERT OR IGNORE INTO case_phones (case_id, e164, label, phone_query_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', caseIds[ci], a.e164, 'Número ficticio — ' + a.summary.slice(0, 80), qid, analyst, when);
    db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', caseIds[ci], 'consulta_telefonica', `${num} → ${a.summary}`, analyst, when);
    pq++;
  });
  extraPhones.forEach((num, i) => {
    const a = analyzePhone(num, 'CO');
    db.run('INSERT INTO phone_queries (input, default_country, e164, valid, country, result, case_id, user_id, credits_used, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, 1, ?)', num, 'CO', a.e164 || null, a.valid ? 1 : 0, a.country || null, JSON.stringify(a), i % 2 ? analyst : admin, ago((i * 4) % 29, i * 2));
    pq++;
  });

  const DEMO_SRC = 'Datos de demostración (ficticios — no proceden de una consulta real)';
  const osint = [
    [0, 'dns', 'banco-ficticio-seguro.example', 'exito', 22], [0, 'rdap', 'banco-ficticio-seguro.example', 'exito', 21], [0, 'ct', 'banco-ficticio-seguro.example', 'exito', 21],
    [0, 'link', 'https://banco-ficticio-seguro.example/login', 'fallido', 20], [2, 'rdap', 'example.org', 'exito', 35], [2, 'wayback', 'https://example.org', 'exito', 35],
    [3, 'search', 'vendedor_falso_123', 'sin_resultados', 8], [5, 'dns', 'portal-premios.example', 'sin_resultados', 44], [1, 'search', '+573205550199', 'parcial', 11],
    [null, 'ip', '192.0.2.10', 'fallido', 2], [null, 'dns', 'example.net', 'exito', 1], [null, 'link', 'https://example.com', 'exito', 4],
  ];
  for (const [ci, tool, target, status, d] of osint) {
    db.run('INSERT INTO osint_queries (tool, target, status, source, result, error, duration_ms, case_id, user_id, credits_used, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
      tool, target, status, DEMO_SRC, JSON.stringify({ demo: true, nota: 'Registro ficticio para ilustrar el historial. Ejecute una consulta real para obtener datos de la fuente.' }),
      status === 'fallido' ? 'Ejemplo de consulta fallida (demo): la fuente no respondió' : null, 800 + d * 37, ci == null ? null : caseIds[ci], analyst, status === 'fallido' ? 0 : 1, ago(d, 3));
  }

  const findings = [
    [0, 'Dominio registrado 3 días antes de la campaña de SMS', 'Fecha de registro cercana al inicio de los mensajes reportados.', 'confirmado'],
    [0, 'Subdominio "login." imita el portal del banco suplantado', 'Observado en certificados públicos.', 'confirmado'],
    [0, 'Posible relación con campaña anterior de 2025', 'Coincidencia de patrón de nombres; requiere corroboración.', 'probable'],
    [1, 'Número reportado en foros públicos como "cobro extorsivo"', 'Comentarios anónimos sin verificación de autoría.', 'no_verificado'],
    [1, 'El número +57 601… corresponde a telefonía fija de Bogotá/Cundinamarca', 'Según plan de numeración de la CRC.', 'confirmado'],
    [2, 'La empresa proveedora mantiene sitio web activo desde hace más de 10 años', 'Capturas históricas disponibles.', 'confirmado'],
    [3, 'Anuncio retirado tras la denuncia', 'Observación del analista.', 'probable'],
  ];
  findings.forEach(([ci, title, detail, rel], i) => db.run(
    'INSERT INTO findings (case_id, title, detail, source_name, source_url, reliability, observed_at, created_by, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
    caseIds[ci], title, detail + ' (dato ficticio)', DEMO_SRC, 'https://example.com/fuente-ficticia', rel, ago(20 - i * 2), analyst, ago(20 - i * 2)
  ));

  db.run('INSERT INTO case_notes (case_id, body, author_id, created_at) VALUES (?, ?, ?, ?)', caseIds[0], 'Se solicitó a la entidad suplantada (ficticia) el listado de mensajes reportados por clientes.', analyst, ago(18));
  db.run('INSERT INTO case_notes (case_id, body, author_id, created_at) VALUES (?, ?, ?, ?)', caseIds[1], 'La víctima aportó capturas del registro de llamadas. Se incorporaron como evidencias.', analyst, ago(10));

  // Evidencias ficticias reales (archivos de texto cifrados con hash verificable)
  const ev = [
    [0, 'Captura de SMS recibido', 'captura_pantalla', 'sms_recibido.txt', 'Mensaje (FICTICIO): "Su cuenta será bloqueada. Ingrese a https://banco-ficticio-seguro.example/login"'],
    [1, 'Registro de llamadas entrantes', 'registro_llamadas', 'registro_llamadas.csv', 'fecha,numero,duracion\n2026-10-20 09:14,+573205550199,00:02:31\n2026-10-21 18:40,+573205550199,00:01:05\n(DATOS FICTICIOS)'],
    [2, 'Certificado de existencia (ejemplo)', 'documento', 'certificado_ejemplo.txt', 'Documento de ejemplo FICTICIO para la demostración.'],
    [3, 'Exportación del anuncio', 'exportacion_web', 'anuncio.html', '<html><title>Anuncio ficticio</title><body>Producto inexistente — DEMO</body></html>'],
  ];
  ev.forEach(([ci, title, origin, name, content], i) => {
    const buf = Buffer.from(content, 'utf8');
    const storage = crypto.randomUUID() + '.enc';
    fs.writeFileSync(path.join(config.evidenceDir, storage), encrypt(config.masterKey, buf));
    const hash = sha256(buf);
    const code = `EV-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`;
    const id = db.run(
      'INSERT INTO evidence (code, case_id, title, description, origin, original_name, mime_type, size_bytes, sha256, storage_name, metadata, acquired_at, uploaded_by, last_verified_at, last_verified_ok, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)',
      code, caseIds[ci], DEMO_TAG + title, 'Archivo ficticio de demostración', origin, name, name.endsWith('.html') ? 'text/html' : name.endsWith('.csv') ? 'text/csv' : 'text/plain', buf.length, hash, storage, JSON.stringify({ detectedType: 'text', demo: true }), ago(15 - i), analyst, ago(2), ago(15 - i)
    ).lastInsertRowid;
    db.run('INSERT INTO evidence_custody (evidence_id, action, detail, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, 'incorporacion', `Archivo ${name}. SHA-256 ${hash}`, analyst, '127.0.0.1', ago(15 - i));
    db.run('INSERT INTO evidence_custody (evidence_id, action, detail, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, 'verificacion_integridad', 'Hash coincide', admin, '127.0.0.1', ago(2));
  });

  // Ubicación con consentimiento (ficticia)
  const org = 'Unidad de Investigación (DEMOSTRACIÓN)';
  const mkLink = (ci, label, purpose, status, expDays, consent) => db.run(
    'INSERT INTO geo_links (token_hash, token_hint, case_id, recipient_label, purpose, status, expires_at, consent_at, consent_text, revoked_at, revoked_by, created_by, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
    sha256(crypto.randomBytes(16)), 'demo00', ci == null ? null : caseIds[ci], label, purpose, status, new Date(Date.now() + expDays * 864e5).toISOString(),
    consent ? ago(5) : null, consent ? consentText(org, purpose, label) : null, status === 'revocado' ? ago(1) : null, status === 'revocado' ? 'titular' : null, analyst, ago(6)
  ).lastInsertRowid;
  const l1 = mkLink(6, 'Familiar (ficticio)', 'Confirmar que la persona se encuentra a salvo, a solicitud de su familia.', 'activo', 1, true);
  db.run('INSERT INTO geo_locations (link_id, latitude, longitude, accuracy_m, captured_at, received_at) VALUES (?, ?, ?, ?, ?, ?)', l1, 4.60971, -74.08175, 35, ago(5), ago(5));
  db.run('INSERT INTO geo_locations (link_id, latitude, longitude, accuracy_m, captured_at, received_at) VALUES (?, ?, ?, ?, ?, ?)', l1, 4.6486, -74.0628, 22, ago(4), ago(4));
  mkLink(1, 'Víctima (ficticia)', 'Coordinar punto de entrega de evidencias con la víctima.', 'pendiente', 0.2, false);
  mkLink(4, 'Persona afectada (ficticia)', 'Verificar ubicación declarada en la denuncia.', 'revocado', 2, true);

  // Créditos consumidos
  let bal = 500;
  for (let i = 0; i < 12; i++) {
    bal -= 1 + (i % 3);
    db.run("INSERT INTO credit_transactions (user_id, amount, balance_after, kind, operation, reference, performed_by, is_demo, created_at) VALUES (?, ?, ?, 'consumo', ?, ?, ?, 1, ?)", analyst, -(1 + (i % 3)), bal, ['phone_analysis', 'osint_dns', 'osint_rdap'][i % 3], `demo:${i}`, analyst, ago(28 - i * 2));
  }
  db.run('UPDATE users SET credits = ? WHERE id = ?', bal, analyst);

  db.run("INSERT INTO alerts (level, title, detail, link, created_at) VALUES ('warning', 'Bienvenido al entorno de demostración', 'Todos los datos son ficticios y se restablecen al reiniciar el servicio.', '/', ?)", ago(0));
  for (const [a, u, d] of [['auth.login', 'admin.demo', 1], ['case.created', 'admin.demo', 26], ['evidence.uploaded', 'analista.demo', 15], ['osint.query', 'analista.demo', 21], ['geo.consent_accepted', null, 5], ['auth.login_failed', null, 3]]) {
    db.run('INSERT INTO audit_log (user_id, username, action, detail, ip, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', u ? (u === 'admin.demo' ? admin : analyst) : null, u, a, 'Registro ficticio de demostración', '127.0.0.1', a.includes('failed') ? 'warning' : 'info', ago(d));
  }

  // Informe de ejemplo
  const c0 = db.get('SELECT * FROM cases WHERE id = ?', caseIds[2]);
  const content = { title: `Informe de investigación — ${c0.title}`, summary: 'Informe de ejemplo generado automáticamente con datos ficticios.', objective: c0.objective, observations: 'Sin observaciones (demo).', limitations: DEFAULT_LIMITATIONS, conclusions: 'Conclusión ficticia: la empresa proveedora tiene presencia pública verificable. Documento solo para demostración.' };
  const pdf = await buildReportPdf({
    ...content, case: c0, reportCode: `INF-${new Date().getFullYear()}-0001`, generatedAt: ago(30), author: 'Laura Méndez (ficticia)', organization: org, isDemo: true,
    entities: [], phones: [], notes: [], phoneQueries: [], osintQueries: [], geo: [], sources: [{ name: DEMO_SRC, url: '—', count: 2 }],
    findings: db.all('SELECT * FROM findings WHERE case_id = ?', c0.id), evidence: db.all('SELECT * FROM evidence WHERE case_id = ?', c0.id), contentHash: sha256(JSON.stringify(content)),
  });
  const repDir = path.join(config.dataDir, 'informes');
  fs.mkdirSync(repDir, { recursive: true });
  const code = `INF-${new Date().getFullYear()}-0001`;
  fs.writeFileSync(path.join(repDir, `${code}.pdf.enc`), encrypt(config.masterKey, pdf));
  db.run('INSERT INTO reports (code, case_id, title, content, sha256, file_name, created_by, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', code, c0.id, content.title, JSON.stringify(content), sha256(pdf), `${code}.pdf.enc`, admin, ago(30));
  return { users: 3, cases: caseIds.length, phoneQueries: pq };
}
