import { useState, useEffect } from "react";
import { ArrowLeftRight, Search, Filter, Loader2 } from "lucide-react";
import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal, Truck } from "lucide-react";
import { MovementDialog } from "./MovementDialog";
import { Button } from "@/components/ui/button";

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
  previous_status?: string; new_status?: string;
  note?: string; reference?: string;
  date_deploiement?: string; date_retour_prevue?: string;
}

interface Props {
  activeRole?: string;
  isBypass?: boolean;
  zones: { id: string; label: string }[];
  stations: { id: string; label: string; zoneId: string }[];
}

export function MovementsPage({ activeRole, isBypass, zones, stations }: Props) {
  const [rows, setRows]           = useState<Movement[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen]   = useState(false);
  const [selectedEquip, setSelectedEquip] = useState<any | null>(null);
  const [equipment, setEquipment] = useState<any[]>([]);

  const canEdit = ["agent_logistique", "chef_bureau_logistique", "admin"].includes(activeRole || "");

  async function fetchMovements() {
    setLoading(true);
    try {
      const res = await fetch('/api/movements', {
        headers: { Authorization: `Bearer ${localStorage.getItem('helios_token')}` },
      });
      if (res.ok) setRows(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function fetchEquipment() {
    try {
      const res = await fetch('/api/equipment', {
        headers: { Authorization: `Bearer ${localStorage.getItem('helios_token')}` },
      });
      if (res.ok) setEquipment(await res.json());
    } catch (e) { console.error(e); }
  }

  useEffect(() => {
    fetchMovements();
    fetchEquipment();
  }, []);

  const filtered = rows.filter(mv => {
    const matchType   = filterType === "all" || mv.type === filterType;
    const matchSearch = !search
      || mv.equipment_name?.toLowerCase().includes(search.toLowerCase())
      || mv.reference?.toLowerCase().includes(search.toLowerCase())
      || mv.performed_by_name?.toLowerCase().includes(search.toLowerCase())
      || mv.to_zone_name?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

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
              ) : filtered.map(mv => {
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      {selectedEquip && (
        <MovementDialog
          open={!!selectedEquip}
          onOpenChange={open => { if (!open) { setSelectedEquip(null); fetchMovements(); } }}
          equipmentId={selectedEquip.id}
          equipmentName={selectedEquip.name}
          currentZoneId={selectedEquip.zone_id}
          currentStationId={selectedEquip.station_id}
          currentStatus={selectedEquip.status}
          zones={zones}
          stations={stations}
          onSuccess={fetchMovements}
        />
      )}
    </div>
  );
}