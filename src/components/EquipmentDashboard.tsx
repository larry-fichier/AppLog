import { useState, useEffect } from "react";
import { 
  Plus, Search, Car, Utensils, Laptop, Zap, 
  Loader2, Wrench, CheckCircle2, XCircle, 
  Filter, FileText, Database, ShieldAlert,
  Archive, RefreshCw, Box
} from "lucide-react";
import { db, onSnapshot, collection, query, orderBy, OperationType, handleFirestoreError, addDoc, auth, doc, getDoc } from "@/lib/firebase";
import { Equipment, EquipmentCategory, GlobalSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EquipmentDialog } from "./EquipmentDialog";
import { toast } from "sonner";

const categoryIcons = {
  rame: <Car className="w-5 h-5" />,
  cuisine: <Utensils className="w-5 h-5" />,
  electronique: <Laptop className="w-5 h-5" />,
  groupe: <Zap className="w-5 h-5" />
};

const categoryLabels = {
  all: "Tous les actifs",
  rame: "Véhicules (Rames)",
  cuisine: "Équipement Cuisine",
  electronique: "Électronique & IT",
  groupe: "Groupes Électrogènes"
};

const statusConfig = {
  fonctionnel: { label: "Fonctionnel", color: "text-success bg-success/10 border-success/20", icon: <CheckCircle2 className="w-3 h-3 mr-1" /> },
  en_reparation: { label: "En réparation", color: "text-warning bg-warning/10 border-warning/20", icon: <Wrench className="w-3 h-3 mr-1" /> },
  hors_service: { label: "Hors service", color: "text-red-600 bg-red-50 border-red-100", icon: <XCircle className="w-3 h-3 mr-1" /> }
};

interface Props {
  defaultCategory?: string;
  activeRole?: "csph" | "chef_service_administratif" | "agent_logistique" | "chef_bureau_logistique" | "admin";
  isBypass?: boolean;
}

