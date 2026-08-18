import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import {
  Activity, AlertTriangle, Box, CheckCircle2, ChevronRight,
  Clock, Download, MapPin, RefreshCw, Shield, TrendingUp,
  Wrench, XCircle, Package, ArrowLeftRight, BarChart3,
  Car, Utensils, Laptop, Zap, Thermometer, Target,
  Search, ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal,
  Truck, Eye, FileText, BookOpen, FlaskConical, User,
  CalendarClock, TrendingDown, Gauge, AlertOctagon, Timer, ClipboardCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { ApprobationsPanel } from "@/components/ApprobationsPanel";
import { buildReportHtml, openReportPrintWindow } from "@/lib/reportTemplate";

// ─── Types ───────────────────────────────────────────────────
interface Equipment {
  id: string; name: string; status: string;
  category_id: string; category_label: string;
  zone_name?: string; station_name?: string;
  zone_id?: string; station_id?: string;
  updated_at?: string; details?: Record<string, any>;
}
interface Movement {
  id: string; type: string; equipment_id: string;
  equipment_name?: string; from_zone_name?: string; from_station_name?: string;
  to_zone_name?: string; to_station_name?: string;
  performed_by_name?: string; previous_status?: string; new_status?: string;
  note?: string; reference?: string; date_deploiement?: string;
  date_retour_prevue?: string; created_at: string;
}
interface Props { isBypass?: boolean; }

// ─── Constantes ───────────────────────────────────────────────
const MOVEMENT_META: Record<string, { label: string; color: string; bg: string; darkBg: string; Icon: any }> = {
  entree:      { label: "Entrée",      color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 border-emerald-200",   darkBg: "dark:bg-emerald-950/40 dark:border-emerald-800",   Icon: ArrowDown },
  sortie:      { label: "Sortie",      color: "text-red-700 dark:text-red-400",         bg: "bg-red-50 border-red-200",           darkBg: "dark:bg-red-950/40 dark:border-red-800",           Icon: ArrowUp },
  transfert:   { label: "Transfert",   color: "text-blue-700 dark:text-blue-400",       bg: "bg-blue-50 border-blue-200",         darkBg: "dark:bg-blue-950/40 dark:border-blue-800",         Icon: ArrowLeftRight },
  retour:      { label: "Retour",      color: "text-purple-700 dark:text-purple-400",   bg: "bg-purple-50 border-purple-200",     darkBg: "dark:bg-purple-950/40 dark:border-purple-800",     Icon: RotateCcw },
  ajustement:  { label: "Ajustement",  color: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-50 border-amber-200",       darkBg: "dark:bg-amber-950/40 dark:border-amber-800",       Icon: SlidersHorizontal },
  deploiement: { label: "Déploiement", color: "text-orange-700 dark:text-orange-400",   bg: "bg-orange-50 border-orange-200",     darkBg: "dark:bg-orange-950/40 dark:border-orange-800",     Icon: Truck },
};
const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  fonctionnel:   { label: "Fonctionnel",   color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800" },
  en_reparation: { label: "En réparation", color: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950/40",     border: "border-amber-200 dark:border-amber-800" },
  hors_service:  { label: "Hors service",  color: "text-red-700 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950/40",         border: "border-red-200 dark:border-red-800" },
};

// ─── Helpers ──────────────────────────────────────────────────
function getCatIcon(label = "", size = 15) {
  const l = label.toLowerCase();
  if (l.includes("rame") || l.includes("véhicule") || l.includes("vehicule")) return <Car size={size} />;
  if (l.includes("cuisine") || l.includes("frigo") || l.includes("réfrigér"))  return <Utensils size={size} />;
  if (l.includes("informatique") || l.includes("it") || l.includes("électronique") || l.includes("electronique")) return <Laptop size={size} />;
  if (l.includes("groupe") || l.includes("générateur") || l.includes("generateur") || l.includes("énergie")) return <Zap size={size} />;
  if (l.includes("clim") || l.includes("climatiseur")) return <Thermometer size={size} />;
  if (l.includes("armement") || l.includes("arme")) return <Target size={size} />;
  if (l.includes("transport") || l.includes("camion")) return <Truck size={size} />;
  return <Box size={size} />;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function daysSince(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ─── Tag ─────────────────────────────────────────────────────
function Tag({ children, warn, accent }: { children: React.ReactNode; warn?: boolean; accent?: boolean }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
      warn   ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800" :
      accent ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800" :
               "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
    }`}>{children}</span>
  );
}

// ─── renderCategoryDetails ────────────────────────────────────
function renderCategoryDetails(item: Equipment) {
  const d = item.details || {};
  const l = (item.category_label || "").toLowerCase();
  if (l.includes("rame") || l.includes("véhicule") || l.includes("vehicule")) return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {d.immatriculation && <Tag>🚗 {d.immatriculation}</Tag>}
      {d.numero_chassis  && <Tag>Châssis: {d.numero_chassis}</Tag>}
      {d.marque          && <Tag>{d.marque}{d.modele ? ` ${d.modele}` : ""}</Tag>}
      {d.kilometrage     && <Tag>{Number(d.kilometrage).toLocaleString()} km</Tag>}
      {d.date_visite_technique && <Tag warn>CT: {fmtDate(d.date_visite_technique)}</Tag>}
    </div>
  );
  if (l.includes("informatique") || l.includes("it") || l.includes("électronique") || l.includes("electronique")) return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {d.numero_serie  && <Tag>N°: {d.numero_serie}</Tag>}
      {d.type_materiel && <Tag>{d.type_materiel}</Tag>}
      {d.marque        && <Tag>{d.marque}{d.modele ? ` ${d.modele}` : ""}</Tag>}
    </div>
  );
  if (l.includes("groupe") || l.includes("générateur") || l.includes("énergie")) return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {d.numero_serie  && <Tag>N°: {d.numero_serie}</Tag>}
      {d.marque        && <Tag>{d.marque}</Tag>}
      {d.puissance_kva && <Tag>⚡ {d.puissance_kva} kVA</Tag>}
    </div>
  );
  const entries = Object.entries(d).filter(([k, v]) => v && !["observation"].includes(k)).slice(0, 3);
  return entries.length > 0 ? (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {entries.map(([k, v]) => <Tag key={k}>{k.replace(/_/g, " ")}: {String(v).substring(0, 25)}</Tag>)}
    </div>
  ) : null;
}

// ─── Palette zones ────────────────────────────────────────────
const ZONE_PALETTE = [
  "#6366f1","#22c55e","#f59e0b","#3b82f6","#ec4899",
  "#14b8a6","#f97316","#8b5cf6","#84cc16","#06b6d4","#ef4444",
];

// ─── DonutChart ───────────────────────────────────────────────
function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const R = 72; const r = 46; const cx = 90; const cy = 90;
  let cum = -Math.PI / 2;
  const slices = data.map(d => {
    const angle = (d.value / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(cum); const y1 = cy + R * Math.sin(cum);
    cum += angle;
    const x2 = cx + R * Math.cos(cum); const y2 = cy + R * Math.sin(cum);
    const xi1 = cx + r * Math.cos(cum - angle); const yi1 = cy + r * Math.sin(cum - angle);
    const xi2 = cx + r * Math.cos(cum); const yi2 = cy + r * Math.sin(cum);
    const large = angle > Math.PI ? 1 : 0;
    return { ...d, path: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z`, angle };
  });
  return (
    <svg viewBox="0 0 180 180" className="w-full max-w-[180px] mx-auto drop-shadow-sm">
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2">
          <title>{s.label} : {s.value}</title>
        </path>
      ))}
      <circle cx={cx} cy={cy} r={r - 2} fill="white" className="dark:fill-slate-800" />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="900" fill="#0f172a">{total}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fontWeight="700" fill="#94a3b8" letterSpacing="1">ÉQUIP.</text>
    </svg>
  );
}

