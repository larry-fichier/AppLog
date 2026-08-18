import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { buildReportHtml, openReportPrintWindow, tableRows, renderTable } from "@/lib/reportTemplate";
import { EquipmentDialog } from "./EquipmentDialog";
import { MovementHistory } from "./MovementHistory";
import {
  Car, FileText, FileDown, Wrench, Loader2, RefreshCw, CheckCircle2, XCircle, Clock, MapPin,
  ChevronLeft, ChevronRight, Plus, History, X, Award,
} from "lucide-react";

const VEHICLES_PAGE_SIZE = 10;

interface EquipmentRow {
  id: string;
  name: string;
  status: string;
  category_label: string;
  zone_name: string | null;
  station_name: string | null;
  details: Record<string, string>;
}

interface CategoryOption { id: string; label: string; }

interface ReformedVehicle {
  id: string;
  name: string;
  recipient: string | null;
  note: string | null;
  reformed_at: string | null;
  reformed_by_name: string;
}

// Cible d'ouverture du panneau Historique — un simple véhicule actif (EquipmentRow)
// ou une entrée réformée (position inconnue, pas de zone/station).
interface HistoryTarget {
  id: string;
  name: string;
  zone_name?: string | null;
  station_name?: string | null;
}

function isVehicleLabel(label: string): boolean {
  const l = (label || "").toLowerCase();
  return l.includes("véhicule") || l.includes("vehicule") || l.includes("rame") || l.includes("automobile");
}