export function EquipmentDashboard({ 
  defaultCategory = "all", 
  activeRole = "agent_logistique",
  isBypass = false 
}: Props) {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(defaultCategory);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Equipment | undefined>(undefined);
  const [dynamicSettings, setDynamicSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setDynamicSettings({
            categories: data.categories || [],
            zones: (data.zones || []).map((z: any) => ({ id: z.id, label: z.name })),
            stations: (data.stations || []).map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
          } as any);
        }
      } catch (e) {
        console.error("Error fetching settings in dashboard", e);
      }
    }
    fetchSettings();
  }, []);

  useEffect(() => {
    setActiveCategory(defaultCategory);
  }, [defaultCategory]);

  useEffect(() => {
    async function fetchData() {
      const token = localStorage.getItem("helios_token");
      if (!token && !isBypass) return;
      
      setLoading(true);
      try {
        const idToken = isBypass ? "demo-token" : token;
        const userUid = isBypass ? "demo-admin-uid" : "";
        
        const response = await fetch("/api/equipment", {
          headers: {
            "x-user-uid": userUid,
            "Authorization": `Bearer ${idToken}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setEquipment(data);
        }
      } catch (e) {
        console.error("Fetch error", e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    // Refresh periodically or on focus
    const interval = setInterval(fetchData, 30000); // 30s refresh
    return () => clearInterval(interval);
  }, []);

  const filteredEquipment = equipment.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.details.serialNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.details.licensePlate?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.details.brand?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === "all" || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const getZoneLabel = (id?: string) => {
    if (!id) return "N/A";
    return dynamicSettings?.zones.find(z => z.id === id)?.label || id;
  };

  const getStationLabel = (id?: string) => {
    if (!id) return "N/A";
    return dynamicSettings?.stations.find(s => s.id === id)?.label || id;
  };

  const stats = {
    total: equipment.length,
    functional: equipment.filter(e => e.status === "fonctionnel").length,
    repair: equipment.filter(e => e.status === "en_reparation").length,
    offline: equipment.filter(e => e.status === "hors_service").length,
    categoryCounts: {
      rame: equipment.filter(e => e.category === "rame").length,
      cuisine: equipment.filter(e => e.category === "cuisine").length,
      electronique: equipment.filter(e => e.category === "electronique").length,
      groupe: equipment.filter(e => e.category === "groupe").length,
    } as Record<string, number>,
    avgMileage: activeCategory === "rame" ? Math.round(equipment.filter(e => e.category === "rame").reduce((acc, curr) => acc + (Number(curr.details?.mileage) || 0), 0) / (equipment.filter(e => e.category === "rame").length || 1)) : 0,
    activeRames: equipment.filter(e => e.category === "rame" && e.status === "fonctionnel").length
  };

  const getStatusConfig = (status: string) => {
    return statusConfig[status as keyof typeof statusConfig] || { 
      label: status || "Inconnu", 
      color: "text-zinc-500 bg-zinc-100 border-zinc-200", 
      icon: <Box className="w-3 h-3 mr-1" /> 
    };
  };

  const seedData = async () => {
    if (equipment.length > 0) return;
    setLoading(true);
    const mockData = [
      { 
        name: "Renault Master L3H2", 
        category: "rame", 
        status: "fonctionnel", 
        arrivalDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        location: { zone: "Zone 1", station: "Station Nord", service: "operation", office: "B-12" },
        details: { licensePlate: "AA-123-BC", mileage: 45000, brand: "Renault" }, 
        createdAt: new Date().toISOString() 
      },
      { 
        name: "Iveco Daily 35S18", 
        category: "rame", 
        status: "fonctionnel", 
        arrivalDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        location: { zone: "Zone 3", station: "Station Sud", service: "operation", office: "A-01" },
        details: { licensePlate: "FE-567-TY", mileage: 82000, brand: "Iveco" }, 
        createdAt: new Date().toISOString() 
      },
      { 
        name: "Groupe Perkins 150kVA", 
        category: "groupe", 
        status: "en_reparation", 
        location: { zone: "Zone 15", station: "Station Centrale", service: "operation", office: "Zone technique" },
        details: { power: "150", operatingHours: 1200 }, 
        createdAt: new Date().toISOString() 
      },
      { 
        name: "Laptop Dell Precision 7550", 
        category: "electronique", 
        status: "hors_service", 
        location: { zone: "Zone 2", station: "Siège Helios", service: "administratif", office: "DSI-Bureau 4" },
        details: { serialNumber: "DL-9988-X1", brand: "Dell" }, 
        createdAt: new Date().toISOString() 
      },
    ];

    try {
      const token = localStorage.getItem("helios_token");
      const idToken = isBypass ? "demo-token" : token;
      
      for (const item of mockData) {
        await fetch("/api/equipment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`
          },
          body: JSON.stringify({
            name: item.name,
            category_id: item.category,
            status: item.status,
            zone_id: "operation",
            station_id: null,
            details: item.details
          })
        });
      }
      toast.success("Inventaire de démonstration généré");
      window.location.reload();
    } catch (e) {
      toast.error("Erreur lors de la génération");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      {/* Dynamic Header & Breadcrumbs */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold text-accent uppercase tracking-[2px]">
            <Database size={12} />
            <span>Inventaire G-Logistique</span>
          </div>
          <h2 className="text-xl font-extrabold text-text-dark">
            {activeCategory === "all" ? "Vue Globale du Parc" : `Gestion : ${dynamicSettings?.categories.find(c => c.id === activeCategory)?.label || categoryLabels[activeCategory as keyof typeof categoryLabels] || activeCategory}`}
          </h2>
        </div>
        <div className="flex gap-2 text-xs">
          <Button variant="outline" size="sm" className="h-9 border-border-custom bg-white hover:bg-zinc-50" onClick={seedData} disabled={equipment.length > 0}>
             <RefreshCw className="mr-2 h-4 w-4" size={14} />
             Initialiser Inventaire
          </Button>
          <Button variant="outline" size="sm" className="h-9 border-border-custom bg-white hover:bg-zinc-50">
             <FileText className="mr-2 h-4 w-4" size={14} />
             Exporter Rapport
          </Button>
        </div>
      </div>

      {/* Stats Cockpit */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {activeCategory === "rame" ? (
          <>
            {[
              { label: "Véhicules Totaux", val: stats.categoryCounts.rame, sub: "Unités roulantes", color: "text-text-dark", icon: <Car /> },
              { label: "Opérationnels", val: stats.activeRames, sub: `${Math.round((stats.activeRames/stats.categoryCounts.rame || 0)*100)}% de disponibilité`, color: "text-success", icon: <CheckCircle2 /> },
              { label: "Kilométrage Moyen", val: stats.avgMileage, sub: "Kilomètres par unité", color: "text-accent", icon: <RefreshCw /> },
              { label: "Alertes Maintenance", val: stats.repair, sub: "Nécessite intervention", color: "text-red-500", icon: <ShieldAlert /> }
            ].map((s, i) => (
              <div key={i} className="bg-white p-5 rounded-lg border border-border-custom shadow-sm relative overflow-hidden group">
                <div className="relative z-10">
                  <div className="text-[10px] text-[#7f8c8d] uppercase mb-1 font-bold tracking-widest">{s.label}</div>
                  <div className={`text-3xl font-black ${s.color} transition-transform group-hover:scale-105 duration-300 origin-left`}>
                    {s.val}{s.label === "Kilométrage Moyen" && " km"}
                  </div>
                  <div className="text-[10px] text-[#95a5a6] mt-1 font-medium">{s.sub}</div>
                </div>
                <div className={`absolute right-[-10px] bottom-[-10px] opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-300 transform scale-[3.5] ${s.color}`}>
                  {s.icon}
                </div>
              </div>
            ))}
          </>
        ) : (
          [
            { label: "Unités Totales", val: stats.total, sub: "Actifs enregistrés", color: "text-text-dark", icon: <Database /> },
            { label: "Opérationnels", val: stats.functional, sub: `${Math.round((stats.functional/stats.total || 0)*100)}% de disponibilité`, color: "text-success", icon: <CheckCircle2 /> },
            { label: "En Maintenance", val: stats.repair, sub: "Actions en cours", color: "text-warning", icon: <Wrench /> },
            { label: "Indisponibles", val: stats.offline, sub: "Nécessite intervention", color: "text-red-500", icon: <ShieldAlert /> }
          ].map((s, i) => (
            <div key={i} className="bg-white p-5 rounded-lg border border-border-custom shadow-sm relative overflow-hidden group">
              <div className="relative z-10">
                <div className="text-[10px] text-[#7f8c8d] uppercase mb-1 font-bold tracking-widest">{s.label}</div>
                <div className={`text-3xl font-black ${s.color} transition-transform group-hover:scale-105 duration-300 origin-left`}>{s.val}</div>
                <div className="text-[10px] text-[#95a5a6] mt-1 font-medium">{s.sub}</div>
              </div>
              <div className={`absolute right-[-10px] bottom-[-10px] opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-300 transform scale-[3.5] ${s.color}`}>
                {s.icon}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Strategic Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 flex-1 min-h-0">
        {/* Navigation Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-border-custom shadow-sm overflow-hidden">
             <div className="px-5 py-4 bg-zinc-50 border-b border-border-custom flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[2.5px] text-text-dark/50">Segmentation</span>
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
             </div>
              <div className="p-3 flex flex-col gap-1.5">
                <button 
                  onClick={() => setActiveCategory("all")}
                  className={`group flex items-center justify-between px-3 py-2.5 rounded-md text-[13px] transition-all duration-300 border ${
                    activeCategory === "all" 
                    ? 'bg-brand-orange text-white border-brand-orange shadow-md' 
                    : 'hover:bg-zinc-50 text-text-dark/80 hover:text-text-dark border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={activeCategory === "all" ? 'text-white' : 'text-brand-orange'}>
                      <Archive size={16} />
                    </span>
                    <span className="font-bold">Vue Globale</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-sm font-black ${
                    activeCategory === "all" ? 'bg-white/10 text-white' : 'bg-zinc-100 text-[#7f8c8d]'
                  }`}>
                    {stats.total}
                  </span>
                </button>

                {(dynamicSettings?.categories || [
                  { id: "rame", label: "Véhicules", icon: "Car" },
                  { id: "cuisine", label: "Cuisine", icon: "Utensils" },
                  { id: "electronique", label: "Électronique", icon: "Laptop" },
                  { id: "groupe", label: "Énergie", icon: "Zap" }
                ]).map((cat) => (
                  <button 
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-md text-[13px] transition-all duration-300 border ${
                      activeCategory === cat.id 
                      ? 'bg-brand-orange text-white border-brand-orange shadow-md' 
                      : 'hover:bg-zinc-50 text-text-dark/80 hover:text-text-dark border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={activeCategory === cat.id ? 'text-white' : 'text-brand-orange'}>
                        {categoryIcons[cat.id as keyof typeof categoryIcons] || <Box size={16} />}
                      </span>
                      <span className="font-bold">{cat.label}</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-sm font-black ${
                      activeCategory === cat.id ? 'bg-white/10 text-white' : 'bg-zinc-100 text-[#7f8c8d]'
                    }`}>
                      {stats.categoryCounts[cat.id] || 0}
                    </span>
                  </button>
                ))}
              </div>
          </div>

          <div className="bg-white rounded-lg p-5 border border-border-custom shadow-sm flex flex-col gap-5 group hover:border-brand-orange/40 transition-colors duration-300">
             <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
                  <h4 className="font-black text-[13px] uppercase tracking-[2px] text-text-dark">Nouvelle Saisie</h4>
                </div>
                <p className="text-[11px] font-medium text-[#7f8c8d] leading-relaxed">Ajoutez une unité physique à l'inventaire logistique du parc avec une indexation immédiate.</p>
             </div>
             {(activeRole === "agent_logistique" || activeRole === "chef_bureau_logistique" || activeRole === "admin") ? (
               <Button 
                className="w-full bg-text-dark text-white hover:bg-brand-orange font-black h-11 border-none shadow-lg shadow-text-dark/10 transition-all duration-300 group-hover:-translate-y-0.5" 
                onClick={() => { setEditingItem(undefined); setIsDialogOpen(true); }}
               >
                  <Plus className="w-4 h-4 mr-2" />
                  DÉCLARER UN ACTIF
               </Button>
             ) : (
               <div className="text-[9px] font-black bg-zinc-50 p-3 rounded-lg border border-dashed border-border-custom text-center uppercase tracking-[2px] text-[#bdc3c7]">
                  Lecture seule : CSPH / CSA
               </div>
             )}
          </div>
        </div>

        {/* Data Engine Table */}
        <div className="bg-white rounded-lg border border-border-custom shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 bg-[#fafbfc] border-b border-border-custom flex justify-between items-center bg-gradient-to-r from-[#fafbfc] to-white">
            <div className="flex items-center gap-4">
               <div className="h-6 w-[2px] bg-accent" />
               <h3 className="font-bold text-text-dark text-[15px]">Registre d'Inventaire</h3>
            </div>
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#bdc3c7]" />
              <input
                placeholder="Chercher par nom, marque, série..."
                className="w-full pl-10 pr-4 h-10 text-[13px] bg-white border border-border-custom rounded-lg focus:ring-4 focus:ring-accent/10 focus:border-accent transition-all duration-300"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-white min-h-[500px]">
            <Table>
              <TableHeader className="bg-[#f8fafc] sticky top-0 z-20 shadow-sm">
                <TableRow className="hover:bg-transparent border-b border-border-custom">
                  <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Ressource / Identifiant</TableHead>
                  {activeCategory === "rame" ? (
                    <>
                      <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Immatriculation</TableHead>
                      <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Zone / Station</TableHead>
                      <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Kilométrage</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Informations Métier</TableHead>
                      <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Localisation</TableHead>
                    </>
                  )}
                  <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Disponibilité</TableHead>
                  <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6">Modifié le</TableHead>
                  <TableHead className="text-[11px] font-black text-[#636e72] uppercase tracking-[1.5px] h-12 px-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-12 h-12 animate-spin text-accent" />
                        <span className="text-[10px] font-bold tracking-[3px] uppercase text-[#bdc3c7]">Analyse des données...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredEquipment.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-64 text-center">
                       <div className="flex flex-col items-center gap-2 opacity-30">
                          <Archive size={48} strokeWidth={1} />
                          <p className="text-sm font-bold uppercase tracking-widest">Aucune donnée trouvée</p>
                       </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEquipment.map((item) => (
                    <TableRow 
                      key={item.id} 
                      className="group border-b border-[#f1f2f6] hover:bg-accent/[0.02] transition-colors cursor-pointer"
                      onClick={() => { setEditingItem(item); setIsDialogOpen(true); }}
                    >
                      <TableCell className="px-6 py-5">
                        <div className="flex items-center gap-4">
                           <div className={`w-10 h-10 rounded-lg flex items-center justify-center border border-border-custom transition-transform group-hover:scale-110 ${
                             item.status === 'fonctionnel' ? 'bg-success/5 text-success' : 'bg-red-50 text-red-500'
                           }`}>
                             {categoryIcons[item.category]}
                           </div>
                           <div className="flex flex-col">
                             <span className="font-black text-text-dark text-[14px] uppercase tracking-tight">{item.name}</span>
                             <span className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase opacity-60">ID-{item.id?.substring(0, 6)}</span>
                           </div>
                        </div>
                      </TableCell>
                      
                      {activeCategory === "rame" ? (
                        <>
                          <TableCell className="px-6 py-5">
                            <div className="flex flex-col">
                              <span className="text-[12px] font-black text-text-dark bg-[#f1f2f6] px-2 py-1 rounded w-fit mb-1">{item.details.licensePlate || "NON-IMMAT."}</span>
                              <span className="text-[10px] font-bold text-[#b2bec3] uppercase">{item.details.brand || "Marque inconnue"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-5">
                            <div className="flex flex-col">
                              <span className="text-[11px] font-black text-text-dark uppercase tracking-tight">Zone: {getZoneLabel(item.location?.service)}</span>
                              <span className="text-[10px] font-bold text-accent uppercase tracking-widest bg-accent/5 px-2 py-0.5 rounded w-fit mt-1">Station: {getStationLabel(item.location?.office)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-5">
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-text-dark">{item.details.mileage?.toLocaleString() || 0} <span className="text-[10px] text-muted-foreground">km</span></span>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="px-6 py-5">
                            <div className="space-y-1">
                              <div className="text-[12px] font-bold text-text-dark/80">
                                {item.category === "electronique" && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-[#f1f2f6] rounded">🔢 {item.details.serialNumber || "N/A"}</span>
                                    <span className="text-[10px] font-bold text-accent">{item.details.brand}</span>
                                  </div>
                                )}
                                {item.category === "groupe" && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-[#f1f2f6] rounded">⚡ {item.details.power} kVA</span>
                                  </div>
                                )}
                                {item.category === "cuisine" && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-[#f1f2f6] rounded">🍳 {item.details.capacity || "N/A"}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-5">
                            <div className="flex flex-col">
                               <span className="text-[11px] font-black text-text-dark uppercase tracking-tight">Zone: {getZoneLabel(item.location?.service)}</span>
                               <span className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1">St: {getStationLabel(item.location?.office)}</span>
                            </div>
                          </TableCell>
                        </>
                      )}

                      {activeCategory !== "rame" && (
                        <TableCell className="px-6 py-5">
                          <div className={`inline-flex items-center px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-[1.5px] border ${getStatusConfig(item.status).color}`}>
                            {getStatusConfig(item.status).icon}
                            {getStatusConfig(item.status).label}
                          </div>
                        </TableCell>
                      )}
                      
                      {activeCategory === "rame" && (
                        <TableCell className="px-6 py-5">
                          <div className={`inline-flex items-center px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-[1.5px] border ${getStatusConfig(item.status).color}`}>
                            {getStatusConfig(item.status).icon}
                            {getStatusConfig(item.status).label}
                          </div>
                        </TableCell>
                      )}

                      <TableCell className="px-6 py-5">
                        <div className="flex flex-col gap-1">
                          <div className="text-[11px] font-bold text-text-dark flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            {item.arrivalDate ? new Date(item.arrivalDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : "---"}
                          </div>
                          {item.departureDate && (
                            <div className="text-[10px] font-medium text-red-400 flex items-center gap-1">
                               <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                               {new Date(item.departureDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-5 text-right">
                        <Button variant="outline" size="sm" className="h-9 px-4 text-[10px] font-black tracking-[2px] uppercase border-accent/30 text-accent hover:border-accent hover:bg-accent/5" onClick={() => { setEditingItem(item); setIsDialogOpen(true); }}>
                           {(activeRole === "agent_logistique" || activeRole === "chef_bureau_logistique" || activeRole === "admin") ? "Modifier" : "Détails"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <EquipmentDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        item={editingItem} 
        activeRole={activeRole}
        isBypass={isBypass}
      />
    </div>
  );
}