// ─── ZoneDonutCard ────────────────────────────────────────────
function ZoneDonutCard({ zoneStationStats, total }: { zoneStationStats: any[]; total: number }) {
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const donutData = zoneStationStats.map((z, i) => ({ label: z.zone, value: z.total, color: ZONE_PALETTE[i % ZONE_PALETTE.length] }));
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
          <MapPin size={14} className="text-accent" />Répartition par zone
        </h3>
        <span className="text-[10px] text-slate-400 font-bold">{zoneStationStats.length} zone{zoneStationStats.length > 1 ? "s" : ""}</span>
      </div>
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-slate-300"><MapPin size={32} /><p className="text-xs font-bold mt-2">Aucun équipement</p></div>
      ) : (
        <div className="p-5 flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="w-full sm:w-auto sm:flex-shrink-0" style={{ minWidth: 140 }}>
              <DonutChart data={donutData} total={total} />
            </div>
            <div className="flex flex-col gap-1.5 w-full max-h-44 overflow-y-auto pr-1">
              {donutData.map((d, i) => {
                const pct = total ? Math.round((d.value / total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="font-bold text-slate-700 dark:text-slate-300 truncate flex-1">{d.label}</span>
                    <span className="font-black text-slate-900 dark:text-slate-100 tabular-nums">{d.value}</span>
                    <span className="text-slate-400 tabular-nums w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-900 px-4 py-2 grid grid-cols-3 text-[9px] font-black uppercase tracking-widest text-slate-400">
              <span>Zone</span><span className="text-center">Stations</span><span className="text-right">Équip.</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-56 overflow-y-auto">
              {zoneStationStats.map((z, i) => {
                const color = ZONE_PALETTE[i % ZONE_PALETTE.length];
                const isOpen = expandedZone === z.zone;
                const stationList = Object.entries(z.stations).sort((a: any, b: any) => b[1] - a[1]);
                return (
                  <div key={z.zone}>
                    <button onClick={() => setExpandedZone(isOpen ? null : z.zone)}
                      className="w-full px-4 py-2.5 grid grid-cols-3 items-center hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{z.zone}</span>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-[10px] font-bold text-slate-500">{stationList.length}</span>
                        <ChevronRight size={11} className={`text-slate-300 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </div>
                      <div className="text-right"><span className="text-xs font-black text-slate-900 dark:text-slate-100">{z.total}</span></div>
                    </button>
                    {isOpen && (
                      <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-700">
                        {stationList.map(([station, count]: any) => {
                          const pct = z.total ? Math.round((count / z.total) * 100) : 0;
                          return (
                            <div key={station} className="px-4 py-2 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
                              <span className="w-1 h-1 rounded-full bg-slate-300 ml-4 flex-shrink-0" />
                              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 flex-1 truncate">{station}</span>
                              <div className="flex items-center gap-2 ml-auto">
                                <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                                </div>
                                <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 tabular-nums w-4 text-right">{count}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Chart 7 jours ───────────────────────────────────────────
const BAR_COLORS: Record<string, string> = {
  entree: "#22c55e", sortie: "#ef4444", transfert: "#3b82f6",
  deploiement: "#8b5cf6", retour: "#f59e0b", ajustement: "#94a3b8",
};
const BAR_LABELS: Record<string, string> = {
  entree: "Entrée", sortie: "Sortie", transfert: "Transfert",
  deploiement: "Déploiement", retour: "Retour", ajustement: "Ajustement",
};

function Chart7Days({ data }: { data: { label: string; date: string; counts: Record<string, number> }[] }) {
  const [hovered, setHovered] = useState<{ day: number; type: string } | null>(null);
  const types = ["entree", "sortie", "transfert", "deploiement", "retour", "ajustement"];
  const W = 560; const H = 180; const padL = 28; const padB = 32; const padT = 14; const padR = 12;
  const chartW = W - padL - padR; const chartH = H - padB - padT;
  const colW = chartW / 7; const barW = Math.min(colW * 0.55, 42);
  const maxVal = Math.max(1, ...data.map(d => Object.values(d.counts).reduce((a, b) => a + b, 0)));

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
          <BarChart3 size={14} className="text-accent" />Activité des 7 derniers jours
        </h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {types.map(t => (
            <span key={t} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="w-2 h-2 rounded-full" style={{ background: BAR_COLORS[t] }} />{BAR_LABELS[t]}
            </span>
          ))}
        </div>
      </div>
      <div className="px-4 py-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
          {[0, 0.25, 0.5, 0.75, 1].map(frac => {
            const y = padT + chartH * (1 - frac);
            const val = Math.round(maxVal * frac);
            return (
              <g key={frac}>
                <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                {val > 0 && <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{val}</text>}
              </g>
            );
          })}
          {data.map((day, di) => {
            const cx = padL + di * colW + colW / 2;
            const x = cx - barW / 2;
            let stackY = padT + chartH;
            const total = Object.values(day.counts).reduce((a, b) => a + b, 0);
            return (
              <g key={di}>
                {types.map(type => {
                  const count = day.counts[type] || 0;
                  if (count === 0) return null;
                  const barH = (count / maxVal) * chartH;
                  stackY -= barH;
                  const isHov = hovered?.day === di && hovered?.type === type;
                  return (
                    <rect key={type} x={x} y={stackY} width={barW} height={barH}
                      fill={BAR_COLORS[type]} opacity={hovered && !isHov ? 0.4 : 1} rx="2"
                      style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                      onMouseEnter={() => setHovered({ day: di, type })}
                      onMouseLeave={() => setHovered(null)}>
                      <title>{BAR_LABELS[type]} : {count}</title>
                    </rect>
                  );
                })}
                {total > 0 && (
                  <text x={cx} y={padT + chartH - (total / maxVal) * chartH - 4}
                    textAnchor="middle" fontSize="8" fontWeight="700" fill="#475569">{total}</text>
                )}
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="600">{day.label}</text>
              </g>
            );
          })}
          <line x1={padL} x2={W - padR} y1={padT + chartH} y2={padT + chartH} stroke="#e2e8f0" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}

// ─── GaugeChart ───────────────────────────────────────────────
function GaugeChart({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 52; const cx = 70; const cy = 70;
  const startAngle = Math.PI * 0.75; const endAngle = Math.PI * 2.25;
  const totalArc = endAngle - startAngle;
  const fillArc = (value / 100) * totalArc;
  const toXY = (angle: number) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  const s = toXY(startAngle); const e = toXY(endAngle);
  const f = toXY(startAngle + fillArc);
  const largeAll = totalArc > Math.PI ? 1 : 0;
  const largeFill = fillArc > Math.PI ? 1 : 0;
  return (
    <svg viewBox="0 0 140 110" className="w-full max-w-[140px]">
      <path d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${largeAll} 1 ${e.x} ${e.y}`}
        fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
      {value > 0 && (
        <path d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${largeFill} 1 ${f.x} ${f.y}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="20" fontWeight="900" fill={color}>{value}%</text>
      <text x={cx} y={cy + 20} textAnchor="middle" fontSize="8" fontWeight="700" fill="#94a3b8">{label}</text>
    </svg>
  );
}

// ─── Composant principal ──────────────────────────────────────
export function SupervisionDashboard({ isBypass = false }: Props) {
  const [equipment,   setEquipment]  = useState<Equipment[]>([]);
  const [movements,   setMovements]  = useState<Movement[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  type Tab = "overview" | "inventaire" | "mouvements" | "analyse" | "journal" | "audit" | "approbations" | "alertes" | "utilisateurs";
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [activeCat,  setActiveCat]  = useState("all");
  const [searchInv,  setSearchInv]  = useState("");
  const [allUsers,   setAllUsers]   = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [auditSummary, setAuditSummary] = useState<{ userId: string; userName: string; total: number; lastAt: string }[]>([]);
  const [searchMov,  setSearchMov]  = useState("");
  const [filterType, setFilterType] = useState("all");
  const [journalSearch, setJournalSearch] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [eqRes, mvRes, usersRes, onlineRes, auditRes] = await Promise.all([
        apiFetch("/api/equipment"),
        apiFetch("/api/movements"),
        apiFetch("/api/admin/users").catch(() => null),
        apiFetch("/api/admin/users/online").catch(() => null),
        apiFetch("/api/admin/audit-logs/summary").catch(() => null),
      ]);
      if (eqRes.ok) { const ct = eqRes.headers.get("content-type") || ""; if (ct.includes("json")) setEquipment(await eqRes.json()); }
      if (mvRes.ok) { const ct = mvRes.headers.get("content-type") || ""; if (ct.includes("json")) setMovements(await mvRes.json()); else setMovements([]); }
      else setMovements([]);
      if (usersRes?.ok) setAllUsers(await usersRes.json());
      if (onlineRes?.ok) setOnlineUsers(await onlineRes.json());
      if (auditRes?.ok) setAuditSummary(await auditRes.json());
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 60000); return () => clearInterval(t); }, [fetchAll]);

  // ─── Stats ──────────────────────────────────────────────────
  const total        = equipment.length;
  const fonctionnel  = equipment.filter(e => e.status === "fonctionnel").length;
  const enReparation = equipment.filter(e => e.status === "en_reparation").length;
  const horsService  = equipment.filter(e => e.status === "hors_service").length;
  const disponibilite = total ? Math.round((fonctionnel / total) * 100) : 0;

  const categories = useMemo(() => {
    const map: Record<string, string> = {};
    equipment.forEach(e => { if (e.category_id && e.category_label) map[e.category_id] = e.category_label; });
    return Object.entries(map).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [equipment]);

  const zoneStationStats = useMemo(() => {
    const map: Record<string, { zone: string; total: number; stations: Record<string, number> }> = {};
    equipment.forEach(e => {
      const z = e.zone_name || "Non assigné"; const s = e.station_name || "Sans station";
      if (!map[z]) map[z] = { zone: z, total: 0, stations: {} };
      map[z].total++; map[z].stations[s] = (map[z].stations[s] || 0) + 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [equipment]);

  const mv24h = movements.filter(m => Date.now() - new Date(m.created_at).getTime() < 86400000);

  // ─── Alertes ────────────────────────────────────────────────
  const alerts = useMemo(() => [
    ...equipment.filter(e => !e.zone_name).map(e => ({ level: "warning" as const, msg: `${e.name} — aucune zone assignée`, cat: e.category_label, id: e.id })),
    ...equipment.filter(e => e.status === "hors_service").map(e => ({ level: "danger" as const, msg: `${e.name} — HORS SERVICE`, cat: e.category_label, id: e.id })),
    ...equipment.filter(e => e.status === "en_reparation").map(e => ({ level: "warning" as const, msg: `${e.name} — en réparation`, cat: e.category_label, id: e.id })),
  ], [equipment]);

  // ─── Déploiements en retard ──────────────────────────────────
  const deploiementsEnRetard = useMemo(() =>
    movements.filter(m =>
      m.type === "deploiement" &&
      m.date_retour_prevue &&
      new Date(m.date_retour_prevue) < new Date()
    ).sort((a, b) => new Date(a.date_retour_prevue!).getTime() - new Date(b.date_retour_prevue!).getTime())
  , [movements]);

  // ─── Top équipements critiques (hors service le plus longtemps) ──
  const critiques = useMemo(() =>
    equipment
      .filter(e => e.status === "hors_service" || e.status === "en_reparation")
      .map(e => ({
        ...e,
        joursImmobile: e.updated_at ? daysSince(e.updated_at) : 0,
      }))
      .sort((a, b) => b.joursImmobile - a.joursImmobile)
      .slice(0, 10)
  , [equipment]);

  // ─── Stats dispo par zone ────────────────────────────────────
  const dispoParZone = useMemo(() =>
    zoneStationStats.map(z => {
      const items = equipment.filter(e => (e.zone_name || "Non assigné") === z.zone);
      const ok = items.filter(e => e.status === "fonctionnel").length;
      const pct = items.length ? Math.round((ok / items.length) * 100) : 0;
      return { zone: z.zone, total: items.length, ok, pct };
    }).sort((a, b) => a.pct - b.pct)
  , [equipment, zoneStationStats]);

  // ─── Journal d'activité (construit depuis mouvements) ────────
  const journal = useMemo(() => {
    return [...movements]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(m => ({
        id: m.id,
        date: m.created_at,
        agent: m.performed_by_name || "Système",
        action: MOVEMENT_META[m.type]?.label || m.type,
        type: m.type,
        equipement: m.equipment_name || m.equipment_id?.substring(0, 8) || "—",
        detail: [
          m.from_zone_name ? `De: ${m.from_zone_name}${m.from_station_name ? ` / ${m.from_station_name}` : ""}` : "",
          m.to_zone_name   ? `→ ${m.to_zone_name}${m.to_station_name ? ` / ${m.to_station_name}` : ""}` : "",
          m.previous_status && m.new_status && m.previous_status !== m.new_status ? `Statut: ${m.previous_status} → ${m.new_status}` : "",
          m.note ? `"${m.note}"` : "",
          m.reference ? `Réf: ${m.reference}` : "",
        ].filter(Boolean).join(" · "),
      }));
  }, [movements]);

  const filteredJournal = useMemo(() => {
    const q = journalSearch.toLowerCase();
    return !q ? journal : journal.filter(j =>
      [j.agent, j.action, j.equipement, j.detail].some(v => v?.toLowerCase().includes(q))
    );
  }, [journal, journalSearch]);

  // ─── Stats agents (depuis journal) ──────────────────────────
  const statsAgents = useMemo(() => {
    const map: Record<string, { agent: string; count: number; last: string; types: Record<string, number> }> = {};
    movements.forEach(m => {
      const a = m.performed_by_name || "Système";
      if (!map[a]) map[a] = { agent: a, count: 0, last: m.created_at, types: {} };
      map[a].count++;
      map[a].types[m.type] = (map[a].types[m.type] || 0) + 1;
      if (new Date(m.created_at) > new Date(map[a].last)) map[a].last = m.created_at;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [movements]);

  // ─── Graphique 7 jours ────────────────────────────────────────
  const chart7Days = useMemo(() => {
    const days: { label: string; date: string; counts: Record<string, number> }[] = [];
    const types = ["entree", "sortie", "transfert", "deploiement", "retour", "ajustement"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString("fr-FR", { weekday: "short" });
      const dateStr = d.toISOString().split("T")[0];
      const counts: Record<string, number> = {};
      types.forEach(t => { counts[t] = 0; });
      days.push({ label, date: dateStr, counts });
    }
    movements.forEach(m => {
      const d = new Date(m.created_at).toISOString().split("T")[0];
      const day = days.find(x => x.date === d);
      if (day && m.type in day.counts) day.counts[m.type]++;
    });
    return days;
  }, [movements]);

  // ─── Exports ─────────────────────────────────────────────────
  function dl(rows: string[][], name: string) {
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    a.download = name; a.click();
  }
  function today() { return new Date().toISOString().split("T")[0]; }

  function exportInventaireCSV() {
    dl([
      ["Nom", "Catégorie", "Statut", "Zone", "Station", "N° Série/Chassis/Inventaire", "Marque", "Modèle"],
      ...equipment.map(e => {
        const d = e.details || {};
        return [e.name, e.category_label, e.status, e.zone_name || "", e.station_name || "",
          d.numero_serie || d.numero_chassis || d.immatriculation || d.numero_inventaire || "",
          d.marque || "", d.modele || ""];
      })
    ], `inventaire_helios_${today()}.csv`);
  }

  function exportMovementsCSV() {
    dl([
      ["Type","Équipement","De Zone","De Bureau","Vers Zone","Vers Bureau","Agent","Référence","Date","Note"],
      ...movements.map(m => [
        MOVEMENT_META[m.type]?.label || m.type, m.equipment_name || m.equipment_id,
        m.from_zone_name || "", m.from_station_name || "",
        m.to_zone_name || "", m.to_station_name || "",
        m.performed_by_name || "", m.reference || "",
        new Date(m.created_at).toLocaleString("fr-FR"), m.note || ""
      ])
    ], `mouvements_helios_${today()}.csv`);
  }

  function exportJournalCSV() {
    dl([
      ["Date", "Agent", "Action", "Équipement", "Détails"],
      ...filteredJournal.map(j => [fmtDateTime(j.date), j.agent, j.action, j.equipement, j.detail])
    ], `journal_helios_${today()}.csv`);
  }

  function exportPDF() {
    const dateStr  = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const timeStr  = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    // ── Lignes inventaire ──────────────────────────────────────
    const inventaireRows = equipment.map((e, i) => {
      const d = e.details || {};
      const ref = d.numero_serie || d.numero_chassis || d.immatriculation || d.numero_inventaire || "—";
      const marque = d.marque || d.brand || "—";
      const modele = d.modele || d.model || "";
      const statusColor = e.status === "fonctionnel" ? "#16a34a" : e.status === "en_reparation" ? "#d97706" : "#dc2626";
      const statusLabel = e.status === "fonctionnel" ? "✔ Fonctionnel" : e.status === "en_reparation" ? "⚙ En réparation" : "✕ Hors service";
      const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      return `<tr style="background:${bg}">
        <td>${e.name}</td>
        <td>${e.category_label || "—"}</td>
        <td style="color:${statusColor};font-weight:700">${statusLabel}</td>
        <td>${e.zone_name || "—"}</td>
        <td>${e.station_name || "—"}</td>
        <td style="font-family:monospace;font-size:10px">${ref}</td>
        <td>${marque}${modele ? " " + modele : ""}</td>
      </tr>`;
    }).join("");

    // ── Lignes zones ───────────────────────────────────────────
    const zoneRows = zoneStationStats.map((z, i) => {
      const items = equipment.filter(e => (e.zone_name || "Non assigné") === z.zone);
      const ok  = items.filter(e => e.status === "fonctionnel").length;
      const rep = items.filter(e => e.status === "en_reparation").length;
      const hs  = items.filter(e => e.status === "hors_service").length;
      const pct = z.total ? Math.round((ok / z.total) * 100) : 0;
      const bg  = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      return `<tr style="background:${bg}">
        <td style="font-weight:700">${z.zone}</td>
        <td style="text-align:center;font-weight:900">${z.total}</td>
        <td style="text-align:center;color:#16a34a;font-weight:700">${ok}</td>
        <td style="text-align:center;color:#d97706;font-weight:700">${rep}</td>
        <td style="text-align:center;color:#dc2626;font-weight:700">${hs}</td>
        <td style="text-align:center;color:#2563eb;font-weight:900">${pct}%</td>
      </tr>`;
    }).join("");

    // ── Lignes catégories ──────────────────────────────────────
    const catRows = categories.map((cat, i) => {
      const items = equipment.filter(e => e.category_id === cat.id);
      const ok  = items.filter(e => e.status === "fonctionnel").length;
      const rep = items.filter(e => e.status === "en_reparation").length;
      const hs  = items.filter(e => e.status === "hors_service").length;
      const pct = items.length ? Math.round((ok / items.length) * 100) : 0;
      const bg  = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      return `<tr style="background:${bg}">
        <td style="font-weight:700">${cat.label}</td>
        <td style="text-align:center;font-weight:900">${items.length}</td>
        <td style="text-align:center;color:#16a34a;font-weight:700">${ok}</td>
        <td style="text-align:center;color:#d97706;font-weight:700">${rep}</td>
        <td style="text-align:center;color:#dc2626;font-weight:700">${hs}</td>
        <td style="text-align:center;color:#2563eb;font-weight:900">${pct}%</td>
      </tr>`;
    }).join("");

    const html = buildReportHtml({
      docTitle: "Rapport d'inventaire des ressources logistiques",
      docSubtitle: `État du parc au ${dateStr} à ${timeStr} — ${equipment.length} équipements enregistrés — ${categories.length} catégories`,
      dateStr,
      signatureTitle: "Le Chef Suivi Projet HELIOS",
      sections: [
        {
          title: "I. Tableau de bord — Synthèse globale",
          html: `<div class="kpis" style="grid-template-columns: repeat(5, 1fr)">
    <div class="kpi"><div class="kpi-val" style="color:#fff">${total}</div><div class="kpi-lbl">Total équipements</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#22c55e">${fonctionnel}</div><div class="kpi-lbl">Fonctionnels</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#f59e0b">${enReparation}</div><div class="kpi-lbl">En réparation</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#ef4444">${horsService}</div><div class="kpi-lbl">Hors service</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#38bdf8">${disponibilite}%</div><div class="kpi-lbl">Disponibilité</div></div>
  </div>`,
        },
        {
          title: "II. Répartition par zone",
          html: `<table>
    <thead><tr>
      <th>Zone</th>
      <th class="center">Total</th>
      <th class="center">Fonctionnels</th>
      <th class="center">En réparation</th>
      <th class="center">Hors service</th>
      <th class="center">Disponibilité</th>
    </tr></thead>
    <tbody>${zoneRows}</tbody>
  </table>`,
        },
        {
          title: "III. Répartition par catégorie",
          html: `<table>
    <thead><tr>
      <th>Catégorie</th>
      <th class="center">Total</th>
      <th class="center">Fonctionnels</th>
      <th class="center">En réparation</th>
      <th class="center">Hors service</th>
      <th class="center">Disponibilité</th>
    </tr></thead>
    <tbody>${catRows}</tbody>
  </table>`,
        },
        {
          title: "IV. Inventaire détaillé",
          html: `<table>
    <thead><tr>
      <th>Nom / Désignation</th>
      <th>Catégorie</th>
      <th>État</th>
      <th>Zone</th>
      <th>Station / Bureau</th>
      <th>N° Série / Réf.</th>
      <th>Marque / Modèle</th>
    </tr></thead>
    <tbody>${inventaireRows}</tbody>
  </table>`,
        },
      ],
    });

    openReportPrintWindow(html);
  }

  // ─── Filtrages ────────────────────────────────────────────────
  const filteredInventaire = useMemo(() => equipment.filter(e => {
    const matchCat = activeCat === "all" || e.category_id === activeCat;
    const q = searchInv.toLowerCase();
    const matchSearch = !q || [e.name, e.category_label, e.zone_name, e.station_name, ...Object.values(e.details || {}).map(String)].some(v => v?.toLowerCase().includes(q));
    return matchCat && matchSearch;
  }), [equipment, activeCat, searchInv]);

  const filteredMov = useMemo(() => movements.filter(m => {
    const matchType = filterType === "all" || m.type === filterType;
    const q = searchMov.toLowerCase();
    const matchSearch = !q || [m.equipment_name, m.from_zone_name, m.to_zone_name, m.performed_by_name, m.reference, m.note].some(v => v?.toLowerCase().includes(q));
    return matchType && matchSearch;
  }), [movements, filterType, searchMov]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3 opacity-30">
        <RefreshCw size={32} className="animate-spin" />
        <p className="text-xs font-bold uppercase tracking-widest">Chargement...</p>
      </div>
    </div>
  );

  const TABS = [
    { id: "overview",      label: "Vue d'ensemble",                  icon: <BarChart3 size={13} /> },
    { id: "inventaire",    label: `Inventaire (${total})`,           icon: <Eye size={13} /> },
    { id: "mouvements",    label: `Mouvements (${movements.length})`, icon: <Activity size={13} /> },
    { id: "analyse",       label: "Analyse",                         icon: <FlaskConical size={13} /> },
    { id: "journal",       label: `Journal (${journal.length})`,     icon: <BookOpen size={13} /> },
    { id: "audit",         label: "Journal global",                  icon: <Shield size={13} /> },
    { id: "approbations",  label: "Approbations",                    icon: <ClipboardCheck size={13} /> },
    { id: "alertes",       label: `Alertes (${alerts.length})`,      icon: <AlertTriangle size={13} /> },
    { id: "utilisateurs",  label: `Utilisateurs (${allUsers.length})`, icon: <User size={13} /> },
  ] as { id: Tab; label: string; icon: React.ReactNode }[];

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 [&>*]:min-w-0">

      {/* ── En-tête ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">Tableau de Bord Global</h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Actualisé à {lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={fetchAll}>
            <RefreshCw size={13} />Actualiser
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={exportInventaireCSV}>
            <Download size={13} />Inventaire CSV
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={exportMovementsCSV}>
            <FileText size={13} />Mouvements CSV
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs font-bold gap-1.5 text-red-600 border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={exportPDF}>
            <FileText size={13} />Rapport PDF
          </Button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total équipements", val: total,           sub: `${categories.length} catégories`,   color: "text-slate-900 dark:text-slate-100",   bg: "bg-slate-50 dark:bg-slate-700",   icon: <Package size={18} /> },
          { label: "Disponibilité",     val: `${disponibilite}%`, sub: `${fonctionnel} opérationnels`, color: disponibilite >= 90 ? "text-emerald-600" : disponibilite >= 70 ? "text-amber-600" : "text-red-500", bg: disponibilite >= 90 ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-amber-50 dark:bg-amber-950/40", icon: <TrendingUp size={18} /> },
          { label: "En maintenance",    val: enReparation,    sub: "Actions en cours",                  color: "text-amber-600",  bg: "bg-amber-50 dark:bg-amber-950/40",   icon: <Wrench size={18} /> },
          { label: "Hors service",      val: horsService,     sub: "Nécessite intervention",             color: horsService > 0 ? "text-red-500" : "text-slate-400", bg: horsService > 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-slate-50 dark:bg-slate-700", icon: <XCircle size={18} /> },
        ].map((s, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
            <div className={`inline-flex p-2 rounded-lg mb-3 ${s.bg}`}>
              <span className={s.color}>{s.icon}</span>
            </div>
            <div className={`text-3xl font-black ${s.color} mb-0.5`}>{s.val}</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest">{s.label}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </section>

      {/* ── Mouvements 24h ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {(["entree","sortie","transfert","deploiement","retour","ajustement"] as const).map(type => {
          const cfg = MOVEMENT_META[type];
          const count = mv24h.filter(m => m.type === type).length;
          return (
            <div key={type} className={`rounded-xl border px-3 py-2.5 ${cfg.bg} ${cfg.darkBg}`}>
              <div className={`text-[9px] font-black uppercase tracking-widest ${cfg.color}`}>{cfg.label}</div>
              <div className={`text-xl font-black mt-0.5 ${cfg.color}`}>{count}</div>
              <div className="text-[9px] text-slate-400">24h</div>
            </div>
          );
        })}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit flex-wrap mx-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black transition-all ${
              activeTab === tab.id
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ══ TAB VUE D'ENSEMBLE ══ */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Répartition catégories */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <Package size={14} className="text-accent" />Répartition par catégorie
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {categories.map(cat => {
                const items = equipment.filter(e => e.category_id === cat.id);
                const count = items.length;
                const ok = items.filter(e => e.status === "fonctionnel").length;
                const okPct = count ? Math.round((ok / count) * 100) : 0;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                        <span className="text-slate-400">{getCatIcon(cat.label, 13)}</span>{cat.label}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-black ${okPct >= 80 ? "text-emerald-600" : okPct >= 50 ? "text-amber-600" : "text-red-500"}`}>{okPct}% dispo</span>
                        <span className="text-[10px] text-slate-400 font-bold">{count} unités</span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-400 transition-all" style={{ width: `${count ? (ok / count) * 100 : 0}%` }} />
                      <div className="h-full bg-amber-400 transition-all" style={{ width: `${count ? (items.filter(e => e.status === "en_reparation").length / count) * 100 : 0}%` }} />
                      <div className="h-full bg-red-400 transition-all"   style={{ width: `${count ? (items.filter(e => e.status === "hors_service").length / count) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <ZoneDonutCard zoneStationStats={zoneStationStats} total={total} />
          <div className="lg:col-span-2">
            <Chart7Days data={chart7Days} />
          </div>
        </div>
      )}

      {/* ══ TAB INVENTAIRE ══ */}
      {activeTab === "inventaire" && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {categories.map(cat => (
                <button key={cat.id} onClick={() => setActiveCat(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all flex items-center gap-1 shrink-0 ${activeCat === cat.id ? "bg-brand-orange text-white border-brand-orange" : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600"}`}>
                  {getCatIcon(cat.label, 11)}{cat.label} · {equipment.filter(e => e.category_id === cat.id).length}
                </button>
              ))}
              <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1 shrink-0 ml-auto" onClick={exportInventaireCSV}>
                <Download size={11} />Export
              </Button>
            </div>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-300 dark:text-slate-500" />
              <input placeholder="Chercher nom, n° série, immat, zone..."
                className="w-full pl-10 pr-4 h-9 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-accent/20 transition-all"
                value={searchInv} onChange={e => setSearchInv(e.target.value)} />
            </div>
          </div>
          <div className="overflow-auto max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  {["Équipement", "Catégorie", "Détails", "Zone / Station", "État"].map(h => (
                    <th key={h} className="text-left text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-10 px-5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredInventaire.length === 0 ? (
                  <tr><td colSpan={5} className="h-32 text-center text-xs text-zinc-300 italic">Aucun équipement trouvé</td></tr>
                ) : filteredInventaire.map(item => {
                  const sc = STATUS_CFG[item.status] || STATUS_CFG.fonctionnel;
                  return (
                    <tr key={item.id} className="border-b border-zinc-100 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${sc.bg} ${sc.border}`}>
                            <span className={sc.color}>{getCatIcon(item.category_label, 14)}</span>
                          </div>
                          <div>
                            <p className="font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-tight">{item.name}</p>
                            <p className="text-[9px] text-zinc-400 dark:text-slate-500 font-mono">{item.id.substring(0, 8).toUpperCase()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3"><span className="text-xs font-bold text-slate-600 dark:text-slate-400">{item.category_label}</span></td>
                      <td className="px-5 py-3 max-w-xs">{renderCategoryDetails(item)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <MapPin size={10} className="text-slate-400 shrink-0" />{item.zone_name || <span className="text-zinc-300 italic font-normal">Non assigné</span>}
                        </div>
                        {item.station_name && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 ml-3.5">{item.station_name}</div>}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-black px-2 py-1 rounded border uppercase tracking-wide ${sc.bg} ${sc.color} ${sc.border}`}>{sc.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ TAB MOUVEMENTS ══ */}
      {activeTab === "mouvements" && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-300 dark:text-slate-500" />
              <input placeholder="Chercher équipement, zone, agent..."
                className="w-full pl-10 pr-4 h-9 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-accent/20 transition-all"
                value={searchMov} onChange={e => setSearchMov(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setFilterType("all")}
                className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all ${filterType === "all" ? "bg-slate-900 dark:bg-slate-600 text-white border-slate-900" : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600"}`}>
                Tous · {movements.length}
              </button>
              {Object.entries(MOVEMENT_META).map(([key, meta]) => {
                const count = movements.filter(m => m.type === key).length;
                return (
                  <button key={key} onClick={() => setFilterType(filterType === key ? "all" : key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all flex items-center gap-1 ${filterType === key ? `${meta.bg} ${meta.color} border-current` : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600"}`}>
                    <meta.Icon size={10} />{meta.label} · {count}
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1 ml-auto" onClick={exportMovementsCSV}>
              <Download size={11} />Export
            </Button>
          </div>
          <div className="overflow-auto max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                <tr>{["Type","Équipement","Trajet","Changement statut","Référence","Agent","Date"].map(h => (
                  <th key={h} className="text-left text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-10 px-4 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filteredMov.length === 0 ? (
                  <tr><td colSpan={7} className="h-32 text-center text-xs text-zinc-300 italic">Aucun mouvement trouvé</td></tr>
                ) : filteredMov.map(m => {
                  const meta = MOVEMENT_META[m.type];
                  return (
                    <tr key={m.id} className="border-b border-zinc-100 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black border ${meta?.bg ?? "bg-slate-50 border-slate-200"} ${meta?.color ?? "text-slate-600"} ${meta?.darkBg ?? ""}`}>
                          {meta && <meta.Icon size={10} />}{meta?.label ?? m.type}
                        </span>
                      </td>
                      <td className="px-4 py-3"><p className="font-black text-slate-800 dark:text-slate-200 text-xs uppercase truncate max-w-[120px]">{m.equipment_name || m.equipment_id.substring(0, 8)}</p></td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {m.from_zone_name && <span className="text-zinc-400">{m.from_zone_name}{m.from_station_name ? ` / ${m.from_station_name}` : ""} → </span>}
                          {m.to_zone_name ? <span className="font-bold text-slate-700 dark:text-slate-300">{m.to_zone_name}{m.to_station_name ? ` / ${m.to_station_name}` : ""}</span> : <span className="text-zinc-300 italic">—</span>}
                        </p>
                        {m.note && <p className="text-[10px] text-zinc-400 mt-0.5 italic truncate max-w-[180px]">{m.note}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {m.previous_status && m.new_status && m.previous_status !== m.new_status
                          ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{m.previous_status} → <strong className="text-slate-800 dark:text-slate-200">{m.new_status}</strong></p>
                          : <span className="text-zinc-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {m.reference ? <span className="font-mono text-[10px] bg-zinc-100 dark:bg-slate-700 px-2 py-0.5 rounded text-zinc-600 dark:text-slate-300">{m.reference}</span> : <span className="text-zinc-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3"><p className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate max-w-[100px]">{m.performed_by_name || "—"}</p></td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-zinc-500 dark:text-slate-400">{fmtDate(m.created_at)}</p>
                        <p className="text-[10px] text-zinc-300 dark:text-slate-600">{new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ TAB ANALYSE ══ */}
      {activeTab === "analyse" && (
        <div className="flex flex-col gap-6">

          {/* Jauges dispo globale + par statut */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { val: disponibilite,                                                          label: "Disponibilité globale",  color: disponibilite >= 90 ? "#22c55e" : disponibilite >= 70 ? "#f59e0b" : "#ef4444" },
              { val: total ? Math.round((fonctionnel / total) * 100) : 0,                  label: "Fonctionnels",           color: "#22c55e" },
              { val: total ? Math.round((enReparation / total) * 100) : 0,                 label: "En maintenance",         color: "#f59e0b" },
              { val: total ? Math.round((horsService / total) * 100) : 0,                  label: "Hors service",           color: "#ef4444" },
            ].map((g, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-col items-center">
                <GaugeChart value={g.val} label={g.label} color={g.color} />
              </div>
            ))}
          </div>

          {/* Disponibilité par zone */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <Gauge size={14} className="text-accent" />Disponibilité par zone
              </h3>
            </div>
            <div className="p-5 space-y-3">
              {dispoParZone.map(z => (
                <div key={z.zone}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                      <MapPin size={11} className="text-slate-400" />{z.zone}
                      <span className="text-[10px] text-slate-400 font-normal">({z.total} équip.)</span>
                    </div>
                    <span className={`text-[11px] font-black ${z.pct >= 90 ? "text-emerald-600" : z.pct >= 70 ? "text-amber-600" : "text-red-500"}`}>{z.pct}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${z.pct}%`,
                      background: z.pct >= 90 ? "#22c55e" : z.pct >= 70 ? "#f59e0b" : "#ef4444"
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top équipements critiques */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <AlertOctagon size={14} className="text-red-500" />Équipements critiques — immobilisation la plus longue
              </h3>
              <span className="text-[10px] text-slate-400 font-bold">{critiques.length} équipements</span>
            </div>
            {critiques.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-emerald-500">
                <CheckCircle2 size={32} strokeWidth={1.5} />
                <p className="text-sm font-bold text-slate-400">Aucun équipement critique</p>
              </div>
            ) : (
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                    <tr>{["Équipement","Catégorie","Zone","État","Immobilisé depuis"].map(h => (
                      <th key={h} className="text-left text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-9 px-5 whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {critiques.map(e => {
                      const sc = STATUS_CFG[e.status] || STATUS_CFG.hors_service;
                      return (
                        <tr key={e.id} className="border-b border-zinc-100 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700/50">
                          <td className="px-5 py-2.5"><p className="font-black text-slate-800 dark:text-slate-200 text-xs">{e.name}</p></td>
                          <td className="px-5 py-2.5"><span className="text-xs text-slate-500 dark:text-slate-400">{e.category_label}</span></td>
                          <td className="px-5 py-2.5"><span className="text-xs text-slate-600 dark:text-slate-400">{e.zone_name || "—"}</span></td>
                          <td className="px-5 py-2.5">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${sc.bg} ${sc.color} ${sc.border}`}>{sc.label}</span>
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <Timer size={11} className={e.joursImmobile > 7 ? "text-red-500" : "text-amber-500"} />
                              <span className={`text-xs font-black ${e.joursImmobile > 7 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                                {e.joursImmobile === 0 ? "Aujourd'hui" : `${e.joursImmobile} jour${e.joursImmobile > 1 ? "s" : ""}`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Déploiements en retard */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <CalendarClock size={14} className="text-orange-500" />Déploiements — retour en retard
              </h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                deploiementsEnRetard.length > 0 ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
              }`}>{deploiementsEnRetard.length} en retard</span>
            </div>
            {deploiementsEnRetard.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-emerald-500">
                <CheckCircle2 size={28} strokeWidth={1.5} />
                <p className="text-sm font-bold text-slate-400">Aucun déploiement en retard</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
                {deploiementsEnRetard.map(m => {
                  const joursRetard = m.date_retour_prevue ? daysSince(m.date_retour_prevue) : 0;
                  return (
                    <div key={m.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 flex items-center justify-center shrink-0">
                        <Truck size={14} className="text-orange-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-800 dark:text-slate-200 text-xs truncate">{m.equipment_name || "—"}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                          Vers: {m.to_zone_name || "—"}{m.to_station_name ? ` / ${m.to_station_name}` : ""}
                          {m.performed_by_name ? ` · ${m.performed_by_name}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-black text-red-600 dark:text-red-400">{joursRetard}j de retard</p>
                        <p className="text-[10px] text-slate-400">Prévu: {fmtDate(m.date_retour_prevue!)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activité par agent */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <User size={14} className="text-accent" />Activité par agent
              </h3>
            </div>
            {statsAgents.length === 0 ? (
              <p className="text-center text-xs text-slate-400 py-8 italic">Aucune activité enregistrée</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {statsAgents.map((a, i) => {
                  const maxCount = statsAgents[0]?.count || 1;
                  return (
                    <div key={a.agent} className="px-5 py-3 flex items-center gap-4">
                      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-black text-slate-500 dark:text-slate-400 shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{a.agent}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 ml-2">Dernier: {fmtDate(a.last)}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full" style={{ width: `${(a.count / maxCount) * 100}%` }} />
                        </div>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {Object.entries(a.types).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([type, cnt]) => (
                            <span key={type} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${MOVEMENT_META[type]?.bg ?? "bg-slate-100"} ${MOVEMENT_META[type]?.color ?? "text-slate-600"}`}>
                              {MOVEMENT_META[type]?.label ?? type}: {cnt}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-black text-slate-900 dark:text-slate-100">{a.count}</span>
                        <p className="text-[10px] text-slate-400">opérations</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB JOURNAL ══ */}
      {activeTab === "journal" && (
        <div className="flex flex-col gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <BookOpen size={14} className="text-accent" />
                <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm">Journal d'activité</h3>
                <span className="text-[10px] text-slate-400 font-bold">— toutes les opérations enregistrées</span>
              </div>
              <div className="relative min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-300 dark:text-slate-500" />
                <input placeholder="Rechercher agent, action, équipement..."
                  className="w-full pl-10 pr-4 h-9 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-accent/20 transition-all"
                  value={journalSearch} onChange={e => setJournalSearch(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1 shrink-0" onClick={exportJournalCSV}>
                <Download size={11} />Export CSV
              </Button>
            </div>

            {filteredJournal.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-slate-300">
                <BookOpen size={36} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucune activité trouvée</p>
              </div>
            ) : (
              <div className="relative">
                {/* Ligne de temps */}
                <div className="absolute left-[68px] top-0 bottom-0 w-px bg-slate-100 dark:bg-slate-700" />
                <div className="divide-y divide-slate-50 dark:divide-slate-700/50 max-h-[700px] overflow-y-auto">
                  {filteredJournal.map((j, idx) => {
                    const meta = MOVEMENT_META[j.type];
                    const showDateSep = idx === 0 ||
                      new Date(j.date).toLocaleDateString() !== new Date(filteredJournal[idx - 1].date).toLocaleDateString();
                    return (
                      <div key={j.id}>
                        {showDateSep && (
                          <div className="flex items-center gap-3 px-5 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700">
                            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-14">
                              {new Date(j.date).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                            </span>
                          </div>
                        )}
                        <div className="px-5 py-3 flex items-start gap-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          {/* Heure */}
                          <div className="text-right shrink-0 w-10 pt-0.5">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                              {new Date(j.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          {/* Point timeline */}
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 z-10 ${meta ? `${meta.bg} ${meta.darkBg} border-current` : "bg-slate-100 border-slate-300"}`}>
                            {meta && <meta.Icon size={9} className={meta.color} />}
                          </div>
                          {/* Contenu */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${meta?.bg ?? "bg-slate-50 border-slate-200"} ${meta?.darkBg ?? ""} ${meta?.color ?? "text-slate-600"}`}>
                                {j.action}
                              </span>
                              <span className="text-xs font-black text-slate-800 dark:text-slate-200">{j.equipement}</span>
                            </div>
                            {j.detail && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{j.detail}</p>}
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center gap-1">
                              <User size={9} />{j.agent}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB JOURNAL GLOBAL (AUDIT) ══ */}
      {activeTab === "audit" && <AuditLogPanel />}

      {/* ══ TAB APPROBATIONS (CSA) ══ */}
      {activeTab === "approbations" && <ApprobationsPanel />}

      {/* ══ TAB ALERTES ══ */}
      {activeTab === "alertes" && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />Alertes système
            </h3>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
              alerts.length > 0 ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
            }`}>{alerts.length} alerte{alerts.length !== 1 ? "s" : ""}</span>
          </div>
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-emerald-500">
              <CheckCircle2 size={40} strokeWidth={1.5} />
              <p className="text-sm font-bold text-slate-400">Aucune alerte — tout est nominal</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {alerts.map((a, i) => (
                <div key={i} className={`px-5 py-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${
                  a.level === "danger" ? "border-l-4 border-red-400" : "border-l-4 border-amber-400"
                }`}>
                  <span className={`mt-0.5 shrink-0 ${a.level === "danger" ? "text-red-500" : "text-amber-500"}`}>
                    {a.level === "danger" ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <div className="flex-1">
                    <p className={`text-sm font-black ${a.level === "danger" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{a.msg}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{a.cat}</p>
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded border shrink-0 ${
                    a.level === "danger" ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                  }`}>{a.level === "danger" ? "CRITIQUE" : "ATTENTION"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ TAB UTILISATEURS ══ */}
      {activeTab === "utilisateurs" && (
        <div className="flex flex-col gap-6">

          {/* Sessions actives */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Sessions actives en ce moment
              </h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                onlineUsers.length > 0
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                  : "bg-slate-50 dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600"
              }`}>{onlineUsers.length} connecté{onlineUsers.length !== 1 ? "s" : ""}</span>
            </div>
            {onlineUsers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-slate-300">
                <User size={28} strokeWidth={1} />
                <p className="text-xs text-slate-400 font-bold">Aucune session active</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {onlineUsers.map((u, i) => {
                  const user = allUsers.find(a => a.id === u.userId);
                  return (
                    <div key={i} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
                        <User size={14} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-black text-slate-800 dark:text-slate-200">{user?.display_name || user?.username || u.userId?.substring(0, 8)}</p>
                        <p className="text-[10px] text-slate-400">{u.role}</p>
                      </div>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />EN LIGNE
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tous les utilisateurs */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <User size={14} className="text-accent" />Tous les comptes utilisateurs
              </h3>
              <span className="text-[10px] text-slate-400 font-bold">{allUsers.length} compte{allUsers.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    {["Utilisateur", "Identifiant", "Rôle", "Créé le", "Activité", "Statut"].map(h => (
                      <th key={h} className="text-left text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-10 px-5 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allUsers.length === 0 ? (
                    <tr><td colSpan={6} className="h-20 text-center text-xs text-slate-300 italic">Aucun utilisateur</td></tr>
                  ) : allUsers.map(u => {
                    const isOnline = onlineUsers.some(o => o.userId === u.id);
                    // Compter TOUTES les actions de cet utilisateur (Journal global d'audit :
                    // connexions, config, mouvements, gestion des comptes, etc.)
                    const summary = auditSummary.find(a => a.userId === u.id);
                    const opCount = summary?.total ?? 0;
                    const lastOpDate = summary?.lastAt;

                    return (
                      <tr key={u.id} className="border-b border-zinc-100 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700/50 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 border ${
                              isOnline ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400" : "bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500"
                            }`}>
                              {(u.display_name || u.username || "?")[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-black text-slate-800 dark:text-slate-200 text-xs">{u.display_name || u.username}</p>
                              {u.email && <p className="text-[10px] text-slate-400">{u.email}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">{u.username}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${
                            u.role === "admin" ? "bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800" :
                            u.role === "agent_logistique" ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800" :
                            "bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
                          }`}>{u.role}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">{u.created_at ? fmtDate(u.created_at) : "—"}</span>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-[11px] font-black text-slate-700 dark:text-slate-300">{opCount} opération{opCount !== 1 ? "s" : ""}</p>
                          {lastOpDate && <p className="text-[10px] text-slate-400">Dernière: {fmtDate(lastOpDate)}</p>}
                        </td>
                        <td className="px-5 py-3">
                          {isOnline ? (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 w-fit">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />EN LIGNE
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-slate-300 dark:text-slate-600">Hors ligne</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Traçabilité — note sur la conservation des données */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-5 py-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-amber-800 dark:text-amber-400">Traçabilité garantie après suppression</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-1">
                Même si un compte est supprimé, toutes ses actions restent visibles dans le journal d'activité avec son nom complet. Le nom de l'agent est conservé au moment de chaque opération.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}