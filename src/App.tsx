import * as React from "react";
import { useState, useEffect } from "react";
import { db, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, doc, getDoc, setDoc } from "@/lib/firebase";
import { EquipmentDashboard } from "@/components/EquipmentDashboard";
import { AdminSettings } from "@/components/AdminSettings";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, LogIn, LogOut, LayoutDashboard, Car, Utensils, Laptop, Zap, Settings as SettingsIcon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

import { AppUser, UserRole } from "@/types";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [dynamicSettings, setDynamicSettings] = useState<GlobalSettings | null>(null);
  const [isBypass, setIsBypass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string>("dashboard");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Also fetch dynamic settings
      try {
        const snap = await getDoc(doc(db, "config", "global"));
        if (snap.exists()) setDynamicSettings(snap.data() as GlobalSettings);
      } catch (e) {
        console.error("Config fetch error", e);
      }

      if (currentUser) {
        // Fetch role from Firestore
        try {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data() as AppUser);
          } else {
            // Default role if not found
            const defaultProfile: AppUser = {
              uid: currentUser.uid,
              email: currentUser.email || "",
              role: "agent_logistique"
            };
            await setDoc(doc(db, "users", currentUser.uid), defaultProfile);
            setUserProfile(defaultProfile);
          }
        } catch (e) {
          console.error("Error fetching user profile", e);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
        toast.success("Compte créé avec succès !");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success("Connexion réussie.");
      }
    } catch (error: any) {
      console.error("Auth action failed", error);
      if (error.code === "auth/operation-not-allowed") {
        toast.error("L'authentification par email n'est pas activée dans la console Firebase.");
      } else if (error.code === "auth/email-already-in-use") {
        toast.error("Cet email est déjà utilisé.");
      } else if (error.code === "auth/invalid-credential") {
        toast.error("Identifiants incorrects.");
      } else {
        toast.error("Échec de l'authentification.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const currentRole = isBypass ? "chef_bureau_logistique" : userProfile?.role || "agent_logistique";
  const userDisplayName = isBypass ? "Administrateur Démo" : userProfile?.displayName || user?.email || "Utilisateur";
  const isAdmin = currentRole === "admin" || currentRole === "chef_bureau_logistique";
  const isReadOnly = currentRole === "csph" || currentRole === "chef_service_administratif";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg-main">
        <Loader2 className="w-10 h-10 animate-spin text-accent" />
        <p className="mt-4 text-muted-foreground animate-pulse">Synchronisation sécurisée...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg-main font-sans transition-colors duration-300">
      <Toaster position="top-right" richColors />
      
      {(user || isBypass) ? (
        <>
          <aside className="w-64 bg-sidebar-bg text-text-light flex flex-col py-8 shrink-0 z-50">
            <div className="px-8 pb-10 mb-8 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-orange rounded-lg flex items-center justify-center font-black text-white text-xl shadow-md transition-transform hover:scale-105 duration-300">H</div>
                <div className="flex flex-col">
                  <div className="text-xl font-black tracking-[2px] text-white">HELIOS</div>
                  <div className="text-[8px] font-bold text-white/30 tracking-widest uppercase">Gestion Logistique</div>
                </div>
              </div>
            </div>
            
            <nav className="flex flex-col flex-1 px-4 gap-1">
              <button 
                onClick={() => setActiveMenu("dashboard")}
                className={`px-5 py-3.5 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${activeMenu === "dashboard" ? "bg-brand-orange text-white border-brand-orange shadow-md" : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"}`}
              >
                <LayoutDashboard size={18} />
                <span>Vue d'ensemble</span>
              </button>
              
              <button 
                onClick={() => setActiveMenu("fleet")}
                className={`px-5 py-3.5 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${activeMenu === "fleet" ? "bg-brand-orange text-white border-brand-orange shadow-md" : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"}`}
              >
                <Car size={18} />
                <span>Parc Automobile</span>
              </button>

              <button 
                onClick={() => setActiveMenu("catering")}
                className={`px-5 py-3.5 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${activeMenu === "catering" ? "bg-brand-orange text-white border-brand-orange shadow-md" : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"}`}
              >
                <Utensils size={18} />
                <span>Unités de Restauration</span>
              </button>

              <button 
                onClick={() => setActiveMenu("digital")}
                className={`px-5 py-3.5 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${activeMenu === "digital" ? "bg-brand-orange text-white border-brand-orange shadow-md" : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"}`}
              >
                <Laptop size={18} />
                <span>Actifs Numériques</span>
              </button>

              <button 
                onClick={() => setActiveMenu("energy")}
                className={`px-5 py-3.5 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${activeMenu === "energy" ? "bg-brand-orange text-white border-brand-orange shadow-md" : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"}`}
              >
                <Zap size={18} />
                <span>Énergie & Groupes</span>
              </button>
              
              <div className="mt-auto flex flex-col gap-1 border-t border-white/5 pt-6 pb-2">
                {isAdmin && (
                  <button 
                    onClick={() => setActiveMenu("settings")}
                    className={`px-5 py-3.5 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${activeMenu === "settings" ? "bg-brand-orange text-white border-brand-orange shadow-md" : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"}`}
                  >
                    <SettingsIcon size={18} className={activeMenu === "settings" ? "opacity-100" : "opacity-40"} />
                    <span>Configuration</span>
                  </button>
                )}
              </div>
            </nav>
          </aside>

          <main className="flex-1 flex flex-col p-8 gap-8 min-w-0 bg-[#f8fafc]/50">
            <ErrorBoundary>
              <header className="flex justify-between items-end border-b border-border-custom pb-6">
                <div className="space-y-1">
                   <h1 className="text-3xl font-black text-text-dark tracking-tight">SYSTÈME HELIOS</h1>
                   <p className="text-sm text-[#7f8c8d] font-medium uppercase tracking-widest">Gestion des Ressources Logistiques</p>
                </div>
                <div className="flex items-center gap-4 bg-white p-2 rounded-xl border border-border-custom shadow-sm">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent font-bold">
                     {(user?.email || "D").substring(0, 1).toUpperCase()}
                  </div>
                    <div className="flex flex-col pr-4 border-r border-border-custom text-right">
                    <span className="text-[10px] font-bold text-[#b2bec3] uppercase tracking-[1px]">
                      {dynamicSettings?.roles?.find((r: any) => r.id === (isBypass ? "chef_bureau_logistique" : currentRole))?.label || (isBypass ? "Administrateur" : "Accès Standard")}
                    </span>
                    <span className="text-sm font-bold text-text-dark leading-tight">{userDisplayName}</span>
                  </div>
                  <button onClick={() => isBypass ? setIsBypass(false) : handleLogout()} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="Déconnexion">
                     <LogOut size={20} />
                  </button>
                </div>
              </header>
              <div className="flex-1 min-h-0">
                {activeMenu === "settings" && isAdmin ? (
                  <AdminSettings isBypass={isBypass} />
                ) : (
                  <EquipmentDashboard 
                    isBypass={isBypass}
                    activeRole={currentRole as any}
                    defaultCategory={activeMenu === "dashboard" ? "all" : activeMenu === "fleet" ? "rame" : activeMenu === "catering" ? "cuisine" : activeMenu === "digital" ? "electronique" : "groupe"} 
                  />
                )}
              </div>
              <footer className="flex justify-between items-center py-6 border-t border-border-custom">
                <div className="text-[10px] font-bold text-[#b2bec3] uppercase tracking-[2px]">
                   Système de Gestion G-Logistique v1.2
                </div>
                <div className="text-[10px] text-muted-foreground font-medium">
                  &copy; {new Date().getFullYear()} Logistix • Sécurisé par Cloud Infrastructure
                </div>
              </footer>
            </ErrorBoundary>
          </main>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#fafbfc] relative overflow-hidden">
          {/* Animated background elements */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/5 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-success/5 rounded-full blur-[100px]" />
          
          <div className="w-full max-w-md z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <Card className="border-none shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)] bg-white rounded-2xl overflow-hidden">
              <div className="h-2 w-full bg-accent" />
              <div className="p-10">
                <div className="flex flex-col items-center text-center mb-10">
                  <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-accent/20 transform -rotate-3 hover:rotate-0 transition-transform duration-500">
                    <LayoutDashboard className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-3xl font-black text-text-dark tracking-tight mb-2">HELIOS PORTAL</h2>
                  <p className="text-sm font-medium text-[#7f8c8d] uppercase tracking-[3px]">Accès restreint au personnel</p>
                </div>

                <form onSubmit={handleAuthAction} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                       <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">Identifiant Personnel</label>
                       <div className="relative">
                          <LogIn size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#bdc3c7]" />
                          <input 
                            type="email"
                            placeholder="votre.nom@logistix.com"
                            className="w-full pl-12 pr-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                       </div>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">Clé d'Accès Sécurisée</label>
                       <input 
                         type="password"
                         placeholder="••••••••"
                         className="w-full px-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                         value={password}
                         onChange={(e) => setPassword(e.target.value)}
                         required
                       />
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-12 bg-accent hover:bg-accent/90 text-white font-black text-sm tracking-widest transition-all hover:scale-[1.02] shadow-lg shadow-accent/20"
                    disabled={isLoggingIn}
                  >
                    {isLoggingIn ? <Loader2 className="animate-spin" /> : isRegistering ? "CRÉER MON COMPTE" : "ACCÉDER AU PORTAIL"}
                  </Button>

                  <div className="text-center space-y-4">
                    <button 
                      type="button"
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="text-[11px] font-bold text-accent hover:underline uppercase tracking-wider"
                    >
                      {isRegistering ? "Déjà un compte ? Se connecter" : "Pas de compte ? S'enregistrer"}
                    </button>

                    <div className="pt-2 flex flex-col gap-2">
                       <button
                         type="button"
                         onClick={() => {
                           setEmail("admin@logistix.com");
                           setPassword("password123");
                           toast.info("Identifiants de test appliqués. Cliquez sur le bouton principal.");
                         }}
                         className="text-[10px] font-bold text-[#b2bec3] hover:text-accent border border-[#f1f2f6] px-4 py-2 rounded-full transition-all uppercase tracking-widest"
                       >
                         Utiliser un compte de test
                       </button>

                       <button
                         type="button"
                         onClick={() => {
                           setLoading(false);
                            setIsBypass(true);
                           toast.success("Mode démonstration activé. Bienvenue !");
                         }}
                         className="text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 px-6 py-2.5 rounded-full transition-all uppercase tracking-[2px] shadow-sm hover:shadow-md active:scale-95 focus:outline-none"
                       >
                         ⚡ ACCÈS DIRECT SANS COMPTE
                       </button>
                    </div>
                  </div>
                </form>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
