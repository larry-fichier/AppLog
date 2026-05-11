import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
  Loader2, Car, ChevronRight, X, BarChart3, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────
interface RawRow {
  Année?: any;
  Date_Intervention?: any;
  ID_Immatriculation?: any;
  Marque?: any;
  Etat_Vehicule?: any;
  Types_Interventions?: any;
  Statut_Intervention?: any;
  [key: string]: any;
}

interface Vehicle {
  immat: string;
  immat_original: string;
  marque: string;
  etat: string;
  status: "fonctionnel" | "en_reparation" | "hors_service";
  interventions: { annee: string; mois: string; type: string; statut: string }[];
  selected: boolean;
}

interface ImportResult {
  imported: number;
  total: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────
function normalizeImmat(raw: string): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function mapEtatToStatus(etat: string): Vehicle["status"] {
  const e = String(etat ?? "").toLowerCase();
  if (e.includes("hors") || e.includes("panne") || e.includes("vieux") || e.includes("très vieux")) return "hors_service";
  if (e.includes("répar") || e.includes("repair") || e.includes("garage") || e.includes("entretien")) return "en_reparation";
  return "fonctionnel";
}

/**
 * Cherche la ligne d'en-tête en détectant au moins 2 mots-clés connus.
 * Cela évite les faux positifs sur les lignes de titre fusionnées.
 */
function detectHeaderIndex(allRows: any[][]): number {
  const keywords = [
    'immatricul', 'marque', 'annee', 'année', 'intervention',
    'etat', 'état', 'statut', 'type', 'date', 'vehicule', 'véhicule'
  ];

  for (let i = 0; i < Math.min(allRows.length, 20); i++) {
    const row = allRows[i];
    if (!row || !Array.isArray(row)) continue;

    // Ignorer les lignes avec des cellules fusionnées (__EMPTY)
    const hasEmpty = row.some((cell: any) =>
      typeof cell === "string" && cell.startsWith("__EMPTY")
    );
    if (hasEmpty) continue;

    // Ignorer les lignes qui contiennent "GESTION" (titre)
    const isTitle = row.some((cell: any) =>
      typeof cell === "string" && cell.toUpperCase().includes("GESTION")
    );
    if (isTitle) continue;

    const matches = row.filter((cell: any) =>
      typeof cell === "string" &&
      keywords.some(k => cell.toLowerCase().includes(k))
    );

    if (matches.length >= 2) {
      console.log(`[RameImporter] En-tête trouvé ligne ${i + 1}:`, row);
      return i;
    }
  }

  // Fallback : chercher la première ligne avec au moins 4 cellules non vides
  for (let i = 0; i < Math.min(allRows.length, 20); i++) {
    const row = allRows[i];
    if (!row) continue;
    const nonEmpty = row.filter((c: any) => c !== null && c !== undefined && c !== "");
    if (nonEmpty.length >= 4) {
      console.log(`[RameImporter] Fallback en-tête ligne ${i + 1}`);
      return i;
    }
  }

  return 0;
}

function deduplicateVehicles(rows: RawRow[]): Vehicle[] {
  const map = new Map<string, Vehicle>();

  const findCol = (row: RawRow, keywords: string[]): string => {
    const keys = Object.keys(row);
    const found = keys.find(k =>
      keywords.some(kw => k.toLowerCase().includes(kw))
    );
    return found ? String(row[found] ?? "").trim() : "";
  };

  for (const row of rows) {
    const rawImmat = findCol(row, ['immatricul']);
    if (!rawImmat || rawImmat === "") continue;

    const key = normalizeImmat(rawImmat);
    if (map.has(key)) continue; // On prend juste la première occurrence

    const marque = findCol(row, ['marque']);
    const etat = findCol(row, ['etat', 'état']);

    map.set(key, {
      immat: key,
      immat_original: rawImmat,
      marque,
      etat,
      status: mapEtatToStatus(etat),
      interventions: [],
      selected: true,
    });
  }

  return Array.from(map.values());
}

// ─── Composant principal ───────────────────────────────────
export function RameImporter() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [search, setSearch] = useState("");
  const [debugInfo, setDebugInfo] = useState<string>("");

