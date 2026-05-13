import React, { useState, useEffect } from "react";
import { GlobalSettings, AppUser, UserRole } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, Plus, Trash2, Save, Users, Settings2, MapPin,
  ShieldCheck, Key, UserPlus, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

interface AdminSettingsProps {
  isBypass?: boolean;
}

export function AdminSettings({ isBypass = false }: AdminSettingsProps) {
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [dbMode,         setDbMode]         = useState<string>("Vérification...");
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // ── Formulaire : username comme identifiant principal ────
  const [newUser, setNewUser] = useState({
    username:    "",
    password:    "",
    displayName: "",
    role:        "agent_logistique" as UserRole,
  });

  const [users, setUsers] = useState<AppUser[]>([]);

  const [settings, setSettings] = useState<GlobalSettings>({
    categories: [],
    zones: [],
    stations: [],
    roles: [
      { id: "admin",                      label: "Administrateur" },
      { id: "chef_service_administratif", label: "Chef Service Administratif" },
      { id: "agent_logistique",           label: "Agent Logistique" },
      { id: "csph",                       label: "CSPH" },
    ],
  });

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetUser, setResetUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // ── Chargement initial ────────────────────────────────────
  useEffect(() => {
    checkHealth();
    fetchConfig();
    fetchUsers();
  }, []);

  async function checkHealth() {
    try {
      const res = await apiFetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setDbMode(data.mode || "Inconnu");
      }
    } catch { setDbMode("Erreur de connexion"); }
  }

  async function fetchConfig() {
    try {
      const res = await apiFetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => ({
          ...prev,
          categories: (data.categories || []).map((c: any) => ({ id: c.id, label: c.label, icon: "Box" })),
          zones:      (data.zones      || []).map((z: any) => ({ id: z.id, label: z.name })),
          stations:   (data.stations   || []).map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
        }));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function fetchUsers() {
    try {
      const res = await apiFetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.map((u: any) => ({
          uid: String(u.id ?? u.uid),
          email: u.email || "",
          role: u.role,
          displayName: u.display_name || u.displayName || u.username || u.email?.split("@")[0] || "",
          username: u.username || u.email?.split("@")[0] || "",
        })));
      } else {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const err = await res.json();
          console.error("fetchUsers error:", res.status, err);
        }
      }
    } catch (e) { console.error("fetchUsers:", e); }
  }

  // ── Sauvegarde config ────────────────────────────────────
  async function handleSaveSettings() {
    setSaving(true);
    try {
      const res = await apiFetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toast.success("Configuration mise à jour");
        fetchConfig();
      } else {
        const err = await res.json();
        throw new Error(err.error || "Erreur serveur");
      }
    } catch (e: any) {
      toast.error(`Échec : ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Créer un utilisateur (username uniquement) ───────────
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password.trim()) {
      toast.error("Nom d'utilisateur et mot de passe obligatoires");
      return;
    }
    setIsCreatingUser(true);
    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username:    newUser.username.trim(),
          password:    newUser.password,
          displayName: newUser.displayName.trim() || undefined,
          role:        newUser.role,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Erreur serveur");

      toast.success(`Utilisateur "${result.display_name || result.username}" créé avec succès`);
      setNewUser({ username: "", password: "", displayName: "", role: "agent_logistique" });
      await fetchUsers();
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    } finally {
      setIsCreatingUser(false);
    }
  }

  // ── Changer le rôle ──────────────────────────────────────
  async function handleUpdateUserRole(uid: string, newRole: UserRole) {
    try {
      const res = await apiFetch(`/api/admin/users/${uid}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        toast.success("Rôle mis à jour");
        setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
      } else {
        const err = await res.json();
        throw new Error(err.error || "Échec");
      }
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  }

  // ── Supprimer un utilisateur ─────────────────────────────
  async function handleDeleteUser(uid: string) {
    if (!confirm("Supprimer définitivement cet utilisateur ?")) return;
    try {
      const res = await apiFetch(`/api/admin/users/${uid}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        toast.success("Utilisateur supprimé");
        setUsers(prev => prev.filter(u => u.uid !== uid));
      } else {
        const err = await res.json();
        throw new Error(err.error || "Échec");
      }
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  }

  async function handleResetPassword() {
    if (!newPassword || !confirmPassword) {
      toast.error("Veuillez saisir le nouveau mot de passe et le confirmer");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }
    setResetting(true);
    try {
      const res = await apiFetch(`/api/admin/users/${resetUser.uid}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      if (res.ok) {
        toast.success("Mot de passe réinitialisé avec succès");
        setResetDialogOpen(false);
        setNewPassword("");
        setConfirmPassword("");
        setResetUser(null);
      } else {
        const err = await res.json();
        throw new Error(err.error || "Échec");
      }
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    } finally {
      setResetting(false);
    }
  }

  // ── Helpers liste settings ────────────────────────────────
  const addToList = (key: keyof GlobalSettings, item: any) =>
    setSettings(prev => ({ ...prev, [key]: [...(prev[key] as any[]), item] }));

  const removeFromList = (key: keyof GlobalSettings, id: string) =>
    setSettings(prev => ({ ...prev, [key]: (prev[key] as any[]).filter((i: any) => i.id !== id) }));

  const updateInList = (key: keyof GlobalSettings, id: string, patch: Record<string, any>) =>
    setSettings(prev => ({
      ...prev,
      [key]: (prev[key] as any[]).map((i: any) => i.id === id ? { ...i, ...patch } : i),
    }));

  // ── Utilisateur courant ──────────────────────────────────
  const currentUserId = (() => {
    try { return String(JSON.parse(localStorage.getItem("helios_user") || "{}").id || ""); }
    catch { return ""; }
  })();

  const sortedZones = [...settings.zones].sort((a, b) => a.label.localeCompare(b.label));
  const sortedStations = [...settings.stations].sort((a, b) => a.label.localeCompare(b.label));
  const stationsByZone = sortedStations.reduce<Record<string, typeof sortedStations>>((acc, station) => {
    const zoneKey = (station as any).zoneId || "unassigned";
    acc[zoneKey] = acc[zoneKey] || [];
    acc[zoneKey].push(station);
    return acc;
  }, {});
  const unassignedStations = stationsByZone["unassigned"] || [];

  const removeZone = (zoneId: string) => setSettings(prev => ({
    ...prev,
    zones: prev.zones.filter(zone => zone.id !== zoneId),
    stations: (prev.stations as any[]).map(station => station.zoneId === zoneId ? { ...station, zoneId: "" } : station),
  }));

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-accent" />
      <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Initialisation...</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-text-dark tracking-tight">Configuration Super User</h2>
          <p className="text-sm text-muted-foreground">Contrôle total du système HELIOS.</p>
        </div>
        <Button onClick={handleSaveSettings} disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-10 shadow-lg shadow-emerald-200 transition-all hover:scale-105 active:scale-95">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          ENREGISTRER LA CONFIGURATION
        </Button>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid grid-cols-2 w-full max-w-sm h-12 bg-white border border-border-custom p-1 mb-8">
          <TabsTrigger value="logic" className="font-bold gap-2"><Settings2 size={16} />Logique Métier</TabsTrigger>
          <TabsTrigger value="users" className="font-bold gap-2"><Users size={16} />Utilisateurs</TabsTrigger>
        </TabsList>

        {/* ══ ONGLET LOGIQUE MÉTIER ══ */}
        <TabsContent value="logic" className="space-y-8 mt-0">

          {/* Indicateur BD */}
          <div className="flex items-center gap-3 bg-zinc-50 p-4 rounded-xl border border-zinc-200 shadow-sm">
            <div className={`p-2 rounded-full ${dbMode.includes("Réel") ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {dbMode.includes("Réel") ? <ShieldCheck size={20} /> : <AlertCircle size={20} />}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Source de Données</p>
              <p className="text-sm font-black">{dbMode}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

            {/* Zones */}
            <Card className="border-border-custom shadow-sm">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><MapPin size={20} /></div>
                  <div>
                    <CardTitle className="text-base font-bold">Zones (Services)</CardTitle>
                    <CardDescription className="text-xs italic">Ex : Opérations, Administratif...</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {settings.zones.map(zone => (
                  <div key={zone.id} className="flex gap-2 items-center">
                    <Input
                      value={zone.label}
                      onChange={e => updateInList("zones", zone.id, { label: e.target.value })}
                      className="h-10 text-sm font-medium"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeFromList("zones", zone.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" className="w-full h-10 border-dashed text-xs font-bold uppercase tracking-wider"
                  onClick={() => addToList("zones", { id: crypto.randomUUID(), label: "Nouveau Service" })}>
                  <Plus size={14} className="mr-2" />Nouveau Service
                </Button>
              </CardContent>
            </Card>

            {/* Stations */}
            <Card className="border-border-custom shadow-sm">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><MapPin size={20} /></div>
                  <div>
                    <CardTitle className="text-base font-bold">Stations (Bureaux)</CardTitle>
                    <CardDescription className="text-xs italic">Ex : Bureau 101, Garage A...</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {sortedZones.map(zone => (
                  <div key={zone.id} className="space-y-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{zone.label}</p>
                        <p className="text-[11px] text-muted-foreground">Stations rattachées à ce service</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => removeZone(zone.id)}
                          className="text-red-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 px-3"
                          onClick={() => addToList("stations", { id: crypto.randomUUID(), label: "Nouveau Bureau", zoneId: zone.id })}>
                          Ajouter un bureau
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {(stationsByZone[zone.id] || []).map(station => (
                        <div key={station.id} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-white rounded-lg border border-zinc-100">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Nom du Bureau</Label>
                            <Input
                              value={station.label}
                              onChange={e => updateInList("stations", station.id, { label: e.target.value })}
                              className="h-9 text-sm font-medium bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Service Rattaché</Label>
                            <div className="flex gap-2">
                              <Select
                                value={(station as any).zoneId || ""}
                                onValueChange={val => updateInList("stations", station.id, { zoneId: val })}>
                                <SelectTrigger className="h-9 bg-white text-[11px] font-bold">
                                  <SelectValue>
                                    {settings.zones.find(z => z.id === (station as any).zoneId)?.label || "Choisir un service"}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {sortedZones.map(z => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="icon" onClick={() => removeFromList("stations", station.id)}
                                className="text-red-400 hover:text-red-600 h-9 w-9 shrink-0">
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {unassignedStations.length > 0 && (
                  <div className="space-y-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">Stations non assignées</p>
                        <p className="text-[11px] text-muted-foreground">Affectez ces bureaux à un service existant.</p>
                      </div>
                      <Button variant="outline" size="sm" className="h-9 px-3"
                        onClick={() => addToList("stations", { id: crypto.randomUUID(), label: "Nouveau Bureau" })}>
                        Ajouter un bureau
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {unassignedStations.map(station => (
                        <div key={station.id} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-white rounded-lg border border-zinc-100">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Nom du Bureau</Label>
                            <Input
                              value={station.label}
                              onChange={e => updateInList("stations", station.id, { label: e.target.value })}
                              className="h-9 text-sm font-medium bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Service Rattaché</Label>
                            <div className="flex gap-2">
                              <Select
                                value={(station as any).zoneId || ""}
                                onValueChange={val => updateInList("stations", station.id, { zoneId: val })}>
                                <SelectTrigger className="h-9 bg-white text-[11px] font-bold">
                                  <SelectValue>
                                    {settings.zones.find(z => z.id === (station as any).zoneId)?.label || "Choisir un service"}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {sortedZones.map(z => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="icon" onClick={() => removeFromList("stations", station.id)}
                                className="text-red-400 hover:text-red-600 h-9 w-9 shrink-0">
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {sortedZones.length === 0 && unassignedStations.length === 0 && (
                  <div className="text-sm text-muted-foreground">Aucun bureau configuré. Ajoutez un service puis rattachez les bureaux.</div>
                )}
                <Button variant="outline" className="w-full h-10 border-dashed text-xs font-bold uppercase tracking-wider"
                  onClick={() => addToList("stations", { id: crypto.randomUUID(), label: "Nouveau Bureau" })}>
                  <Plus size={14} className="mr-2" />Nouveau Bureau
                </Button>
              </CardContent>
            </Card>

            {/* Catégories */}
            <Card className="border-border-custom shadow-sm lg:col-span-2">
              <CardHeader className="bg-[#fafbfc] border-b border-border-custom pb-4">
                <CardTitle className="text-base font-bold">Catégories d'Équipements</CardTitle>
                <CardDescription className="text-xs">Identifiez les types d'actifs gérés dans le système.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {settings.categories.map(cat => (
                  <div key={cat.id} className="flex gap-2 items-center bg-zinc-50 p-2 rounded-lg border border-zinc-100">
                    <Input
                      value={cat.label}
                      onChange={e => updateInList("categories", cat.id, { label: e.target.value })}
                      className="h-9 text-xs font-bold bg-white"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeFromList("categories", cat.id)}
                      className="text-red-400 h-8 w-8">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" className="h-9 border-dashed text-[10px] font-black uppercase"
                  onClick={() => addToList("categories", { id: crypto.randomUUID(), label: "Nouvelle Catégorie", icon: "Box" })}>
                  <Plus size={12} className="mr-2" />Catégorie
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ══ ONGLET UTILISATEURS ══ */}
        <TabsContent value="users" className="mt-0 space-y-8">

          {/* Formulaire création */}
          <Card className="border-accent/30 border-dashed bg-accent/5 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent text-white rounded-lg"><UserPlus size={20} /></div>
                <div>
                  <CardTitle className="text-base font-bold text-accent">Ajouter un Collaborateur</CardTitle>
                  <CardDescription>Créez un compte pour un nouvel agent du système.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <form onSubmit={handleCreateUser} className="space-y-6">

                {/* Champs principaux */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Nom complet */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">
                      Nom complet <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      required
                      value={newUser.displayName}
                      onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))}
                      placeholder="Ex : Jean Dupont"
                      className="bg-white h-12 text-base"
                    />
                  </div>

                  {/* Username */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">
                      Nom d'utilisateur <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      required
                      value={newUser.username}
                      onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
                      placeholder="Ex : jean.dupont"
                      className="bg-white h-12 text-base"
                    />
                  </div>

                  {/* Mot de passe */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">
                      Mot de passe <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="password"
                      required
                      value={newUser.password}
                      onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                      placeholder="••••••••"
                      className="bg-white h-12 text-base"
                    />
                  </div>

                  {/* Rôle */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">Rôle</Label>
                    <Select value={newUser.role} onValueChange={(v: UserRole) => setNewUser(p => ({ ...p, role: v }))}>
                      <SelectTrigger className="w-full bg-white h-12 text-base border-border-custom">
                        <SelectValue placeholder="Sélectionnez un rôle" />
                      </SelectTrigger>
                      <SelectContent>
                        {settings.roles.map(r => (
                          <SelectItem key={r.id} value={r.id} className="text-base">{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                </div>

                {/* Bouton de création */}
                <div className="flex justify-center pt-4">
                  <Button type="submit" disabled={isCreatingUser}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-8 h-12 min-w-[200px] shadow-lg shadow-orange-300/40 transition-all hover:scale-105 active:scale-95">
                    {isCreatingUser
                      ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Création en cours...</>
                      : <><Plus className="w-5 h-5 mr-2" />CRÉER LE COMPTE</>}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Liste utilisateurs */}
          <Card className="border-border-custom shadow-sm overflow-hidden">
            <CardHeader className="bg-white border-b border-border-custom flex flex-row items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent/10 text-accent rounded-lg"><Users size={20} /></div>
                <div>
                  <CardTitle className="text-base font-bold">Comptes Utilisateurs</CardTitle>
                  <CardDescription>Gérez les droits d'accès de chaque agent.</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black bg-zinc-100 px-3 py-1 rounded-full text-zinc-500 uppercase tracking-widest">
                  {users.length} compte{users.length !== 1 ? "s" : ""}
                </span>
                <Button variant="outline" size="sm" className="h-8 text-xs font-bold" onClick={fetchUsers}>
                  Rafraîchir
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {users.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 opacity-30">
                  <Users size={40} strokeWidth={1} />
                  <p className="text-sm font-bold">Aucun utilisateur</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-border-custom">
                        {['Utilisateur', "Nom d'utilisateur", 'Rôle', 'Actions'].map(h => (
                          <th key={h} className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[2px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => (
                        <tr key={user.uid} className="border-b border-border-custom hover:bg-[#fafbfc] transition-colors">

                          {/* Nom */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 font-black text-sm border border-zinc-200">
                                {(user.displayName || user.username || "?").substring(0, 1).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-black text-slate-800">{user.displayName || "Agent Helios"}</p>
                                {user.uid === currentUserId && (
                                  <span className="text-[9px] font-black text-accent uppercase tracking-wider">Vous</span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Username */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                              <span className="opacity-40">@</span>{user.username}
                            </div>
                          </td>

                          {/* Rôle */}
                          <td className="px-6 py-4 min-w-[220px]">
                            <Select
                              value={user.role}
                              onValueChange={(v: UserRole) => handleUpdateUserRole(user.uid, v)}
                              disabled={user.uid === currentUserId}
                            >
                              <SelectTrigger className="w-full h-9 bg-white border-border-custom text-xs font-bold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {settings.roles.map(r => (
                                  <SelectItem key={r.id} value={r.id} className="text-xs font-bold">{r.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>

                          {/* Actions */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm"
                                className="h-8 w-8 p-0 text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100"
                                title="Réinitialiser le mot de passe"
                                onClick={() => { setResetUser(user); setResetDialogOpen(true); }}>
                                <Key size={14} />
                              </Button>
                              <Button variant="outline" size="sm"
                                className="h-8 w-8 p-0 text-red-600 border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-30"
                                title="Supprimer"
                                disabled={user.uid === currentUserId}
                                onClick={() => handleDeleteUser(user.uid)}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Réinitialiser le mot de passe pour <strong>{resetUser?.displayName || resetUser?.username}</strong>
            </p>
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nouveau mot de passe</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              {resetting ? <Loader2 className="animate-spin" /> : "Réinitialiser"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

