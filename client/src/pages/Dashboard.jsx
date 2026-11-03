import { Link, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import {
  FolderKanban, FolderCheck, Activity, FileArchive, Coins, Phone, Radar, MapPin, FileText, Plus, AlertTriangle, Lightbulb, LayoutDashboard, Siren, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../lib/context.jsx';
import { useFetch, Kpi, Loading, ErrorBox, PageHead, StatusBadge, PriorityBadge, Empty } from '../components/ui.jsx';
import { fmtNum, timeAgo, CASE_STATUS, CASE_CLASS, EVENT_LABEL, RELIABILITY } from '../lib/format.js';

const COLORS = ['#a3e635', '#6cb6ff', '#f5b942', '#b69cff', '#f26d6d', '#5eead4', '#84908a', '#fda4af', '#bef264'];
const STATUS_COLORS = { abierto: '#a3e635', en_curso: '#6cb6ff', suspendido: '#f5b942', cerrado: '#84908a', archivado: '#b69cff' };
const REL_COLORS = { confirmado: '#a3e635', probable: '#f5b942', no_verificado: '#f26d6d' };
const tip = { contentStyle: { background: '#1b201d', border: '1px solid #343c37', borderRadius: 10, fontSize: 12 }, labelStyle: { color: '#e7ece8' }, itemStyle: { color: '#b9c2bc' } };

export default function Dashboard() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch('/dashboard');
  if (loading && !data) return <Loading text="Preparando tablero…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const k = data.kpis;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const alerts = [...data.computedAlerts, ...data.alerts];
  const activity = data.activity.map((d) => ({ ...d, label: d.date.slice(5).split('-').reverse().join('/') }));

  return (
    <>
      <PageHead eyebrow="Centro de operaciones" icon={LayoutDashboard} title={`${greet}, ${user.fullName.split(' ')[0]}`} sub="Resumen de la actividad investigativa de los últimos 30 días.">
        {can('cases.write') && <button className="btn primary" onClick={() => nav('/expedientes?nuevo=1')}><Plus size={16} /> Nuevo expediente</button>}
        {can('phone.analyze') && <button className="btn" onClick={() => nav('/analisis')}><Phone size={16} /> Analizar número</button>}
      </PageHead>

      <div className="grid g4">
        <Kpi icon={FolderKanban} label="Expedientes activos" value={fmtNum(k.activeCases)} foot={`${k.criticalCases} de prioridad alta/crítica`} onClick={() => nav('/expedientes?status=activos')} />
        <Kpi icon={FolderCheck} label="Expedientes cerrados" value={fmtNum(k.closedCases)} foot={`${k.totalCases} en total`} tone="blue" onClick={() => nav('/expedientes?status=cerrado')} />
        <Kpi icon={Activity} label="Consultas realizadas" value={fmtNum(k.queriesTotal)} foot={`${k.queries7} en los últimos 7 días`} tone="amber" />
        <Kpi icon={Coins} label="Mis créditos" value={fmtNum(k.credits)} foot="Saldo disponible" tone={k.credits < 20 ? 'red' : ''} onClick={() => nav('/creditos')} />
      </div>
      <div className="grid g4 mt">
        <Kpi icon={Phone} label="Análisis telefónicos (30 d)" value={fmtNum(k.phoneQueries30)} />
        <Kpi icon={Radar} label="Consultas OSINT (30 d)" value={fmtNum(k.osintQueries30)} foot={`${k.osintFailRate}% fallidas por fuente no disponible`} />
        <Kpi icon={FileArchive} label="Evidencias custodiadas" value={fmtNum(k.evidence)} foot={`${k.findings} hallazgos registrados`} tone="blue" />
        <Kpi icon={MapPin} label="Enlaces de ubicación vigentes" value={fmtNum(k.activeGeoLinks)} foot={`${k.reports} informes generados`} tone="amber" />
      </div>

      <div className="grid g-main mt">
        <div className="card">
          <div className="card-head"><h3><Activity size={16} color="var(--lime)" /> Actividad diaria</h3><div className="legend"><span><i style={{ background: '#a3e635' }} />Telefónicas</span><span><i style={{ background: '#6cb6ff' }} />OSINT</span><span><i style={{ background: '#f5b942' }} />Eventos</span></div></div>
          <div className="card-body chart-box" style={{ height: 290 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity} margin={{ left: -18, right: 8, top: 8 }}>
                <defs>
                  {[['g1', '#a3e635'], ['g2', '#6cb6ff'], ['g3', '#f5b942']].map(([id, c]) => (
                    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.35} /><stop offset="100%" stopColor={c} stopOpacity={0} /></linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip {...tip} />
                <Area type="monotone" dataKey="telefonicas" name="Telefónicas" stroke="#a3e635" fill="url(#g1)" strokeWidth={2} />
                <Area type="monotone" dataKey="osint" name="OSINT" stroke="#6cb6ff" fill="url(#g2)" strokeWidth={2} />
                <Area type="monotone" dataKey="eventos" name="Eventos" stroke="#f5b942" fill="url(#g3)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3><Siren size={16} color="var(--lime)" /> Alertas</h3><span className="hint">{alerts.length}</span></div>
          <div className="card-body stack" style={{ gap: 10, maxHeight: 330, overflowY: 'auto' }}>
            {alerts.length === 0 && <Empty icon={AlertTriangle} title="Sin alertas" text="Todo en orden." />}
            {alerts.map((a, i) => (
              <Link key={i} to={a.link || '#'} className={`alert ${a.level}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <AlertTriangle size={16} color={a.level === 'critical' ? 'var(--red)' : a.level === 'warning' ? 'var(--amber)' : 'var(--blue)'} />
                <div><div style={{ fontWeight: 600 }}>{a.title}</div>{a.detail && <div className="small muted">{a.detail}</div>}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g3 mt">
        <div className="card">
          <div className="card-head"><h3>Expedientes por estado</h3></div>
          <div className="card-body chart-box">
            {data.casesByStatus.length === 0 ? <Empty title="Sin expedientes" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.casesByStatus.map((x) => ({ ...x, label: CASE_STATUS[x.name]?.[0] || x.name }))} dataKey="value" nameKey="label" innerRadius={58} outerRadius={90} paddingAngle={3} stroke="none">
                    {data.casesByStatus.map((x) => <Cell key={x.name} fill={STATUS_COLORS[x.name] || '#84908a'} />)}
                  </Pie>
                  <Tooltip {...tip} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Clasificación de investigaciones</h3></div>
          <div className="card-body chart-box">
            {data.casesByClass.length === 0 ? <Empty title="Sin datos" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.casesByClass.map((x) => ({ ...x, label: CASE_CLASS[x.name] || x.name }))} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
                  <Tooltip {...tip} cursor={{ fill: 'rgba(163,230,53,0.05)' }} />
                  <Bar dataKey="value" name="Expedientes" radius={[0, 6, 6, 0]}>{data.casesByClass.map((x, i) => <Cell key={x.name} fill={COLORS[i % COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3><Lightbulb size={16} color="var(--lime)" /> Confiabilidad de hallazgos</h3></div>
          <div className="card-body chart-box">
            {data.findingsByRel.length === 0 ? <Empty title="Sin hallazgos" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.findingsByRel.map((x) => ({ ...x, label: RELIABILITY[x.name]?.[0] || x.name }))} dataKey="value" nameKey="label" outerRadius={90} stroke="#161a18" strokeWidth={2}>
                    {data.findingsByRel.map((x) => <Cell key={x.name} fill={REL_COLORS[x.name] || '#84908a'} />)}
                  </Pie>
                  <Tooltip {...tip} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid g-main mt">
        <div className="card">
          <div className="card-head"><h3>Actividad reciente</h3>{can('cases.read') && <Link to="/expedientes" className="small">Ver expedientes <ArrowRight size={12} /></Link>}</div>
          <div className="card-body">
            {data.recent.length === 0 ? <Empty title="Sin actividad" text="Las acciones sobre expedientes aparecerán aquí." /> : (
              <div className="timeline">
                {data.recent.map((e) => (
                  <div className="tl-item" key={e.id}>
                    <div className="tl-head"><Link to={`/expedientes/${e.case_id}`} className="mono">{e.code}</Link> · {EVENT_LABEL[e.type] || e.type} · {timeAgo(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</div>
                    <div className="tl-body">{e.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Accesos rápidos</h3></div>
            <div className="card-body quick">
              {can('phone.analyze') && <Link to="/analisis"><Phone size={17} /> Analizar número</Link>}
              {can('osint.query') && <Link to="/osint"><Radar size={17} /> Consulta OSINT</Link>}
              {can('cases.write') && <Link to="/expedientes?nuevo=1"><FolderKanban size={17} /> Nuevo expediente</Link>}
              {can('evidence.write') && <Link to="/evidencias?nuevo=1"><FileArchive size={17} /> Cargar evidencia</Link>}
              {can('geo.write') && <Link to="/geolocalizacion?nuevo=1"><MapPin size={17} /> Enlace de ubicación</Link>}
              {can('reports.write') && <Link to="/informes?nuevo=1"><FileText size={17} /> Generar informe</Link>}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Expedientes activos recientes</h3></div>
            <div>
              {data.recentCases.length === 0 && <Empty title="Sin expedientes activos" />}
              {data.recentCases.map((c) => (
                <Link key={c.id} to={`/expedientes/${c.id}`} className="row between" style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)', color: 'inherit', textDecoration: 'none' }}>
                  <div style={{ minWidth: 0 }}><div className="mono lime small">{c.code}</div><div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{c.title}</div></div>
                  <div className="row" style={{ gap: 6 }}><PriorityBadge priority={c.priority} /><StatusBadge status={c.status} /></div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
