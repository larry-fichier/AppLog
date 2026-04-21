import React, { useState, useEffect } from "react";
import { db, doc, getDoc, setDoc, collection, onSnapshot, updateDoc, auth, sendPasswordResetEmail } from "@/lib/firebase";
import { GlobalSettings, AppUser, UserRole } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save, Users, Settings2, MapPin, ShieldCheck, Mail, Key, UserPlus, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'results'>('upload');
  const [rawFileData, setRawFileData] = useState<any[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    name: "",
    category: "",
    zone: "",
    status: "",
    station: ""
  });
  const [importStats, setImportStats] = useState<{ imported: number, total: number, errors: string[] } | null>(null);
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
              stations: data.stations.map((s: any) => ({ id: s.id, label: s.name })),
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
    if (!auth.currentUser) return;
    setSaving(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-user-uid": auth.currentUser.uid,
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        toast.success("Configuration système mise à jour (PG + Firestore)");
      } else {
        throw new Error("Erreur serveur");
      }
    } catch (error) {
      toast.error("Échec de l'enregistrement");
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
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newUser, callerUid: auth.currentUser?.uid }),
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
      const response = await fetch(`/api/admin/users/${uid}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerUid: auth.currentUser?.uid }),
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
    if (!file || !auth.currentUser) return;

    setImporting(true);
    setImportStats(null);
    
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        if (data.length > 0) {
          const columns = Object.keys(data[0] as any);
          setAvailableColumns(columns);
          setRawFileData(data);
          
          // Try to auto-map common names
          const autoMap: any = { ...columnMapping };
          const pairs = [
            { field: 'name', keywords: ['nom', 'designation', 'libelle', 'appareil'] },
            { field: 'category', keywords: ['categorie', 'famille', 'type', 'classe'] },
            { field: 'zone', keywords: ['zone', 'service', 'localisation', 'centre'] },
            { field: 'status', keywords: ['etat', 'statut', 'status', 'condition'] },
            { field: 'station', keywords: ['station', 'bureau', 'poste', 'emplacement'] }
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
          toast.error("Le fichier est vide");
        }
        setImporting(false);
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la lecture du fichier");
      setImporting(false);
    }
  };

  const processImport = async () => {
    if (!auth.currentUser || rawFileData.length === 0) return;
    
    setImporting(true);
    try {
      const idToken = await auth.currentUser!.getIdToken();
      
      // Transform data based on mapping
      const formattedData = rawFileData.map((row: any) => ({
        name: row[columnMapping.name] || "Bénéficiaire Inconnu",
        category: row[columnMapping.category],
        zone: row[columnMapping.zone],
        status: row[columnMapping.status] || "fonctionnel",
        station: row[columnMapping.station],
        details: {
          // You could add dynamic detail mapping here too
          source: "Import Migration"
        }
      }));

      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-user-uid": auth.currentUser!.uid,
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

  const updateItemInList = (key: keyof GlobalSettings, id: string, label: string) => {
    setSettings(prev => ({
      ...prev,
      [key]: prev[key].map((item: any) => item.id === id ? { ...item, label } : item)
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
                      onChange={(e) => updateItemInList("zones", zone.id, e.target.value)}
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
                  <div key={station.id} className="flex gap-2 items-center">
                    <Input 
                      value={station.label} 
                      onChange={(e) => updateItemInList("stations", station.id, e.target.value)}
                      className="h-10 text-sm font-medium"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeFromList("stations", station.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </Button>
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
                      onChange={(e) => updateItemInList("categories", cat.id, e.target.value)}
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
                  <div className="border-2 border-dashed border-zinc-200 rounded-xl p-12 flex flex-col items-center justify-center text-center gap-4 hover:border-accent/40 hover:bg-accent/5 transition-all cursor-pointer relative">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls, .csv" 
                      className="absolute inset-0 opacity-0 cursor-pointer"
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
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-text-dark">Déposez votre fichier désordonné ici</p>
                          <p className="text-xs text-muted-foreground">Nous allons vous aider à mapper les données.</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {importStep === 'mapping' && (
                  <div className="space-y-6">
                    <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100 flex items-center justify-between">
                      <p className="text-sm font-medium text-zinc-600">
                        <span className="font-black text-accent">{rawFileData.length}</span> lignes détectées. Mappez vos colonnes :
                      </p>
                      <Button variant="ghost" size="sm" onClick={() => setImportStep('upload')} className="text-xs font-bold uppercase">Changer de fichier</Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[
                        { id: 'name', label: 'Nom / Désignation', req: true },
                        { id: 'category', label: 'Catégorie', req: true },
                        { id: 'zone', label: 'Zone / Service', req: true },
                        { id: 'station', label: 'Station / Bureau', req: false },
                        { id: 'status', label: 'État / Statut', req: false }
                      ].map((field) => (
                        <div key={field.id} className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                            {field.label}
                            {field.req && <span className="text-red-500">*</span>}
                          </Label>
                          <Select 
                            value={columnMapping[field.id]} 
                            onValueChange={(val) => setColumnMapping(prev => ({ ...prev, [field.id]: val }))}
                          >
                            <SelectTrigger className="bg-white border-border-custom h-10">
                              <SelectValue placeholder="Choisir une colonne..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="non_mappe" className="text-muted-foreground italic">Ne pas mapper</SelectItem>
                              {availableColumns.map(col => (
                                <SelectItem key={col} value={col}>{col}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-border-custom flex justify-end">
                      <Button 
                        onClick={processImport} 
                        disabled={importing || !columnMapping.name || !columnMapping.category || !columnMapping.zone}
                        className="bg-accent hover:bg-accent/90 text-white font-black px-10 h-11"
                      >
                        {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        LANCER L'IMPORTATION NETTOYÉE
                      </Button>
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
