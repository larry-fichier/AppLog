import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck, Search, Download, RefreshCw, ChevronLeft, ChevronRight,
  LogIn, LogOut, Box, Pencil, Trash2, ArrowLeftRight, PackageMinus,
  Settings2, LifeBuoy, UserPlus, UserCog, UserMinus, KeyRound, Activity, AlertTriangle,
  ClipboardCheck, CheckCircle2, XCircle, Truck, PackageCheck, FileText, Recycle, Award,
} from "lucide-react";

interface AuditLogRow {
  id: string;
  action: string;
  user_id: string | null;
  user_name: string;
  role: string | null;
  details: Record<string, any> | null;
  ip: string | null;
  created_at: string;
}

const ACTION_META: Record<string, { label: string; Icon: any; color: string; bg: string }> = {
  LOGIN_SUCCESS:       { label: "Connexion",                     Icon: LogIn,        color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  LOGOUT:              { label: "Déconnexion",                   Icon: LogOut,       color: "text-slate-600 dark:text-slate-300",      bg: "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600" },
  EQUIPMENT_CREATED:   { label: "Équipement créé",                Icon: Box,          color: "text-blue-700 dark:text-blue-400",        bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800" },
  EQUIPMENT_UPDATED:   { label: "Équipement modifié",             Icon: Pencil,       color: "text-amber-700 dark:text-amber-400",      bg: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800" },
  EQUIPMENT_DELETED:   { label: "Équipement supprimé",            Icon: Trash2,       color: "text-red-700 dark:text-red-400",          bg: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" },
  MOVEMENT_CREATED:    { label: "Mouvement enregistré",           Icon: ArrowLeftRight, color: "text-purple-700 dark:text-purple-400",  bg: "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800" },
  MOVEMENT_UPDATED:    { label: "Mouvement modifié",              Icon: Pencil,       color: "text-purple-700 dark:text-purple-400",    bg: "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800" },
  STOCK_SORTIE:        { label: "Sortie de stock",                Icon: PackageMinus, color: "text-orange-700 dark:text-orange-400",    bg: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800" },
  STOCK_SORTIE_STATION: { label: "Sortie de stock vers un bureau", Icon: PackageMinus, color: "text-orange-700 dark:text-orange-400",    bg: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800" },
  CONFIG_UPDATED:      { label: "Configuration mise à jour",      Icon: Settings2,    color: "text-cyan-700 dark:text-cyan-400",        bg: "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800" },
  ADMIN_RECOVER:       { label: "Récupération d'urgence",         Icon: LifeBuoy,     color: "text-cyan-700 dark:text-cyan-400",        bg: "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800" },
  USER_CREATED:        { label: "Utilisateur créé",               Icon: UserPlus,     color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  USER_ROLE_UPDATED:   { label: "Rôle modifié",                   Icon: UserCog,      color: "text-amber-700 dark:text-amber-400",      bg: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800" },
  USER_DELETED:        { label: "Utilisateur supprimé",           Icon: UserMinus,    color: "text-red-700 dark:text-red-400",          bg: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" },
  USER_PASSWORD_RESET: { label: "Mot de passe réinitialisé",      Icon: KeyRound,     color: "text-slate-600 dark:text-slate-300",      bg: "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600" },
  USER_PASSWORD_CHANGED_SELF: { label: "Mot de passe changé",     Icon: KeyRound,     color: "text-emerald-700 dark:text-emerald-400",  bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  EQUIPMENT_PANNE_DECLAREE: { label: "Panne déclarée",             Icon: AlertTriangle, color: "text-red-700 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" },
  EQUIPMENT_REPARATION_DECLAREE: { label: "Réparation signalée",   Icon: CheckCircle2, color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  EQUIPMENT_DECLASSE: { label: "Équipement déclassé",     Icon: Recycle, color: "text-slate-600 dark:text-slate-300", bg: "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600" },
  EQUIPMENT_REFORME:  { label: "Véhicule réformé",        Icon: Award,   color: "text-purple-700 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800" },
  EQUIPMENT_REFORME_ANNULEE: { label: "Réforme annulée",  Icon: Award,   color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  STOCK_DECLARATION_CREATED:   { label: "Écart de stock déclaré",     Icon: ClipboardCheck, color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800" },
  STOCK_DECLARATION_CONFIRMED: { label: "Stock confirmé (sans écart)", Icon: ClipboardCheck, color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  STOCK_DECLARATION_APPROVED:  { label: "Déclaration de stock approuvée", Icon: CheckCircle2, color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  STOCK_DECLARATION_REJECTED:  { label: "Déclaration de stock rejetée", Icon: XCircle, color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" },
  RESUPPLY_NEEDED:    { label: "Ravitaillement nécessaire",  Icon: Truck,         color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800" },
  RESUPPLY_FULFILLED: { label: "Ravitaillement effectif",    Icon: PackageCheck,  color: "text-blue-700 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800" },
  RESUPPLY_CONFIRMED: { label: "Réception confirmée",        Icon: PackageCheck,  color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
  REPORT_GENERATED: { label: "Rapport généré",                Icon: FileText,      color: "text-cyan-700 dark:text-cyan-400",       bg: "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800" },
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  chef_service_administratif: "Chef Service Administratif",
  chef_bureau: "Chef de Bureau",
  chef_ram: "Chef RAM",
  com_zone: "COM Zone",
  csph: "CSPH",
  agent_logistique: "Agent Logistique",
};

function metaFor(action: string) {
  return ACTION_META[action] || { label: action, Icon: Activity, color: "text-slate-600 dark:text-slate-300", bg: "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600" };
}

function detailSummary(action: string, details: Record<string, any> | null): string {
  if (!details) return "";
  switch (action) {
    case "EQUIPMENT_CREATED":
    case "EQUIPMENT_UPDATED":
    case "EQUIPMENT_DELETED":
      return details.equipmentName ? `Équipement : ${details.equipmentName}` : (details.equipmentId ? `ID : ${String(details.equipmentId).substring(0, 8)}` : "");
    case "MOVEMENT_CREATED":
      return [details.equipmentName ? `Équipement : ${details.equipmentName}` : "", details.movementType ? `Type : ${details.movementType}` : ""].filter(Boolean).join(" · ");
    case "STOCK_SORTIE":
      return [details.equipmentName ? `Équipement : ${details.equipmentName}` : "", details.quantite ? `Quantité : -${details.quantite}` : "", details.destination ? `→ ${details.destination}` : ""].filter(Boolean).join(" · ");
    case "STOCK_SORTIE_STATION":
      return [details.equipmentName ? `Équipement : ${details.equipmentName}` : "", details.quantite ? `Quantité : -${details.quantite}` : "", details.stationName ? `→ ${details.stationName}` : ""].filter(Boolean).join(" · ");
    case "USER_CREATED":
    case "USER_ROLE_UPDATED":
    case "USER_DELETED":
    case "USER_PASSWORD_RESET":
      return details.targetUsername ? `Utilisateur : ${details.targetUsername}${details.newRole ? ` → ${ROLE_LABELS[details.newRole] || details.newRole}` : ""}` : "";
    case "LOGIN_SUCCESS":
      return details.username ? `Identifiant : ${details.username}` : "";
    case "CONFIG_UPDATED":
      return [details.categories != null ? `${details.categories} catégorie(s)` : "", details.zones != null ? `${details.zones} zone(s)` : "", details.stations != null ? `${details.stations} station(s)` : ""].filter(Boolean).join(" · ");
    case "ADMIN_RECOVER":
      return `${details.recoveredStations ?? 0} bureau(x), ${details.recoveredZones ?? 0} zone(s) récupérés`;
    case "EQUIPMENT_PANNE_DECLAREE":
      return [details.equipmentName ? `Véhicule : ${details.equipmentName}` : "", details.description ? `Panne : ${details.description}` : ""].filter(Boolean).join(" · ");
    case "EQUIPMENT_REPARATION_DECLAREE":
      return [details.equipmentName ? `Véhicule : ${details.equipmentName}` : "", details.note ? `Note : ${details.note}` : ""].filter(Boolean).join(" · ");
    case "EQUIPMENT_DECLASSE":
      return details.note ? `Motif : ${details.note}` : "";
    case "EQUIPMENT_REFORME":
      return [details.recipient ? `Remis à : ${details.recipient}` : "", details.note ? `Note : ${details.note}` : ""].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

const PAGE_SIZE = 40;

export function AuditLogPanel() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) params.set("q", search.trim());
      if (actionFilter !== "all") params.set("action", actionFilter);
      const res = await apiFetch(`/api/admin/audit-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setTotal(data.total || 0);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [page, search, actionFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  // Réinitialise à la page 1 lors d'un changement de filtre
  useEffect(() => { setPage(1); }, [search, actionFilter]);

  function exportCSV() {
    const header = ["Date", "Heure", "Utilisateur", "Rôle", "Action", "Détails", "IP"];
    const lines = rows.map(r => [
      new Date(r.created_at).toLocaleDateString("fr-FR"),
      new Date(r.created_at).toLocaleTimeString("fr-FR"),
      r.user_name,
      ROLE_LABELS[r.role || ""] || r.role || "",
      metaFor(r.action).label,
      detailSummary(r.action, r.details).replace(/"/g, "'"),
      r.ip || "",
    ]);
    const csv = [header, ...lines].map(row => row.map(c => `"${c}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <ShieldCheck size={14} className="text-accent" />
          <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm">Journal global d'audit</h3>
          <span className="text-[10px] text-slate-400 font-bold">— toutes les actions du système · {total} enregistrement(s)</span>
        </div>
        <div className="relative min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-300 dark:text-slate-500" />
          <input
            placeholder="Rechercher utilisateur, action..."
            className="w-full pl-10 pr-4 h-9 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-accent/20 transition-all"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="h-9 text-xs font-bold bg-slate-50 dark:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded-lg px-2"
        >
          <option value="all">Toutes les actions</option>
          {Object.entries(ACTION_META).map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={fetchLogs}>
          <RefreshCw size={13} />Actualiser
        </Button>
        <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={exportCSV}>
          <Download size={13} />Export CSV
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-300">
          <RefreshCw size={32} className="animate-spin" strokeWidth={1} />
          <p className="text-xs font-bold text-slate-400">Chargement du journal...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-300">
          <ShieldCheck size={36} strokeWidth={1} />
          <p className="text-sm font-bold text-slate-400">Aucune activité trouvée</p>
        </div>
      ) : (
        <>
          <div className="relative">
            <div className="absolute left-[68px] top-0 bottom-0 w-px bg-slate-100 dark:bg-slate-700" />
            <div className="divide-y divide-slate-50 dark:divide-slate-700/50 max-h-[700px] overflow-y-auto">
              {rows.map((r, idx) => {
                const meta = metaFor(r.action);
                const showDateSep = idx === 0 ||
                  new Date(r.created_at).toLocaleDateString() !== new Date(rows[idx - 1].created_at).toLocaleDateString();
                const detail = detailSummary(r.action, r.details);
                return (
                  <div key={r.id}>
                    {showDateSep && (
                      <div className="flex items-center gap-3 px-5 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700">
                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-14">
                          {new Date(r.created_at).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                        </span>
                      </div>
                    )}
                    <div className="px-5 py-3 flex items-start gap-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <div className="text-right shrink-0 w-10 pt-0.5">
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                          {new Date(r.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 z-10 ${meta.bg} border-current`}>
                        <meta.Icon size={9} className={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${meta.bg} ${meta.color}`}>
                            {meta.label}
                          </span>
                          <span className="text-xs font-black text-slate-800 dark:text-slate-200">{r.user_name}</span>
                          {r.role && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                              ({ROLE_LABELS[r.role] || r.role})
                            </span>
                          )}
                        </div>
                        {detail && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{detail}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold">Page {page} / {totalPages}</span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft size={14} />
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
