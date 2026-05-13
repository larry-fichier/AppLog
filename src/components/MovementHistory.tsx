import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  ArrowDown, ArrowUp, ArrowLeftRight,
  RotateCcw, SlidersHorizontal, Truck,
} from "lucide-react";

const TYPE_META = {
  entree:      { label: 'Entrée',      Icon: ArrowDown,         cls: 'bg-emerald-50 text-emerald-700' },
  sortie:      { label: 'Sortie',      Icon: ArrowUp,           cls: 'bg-red-50 text-red-700' },
  transfert:   { label: 'Transfert',   Icon: ArrowLeftRight,    cls: 'bg-blue-50 text-blue-700' },
  retour:      { label: 'Retour',      Icon: RotateCcw,         cls: 'bg-purple-50 text-purple-700' },
  ajustement:  { label: 'Ajustement',  Icon: SlidersHorizontal, cls: 'bg-amber-50 text-amber-700' },
  deploiement: { label: 'Déploiement', Icon: Truck,             cls: 'bg-orange-50 text-orange-700' },
} as const;

interface Movement {
  id: string;
  type: string;
  created_at: string;
  performed_by_name: string;
  from_zone_name?: string;
  from_station_name?: string;
  to_zone_name?: string;
  to_station_name?: string;
  previous_status?: string;
  new_status?: string;
  note?: string;
  reference?: string;
  // ✅ Nouvelles colonnes terrain
  date_deploiement?: string;
  date_retour_prevue?: string;
}

function formatDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function joursRestants(dateRetour?: string): number | null {
  if (!dateRetour) return null;
  const diff = new Date(dateRetour).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function MovementHistory({ equipmentId }: { equipmentId: string }) {
  const [rows, setRows]       = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/api/movements?equipment_id=${equipmentId}`)
      .then(r => r.ok ? r.json() : Promise.reject('Erreur serveur'))
      .then(data => { setRows(Array.isArray(data) ? data : []); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [equipmentId]);

  if (loading) return (
    <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
      <span className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
      Chargement de l'historique...
    </div>
  );

  if (error) return (
    <p className="text-xs text-red-500 py-4 italic">Erreur : {error}</p>
  );

  if (!rows.length) return (
    <p className="text-xs italic text-slate-400 py-4">Aucun mouvement enregistré.</p>
  );

  return (
    <ol className="relative border-l border-slate-200 ml-3 space-y-5 py-2">
      {rows.map(mv => {
        const meta  = TYPE_META[mv.type as keyof typeof TYPE_META];
        const Icon  = meta?.Icon;
        const jours = joursRestants(mv.date_retour_prevue);

        return (
          <li key={mv.id} className="ml-4">
            {/* Icône sur la timeline */}
            <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ${meta?.cls ?? 'bg-slate-100 text-slate-500'}`}>
              {Icon && <Icon size={12} />}
            </span>

            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0">

                {/* Badge type + référence */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${meta?.cls ?? 'bg-slate-100 text-slate-500'}`}>
                    {meta?.label ?? mv.type}
                  </span>
                  {mv.reference && (
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                      {mv.reference}
                    </span>
                  )}
                </div>

                {/* Trajet zone/station */}
                {(mv.from_zone_name || mv.to_zone_name) && (
                  <p className="text-xs text-slate-600">
                    {mv.from_zone_name && (
                      <span>{mv.from_zone_name}{mv.from_station_name && ` / ${mv.from_station_name}`}</span>
                    )}
                    {mv.from_zone_name && mv.to_zone_name && (
                      <span className="text-slate-400 mx-1">→</span>
                    )}
                    {mv.to_zone_name && (
                      <span>{mv.to_zone_name}{mv.to_station_name && ` / ${mv.to_station_name}`}</span>
                    )}
                  </p>
                )}

                {/* Changement de statut */}
                {mv.previous_status && mv.new_status && mv.previous_status !== mv.new_status && (
                  <p className="text-[11px] text-slate-400">
                    Statut : {mv.previous_status} → <strong className="text-slate-600">{mv.new_status}</strong>
                  </p>
                )}

                {/* ✅ Dates de déploiement terrain */}
                {mv.date_deploiement && (
                  <div className="flex items-center gap-3 mt-1 bg-orange-50 border border-orange-100 rounded-lg px-2.5 py-1.5">
                    <div>
                      <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Sortie terrain</p>
                      <p className="text-[11px] font-bold text-orange-700">{formatDate(mv.date_deploiement)}</p>
                    </div>
                    {mv.date_retour_prevue && (
                      <>
                        <span className="text-orange-300 text-xs">→</span>
                        <div>
                          <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Retour prévu</p>
                          <p className="text-[11px] font-bold text-orange-700">{formatDate(mv.date_retour_prevue)}</p>
                        </div>
                        {/* Badge jours restants */}
                        {jours !== null && (
                          <span className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-full ${
                            jours < 0  ? 'bg-red-100 text-red-700'    :
                            jours <= 3 ? 'bg-amber-100 text-amber-700' :
                                         'bg-slate-100 text-slate-600'
                          }`}>
                            {jours < 0
                              ? `${Math.abs(jours)}j de retard`
                              : jours === 0
                              ? "Retour aujourd'hui"
                              : `${jours}j restant${jours > 1 ? 's' : ''}`}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Note */}
                {mv.note && (
                  <p className="text-[11px] text-slate-400 italic">{mv.note}</p>
                )}
              </div>

              {/* Date + auteur */}
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-400">
                  {new Date(mv.created_at).toLocaleDateString('fr-FR', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </p>
                <p className="text-[10px] text-slate-500 font-medium">{mv.performed_by_name}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}