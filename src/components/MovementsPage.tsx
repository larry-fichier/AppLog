import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { ArrowLeftRight, Search, Filter, Loader2, Pencil, FileDown } from "lucide-react";
import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal, Truck } from "lucide-react";
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { MovementDialog } from "./MovementDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { buildReportHtml, openReportPrintWindow, tableRows, renderTable } from "@/lib/reportTemplate";

const MOVEMENTS_PAGE_SIZE = 10;

function isVehicleCategory(label: string = ""): boolean {
  const l = label.toLowerCase();
  return l.includes("rame") || l.includes("véhicule") || l.includes("vehicule") || l.includes("automobile");
}

const TYPE_META = {
  entree:      { label: 'Entrée',      Icon: ArrowDown,         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  sortie:      { label: 'Sortie',      Icon: ArrowUp,           cls: 'bg-red-50 text-red-700 border-red-200' },
  transfert:   { label: 'Transfert',   Icon: ArrowLeftRight,    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  retour:      { label: 'Retour',      Icon: RotateCcw,         cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  ajustement:  { label: 'Ajustement',  Icon: SlidersHorizontal, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  deploiement: { label: 'Déploiement', Icon: Truck,             cls: 'bg-orange-50 text-orange-700 border-orange-200' },
} as const;

interface Movement {
  id: string; type: string; created_at: string;
  performed_by_name: string;
  equipment_name?: string; equipment_id: string;
  from_zone_name?: string; from_station_name?: string;
  to_zone_name?: string;   to_station_name?: string;
  to_zone_id?: string;     to_station_id?: string;
  previous_status?: string; new_status?: string;
  note?: string; reference?: string;
  date_deploiement?: string; date_retour_prevue?: string;
  status?: "pending" | "approved" | "rejected";
  decision_note?: string;
}

const STATUS_META = {
  pending:  { label: "En attente d'approbation", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  rejected: { label: "Rejeté",                    cls: "bg-red-50 text-red-700 border-red-200" },
} as const;

interface Props {
  activeRole?: string;
  isBypass?: boolean;
  zones: { id: string; label: string }[];
  stations: { id: string; label: string; zoneId: string }[];
  userZoneId?: string;
}

export function MovementsPage({ activeRole, isBypass, zones, stations, userZoneId }: Props) {
  const [rows, setRows]           = useState<Movement[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [isDialogOpen, setIsDialogOpen]         = useState(false);
  const [selectedEquip, setSelectedEquip]         = useState<any | null>(null);
  const [editingMovement, setEditingMovement]     = useState<any | null>(null);
  const [equipment, setEquipment]                 = useState<any[]>([]);

  const canEdit = ["agent_logistique", "admin", "com_zone"].includes(activeRole || "");
  const canApprove = ["admin", "chef_bureau", "chef_service_administratif"].includes(activeRole || "");
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function decideMovement(id: string, action: "approve" | "reject") {
    let note: string | undefined;
    if (action === "reject") {
      const reason = window.prompt("Motif du rejet (obligatoire) :")?.trim();
      if (!reason) {
        if (reason === "") toast.error("Un motif est obligatoire pour rejeter un transfert.");
        return;
      }
      note = reason;
    }
    setDecidingId(id);
    try {
      const res = await apiFetch(`/api/movements/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(action === "approve" ? "Transfert approuvé" : "Transfert rejeté");
      fetchMovements();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDecidingId(null);
    }
  }

  async function fetchMovements() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set('from', dateFrom);
      if (dateTo) qs.set('to', dateTo);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await apiFetch(`/api/movements${suffix}`);
      if (res.ok) setRows(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function fetchEquipment() {
    try {
      const res = await apiFetch('/api/equipment');
      if (res.ok) setEquipment(await res.json());
    } catch (e) { console.error(e); }
  }

  useEffect(() => { fetchEquipment(); }, []);
  useEffect(() => { fetchMovements(); }, [dateFrom, dateTo]);

  function handleGenerateReport() {
    if (!dateFrom || !dateTo) { toast.error("Sélectionnez une période (du / au) pour générer le rapport"); return; }
    const periodMovements = rows.filter(mv => mv.type === "entree" || mv.type === "sortie");
    const entrees = periodMovements.filter(mv => mv.type === "entree").length;
    const sorties = periodMovements.filter(mv => mv.type === "sortie").length;

    const kpiHtml = `<div class="kpis" style="grid-template-columns: repeat(3, 1fr)">
      <div class="kpi"><div class="kpi-val" style="color:#22c55e">${entrees}</div><div class="kpi-lbl">Entrées</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#ef4444">${sorties}</div><div class="kpi-lbl">Sorties</div></div>
      <div class="kpi"><div class="kpi-val">${periodMovements.length}</div><div class="kpi-lbl">Total mouvements</div></div>
    </div>`;

    const sorted = periodMovements
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const bodyHtml = tableRows(
      sorted.map(mv => [
        new Date(mv.created_at).toLocaleDateString("fr-FR"),
        TYPE_META[mv.type as keyof typeof TYPE_META]?.label || mv.type,
        mv.equipment_name || mv.equipment_id.substring(0, 8),
        [mv.from_zone_name, mv.to_zone_name].filter(Boolean).join(" → ") || "—",
        mv.performed_by_name || "—",
        mv.note || mv.reference || "—",
      ])
    );
    const tableHtml = renderTable(["Date", "Type", "Équipement", "Trajet", "Agent", "Référence / Note"], bodyHtml);

    const zoneLabel = activeRole === "com_zone"
      ? (zones.find(z => z.id === userZoneId)?.label || "Ma zone")
      : "Toutes zones";

    const html = buildReportHtml({
      docTitle: "État des entrées / sorties",
      docSubtitle: `${zoneLabel} · Période du ${new Date(dateFrom).toLocaleDateString("fr-FR")} au ${new Date(dateTo).toLocaleDateString("fr-FR")}`,
      sections: [
        { title: "Résumé", html: kpiHtml },
        { title: "Détail des mouvements", html: tableHtml },
      ],
      signatureTitle: activeRole === "com_zone" ? "Le COM Zone" : "Le Chef de Bureau",
    });
    openReportPrintWindow(html);
  }

  const filtered = rows.filter(mv => {
    const matchType   = filterType === "all" || mv.type === filterType;
    const matchSearch = !search
      || mv.equipment_name?.toLowerCase().includes(search.toLowerCase())
      || mv.reference?.toLowerCase().includes(search.toLowerCase())
      || mv.performed_by_name?.toLowerCase().includes(search.toLowerCase())
      || mv.to_zone_name?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const [movementsPage, setMovementsPage] = useState(1);
  const movementsTotalPages = Math.max(1, Math.ceil(filtered.length / MOVEMENTS_PAGE_SIZE));
  useEffect(() => {
    if (movementsPage > movementsTotalPages) setMovementsPage(movementsTotalPages);
  }, [movementsTotalPages, movementsPage]);
  useEffect(() => { setMovementsPage(1); }, [search, filterType]);
  const paginatedFiltered = filtered.slice(
    (movementsPage - 1) * MOVEMENTS_PAGE_SIZE,
    movementsPage * MOVEMENTS_PAGE_SIZE
  );

  // Compteurs par type
  const counts = Object.fromEntries(
    Object.keys(TYPE_META).map(t => [t, rows.filter(r => r.type === t).length])
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold text-accent uppercase tracking-[2px]">
            <ArrowLeftRight size={12} />
            <span>Traçabilité des actifs</span>
          </div>
          <h2 className="text-xl font-extrabold text-text-dark">Journal des Mouvements</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-border-custom rounded-lg px-2 h-10">
            <span className="text-[10px] font-black text-zinc-400 uppercase">Du</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={e => setDateFrom(e.target.value)}
              className="text-xs border-none focus:outline-none bg-transparent"
            />
            <span className="text-[10px] font-black text-zinc-400 uppercase">Au</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => setDateTo(e.target.value)}
              className="text-xs border-none focus:outline-none bg-transparent"
            />
          </div>
          <Button
            variant="outline"
            className="h-10 px-4 text-xs font-black border-border-custom"
            onClick={handleGenerateReport}
          >
            <FileDown className="w-3.5 h-3.5 mr-2" />
            Rapport entrées/sorties
          </Button>
          {canEdit && (
          <Button
            className="bg-slate-900 hover:bg-brand-orange text-white font-black h-10 px-5 text-xs"
            onClick={() => { setSelectedEquip(null); setIsDialogOpen(true); }}
          >
            <ArrowLeftRight className="w-3.5 h-3.5 mr-2" />
            Nouveau mouvement
          </Button>
          )}
        </div>
      </div>

      {/* Stat pills par type */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterType("all")}
          className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all ${
            filterType === "all"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
          }`}
        >
          Tous · {rows.length}
        </button>
        {Object.entries(TYPE_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setFilterType(filterType === key ? "all" : key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all flex items-center gap-1.5 ${
              filterType === key
                ? `${meta.cls} border-current`
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
            }`}
          >
            <meta.Icon size={11} />
            {meta.label} · {counts[key] ?? 0}
          </button>
        ))}
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-border-custom shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-[#fafbfc] border-b border-border-custom flex justify-between items-center gap-4">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 shrink-0">
            <div className="h-5 w-0.5 bg-accent" />
            {filtered.length} mouvement{filtered.length !== 1 ? "s" : ""}
          </h3>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-300" />
            <input
              placeholder="Chercher équipement, référence, agent..."
              className="w-full pl-10 pr-4 h-9 text-sm bg-white border border-border-custom rounded-lg focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] border-b border-border-custom">
              <tr>
                {["Type", "Équipement", "Trajet", "Statut", "Référence", "Agent", "Date"].map(h => (
                  <th key={h} className="text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest h-10 px-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="h-48 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-48 text-center text-sm text-zinc-300 italic">
                    Aucun mouvement trouvé
                  </td>
                </tr>
              ) : paginatedFiltered.map(mv => {
                const meta = TYPE_META[mv.type as keyof typeof TYPE_META];
                const Icon = meta?.Icon;
                return (
                  <tr key={mv.id} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors">

                    {/* Type */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border ${meta?.cls ?? 'bg-zinc-100 text-zinc-500'}`}>
                        {Icon && <Icon size={10} />}
                        {meta?.label ?? mv.type}
                      </span>
                    </td>

                    {/* Équipement */}
                    <td className="px-5 py-3.5">
                      <p className="font-black text-slate-800 text-xs uppercase">{mv.equipment_name || mv.equipment_id.substring(0, 8)}</p>
                    </td>

                    {/* Trajet */}
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-slate-600">
                        {mv.from_zone_name
                          ? <span className="text-zinc-400">{mv.from_zone_name}{mv.from_station_name && ` / ${mv.from_station_name}`} → </span>
                          : null}
                        {mv.to_zone_name
                          ? <span>{mv.to_zone_name}{mv.to_station_name && ` / ${mv.to_station_name}`}</span>
                          : <span className="italic text-zinc-300">—</span>}
                      </p>
                      {mv.status && mv.status !== "approved" && (
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-black border ${STATUS_META[mv.status].cls}`}>
                          {STATUS_META[mv.status].label}
                        </span>
                      )}
                      {mv.status === "rejected" && mv.decision_note && (
                        <p className="text-[10px] text-red-500 italic mt-0.5">« {mv.decision_note} »</p>
                      )}
                      {/* Dates déploiement */}
                      {mv.date_deploiement && (
                        <p className="text-[10px] text-orange-500 mt-0.5 font-bold">
                          Sortie : {new Date(mv.date_deploiement).toLocaleDateString('fr-FR')}
                          {mv.date_retour_prevue && ` → Retour : ${new Date(mv.date_retour_prevue).toLocaleDateString('fr-FR')}`}
                        </p>
                      )}
                    </td>

                    {/* Changement statut */}
                    <td className="px-5 py-3.5">
                      {mv.previous_status && mv.new_status && mv.previous_status !== mv.new_status ? (
                        <p className="text-[11px] text-slate-500">
                          {mv.previous_status} → <strong className="text-slate-700">{mv.new_status}</strong>
                        </p>
                      ) : <span className="text-zinc-300">—</span>}
                    </td>

                    {/* Référence */}
                    <td className="px-5 py-3.5">
                      {mv.reference
                        ? <span className="font-mono text-[11px] bg-zinc-100 px-2 py-0.5 rounded text-zinc-600">{mv.reference}</span>
                        : <span className="text-zinc-300">—</span>}
                    </td>

                    {/* Agent */}
                    <td className="px-5 py-3.5">
                      <p className="text-xs font-medium text-slate-600">{mv.performed_by_name}</p>
                    </td>

                    {/* Date */}
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-zinc-400">
                        {new Date(mv.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-[10px] text-zinc-300">
                        {new Date(mv.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3.5 text-right">
                      {canApprove && mv.status === "pending" ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline" size="sm"
                            className="h-7 px-3 text-[10px] font-black gap-1 border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400"
                            disabled={decidingId === mv.id}
                            onClick={() => decideMovement(mv.id, "approve")}
                          >
                            <CheckCircle2 size={10} />Approuver
                          </Button>
                          <Button
                            variant="outline" size="sm"
                            className="h-7 px-3 text-[10px] font-black gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-400"
                            disabled={decidingId === mv.id}
                            onClick={() => decideMovement(mv.id, "reject")}
                          >
                            <XCircle size={10} />Rejeter
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline" size="sm"
                          className="h-7 px-3 text-[10px] font-black gap-1 border-amber-200 text-amber-600 hover:bg-amber-50 hover:border-amber-400"
                          onClick={() => {
                            const equip = equipment.find(e => e.id === mv.equipment_id);
                            setSelectedEquip(equip || { id: mv.equipment_id, name: mv.equipment_name || mv.equipment_id, zone_id: mv.to_zone_id, station_id: mv.to_station_id, status: mv.new_status });
                            setEditingMovement(mv);
                            setIsDialogOpen(true);
                          }}
                        >
                          <Pencil size={10} />Modifier
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > MOVEMENTS_PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-border-custom flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 font-bold">
              Page {movementsPage} / {movementsTotalPages} — {filtered.length} mouvement{filtered.length > 1 ? "s" : ""}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={movementsPage <= 1}
                onClick={() => setMovementsPage(p => Math.max(1, p - 1))}>
                <ChevronLeft size={14} />
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={movementsPage >= movementsTotalPages}
                onClick={() => setMovementsPage(p => Math.min(movementsTotalPages, p + 1))}>
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog sélection équipement */}
      {isDialogOpen && !selectedEquip && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div>
              <h3 className="font-black text-slate-900 text-base">Choisir un équipement</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">Recherchez par nom, numéro de série ou catégorie</p>
            </div>
            <input
              autoFocus
              placeholder="Numéro de série, nom, catégorie..."
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              onChange={e => {
                const val = e.target.value.toLowerCase();
                document.querySelectorAll<HTMLButtonElement>('[data-equip-btn]').forEach(btn => {
                  btn.style.display = btn.dataset.search?.includes(val) ? '' : 'none';
                });
              }}
            />
            <div className="max-h-72 overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
              {equipment.map(eq => {
                const serial = eq.details?.numero_serie || eq.details?.immatriculation || '';
                const searchVal = `${eq.name} ${serial} ${eq.category_label}`.toLowerCase();
                return (
                  <button key={eq.id}
                    data-equip-btn
                    data-search={searchVal}
                    className="text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all"
                    onClick={() => {
                      setSelectedEquip(eq);
                      setIsDialogOpen(false);
                      setTimeout(() => setIsDialogOpen(true), 50);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        {/* Numéro de série en priorité si disponible */}
                        {serial ? (
                          <>
                            <p className="font-black text-slate-900 text-xs font-mono uppercase tracking-wide">{serial}</p>
                            <p className="text-[11px] text-zinc-500 truncate mt-0.5">{eq.name}</p>
                          </>
                        ) : (
                          <p className="font-black text-slate-900 text-sm">{eq.name}</p>
                        )}
                      </div>
                      <span className="text-[10px] font-black text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded shrink-0">
                        {eq.category_label}
                      </span>
                    </div>
                    {/* Zone / station actuelle */}
                    {eq.zone_name && (
                      <p className="text-[10px] text-accent mt-1 font-bold">
                        📍 {eq.zone_name}{eq.station_name ? ` → ${eq.station_name}` : ''}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setIsDialogOpen(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600 w-full text-center py-1"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {selectedEquip && isDialogOpen && (
        <MovementDialog
          open={isDialogOpen}
          onOpenChange={open => {
            if (!open) {
              setSelectedEquip(null);
              setEditingMovement(null);
              setIsDialogOpen(false);
              fetchMovements();
            }
          }}
          equipmentId={selectedEquip.id}
          equipmentName={selectedEquip.name}
          currentZoneId={selectedEquip.zone_id}
          currentStationId={selectedEquip.station_id}
          currentStatus={selectedEquip.status}
          zones={zones}
          stations={stations}
          isVehicle={isVehicleCategory(selectedEquip.category_label)}
          onSuccess={fetchMovements}
          editingMovement={editingMovement}
          lockedZoneId={activeRole === "com_zone" ? userZoneId : undefined}
          onlyTransfert={activeRole === "com_zone"}
        />
      )}
    </div>
  );
}