import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MovementHistory } from "./MovementHistory";
import { Search, X, History, Loader2 } from "lucide-react";

interface EquipmentRow {
  id: string;
  name: string;
  category_label?: string;
  status?: string;
  zone_name?: string | null;
  station_name?: string | null;
  details?: Record<string, string>;
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  fonctionnel:   { label: "Fonctionnel",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  en_reparation: { label: "En réparation", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800" },
  hors_service:  { label: "Hors service",  cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
  declasse:      { label: "Déclassé",      cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600" },
  reforme:       { label: "Réformé",       cls: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800" },
};

// ── Barre de recherche globale : retrouve un équipement en un prompt (nom,
// n° série, immatriculation, catégorie, zone) et ouvre directement sa
// timeline complète (entrée → transferts → panne/réparation → déclassement/
// réforme), au lieu d'obliger à naviguer jusqu'à sa fiche pour la consulter.
// S'appuie sur GET /api/equipment, déjà filtré côté serveur par rôle/zone —
// aucune fuite de portée, la recherche ne voit que ce que l'utilisateur voit
// déjà ailleurs dans l'application.
export function GlobalEquipmentSearch() {
  const [query, setQuery]         = useState("");
  const [open, setOpen]           = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [historyItem, setHistoryItem] = useState<EquipmentRow | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function ensureLoaded() {
    if (loaded || loading) return;
    setLoading(true);
    apiFetch("/api/equipment")
      .then(r => (r.ok ? r.json() : []))
      .then(data => { setEquipment(Array.isArray(data) ? data : []); setLoaded(true); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const q = query.trim().toLowerCase();
  const results = q.length < 2 ? [] : equipment.filter(e =>
    e.name?.toLowerCase().includes(q) ||
    e.category_label?.toLowerCase().includes(q) ||
    e.zone_name?.toLowerCase().includes(q) ||
    e.station_name?.toLowerCase().includes(q) ||
    Object.values(e.details || {}).some(v => String(v).toLowerCase().includes(q))
  ).slice(0, 8);

  return (
    <>
      <div className="relative w-full max-w-md" ref={wrapperRef}>
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-500 pointer-events-none" />
        <input
          value={query}
          onFocus={() => { ensureLoaded(); if (query.trim().length >= 2) setOpen(true); }}
          onChange={e => { setQuery(e.target.value); setOpen(true); ensureLoaded(); }}
          placeholder="Rechercher un équipement — nom, n° série, immatriculation..."
          className="w-full pl-8 pr-7 h-9 text-xs bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-accent/20 focus:border-accent dark:focus:border-accent transition-all"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-300"
          >
            <X size={13} />
          </button>
        )}

        {open && q.length >= 2 && (
          <div className="absolute left-0 right-0 top-11 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" />Chargement...
              </div>
            ) : results.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Aucun équipement trouvé</p>
            ) : results.map(item => {
              const sc = STATUS_CFG[item.status || ""] || null;
              return (
                <button
                  key={item.id}
                  onClick={() => { setHistoryItem(item); setOpen(false); setQuery(""); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {item.category_label}{item.zone_name ? ` · ${item.zone_name}` : ""}
                    </p>
                  </div>
                  {sc && (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border shrink-0 ${sc.cls}`}>{sc.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Timeline complète : même composant que "Historique" partout
          ailleurs dans l'app, réutilisé ici comme destination du prompt ── */}
      <Dialog open={!!historyItem} onOpenChange={open => { if (!open) setHistoryItem(null); }}>
        <DialogContent className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto p-0 border-none bg-white dark:bg-slate-900 rounded-2xl shadow-2xl">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 sticky top-0 z-10">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <History size={16} /> Historique — {historyItem?.name}
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs mt-0.5">
                {historyItem?.category_label}{historyItem?.zone_name ? ` · ${historyItem.zone_name}` : ""}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="p-5">
            {historyItem && <MovementHistory equipmentId={historyItem.id} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
