import { useState, useEffect, useRef } from "react";
import React from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import {
  Loader2, Trash2, Save, ChevronLeft,
  Tag, ClipboardList, CheckCircle2, Circle,
  History, QrCode, X
} from "lucide-react";
import { Equipment, EquipmentStatus, GlobalSettings } from "@/types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: Equipment;
  activeRole?: string;
  isBypass?: boolean;
  defaultCategoryId?: string;
}

type Step = "category" | "info";

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: "category", label: "Catégorie",    icon: <Tag size={13} /> },
  { id: "info",     label: "Informations", icon: <ClipboardList size={13} /> },
];

const CATEGORY_ICONS: Record<string, string> = {
  rame: "🚌", vehicule: "🚗", voiture: "🚙",
  clim: "❄️", climatiseur: "❄️",
  groupe: "⚡", générateur: "⚡", generateur: "⚡",
  cuisine: "🍽️", frigo: "🧊", réfrigér: "🧊",
  informatique: "💻", it: "🖥️", ordinateur: "🖥️",
  mobilier: "🪑", meuble: "🪑",
  imprimante: "🖨️",
  outil: "🛠️", outillage: "🛠️", outils: "🛠️", câble: "🔌", cable: "🔌",
};

function getCategoryIcon(label: string): string {
  const l = label.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (l.includes(key)) return icon;
  }
  return "📦";
}

const CATEGORIES_WITH_SERIAL: string[] = [
  "rame", "véhicule", "vehicule", "voiture",
  "clim", "climatiseur",
  "groupe", "générateur", "generateur", "electro",
  "cuisine", "frigo", "réfrigér", "refriger",
  "informatique", "it", "ordinateur", "imprimante",
  "outil", "outillage", "outils", "câble", "cable",
];

function hasSerialNumber(categoryLabel: string): boolean {
  const l = categoryLabel.toLowerCase();
  return CATEGORIES_WITH_SERIAL.some(k => l.includes(k));
}

function slugify(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toUpperCase();
}

function generateInventoryNumber(categoryLabel: string, details: Record<string, any>): string {
  if (categoryLabel.toLowerCase().includes("cuisine")) {
    // Format : CUI-YYYY-XXXX  (XXXX = 4 derniers chiffres du timestamp pour unicité)
    const year = new Date().getFullYear();
    const seq  = String(Date.now()).slice(-4).padStart(4, "0");
    return `CUI-${year}-${seq}`;
  }
  const prefix = "OUT";
  const designation = slugify(details.designation || details.modele || details.marque || "ITEM");
  const modele = slugify(details.modele || "");
  const quantite = details.quantite ? String(details.quantite) : "1";
  const entree = details.date_entree ? String(details.date_entree).replace(/-/g, "") : "";
  const sortie = details.date_sortie && details.position && !["magasin", "bureau logistique"].includes(String(details.position).toLowerCase())
    ? `-${String(details.date_sortie).replace(/-/g, "")}`
    : "";
  const parts = [prefix, designation, modele, quantite, entree].filter(Boolean);
  return `${parts.join("-")}${sortie}`;
}

interface DynamicField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "textarea" | "select";
  placeholder: string;
  fullWidth?: boolean;
  isSerial?: boolean;
  required?: boolean;
  options?: string[];
  section?: string;
  showOtherInput?: boolean;
}

