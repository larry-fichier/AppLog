import React, { useState, useEffect } from "react";
import {
  Plus, Search, Car, Utensils, Laptop, Zap,
  Loader2, Wrench, CheckCircle2, XCircle,
  FileText, Database, ShieldAlert,
  Archive, Box, Thermometer, Truck, MapPin,
  ArrowLeftRight, AlertTriangle, PackageMinus, Package
} from "lucide-react";
import { Equipment, GlobalSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EquipmentDialog } from "./EquipmentDialog";
import { MovementDialog } from "./MovementDialog";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

// ─── Icône dynamique selon le label ───────────────────────
function getCategoryIcon(label: string = "", size = 16) {
  const l = label.toLowerCase();
  if (l.includes("rame") || l.includes("véhicule") || l.includes("vehicule") || l.includes("automobile")) return <Car size={size} />;
  if (l.includes("cuisine") || l.includes("frigo") || l.includes("réfrigér")) return <Utensils size={size} />;
  if (l.includes("informatique") || l.includes("it") || l.includes("ordinateur") || l.includes("électronique") || l.includes("electronique")) return <Laptop size={size} />;
  if (l.includes("groupe") || l.includes("générateur") || l.includes("generateur") || l.includes("énergie")) return <Zap size={size} />;
  if (l.includes("clim") || l.includes("climatiseur")) return <Thermometer size={size} />;
  if (l.includes("transport") || l.includes("camion")) return <Truck size={size} />;
  return <Box size={size} />;
}

function isVehicleCategory(label: string = ""): boolean {
  const l = label.toLowerCase();
  return l.includes("rame") || l.includes("véhicule") || l.includes("vehicule") || l.includes("automobile");
}

