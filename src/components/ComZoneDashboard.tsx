import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { buildReportHtml, openReportPrintWindow, tableRows, renderTable } from "@/lib/reportTemplate";
import {
  Boxes, ClipboardList, Truck, AlertTriangle, Loader2, ClipboardCheck,
  PackageCheck, RefreshCw, Clock, CheckCircle2, XCircle, Car, Wrench,
  FileText, FileDown, ChevronLeft, ChevronRight,
} from "lucide-react";

const STOCK_PAGE_SIZE = 10;

interface EquipmentRow {
  id: string;
  name: string;
  status: string;
  category_label: string;
  station_id?: string | null;
  details: Record<string, string>;
}

interface StockDeclaration {
  id: string;
  equipment_id: string;
  equipment_name: string;
  previous_quantity: number;
  declared_quantity: number;
  unite: string | null;
  status: "pending" | "approved" | "rejected";
  decision_note: string | null;
  created_at: string;
}

interface ResupplyRequest {
  id: string;
  equipment_id: string;
  equipment_name: string;
  quantity_at_trigger: number;
  seuil_alerte: number;
  unite: string | null;
  status: "open" | "fulfilled" | "confirmed";
  fulfilled_quantity: number | null;
  created_at: string;
}

// Article du catalogue central "Matériel d'exploitation" (chef_bureau, sans zone) —
// sert de référence pour que chaque zone déclare son propre stock du même article.
interface CatalogItem {
  id: string;
  name: string;
  category_id: string;
  unite: string | null;
  type_consommable: string | null;
  seuil_alerte: string | null;
}

// Ligne affichée dans l'onglet Stock : soit un article déjà instancié dans la zone
// (zoneEquipmentId renseigné), soit un article du catalogue pas encore déclaré ici.
interface StockRow {
  key: string;
  catalogId: string | null;
  zoneEquipmentId: string | null;
  name: string;
  unite: string;
  stock: number;
  seuil: number;
}

// L'onglet "Stock" représente l'agrégat de la ZONE, pas le détail par bureau —
// une instance déjà distribuée à un bureau (station_id renseigné, voir
// stock-sortie-station) ne doit pas se substituer à l'instance de zone dans
// cette vue, même si elle porte le même nom.
function isStockItem(item: EquipmentRow): boolean {
  return /exploitation|mat.riel.d/i.test(item.category_label || "") && !item.station_id;
}

function isVehicleItem(item: EquipmentRow): boolean {
  const l = (item.category_label || "").toLowerCase();
  return l.includes("véhicule") || l.includes("vehicule") || l.includes("rame") || l.includes("automobile");
}

