import * as React from "react";
import { useState, useEffect } from "react";
import { EquipmentDashboard } from "@/components/EquipmentDashboard";
import { AdminSettings } from "@/components/AdminSettings";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Loader2, LogIn, LogOut, LayoutDashboard,
  Settings as SettingsIcon, ArrowLeftRight,
  ChevronDown, ChevronRight, Box,
  Car, Utensils, Laptop, Zap, Thermometer,
  Truck, Archive, ShieldAlert,
  Bell, Moon, Sun, Package,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { MovementsPage } from "@/components/MovementsPage";
import { SupervisionDashboard } from "@/components/SupervisionDashboard";

// ── Intercepteur fetch : refresh automatique du token ─────────
let isRefreshing = false;
let pendingRequests: Array<(retry: boolean) => void> = [];

const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  // Ne pas intercepter la route de refresh elle-même
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.includes("/api/auth/refresh") || url.includes("/api/auth/login")) {
    return originalFetch(input, init);
  }

  const response = await originalFetch(input, init);

  if (response.status === 401) {
    // Si un refresh est déjà en cours, attendre sa résolution
    if (isRefreshing) {
      return new Promise((resolve) => {
        pendingRequests.push((success) => {
          if (success) resolve(originalFetch(input, init));
          else resolve(response);
        });
      });
    }

    isRefreshing = true;
    try {
      const refreshRes = await originalFetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });

      if (refreshRes.ok) {
        // Mettre à jour l'utilisateur en localStorage
        const data = await refreshRes.json();
        if (data.user) {
          sessionStorage.setItem("helios_user", JSON.stringify(data.user));
        }
        // Résoudre les requêtes en attente
        pendingRequests.forEach(cb => cb(true));
        pendingRequests = [];
        // Relancer la requête originale
        return originalFetch(input, init);
      } else {
        // Refresh échoué → déconnexion propre
        pendingRequests.forEach(cb => cb(false));
        pendingRequests = [];
        sessionStorage.removeItem("helios_user");
        window.dispatchEvent(new CustomEvent("helios:session-expired"));
        return response;
      }
    } catch {
      pendingRequests.forEach(cb => cb(false));
      pendingRequests = [];
      return response;
    } finally {
      isRefreshing = false;
    }
  }

  return response;
};

// ── Icône dynamique par label de catégorie ─────────────────
function getCatIcon(label: string = "", size = 16) {
  const l = label.toLowerCase();
  if (l.includes("rame") || l.includes("véhicule") || l.includes("vehicule") || l.includes("automobile")) return <Car size={size} />;
  if (l.includes("cuisine") || l.includes("frigo") || l.includes("réfrigér"))  return <Utensils size={size} />;
  if (l.includes("informatique") || l.includes("it") || l.includes("ordinateur") || l.includes("electronique")) return <Laptop size={size} />;
  if (l.includes("énergie") || l.includes("energie") || l.includes("groupe") || l.includes("générateur") || l.includes("generateur")) return <Zap size={size} />;
  if (l.includes("clim") || l.includes("climatiseur"))  return <Thermometer size={size} />;
  if (l.includes("transport") || l.includes("camion"))  return <Truck size={size} />;
  if (l.includes("exploitation") || l.includes("matériel") || l.includes("materiel")) return <Package size={size} />;
  return <Box size={size} />;
}

// ── Types menu ─────────────────────────────────────────────
type MenuId = "dashboard" | "movements" | `cat_${string}` | "settings";

interface NavItem {
  id: MenuId;
  label: string;
  icon: React.ReactNode;
  children?: { id: MenuId; label: string; icon: React.ReactNode; categoryId: string }[];
}

// ── Helper : initiale sécurisée ────────────────────────────
function getInitial(user: any): string {
  const name = user?.displayName || user?.username || "";
  return name.substring(0, 1).toUpperCase() || "U";
}

// ── Helper : nom affiché ───────────────────────────────────
function getDisplayName(user: any): string {
  return user?.displayName || user?.username || "Utilisateur";
}

