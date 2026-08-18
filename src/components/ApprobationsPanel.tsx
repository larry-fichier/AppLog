import { useState, useEffect, useCallback } from "react";
import { apiFetch, getUserData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ClipboardCheck, RefreshCw, Check, X, Truck, PackageCheck, Clock, ArrowLeftRight,
} from "lucide-react";

interface StockDeclaration {
  id: string;
  equipment_id: string;
  equipment_name: string;
  zone_name: string | null;
  declared_by_name: string;
  previous_quantity: number;
  declared_quantity: number;
  unite: string | null;
  status: string;
  note: string | null;
  created_at: string;
}

interface ResupplyRequest {
  id: string;
  equipment_id: string;
  equipment_name: string;
  zone_name: string | null;
  quantity_at_trigger: number;
  seuil_alerte: number;
  unite: string | null;
  status: string;
  fulfilled_by_name: string | null;
  created_at: string;
}

interface PendingTransfer {
  id: string;
  equipment_id: string;
  equipment_name: string;
  from_zone_name: string | null;
  from_station_name: string | null;
  to_zone_name: string | null;
  to_station_name: string | null;
  performed_by_name: string;
  note: string | null;
  created_at: string;
}

// ── Panel autonome, réutilisé tel quel dans la sidebar chef_bureau (App.tsx)
// et comme onglet CSA (SupervisionDashboard.tsx) — même idiome que AuditLogPanel.
export function ApprobationsPanel() {
  // Le CSPH a un accès lecture seule à ce panel (cf. STOCK_APPROVAL_ROLES côté
  // serveur, qui n'inclut pas csph) — sans ce garde-fou, les boutons Approuver /
  // Rejeter / Marquer ravitaillé s'affichaient normalement pour csph et
  // échouaient silencieusement avec un toast "Permission insuffisante" au clic.
  const canDecide = getUserData()?.role !== "csph";
  const [declarations, setDeclarations] = useState<StockDeclaration[]>([]);
  const [requests, setRequests]         = useState<ResupplyRequest[]>([]);
  const [transfers, setTransfers]       = useState<PendingTransfer[]>([]);
  const [loading, setLoading]           = useState(true);
  const [notes, setNotes]               = useState<Record<string, string>>({});
  const [busyId, setBusyId]             = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [declRes, reqRes, mvRes] = await Promise.all([
        apiFetch("/api/stock-declarations?status=pending"),
        apiFetch("/api/resupply-requests?status=open"),
        apiFetch("/api/movements?status=pending"),
      ]);
      const decl = declRes.ok ? await declRes.json() : [];
      const openReq = reqRes.ok ? await reqRes.json() : [];
      const pendingMv = mvRes.ok ? await mvRes.json() : [];

      let fulfilledReq: ResupplyRequest[] = [];
      const fulfilledRes = await apiFetch("/api/resupply-requests?status=fulfilled");
      if (fulfilledRes.ok) fulfilledReq = await fulfilledRes.json();

      setDeclarations(decl);
      setRequests([...openReq, ...fulfilledReq]);
      setTransfers(pendingMv);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  async function decide(id: string, action: "approve" | "reject") {
    if (action === "reject" && !notes[id]?.trim()) {
      toast.error("Un motif est obligatoire pour rejeter une déclaration.");
      return;
    }
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/stock-declarations/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notes[id]?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(action === "approve" ? "Déclaration approuvée" : "Déclaration rejetée");
      setDeclarations(prev => prev.filter(d => d.id !== id));
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function decideTransfer(id: string, action: "approve" | "reject") {
    if (action === "reject" && !notes[id]?.trim()) {
      toast.error("Un motif est obligatoire pour rejeter un transfert.");
      return;
    }
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/movements/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notes[id]?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(action === "approve" ? "Transfert approuvé" : "Transfert rejeté");
      setTransfers(prev => prev.filter(t => t.id !== id));
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function fulfill(id: string) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/resupply-requests/${id}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notes[id]?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success("Ravitaillement marqué effectif — en attente de confirmation par la zone");
      fetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <ArrowLeftRight size={14} className="text-accent" />
          <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm">Transferts en attente</h3>
          <span className="text-[10px] text-slate-400 font-bold">— {transfers.length} en attente</span>
        </div>

        {transfers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-300">
            <ArrowLeftRight size={30} strokeWidth={1} />
            <p className="text-xs font-bold text-slate-400">Aucun transfert en attente</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {transfers.map(t => (
              <div key={t.id} className="px-5 py-4 flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-black text-slate-800 dark:text-slate-100">{t.equipment_name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t.performed_by_name} · {new Date(t.created_at).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-black text-slate-600 dark:text-slate-300">
                    <span>{t.from_zone_name}{t.from_station_name && ` / ${t.from_station_name}`}</span>
                    <span className="text-slate-300 dark:text-slate-600">→</span>
                    <span>{t.to_zone_name}{t.to_station_name && ` / ${t.to_station_name}`}</span>
                  </div>
                </div>
                {t.note && <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">« {t.note} »</p>}
                {canDecide ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      placeholder="Note (obligatoire pour rejeter)"
                      className="h-8 text-xs flex-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      value={notes[t.id] || ""}
                      onChange={e => setNotes(prev => ({ ...prev, [t.id]: e.target.value }))}
                    />
                    <Button size="sm" className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                      disabled={busyId === t.id} onClick={() => decideTransfer(t.id, "approve")}>
                      <Check size={13} />Approuver
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30 gap-1"
                      disabled={busyId === t.id} onClick={() => decideTransfer(t.id, "reject")}>
                      <X size={13} />Rejeter
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 flex items-center gap-1.5 mt-1">
                    <Clock size={13} />En attente d'approbation (chef de bureau / CSA)
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <ClipboardCheck size={14} className="text-accent" />
          <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm">Déclarations de stock en attente</h3>
          <span className="text-[10px] text-slate-400 font-bold">— {declarations.length} en attente</span>
          <Button variant="outline" size="sm" className="ml-auto h-8 px-2 text-xs font-bold border-slate-200 dark:border-slate-600 dark:text-slate-300 gap-1.5" onClick={fetchAll}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />Actualiser
          </Button>
        </div>

        {declarations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-300">
            <ClipboardCheck size={30} strokeWidth={1} />
            <p className="text-xs font-bold text-slate-400">Aucune déclaration en attente</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {declarations.map(d => (
              <div key={d.id} className="px-5 py-4 flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-black text-slate-800 dark:text-slate-100">{d.equipment_name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {d.zone_name || "Zone inconnue"} · {d.declared_by_name} ·{" "}
                      {new Date(d.created_at).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-black">
                    <span className="text-slate-400 dark:text-slate-500">{d.previous_quantity}</span>
                    <span className="text-slate-300 dark:text-slate-600">→</span>
                    <span className="text-amber-600 dark:text-amber-400">{d.declared_quantity} {d.unite || ""}</span>
                  </div>
                </div>
                {d.note && <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">« {d.note} »</p>}
                {canDecide ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      placeholder="Note (obligatoire pour rejeter)"
                      className="h-8 text-xs flex-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      value={notes[d.id] || ""}
                      onChange={e => setNotes(prev => ({ ...prev, [d.id]: e.target.value }))}
                    />
                    <Button size="sm" className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                      disabled={busyId === d.id} onClick={() => decide(d.id, "approve")}>
                      <Check size={13} />Approuver
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30 gap-1"
                      disabled={busyId === d.id} onClick={() => decide(d.id, "reject")}>
                      <X size={13} />Rejeter
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 flex items-center gap-1.5 mt-1">
                    <Clock size={13} />En attente d'approbation (chef de bureau / CSA)
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <Truck size={14} className="text-accent" />
          <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm">Demandes de ravitaillement</h3>
          <span className="text-[10px] text-slate-400 font-bold">— {requests.length} en cours</span>
        </div>

        {requests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-300">
            <Truck size={30} strokeWidth={1} />
            <p className="text-xs font-bold text-slate-400">Aucune demande en cours</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {requests.map(r => (
              <div key={r.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-100">{r.equipment_name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {r.zone_name || "Zone inconnue"} · Stock {r.quantity_at_trigger} {r.unite || ""} (seuil {r.seuil_alerte})
                  </p>
                </div>
                {r.status === "open" && canDecide ? (
                  <Button size="sm" className="h-8 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white gap-1.5"
                    disabled={busyId === r.id} onClick={() => fulfill(r.id)}>
                    <PackageCheck size={13} />Marquer ravitaillé
                  </Button>
                ) : r.status === "open" ? (
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Clock size={13} />En attente (chef de bureau / CSA)
                  </span>
                ) : (
                  <span className="text-[11px] font-black text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <Clock size={13} />En attente de confirmation par la zone
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