const DECL_STATUS_CFG: Record<string, { label: string; color: string; Icon: any }> = {
  pending:  { label: "En attente d'approbation", color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800", Icon: Clock },
  approved: { label: "Approuvée",                  color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800", Icon: CheckCircle2 },
  rejected: { label: "Rejetée",                    color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800", Icon: XCircle },
};

const VEHICLE_STATUS_CFG: Record<string, { label: string; color: string }> = {
  fonctionnel:   { label: "Fonctionnel",   color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800" },
  en_reparation: { label: "En réparation", color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" },
  hors_service:  { label: "Hors service",  color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800" },
};

export function ComZoneDashboard() {
  const [equipment, setEquipment]         = useState<EquipmentRow[]>([]);
  const [declarations, setDeclarations]   = useState<StockDeclaration[]>([]);
  const [requests, setRequests]           = useState<ResupplyRequest[]>([]);
  const [catalog, setCatalog]             = useState<CatalogItem[]>([]);
  const [loading, setLoading]             = useState(true);
  // Atterrissage direct sur le stock après connexion (pas d'onglet "overview").
  const [activeTab, setActiveTab]         = useState("stock");

  const [declareItem, setDeclareItem]     = useState<StockRow | null>(null);
  const [declareQty, setDeclareQty]       = useState("0");
  const [declareNote, setDeclareNote]     = useState("");
  const [declareLoading, setDeclareLoading] = useState(false);

  // Ravitaillement d'un bureau de sa propre zone à partir du stock déjà déclaré.
  const [stations, setStations]                 = useState<{ id: string; name: string }[]>([]);
  const [distributeItem, setDistributeItem]       = useState<StockRow | null>(null);
  const [distributeStationId, setDistributeStationId] = useState("");
  const [distributeQty, setDistributeQty]         = useState("0");
  const [distributeNote, setDistributeNote]       = useState("");
  const [distributeLoading, setDistributeLoading] = useState(false);

  const [confirmRequest, setConfirmRequest]   = useState<ResupplyRequest | null>(null);
  const [confirmQty, setConfirmQty]           = useState("0");
  const [confirmNote, setConfirmNote]         = useState("");
  const [confirmLoading, setConfirmLoading]   = useState(false);

  const [panneItem, setPanneItem]         = useState<EquipmentRow | null>(null);
  const [panneDescription, setPanneDescription] = useState("");
  const [panneLoading, setPanneLoading]   = useState(false);

  const [repareItem, setRepareItem]       = useState<EquipmentRow | null>(null);
  const [repareNote, setRepareNote]       = useState("");
  const [repareLoading, setRepareLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [reportFrom, setReportFrom]           = useState(today);
  const [reportTo, setReportTo]               = useState(today);
  const [selectedEquipIds, setSelectedEquipIds] = useState<Set<string>>(new Set());
  const [reportLoading, setReportLoading]     = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [eqRes, declRes, reqRes, catRes, meRes, cfgRes] = await Promise.all([
        apiFetch("/api/equipment"),
        apiFetch("/api/stock-declarations?status=all"),
        apiFetch("/api/resupply-requests?status=all"),
        apiFetch("/api/exploitation-catalog"),
        apiFetch("/api/auth/me"),
        apiFetch("/api/config"),
      ]);
      if (eqRes.ok) setEquipment(await eqRes.json());
      if (declRes.ok) setDeclarations(await declRes.json());
      if (reqRes.ok) setRequests(await reqRes.json());
      if (catRes.ok) setCatalog(await catRes.json());
      if (meRes.ok && cfgRes.ok) {
        const me = await meRes.json();
        const cfg = await cfgRes.json();
        const myZoneId = me.user?.zoneId;
        setStations(
          (cfg.stations || [])
            .filter((s: any) => s.zone_id === myZoneId)
            .map((s: any) => ({ id: s.id, name: s.name }))
        );
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const stockItems = equipment.filter(isStockItem);
  const vehicleItems = equipment.filter(isVehicleItem);

  // Fusionne le catalogue chef_bureau (référence des articles) avec les instances déjà
  // déclarées dans cette zone — un article du catalogue pas encore déclaré apparaît quand
  // même, à 0, pour que le com_zone puisse le saisir.
  const stockRows: StockRow[] = useMemo(() => {
    const fromCatalog = catalog.map((c): StockRow => {
      const zi = stockItems.find(s => s.name.toLowerCase() === c.name.toLowerCase());
      return {
        key: c.id,
        catalogId: c.id,
        zoneEquipmentId: zi?.id || null,
        name: c.name,
        unite: zi?.details?.unite || c.unite || "unité(s)",
        stock: parseInt(zi?.details?.quantite_stock || "0", 10),
        seuil: parseInt(zi?.details?.seuil_alerte || c.seuil_alerte || "0", 10),
      };
    });
    const matchedZoneIds = new Set(fromCatalog.map(r => r.zoneEquipmentId).filter(Boolean));
    const extra = stockItems.filter(s => !matchedZoneIds.has(s.id)).map((s): StockRow => ({
      key: s.id,
      catalogId: null,
      zoneEquipmentId: s.id,
      name: s.name,
      unite: s.details?.unite || "unité(s)",
      stock: parseInt(s.details?.quantite_stock || "0", 10),
      seuil: parseInt(s.details?.seuil_alerte || "0", 10),
    }));
    return [...fromCatalog, ...extra];
  }, [catalog, stockItems]);

  const lowStockItems = stockRows.filter(r => r.seuil > 0 && r.stock <= r.seuil);
  const pendingDeclarations = declarations.filter(d => d.status === "pending");
  const openRequests = requests.filter(r => r.status === "open" || r.status === "fulfilled");
  const toConfirmRequests = requests.filter(r => r.status === "fulfilled");

  const [stockPage, setStockPage] = useState(1);
  const stockTotalPages = Math.max(1, Math.ceil(stockRows.length / STOCK_PAGE_SIZE));
  useEffect(() => {
    if (stockPage > stockTotalPages) setStockPage(stockTotalPages);
  }, [stockTotalPages, stockPage]);
  const paginatedStockRows = stockRows.slice(
    (stockPage - 1) * STOCK_PAGE_SIZE,
    stockPage * STOCK_PAGE_SIZE
  );

  function openDeclareDialog(row: StockRow) {
    setDeclareItem(row);
    setDeclareQty(String(row.stock));
    setDeclareNote("");
  }

  async function handleDeclare() {
    if (!declareItem) return;
    const qty = parseInt(declareQty, 10);
    if (isNaN(qty) || qty < 0) { toast.error("Quantité invalide"); return; }
    setDeclareLoading(true);
    try {
      // Article déjà instancié dans la zone → endpoint classique. Sinon, article du
      // catalogue jamais déclaré ici → l'endpoint catalogue crée l'instance de zone.
      const url = declareItem.zoneEquipmentId
        ? `/api/equipment/${declareItem.zoneEquipmentId}/declare-stock`
        : `/api/exploitation-catalog/${declareItem.catalogId}/declare-stock`;
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantite: qty, note: declareNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      if (data.applied) {
        toast.success("Déclaration confirmée — aucun écart, appliquée directement");
      } else {
        toast.warning("Écart détecté — déclaration envoyée pour approbation (chef de bureau / CSA)");
      }
      setDeclareItem(null);
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeclareLoading(false);
    }
  }

  function openDistributeDialog(row: StockRow) {
    setDistributeItem(row);
    setDistributeStationId("");
    setDistributeQty("0");
    setDistributeNote("");
  }

  async function handleDistribute() {
    if (!distributeItem || !distributeItem.zoneEquipmentId) return;
    const qty = parseInt(distributeQty, 10);
    if (isNaN(qty) || qty <= 0) { toast.error("Quantité invalide"); return; }
    if (!distributeStationId) { toast.error("Bureau de destination obligatoire"); return; }
    setDistributeLoading(true);
    try {
      const res = await apiFetch(`/api/equipment/${distributeItem.zoneEquipmentId}/stock-sortie-station`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantite: qty, station_id: distributeStationId, note: distributeNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(`${qty} ${distributeItem.unite} envoyé(s) — nouveau stock de zone : ${data.new_stock}`);
      if (data.alerte) {
        toast.warning("Seuil critique atteint — chef de bureau / CSA alertés");
      }
      setDistributeItem(null);
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDistributeLoading(false);
    }
  }

  function openConfirmDialog(req: ResupplyRequest) {
    setConfirmRequest(req);
    setConfirmQty(String(req.fulfilled_quantity ?? ""));
    setConfirmNote("");
  }

  async function handleConfirmReception() {
    if (!confirmRequest) return;
    const qty = parseInt(confirmQty, 10);
    if (isNaN(qty) || qty < 0) { toast.error("Quantité invalide"); return; }
    setConfirmLoading(true);
    try {
      const res = await apiFetch(`/api/resupply-requests/${confirmRequest.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantite_recue: qty, note: confirmNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(`Réception confirmée — nouveau stock : ${data.new_stock}`);
      setConfirmRequest(null);
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setConfirmLoading(false);
    }
  }

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
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPanneLoading(false);
    }
  }

  async function handleDeclareRepare() {
    if (!repareItem) return;
    setRepareLoading(true);
    try {
      const res = await apiFetch(`/api/equipment/${repareItem.id}/repare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: repareNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(`Réparation signalée pour "${repareItem.name}"`);
      setRepareItem(null);
      setRepareNote("");
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRepareLoading(false);
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
    if (selectedEquipIds.size === 0) { toast.error("Sélectionnez au moins un équipement"); return; }
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
          title: `${eq.name} — ${eq.category_label || ""}`,
          html: `${renderTable(["État actuel", "Valeur"], stateRows)}${movementsHtml}`,
        };
      });

      const zoneName = data.equipment[0]?.zone_name || "—";
      const html = buildReportHtml({
        docTitle: `Rapport Zone HELIOS ${zoneName}`,
        docSubtitle: `Période : ${data.from} au ${data.to} — ${data.equipment.length} équipement(s)`,
        sections,
        signatureTitle: `ComZone HELIOS ${zoneName}`,
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
          <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">Ma zone</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Stock, déclarations et ravitaillements</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={fetchAll}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />Actualiser
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${lowStockItems.length > 0 ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40" : "bg-slate-50 text-slate-400 dark:bg-slate-700"}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{lowStockItems.length}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Item(s) sous le seuil</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-blue-50 text-blue-600 dark:bg-blue-950/40">
            <ClipboardList size={20} />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{pendingDeclarations.length}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Déclaration(s) en attente</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-orange-50 text-orange-600 dark:bg-orange-950/40">
            <Truck size={20} />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{openRequests.length}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Ravitaillement(s) en cours</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-5 w-full max-w-3xl h-12 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1">
          <TabsTrigger value="stock" className="font-bold gap-2"><Boxes size={16} />Stock</TabsTrigger>
          <TabsTrigger value="vehicules" className="font-bold gap-2"><Car size={16} />Véhicules</TabsTrigger>
          <TabsTrigger value="declarations" className="font-bold gap-2"><ClipboardCheck size={16} />Déclarations</TabsTrigger>
          <TabsTrigger value="resupply" className="font-bold gap-2"><Truck size={16} />Ravitaillements</TabsTrigger>
          <TabsTrigger value="rapport" className="font-bold gap-2"><FileText size={16} />Rapport</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {stockRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-slate-300">
                <Boxes size={32} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucun article de matériel d'exploitation au catalogue</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                  {paginatedStockRows.map(row => {
                    const low = row.seuil > 0 && row.stock <= row.seuil;
                    const notDeclared = !row.zoneEquipmentId;
                    return (
                      <div key={row.key} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-sm font-black text-slate-800 dark:text-slate-100">{row.name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {notDeclared ? "Pas encore déclaré dans cette zone" : `Seuil d'alerte : ${row.seuil} ${row.unite}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={`text-lg font-black flex items-center gap-1.5 ${low ? "text-amber-600" : notDeclared ? "text-slate-300 dark:text-slate-600" : "text-slate-800 dark:text-slate-200"}`}>
                            {low && <AlertTriangle size={16} />}
                            {row.stock} <span className="text-sm font-bold">{row.unite}</span>
                          </span>
                          {!notDeclared && row.stock > 0 && (
                            <Button size="sm" variant="outline" className="h-8 text-xs font-bold border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30" onClick={() => openDistributeDialog(row)}>
                              Ravitailler un bureau
                            </Button>
                          )}
                          <Button size="sm" className="h-8 text-xs font-bold bg-accent hover:bg-accent/90 text-white" onClick={() => openDeclareDialog(row)}>
                            Déclarer
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {stockRows.length > STOCK_PAGE_SIZE && (
                  <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold">
                      Page {stockPage} / {stockTotalPages} — {stockRows.length} article{stockRows.length > 1 ? "s" : ""}
                    </span>
                    <div className="flex gap-1.5">
                      <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={stockPage <= 1}
                        onClick={() => setStockPage(p => Math.max(1, p - 1))}>
                        <ChevronLeft size={14} />
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={stockPage >= stockTotalPages}
                        onClick={() => setStockPage(p => Math.min(stockTotalPages, p + 1))}>
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="vehicules" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {vehicleItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-slate-300">
                <Car size={32} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucun véhicule dans cette zone</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {vehicleItems.map(item => {
                  const cfg = VEHICLE_STATUS_CFG[item.status] || { label: item.status || "Inconnu", color: "text-slate-500 bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600" };
                  return (
                    <div key={item.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-black text-slate-800 dark:text-slate-100">{item.name}</p>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border inline-block mt-1 ${cfg.color}`}>{cfg.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {(item.status === "en_reparation" || item.status === "hors_service") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950/30 gap-1.5"
                            onClick={() => setRepareItem(item)}
                          >
                            <CheckCircle2 size={13} />Signaler réparé
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30 gap-1.5"
                          disabled={item.status === "en_reparation"}
                          onClick={() => setPanneItem(item)}
                        >
                          <Wrench size={13} />Signaler une panne
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="declarations" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {declarations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-slate-300">
                <ClipboardCheck size={32} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucune déclaration</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {declarations.map(d => {
                  const cfg = DECL_STATUS_CFG[d.status] || DECL_STATUS_CFG.pending;
                  return (
                    <div key={d.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-black text-slate-800 dark:text-slate-100">{d.equipment_name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {d.previous_quantity} → {d.declared_quantity} {d.unite || ""} ·{" "}
                          {new Date(d.created_at).toLocaleString("fr-FR")}
                        </p>
                        {d.decision_note && <p className="text-[11px] text-slate-400 italic mt-0.5">« {d.decision_note} »</p>}
                      </div>
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${cfg.color}`}>
                        <cfg.Icon size={12} />{cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="resupply" className="mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {requests.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-slate-300">
                <Truck size={32} strokeWidth={1} />
                <p className="text-sm font-bold text-slate-400">Aucun ravitaillement</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {requests.map(r => (
                  <div key={r.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-black text-slate-800 dark:text-slate-100">{r.equipment_name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Déclenché à {r.quantity_at_trigger} {r.unite || ""} (seuil {r.seuil_alerte}) ·{" "}
                        {new Date(r.created_at).toLocaleString("fr-FR")}
                      </p>
                    </div>
                    {r.status === "fulfilled" ? (
                      <Button size="sm" className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                        onClick={() => openConfirmDialog(r)}>
                        <PackageCheck size={13} />Confirmer réception
                      </Button>
                    ) : r.status === "confirmed" ? (
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full border text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 size={12} />Confirmé
                      </span>
                    ) : (
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full border text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 flex items-center gap-1.5">
                        <Clock size={12} />En attente du chef de bureau / CSA
                      </span>
                    )}
                  </div>
                ))}
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
                  Équipements à inclure ({selectedEquipIds.size} sélectionné{selectedEquipIds.size > 1 ? "s" : ""})
                </Label>
                <div className="flex gap-2">
                  <button type="button" className="text-[11px] font-bold text-accent hover:underline"
                    onClick={() => setSelectedEquipIds(new Set(equipment.map(e => e.id)))}>Tout sélectionner</button>
                  <button type="button" className="text-[11px] font-bold text-slate-400 hover:underline"
                    onClick={() => setSelectedEquipIds(new Set())}>Tout désélectionner</button>
                </div>
              </div>
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg max-h-72 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/50">
                {equipment.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 text-center py-8">Aucun équipement dans cette zone</p>
                ) : equipment.map(item => (
                  <label key={item.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <input
                      type="checkbox"
                      checked={selectedEquipIds.has(item.id)}
                      onChange={() => toggleEquipSelection(item.id)}
                      className="w-4 h-4 accent-accent"
                    />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1">{item.name}</span>
                    <span className="text-[10px] text-slate-400 font-medium">{item.category_label}</span>
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

      {/* ── Dialog déclaration de stock ── */}
      <Dialog open={!!declareItem} onOpenChange={open => { if (!open) setDeclareItem(null); }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-accent to-accent/80 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <ClipboardCheck size={18} /> Déclarer le stock
              </DialogTitle>
              <DialogDescription className="text-white/80 text-xs mt-0.5 font-medium">
                {declareItem?.name}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-5">
            <div className="flex items-center justify-between px-4 py-3 rounded-xl border bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Stock actuellement en base</span>
              <span className="text-lg font-black text-slate-800 dark:text-slate-200">
                {declareItem?.stock ?? 0} <span className="text-sm font-bold">{declareItem?.unite || "unité(s)"}</span>
              </span>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Quantité constatée <span className="text-red-400">*</span>
              </Label>
              <Input
                type="number"
                min="0"
                value={declareQty}
                onChange={e => setDeclareQty(e.target.value)}
                className="h-11 text-lg font-black text-center border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Note (optionnel)</Label>
              <Input
                value={declareNote}
                onChange={e => setDeclareNote(e.target.value)}
                placeholder="Ex : recomptage physique du 12/08"
                className="h-9 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Si la quantité correspond au stock déjà enregistré, elle est appliquée immédiatement.
              En cas d'écart, la déclaration est envoyée au chef de bureau / CSA pour approbation.
            </p>
          </div>

          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setDeclareItem(null)} disabled={declareLoading}>
              Annuler
            </Button>
            <Button className="flex-1 bg-accent hover:bg-accent/90 text-white font-black" onClick={handleDeclare} disabled={declareLoading}>
              {declareLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : <ClipboardCheck size={15} className="mr-2" />}
              Déclarer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog ravitaillement d'un bureau depuis le stock de la zone ── */}
      <Dialog open={!!distributeItem} onOpenChange={open => { if (!open) setDistributeItem(null); }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-orange-600 to-orange-500 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <Truck size={18} /> Ravitailler un bureau
              </DialogTitle>
              <DialogDescription className="text-orange-50 text-xs mt-0.5 font-medium">
                {distributeItem?.name}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-5">
            <div className="flex items-center justify-between px-4 py-3 rounded-xl border bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Stock disponible dans la zone</span>
              <span className="text-lg font-black text-slate-800 dark:text-slate-200">
                {distributeItem?.stock ?? 0} <span className="text-sm font-bold">{distributeItem?.unite || "unité(s)"}</span>
              </span>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Bureau de destination <span className="text-red-400">*</span>
              </Label>
              <Select value={distributeStationId} onValueChange={v => { if (v) setDistributeStationId(v); }}>
                <SelectTrigger className="w-full h-11 bg-white dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600">
                  <SelectValue placeholder={stations.length === 0 ? "Aucun bureau dans cette zone" : "Choisir un bureau"} />
                </SelectTrigger>
                <SelectContent>
                  {stations.map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-sm font-bold">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Quantité <span className="text-red-400">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                max={distributeItem?.stock ?? undefined}
                value={distributeQty}
                onChange={e => setDistributeQty(e.target.value)}
                className="h-11 text-lg font-black text-center border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Note (optionnel)</Label>
              <Input
                value={distributeNote}
                onChange={e => setDistributeNote(e.target.value)}
                placeholder="Ex : remise en main propre au chef de bureau"
                className="h-9 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Le stock de la zone diminue immédiatement. Le chef de bureau et la CSA en sont informés,
              et alertés si ce ravitaillement fait passer le stock de la zone sous le seuil critique.
            </p>
          </div>

          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setDistributeItem(null)} disabled={distributeLoading}>
              Annuler
            </Button>
            <Button className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-black" onClick={handleDistribute} disabled={distributeLoading}>
              {distributeLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : <Truck size={15} className="mr-2" />}
              Envoyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog confirmation de réception ── */}
      <Dialog open={!!confirmRequest} onOpenChange={open => { if (!open) setConfirmRequest(null); }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-emerald-700 to-emerald-600 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <PackageCheck size={18} /> Confirmer la réception
              </DialogTitle>
              <DialogDescription className="text-emerald-100 text-xs mt-0.5 font-medium">
                {confirmRequest?.equipment_name}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-5">
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Quantité reçue <span className="text-red-400">*</span>
              </Label>
              <Input
                type="number"
                min="0"
                value={confirmQty}
                onChange={e => setConfirmQty(e.target.value)}
                className="h-11 text-lg font-black text-center border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
              <p className="text-[11px] text-slate-400">S'ajoute au stock actuel de la zone.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Note (optionnel)</Label>
              <Input
                value={confirmNote}
                onChange={e => setConfirmNote(e.target.value)}
                placeholder="Ex : livraison partielle"
                className="h-9 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setConfirmRequest(null)} disabled={confirmLoading}>
              Annuler
            </Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black" onClick={handleConfirmReception} disabled={confirmLoading}>
              {confirmLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : <PackageCheck size={15} className="mr-2" />}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog signalement de panne ── */}
      <Dialog open={!!panneItem} onOpenChange={open => { if (!open) { setPanneItem(null); setPanneDescription(""); } }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-red-700 to-red-600 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <Wrench size={18} /> Signaler une panne
              </DialogTitle>
              <DialogDescription className="text-red-200 text-xs mt-0.5 font-medium">
                {panneItem?.name}
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

      {/* ── Dialog signalement de réparation ── */}
      <Dialog open={!!repareItem} onOpenChange={open => { if (!open) { setRepareItem(null); setRepareNote(""); } }}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-emerald-700 to-emerald-600 text-white px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-white flex items-center gap-2">
                <CheckCircle2 size={18} /> Signaler une réparation
              </DialogTitle>
              <DialogDescription className="text-emerald-100 text-xs mt-0.5 font-medium">
                {repareItem?.name}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Le véhicule sera immédiatement remis au statut <strong>« Fonctionnel »</strong> — CSPH, CSA, chef de bureau et chef RAM seront notifiés.
            </p>
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Note (optionnel)</Label>
              <textarea
                placeholder="Ex : plaquettes de frein changées, fuite colmatée..."
                value={repareNote}
                onChange={e => setRepareNote(e.target.value)}
                rows={3}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
          <DialogFooter className="px-6 pb-5 flex gap-3">
            <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => { setRepareItem(null); setRepareNote(""); }} disabled={repareLoading}>
              Annuler
            </Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black" onClick={handleDeclareRepare} disabled={repareLoading}>
              {repareLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : <CheckCircle2 size={15} className="mr-2" />}
              Confirmer la réparation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
