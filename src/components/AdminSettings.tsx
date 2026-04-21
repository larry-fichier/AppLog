import React, { useState, useEffect } from "react";
import { db, doc, getDoc, setDoc, collection, onSnapshot, updateDoc, auth, sendPasswordResetEmail } from "@/lib/firebase";
import { GlobalSettings, AppUser, UserRole } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save, Users, Settings2, MapPin, ShieldCheck, Mail, Key, UserPlus } from "lucide-react";
import { toast } from "sonner";

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
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
        <TabsList className="grid grid-cols-2 w-full max-w-md h-12 bg-white border border-border-custom p-1 mb-8">
          <TabsTrigger value="logic" className="font-bold gap-2">
            <Settings2 size={16} />
            Logique Métier
          </TabsTrigger>
          <TabsTrigger value="users" className="font-bold gap-2">
            <Users size={16} />
            Utilisateurs & Accès
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
      </Tabs>
    </div>
  );
}