const statusConfig: Record<string, { label: string; color: string; icon: JSX.Element }> = {
  fonctionnel:   { label: "Fonctionnel",   color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800", icon: <CheckCircle2 className="w-3 h-3 mr-1" /> },
  en_reparation: { label: "En réparation", color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800",           icon: <Wrench className="w-3 h-3 mr-1" /> },
  hors_service:  { label: "Hors service",  color: "text-red-600 bg-red-50 border-red-100 dark:bg-red-950 dark:border-red-900",                     icon: <XCircle className="w-3 h-3 mr-1" /> },
};

function getStatusConfig(status: string) {
  return statusConfig[status] || {
    label: status || "Inconnu",
    color: "text-zinc-500 bg-zinc-100 border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400",
    icon: <Box className="w-3 h-3 mr-1" />
  };
}

interface Props {
  defaultCategory?: string;
  activeRole?: "csph" | "chef_service_administratif" | "agent_logistique" | "admin";
  isBypass?: boolean;
}

export function EquipmentDashboard({
  defaultCategory = "all",
  activeRole = "agent_logistique",
  isBypass = false
}: Props) {
  const [equipment, setEquipment]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(defaultCategory);

  const [isEquipmentDialogOpen, setIsEquipmentDialogOpen] = useState(false);
  const [editingItem, setEditingItem]                     = useState<any | undefined>(undefined);
  const [isMovementDialogOpen, setIsMovementDialogOpen]   = useState(false);
  const [movementTarget, setMovementTarget]               = useState<any | null>(null);

  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [zones, setZones]           = useState<{ id: string; label: string }[]>([]);
  const [stations, setStations]     = useState<{ id: string; label: string; zoneId: string }[]>([]);

  const [statusFilter, setStatusFilter]     = useState<string>("all");
  const [currentPage, setCurrentPage]       = useState(1);
  const PAGE_SIZE = 10;

  const [stockSortieItem, setStockSortieItem]       = useState<any | null>(null);
  const [stockSortieQty, setStockSortieQty]         = useState("1");
  const [stockSortieZoneId, setStockSortieZoneId]   = useState("");
  const [stockSortieLoading, setStockSortieLoading] = useState(false);

  function isExploitationItem(item: any): boolean {
    return /exploitation|mat.riel.d/i.test(item.category_label || "");
  }

  async function handleStockSortie() {
    if (!stockSortieItem) return;
    const qty = parseInt(stockSortieQty, 10);
    if (isNaN(qty) || qty <= 0) { toast.error("Quantité invalide"); return; }
    if (!stockSortieZoneId) { toast.error("Veuillez sélectionner une zone / service de destination"); return; }
    setStockSortieLoading(true);
    const zoneName = zones.find(z => z.id === stockSortieZoneId)?.label || "";
    try {
      const res = await apiFetch(`/api/equipment/${stockSortieItem.id}/stock-sortie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantite: qty, zone_id: stockSortieZoneId, zone_name: zoneName }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(`Stock mis à jour : ${data.new_stock} ${data.unite} restant(s)`);
      if (data.alerte) {
        toast.warning(
          `⚠️ Alerte stock — "${stockSortieItem.name}" : ${data.new_stock} ${data.unite} (seuil : ${data.seuil_alerte})`,
          { duration: 8000 }
        );
      }
      setStockSortieItem(null);
      setStockSortieQty("1");
      setStockSortieZoneId("");
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setStockSortieLoading(false);
    }
  }

  const canSeeArmement = ["admin", "chef_service_administratif", "csph"].includes(activeRole);

  useEffect(() => {
    apiFetch("/api/config")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setCategories(data.categories?.map((c: any) => ({ id: c.id, label: c.label })) ?? []);
        setZones(data.zones?.map((z: any) => ({ id: z.id, label: z.name })) ?? []);
        setStations(data.stations?.map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })) ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => { setActiveCategory(defaultCategory); }, [defaultCategory]);

  useEffect(() => {
    if (!canSeeArmement) {
      const activeCat = categories.find(c => c.id === activeCategory);
      if (activeCat?.label.toLowerCase().includes("armement")) setActiveCategory("all");
    }
  }, [activeCategory, categories, canSeeArmement]);

  async function fetchData() {
    setLoading(true);
    try {
      const response = await apiFetch("/api/equipment");
      if (response.ok) setEquipment(await response.json());
    } catch (e) {
      console.error("Fetch error", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  const activeCategoryObj = categories.find(c => c.id === activeCategory);
  const isVehicle = activeCategoryObj ? isVehicleCategory(activeCategoryObj.label) : false;
  const categoriesVisibles = categories.filter(cat =>
    cat.label.toLowerCase().includes("armement") ? canSeeArmement : true
  );

  const filteredEquipment = equipment.filter(item => {
    if (!canSeeArmement && item.category_label?.toLowerCase().includes("armement")) return false;
    const matchesSearch =
      item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.zone_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.station_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category_label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      Object.values(item.details || {}).some((v: any) =>
        String(v).toLowerCase().includes(searchTerm.toLowerCase())
      );
    const matchesCategory = activeCategory === "all" || item.category_id === activeCategory;
    const matchesStatus   = statusFilter === "all" || item.status === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const scopedBase = activeCategory === "all" ? equipment : equipment.filter(e => e.category_id === activeCategory);
  const scoped = scopedBase.filter(e =>
    canSeeArmement ? true : !e.category_label?.toLowerCase().includes("armement")
  );
  const stats = {
    total:      scoped.length,
    functional: scoped.filter(e => e.status === "fonctionnel").length,
    repair:     scoped.filter(e => e.status === "en_reparation").length,
    offline:    scoped.filter(e => e.status === "hors_service").length,
  };

  const countByCategory = (catId: string) =>
    equipment.filter(e => {
      if (!canSeeArmement && e.category_label?.toLowerCase().includes("armement")) return false;
      return e.category_id === catId;
    }).length;

  const canEdit = ["agent_logistique", "admin"].includes(activeRole);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, activeCategory, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEquipment.length / PAGE_SIZE));
  const paginatedEquipment = filteredEquipment.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  function openEquipmentDialog(item?: any) {
    setEditingItem(item);
    setIsEquipmentDialogOpen(true);
  }

  function openMovementDialog(item: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setMovementTarget(item);
    setIsMovementDialogOpen(true);
  }

  function closeEquipmentDialog(open: boolean) {
    setIsEquipmentDialogOpen(open);
    if (!open) fetchData();
  }

  function closeMovementDialog(open: boolean) {
    setIsMovementDialogOpen(open);
    if (!open) { setMovementTarget(null); fetchData(); }
  }

  // ─── Détail dynamique par catégorie ──────────────────
  function renderDetailCell(item: any) {
    const d = item.details || {};
    const label = item.category_label || activeCategoryObj?.label || "";
    const l = label.toLowerCase();

    // ── L1 : Numéro identifiant principal ──────────────────
    const numRef =
      d.immatriculation     ? `🚗 ${d.immatriculation}`
      : d.numero_serie      ? `N° ${d.numero_serie}`
      : d.numero_inventaire ? `Inv. ${d.numero_inventaire}`
      : d.numero_chassis    ? `Châssis ${d.numero_chassis}`
      : null;

    // ── L2 : Désignation ou Marque · Modèle ────────────────
    const designLabel =
      d.designation
        ? d.designation
        : d.marque
          ? `${d.marque}${d.modele ? " · " + d.modele : ""}`
          : null;

    // ── L3 : Info spécifique à la catégorie ────────────────
    let specificInfo: string | null = null;
    if (isVehicleCategory(label)) {
      specificInfo = d.kilometrage ? `${Number(d.kilometrage).toLocaleString()} km` : null;
    } else if (l.includes("armement")) {
      specificInfo = d.calibre ? `Calibre : ${d.calibre}` : null;
    } else if (l.includes("groupe") || l.includes("générateur") || l.includes("generateur") || l.includes("electro")) {
      specificInfo = d.puissance ? `⚡ ${d.puissance}` : null;
    } else if (l.includes("cuisine") || l.includes("frigo") || l.includes("réfrigér")) {
      specificInfo = d.date_mise_utilisation
        ? `Service : ${new Date(d.date_mise_utilisation).toLocaleDateString("fr-FR")}`
        : d.date_entree ? `Entrée : ${new Date(d.date_entree).toLocaleDateString("fr-FR")}` : null;
    } else if (l.includes("clim") || l.includes("climatiseur")) {
      specificInfo = d.position ? `📍 ${d.position}` : null;
    } else if (l.includes("exploitation") || l.includes("mat") && l.includes("riel")) {
      const stock  = parseInt(d.quantite_stock || "0", 10);
      const seuil  = parseInt(d.seuil_alerte   || "0", 10);
      const low    = seuil > 0 && stock <= seuil;
      const empty  = stock === 0;
      specificInfo = `Stock : ${stock} ${d.unite || "unité(s)"}${low ? " ⚠️" : ""}`;
      return (
        <TableCell className="px-6 py-4">
          <div className="space-y-1">
            {d.type_consommable && (
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {d.type_consommable === "Autre" && d.type_consommable_autre ? d.type_consommable_autre : d.type_consommable}
              </p>
            )}
            {d.designation && (
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[180px]">{d.designation}</p>
            )}
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black border ${
              empty ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:border-red-800" :
              low   ? "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:border-amber-800" :
                      "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800"
            }`}>
              {empty || low ? <AlertTriangle size={10} /> : <Package size={10} />}
              {stock} {d.unite || "unité(s)"}
              {low && !empty && <span className="ml-1 opacity-70">/ seuil {seuil}</span>}
              {empty && <span className="ml-1">— épuisé</span>}
            </div>
          </div>
        </TableCell>
      );
    } else if (l.includes("informatique") || l.includes("it") || l.includes("ordinateur") || l.includes("electronique")) {
      specificInfo = d.date_mise_utilisation
        ? `Service : ${new Date(d.date_mise_utilisation).toLocaleDateString("fr-FR")}` : null;
    } else {
      const extra = Object.entries(d).find(([k, v]) =>
        v && !["designation","marque","modele","numero_serie","numero_inventaire",
                "immatriculation","numero_chassis","observation","dernieres_interventions",
                "date_entree","date_sortie","date_mise_utilisation"].includes(k)
      );
      specificInfo = extra ? `${extra[0].replace(/_/g, " ")} : ${String(extra[1]).substring(0, 30)}` : null;
    }

    return (
      <TableCell className="px-6 py-4">
        <div className="space-y-1">
          {/* L1 — Numéro identifiant */}
          {numRef
            ? <p className="text-[10px] font-mono font-black text-slate-600 dark:text-slate-300 tracking-wider bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded w-fit">{numRef}</p>
            : <p className="text-[10px] font-mono text-zinc-300 dark:text-zinc-600 italic">— sans référence —</p>
          }
          {/* L2 — Désignation / Marque · Modèle */}
          {designLabel && (
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[180px]">{designLabel}</p>
          )}
          {/* L3 — Info spécifique */}
          {specificInfo && (
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">{specificInfo}</p>
          )}
        </div>
      </TableCell>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold text-accent uppercase tracking-[2px]">
            <Database size={12} />
            <span>Inventaire G-Logistique</span>
          </div>
          <h2 className="text-xl font-extrabold text-text-dark">
            {activeCategory === "all"
              ? "Vue Globale du Parc"
              : `Gestion : ${activeCategoryObj?.label || activeCategory}`}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-border-custom bg-white dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 hover:bg-zinc-50 dark:hover:bg-slate-700"
        >
          <FileText className="mr-2 h-4 w-4" size={14} />
          Exporter Rapport
        </Button>
      </div>

      {/* ── Stats ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Unités totales",  val: stats.total,      color: "text-slate-900 dark:text-slate-100",   icon: <Database size={20} /> },
          { label: "Opérationnels",   val: stats.functional, color: "text-emerald-600",                     icon: <CheckCircle2 size={20} /> },
          { label: "En maintenance",  val: stats.repair,     color: "text-amber-600",                       icon: <Wrench size={20} /> },
          { label: "Hors service",    val: stats.offline,    color: "text-red-500",                         icon: <ShieldAlert size={20} /> },
        ].map((s, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-border-custom dark:border-slate-700 shadow-sm relative overflow-hidden group">
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-bold tracking-widest mb-1">{s.label}</div>
            <div className={`text-3xl font-black ${s.color}`}>{s.val}</div>
            <div className={`absolute right-3 bottom-3 opacity-5 group-hover:opacity-10 transition-opacity ${s.color}`}>
              {s.icon}
            </div>
          </div>
        ))}
      </section>

      {/* ── Grille principale ── */}
      <section className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">

        {/* ── Sidebar catégories ── */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-border-custom dark:border-slate-700 shadow-sm overflow-hidden">

            {/* Header catégories */}
            <div className="px-4 py-3 bg-zinc-50 dark:bg-slate-900 border-b border-border-custom dark:border-slate-700">
              <span className="text-[10px] font-black uppercase tracking-[2.5px] text-zinc-400 dark:text-slate-400">Catégories</span>
            </div>

            <div className="p-2 flex flex-col gap-1">
              {/* Vue Globale */}
              <button
                onClick={() => setActiveCategory("all")}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all border ${
                  activeCategory === "all"
                    ? "bg-slate-900 dark:bg-slate-600 text-white border-slate-900 dark:border-slate-500 shadow"
                    : "hover:bg-zinc-50 dark:hover:bg-slate-700 text-zinc-700 dark:text-slate-300 border-transparent"
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  <Archive size={15} />Vue Globale
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-black ${
                  activeCategory === "all"
                    ? "bg-white/10 text-white"
                    : "bg-zinc-100 dark:bg-slate-700 text-zinc-500 dark:text-slate-400"
                }`}>
                  {canSeeArmement ? equipment.length : equipment.filter(e => !e.category_label?.toLowerCase().includes("armement")).length}
                </span>
              </button>

              {/* Catégories dynamiques */}
              {categoriesVisibles.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all border ${
                    activeCategory === cat.id
                      ? "bg-brand-orange text-white border-brand-orange shadow"
                      : "hover:bg-zinc-50 dark:hover:bg-slate-700 text-zinc-700 dark:text-slate-300 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold">
                    {getCategoryIcon(cat.label, 15)}
                    {cat.label}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-black ${
                    activeCategory === cat.id
                      ? "bg-white/20 text-white"
                      : "bg-zinc-100 dark:bg-slate-700 text-zinc-500 dark:text-slate-400"
                  }`}>
                    {countByCategory(cat.id)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-border-custom dark:border-slate-700 shadow-sm space-y-3">
            <div>
              <h4 className="font-black text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">Actions</h4>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">Gérez les actifs et leurs mouvements.</p>
            </div>
            {canEdit ? (
              <div className="flex flex-col gap-2">
                <Button
                  className="w-full bg-slate-900 dark:bg-slate-700 hover:bg-brand-orange text-white font-black h-11 transition-all"
                  onClick={() => openEquipmentDialog(undefined)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  DÉCLARER UN ACTIF
                </Button>
                <Button
                  variant="outline"
                  className={`w-full h-10 font-black text-xs uppercase tracking-wider border-orange-200 dark:border-orange-900 transition-all overflow-hidden ${
                    movementTarget
                      ? "text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 hover:border-orange-400"
                      : "text-zinc-300 dark:text-zinc-600 border-zinc-100 dark:border-zinc-700 cursor-not-allowed"
                  }`}
                  disabled={!movementTarget}
                  onClick={() => movementTarget && openMovementDialog(movementTarget)}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 mr-2 shrink-0" />
                  <span className="truncate">
                    {movementTarget ? `Mouvement — ${movementTarget.name}` : "Sélectionnez un équipement"}
                  </span>
                </Button>
              </div>
            ) : (
              <div className="text-[9px] font-black bg-zinc-50 dark:bg-slate-900 p-3 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 text-center uppercase tracking-wider text-zinc-300 dark:text-zinc-600">
                Lecture seule
              </div>
            )}
          </div>
        </div>

        {/* ── Tableau ── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-border-custom dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">

          {/* En-tête tableau : titre + filtres + recherche */}
          <div className="px-5 py-4 bg-zinc-50 dark:bg-slate-900 border-b border-border-custom dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2 shrink-0">
              <div className="h-5 w-0.5 bg-accent" />
              Registre d'Inventaire
              <span className="text-[10px] font-black bg-zinc-100 dark:bg-slate-700 text-zinc-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                {filteredEquipment.length} résultats
              </span>
            </h3>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Filtre statut */}
              <div className="flex items-center bg-white dark:bg-slate-800 border border-border-custom dark:border-slate-600 rounded-lg p-1 gap-0.5">
                {[
                  { val: "all",           label: "Tous",           active: "bg-slate-800 dark:bg-slate-600 text-white" },
                  { val: "fonctionnel",   label: "✓ Opérationnel", active: "bg-emerald-500 text-white" },
                  { val: "en_reparation", label: "⚙ Maintenance",  active: "bg-amber-500 text-white" },
                  { val: "hors_service",  label: "✕ Hors service", active: "bg-red-500 text-white" },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setStatusFilter(opt.val)}
                    className={`px-3 h-7 text-[10px] font-black uppercase tracking-wider rounded-md transition-all ${
                      statusFilter === opt.val
                        ? opt.active
                        : "text-zinc-400 dark:text-slate-500 hover:text-zinc-700 dark:hover:text-slate-300 hover:bg-zinc-50 dark:hover:bg-slate-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Recherche */}
              <div className="relative w-60">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-300 dark:text-slate-500" />
                <input
                  placeholder="Chercher nom, marque, zone..."
                  className="w-full pl-10 pr-4 h-10 text-sm bg-white dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 border border-border-custom dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-accent/20 focus:border-accent dark:focus:border-accent transition-all"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-[400px]">
            <Table>
              <TableHeader className="bg-zinc-50 dark:bg-slate-900 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent border-b border-border-custom dark:border-slate-700">
                  {["Ressource", "Désignation", isVehicle ? "Immat. / Marque / KM" : "Détails", "Zone / Station", "État", "Actions"].map((h, i) => (
                    <TableHead key={i} className={`text-[10px] font-black text-zinc-400 dark:text-slate-500 uppercase tracking-widest h-11 px-6 ${i === 5 ? "text-right" : ""}`}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-10 h-10 animate-spin text-accent" />
                        <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-300 dark:text-slate-600">Chargement...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredEquipment.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-30">
                        <Archive size={48} strokeWidth={1} />
                        <p className="text-sm font-bold uppercase tracking-widest">Aucune donnée</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedEquipment.map(item => {
                    const sc         = getStatusConfig(item.status);
                    const catLabel   = item.category_label || "";
                    const isSelected = movementTarget?.id === item.id;

                    return (
                      <TableRow
                        key={item.id}
                        className={`group border-b border-zinc-100 dark:border-slate-700 transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-orange-50 dark:bg-orange-950/30 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                            : "hover:bg-zinc-50 dark:hover:bg-slate-700/50"
                        }`}
                        onClick={() => openEquipmentDialog(item)}
                      >
                        {/* Ressource */}
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center border shrink-0 transition-transform group-hover:scale-110 ${
                              item.status === "fonctionnel"   ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border-emerald-100 dark:border-emerald-800" :
                              item.status === "en_reparation" ? "bg-amber-50 dark:bg-amber-950 text-amber-600 border-amber-100 dark:border-amber-800" :
                              "bg-red-50 dark:bg-red-950 text-red-500 border-red-100 dark:border-red-900"
                            }`}>
                              {getCategoryIcon(catLabel, 16)}
                            </div>
                            <div>
                              <p className="font-black text-slate-900 dark:text-slate-100 text-sm uppercase tracking-tight">{item.name}</p>
                              <p className="text-[10px] text-zinc-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                                {catLabel} · <span className="font-mono">{item.id?.substring(0, 8).toUpperCase()}</span>
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        {/* Désignation */}
                        <TableCell className="px-6 py-4">
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                              {item.details?.designation
                                || (item.details?.marque
                                    ? `${item.details.marque}${item.details?.modele ? " · " + item.details.modele : ""}`
                                    : item.category_label || "—")}
                            </p>
                            {(item.details?.numero_chassis || item.details?.immatriculation ||
                              item.details?.numero_inventaire || item.details?.numero_serie) && (
                              <p className="text-[10px] text-zinc-400 dark:text-slate-500 font-mono font-bold tracking-wider">
                                {item.details?.immatriculation
                                  ? `🚗 ${item.details.immatriculation}`
                                  : item.details?.numero_chassis
                                  ? `Châssis: ${item.details.numero_chassis}`
                                  : item.details?.numero_inventaire
                                  ? `N°Inv: ${item.details.numero_inventaire}`
                                  : `N°: ${item.details.numero_serie}`}
                              </p>
                            )}
                            {item.details?.date_deploiement && (
                              <p className="text-[10px] text-accent font-bold">
                                Déployé : {new Date(item.details.date_deploiement).toLocaleDateString("fr-FR")}
                              </p>
                            )}
                          </div>
                        </TableCell>

                        {/* Détail dynamique */}
                        {renderDetailCell(item)}

                        {/* Zone / Station */}
                        <TableCell className="px-6 py-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-xs font-bold text-slate-800 dark:text-slate-200">
                              <MapPin size={11} className="text-slate-400 dark:text-slate-500" />
                              {item.zone_name || "—"}
                            </div>
                            {item.station_name && (
                              <div className="text-[10px] text-slate-600 dark:text-slate-400 font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded w-fit">
                                {item.station_name}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Statut — masqué pour exploitation */}
                        <TableCell className="px-6 py-4">
                          {!isExploitationItem(item) && (
                            <div className={`inline-flex items-center px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider border ${sc.color}`}>
                              {sc.icon}{sc.label}
                            </div>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canEdit && (
                              isExploitationItem(item) ? (
                                <Button
                                  variant="outline" size="sm"
                                  className="h-8 px-3 text-[10px] font-black tracking-wider uppercase border-red-200 dark:border-red-900 text-red-500 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setStockSortieItem(item);
                                    setStockSortieQty("1");
                                  }}
                                >
                                  <PackageMinus size={11} className="mr-1" />
                                  Sortie stock
                                </Button>
                              ) : (
                                <Button
                                  variant="outline" size="sm"
                                  className={`h-8 px-3 text-[10px] font-black tracking-wider uppercase transition-all ${
                                    isSelected
                                      ? "bg-orange-500 text-white border-orange-500 hover:bg-orange-600"
                                      : "border-orange-200 dark:border-orange-900 text-orange-500 hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                                  }`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (isSelected) setMovementTarget(null);
                                    else setMovementTarget(item);
                                  }}
                                >
                                  <ArrowLeftRight size={11} className="mr-1" />
                                  {isSelected ? "Sélectionné" : "Mouvement"}
                                </Button>
                              )
                            )}
                            <Button
                              variant="outline" size="sm"
                              className="h-8 px-4 text-[10px] font-black tracking-wider uppercase border-accent/30 text-accent hover:border-accent hover:bg-accent/5 dark:hover:bg-accent/10"
                              onClick={e => { e.stopPropagation(); openEquipmentDialog(item); }}
                            >
                              {canEdit ? "Modifier" : "Détails"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-border-custom dark:border-slate-700 bg-zinc-50 dark:bg-slate-900 flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-400 dark:text-slate-500 uppercase tracking-wider">
                Page {currentPage} / {totalPages} — {filteredEquipment.length} résultats
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-8 px-3 text-xs font-black rounded-lg border border-border-custom dark:border-slate-600 bg-white dark:bg-slate-800 text-zinc-500 dark:text-slate-400 hover:bg-zinc-50 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  ← Préc.
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "..." ? (
                      <span key={`dots-${i}`} className="px-1 text-zinc-300 dark:text-slate-600 text-xs font-bold">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`h-8 w-8 text-xs font-black rounded-lg border transition-all ${
                          currentPage === p
                            ? "bg-accent text-white border-accent"
                            : "border-border-custom dark:border-slate-600 bg-white dark:bg-slate-800 text-zinc-500 dark:text-slate-400 hover:bg-zinc-50 dark:hover:bg-slate-700"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 px-3 text-xs font-black rounded-lg border border-border-custom dark:border-slate-600 bg-white dark:bg-slate-800 text-zinc-500 dark:text-slate-400 hover:bg-zinc-50 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Suiv. →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Dialogs ── */}
      <EquipmentDialog
        open={isEquipmentDialogOpen}
        onOpenChange={closeEquipmentDialog}
        item={editingItem}
        activeRole={activeRole}
        isBypass={isBypass}
        defaultCategoryId={editingItem ? undefined : (activeCategory !== "all" ? activeCategory : undefined)}
      />

      {movementTarget && (
        <MovementDialog
          open={isMovementDialogOpen}
          onOpenChange={closeMovementDialog}
          equipmentId={movementTarget.id}
          equipmentName={movementTarget.name}
          currentZoneId={movementTarget.zone_id}
          currentStationId={movementTarget.station_id}
          currentStatus={movementTarget.status}
          zones={zones}
          stations={stations}
          onSuccess={fetchData}
        />
      )}

      {/* ── Dialog sortie de stock ── */}
      <Dialog open={!!stockSortieItem} onOpenChange={open => { if (!open) { setStockSortieItem(null); setStockSortieZoneId(""); setStockSortieQty("1"); } }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-red-700 to-red-600 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <PackageMinus size={18} /> Sortie de stock
              </DialogTitle>
              <DialogDescription className="text-red-200 text-xs mt-0.5 font-medium">
                {stockSortieItem?.name}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* Stock actuel */}
            {stockSortieItem && (() => {
              const d = stockSortieItem.details || {};
              const stock = parseInt(d.quantite_stock || "0", 10);
              const seuil = parseInt(d.seuil_alerte   || "0", 10);
              const low   = seuil > 0 && stock <= seuil;
              return (
                <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                  low ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800"
                      : "bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700"
                }`}>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Stock actuel</span>
                  <span className={`text-lg font-black flex items-center gap-1.5 ${low ? "text-amber-600" : "text-slate-800 dark:text-slate-200"}`}>
                    {low && <AlertTriangle size={16} />}
                    {stock} <span className="text-sm font-bold">{d.unite || "unité(s)"}</span>
                  </span>
                </div>
              );
            })()}

            {/* Zone / Service de destination */}
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Zone / Service de destination <span className="text-red-400">*</span>
              </Label>
              <Select value={stockSortieZoneId} onValueChange={v => setStockSortieZoneId(v ?? "")}>
                <SelectTrigger className="h-10 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  <SelectValue placeholder="Sélectionner une zone..." />
                </SelectTrigger>
                <SelectContent>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantité à retirer */}
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Quantité à retirer <span className="text-red-400">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                value={stockSortieQty}
                onChange={e => setStockSortieQty(e.target.value)}
                className="h-11 text-lg font-black text-center border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                onKeyDown={e => { if (e.key === "Enter") handleStockSortie(); }}
              />
            </div>
          </div>

          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button
              variant="outline"
              className="flex-1 dark:border-slate-600 dark:text-slate-300"
              onClick={() => setStockSortieItem(null)}
              disabled={stockSortieLoading}
            >
              Annuler
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black"
              onClick={handleStockSortie}
              disabled={stockSortieLoading}
            >
              {stockSortieLoading
                ? <Loader2 size={15} className="animate-spin mr-2" />
                : <PackageMinus size={15} className="mr-2" />}
              Confirmer la sortie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}