const VEHICLE_STATUS_CFG: Record<string, { label: string; color: string; Icon: any }> = {
  fonctionnel:   { label: "Fonctionnel",   color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800", Icon: CheckCircle2 },
  en_reparation: { label: "En réparation", color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800", Icon: Clock },
  hors_service:  { label: "Hors service",  color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800", Icon: XCircle },
};

// Position par défaut d'un véhicule qui n'a jamais été rattaché à une zone/bureau
// (cas typique des imports en masse via RameImporter, qui n'assignent pas de zone).
const DEFAULT_POSITION = "PC-HELIOS";

function vehiclePosition(item: EquipmentRow): string {
  if (item.zone_name && item.station_name) return `${item.zone_name} — ${item.station_name}`;
  return item.zone_name || item.station_name || DEFAULT_POSITION;
}

// ── Tableau de bord Chef RAM : véhicules uniquement, toutes zones confondues ──
// Pas de sidebar, pas de stock, pas de déclarations — uniquement le parc véhicules.
export function ChefRamDashboard() {
  const [vehicles, setVehicles]   = useState<EquipmentRow[]>([]);
  const [deploymentDates, setDeploymentDates] = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState("vehicules");

  const [panneItem, setPanneItem]       = useState<EquipmentRow | null>(null);
  const [panneDescription, setPanneDescription] = useState("");
  const [panneLoading, setPanneLoading] = useState(false);
  const [historyItem, setHistoryItem]   = useState<HistoryTarget | null>(null);

  const [reformItem, setReformItem]         = useState<EquipmentRow | null>(null);
  const [reformRecipient, setReformRecipient] = useState("");
  const [reformNote, setReformNote]         = useState("");
  const [reformLoading, setReformLoading]   = useState(false);

  const [reformedVehicles, setReformedVehicles] = useState<ReformedVehicle[]>([]);
  const [reformedLoading, setReformedLoading]   = useState(false);

  const [vehicleCategories, setVehicleCategories] = useState<CategoryOption[]>([]);
  const [addVehicleOpen, setAddVehicleOpen]       = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await apiFetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        const options: CategoryOption[] = (data.categories || [])
          .filter((c: any) => isVehicleLabel(c.label))
          .map((c: any) => ({ id: c.id, label: c.label }));
        setVehicleCategories(options);
      }
    } catch (e) { console.error(e); }
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const [reportFrom, setReportFrom]             = useState(today);
  const [reportTo, setReportTo]                 = useState(today);
  const [selectedEquipIds, setSelectedEquipIds] = useState<Set<string>>(new Set());
  const [reportLoading, setReportLoading]       = useState(false);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const [eqRes, movRes] = await Promise.all([
        apiFetch("/api/equipment"),
        apiFetch("/api/movements"), // déjà filtré aux véhicules côté serveur pour chef_ram
      ]);
      if (eqRes.ok) setVehicles(await eqRes.json());
      if (movRes.ok) {
        const movements = await movRes.json();
        // Le plus récent mouvement "deploiement" par équipement (movements triés desc par date)
        const dates: Record<string, string> = {};
        for (const m of movements) {
          if (m.type === "deploiement" && !dates[m.equipment_id]) {
            dates[m.equipment_id] = m.date_deploiement || m.created_at;
          }
        }
        setDeploymentDates(dates);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchReformed = useCallback(async () => {
    setReformedLoading(true);
    try {
      const res = await apiFetch("/api/equipment/reformed");
      if (res.ok) setReformedVehicles(await res.json());
    } catch (e) { console.error(e); }
    finally { setReformedLoading(false); }
  }, []);

  useEffect(() => {
    fetchVehicles();
    fetchCategories();
    fetchReformed();
    const interval = setInterval(fetchVehicles, 60000);
    return () => clearInterval(interval);
  }, [fetchVehicles, fetchCategories, fetchReformed]);

  // Même dialog que celui utilisé partout ailleurs dans l'app pour ajouter un équipement
  // (EquipmentDialog), pré-sélectionné sur la catégorie véhicule — chef_ram ne voit jamais
  // le sélecteur de catégorie générique.
  function closeAddVehicleDialog(open: boolean) {
    setAddVehicleOpen(open);
    if (!open) fetchVehicles();
  }

  const enReparation = vehicles.filter(v => v.status === "en_reparation").length;
  const horsService  = vehicles.filter(v => v.status === "hors_service").length;

  const [vehiclesPage, setVehiclesPage] = useState(1);
  const vehiclesTotalPages = Math.max(1, Math.ceil(vehicles.length / VEHICLES_PAGE_SIZE));
  useEffect(() => {
    if (vehiclesPage > vehiclesTotalPages) setVehiclesPage(vehiclesTotalPages);
  }, [vehiclesTotalPages, vehiclesPage]);
  const paginatedVehicles = vehicles.slice(
    (vehiclesPage - 1) * VEHICLES_PAGE_SIZE,
    vehiclesPage * VEHICLES_PAGE_SIZE
  );

  async function handleDeclarePanne() {
    if (!panneItem) return;
    if (!panneDescription.trim()) { toast.error("Merci de décrire le dysfonctionnement"); return; }
    setPanneLoading(true);
    try {
      const res = await apiFetch(`/api/equipment/${panneItem.id}/panne`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: panneDescription.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(`Panne signalée pour "${panneItem.name}"`);
      setPanneItem(null);
      setPanneDescription("");
      fetchVehicles();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPanneLoading(false);
    }
  }

  async function handleReformer() {
    if (!reformItem) return;
    if (!reformRecipient.trim()) { toast.error("Le nom du destinataire est obligatoire"); return; }
    setReformLoading(true);
    try {
      const res = await apiFetch(`/api/equipment/${reformItem.id}/reformer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: reformRecipient.trim(), note: reformNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(`"${reformItem.name}" réformé — remis à ${reformRecipient.trim()}`);
      setReformItem(null);
      setReformRecipient("");
      setReformNote("");
      fetchVehicles();
      fetchReformed();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReformLoading(false);
    }
  }

  function toggleEquipSelection(id: string) {
    setSelectedEquipIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerateReport() {
    if (selectedEquipIds.size === 0) { toast.error("Sélectionnez au moins un véhicule"); return; }
    if (!reportFrom || !reportTo) { toast.error("Période invalide"); return; }
    setReportLoading(true);
    try {
      const params = new URLSearchParams({
        from: reportFrom,
        to: reportTo,
        equipment_ids: Array.from(selectedEquipIds).join(","),
      });
      const res = await apiFetch(`/api/reports/equipment?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }

      const sections = data.equipment.map((eq: any) => {
        const stateRows = tableRows([
          ["Statut", eq.status || "—"],
          ["Zone", eq.zone_name || "—"],
          ["Bureau", eq.station_name || "—"],
          ...Object.entries(eq.details || {}).map(([k, v]) => [k, String(v)]),
        ]);
        const movementsHtml = eq.movements.length > 0
          ? renderTable(["Date", "Type", "Détail", "Par"], tableRows(eq.movements.map((m: any) => [
              new Date(m.created_at).toLocaleString("fr-FR"),
              m.type,
              m.note || [m.previous_status, m.new_status].filter(Boolean).join(" → ") || "—",
              m.performed_by_name || "—",
            ])))
          : `<p style="font-size:9px;color:#64748b;margin-bottom:8px">Aucun mouvement sur la période.</p>`;

        return {
          title: `${eq.name} — ${eq.zone_name || "Zone inconnue"}`,
          html: `${renderTable(["État actuel", "Valeur"], stateRows)}${movementsHtml}`,
        };
      });

      const html = buildReportHtml({
        docTitle: "Rapport HELIOS — Parc véhicules",
        docSubtitle: `Période : ${data.from} au ${data.to} — ${data.equipment.length} véhicule(s)`,
        sections,
        signatureTitle: "Chef RAME HELIOS",
      });
      openReportPrintWindow(html);
      toast.success("Rapport PDF généré");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">Parc véhicules</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Toutes zones confondues</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={fetchVehicles}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />Actualiser
          </Button>
          <Button
            size="sm"
            className="h-9 text-xs font-bold bg-accent hover:bg-accent/90 text-white gap-1.5"
            disabled={vehicleCategories.length === 0}
            title={vehicleCategories.length === 0 ? "Aucune catégorie véhicule configurée" : undefined}
            onClick={() => setAddVehicleOpen(true)}
          >
            <Plus size={14} />Ajouter un véhicule
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-blue-50 text-blue-600 dark:bg-blue-950/40">
            <Car size={20} />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{vehicles.length}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Véhicule(s) au total</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${enReparation > 0 ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40" : "bg-slate-50 text-slate-400 dark:bg-slate-700"}`}>
            <Wrench size={20} />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{enReparation}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">En réparation</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${horsService > 0 ? "bg-red-50 text-red-600 dark:bg-red-950/40" : "bg-slate-50 text-slate-400 dark:bg-slate-700"}`}>
            <XCircle size={20} />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{horsService}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Hors service</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-lg h-12 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1">
          <TabsTrigger value="vehicules" className="font-bold gap-2"><Car size={16} />Véhicules</TabsTrigger>
          <TabsTrigger value="reformes" className="font-bold gap-2"><Award size={16} />Réformés</TabsTrigger>
          <TabsTrigger value="rapport" className="font-bold gap-2"><FileText size={16} />Rapport</TabsTrigger>
        </TabsList>

        <TabsContent value="vehicules" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {vehicles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-slate-300">
                <Car size={32} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucun véhicule</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      {["Véhicule", "Immatriculation", "Marque", "Statut", "Position", "Date de déploiement", ""].map(h => (
                        <th key={h} className="text-left text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-10 px-4 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedVehicles.map(item => {
                      const cfg = VEHICLE_STATUS_CFG[item.status] || { label: item.status || "Inconnu", color: "text-slate-500 bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600", Icon: Clock };
                      const alreadySignaled = item.status === "en_reparation";
                      const position = vehiclePosition(item);
                      const isDeployed = position !== DEFAULT_POSITION;
                      const deployDate = deploymentDates[item.id];
                      return (
                        <tr key={item.id} className="border-b border-zinc-100 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700/50">
                          <td className="px-4 py-2.5 font-black text-slate-800 dark:text-slate-200 text-xs whitespace-nowrap">{item.name}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.details?.immatriculation || "—"}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.details?.marque || "—"}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${cfg.color}`}>
                              <cfg.Icon size={11} />{cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                            <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
                              <MapPin size={12} className="text-orange-500 shrink-0" />{position}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {isDeployed ? (deployDate ? new Date(deployDate).toLocaleDateString("fr-FR") : "—") : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 gap-1.5"
                                onClick={() => setHistoryItem(item)}
                              >
                                <History size={12} />Historique
                              </Button>
                              {alreadySignaled ? (
                                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">Panne déjà signalée</span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px] font-bold border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30 gap-1.5"
                                  onClick={() => setPanneItem(item)}
                                >
                                  <Wrench size={12} />Signaler
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] font-bold border-purple-200 text-purple-600 hover:bg-purple-50 dark:border-purple-800 dark:hover:bg-purple-950/30 gap-1.5"
                                onClick={() => setReformItem(item)}
                              >
                                <Award size={12} />Réformer
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {vehicles.length > VEHICLES_PAGE_SIZE && (
              <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-bold">
                  Page {vehiclesPage} / {vehiclesTotalPages} — {vehicles.length} véhicule{vehicles.length > 1 ? "s" : ""}
                </span>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={vehiclesPage <= 1}
                    onClick={() => setVehiclesPage(p => Math.max(1, p - 1))}>
                    <ChevronLeft size={14} />
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={vehiclesPage >= vehiclesTotalPages}
                    onClick={() => setVehiclesPage(p => Math.min(vehiclesTotalPages, p + 1))}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reformes" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Véhicules sortis du parc actif, remis à d'anciens personnels — traçabilité conservée uniquement.
              </p>
            </div>
            {reformedLoading ? (
              <div className="flex justify-center py-14"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : reformedVehicles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-slate-300">
                <Award size={32} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucun véhicule réformé</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      {["Véhicule", "Remis à", "Réformé par", "Date", "Note", ""].map(h => (
                        <th key={h} className="text-left text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-10 px-4 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reformedVehicles.map(v => (
                        <tr key={v.id} className="border-b border-zinc-100 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700/50">
                          <td className="px-4 py-2.5 font-black text-slate-800 dark:text-slate-200 text-xs whitespace-nowrap">{v.name}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{v.recipient || "—"}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{v.reformed_by_name}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {v.reformed_at ? new Date(v.reformed_at).toLocaleDateString("fr-FR") : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 italic max-w-xs truncate">{v.note || "—"}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 gap-1.5"
                              onClick={() => setHistoryItem({ id: v.id, name: v.name })}
                            >
                              <History size={12} />Historique
                            </Button>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="rapport" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Du</Label>
                <Input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)}
                  className="h-9 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Au</Label>
                <Input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)}
                  className="h-9 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  Véhicules à inclure ({selectedEquipIds.size} sélectionné{selectedEquipIds.size > 1 ? "s" : ""})
                </Label>
                <div className="flex gap-2">
                  <button type="button" className="text-[11px] font-bold text-accent hover:underline"
                    onClick={() => setSelectedEquipIds(new Set(vehicles.map(v => v.id)))}>Tout sélectionner</button>
                  <button type="button" className="text-[11px] font-bold text-slate-400 hover:underline"
                    onClick={() => setSelectedEquipIds(new Set())}>Tout désélectionner</button>
                </div>
              </div>
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg max-h-72 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/50">
                {vehicles.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 text-center py-8">Aucun véhicule</p>
                ) : vehicles.map(item => (
                  <label key={item.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <input
                      type="checkbox"
                      checked={selectedEquipIds.has(item.id)}
                      onChange={() => toggleEquipSelection(item.id)}
                      className="w-4 h-4 accent-accent"
                    />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1">{item.name}</span>
                    <span className="text-[10px] text-slate-400 font-medium">{vehiclePosition(item)}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button
              className="bg-accent hover:bg-accent/90 text-white font-black gap-2"
              disabled={reportLoading || selectedEquipIds.size === 0}
              onClick={handleGenerateReport}
            >
              {reportLoading ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
              Générer le rapport PDF
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Dialog signalement de panne ── */}
      <Dialog open={!!panneItem} onOpenChange={open => { if (!open) { setPanneItem(null); setPanneDescription(""); } }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-red-700 to-red-600 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <Wrench size={18} /> Signaler une panne
              </DialogTitle>
              <DialogDescription className="text-red-200 text-xs mt-0.5 font-medium">
                {panneItem?.name} — {panneItem ? vehiclePosition(panneItem) : ""}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Le véhicule sera immédiatement passé au statut <strong>« En réparation »</strong> et l'événement sera tracé dans l'historique.
            </p>
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Description du dysfonctionnement <span className="text-red-400">*</span>
              </Label>
              <textarea
                placeholder="Ex : moteur cale au démarrage, freins qui grincent, fuite d'huile..."
                value={panneDescription}
                onChange={e => setPanneDescription(e.target.value)}
                rows={3}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => { setPanneItem(null); setPanneDescription(""); }} disabled={panneLoading}>
              Annuler
            </Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black" onClick={handleDeclarePanne} disabled={panneLoading}>
              {panneLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : <Wrench size={15} className="mr-2" />}
              Confirmer la panne
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog réforme d'un véhicule ── */}
      <Dialog open={!!reformItem} onOpenChange={open => { if (!open) { setReformItem(null); setReformRecipient(""); setReformNote(""); } }}>
        <DialogContent className="sm:max-w-[420px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-purple-700 to-purple-600 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <Award size={18} /> Réformer le véhicule
              </DialogTitle>
              <DialogDescription className="text-purple-200 text-xs mt-0.5 font-medium">
                {reformItem?.name} — {reformItem ? vehiclePosition(reformItem) : ""}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Le véhicule sortira définitivement du parc actif. Seule la traçabilité (historique des mouvements) sera conservée.
            </p>
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Remis à <span className="text-red-400">*</span>
              </Label>
              <Input
                placeholder="Nom de l'ancien personnel"
                value={reformRecipient}
                onChange={e => setReformRecipient(e.target.value)}
                className="h-10 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Note (optionnel)</Label>
              <textarea
                placeholder="Ex : décision n°..., date de départ à la retraite..."
                value={reformNote}
                onChange={e => setReformNote(e.target.value)}
                rows={2}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setReformItem(null)} disabled={reformLoading}>
              Annuler
            </Button>
            <Button className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-black" onClick={handleReformer} disabled={reformLoading}>
              {reformLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : <Award size={15} className="mr-2" />}
              Confirmer la réforme
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Historique d'un véhicule : tous les mouvements enregistrés,
          y compris transferts en attente / rejetés avec motif ── */}
      <Dialog open={!!historyItem} onOpenChange={open => { if (!open) setHistoryItem(null); }}>
        <DialogContent className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto p-0 border-none bg-white dark:bg-slate-900 rounded-2xl shadow-2xl">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 sticky top-0 z-10">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-black text-white">Historique — {historyItem?.name}</DialogTitle>
                <DialogDescription className="text-slate-400 text-xs mt-0.5">
                  {historyItem && (historyItem.zone_name || historyItem.station_name) ? vehiclePosition(historyItem as EquipmentRow) : ""}
                </DialogDescription>
              </div>
              <button onClick={() => setHistoryItem(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"><X size={18}/></button>
            </div>
          </div>
          <div className="p-5">
            {historyItem && <MovementHistory equipmentId={historyItem.id} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Ajout d'un véhicule : même formulaire que partout ailleurs dans l'app,
          pré-verrouillé sur la catégorie véhicule ── */}
      <EquipmentDialog
        open={addVehicleOpen}
        onOpenChange={closeAddVehicleDialog}
        activeRole="chef_ram"
        defaultCategoryId={vehicleCategories[0]?.id}
      />
    </div>
  );
}
