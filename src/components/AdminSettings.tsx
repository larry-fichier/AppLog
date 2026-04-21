import React, { useState, useEffect, useRef } from "react";
import { db, doc, getDoc, setDoc, collection, onSnapshot, updateDoc, auth, sendPasswordResetEmail } from "@/lib/firebase";
import { GlobalSettings, AppUser, UserRole } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save, Users, Settings2, MapPin, ShieldCheck, Mail, Key, UserPlus, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

interface AdminSettingsProps {
  isBypass?: boolean;
}

export function AdminSettings({ isBypass = false }: AdminSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview' | 'results'>('upload');
  const [rawFileData, setRawFileData] = useState<any[]>([]);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [existingEquipmentNames, setExistingEquipmentNames] = useState<Set<string>>(new Set());
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    name: "",
    category: "",
    zone: "",
    status: "",
    station: ""
  });
  const [importDefaults, setImportDefaults] = useState<Record<string, string>>({
    category: "",
    zone: "",
    station: ""
  });
  const [importStats, setImportStats] = useState<{ imported: number, total: number, errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newUser, setNewUser] = useState({ email: "", password: "", displayName: "", role: "agent_logistique" as UserRole });
  const [users, setUsers] = useState<AppUser[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({
    categories: [
      { id: "rame", label: "Rame (Véhicule)", icon: "Car" },
      { id: "cuisine", label: "Cuisine", icon: "Utensils" },
      { id: "electronique", label: "Électronique", icon: "Laptop" },
      { id: "groupe", label: "Groupe Électrogène", icon: "Zap" }
    ],
    zones: [
      { id: "operation", label: "Opérations" },
      { id: "administratif", label: "Administratif" }
    ],
    stations: [],
    roles: [
      { id: "chef_bureau_logistique", label: "Chef Bureau Logistique" },
      { id: "agent_logistique", label: "Agent Logistique" },
      { id: "csph", label: "CSPH" },
      { id: "chef_service_administratif", label: "Chef Service Administratif" }
    ]
  });

  useEffect(() => {
    // Fetch Settings
    async function fetchSettings() {
      try {
        const response = await fetch("/api/config");
        if (response.ok) {
          const data = await response.json();
          // Map PG categories to the settings state structure
          if (data.categories.length > 0) {
            setSettings({
              categories: data.categories.map((c: any) => ({ id: c.id, label: c.label, icon: "Box" })),
              zones: data.zones.map((z: any) => ({ id: z.id, label: z.name })),
              stations: data.stations.map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
              roles: settings.roles // Keep existing roles defined in state
            });
          }
        }
      } catch (error) {
        console.error("Error fetching settings", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();

    // Fetch Users (Keep Real-time listener for now as it's efficient, but updates go via API)
    const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      const userList = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser));
      setUsers(userList);
    });

    return () => {
      unsubscribeUsers();
    };
  }, []);

  const handleSaveSettings = async () => {
    if (!auth.currentUser && !isBypass) {
      toast.error("Veuillez vous connecter pour enregistrer les paramètres.");
      return;
    }
    setSaving(true);
    try {
      const idToken = isBypass ? "demo-token" : await auth.currentUser!.getIdToken();
      const userUid = isBypass ? "demo-admin-uid" : auth.currentUser!.uid;
      
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-user-uid": userUid,
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        toast.success("Configuration système mise à jour (PG + Firestore)");
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erreur serveur");
      }
    } catch (error: any) {
      toast.error(`Échec de l'enregistrement: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateUserRole = async (uid: string, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, "users", uid), { role: newRole });
      toast.success("Rôle utilisateur mis à jour");
    } catch (error) {
      toast.error("Erreur lors de la mise à jour du rôle");
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.email || !newUser.password) return;
    
    setIsCreatingUser(true);
    try {
      const idToken = isBypass ? "demo-token" : await auth.currentUser?.getIdToken();
      const userUid = isBypass ? "demo-admin-uid" : auth.currentUser?.uid;
      
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-user-uid": userUid || "",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ ...newUser }),
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      
      toast.success("Utilisateur créé avec succès");
      setNewUser({ email: "", password: "", displayName: "", role: "agent_logistique" });
    } catch (error: any) {
      toast.error(`Erreur: ${error.message}`);
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cet utilisateur ?")) return;
    
    try {
      const idToken = isBypass ? "demo-token" : await auth.currentUser?.getIdToken();
      const userUid = isBypass ? "demo-admin-uid" : auth.currentUser?.uid;
      
      const response = await fetch(`/api/admin/users/${uid}`, {
        method: "DELETE",
        headers: { 
          "Content-Type": "application/json",
          "x-user-uid": userUid || "",
          "Authorization": `Bearer ${idToken}`
        }
      });
      
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error);
      }
      
      toast.success("Utilisateur supprimé");
    } catch (error: any) {
      toast.error(`Erreur: ${error.message}`);
    }
  };

  const handleResetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success(`Email de réinitialisation envoyé à ${email}`);
    } catch (error: any) {
      toast.error(`Erreur: ${error.message}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    console.log("📁 Fichier sélectionné:", file.name);
    
    setImporting(true);
    setImportStats(null);
    
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const dataBuffer = evt.target?.result as ArrayBuffer;
          const wb = XLSX.read(dataBuffer, { type: 'buffer' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          // Improved logic: detect the header row by searching for keywords
          // This allows skipping generic titles or empty rows at the top of the file
          const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
          let headerRowIndex = 0;
          const headerKeywords = ['numero', 'nom', 'designation', 'libelle', 'appareil', 'poste', 'station', 'zone', 'service', 'categorie', 'statut', 'etat', 'electronique'];
          
          for (let i = 0; i < Math.min(allRows.length, 20); i++) {
            const row = allRows[i];
            if (row && Array.isArray(row) && row.some(cell => 
              typeof cell === 'string' && headerKeywords.some(k => cell.toLowerCase().includes(k))
            )) {
              headerRowIndex = i;
              break;
            }
          }

          console.log(`🔍 En-tête détecté à la ligne ${headerRowIndex + 1}`);
          const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });
          
          if (data && data.length > 0) {
            const columns = Object.keys(data[0] as any);
            setAvailableColumns(columns);
            setRawFileData(data);
            
            // Try to auto-map common names
            const autoMap: any = { ...columnMapping };
            const pairs = [
              { field: 'name', keywords: ['numero', 'nom', 'designation', 'libelle', 'appareil'] },
              { field: 'category', keywords: ['categorie', 'famille', 'type', 'classe'] },
              { field: 'zone', keywords: ['zone', 'service', 'localisation', 'centre'] },
              { field: 'status', keywords: ['etat', 'statut', 'status', 'condition'] },
              { field: 'station', keywords: ['position', 'station', 'bureau', 'poste', 'emplacement'] }
            ];

            pairs.forEach(pair => {
              const found = columns.find(col => 
                pair.keywords.some(k => col.toLowerCase().includes(k))
              );
              if (found) autoMap[pair.field] = found;
            });

            setColumnMapping(autoMap);
            setImportStep('mapping');
          } else {
            toast.error("Le fichier semble vide ou invalide");
          }
        } catch (readErr) {
          console.error("XLSX Read Error:", readErr);
          toast.error("Format de fichier non supporté ou corrompu");
        } finally {
          if (fileInputRef.current) fileInputRef.current.value = "";
          setImporting(false);
        }
      };
      reader.onerror = () => {
        toast.error("Erreur de lecture du fichier");
        setImporting(false);
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error(err);
      toast.error("Une erreur inattendue est survenue");
      setImporting(false);
    }
  };

  const goToPreview = async () => {
    if (!columnMapping.name) {
      toast.error("Veuillez mapper au moins la colonne 'Nom'");
      return;
    }
    
    // Fetch existing equipment to detect duplicates
    setImporting(true);
    try {
      const idToken = isBypass ? "demo-token" : await auth.currentUser?.getIdToken();
      const userUid = isBypass ? "demo-admin-uid" : auth.currentUser?.uid;
      const response = await fetch("/api/equipment", {
        headers: {
          "x-user-uid": userUid || "",
          "Authorization": `Bearer ${idToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        const names = new Set(data.map((item: any) => String(item.name).toLowerCase().trim()));
        setExistingEquipmentNames(names);
      }
      
      // Select all by default
      setSelectedRowIndices(new Set(rawFileData.keys()));
      setImportStep('preview');
    } catch (e) {
      console.error("Duplicate check error", e);
      setImportStep('preview');
    } finally {
      setImporting(false);
    }
  };

  const processImport = async () => {
    if (!auth.currentUser && !isBypass) {
      toast.error("Session expirée. Veuillez vous reconnecter.");
      return;
    }
    
    if (selectedRowIndices.size === 0) {
      toast.error("Aucune ligne sélectionnée pour l'importation.");
      return;
    }
    
    setImporting(true);
    try {
      const idToken = isBypass ? "demo-token" : await auth.currentUser!.getIdToken();
      const userUid = isBypass ? "demo-admin-uid" : auth.currentUser!.uid;
      
      const selectedData = rawFileData.filter((_, idx) => selectedRowIndices.has(idx));

      // Transform data based on mapping
      const formattedData = selectedData.map((row: any) => {
        // Create a copy of the row for details, excluding mapped main fields
        const details: Record<string, string> = {};
        Object.entries(row).forEach(([key, val]) => {
          if (!Object.values(columnMapping).includes(key) && val) {
            details[key] = String(val);
          }
        });

        return {
          name: row[columnMapping.name] || "Actif sans nom",
          category: columnMapping.category && columnMapping.category !== "non_mappe" ? row[columnMapping.category] : importDefaults.category,
          zone: columnMapping.zone && columnMapping.zone !== "non_mappe" ? row[columnMapping.zone] : importDefaults.zone,
          station: columnMapping.station && columnMapping.station !== "non_mappe" ? row[columnMapping.station] : importDefaults.station,
          status: columnMapping.status && columnMapping.status !== "non_mappe" ? row[columnMapping.status] : "fonctionnel",
          details: details
        };
      });

      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-user-uid": userUid,
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ data: formattedData }),
      });

      const result = await response.json();
      if (response.ok) {
        setImportStats(result);
        setImportStep('results');
        toast.success(`Import terminé: ${result.imported}/${result.total} unités`);
      } else {
        toast.error(result.error);
      }
    } catch (e: any) {
      toast.error("Erreur lors de l'envoi des données");
    } finally {
      setImporting(false);
    }
  };

  // Helper functions for list management
  const addToList = (key: keyof GlobalSettings, item: any) => {
    setSettings(prev => ({ ...prev, [key]: [...prev[key], item] }));
  };

  const removeFromList = (key: keyof GlobalSettings, id: string) => {
    setSettings(prev => ({ ...prev, [key]: prev[key].filter((item: any) => item.id !== id) }));
  };

  const updateItemInList = (key: keyof GlobalSettings, id: string, updates: Record<string, any>) => {
    setSettings(prev => ({
      ...prev,
      [key]: prev[key].map((item: any) => item.id === id ? { ...item, ...updates } : item)
    }));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Initialisation de l'administration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-text-dark tracking-tight">Configuration Super User</h2>
          <p className="text-sm text-muted-foreground">Contrôle total du système HELIOS.</p>
        </div>
        <Button onClick={handleSaveSettings} disabled={saving} className="bg-accent hover:bg-accent/90 text-white font-bold px-8">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Enregistrer globalement
        </Button>
      </div>

      <Tabs defaultValue="logic" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-xl h-12 bg-white border border-border-custom p-1 mb-8">
          <TabsTrigger value="logic" className="font-bold gap-2">
            <Settings2 size={16} />
            Logique Métier
          </TabsTrigger>
          <TabsTrigger value="users" className="font-bold gap-2">
            <Users size={16} />
            Utilisateurs & Accès
          </TabsTrigger>
          <TabsTrigger value="import" className="font-bold gap-2">
            <FileSpreadsheet size={16} />
            Importation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logic" className="space-y-8 mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Zones (Services) */}
            <Card className="border-border-custom shadow-sm">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><MapPin size={20} /></div>
                  <div>
                    <CardTitle className="text-base font-bold">Zones (Services)</CardTitle>
                    <CardDescription className="text-xs italic">Ex: Opérations, Administratif...</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {settings.zones.map((zone) => (
                  <div key={zone.id} className="flex gap-2 items-center">
                    <Input 
                      value={zone.label} 
                      onChange={(e) => updateItemInList("zones", zone.id, { label: e.target.value })}
                      className="h-10 text-sm font-medium"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeFromList("zones", zone.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" className="w-full h-10 border-dashed text-xs font-bold uppercase tracking-wider" onClick={() => addToList("zones", { id: `z_${Date.now()}`, label: "Nouveau Service" })}>
                  <Plus size={14} className="mr-2" />
                  Nouveau Service
                </Button>
              </CardContent>
            </Card>

            {/* Stations (Bureaux) */}
            <Card className="border-border-custom shadow-sm">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><MapPin size={20} /></div>
                  <div>
                    <CardTitle className="text-base font-bold">Stations (Bureaux)</CardTitle>
                    <CardDescription className="text-xs italic">Ex: Bureau 101, Garage A...</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {settings.stations.map((station) => (
                  <div key={station.id} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-zinc-50 rounded-lg border border-zinc-100 group relative">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Nom du Bureau</Label>
                      <Input 
                        value={station.label} 
                        onChange={(e) => updateItemInList("stations", station.id, { label: e.target.value })}
                        className="h-9 text-sm font-medium bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Service Rattaché</Label>
                      <div className="flex gap-2">
                        <Select 
                          value={station.zoneId || ""} 
                          onValueChange={(val) => updateItemInList("stations", station.id, { zoneId: val })}
                        >
                          <SelectTrigger className="h-9 bg-white text-[11px] font-bold">
                            <SelectValue placeholder="Choisir un Service" />
                          </SelectTrigger>
                          <SelectContent>
                            {settings.zones.map(z => (
                              <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" onClick={() => removeFromList("stations", station.id)} className="text-red-400 hover:text-red-600 h-9 w-9 shrink-0">
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="w-full h-10 border-dashed text-xs font-bold uppercase tracking-wider" onClick={() => addToList("stations", { id: `st_${Date.now()}`, label: "Nouveau Bureau" })}>
                  <Plus size={14} className="mr-2" />
                  Nouveau Bureau
                </Button>
              </CardContent>
            </Card>

            {/* Categories */}
            <Card className="border-border-custom shadow-sm lg:col-span-2">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom pb-4">
                <CardTitle className="text-base font-bold">Catégories d'Équipements</CardTitle>
                <CardDescription className="text-xs">Identifiez les types d'actifs gérés.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {settings.categories.map((cat) => (
                  <div key={cat.id} className="flex gap-2 items-center bg-zinc-50 p-2 rounded-lg border border-zinc-100">
                    <Input 
                      value={cat.label} 
                      onChange={(e) => updateItemInList("categories", cat.id, { label: e.target.value })}
                      className="h-9 text-xs font-bold bg-white"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeFromList("categories", cat.id)} className="text-red-400 h-8 w-8">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" className="h-9 border-dashed text-[10px] font-black uppercase" onClick={() => addToList("categories", { id: `c_${Date.now()}`, label: "Autre", icon: "Box" })}>
                  <Plus size={12} className="mr-2" />
                  Catégorie
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-0">
          <div className="grid grid-cols-1 gap-8">
            {/* Add User Form */}
            <Card className="border-border-custom shadow-sm overflow-hidden bg-accent/5 border-dashed border-accent/30">
               <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent text-white rounded-lg"><UserPlus size={20} /></div>
                    <div>
                      <CardTitle className="text-base font-bold text-accent">Ajouter un Collaborateur</CardTitle>
                      <CardDescription>Créez un compte pour un nouvel agent logistique.</CardDescription>
                    </div>
                  </div>
               </CardHeader>
               <CardContent className="p-6 pt-0">
                  <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest opacity-50">Nom complet</Label>
                      <Input 
                        value={newUser.displayName}
                        onChange={(e) => setNewUser({...newUser, displayName: e.target.value})}
                        placeholder="Ex: Jean Dupont"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest opacity-50">Email professionnel</Label>
                      <Input 
                        type="email"
                        required
                        value={newUser.email}
                        onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                        placeholder="email@helios.sn"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest opacity-50">Mot de passe provisoire</Label>
                      <Input 
                        type="password"
                        required
                        value={newUser.password}
                        onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                        placeholder="••••••••"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest opacity-50">Rôle initial</Label>
                      <Select 
                        value={newUser.role} 
                        onValueChange={(val: UserRole) => setNewUser({...newUser, role: val})}
                      >
                        <SelectTrigger className="bg-white font-bold h-10 border-border-custom">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          {settings.roles.map(r => (
                            <SelectItem key={r.id} value={r.id} className="font-bold">{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-4 flex justify-end">
                      <Button 
                        type="submit" 
                        disabled={isCreatingUser} 
                        className="bg-accent hover:bg-accent/90 text-white font-black px-10 h-11"
                      >
                        {isCreatingUser ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                        ENREGISTRER L'UTILISATEUR
                      </Button>
                    </div>
                  </form>
               </CardContent>
            </Card>

            {/* User List Management */}
            <Card className="border-border-custom shadow-sm overflow-hidden">
               <CardHeader className="bg-white border-b border-border-custom flex flex-row items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent/10 text-accent rounded-lg"><Users size={20} /></div>
                    <div>
                      <CardTitle className="text-base font-bold">Base des Utilisateurs</CardTitle>
                      <CardDescription>Gérez les droits d'accès des agents.</CardDescription>
                    </div>
                  </div>
                  <div className="text-[10px] font-black bg-zinc-100 px-3 py-1 rounded-full text-zinc-500 uppercase tracking-widest">
                    {users.length} Comptes actifs
                  </div>
               </CardHeader>
               <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#f8fafc] border-b border-border-custom">
                          <th className="px-6 py-4 text-[10px] font-black text-[#636e72] uppercase tracking-[2px]">Utilisateur</th>
                          <th className="px-6 py-4 text-[10px] font-black text-[#636e72] uppercase tracking-[2px]">E-mail</th>
                          <th className="px-6 py-4 text-[10px] font-black text-[#636e72] uppercase tracking-[2px]">Rôle Système</th>
                          <th className="px-6 py-4 text-[10px] font-black text-[#636e72] uppercase tracking-[2px] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.uid} className="border-b border-border-custom hover:bg-[#fafbfc] transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold text-xs border border-border-custom">
                                  {user.displayName?.[0] || user.email[0].toUpperCase()}
                                </div>
                                <span className="text-sm font-bold text-text-dark">{user.displayName || "Agent Helios"}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                <Mail size={12} className="opacity-40" />
                                {user.email}
                              </div>
                            </td>
                            <td className="px-6 py-4 min-w-[200px]">
                              <Select 
                                defaultValue={user.role} 
                                onValueChange={(val: UserRole) => handleUpdateUserRole(user.uid, val)}
                              >
                                <SelectTrigger className="w-full h-9 bg-white border-border-custom text-xs font-bold">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-60 overflow-y-auto">
                                  {settings.roles.map(r => (
                                    <SelectItem key={r.id} value={r.id} className="text-xs font-bold">{r.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 w-8 p-0 text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100 hover:text-amber-700"
                                  onClick={() => handleResetPassword(user.email)}
                                  title="Réinitialiser le mot de passe (envoie un email)"
                                >
                                  <Key size={14} />
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 w-8 p-0 text-red-600 border-red-200 bg-red-50 hover:bg-red-100 hover:text-red-700"
                                  onClick={() => handleDeleteUser(user.uid)}
                                  title="Supprimer définitivement le compte"
                                  disabled={user.uid === auth.currentUser?.uid}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
               </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="import" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="lg:col-span-2 border-border-custom shadow-sm">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-50 text-green-600 rounded-lg"><Upload size={20} /></div>
                  <div>
                    <CardTitle className="text-base font-bold">Migration de Base Access (Intelligente)</CardTitle>
                    <CardDescription className="text-xs">Uploadez votre fichier Excel. Notre assistant vous aidera à organiser les données désordonnées.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-8">
                {importStep === 'upload' && (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    className="border-2 border-dashed border-zinc-200 rounded-xl p-12 flex flex-col items-center justify-center text-center gap-4 hover:border-accent/40 hover:bg-accent/5 focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all cursor-pointer relative"
                  >
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      accept=".xlsx, .xls, .csv" 
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={importing}
                    />
                    {importing ? (
                      <>
                        <Loader2 size={48} className="text-accent animate-spin" />
                        <p className="text-sm font-bold animate-pulse">Lecture du fichier...</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-accent/10 text-accent rounded-full flex items-center justify-center">
                          <FileSpreadsheet size={32} />
                        </div>
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-text-dark">Cliquez ici pour ouvrir votre fichier Access (Excel/CSV)</p>
                            <p className="text-xs text-muted-foreground">Ou glissez-déposez le fichier dans cette zone.</p>
                          </div>
                          <Button variant="outline" size="sm" className="bg-white font-bold border-zinc-200">
                            Choisir un fichier
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {importStep === 'mapping' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                    <div className="bg-zinc-100 p-5 rounded-xl border border-zinc-200 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white font-black">
                          {rawFileData.length}
                        </div>
                        <p className="text-sm font-bold text-text-dark">
                          Lignes détectées prêtes pour le traitement
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setImportStep('upload')} className="text-[10px] font-black uppercase tracking-widest h-8 border-zinc-300 hover:bg-zinc-200 transition-colors">
                        Changer de fichier
                      </Button>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-px bg-zinc-200 flex-1"></div>
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[3px]">Configuration du Mapping</span>
                        <div className="h-px bg-zinc-200 flex-1"></div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                        {[
                          { id: 'name', label: 'Désignation de l\'Actif', req: true, desc: "Nom principal (ex: RAM 101)" },
                          { id: 'category', label: 'Catégorie Système', req: true, desc: "Type de matériel" },
                          { id: 'zone', label: 'Service / Localisation', req: true, desc: "Zone de déploiement" },
                          { id: 'station', label: 'Position / Bureau', req: false, desc: "Optionnel" },
                          { id: 'status', label: 'État Actuel', req: false, desc: "Converti en standard Helios" }
                        ].map((field) => (
                          <div key={field.id} className="space-y-4 group p-4 border border-transparent hover:border-zinc-100 hover:bg-zinc-50/50 rounded-xl transition-all">
                            <div className="space-y-2">
                              <div className="flex justify-between items-end">
                                <Label className="text-[11px] font-black uppercase tracking-wider text-text-dark/80 flex items-center gap-2">
                                  {field.label}
                                  {field.req && <span className="text-brand-orange animate-pulse">*</span>}
                                </Label>
                                <span className="text-[9px] font-bold text-zinc-400 italic">{field.desc}</span>
                              </div>
                              <Select 
                                value={columnMapping[field.id]} 
                                onValueChange={(val) => setColumnMapping(prev => ({ ...prev, [field.id]: val }))}
                              >
                                <SelectTrigger className="bg-white border-zinc-300 h-12 focus:ring-accent/30 font-bold text-sm shadow-none transition-shadow hover:border-zinc-400">
                                  <SelectValue placeholder="Sélectionner la colonne correspondante..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="non_mappe" className="text-zinc-400 italic">Non présent dans le fichier (Valeur par défaut)</SelectItem>
                                  {availableColumns.map(col => (
                                    <SelectItem key={col} value={col} className="font-bold">{col}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {(columnMapping[field.id] === "" || columnMapping[field.id] === "non_mappe") && (field.id === 'category' || field.id === 'zone' || field.id === 'station') && (
                              <div className="animate-in slide-in-from-top-2 duration-300 space-y-2 bg-white/60 p-3 rounded-lg border border-dashed border-zinc-200">
                                <p className="text-[9px] font-black text-accent uppercase tracking-widest flex items-center gap-2">
                                  <ChevronRight size={10} /> Définir par défaut pour tout le fichier
                                </p>
                                <Select 
                                  value={importDefaults[field.id]} 
                                  onValueChange={(val) => setImportDefaults(prev => ({ ...prev, [field.id]: val }))}
                                >
                                  <SelectTrigger className="h-9 text-xs font-bold bg-transparent border-zinc-200">
                                    <SelectValue placeholder={`Choisir ${field.label.toLowerCase()}...`} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {field.id === 'category' && settings.categories.map(c => (
                                      <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                                    ))}
                                    {field.id === 'zone' && settings.zones.map(z => (
                                      <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
                                    ))}
                                    {field.id === 'station' && settings.stations.map(s => (
                                      <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-8 border-t border-zinc-200 flex flex-col items-center gap-4">
                      <Button 
                        onClick={goToPreview} 
                        disabled={importing || !columnMapping.name || !columnMapping.category || !columnMapping.zone}
                        className="w-full max-w-sm bg-accent hover:bg-accent/90 text-white font-bold px-12 h-12 text-sm tracking-[1px] shadow-sm transition-all duration-300 active:scale-95 border-none"
                      >
                        {importing ? (
                          <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>CHARGEMENT DE L'APERÇU...</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <Save className="w-5 h-5" />
                            <span>VÉRIFIER ET CHOISIR LES LIGNES</span>
                          </div>
                        )}
                      </Button>
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <ShieldCheck size={12} className="text-zinc-300" />
                        Traitement sécurisé et vérification des doublons
                      </p>
                    </div>
                  </div>
                )}

                {importStep === 'preview' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                    <div className="flex justify-between items-center bg-zinc-50 p-4 rounded-xl border border-border-custom">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-text-dark">Sélection des données</span>
                          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                            {selectedRowIndices.size} / {rawFileData.length} lignes sélectionnées
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => {
                            if (selectedRowIndices.size === rawFileData.length) {
                              setSelectedRowIndices(new Set());
                            } else {
                              setSelectedRowIndices(new Set(rawFileData.keys()));
                            }
                          }}
                          className="text-[10px] font-black uppercase tracking-widest h-8"
                        >
                          {selectedRowIndices.size === rawFileData.length ? "Tout désélectionner" : "Tout sélectionner"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setImportStep('mapping')} className="text-[10px] font-black uppercase tracking-widest h-8">
                          Retour au Mapping
                        </Button>
                      </div>
                    </div>

                    <div className="border border-border-custom rounded-xl overflow-hidden shadow-sm">
                      <div className="max-h-[500px] overflow-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 bg-[#f8fafc] z-10 border-b border-border-custom">
                            <tr>
                              <th className="px-4 py-3 w-10"></th>
                              <th className="px-4 py-3 text-[10px] font-black text-[#636e72] uppercase tracking-widest">Désignation</th>
                              <th className="px-4 py-3 text-[10px] font-black text-[#636e72] uppercase tracking-widest">Catégorie</th>
                              <th className="px-4 py-3 text-[10px] font-black text-[#636e72] uppercase tracking-widest">Zone</th>
                              <th className="px-4 py-3 text-[10px] font-black text-[#636e72] uppercase tracking-widest text-right">Statut</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rawFileData.map((row, idx) => {
                              const name = row[columnMapping.name];
                              const isDuplicate = existingEquipmentNames.has(String(name).toLowerCase().trim());
                              const isSelected = selectedRowIndices.has(idx);
                              
                              return (
                                <tr 
                                  key={idx} 
                                  className={`border-b border-border-custom transition-colors hover:bg-zinc-50 ${isDuplicate ? 'bg-amber-50/50' : ''}`}
                                >
                                  <td className="px-4 py-3">
                                    <input 
                                      type="checkbox" 
                                      checked={isSelected}
                                      onChange={() => {
                                        const next = new Set(selectedRowIndices);
                                        if (isSelected) next.delete(idx);
                                        else next.add(idx);
                                        setSelectedRowIndices(next);
                                      }}
                                      className="w-4 h-4 rounded border-zinc-300 text-accent focus:ring-accent"
                                    />
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-col">
                                      <span className="text-sm font-bold text-text-dark flex items-center gap-2">
                                        {name}
                                        {isDuplicate && (
                                          <span className="bg-amber-100 text-amber-700 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">
                                            DOUBLON POSSIBLE
                                          </span>
                                        )}
                                      </span>
                                      <span className="text-[10px] text-zinc-400 font-medium">Ligne {idx + 1}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-xs font-medium text-zinc-600">{row[columnMapping.category]}</td>
                                  <td className="px-4 py-3 text-xs font-medium text-zinc-600">{row[columnMapping.zone]}</td>
                                  <td className="px-4 py-3 text-right">
                                    <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 px-2 py-1 rounded">
                                      {row[columnMapping.status] || "Fonctionnel"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="pt-6 flex flex-col items-center gap-4">
                      {existingEquipmentNames.size > 0 && selectedRowIndices.size > 0 && Array.from(selectedRowIndices).some(idx => existingEquipmentNames.has(String(rawFileData[idx][columnMapping.name]).toLowerCase().trim())) && (
                        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-4 py-2 rounded-lg border border-amber-100 mb-2">
                          <AlertCircle size={16} />
                          <p className="text-[10px] font-bold uppercase tracking-wider">
                            Attention : Certaines lignes sélectionnées semblent être des doublons.
                          </p>
                        </div>
                      )}

                      <Button 
                        onClick={processImport} 
                        disabled={importing || selectedRowIndices.size === 0}
                        className="w-full max-w-sm bg-brand-orange hover:bg-[#e66000] text-white font-bold px-12 h-12 text-sm tracking-[1px] shadow-sm transition-all duration-300 active:scale-95 border-none"
                      >
                        {importing ? (
                          <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>IMPORTATION EN COURS...</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <Save className="w-5 h-5" />
                            <span>LANCER L'IMPORTATION ({selectedRowIndices.size})</span>
                          </div>
                        )}
                      </Button>
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <ShieldCheck size={12} className="text-zinc-300" />
                        Seules les lignes sélectionnées seront ajoutées au parc
                      </p>
                    </div>
                  </div>
                )}

                {(importStep === 'results' && importStats) && (
                  <div className="space-y-8 animate-in zoom-in-95 duration-300">
                    <div className="text-center space-y-2">
                      <div className="w-16 h-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 size={32} />
                      </div>
                      <h3 className="text-xl font-black text-text-dark">Importation Terminée</h3>
                      <p className="text-sm text-muted-foreground">Votre base de données HELIOS a été enrichie.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-success/5 border border-success/20 p-6 rounded-xl text-center">
                        <p className="text-xs font-black uppercase tracking-widest text-success mb-1">Succès</p>
                        <p className="text-4xl font-black text-success tracking-tighter">{importStats.imported}</p>
                        <p className="text-[10px] text-success/60 font-medium">Lignes intégrées</p>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 p-6 rounded-xl text-center">
                        <p className="text-xs font-black uppercase tracking-widest text-amber-600 mb-1">Échecs</p>
                        <p className="text-4xl font-black text-amber-600 tracking-tighter">{importStats.total - importStats.imported}</p>
                        <p className="text-[10px] text-amber-600/60 font-medium">Lignes rejetées</p>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <Button variant="outline" onClick={() => setImportStep('upload')} className="font-bold border-zinc-200">
                        Faire un nouvel import
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-border-custom shadow-sm bg-blue-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <ShieldCheck size={16} className="text-blue-600" />
                    Instructions de Format
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-xs text-zinc-600">
                  <p className="font-bold underline">Plus besoin de renommer vos colonnes Access !</p>
                  <p>L'assistant va scanner votre fichier et vous proposer de lier vos colonnes à nos champs. Même si vos noms sont différents (ex: "ID_Matériel" pour "Nom"), vous pourrez les associer manuellement.</p>
                  <div className="p-3 bg-blue-100/50 rounded border border-blue-200">
                    <p className="italic text-[10px]">Note: Le système effectue une "Reconnaissance Intelligente" (Fuzzy Match). Par exemple, "Rames" dans Excel sera automatiquement détecté comme "Rame" dans HELIOS.</p>
                  </div>
                </CardContent>
              </Card>

              {importStats && importStats.errors.length > 0 && (
                <Card className="border-red-200 shadow-sm bg-red-50/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold text-red-600 uppercase tracking-widest">Rapport d'erreurs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {importStats.errors.map((error, idx) => (
                        <li key={idx} className="text-[10px] flex gap-2 font-medium text-red-800">
                          <span className="shrink-0">•</span>
                          {error}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