  const selectedVehicles = vehicles.filter(v => v.selected);
  const filtered = vehicles.filter(v =>
    v.immat.includes(search.toUpperCase()) ||
    v.marque.toLowerCase().includes(search.toLowerCase())
  );

  async function loadCategories() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        const cats = (data.categories || []).map((c: any) => ({ id: c.id, label: c.label }));
        setCategories(cats);
        const auto = cats.find((c: any) =>
          c.label.toLowerCase().includes("rame") ||
          c.label.toLowerCase().includes("véhicule") ||
          c.label.toLowerCase().includes("vehicule") ||
          c.label.toLowerCase().includes("automobile")
        );
        if (auto) setCategoryId(auto.id);
      }
    } catch (e) {
      console.error("Config fetch error", e);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setDebugInfo("");

    const reader = new FileReader();
    reader.onload = (evt) => {
  try {
    const wb = XLSX.read(evt.target?.result as ArrayBuffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Lire tout en brut : tableau de tableaux
    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];

    // Trouver la vraie ligne d'en-tête en cherchant "immatricul" dans les cellules
    let headerIdx = 0;
    for (let i = 0; i < Math.min(allRows.length, 20); i++) {
      const row = allRows[i];
      if (!Array.isArray(row)) continue;
      const found = row.some((cell: any) =>
        typeof cell === "string" && cell.toLowerCase().includes("immatricul")
      );
      if (found) { headerIdx = i; break; }
    }

    // Construire manuellement les objets avec les vrais noms de colonnes
    const headers: string[] = allRows[headerIdx].map((h: any) => String(h ?? "").trim());
    const dataRows: RawRow[] = [];

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const rawRow = allRows[i];
      if (!rawRow) continue;
      const obj: RawRow = {};
      headers.forEach((h, idx) => { if (h) obj[h] = rawRow[idx]; });
      dataRows.push(obj);
    }

    setDebugInfo(`En-tête ligne: ${headerIdx + 1} | Colonnes: ${headers.filter(Boolean).join(", ")} | Lignes: ${dataRows.length}`);

    const deduped = deduplicateVehicles(dataRows);

    if (deduped.length === 0) {
      toast.error(`Aucun véhicule. Colonnes: ${headers.filter(Boolean).join(", ")}`);
      setLoading(false);
      return;
    }

    setVehicles(deduped);
    loadCategories();
    setStep("preview");
    toast.success(`${deduped.length} véhicules détectés`);
  } catch (err) {
    console.error(err);
    toast.error("Erreur de lecture.");
  } finally {
    setLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  }
};
    reader.onerror = () => {
      toast.error("Impossible de lire le fichier.");
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    const token = localStorage.getItem("helios_token");
    if (!token) { toast.error("Session expirée. Reconnectez-vous."); return; }
    if (!categoryId) { toast.error("Sélectionnez une catégorie."); return; }
    if (selectedVehicles.length === 0) { toast.error("Sélectionnez au moins un véhicule."); return; }

    setLoading(true);
    const errors: string[] = [];
    let imported = 0;

    for (const v of selectedVehicles) {
      try {
        const interventionSummary = v.interventions
          .slice(0, 10)
          .map(i => `[${i.annee} ${i.mois}] ${i.type}`)
          .join(" | ");

        const payload = {
          name: v.immat,
          category_id: categoryId,
          status: v.status,
          zone_id: null,
          station_id: null,
          details: {
            immatriculation: v.immat_original,
            marque: v.marque,
            etat_original: v.etat,
            nb_interventions: String(v.interventions.length),
            dernieres_interventions: interventionSummary,
          },
        };

        const res = await fetch("/api/equipment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
            imported++;
            } else if (res.status === 409) {
            console.log(`[Import] Doublon ignoré: ${v.immat}`);
            } else {
            const err = await res.json();
            errors.push(`${v.immat}: ${err.error}`);
            }
      } catch (err: any) {
        errors.push(`${v.immat}: ${err.message}`);
      }
    }

    setResult({ imported, total: selectedVehicles.length, errors });
    setStep("result");
    setLoading(false);
  }

  function toggleAll(val: boolean) {
    setVehicles(prev => prev.map(v => ({ ...v, selected: val })));
  }

  function toggleVehicle(immat: string) {
    setVehicles(prev => prev.map(v =>
      v.immat === immat ? { ...v, selected: !v.selected } : v
    ));
  }

  const statusColors = {
    fonctionnel:   { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Fonctionnel" },
    en_reparation: { dot: "bg-amber-500",   badge: "bg-amber-50 text-amber-700 border-amber-200",     label: "En réparation" },
    hors_service:  { dot: "bg-red-500",     badge: "bg-red-50 text-red-600 border-red-200",           label: "Hors service" },
  };

  return (
    <div className="space-y-6">

      {/* ── UPLOAD ── */}
      {step === "upload" && (
        <div className="space-y-4">
          <div
            onClick={() => fileRef.current?.click()}
            className="group border-2 border-dashed border-slate-200 rounded-2xl p-14 flex flex-col items-center gap-5 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-all duration-200"
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            {loading ? (
              <>
                <Loader2 className="w-10 h-10 text-slate-400 animate-spin" />
                <p className="text-sm font-bold text-slate-500 animate-pulse">Analyse du fichier en cours...</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                  <FileSpreadsheet className="w-8 h-8 text-white" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-base font-black text-slate-800">Déposez votre fichier Access exporté ici</p>
                  <p className="text-xs text-slate-400">Format : Excel (.xlsx) — GESTION_DE_LA_RAME_HELIOS_PARC_AUTOMOBILE.xlsx</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 bg-slate-100 px-4 py-2 rounded-full">
                  <Car size={14} />
                  Détection automatique des véhicules uniques par immatriculation
                </div>
                <Button variant="outline" className="border-slate-300 font-bold text-sm">
                  <Upload size={14} className="mr-2" />Choisir le fichier
                </Button>
              </>
            )}
          </div>

          {/* Debug info si présente */}
          {debugInfo && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider mb-1">Diagnostic</p>
              <p className="text-xs text-amber-600 font-mono break-all">{debugInfo}</p>
            </div>
          )}
        </div>
      )}

      {/* ── PRÉVISUALISATION ── */}
      {step === "preview" && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-300">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Véhicules détectés", value: vehicles.length, color: "text-slate-900" },
              { label: "Sélectionnés", value: selectedVehicles.length, color: "text-emerald-600" },
              { label: "Interventions totales", value: vehicles.reduce((a, v) => a + v.interventions.length, 0), color: "text-blue-600" },
            ].map(s => (
              <div key={s.label} className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Catégorie + contrôles */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 flex-1 min-w-[200px]">
              <Car size={14} className="text-slate-400 shrink-0" />
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                className="flex-1 text-sm font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
              >
                <option value="">-- Choisir la catégorie HELIOS --</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>

            <input
              type="text"
              placeholder="Rechercher immat ou marque..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-slate-400 bg-white min-w-[200px]"
            />

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleAll(true)} className="text-xs font-bold border-slate-200">Tout sélectionner</Button>
              <Button variant="outline" size="sm" onClick={() => toggleAll(false)} className="text-xs font-bold border-slate-200">Tout désélectionner</Button>
              <Button variant="ghost" size="sm" onClick={() => setStep("upload")} className="text-xs font-bold text-slate-400 hover:text-slate-600">
                <RefreshCw size={13} className="mr-1" /> Changer de fichier
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="max-h-[440px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={vehicles.every(v => v.selected)} onChange={e => toggleAll(e.target.checked)} className="w-4 h-4 rounded" />
                    </th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Immatriculation</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Marque</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">État</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-center">Interventions</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Dernière intervention</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => {
                    const sc = statusColors[v.status];
                    const last = v.interventions[v.interventions.length - 1];
                    return (
                      <tr key={v.immat} onClick={() => toggleVehicle(v.immat)}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${v.selected ? "bg-white hover:bg-slate-50" : "bg-slate-50 opacity-50"}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={v.selected} onChange={() => toggleVehicle(v.immat)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${sc.dot}`} />
                            <span className="text-sm font-black text-slate-800 font-mono">{v.immat}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-slate-700">{v.marque || <span className="italic text-slate-300">—</span>}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${sc.badge}`}>{sc.label}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <BarChart3 size={12} className="text-slate-400" />
                            <span className="text-sm font-black text-slate-700">{v.interventions.length}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[200px]">
                          {last ? (
                            <div>
                              <p className="text-[10px] font-bold text-slate-400">{last.annee} {last.mois}</p>
                              <p className="text-xs text-slate-600 truncate">{last.type.substring(0, 50)}</p>
                            </div>
                          ) : <span className="text-slate-300 italic text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Résumé statuts */}
          <div className="flex gap-3 text-xs flex-wrap">
            {(["fonctionnel", "en_reparation", "hors_service"] as const).map(s => {
              const count = vehicles.filter(v => v.status === s).length;
              const sc = statusColors[s];
              return (
                <div key={s} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${sc.badge}`}>
                  <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
                  <span className="font-black">{count}</span>
                  <span className="font-medium">{sc.label}</span>
                </div>
              );
            })}
          </div>

          {/* Bouton import */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleImport} disabled={loading || selectedVehicles.length === 0 || !categoryId}
              className="bg-slate-900 hover:bg-slate-800 text-white font-black px-10 h-12 text-sm uppercase tracking-wider shadow-lg active:scale-95 min-w-[240px]">
              {loading
                ? <><Loader2 size={16} className="animate-spin mr-2" />Importation...</>
                : <><Car size={16} className="mr-2" />Importer {selectedVehicles.length} véhicule{selectedVehicles.length > 1 ? "s" : ""}<ChevronRight size={14} className="ml-1" /></>
              }
            </Button>
          </div>
        </div>
      )}

      {/* ── RÉSULTAT ── */}
      {step === "result" && result && (
        <div className="space-y-6 animate-in zoom-in-95 duration-300">
          <div className="text-center space-y-3 py-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${result.errors.length === 0 ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"}`}>
              {result.errors.length === 0 ? <CheckCircle2 size={32} /> : <AlertCircle size={32} />}
            </div>
            <h3 className="text-xl font-black text-slate-900">Import terminé</h3>
            <p className="text-sm text-slate-500">{result.imported} sur {result.total} véhicule{result.total > 1 ? "s" : ""} importé{result.imported > 1 ? "s" : ""}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-xl text-center">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-600 mb-1">Succès</p>
              <p className="text-4xl font-black text-emerald-600">{result.imported}</p>
              <p className="text-[10px] text-emerald-500 font-medium mt-1">véhicules créés</p>
            </div>
            <div className="bg-red-50 border border-red-200 p-6 rounded-xl text-center">
              <p className="text-xs font-black uppercase tracking-widest text-red-500 mb-1">Échecs</p>
              <p className="text-4xl font-black text-red-500">{result.total - result.imported}</p>
              <p className="text-[10px] text-red-400 font-medium mt-1">non importés</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2 max-h-40 overflow-y-auto">
              <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">Détail des erreurs</p>
              {result.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-700">
                  <X size={12} className="shrink-0 mt-0.5" />{e}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-center">
            <Button variant="outline" onClick={() => { setStep("upload"); setVehicles([]); setResult(null); setDebugInfo(""); }}
              className="font-bold border-slate-200">
              <RefreshCw size={14} className="mr-2" />Nouvel import
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}