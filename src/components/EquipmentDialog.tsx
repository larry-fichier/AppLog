import { useState, useEffect } from "react";
import React from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Box, Info, Save } from "lucide-react";
import { db, auth, addDoc, collection, doc, getDoc, updateDoc, deleteDoc, OperationType, handleFirestoreError } from "@/lib/firebase";
import { Equipment, EquipmentCategory, EquipmentStatus, EquipmentDetails, GlobalSettings } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: Equipment;
  activeRole?: string;
  isBypass?: boolean;
}

const categoryLabels = {
  rame: "Rame",
  cuisine: "Cuisine",
  electronique: "Électronique",
  groupe: "Groupe"
};

export function EquipmentDialog({ open, onOpenChange, item, activeRole = "agent_logistique", isBypass = false }: Props) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [dynamicSettings, setDynamicSettings] = useState<GlobalSettings | null>(null);
  const isReadOnly = activeRole === "csph" || activeRole === "chef_service_administratif";
  const canDelete = activeRole === "chef_bureau_logistique" || activeRole === "admin" || activeRole === "agent_logistique"; 
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EquipmentCategory>("rame");
  const [status, setStatus] = useState<EquipmentStatus>("fonctionnel");
  const [arrivalDate, setArrivalDate] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [location, setLocation] = useState({
    zone: "Zone 1",
    station: "",
    service: "operation" as const,
    office: ""
  });
  const [details, setDetails] = useState<EquipmentDetails>({});

  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch("/api/config");
        if (response.ok) {
          const data = await response.json();
          // Map PG data to the settings format expected by the dialog
          setDynamicSettings({
            categories: data.categories.map((c: any) => ({ id: c.id, label: c.label, icon: "Box" })),
            zones: data.zones.map((z: any) => ({ id: z.id, label: z.name })),
            stations: data.stations.map((s: any) => ({ id: s.id, label: s.name })),
            roles: [] // Not needed here
          });
        }
      } catch (e) {
        console.error("Error fetching settings in dialog", e);
      }
    }
    if (open) fetchSettings();

    if (item) {
      setName(item.name);
      setCategory(item.category || "rame");
      setStatus(item.status || "fonctionnel");
      setArrivalDate(item.arrivalDate || "");
      setDepartureDate(item.departureDate || "");
      setLocation(item.location || {
        zone: "Zone 1",
        station: "",
        service: "operation",
        office: ""
      });
      setDetails(item.details || {});
    } else {
      setName("");
      setCategory("rame");
      setStatus("fonctionnel");
      setArrivalDate("");
      setDepartureDate("");
      setLocation({
        zone: "Zone 1",
        station: "",
        service: "operation",
        office: ""
      });
      setDetails({});
    }
    setActiveTab("general");
    setShowDeleteConfirm(false);
  }, [item, open]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("helios_token");
    if (!token && !isBypass) {
      toast.error("Veuillez vous connecter pour effectuer cette action.");
      return;
    }

    if (!name.trim()) {
      toast.error("Le nom est obligatoire");
      return;
    }

    setLoading(true);
    try {
      const idToken = isBypass ? "demo-token" : token;
      const userUid = isBypass ? "demo-admin-uid" : "";
      
      const payload = {
        name,
        category_id: category, // In PG, category is an ID
        status,
        zone_id: location.zone || null, 
        station_id: location.station || null,
        details,
      };

      const response = await fetch("/api/equipment" + (item?.id ? `/${item.id}` : ""), {
        method: item?.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-uid": userUid || "",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        toast.success(item?.id ? "Équipement mis à jour" : "Équipement ajouté");
        onOpenChange(false);
      } else {
        const err = await response.json();
        throw new Error(err.error || "Erreur serveur");
      }
    } catch (error: any) {
      toast.error(error.message || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const token = localStorage.getItem("helios_token");
    if (!item?.id || (!token && !isBypass)) return;
    
    setLoading(true);
    try {
      const idToken = isBypass ? "demo-token" : token;
      const userUid = isBypass ? "demo-admin-uid" : "";
      
      const response = await fetch(`/api/equipment/${item.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-user-uid": userUid,
          "Authorization": `Bearer ${idToken}`
        }
      });

      if (response.ok) {
        toast.success("Équipement supprimé");
        onOpenChange(false);
      } else {
        const err = await response.json();
        throw new Error(err.error || "Erreur lors de la suppression");
      }
    } catch (error: any) {
       toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const updateDetail = (key: keyof EquipmentDetails, value: any) => {
    setDetails(prev => ({ ...prev, [key]: value }));
  };

  const updateLocation = (key: string, value: string) => {
    setLocation(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 border-none bg-white rounded-xl overflow-hidden shadow-2xl">
        <DialogHeader className="p-6 bg-[#fafbfc] border-b border-border-custom relative">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-lg ${item ? 'bg-accent/10 text-accent' : 'bg-success/10 text-success'}`}>
              <Box size={24} />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-text-dark">
                {item ? "Édition de l'Actif" : "Nouvel Actif Logistique"}
              </DialogTitle>
              <DialogDescription className="text-sm font-medium text-[#7f8c8d]">
                Numéro de référence: <span className="text-text-dark">{item ? item.id?.substring(0, 10).toUpperCase() : "NOUVEAU"}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="p-8 flex flex-col items-center text-center gap-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
               <Trash2 size={32} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-text-dark">Supprimer cet équipement ?</h3>
              <p className="text-sm text-[#7f8c8d]">Cette action est irréversible et supprimera définitivement <strong>{name}</strong> de l'inventaire.</p>
            </div>
            <div className="flex gap-3 w-full">
              <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>Annuler</Button>
              <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmer la suppression"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="p-0">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="px-6 pt-2 bg-[#fafbfc] border-b border-border-custom">
                  <TabsList className="bg-transparent h-auto p-0 gap-6 w-full justify-start rounded-none">
                    <TabsTrigger value="general" className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[11px] font-bold uppercase tracking-widest px-0 pb-3">Identification</TabsTrigger>
                    <TabsTrigger value="location" className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[11px] font-bold uppercase tracking-widest px-0 pb-3">Localisation</TabsTrigger>
                    <TabsTrigger value="specs" className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[11px] font-bold uppercase tracking-widest px-0 pb-3">Détails & Date</TabsTrigger>
                  </TabsList>
                </div>
                
                <div className="p-6">
                  <TabsContent value="general" className="mt-0 space-y-6">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-[12px] font-bold text-[#636e72] uppercase tracking-wider">Nom de l'équipement / Désignation</Label>
                        <Input 
                          id="name" 
                          placeholder="Désignation technique..." 
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="h-11 border-border-custom focus:border-accent"
                          required
                          readOnly={isReadOnly}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[12px] font-bold text-[#636e72] uppercase tracking-wider">Catégorie</Label>
                          <Select onValueChange={(val: EquipmentCategory) => setCategory(val)} value={category} disabled={isReadOnly}>
                            <SelectTrigger className="h-11 border-border-custom">
                              <SelectValue placeholder="Choisir" />
                            </SelectTrigger>
                            <SelectContent>
                              {dynamicSettings?.categories.map(cat => (
                                <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                              )) || (
                                <>
                                  <SelectItem value="rame">Rame (Véhicule)</SelectItem>
                                  <SelectItem value="cuisine">Cuisine</SelectItem>
                                  <SelectItem value="electronique">Électronique</SelectItem>
                                  <SelectItem value="groupe">Groupe Électrogène</SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-[12px] font-bold text-[#636e72] uppercase tracking-wider">État opérationnel</Label>
                          <Select onValueChange={(val: EquipmentStatus) => setStatus(val)} value={status} disabled={isReadOnly}>
                            <SelectTrigger className="h-11 border-border-custom">
                              <SelectValue placeholder="Choisir" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fonctionnel" className="text-success font-semibold">Fonctionnel</SelectItem>
                              <SelectItem value="en_reparation" className="text-warning font-semibold">En réparation</SelectItem>
                              <SelectItem value="hors_service" className="text-red-500 font-semibold">Hors service</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="location" className="mt-0 space-y-6">
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[11px] font-bold text-[#636e72] uppercase tracking-wider">Zone (Service)</Label>
                          <Select onValueChange={(val) => updateLocation("service", val)} value={location.service} disabled={isReadOnly}>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Opérations / Administratif" />
                            </SelectTrigger>
                            <SelectContent>
                              {dynamicSettings?.zones.map(z => (
                                <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
                              )) || (
                                <>
                                  <SelectItem value="operation">Opérations</SelectItem>
                                  <SelectItem value="administratif">Administratif</SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="office" className="text-[11px] font-bold text-[#636e72] uppercase tracking-wider">Station (Bureau)</Label>
                          <Select onValueChange={(val) => updateLocation("office", val)} value={location.office} disabled={isReadOnly}>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Choisir Bureau/Station" />
                            </SelectTrigger>
                            <SelectContent>
                              {dynamicSettings?.stations.map(st => (
                                <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>
                              )) || (
                                <div className="p-2 text-[10px] text-muted-foreground italic">Aucun bureau configuré</div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="specs" className="mt-0 space-y-6">
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="arrivalDate" className="text-[11px] font-bold text-[#636e72] uppercase tracking-wider">Date d'Arrivée</Label>
                          <Input 
                            id="arrivalDate" 
                            type="date"
                            value={arrivalDate}
                            onChange={(e) => setArrivalDate(e.target.value)}
                            className="h-10 border-border-custom"
                            readOnly={isReadOnly}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="departureDate" className="text-[11px] font-bold text-[#636e72] uppercase tracking-wider">Date de Sortie</Label>
                          <Input 
                            id="departureDate" 
                            type="date"
                            value={departureDate}
                            onChange={(e) => setDepartureDate(e.target.value)}
                            className="h-10 border-border-custom"
                            readOnly={isReadOnly}
                          />
                        </div>
                      </div>

                      <div className="pt-4 border-t border-border-custom">
                        <div className="flex items-center gap-2 mb-4">
                          <Info size={14} className="text-accent" />
                          <h3 className="text-[10px] font-bold text-[#636e72] uppercase tracking-widest">
                            Spécifications {categoryLabels[category as keyof typeof categoryLabels]}
                          </h3>
                        </div>
                        
                        <div className="bg-[#fafbfc] p-4 rounded-lg border border-border-custom">
                          {category === "rame" && (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="licensePlate" className="text-[11px] font-bold">Immatriculation</Label>
                                <Input 
                                  id="licensePlate" 
                                  placeholder="AA-000-XX" 
                                  value={details.licensePlate || ""}
                                  onChange={(e) => updateDetail("licensePlate", e.target.value)}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="mileage" className="text-[11px] font-bold">Kilométrage actuel</Label>
                                <Input 
                                  id="mileage" 
                                  type="number" 
                                  placeholder="Km" 
                                  value={details.mileage || ""}
                                  onChange={(e) => updateDetail("mileage", parseInt(e.target.value))}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                            </div>
                          )}

                          {category === "electronique" && (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="serialNumber" className="text-[11px] font-bold">N° de Série</Label>
                                <Input 
                                  id="serialNumber" 
                                  placeholder="SN-12345" 
                                  value={details.serialNumber || ""}
                                  onChange={(e) => updateDetail("serialNumber", e.target.value)}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="brandE" className="text-[11px] font-bold">Constructeur</Label>
                                <Input 
                                  id="brandE" 
                                  placeholder="Marque..." 
                                  value={details.brand || ""}
                                  onChange={(e) => updateDetail("brand", e.target.value)}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                            </div>
                          )}

                          {category === "cuisine" && (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="capacity" className="text-[11px] font-bold">Capacité / Dimensions</Label>
                                <Input 
                                  id="capacity" 
                                  placeholder="Ex: 500L, 2m..." 
                                  value={details.capacity || ""}
                                  onChange={(e) => updateDetail("capacity", e.target.value)}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="brandC" className="text-[11px] font-bold">Marque</Label>
                                <Input 
                                  id="brandC" 
                                  placeholder="Brandt, Samsung..." 
                                  value={details.brand || ""}
                                  onChange={(e) => updateDetail("brand", e.target.value)}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                            </div>
                          )}

                          {category === "groupe" && (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="power" className="text-[11px] font-bold">Puissance (kVA)</Label>
                                <Input 
                                  id="power" 
                                  placeholder="Ex: 150" 
                                  value={details.power || ""}
                                  onChange={(e) => updateDetail("power", e.target.value)}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="hours" className="text-[11px] font-bold">Heures Compteur</Label>
                                <Input 
                                  id="hours" 
                                  type="number" 
                                  placeholder="Heures" 
                                  value={details.operatingHours || ""}
                                  onChange={(e) => updateDetail("operatingHours", parseInt(e.target.value))}
                                  className="h-9 bg-white"
                                  readOnly={isReadOnly}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </div>

            <DialogFooter className="p-6 bg-zinc-50 border-t border-border-custom flex items-center justify-between gap-4">
              {item && !isReadOnly && canDelete && (
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => setShowDeleteConfirm(true)} 
                  disabled={loading} 
                  className="text-red-500 hover:bg-red-50 hover:text-red-600 font-bold text-xs"
                >
                  <Trash2 size={14} className="mr-2" />
                  Supprimer
                </Button>
              )}
              <div className="flex gap-3 ml-auto">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => onOpenChange(false)} 
                  disabled={loading} 
                  className="border-zinc-300 font-bold text-xs shadow-sm hover:bg-white"
                >
                  {isReadOnly ? "Fermer" : "Annuler"}
                </Button>
                {!isReadOnly && (
                  <Button 
                    type="submit" 
                    disabled={loading} 
                    className="bg-brand-orange hover:bg-[#e66000] text-white font-bold px-8 h-10 text-xs uppercase tracking-wider shadow-sm transition-all active:scale-95 border-none min-w-[140px]"
                  >
                    {loading ? (
                      <Loader2 size={16} className="mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {item ? "METTRE À JOUR" : "CRÉER L'UNITÉ"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