function getDynamicFields(categoryLabel: string): DynamicField[] {
  const l = categoryLabel.toLowerCase();

  if (l.includes("rame") || l.includes("véhicule") || l.includes("vehicule") ||
      l.includes("voiture") || l.includes("camion") || l.includes("transport")) {
    return [
      { key: "numero_chassis",        label: "Numéro de Châssis",              type: "text",     placeholder: "Ex: JTMBE33V705017342", isSerial: true, required: true, section: "Identification" },
      { key: "immatriculation",        label: "Plaque d'Immatriculation",       type: "text",     placeholder: "Ex: LT-123-A",          required: true },
      { key: "marque",                 label: "Marque",                          type: "text",     placeholder: "Ex: Toyota, Mitsubishi...", required: true, section: "Caractéristiques" },
      { key: "type_vehicule",          label: "Type de véhicule",               type: "select",   placeholder: "", options: ["Berline", "SUV / 4x4", "Pick-up / Double Cabine", "Minibus", "Bus", "Camion", "Ambulance", "Moto", "Autre"] },
      { key: "couleur",                label: "Couleur",                         type: "text",     placeholder: "Ex: Blanc, Gris..." },
      { key: "annee",                  label: "Année",                           type: "number",   placeholder: "Ex: 2020" },
      { key: "kilometrage",            label: "Kilométrage (km)",               type: "number",   placeholder: "Ex: 45000" },
      { key: "date_mise_service",      label: "Date de mise en service",        type: "date",     placeholder: "", section: "Dates" },
      { key: "date_deploiement",       label: "Date de déploiement",            type: "date",     placeholder: "" },
      { key: "date_visite_technique",  label: "Prochain contrôle technique",    type: "date",     placeholder: "" },
    ];
  }

  if (l.includes("outillage") || l.includes("outil") || l.includes("outils")) {
    return [
      { key: "numero_inventaire", label: "N° d'Inventaire",        type: "text",     placeholder: "Ex: OUT-2024-001", required: true, isSerial: true, section: "Identification" },
      { key: "designation",       label: "Désignation",            type: "text",     placeholder: "Ex: Perceuse, Marteau...", required: true, fullWidth: true },
      { key: "modele",            label: "Modèle / Référence",     type: "text",     placeholder: "Ex: DCD996" },
      { key: "quantite",          label: "Quantité",               type: "number",   placeholder: "Ex: 1", required: true },
      { key: "position",          label: "Position / Emplacement", type: "select",   placeholder: "", required: true, section: "Affectation", options: ["Magasin", "Atelier", "En emprunt", "Service technique", "Autre"] },
      { key: "date_entree",       label: "Date d'arrivée",         type: "date",     placeholder: "", section: "Dates" },
      { key: "date_sortie",       label: "Date de sortie",         type: "date",     placeholder: "" },
      { key: "type_sortie",       label: "Type de sortie",          type: "select",   placeholder: "", options: ["Emprunt temporaire", "Sortie définitive (câbles / consommables)"], section: "Affectation" },
      { key: "observation",       label: "Observation",            type: "textarea", placeholder: "Usage, état, remarques...", fullWidth: true, section: "Notes" },
    ];
  }

  if (l.includes("cuisine") || l.includes("ameublement") || l.includes("mobilier") ||
      l.includes("meuble") || l.includes("frigo") || l.includes("réfrigér") || l.includes("refriger")) {
    return [
      { key: "numero_inventaire",      label: "N° d'Inventaire",                type: "text",     placeholder: "CUI-2026-0001", isSerial: true, required: true, section: "Identification" },
      { key: "marque",                 label: "Marque",                           type: "text",     placeholder: "Ex: Samsung, Brandt...", section: "Caractéristiques" },
      { key: "modele",                 label: "Modèle / Référence",              type: "text",     placeholder: "Ex: RB38T775CS9" },
      { key: "quantite",               label: "Quantité",                         type: "number",   placeholder: "Ex: 1", required: true },
      { key: "date_entree",            label: "Date d'entrée en stock",          type: "date",     placeholder: "", section: "Dates" },
      { key: "date_mise_utilisation",  label: "Date de mise en utilisation",     type: "date",     placeholder: "", required: true },
      { key: "date_sortie",            label: "Date de sortie",                  type: "date",     placeholder: "" },
      { key: "observation",            label: "Observation",                      type: "textarea", placeholder: "État, emplacement précis, remarques...", fullWidth: true, section: "Notes" },
    ];
  }

  if (l.includes("groupe") || l.includes("générateur") || l.includes("generateur") ||
      l.includes("electro") || l.includes("énergie") || l.includes("energie") || l.includes("ups") || l.includes("onduleur")) {
    return [
      { key: "numero_serie",           label: "Numéro de Série",                type: "text",     placeholder: "Ex: UPS-12345", isSerial: true, required: true, section: "Identification" },
      { key: "type_equipement",        label: "Type d'équipement",              type: "select",   placeholder: "", required: true, section: "Caractéristiques",
        options: ["UPS", "PDB", "Générateur", "Stabilisateur système", "Stabilisateur delta", "Régulateur de tension", "Autre"],
        showOtherInput: true },
      { key: "marque",                 label: "Marque",                          type: "text",     placeholder: "Ex: Eaton, Schneider, Caterpillar..." },
      { key: "modele",                 label: "Modèle / Référence",              type: "text",     placeholder: "Ex: EXRT10KTFW" },
      { key: "puissance",              label: "Puissance / Capacité",            type: "text",     placeholder: "Ex: 10 kVA, 20 kVA" },
      { key: "date_entree",            label: "Date d'entrée",                   type: "date",     placeholder: "", section: "Dates" },
      { key: "date_mise_service",      label: "Date de mise en service",         type: "date",     placeholder: "" },
      { key: "date_derniere_revision", label: "Dernière révision / maintenance",  type: "date",    placeholder: "" },
      { key: "observation",            label: "Observation",                      type: "textarea", placeholder: "État, remarques...", fullWidth: true, section: "Notes" },
    ];
  }

  if (l.includes("clim") || l.includes("climatiseur") || l.includes("climatisation")) {
    return [
      { key: "numero_serie",           label: "Numéro de Série",                type: "text",     placeholder: "Ex: CLM-2024-058", isSerial: true, required: true, section: "Identification" },
      { key: "marque",                 label: "Marque",                           type: "text",     placeholder: "Ex: Hisense, Samsung, Daikin...", required: true, section: "Caractéristiques" },
      { key: "modele",                 label: "Modèle / Référence",              type: "text",     placeholder: "Ex: AS-09UR4SYDEI" },
      { key: "puissance_cv",           label: "Puissance (CV / BTU)",            type: "text",     placeholder: "Ex: 1.5 CV ou 12000 BTU" },
      { key: "type_clim",              label: "Type",                             type: "select",   placeholder: "", options: ["Split mural", "Split plafond", "Cassette", "Armoire", "Centrale"] },
      { key: "position",               label: "Emplacement / N° local",          type: "text",     placeholder: "Ex: Bureau 58, Couloir B2" },
      { key: "date_entree",            label: "Date d'entrée",                   type: "date",     placeholder: "", section: "Dates" },
      { key: "date_deploiement",       label: "Date de déploiement",             type: "date",     placeholder: "" },
      { key: "date_derniere_revision", label: "Dernière révision / maintenance",  type: "date",    placeholder: "" },
      { key: "observation",            label: "Observation",                      type: "textarea", placeholder: "Remarques...", fullWidth: true, section: "Notes" },
    ];
  }

  if (l.includes("exploitation") || l.includes("matériel d") || l.includes("materiel d")) {
    return [
      { key: "type_consommable",   label: "Type de consommable",      type: "select",   placeholder: "", required: true, section: "Identification",
        options: ["Toner d'imprimante", "Registre d'exploitation", "Rame de papier", "Autre"],
        showOtherInput: true },
      { key: "designation",        label: "Désignation",               type: "text",     placeholder: "Ex: Toner HP LaserJet 26A, Registre journalier...", required: true, fullWidth: true },
      { key: "quantite_stock",     label: "Quantité en stock",         type: "number",   placeholder: "Ex: 10", required: true, section: "Stock" },
      { key: "unite",              label: "Unité",                     type: "select",   placeholder: "", options: ["Pièce(s)", "Rame(s)", "Boîte(s)", "Carton(s)", "Paquet(s)"] },
      { key: "seuil_alerte",       label: "Seuil d'alerte (min)",      type: "number",   placeholder: "Ex: 2" },
      { key: "date_entree",        label: "Date d'entrée en stock",    type: "date",     placeholder: "", section: "Dates" },
      { key: "fournisseur",        label: "Fournisseur",               type: "text",     placeholder: "Ex: Bureau Vallée, Sodicaf..." },
      { key: "observation",        label: "Observation",               type: "textarea", placeholder: "Remarques, référence commande...", fullWidth: true, section: "Notes" },
    ];
  }

  if (l.includes("informatique") || l.includes("it") || l.includes("ordinateur") ||
      l.includes("électronique") || l.includes("electronique") || l.includes("imprimante") || l.includes("réseau")) {
    return [
      { key: "designation",    label: "Désignation",            type: "text",     placeholder: "Ex: PC bureau, Imprimante accueil...", required: true, fullWidth: true, section: "Identification" },
      { key: "type_materiel",  label: "Type de matériel",       type: "select",   placeholder: "", options: ["Ordinateur de bureau", "Laptop / Portable", "Serveur", "Imprimante", "Photocopieur", "Switch / Routeur", "Écran", "Tablette", "Autre"], required: true, section: "Caractéristiques" },
      { key: "marque",         label: "Marque",                 type: "text",     placeholder: "Ex: Dell, HP, Lenovo...", required: true },
      { key: "modele",         label: "Modèle / Référence",     type: "text",     placeholder: "Ex: Latitude 5420" },
      { key: "numero_serie",   label: "Numéro de Série",        type: "text",     placeholder: "Ex: SN-DELL-12345" },
      { key: "date_entree",    label: "Date d'entrée",          type: "date",     placeholder: "", section: "Dates" },
      { key: "date_deploiement", label: "Date de déploiement",  type: "date",     placeholder: "" },
      { key: "observation",    label: "Observation",            type: "textarea", placeholder: "Affectation, remarques...", fullWidth: true, section: "Notes" },
    ];
  }

  if (l.includes("armement") || l.includes("arme") || l.includes("armes")) {
    return [
      { key: "numero_serie",           label: "Numéro de Série / Matricule",   type: "text",     placeholder: "Ex: ARM-2026-0001", isSerial: true, required: true, section: "Identification" },
      { key: "designation",            label: "Désignation",                    type: "text",     placeholder: "Ex: Pistolet, Fusil d'assaut...", required: true, fullWidth: true },
      { key: "marque",                 label: "Marque / Fabricant",             type: "text",     placeholder: "Ex: Glock, Beretta...", section: "Caractéristiques" },
      { key: "modele",                 label: "Modèle / Référence",             type: "text",     placeholder: "Ex: G17, M16A2..." },
      { key: "calibre",                label: "Calibre",                        type: "text",     placeholder: "Ex: 9mm, 5.56x45mm..." },
      { key: "date_entree",            label: "Date d'entrée en dotation",      type: "date",     placeholder: "", section: "Dates" },
      { key: "date_derniere_revision", label: "Dernière révision",              type: "date",     placeholder: "" },
      { key: "observation",            label: "Observation",                    type: "textarea", placeholder: "État, remarques...", fullWidth: true, section: "Notes" },
    ];
  }

  return [
    { key: "numero_inventaire",     label: "N° Inventaire / Référence",      type: "text",     placeholder: "Ex: REF-2024-001", isSerial: true, section: "Identification" },
    { key: "designation",           label: "Désignation",                     type: "text",     placeholder: "Nom précis de l'équipement", required: true, fullWidth: true },
    { key: "marque",                label: "Marque / Fabricant",              type: "text",     placeholder: "Marque...", section: "Caractéristiques" },
    { key: "modele",                label: "Modèle",                          type: "text",     placeholder: "Modèle..." },
    { key: "quantite",              label: "Quantité",                        type: "number",   placeholder: "1", required: true },
    { key: "date_entree",           label: "Date d'entrée en stock",         type: "date",     placeholder: "", section: "Dates" },
    { key: "date_mise_utilisation", label: "Date de mise en utilisation",    type: "date",     placeholder: "" },
    { key: "date_deploiement",      label: "Date de déploiement",            type: "date",     placeholder: "" },
    { key: "observation",           label: "Observation",                     type: "textarea", placeholder: "Remarques...", fullWidth: true, section: "Notes" },
  ];
}