export default function App() {
  const [user, setUser]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]   = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);

  const [activeMenu, setActiveMenu]         = useState<MenuId>("dashboard");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["inventaire"]));

  const [dynamicSettings, setDynamicSettings] = useState<GlobalSettings | null>(null);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);

  // ── Dark mode ──────────────────────────────────────────
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("helios_theme") === "dark";
  });

  React.useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
      root.style.setProperty("--color-bg-main", "#0f172a");
      root.style.setProperty("--color-text-dark", "#e2e8f0");
      root.style.setProperty("--color-border-custom", "#1e293b");
      root.style.setProperty("--color-text-light", "#94a3b8");
    } else {
      root.classList.remove("dark");
      root.style.removeProperty("--color-bg-main");
      root.style.removeProperty("--color-text-dark");
      root.style.removeProperty("--color-border-custom");
      root.style.removeProperty("--color-text-light");
    }
    localStorage.setItem("helios_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // ── Notifications SSE ──────────────────────────────────
  const [notifications, setNotifications] = useState<{ id: number; message: string; type: string; read: boolean }[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = React.useRef<EventSource | null>(null);
  const notifIdRef = React.useRef(0);

  // ── Écoute expiration de session (déclenchée par l'intercepteur fetch) ──
  React.useEffect(() => {
    const onExpired = () => {
      setUser(null);
      if (notifRef.current) { notifRef.current.close(); }
      toast.error("Votre session a expiré. Veuillez vous reconnecter.");
    };
    window.addEventListener("helios:session-expired", onExpired);
    return () => window.removeEventListener("helios:session-expired", onExpired);
  }, []);

  React.useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/events", { withCredentials: true });
    notifRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "connected") return;
        const id = ++notifIdRef.current;
        const message = event.type === "equipment_critical"
          ? `⚠️ ${event.payload.message}`
          : `📦 Équipement créé`;
        setNotifications(prev => [{ id, message, type: event.type, read: false }, ...prev].slice(0, 50));
      } catch {}
    };
    return () => { es.close(); };
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  // ── Init auth + config ─────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const storedUser = sessionStorage.getItem("helios_user");
      if (storedUser) {
        try {
          const check = await fetch("/api/health", { credentials: "include" });
          if (check.ok) {
            setUser(JSON.parse(storedUser));
          } else if (check.status === 401) {
            // Token expiré → tenter refresh silencieux avant de déconnecter
            try {
              const refreshRes = await originalFetch("/api/auth/refresh", {
                method: "POST",
                credentials: "include",
              });
              if (refreshRes.ok) {
                const data = await refreshRes.json();
                const updatedUser = data.user || JSON.parse(storedUser);
                sessionStorage.setItem("helios_user", JSON.stringify(updatedUser));
                setUser(updatedUser);
              } else {
                sessionStorage.removeItem("helios_user");
              }
            } catch {
              sessionStorage.removeItem("helios_user");
            }
          } else {
            sessionStorage.removeItem("helios_user");
          }
        } catch {
          // Erreur réseau — garder l'utilisateur connecté localement
          setUser(JSON.parse(storedUser));
        }
      }

      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setCategories(data.categories || []);
          setDynamicSettings({
            categories: data.categories || [],
            zones:    (data.zones    || []).map((z: any) => ({ id: z.id, label: z.name })),
            stations: (data.stations || []).map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
            roles: [
              { id: "admin",                      label: "Administrateur" },
              { id: "chef_service_administratif", label: "Chef Service Administratif" },
              { id: "agent_logistique",           label: "Agent Logistique" },
              { id: "csph",                       label: "Chef Suivi Projet HELIOS" },
            ],
          } as any);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    init();
  }, []);

  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch {}
    sessionStorage.removeItem("helios_user");
    setUser(null);
    setIdentifier("");
    setPassword("");
    if (notifRef.current) { notifRef.current.close(); }
    toast.success("Déconnexion réussie.");
  };

  // ── Brute-force protection côté client ─────────────────
  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION_MS = 2 * 60 * 1000;

  const isLocked = lockUntil !== null && Date.now() < lockUntil;
  const remainingLockSeconds = isLocked ? Math.ceil((lockUntil! - Date.now()) / 1000) : 0;

  const handleAuthAction = async (e: { preventDefault(): void }) => {
    e.preventDefault();

    if (isLocked) {
      toast.error(`Trop de tentatives. Réessayez dans ${remainingLockSeconds}s.`);
      return;
    }

    if (!identifier.trim() || !password.trim()) {
      toast.error("Identifiant et mot de passe obligatoires.");
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identifier.trim(), password }),
      });

      if (!res.ok) {
        const err = await res.json();
        const newAttempts = loginAttempts + 1;
        setLoginAttempts(newAttempts);

        if (newAttempts >= MAX_ATTEMPTS) {
          setLockUntil(Date.now() + LOCK_DURATION_MS);
          setLoginAttempts(0);
          toast.error("Compte temporairement bloqué après trop de tentatives (2 min).");
        } else {
          toast.error(err.error || "Identifiants incorrects.");
        }
        return;
      }

      setLoginAttempts(0);
      setLockUntil(null);

      const data = await res.json();
      sessionStorage.setItem("helios_user", JSON.stringify(data.user));
      setUser(data.user);
      setPassword("");
      toast.success("Bienvenue, " + getDisplayName(data.user));
    } catch (err: any) {
      toast.error("Erreur de connexion au serveur.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const currentRole     = user?.role || "agent_logistique";
  const userDisplayName = getDisplayName(user);
  const isAdmin         = ["admin"].includes(currentRole);
  const isSupervisor    = ["chef_service_administratif", "csph"].includes(currentRole);

  // ── Gradient supervisor selon dark mode ───────────────
  const supervisorBg = darkMode
    ? "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)"
    : "linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%)";

  // ── Construction menu dynamique ────────────────────────
  const navItems: NavItem[] = [
    {
      id: "dashboard",
      label: "Vue d'ensemble",
      icon: <LayoutDashboard size={17} />,
    },
    {
      id: "inventaire" as MenuId,
      label: "Inventaire",
      icon: <Archive size={17} />,
      children: categories
        .filter(cat => {
          // L'agent logistique ne voit pas la catégorie Armement dans le menu
          if (currentRole === "agent_logistique" && cat.label.toLowerCase().includes("armement")) return false;
          return true;
        })
        .map(cat => ({
          id: `cat_${cat.id}` as MenuId,
          label: cat.label,
          icon: getCatIcon(cat.label, 14),
          categoryId: cat.id,
        })),
    },
    {
      id: "movements",
      label: "Mouvements",
      icon: <ArrowLeftRight size={17} />,
    },
  ];

  function toggleGroup(id: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Résolution de la vue active ────────────────────────
  function resolveView(): React.ReactNode {
    if (activeMenu === "settings" && isAdmin) {
      return <AdminSettings />;
    }
    if (activeMenu === "movements") {
      return (
        <MovementsPage
          activeRole={currentRole as any}
          isBypass={false}
          zones={dynamicSettings?.zones ?? []}
          stations={(dynamicSettings?.stations ?? []) as any}
        />
      );
    }
    if (activeMenu === "dashboard") {
      return (
        <EquipmentDashboard
          isBypass={false}
          activeRole={currentRole as any}
          defaultCategory="all"
        />
      );
    }
    if (activeMenu.startsWith("cat_")) {
      const catId = activeMenu.replace("cat_", "");
      return (
        <EquipmentDashboard
          isBypass={false}
          activeRole={currentRole as any}
          defaultCategory={catId}
        />
      );
    }
    return null;
  }

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

      {user ? (
        <>
          {/* ══ LAYOUT SUPERVISOR (CSA + CSPH) ══ */}
          {isSupervisor ? (
            <div
              className="flex-1 flex flex-col min-h-screen supervisor-layout"
              style={{ background: supervisorBg }}
            >
              <header className="bg-white/80 backdrop-blur border-b border-slate-200/80 px-8 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
                <div className="flex items-center gap-4">
                  <img src="/logo.jpg" alt="Helios Logo" className="w-10 h-10 rounded-xl shadow-md" />
                  <div>
                    <div className="text-sm font-black tracking-[3px] text-slate-900 uppercase leading-tight">HELIOS</div>
                    <div className="text-[9px] text-slate-400 font-bold tracking-widest uppercase">Système de supervision</div>
                  </div>
                  <div className="ml-4 pl-4 border-l border-slate-200">
                    <div className="text-[10px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                      Tableau de bord — Lecture seule
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-black text-slate-800 leading-tight">{userDisplayName}</div>
                    <div className="text-[10px] text-slate-400 font-bold">
                      {dynamicSettings?.roles?.find((r: any) => r.id === currentRole)?.label || "Superviseur"}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center text-white font-black text-sm shadow">
                    {getInitial(user)}
                  </div>
                  <button
                    onClick={() => setDarkMode(d => !d)}
                    className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    title={darkMode ? "Mode clair" : "Mode sombre"}
                  >
                    {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-red-500 px-3 py-2 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
                  >
                    <LogOut size={14} />Déconnexion
                  </button>
                </div>
              </header>
              <main className="flex-1 p-8 overflow-auto">
                <ErrorBoundary>
                  <SupervisionDashboard isBypass={false} />
                </ErrorBoundary>
              </main>
              <footer className="py-4 px-8 border-t border-slate-200/80 bg-white/60 text-center">
                <p className="text-[10px] text-slate-300 font-medium tracking-widest uppercase">
                  HELIOS · Gestion G-Logistique v1.2 · Accès Superviseur — {new Date().getFullYear()}
                </p>
              </footer>
            </div>
          ) : (
            <>
              {/* ══ SIDEBAR ══ */}
              <aside className="w-64 bg-sidebar-bg text-text-light flex flex-col py-8 shrink-0 z-50">
                <div className="px-8 pb-10 mb-4 border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <img src="/logo.jpg" alt="Helios Logo" className="w-10 h-10 rounded-lg shadow-md hover:scale-105 transition-transform duration-300" />
                    <div className="flex flex-col">
                      <div className="text-xl font-black tracking-[2px] text-white">HELIOS</div>
                      <div className="text-[8px] font-bold text-white/30 tracking-widest uppercase">Gestion Logistique</div>
                    </div>
                  </div>
                </div>

                <nav className="flex flex-col flex-1 px-4 gap-0.5 overflow-y-auto">
                  {navItems.map(item => {
                    const hasChildren     = !!item.children?.length;
                    const isGroupExpanded = expandedGroups.has(item.id);
                    const isGroupActive   = hasChildren && item.children!.some(c => c.id === activeMenu);
                    const isActive        = !hasChildren && activeMenu === item.id;

                    return (
                      <div key={item.id}>
                        <button
                          onClick={() => hasChildren ? toggleGroup(item.id) : setActiveMenu(item.id)}
                          className={`w-full px-4 py-3 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${
                            isActive || isGroupActive
                              ? "bg-brand-orange text-white border-brand-orange shadow-md"
                              : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"
                          }`}
                        >
                          <span className="shrink-0">{item.icon}</span>
                          <span className="flex-1 text-left">{item.label}</span>
                          {hasChildren && (
                            <span className="shrink-0 transition-transform duration-200">
                              {isGroupExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </span>
                          )}
                        </button>

                        {hasChildren && isGroupExpanded && (
                          <div className="ml-3 mt-0.5 mb-1 border-l border-white/10 pl-3 flex flex-col gap-0.5">
                            {item.children!.map(child => (
                              <button
                                key={child.id}
                                onClick={() => setActiveMenu(child.id)}
                                className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-[12px] rounded-lg cursor-pointer transition-all font-bold border ${
                                  activeMenu === child.id
                                    ? "bg-white/10 text-white border-white/10"
                                    : "hover:bg-white/5 text-white/50 hover:text-white/80 border-transparent"
                                }`}
                              >
                                <span className="shrink-0 opacity-70">{child.icon}</span>
                                <span className="flex-1 text-left truncate">{child.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="mt-auto pt-4 border-t border-white/5 flex flex-col gap-0.5">
                    {isAdmin && (
                      <button
                        onClick={() => setActiveMenu("settings")}
                        className={`w-full px-4 py-3 flex items-center gap-3 text-[13px] rounded-lg cursor-pointer transition-all font-bold border ${
                          activeMenu === "settings"
                            ? "bg-brand-orange text-white border-brand-orange shadow-md"
                            : "hover:bg-white/5 text-white/70 hover:text-white border-transparent"
                        }`}
                      >
                        <SettingsIcon size={17} className={activeMenu === "settings" ? "opacity-100" : "opacity-40"} />
                        <span>Configuration</span>
                      </button>
                    )}
                  </div>
                </nav>
              </aside>

              {/* ══ CONTENU PRINCIPAL ══ */}
              <main className="flex-1 flex flex-col p-8 gap-8 min-w-0 bg-bg-main transition-colors duration-300">
                <ErrorBoundary>
                  <header className="flex justify-between items-end border-b border-border-custom pb-6">
                    <div className="space-y-1">
                      <h1 className="text-3xl font-black text-text-dark tracking-tight">SYSTÈME HELIOS</h1>
                      <p className="text-sm text-[#7f8c8d] font-medium uppercase tracking-widest">
                        Gestion des Ressources Logistiques
                      </p>
                    </div>
                    <div className="flex items-center gap-4 bg-white dark:bg-slate-800 p-2 rounded-xl border border-border-custom shadow-sm relative">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent font-bold">
                        {getInitial(user)}
                      </div>
                      <div className="flex flex-col pr-4 border-r border-border-custom text-right">
                        <span className="text-[10px] font-bold text-[#b2bec3] uppercase tracking-[1px]">
                          {dynamicSettings?.roles?.find((r: any) => r.id === currentRole)?.label || "Accès Standard"}
                        </span>
                        <span className="text-sm font-bold text-text-dark leading-tight">{userDisplayName}</span>
                      </div>
                      {/* 🔔 Cloche notifications */}
                      <div className="relative">
                        <button
                          onClick={() => { setShowNotifs(v => !v); if (!showNotifs) markAllRead(); }}
                          className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors relative"
                          title="Notifications"
                        >
                          <Bell size={20} />
                          {unreadCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                              {unreadCount > 9 ? "9+" : unreadCount}
                            </span>
                          )}
                        </button>
                        {showNotifs && (
                          <div className="absolute right-0 top-11 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg z-50">
                            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                              <span className="text-xs font-black text-slate-700">Notifications</span>
                              <button onClick={() => setShowNotifs(false)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                            </div>
                            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                              {notifications.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-6">Aucune notification</p>
                              ) : notifications.map(n => (
                                <div key={n.id} className={`px-4 py-2.5 text-xs ${n.type === "equipment_critical" ? "bg-red-50 text-red-700" : "text-slate-700"}`}>
                                  {n.message}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* 🌙 Dark mode toggle */}
                      <button
                        onClick={() => setDarkMode(d => !d)}
                        className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title={darkMode ? "Mode clair" : "Mode sombre"}
                      >
                        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
                      </button>
                      <button
                        onClick={handleLogout}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                        title="Déconnexion"
                      >
                        <LogOut size={20} />
                      </button>
                    </div>
                  </header>

                  <div className="flex-1 min-h-0">
                    {resolveView()}
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
          )}
        </>
      ) : (
        /* ══ PAGE DE CONNEXION ══ */
        <div className="flex-1 flex items-center justify-center bg-[#fafbfc] relative overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/5 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-success/5 rounded-full blur-[100px]" />

          <div className="w-full max-w-md z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <Card className="border-none shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)] bg-white rounded-2xl overflow-hidden">
              <div className="h-2 w-full bg-accent" />
              <div className="p-10">
                <div className="flex flex-col items-center text-center mb-10">
                  <img src="/logo.jpg" alt="Helios Logo" className="w-16 h-16 rounded-2xl mb-6 shadow-xl shadow-accent/20 transform -rotate-3 hover:rotate-0 transition-transform duration-500" />
                  <h2 className="text-3xl font-black text-text-dark tracking-tight mb-2">HELIOS PORTAL</h2>
                  <p className="text-sm font-medium text-[#7f8c8d] uppercase tracking-[3px]">Accès restreint au personnel</p>
                </div>

                {isLocked && (
                  <div className="mb-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <ShieldAlert size={18} className="text-red-500 shrink-0" />
                    <p className="text-xs font-bold text-red-600">
                      Accès bloqué temporairement. Réessayez dans {remainingLockSeconds}s.
                    </p>
                  </div>
                )}

                <form onSubmit={handleAuthAction} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">
                        Identifiant Personnel
                      </label>
                      <div className="relative">
                        <LogIn size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#bdc3c7]" />
                        <input
                          type="text"
                          placeholder="Nom d'utilisateur"
                          autoComplete="username"
                          className="w-full pl-12 pr-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                          value={identifier}
                          onChange={e => setIdentifier(e.target.value)}
                          disabled={isLocked}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">
                        Clé d'Accès Sécurisée
                      </label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="w-full px-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={isLocked}
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-black text-sm tracking-widest transition-all hover:scale-[1.02] shadow-lg shadow-orange-300/40"
                    disabled={isLoggingIn || isLocked}
                  >
                    {isLoggingIn ? <Loader2 className="animate-spin" /> : "ACCÉDER AU PORTAIL"}
                  </Button>
                </form>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}