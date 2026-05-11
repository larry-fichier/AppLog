import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import {
  Dialog, DialogContent,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MOVEMENT_TYPES = [
  { value: 'entree',      label: 'Entrée',      desc: 'Mise en service / réception',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'sortie',      label: 'Sortie',      desc: 'Déclassement / cession',         color: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'transfert',   label: 'Transfert',   desc: 'Changement de bureau',           color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'retour',      label: 'Retour',      desc: 'Réintégration au parc',          color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'ajustement',  label: 'Ajustement',  desc: 'Correction statut / inventaire', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'deploiement', label: 'Déploiement', desc: 'Envoi sur le terrain',           color: 'bg-orange-50 text-orange-700 border-orange-200' },
] as const;

type MovType = typeof MOVEMENT_TYPES[number]['value'];

const STATUS_OPTIONS = [
  { value: 'fonctionnel',   label: 'Fonctionnel' },
  { value: 'en_reparation', label: 'En réparation' },
  { value: 'hors_service',  label: 'Hors service' },
];

const NEEDS_DESTINATION: MovType[] = ['entree', 'transfert', 'retour', 'deploiement'];
const SHOW_SOURCE: MovType[]       = ['sortie', 'transfert', 'retour', 'deploiement'];
const NEEDS_DATES: MovType[]       = ['deploiement'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentId: string;
  equipmentName: string;
  currentZoneId?: string;
  currentStationId?: string;
  currentStatus?: string;
  zones: { id: string; label: string }[];
  stations: { id: string; label: string; zoneId: string }[];
  onSuccess?: () => void;
}

export function MovementDialog({
  open, onOpenChange, equipmentId, equipmentName,
  currentZoneId, currentStationId, currentStatus = 'fonctionnel',
  zones, stations, onSuccess,
}: Props) {
  const [loading, setLoading]                   = useState(false);
  const [type, setType]                         = useState<MovType>('transfert');
  const [toZoneId, setToZoneId]                 = useState('');
  const [toStationId, setToStationId]           = useState('');
  const [newStatus, setNewStatus]               = useState(currentStatus);
  const [note, setNote]                         = useState('');
  const [reference, setReference]               = useState('');
  const [dateDeploiement, setDateDeploiement]   = useState('');
  const [dateRetourPrevue, setDateRetourPrevue] = useState('');

  const filteredDest = stations.filter(s => {
    if (!toZoneId) return false;
    const stZoneId = (s as any).zoneId || (s as any).zone_id;
    if (stZoneId !== toZoneId) return false;
    if (type === 'transfert' && s.id === currentStationId) return false;
    return true;
  }).sort((a, b) => a.label.localeCompare(b.label));

  const currentZone    = zones.find(z => z.id === currentZoneId);
  const currentStation = stations.find(s => s.id === currentStationId);

  const needsDestination = NEEDS_DESTINATION.includes(type);
  const needsStatus      = type === 'ajustement';
  const showSourceInfo   = SHOW_SOURCE.includes(type);
  const needsDates       = NEEDS_DATES.includes(type);

  const TYPE_PREFIX: Record<MovType, string> = {
    transfert:   'TR',
    retour:      'RT',
    deploiement: 'DP',
    entree:      'EN',
    sortie:      'SO',
    ajustement:  'AJ',
  };

  function generateReference(
    mvType: MovType,
    fromStation?: { label: string },
    toSt?: { label: string }
  ): string {
    const prefix = TYPE_PREFIX[mvType] || 'MV';
    const now    = new Date();
    const mm     = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy   = now.getFullYear();
    const seq    = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
    const abbrev = (label?: string) =>
      (label || '').replace(/\s+/g, '').toUpperCase().substring(0, 8);
    const from = abbrev(fromStation?.label);
    const to   = abbrev(toSt?.label);
    if (from && to) return `${prefix}-${seq}-${mm}-${yyyy}-${from}-${to}`;
    if (from)       return `${prefix}-${seq}-${mm}-${yyyy}-${from}`;
    if (to)         return `${prefix}-${seq}-${mm}-${yyyy}-${to}`;
    return `${prefix}-${seq}-${mm}-${yyyy}`;
  }

  const handleTypeChange = (t: MovType) => {
    setType(t);
    setToZoneId('');
    setToStationId('');
    setDateDeploiement('');
    setDateRetourPrevue('');
    setReference(generateReference(t, currentStation, undefined));
  };

  // Auto-switch transfert <-> deploiement selon si la zone choisie
  // est identique ou différente de la zone actuelle de l'équipement.
  const handleToZoneChange = (zoneId: string) => {
    let effectiveType = type;
    if (type === 'transfert' || type === 'deploiement') {
      effectiveType = zoneId === currentZoneId ? 'transfert' : 'deploiement';
      setType(effectiveType);
    }
    setToZoneId(zoneId);
    setToStationId('');
    setDateDeploiement('');
    setDateRetourPrevue('');
    setReference(generateReference(effectiveType, currentStation, undefined));
  };

  const handleToStationChange = (stId: string) => {
    setToStationId(stId);
    const toSt = stations.find(s => s.id === stId);
    setReference(generateReference(type, currentStation, toSt));
  };

  useState(() => {
    setReference(generateReference('transfert', currentStation, undefined));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsDestination && !toZoneId) {
      toast.error('La zone de destination est obligatoire'); return;
    }
    if (needsStatus && !newStatus) {
      toast.error('Le nouveau statut est obligatoire'); return;
    }
    if (needsDates && !dateDeploiement) {
      toast.error('La date de déploiement est obligatoire'); return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/movements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('helios_token')}`,
        },
        body: JSON.stringify({
          equipment_id:       equipmentId,
          type,
          from_zone_id:       currentZoneId    || null,
          from_station_id:    currentStationId || null,
          to_zone_id:         needsDestination ? toZoneId    : null,
          to_station_id:      needsDestination ? toStationId : null,
          new_status:         needsStatus ? newStatus : null,
          date_deploiement:   needsDates ? dateDeploiement   || null : null,
          date_retour_prevue: needsDates ? dateRetourPrevue  || null : null,
          note:               note.trim()      || null,
          reference:          reference.trim() || null,
        }),
      });

      if (res.ok) {
        toast.success('Mouvement enregistré');
        onSuccess?.();
        onOpenChange(false);
      } else {
        const err = await res.json();
        throw new Error(err.error);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 border-none bg-white rounded-2xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 pb-5">
          <DialogTitle className="text-lg font-black text-white">
            Enregistrer un mouvement
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs mt-0.5">
            {equipmentName}
          </DialogDescription>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">

            {/* Type de mouvement */}
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Type de mouvement
              </Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MOVEMENT_TYPES.map(mt => (
                  <button key={mt.value} type="button"
                    onClick={() => handleTypeChange(mt.value)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      type === mt.value
                        ? `${mt.color} border-current`
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}>
                    <p className="text-xs font-black">{mt.label}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{mt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Hint auto-switch visible quand transfert ou deploiement actif */}
              {(type === 'transfert' || type === 'deploiement') && (
                <p className="text-[10px] text-slate-400 italic">
                  Bascule automatique — <strong>Transfert</strong> si même zone ·{' '}
                  <strong>Déploiement</strong> si zone différente
                </p>
              )}
            </div>

            {/* Source */}
            {showSourceInfo && (
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Depuis
                </p>
                <p className="text-sm font-medium text-slate-700">
                  {currentZone?.label ?? <span className="italic text-slate-400">Aucune zone</span>}
                  {currentStation && (
                    <span className="text-slate-400"> → {currentStation.label}</span>
                  )}
                </p>
              </div>
            )}

            {/* Destination */}
            {needsDestination && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {type === 'deploiement' ? 'Site de déploiement' : 'Vers'}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                  {/* Zone */}
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold text-slate-500">Zone *</Label>
                    <select
                      value={toZoneId}
                      onChange={e => handleToZoneChange(e.target.value)}
                      className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400 transition-all"
                    >
                      <option value="">Choisir une zone...</option>
                      {zones.sort((a, b) => a.label.localeCompare(b.label)).map(z => (
                        <option key={z.id} value={z.id}>{z.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Bureau filtré */}
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold text-slate-500">Bureau</Label>
                    <select
                      value={toStationId}
                      onChange={e => handleToStationChange(e.target.value)}
                      disabled={!toZoneId}
                      className={`w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400 transition-all ${
                        !toZoneId ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      <option value="">
                        {toZoneId ? 'Choisir un bureau...' : 'Sélectionnez une zone'}
                      </option>
                      {filteredDest.map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                </div>
              </div>
            )}

            {/* Dates — Déploiement uniquement */}
            {needsDates && (
              <div className="space-y-3 pt-1 border-t border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Période de déploiement
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold text-slate-500">
                      Date de sortie <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={dateDeploiement}
                      onChange={e => setDateDeploiement(e.target.value)}
                      className="h-10 border-slate-200 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold text-slate-500">Retour prévu</Label>
                    <Input
                      type="date"
                      value={dateRetourPrevue}
                      min={dateDeploiement || undefined}
                      onChange={e => setDateRetourPrevue(e.target.value)}
                      className="h-10 border-slate-200 text-sm"
                    />
                  </div>
                </div>
                {dateDeploiement && dateRetourPrevue && (
                  <p className="text-[10px] text-slate-500">
                    Durée prévue :{' '}
                    <strong>
                      {Math.ceil(
                        (new Date(dateRetourPrevue).getTime() - new Date(dateDeploiement).getTime())
                        / (1000 * 60 * 60 * 24)
                      )} jour(s)
                    </strong>
                  </p>
                )}
              </div>
            )}

            {/* Ajustement statut */}
            {needsStatus && (
              <div className="space-y-1.5">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  Nouveau statut *
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {STATUS_OPTIONS.map(s => (
                    <button key={s.value} type="button"
                      onClick={() => setNewStatus(s.value)}
                      className={`p-2.5 rounded-lg border-2 text-xs font-bold transition-all ${
                        newStatus === s.value
                          ? 'border-slate-900 bg-slate-100 text-slate-900'
                          : 'border-slate-200 text-slate-400'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">
                  Statut actuel : <strong>{currentStatus}</strong>
                </p>
              </div>
            )}

            {/* Référence */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500">
                Référence / N° document
              </Label>
              <Input
                placeholder="Ex: BS-2024-042, INV-001..."
                value={reference}
                onChange={e => setReference(e.target.value)}
                className="h-9 border-slate-200 text-sm"
              />
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500">Note</Label>
              <Textarea
                placeholder="Motif du mouvement, observations..."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                className="border-slate-200 text-sm resize-none"
              />
            </div>

          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}
              className="text-xs font-bold border-slate-200">
              Annuler
            </Button>
            <Button type="submit" disabled={loading}
              className="bg-slate-900 hover:bg-slate-800 text-white font-black px-7 text-xs">
              {loading
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <Save size={14} className="mr-2" />}
              Enregistrer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}