const STATUS_OPTIONS = [
  { value: "fonctionnel",   label: "Fonctionnel",   color: "bg-emerald-500", light: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800" },
  { value: "en_reparation", label: "En réparation", color: "bg-amber-500",   light: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800" },
  { value: "hors_service",  label: "Hors service",  color: "bg-red-500",     light: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900" },
];

export function EquipmentDialog({
  open, onOpenChange, item, activeRole = "agent_logistique", isBypass = false, defaultCategoryId
}: Props) {
  const [loading, setLoading]                   = useState(false);
  const [step, setStep]                         = useState<Step>("category");
  const [settings, setSettings]                 = useState<GlobalSettings | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [showQR, setShowQR]                     = useState(false);
  const [history, setHistory]                   = useState<any[]>([]);
  const [historyLoading, setHistoryLoading]     = useState(false);

  const [categoryId, setCategoryId]     = useState("");
  const [categoryLabel, setCategoryLabel] = useState(""); // stocké directement pour éviter dépendance async
  const [name, setName]                 = useState("");
  const [status, setStatus]             = useState<EquipmentStatus>("fonctionnel");
  const [details, setDetails]           = useState<Record<string, any>>({});
  const [zoneId, setZoneId]             = useState("");
  const [stationId, setStationId]       = useState("");
  // Nombre d'interventions sauvegardées au moment de l'ouverture — empêche leur suppression
  const savedInterventionsCount = useRef<number>(0);
  // ── Interventions véhicule ─────────────────────────────
  const [newIntervDate, setNewIntervDate] = useState("");
  const [newIntervDesc, setNewIntervDesc] = useState("");

  React.useEffect(() => {
    if (!showHistory || !item?.id) return;
    setHistoryLoading(true);
    apiFetch(`/api/equipment/${item.id}/history`)
      .then(r => r.ok ? r.json() : [])
      .then(setHistory).catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [showHistory, item?.id]);

  // Init formulaire à l'ouverture / changement d'équipement édité — doit rester
  // AVANT le retour anticipé du panneau Historique ci-dessous : sinon React
  // saute cet appel de hook dès que showHistory passe à true ("Rendered fewer
  // hooks than expected"), puisque ce useEffect était initialement déclaré
  // après ce retour anticipé.
  useEffect(() => {
    if (!open) return;

    apiFetch("/api/config")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setSettings({
          categories: (data.categories || []).map((c: any) => ({ id: c.id, label: c.label, icon: "Box" })),
          zones:      (data.zones     || []).map((z: any) => ({ id: z.id, label: z.name })),
          stations:   (data.stations  || []).map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
          roles: [],
        });
      })
      .catch(console.error);

    if (item) {
      setCategoryId((item as any).category_id  || "");
      setCategoryLabel((item as any).category_label || "");
      // En mode édition : name = designation si elle existe dans les details, sinon le name de la table
      setName((item as any).details?.designation || item.name || "");
      setStatus(item.status || "fonctionnel");
      setZoneId((item as any).zone_id    || "");
      setStationId((item as any).station_id || "");
      // S'assurer que details est bien un objet (jamais null/undefined)
      const rawDetails = item.details && typeof item.details === "object" ? { ...item.details } : {};
      setDetails(rawDetails);
      // Capturer le nb d'interventions déjà sauvegardées (elles ne pourront plus être supprimées)
      try {
        const raw = rawDetails["interventions"];
        const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
        savedInterventionsCount.current = Array.isArray(parsed) ? parsed.length : 0;
      } catch { savedInterventionsCount.current = 0; }
      setStep("info");
    } else {
      setCategoryId(defaultCategoryId || "");
      setCategoryLabel("");
      setName("");
      setStatus("fonctionnel");
      setZoneId("");
      setStationId("");
      setDetails({});
      savedInterventionsCount.current = 0;
      setStep(defaultCategoryId ? "info" : "category");
    }

    setShowDeleteConfirm(false);
  }, [item, open]);

  const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
    entree:      { label: "Entrée",      color: "bg-emerald-100 text-emerald-700" },
    sortie:      { label: "Sortie",      color: "bg-red-100 text-red-700" },
    transfert:   { label: "Transfert",   color: "bg-blue-100 text-blue-700" },
    retour:      { label: "Retour",      color: "bg-amber-100 text-amber-700" },
    ajustement:  { label: "Ajustement",  color: "bg-slate-100 text-slate-700" },
    deploiement: { label: "Déploiement", color: "bg-purple-100 text-purple-700" },
  };

  const qrUrl = item?.id
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(window.location.origin + "/?equipment=" + item.id)}`
    : "";

  // ── Panneau historique ─────────────────────────────────
  if (showHistory && item) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-black text-white">Historique — {item.name}</DialogTitle>
                <DialogDescription className="text-slate-400 text-xs mt-0.5">Tous les mouvements enregistrés</DialogDescription>
              </div>
              <button onClick={() => setShowHistory(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"><X size={18}/></button>
            </div>
          </div>
          <div className="p-5 max-h-[500px] overflow-y-auto">
            {historyLoading ? (
              <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-slate-400"/></div>
            ) : history.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-10">Aucun mouvement enregistré</p>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-100 dark:bg-slate-700"/>
                <div className="space-y-4 pl-10">
                  {history.map((h) => {
                    const lbl = MOVEMENT_LABELS[h.type] || { label: h.type, color: "bg-slate-100 text-slate-700" };
                    return (
                      <div key={h.id} className="relative">
                        <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600"/>
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${lbl.color}`}>{lbl.label}</span>
                            {h.status === "pending" && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">En attente d'approbation</span>
                            )}
                            {h.status === "rejected" && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-700">Rejeté</span>
                            )}
                            <span className="text-[10px] text-slate-400 ml-auto">
                              {new Date(h.created_at).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                            {h.from_zone_name && <div><span className="text-slate-400">De :</span> {h.from_zone_name}{h.from_station_name ? ` / ${h.from_station_name}` : ""}</div>}
                            {h.to_zone_name   && <div><span className="text-slate-400">Vers :</span> {h.to_zone_name}{h.to_station_name ? ` / ${h.to_station_name}` : ""}</div>}
                            {h.previous_status && h.new_status && h.previous_status !== h.new_status && (
                              <div><span className="text-slate-400">Statut :</span> {h.previous_status} → <strong>{h.new_status}</strong></div>
                            )}
                            {h.performed_by_name && <div><span className="text-slate-400">Par :</span> {h.performed_by_name}</div>}
                            {h.note && <div className="mt-1 italic text-slate-500">"{h.note}"</div>}
                            {h.status === "rejected" && h.decision_note && (
                              <div className="mt-1 italic text-red-500">Motif du rejet : « {h.decision_note} »</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Panneau QR code ────────────────────────────────────
  if (showQR && item) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[400px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-black text-white">QR Code</DialogTitle>
                <DialogDescription className="text-slate-400 text-xs mt-0.5">Scannez pour accéder à {item.name}</DialogDescription>
              </div>
              <button onClick={() => setShowQR(false)} className="p-1.5 hover:bg-white/10 rounded-lg"><X size={18}/></button>
            </div>
          </div>
          <div className="p-8 flex flex-col items-center gap-4">
            <div className="bg-white border-4 border-slate-900 rounded-xl p-2">
              <img src={qrUrl} alt={`QR ${item.name}`} className="w-48 h-48"
                onError={(e) => { (e.target as HTMLImageElement).alt = "QR indisponible"; }}/>
            </div>
            <div className="text-center">
              <p className="font-black text-slate-800 dark:text-slate-200 text-sm">{item.name}</p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">{item.id?.substring(0, 24)}…</p>
            </div>
            <button onClick={() => window.print()}
              className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors">
              🖨️ Imprimer l'étiquette
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function formatIntervDate(date: string, annee?: string): string {
    if (!date) return "";
    const d = date.trim();
    if (/^\d{4}-\d{2}$/.test(d)) {
      const dt = new Date(d + "-02");
      if (!isNaN(dt.getTime()))
        return dt.toLocaleDateString("fr-FR", { year: "numeric", month: "long" });
    }
    if (/[a-zA-ZÀ-ÿ]/.test(d) && /\d/.test(d)) return d;
    if (/^[a-zA-ZÀ-ÿ]+$/.test(d)) return annee ? `${d} ${annee}` : d;
    return d;
  }

  function getInterventions(): { date: string; description: string; annee?: string }[] {
    try {
      const raw = details["interventions"];
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      if (details["date_intervention"] || details["types_interventions"]) {
        return [{
          date:        String(details["date_intervention"] || ""),
          annee:       String(details["annee"] || details["année"] || ""),
          description: String(details["types_interventions"] || details["statut_intervention"] || ""),
        }];
      }
      return [];
    } catch { return []; }
  }

  function addIntervention() {
    if (!newIntervDate || !newIntervDesc.trim()) return;
    const raw = details["interventions"];
    const current: { date: string; description: string }[] = raw
      ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []))
      : [];
    const updated = [...current, { date: newIntervDate, description: newIntervDesc.trim() }]
      .sort((a, b) => a.date.localeCompare(b.date));
    setDetail("interventions", JSON.stringify(updated));
    setNewIntervDate("");
    setNewIntervDesc("");
  }

  function removeIntervention(idx: number) {
    const current = getInterventions();
    const updated = current.filter((_, i) => i !== idx);
    setDetail("interventions", updated.length ? JSON.stringify(updated) : "");
  }

  function printRapportInterventions() {
    const ivs     = getInterventions();
    const immat   = details["immatriculation"]  || item?.name || "—";
    const chassis = details["numero_chassis"]   || "—";
    const marque  = details["marque"]           || "—";
    const typeVeh = details["type_vehicule"]    || "—";
    const annee   = details["annee"]            || "—";
    const km      = details["kilometrage"] ? `${details["kilometrage"]} km` : "—";
    const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

    const rows = ivs.map((iv, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td><strong>${formatIntervDate(iv.date, iv.annee)}</strong></td>
        <td>${iv.description}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport d'interventions — ${immat}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #1e293b; font-size: 11px; background: #fff; padding: 1.5cm 1.8cm; }
    @page { size: A4; margin: 0; }

    /* ── En-tête officielle ── */
    .header-official {
      display: grid;
      grid-template-columns: 1fr 110px 1fr;
      align-items: center;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 2.5px solid #f39c12;
      margin-bottom: 14px;
    }
    .header-fr { text-align: center; line-height: 1.6; }
    .header-en { text-align: center; line-height: 1.6; }
    .header-logo { text-align: center; }
    .header-logo img { width: 100px; height: 100px; object-fit: contain; }
    .header-fr p, .header-en p { font-size: 7.5px; font-weight: bold; color: #1a252f; }
    .header-fr .stars, .header-en .stars { font-size: 6px; color: #94a3b8; font-weight: normal; }
    .header-fr .main, .header-en .main { font-size: 9.5px; font-weight: 900; color: #1a252f; }
    .header-fr .sub-info { font-size: 7px; font-style: italic; margin-top: 6px; color: #555; }
    .header-en .sub-info { font-size: 7px; font-style: italic; margin-top: 6px; color: #555; }

    /* ── Titre du document ── */
    .doc-title { text-align: center; margin: 12px 0 4px; }
    .doc-title h1 { font-size: 14px; font-weight: 900; text-transform: uppercase; color: #1a252f; letter-spacing: 1px; }
    .doc-title p  { font-size: 9px; color: #64748b; margin-top: 2px; }
    .orange-line  { border: none; border-top: 2px solid #f39c12; margin: 10px 0; }

    /* ── Fiche véhicule ── */
    .section-title {
      font-size: 9px; font-weight: 900; text-transform: uppercase;
      letter-spacing: 1.5px; color: #0d1b2a;
      border-left: 3px solid #f39c12;
      padding-left: 8px; margin: 18px 0 8px;
    }
    .veh-grid {
      display: grid; grid-template-columns: 1fr 1fr 1fr;
      gap: 6px 16px; background: #f8fafc;
      border: 1px solid #e2e8f0; border-radius: 6px;
      padding: 12px; margin-bottom: 14px;
    }
    .lbl { font-size: 8px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; }
    .val { font-size: 11px; font-weight: 600; color: #1a252f; margin-top: 1px; }

    /* ── Tableaux ── */
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
    thead tr { background: #0d1b2a; }
    thead th {
      color: white; padding: 7px 8px; text-align: left;
      font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.8px;
      border-bottom: 2px solid #f39c12;
    }
    tbody td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    tbody tr:nth-child(even) { background: #f8fafc; }

    /* ── Signatures ── */
    .signatures {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 40px; margin-top: 36px; padding-top: 16px;
      border-top: 1px solid #e2e8f0;
    }
    .sig-block { text-align: center; }
    .sig-title { font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; color: #1a252f; margin-bottom: 40px; }
    .sig-line { border-top: 1px solid #94a3b8; margin: 0 20px; padding-top: 4px; font-size: 7.5px; color: #94a3b8; }

    /* ── Footer ── */
    .doc-footer {
      margin-top: 24px; padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 7px; color: #94a3b8;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- ══ EN-TÊTE OFFICIELLE ══ -->
  <div class="header-official">
    <div class="header-fr">
      <p>REPUBLIQUE DU CAMEROUN</p>
      <p class="stars">************</p>
      <p style="font-style:italic">Paix – Travail – Patrie</p>
      <p class="stars">************</p>
      <p>PRESIDENCE DE LA REPUBLIQUE</p>
      <p class="stars">************</p>
      <p>SERVICES DU CONSEILLER TECHNIQUE</p>
      <p class="stars">************</p>
      <p class="main">PROJET HELIOS</p>
      <p class="stars">************</p>
      <p class="sub-info">Yaoundé, le ${dateStr}</p>
    </div>
    <div class="header-logo">
      <img src="/logo.png" alt="Logo HELIOS" />
    </div>
    <div class="header-en">
      <p>REPUBLIC OF CAMEROON</p>
      <p class="stars">************</p>
      <p style="font-style:italic">Peace – Work – Fatherland</p>
      <p class="stars">************</p>
      <p>PRESIDENCY OF THE REPUBLIC</p>
      <p class="stars">************</p>
      <p>TECHNICAL ADVISOR SERVICES</p>
      <p class="stars">************</p>
      <p class="main">HELIOS PROJECT</p>
      <p class="stars">************</p>
      <p class="sub-info">N° ______/SCT/PRC/HELIOS</p>
    </div>
  </div>

  <!-- ══ TITRE DOCUMENT ══ -->
  <div class="doc-title">
    <h1>Rapport d'interventions véhicule</h1>
    <p>Véhicule : ${immat} — ${ivs.length} intervention${ivs.length !== 1 ? "s" : ""} enregistrée${ivs.length !== 1 ? "s" : ""} — au ${dateStr}</p>
  </div>
  <hr class="orange-line" />

  <!-- ══ FICHE VÉHICULE ══ -->
  <div class="section-title">Identification du véhicule</div>
  <div class="veh-grid">
    <div><div class="lbl">Immatriculation</div><div class="val">${immat}</div></div>
    <div><div class="lbl">N° Châssis</div><div class="val">${chassis}</div></div>
    <div><div class="lbl">Marque</div><div class="val">${marque}</div></div>
    <div><div class="lbl">Type de véhicule</div><div class="val">${typeVeh}</div></div>
    <div><div class="lbl">Année</div><div class="val">${annee}</div></div>
    <div><div class="lbl">Kilométrage</div><div class="val">${km}</div></div>
  </div>

  <!-- ══ TABLEAU INTERVENTIONS ══ -->
  <div class="section-title">Historique des interventions (${ivs.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;text-align:center;">#</th>
        <th style="width:140px;">Date</th>
        <th>Description / Nature de l'intervention</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="3" style="padding:16px;text-align:center;color:#9ca3af;font-style:italic;">Aucune intervention enregistrée</td></tr>'}
    </tbody>
  </table>

  <!-- ══ SIGNATURES ══ -->
  <div class="signatures">
    <div class="sig-block">
      <div class="sig-title">Le Responsable Logistique</div>
      <div class="sig-line">Signature &amp; Cachet</div>
    </div>
    <div class="sig-block">
      <div class="sig-title">Le Chef Suivi Projet HELIOS</div>
      <div class="sig-line">Signature &amp; Cachet</div>
    </div>
  </div>


</body>
</html>`;

    const w = window.open("", "_blank", "width=820,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 800);
  }

  const isReadOnly = activeRole === "csph" || activeRole === "chef_service_administratif";
  const canDelete  = ["admin", "agent_logistique"].includes(activeRole);
  // chef_ram n'ajoute que des véhicules neufs : ni changement de catégorie,
  // ni saisie d'historique d'interventions à la création.
  const hideForChefRamCreate = activeRole === "chef_ram" && !item;

  const selectedCategory = settings?.categories.find(c => c.id === categoryId);
  // ✅ FIX : categoryLabel (state) est rempli immédiatement à l'ouverture du dialog
  // sans attendre le chargement async de settings → les champs dynamiques s'affichent tout de suite
  const categoryLabelForFields =
    selectedCategory?.label ||
    categoryLabel ||
    "";
  const dynamicFields            = categoryLabelForFields ? getDynamicFields(categoryLabelForFields) : [];
  const serialField              = dynamicFields.find(f => f.isSerial);
  const useSerialAsName          = !!serialField;
  const selectedStatus           = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];

  const isToolCategory     = /outillage|outil|outils/.test(categoryLabelForFields.toLowerCase());
  const isToolCable        = isToolCategory && /cable|câble|cordon|fil/i.test(String(details.designation || details.modele || details.observation || ""));
  const isCuisineCategory      = /cuisine|ameublement|mobilier|meuble|frigo|réfrigér|refriger/.test(categoryLabelForFields.toLowerCase());
  const isExploitationCategory = /exploitation|matériel d|materiel d/.test(categoryLabelForFields.toLowerCase());
  const isGroupeCategory       = /groupe|générateur|generateur|electro|énergie|energie|ups|onduleur/.test(categoryLabelForFields.toLowerCase());
  const isArmementCategory     = /armement|arme|armes/.test(categoryLabelForFields.toLowerCase());

  const setDetail = (key: string, value: any) => {
    setDetails(prev => ({ ...prev, [key]: value }));
    if (serialField?.key === key && useSerialAsName) {
      setName(value);
    }
  };

  const handleNextStep = () => {
    // Pour cuisine : le N° inventaire est auto-généré, pas besoin de le valider
    if (isCuisineCategory) {
      document.getElementById("equipment-form-submit")?.click();
      return;
    }
    const serialValue = serialField ? details[serialField.key]?.toString().trim() : "";
    if (useSerialAsName && !serialValue) {
      toast.error(`"${serialField?.label}" est obligatoire`);
      return;
    }
    if (!useSerialAsName && !name.trim()) {
      toast.error("La désignation est obligatoire");
      return;
    }
    document.getElementById("equipment-form-submit")?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Pour cuisine : générer le N° inventaire AVANT de calculer finalName
    // car le champ est grisé (vide) et le nom dépend de ce numéro
    if (isCuisineCategory && !item?.id) {
      const generated = generateInventoryNumber(categoryLabelForFields, details);
      setDetail("numero_inventaire", generated);
      details["numero_inventaire"] = generated; // màj locale immédiate pour la suite
    }

    const serialValue = serialField ? (details[serialField.key]?.toString().trim() || "") : "";

    // Pour armement : le name principal = designation, le serial reste juste dans details
    // Pour les autres catégories avec serial (outillage, etc.) : le serial EST le name
    const finalName = isArmementCategory
      ? (details.designation?.toString().trim() || name.trim() || serialValue)
      : useSerialAsName
        ? (serialValue || name.trim())
        : (name.trim() || details.designation?.toString().trim() || "");

    if (!finalName)  { toast.error("L'identifiant principal ou la désignation est obligatoire"); return; }
    if (!categoryId) { toast.error("La catégorie est obligatoire"); return; }

    setLoading(true);
    try {
      const cleanDetails = Object.fromEntries(
        Object.entries({
          ...details,
          // Si useSerialAsName et qu'on a un champ name en plus du serial, le stocker comme designation
          ...(useSerialAsName && name.trim() && !details.designation ? { designation: name.trim() } : {}),
        }).filter(([, v]) => v !== "" && v !== null && v !== undefined)
      );

      const autoInventoryCategories = ["outillage", "outil", "outils", "cuisine"];
      const categoryIsAutoInventory = autoInventoryCategories.some(k => categoryLabelForFields.toLowerCase().includes(k));
      if (categoryIsAutoInventory && !cleanDetails.numero_inventaire) {
        cleanDetails.numero_inventaire = generateInventoryNumber(categoryLabelForFields, cleanDetails);
      }

      // Pour la catégorie Cuisine : position fixe "CUISINE" + N° inventaire toujours auto-généré à la création
      if (isCuisineCategory) {
        cleanDetails.position = "CUISINE";
        if (!item?.id) {
          // Toujours générer un nouveau numéro à la création
          cleanDetails.numero_inventaire = generateInventoryNumber(categoryLabelForFields, cleanDetails);
        }
      }

      const payload = {
        name: finalName,
        category:    categoryLabelForFields,
        category_id: categoryId,
        zone_id:     zoneId    || undefined,
        station_id:  stationId || undefined,
        status,
        details: cleanDetails,
      };

      const res = await apiFetch(
        item?.id ? `/api/equipment/${item.id}` : "/api/equipment",
        {
          method: item?.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (res.ok) {
        toast.success(item?.id ? "Équipement mis à jour !" : "Équipement enregistré !");
        onOpenChange(false);
      } else {
        const err = await res.json();
        const detail = Array.isArray(err.details)
          ? err.details.map((d: any) => `${d.path?.join('.') || '?'}: ${d.message}`).join(' | ')
          : "";
        throw new Error(detail || err.error || "Erreur serveur");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!item?.id) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/equipment/${item.id}`, {
        method: "DELETE",
      });
      if (res.ok) { toast.success("Équipement supprimé"); onOpenChange(false); }
      else { const e = await res.json(); throw new Error(e.error); }
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const nameFieldLabel       = useSerialAsName ? "Désignation complémentaire" : "Désignation / Nom";
  const nameFieldPlaceholder = useSerialAsName
    ? "Ex: Bus ligne 12, Climatiseur salle de réunion... (optionnel)"
    : "Ex: Climatiseur Bureau 3, Bureau directeur...";

  // ── Render ─────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        ✅ CORRIGÉ : max-w-[560px] → max-w-[760px]
        Le formulaire avait trop peu d'espace, labels coupés, grille écrasée.
        760px permet une grille 2 colonnes confortable + padding généreux.
      */}
      <DialogContent className="sm:max-w-[760px] w-full p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">

        {/* HEADER */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white px-8 py-6 pb-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <DialogTitle className="text-lg font-black tracking-tight text-white">
                {item ? "Modifier l'équipement" : "Nouvel équipement"}
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs mt-0.5">
                {item
                  ? `Réf: ${item.id?.substring(0, 16).toUpperCase()}`
                  : "Renseignez les informations de l'actif logistique"}
              </DialogDescription>
            </div>
            {selectedCategory && (
              <div className="text-3xl">{getCategoryIcon(selectedCategory.label)}</div>
            )}
          </div>

          {!item && (
            <div className="flex items-center gap-1 mt-3">
              {STEPS.map((s, i) => {
                const done   = i < stepIndex;
                const active = step === s.id;
                return (
                  <React.Fragment key={s.id}>
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                      active ? "bg-white text-slate-900" :
                      done   ? "bg-emerald-500/20 text-emerald-400" :
                               "bg-white/10 text-slate-400"
                    }`}>
                      {done ? <CheckCircle2 size={11} /> : s.icon}
                      {s.label}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={`flex-1 h-px ${done ? "bg-emerald-500/40" : "bg-white/10"}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* CONFIRMATION SUPPRESSION */}
        {showDeleteConfirm ? (
          <div className="p-8 flex flex-col items-center text-center gap-5 bg-white dark:bg-slate-900">
            <div className="w-14 h-14 bg-red-100 dark:bg-red-950 text-red-600 rounded-full flex items-center justify-center">
              <Trash2 size={26} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-slate-100">Supprimer "{name}" ?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Cette action est <strong>irréversible</strong> et supprimera définitivement cet actif.
              </p>
            </div>
            <div className="flex gap-3 w-full max-w-sm">
              <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setShowDeleteConfirm(false)}>
                Annuler
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmer la suppression"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* ZONE SCROLLABLE */}
            <div className="px-8 py-6 min-h-[340px] max-h-[65vh] overflow-y-auto">

              {/* ÉTAPE 1 — CATÉGORIE */}
              {step === "category" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-300">
                  <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                    Sélectionnez le type d'équipement
                  </p>
                  {!settings ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
                    </div>
                  ) : settings.categories.length === 0 ? (
                    <div className="text-center py-10 text-sm text-slate-400 italic">
                      Aucune catégorie configurée.<br />
                      <span className="text-xs">Allez dans Admin → Logique Métier</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {settings.categories.map(cat => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => { setCategoryId(cat.id); setCategoryLabel(cat.label); setStep("info"); }}
                          className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98] ${
                            categoryId === cat.id
                              ? "border-slate-900 dark:border-slate-400 bg-slate-50 dark:bg-slate-800 shadow-md"
                              : "border-slate-200 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-800/50"
                          }`}
                        >
                          <div className="text-2xl mb-2 transition-transform group-hover:scale-110 duration-200">
                            {getCategoryIcon(cat.label)}
                          </div>
                          <p className="text-sm font-black text-slate-800 dark:text-slate-200 leading-tight">{cat.label}</p>
                          {categoryId === cat.id && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-slate-900 dark:bg-slate-400 rounded-full flex items-center justify-center">
                              <CheckCircle2 size={12} className="text-white dark:text-slate-900" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ÉTAPE 2 — INFORMATIONS */}
              {step === "info" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-300">

                  {/* Badge catégorie */}
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                    <span className="text-xl">{selectedCategory ? getCategoryIcon(selectedCategory.label) : "📦"}</span>
                    <span className="text-sm font-black text-slate-700 dark:text-slate-200">{selectedCategory?.label}</span>
                    {!item && !hideForChefRamCreate && (
                      <button
                        type="button"
                        onClick={() => setStep("category")}
                        className="ml-auto text-[11px] font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline transition-colors"
                      >
                        Changer
                      </button>
                    )}
                  </div>

                  {/* Statut — masqué pour Cuisine et Matériel d'exploitation */}
                  {!isCuisineCategory && !isExploitationCategory && (
                  <div className="space-y-2">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      État opérationnel <span className="text-red-400">*</span>
                    </Label>
                    <div className="grid grid-cols-3 gap-3">
                      {STATUS_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setStatus(opt.value as EquipmentStatus)}
                          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-xs font-black transition-all duration-150 ${
                            status === opt.value
                              ? `${opt.light} border-current shadow-sm`
                              : "border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-600"
                          }`}
                        >
                          <div className={`w-2.5 h-2.5 rounded-full ${status === opt.value ? opt.color : "bg-slate-300 dark:bg-slate-600"}`} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  )}

                  {/* Champs dynamiques */}
                  {dynamicFields.length > 0 && (
                    <div className="space-y-4">
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                        <ClipboardList size={11} />
                        Spécifications — {selectedCategory?.label}
                      </p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        {(() => {
                          const visibleFields = dynamicFields.filter(field => {
                            if (field.key === "date_sortie") {
                              const pos = details["position"] || "";
                              return pos !== "" && pos !== "Magasin" && pos !== "Bureau Logistique";
                            }
                            return true;
                          });
                          return visibleFields.map((field, idx) => {
                            const showSection = field.section &&
                              visibleFields.findIndex(f => f.section === field.section) === idx;
                            const fieldOptions = field.key === "type_sortie" && isToolCategory
                              ? (isToolCable ? field.options ?? [] : ["Emprunt temporaire"])
                              : field.options;

                            return (
                              <React.Fragment key={field.key}>
                                {showSection && (
                                  <div className="col-span-2 pt-2 border-t border-slate-100 dark:border-slate-800 first:border-0 first:pt-0">
                                    <p className="text-[9px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-[2px]">
                                      {field.section}
                                    </p>
                                  </div>
                                )}
                                <div className={`space-y-1.5 ${field.fullWidth || field.isSerial ? "col-span-2" : ""}`}>
                                  <Label className={`text-[11px] font-bold flex items-center gap-1 ${
                                    field.isSerial
                                      ? "text-slate-800 dark:text-slate-200"
                                      : "text-slate-500 dark:text-slate-400"
                                  }`}>
                                    {field.label}
                                    {(field.isSerial || field.required) && <span className="text-red-400">*</span>}
                                  </Label>

                                  {field.type === "select" && (
                                    <div className="space-y-2">
                                      <Select
                                        value={details[field.key] || ""}
                                        onValueChange={v => setDetail(field.key, v)}
                                        disabled={isReadOnly}
                                      >
                                        <SelectTrigger className="h-10 text-sm border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 focus:border-slate-700">
                                          <SelectValue placeholder="Choisir..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {fieldOptions?.map(opt => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {field.showOtherInput && details[field.key] === "Autre" && (
                                        <Input
                                          type="text"
                                          placeholder="Précisez le type d'équipement..."
                                          value={details[`${field.key}_autre`] || ""}
                                          onChange={e => setDetail(`${field.key}_autre`, e.target.value)}
                                          className="h-10 text-sm border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 focus:border-slate-700"
                                          readOnly={isReadOnly}
                                          autoFocus
                                        />
                                      )}
                                    </div>
                                  )}

                                  {field.type === "textarea" && (
                                    <textarea
                                      placeholder={field.placeholder}
                                      value={details[field.key] || ""}
                                      onChange={e => setDetail(field.key, e.target.value)}
                                      rows={3}
                                      className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 focus:border-slate-700 dark:focus:border-slate-500 rounded-lg px-3 py-2 resize-none outline-none focus:ring-2 focus:ring-slate-200 dark:focus:ring-slate-700 transition-all"
                                      readOnly={isReadOnly}
                                    />
                                  )}

                                  {field.type !== "select" && field.type !== "textarea" && (
                                    <Input
                                      type={field.type}
                                      placeholder={field.placeholder}
                                      value={details[field.key] || ""}
                                      onChange={e => setDetail(field.key, e.target.value)}
                                      className={`text-sm border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 focus:border-slate-700 dark:focus:border-slate-500 ${
                                        field.isSerial
                                          ? "h-11 font-mono text-base border-slate-400 dark:border-slate-500 focus:border-slate-900 bg-slate-50 dark:bg-slate-700 font-bold"
                                          : "h-10"
                                      } ${
                                        isCuisineCategory && field.key === "numero_inventaire"
                                          ? "bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-500 cursor-not-allowed border-slate-200"
                                          : ""
                                      }`}
                                      readOnly={isReadOnly || (isCuisineCategory && field.key === "numero_inventaire")}
                                      autoFocus={field.isSerial && idx === 0 && !isCuisineCategory}
                                    />
                                  )}

                                  {field.isSerial && details[field.key] && (
                                    <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                                      <CheckCircle2 size={10} />
                                      Utilisé comme identifiant principal
                                    </p>
                                  )}
                                  {isCuisineCategory && field.key === "numero_inventaire" && (
                                    <p className="text-[10px] text-slate-400 italic">
                                      Généré automatiquement à l'enregistrement
                                    </p>
                                  )}
                                </div>
                              </React.Fragment>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Historique des interventions */}
                  {!hideForChefRamCreate && (getInterventions().length > 0 || (
                    !isReadOnly &&
                    (categoryLabelForFields.toLowerCase().match(/rame|véhicule|vehicule|voiture|camion|transport/))
                  )) && (
                    <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          🔧 Historique des interventions ({getInterventions().length})
                        </p>
                        {getInterventions().length > 0 && (
                          <button
                            type="button"
                            onClick={printRapportInterventions}
                            className="text-[10px] font-black text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-2.5 py-1 transition-all flex items-center gap-1"
                          >
                            🖨️ Rapport
                          </button>
                        )}
                      </div>
                      {getInterventions().length === 0 && (
                        <p className="text-xs text-slate-400 italic">Aucune intervention enregistrée.</p>
                      )}
                      {getInterventions().length > 0 && (
                        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                          {getInterventions().map((iv, idx) => (
                            <div key={idx} className="flex items-start gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black text-blue-600 dark:text-blue-400">
                                  📅 {formatIntervDate(iv.date, iv.annee)}
                                </p>
                                <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 leading-snug">{iv.description}</p>
                              </div>
                              {!isReadOnly && idx >= savedInterventionsCount.current && (
                                <button
                                  type="button"
                                  onClick={() => removeIntervention(idx)}
                                  className="shrink-0 text-red-400 hover:text-red-600 text-xs font-black px-1 mt-0.5"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {!isReadOnly && categoryLabelForFields.toLowerCase().match(/rame|véhicule|vehicule|voiture|camion|transport/) && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-xl p-4 space-y-3">
                          <p className="text-[10px] font-black text-blue-700 dark:text-blue-400 uppercase tracking-widest">+ Nouvelle intervention</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Mois / Année</Label>
                              <input
                                type="month"
                                value={newIntervDate}
                                onChange={e => setNewIntervDate(e.target.value)}
                                className="w-full h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900 bg-white"
                              />
                            </div>
                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={addIntervention}
                                disabled={!newIntervDate || !newIntervDesc.trim()}
                                className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-black rounded-lg transition-all"
                              >
                                Ajouter
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Description</Label>
                            <textarea
                              placeholder="Ex: Vidange + filtres, 4 pneus neufs, révision 50 000 km..."
                              value={newIntervDesc}
                              onChange={e => setNewIntervDesc(e.target.value)}
                              rows={2}
                              className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900 bg-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="px-8 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex items-center gap-3">
              {item && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowHistory(true)}
                  disabled={loading}
                  className="text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 font-bold text-xs shrink-0"
                >
                  <History size={13} className="mr-1" />
                  Historique
                </Button>
              )}
              {item && !isReadOnly && canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={loading}
                  className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 font-bold text-xs shrink-0"
                >
                  <Trash2 size={13} className="mr-1" />
                  Supprimer
                </Button>
              )}


              <div className="flex gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (step === "info" && !item && !hideForChefRamCreate) setStep("category");
                    else onOpenChange(false);
                  }}
                  disabled={loading}
                  className="font-bold text-xs border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {step === "info" && !item && !hideForChefRamCreate
                    ? <><ChevronLeft size={13} className="mr-1" />Retour</>
                    : isReadOnly ? "Fermer" : "Annuler"}
                </Button>

                {!isReadOnly && step === "info" && (
                  <Button
                    id="equipment-form-submit"
                    type="submit"
                    disabled={loading}
                    className="bg-brand-orange hover:bg-[#e66000] text-white font-black px-8 h-10 text-xs uppercase tracking-wider shadow-md transition-all active:scale-95 border-none min-w-[160px]"
                  >
                    {loading
                      ? <Loader2 size={15} className="animate-spin mr-2" />
                      : <Save className="w-4 h-4 mr-2" />}
                    {item ? "METTRE À JOUR" : "ENREGISTRER"}
                  </Button>
                )}
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}