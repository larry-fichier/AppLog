import * as React from "react";
import { useState, useEffect } from "react";
import { EquipmentDashboard } from "@/components/EquipmentDashboard";
import { AdminSettings } from "@/components/AdminSettings";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Loader2, LogIn, LogOut, LayoutDashboard,
  Settings as SettingsIcon, ArrowLeftRight,
  ChevronDown, ChevronRight, Box,
  Car, Utensils, Laptop, Zap, Thermometer,
  Truck, Archive, ShieldAlert,
  Bell, Moon, Sun, Package, ClipboardCheck, KeyRound,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { MovementsPage } from "@/components/MovementsPage";
import { SupervisionDashboard } from "@/components/SupervisionDashboard";
import { ComZoneDashboard } from "@/components/ComZoneDashboard";
import { ApprobationsPanel } from "@/components/ApprobationsPanel";
import { ChefRamDashboard } from "@/components/ChefRamDashboard";

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
    // Session révoquée par une nouvelle connexion ailleurs : ne pas tenter de refresh
    const cloned = response.clone();
    try {
      const body = await cloned.json();
      if (body?.error === "SESSION_REPLACED") {
        sessionStorage.removeItem("helios_user");
        window.dispatchEvent(new CustomEvent("helios:session-replaced"));
        return response;
      }
    } catch {}

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
type MenuId = "dashboard" | "movements" | `cat_${string}` | "settings" | "approbations";

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

// ── Helper : identifiant de ce navigateur ───────────────────────────────────
// Le cookie auth_token est partagé par tous les onglets d'un même navigateur —
// se connecter avec un autre compte dans un nouvel onglet écrase silencieusement
// la session des autres onglets, qui continuent alors d'agir avec la mauvaise
// identité sans le savoir (faille de sécurité). localStorage, contrairement au
// cookie, n'est jamais transmis au serveur automatiquement mais reste partagé
// entre tous les onglets d'un même navigateur : cet identifiant sert donc à
// reconnaître "ces connexions viennent du même navigateur" pour forcer la
// déconnexion de TOUS les autres onglets dès qu'une nouvelle connexion a lieu,
// quel que soit le compte qui y était ouvert.
function getBrowserId(): string {
  try {
    let id = localStorage.getItem("helios_browser_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("helios_browser_id", id);
    }
    return id;
  } catch {
    return "";
  }
}

// ── Helper : dernière ouverture de la cloche par cet utilisateur ───────────
// Persisté en localStorage (et non en state) pour survivre au rechargement de
// page : sans ça, le backfill ne pourrait jamais distinguer « déjà vu lors
// d'une session précédente » de « manqué pendant une absence ».
function getLastSeenNotifTime(userId: string): number {
  try { return Number(localStorage.getItem(`helios_notif_seen_${userId}`)) || 0; }
  catch { return 0; }
}
function setLastSeenNotifTime(userId: string, time: number): void {
  try { localStorage.setItem(`helios_notif_seen_${userId}`, String(time)); } catch {}
}

export default function App() {
  const [user, setUser]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]   = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // ── Changement de mot de passe obligatoire (mot de passe par défaut) ──
  const [forceCurrentPassword, setForceCurrentPassword] = useState("");
  const [forceNewPassword, setForceNewPassword]         = useState("");
  const [forceConfirmPassword, setForceConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword]     = useState(false);

  const handleForcedPasswordChange = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!forceCurrentPassword || !forceNewPassword || !forceConfirmPassword) {
      toast.error("Tous les champs sont obligatoires.");
      return;
    }
    if (forceNewPassword !== forceConfirmPassword) {
      toast.error("Les nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: forceCurrentPassword, newPassword: forceNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erreur serveur");
        return;
      }
      const updatedUser = { ...user, mustChangePassword: false };
      sessionStorage.setItem("helios_user", JSON.stringify(updatedUser));
      setUser(updatedUser);
      setForceCurrentPassword("");
      setForceNewPassword("");
      setForceConfirmPassword("");
      toast.success("Mot de passe mis à jour avec succès.");
    } catch {
      toast.error("Erreur de connexion au serveur.");
    } finally {
      setIsChangingPassword(false);
    }
  };
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);

  const [activeMenu, setActiveMenu]         = useState<MenuId>("dashboard");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["inventaire"]));

  // Remet le menu actif sur le tableau de bord à chaque changement d'identité
  // (nouvelle connexion, ou déconnexion forcée par le contrôle d'identité).
  // Sans ça, App.tsx ne démonte jamais (seul le contenu bascule login/dashboard),
  // donc si un onglet reste ouvert et qu'un autre utilisateur s'y reconnecte, il
  // hérite du dernier menu affiché — potentiellement une page blanche si ce menu
  // n'existe pas pour son rôle (ex: "Approbations" pour un agent_logistique).
  React.useEffect(() => {
    if (user) setActiveMenu("dashboard");
  }, [user?.id]);

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
  const [notifications, setNotifications] = useState<{ id: number; message: string; type: string; read: boolean; payload?: any; created_at?: string }[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = React.useRef<EventSource | null>(null);
  const notifIdRef = React.useRef(0);
  const notifWrapperRef = React.useRef<HTMLDivElement | null>(null);

  // Types de notification qui portent une "opération" que chef_bureau/CSA/admin/
  // com_zone peuvent traiter directement (approuver/rejeter/confirmer/marquer
  // ravitaillé) en cliquant dessus.
  const ACTIONABLE_NOTIF_TYPES = ["stock_declaration_created", "resupply_needed", "resupply_fulfilled", "movement_transfer_requested"];
  // Types purement informatifs — cliquables par TOUS les rôles qui les reçoivent
  // (ex: chef_ram sur une panne/réparation véhicule) pour voir le détail complet,
  // sans action d'approbation associée.
  const READONLY_DETAIL_TYPES = ["equipment_critical", "equipment_repaired"];
  // ── Modèle de persistence façon "notification d'app" ────────────────────
  // critical : une situation qui attend une action ou une résolution (panne,
  // écart de stock, ravitaillement livré à confirmer, transfert à approuver…) —
  // reste affichée même après lecture, tant que la cause n'est pas résolue
  // (résolution détectée en direct via SSE, ou disparue du backfill une fois
  // l'état sous-jacent changé côté serveur).
  // info : un simple compte-rendu (réparation faite, déclaration tranchée,
  // transfert déjà décidé…) — s'efface dès que l'utilisateur l'a vue.
  const NOTIF_KIND: Record<string, "critical" | "info"> = {
    equipment_critical:          "critical",
    stock_alerte:                "critical",
    stock_declaration_created:   "critical",
    resupply_needed:             "critical",
    resupply_fulfilled:          "critical",
    movement_transfer_requested: "critical",
    equipment_repaired:          "info",
    stock_declaration_approved:  "info",
    stock_declaration_rejected:  "info",
    resupply_confirmed:          "info",
    movement_transfer_approved:  "info",
    movement_transfer_rejected:  "info",
    equipment_created:           "info",
    audit_log:                   "info",
  };
  const [alertDetail, setAlertDetail] = useState<{ type: string; payload: any; created_at?: string } | null>(null);
  const [alertActionLoading, setAlertActionLoading] = useState(false);
  const [alertNote, setAlertNote] = useState("");
  const [alertQty, setAlertQty] = useState("0");

  // ── Libellés lisibles pour le journal global d'audit (admin + supervision) ──
  const AUDIT_ACTION_LABELS: Record<string, string> = {
    LOGIN_SUCCESS: "s'est connecté(e)",
    LOGOUT: "s'est déconnecté(e)",
    EQUIPMENT_CREATED: "a créé un équipement",
    EQUIPMENT_UPDATED: "a modifié un équipement",
    EQUIPMENT_DELETED: "a supprimé un équipement",
    MOVEMENT_CREATED: "a enregistré un mouvement",
    MOVEMENT_UPDATED: "a modifié un mouvement",
    STOCK_SORTIE: "a effectué une sortie de stock",
    CONFIG_UPDATED: "a mis à jour la configuration",
    ADMIN_RECOVER: "a lancé une récupération d'urgence",
    USER_CREATED: "a créé un utilisateur",
    USER_ROLE_UPDATED: "a changé le rôle d'un utilisateur",
    USER_DELETED: "a supprimé un utilisateur",
    USER_PASSWORD_RESET: "a réinitialisé un mot de passe",
    USER_PASSWORD_CHANGED_SELF: "a changé son mot de passe",
    EQUIPMENT_PANNE_DECLAREE: "a déclaré une panne",
    EQUIPMENT_REPARATION_DECLAREE: "a signalé une réparation",
    EQUIPMENT_DECLASSE: "a déclassé un équipement",
    EQUIPMENT_REFORME: "a réformé un véhicule",
    EQUIPMENT_REFORME_ANNULEE: "a annulé la réforme d'un véhicule",
    STOCK_DECLARATION_CREATED: "a déclaré un écart de stock",
    STOCK_DECLARATION_CONFIRMED: "a confirmé son stock (sans écart)",
    STOCK_DECLARATION_APPROVED: "a approuvé une déclaration de stock",
    STOCK_DECLARATION_REJECTED: "a rejeté une déclaration de stock",
    RESUPPLY_NEEDED: "a déclenché une demande de ravitaillement",
    RESUPPLY_FULFILLED: "a marqué un ravitaillement effectif",
    RESUPPLY_CONFIRMED: "a confirmé la réception d'un ravitaillement",
    REPORT_GENERATED: "a généré un rapport",
  };

  const AUDIT_ACTION_ICONS: Record<string, string> = {
    LOGIN_SUCCESS: "🔓",
    LOGOUT: "🔒",
    EQUIPMENT_CREATED: "🆕",
    EQUIPMENT_UPDATED: "✏️",
    EQUIPMENT_DELETED: "🗑️",
    MOVEMENT_CREATED: "🔀",
    MOVEMENT_UPDATED: "🔀",
    STOCK_SORTIE: "📤",
    CONFIG_UPDATED: "⚙️",
    ADMIN_RECOVER: "🛠️",
    USER_CREATED: "👤",
    USER_ROLE_UPDATED: "🔑",
    USER_DELETED: "🚫",
    USER_PASSWORD_RESET: "🔐",
    USER_PASSWORD_CHANGED_SELF: "🔑",
    EQUIPMENT_PANNE_DECLAREE: "⚠️",
    EQUIPMENT_REPARATION_DECLAREE: "✅",
    EQUIPMENT_DECLASSE: "♻️",
    EQUIPMENT_REFORME: "🎖️",
    EQUIPMENT_REFORME_ANNULEE: "↩️",
    STOCK_DECLARATION_CREATED: "📝",
    STOCK_DECLARATION_CONFIRMED: "✅",
    STOCK_DECLARATION_APPROVED: "✅",
    STOCK_DECLARATION_REJECTED: "❌",
    RESUPPLY_NEEDED: "🚚",
    RESUPPLY_FULFILLED: "📦",
    RESUPPLY_CONFIRMED: "✅",
    REPORT_GENERATED: "📄",
  };

  // ── Construit le message affiché pour une notification, à partir d'un
  // événement { type, payload } — utilisé aussi bien pour les événements SSE
  // en direct que pour le backfill /api/notifications/recent (mêmes clés de
  // payload dans les deux cas, pour ne jamais dupliquer ce formatage).
  function buildNotificationMessage(event: { type: string; payload?: any }): string {
    if (event.type === "audit_log") {
      const label = AUDIT_ACTION_LABELS[event.payload?.action] || event.payload?.action || "a effectué une action";
      return `📋 ${event.payload?.userName || "Quelqu'un"} ${label}`;
    } else if (event.type === "equipment_critical") {
      return `⚠️ ${event.payload?.message || "Équipement passé en état critique"}`;
    } else if (event.type === "equipment_repaired") {
      return `✅ ${event.payload?.message || "Équipement réparé — de retour en service"}`;
    } else if (event.type === "stock_alerte") {
      return `📉 Stock bas — ${event.payload?.name || "Équipement"} (${event.payload?.new_stock} ${event.payload?.unite || ""})`;
    } else if (event.type === "stock_declaration_created") {
      return `📝 Écart de stock signalé — ${event.payload?.equipmentName || "Équipement"} (${event.payload?.previousQuantity} → ${event.payload?.declaredQuantity})`;
    } else if (event.type === "stock_declaration_approved") {
      return `✅ Déclaration de stock approuvée — ${event.payload?.equipmentName || "Équipement"}`;
    } else if (event.type === "stock_declaration_rejected") {
      return `❌ Déclaration de stock rejetée${event.payload?.reason ? ` — « ${event.payload.reason} »` : ""}`;
    } else if (event.type === "resupply_needed") {
      return `🚚 Ravitaillement nécessaire — ${event.payload?.name || "Équipement"} (${event.payload?.quantity} ${event.payload?.unite || ""})`;
    } else if (event.type === "resupply_fulfilled") {
      return `📦 Ravitaillement livré — ${event.payload?.equipmentName || "Équipement"} — confirmez la réception`;
    } else if (event.type === "resupply_confirmed") {
      return `✅ Réception de ravitaillement confirmée`;
    } else if (event.type === "movement_transfer_requested") {
      return `🔀 Transfert en attente d'approbation — ${event.payload?.equipmentName || "Équipement"}`;
    } else if (event.type === "movement_transfer_approved") {
      return `✅ Transfert approuvé — ${event.payload?.equipmentName || "Équipement"}`;
    } else if (event.type === "movement_transfer_rejected") {
      return `❌ Transfert rejeté${event.payload?.reason ? ` — « ${event.payload.reason} »` : ""}`;
    } else if (event.type === "equipment_created") {
      return `📦 Équipement créé — ${event.payload?.name || ""}`;
    }
    return `📦 Équipement créé`;
  }

  // ── Backfill : peuple la cloche avec les événements critiques récents dès
  // la connexion, pour ne pas perdre les alertes émises pendant que l'onglet
  // n'était pas ouvert (les événements SSE sont éphémères, non rejouables).
  // Seuls les événements survenus APRÈS la dernière ouverture de la cloche par
  // cet utilisateur (horodatage persisté en localStorage) sont marqués non lus
  // — sinon les mêmes alertes des 14 derniers jours réapparaissent lues, sans
  // jamais déclencher le badge, et un rôle absent au moment de l'émission
  // (chef de bureau, CSA, CSPH…) n'est jamais réellement alerté à son retour.
  React.useEffect(() => {
    if (!user) return;
    const lastSeen = getLastSeenNotifTime(user.id);
    fetch("/api/notifications/recent", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: { type: string; payload: any; created_at: string }[]) => {
        if (!Array.isArray(rows) || rows.length === 0) return;
        const backfilled = rows.map(row => ({
          id: ++notifIdRef.current,
          message: buildNotificationMessage(row),
          type: row.type,
          read: new Date(row.created_at).getTime() <= lastSeen,
          payload: row.payload,
          created_at: row.created_at,
        }));
        setNotifications(prev => [...prev, ...backfilled].slice(0, 50));
      })
      .catch(() => {});
  }, [user]);

  // ── Écoute expiration de session (déclenchée par l'intercepteur fetch) ──
  React.useEffect(() => {
    const onExpired = () => {
      setUser(null);
      if (notifRef.current) { notifRef.current.close(); }
      toast.error("Votre session a expiré. Veuillez vous reconnecter.");
    };
    const onReplaced = () => {
      setUser(null);
      if (notifRef.current) { notifRef.current.close(); }
      toast.error("Votre compte a été connecté depuis un autre appareil. Vous avez été déconnecté.", { duration: 8000 });
    };
    // Un autre onglet de CE navigateur s'est connecté avec un compte différent :
    // le cookie auth_token (partagé par tous les onglets) a été remplacé sous
    // les pieds de cet onglet, qui affichait encore l'ancien utilisateur alors
    // que le serveur n'aurait plus authentifié ses requêtes que sous le nouveau.
    const onIdentityMismatch = () => {
      setUser(null);
      if (notifRef.current) { notifRef.current.close(); }
      toast.error("Un autre compte a été connecté dans ce navigateur. Veuillez vous reconnecter.", { duration: 8000 });
    };
    window.addEventListener("helios:session-expired", onExpired);
    window.addEventListener("helios:session-replaced", onReplaced);
    window.addEventListener("helios:identity-mismatch", onIdentityMismatch);
    return () => {
      window.removeEventListener("helios:session-expired", onExpired);
      window.removeEventListener("helios:session-replaced", onReplaced);
      window.removeEventListener("helios:identity-mismatch", onIdentityMismatch);
    };
  }, []);

  // ── Vérifie que l'identité de cet onglet correspond toujours au cookie ──
  // auth_token réel du navigateur (partagé entre tous les onglets). À utiliser
  // au montage et quand l'onglet redevient visible, pour détecter rapidement
  // qu'un autre onglet s'est connecté avec un compte différent.
  const verifyIdentity = React.useCallback(async () => {
    const storedUser = sessionStorage.getItem("helios_user");
    if (!storedUser) return;
    try {
      const res = await originalFetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return; // 401 : laissé au flux refresh/expiration existant
      const data = await res.json();
      const cachedId = JSON.parse(storedUser)?.id;
      if (data.user?.id && cachedId && data.user.id !== cachedId) {
        sessionStorage.removeItem("helios_user");
        window.dispatchEvent(new CustomEvent("helios:identity-mismatch"));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") verifyIdentity();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user, verifyIdentity]);

  React.useEffect(() => {
    if (!user) return;
    const es = new EventSource(`/api/events?browserId=${encodeURIComponent(getBrowserId())}`, { withCredentials: true });
    notifRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "connected") return;
        if (event.type === "session_replaced") {
          sessionStorage.removeItem("helios_user");
          setUser(null);
          if (notifRef.current) { notifRef.current.close(); }
          toast.error(
            event.payload?.message || "Votre compte a été connecté depuis un autre appareil. Vous avez été déconnecté.",
            { duration: 8000 }
          );
          return;
        }
        // Une alerte déjà résolue (panne réparée, déclaration tranchée,
        // ravitaillement confirmé…) ne doit plus traîner dans la cloche —
        // même si le tab qui la voit encore n'est pas celui qui a résolu.
        const RESOLVES: Record<string, { clears: string; matchKey: string }> = {
          equipment_repaired:         { clears: "equipment_critical",       matchKey: "equipment_id" },
          stock_declaration_approved: { clears: "stock_declaration_created", matchKey: "declarationId" },
          stock_declaration_rejected: { clears: "stock_declaration_created", matchKey: "declarationId" },
          resupply_confirmed:         { clears: "resupply_needed",          matchKey: "requestId" },
        };
        const resolves = RESOLVES[event.type];

        const id = ++notifIdRef.current;
        const message = buildNotificationMessage(event);
        const created_at = new Date().toISOString();
        setNotifications(prev => {
          const base = resolves
            ? prev.filter(n => !(n.type === resolves.clears && n.payload?.[resolves.matchKey] === event.payload?.[resolves.matchKey]))
            : prev;
          return [{ id, message, type: event.type, read: false, payload: event.payload, created_at }, ...base].slice(0, 50);
        });
        // Les tableaux de bord (EquipmentDashboard, SupervisionDashboard…) n'ont
        // aucun autre moyen de savoir qu'un événement distant (ex : chef RAM qui
        // signale une panne) vient de changer leurs données — sans ce signal,
        // leurs statistiques restent figées jusqu'au prochain montage/polling.
        window.dispatchEvent(new CustomEvent("helios:data-changed", { detail: event }));
      } catch {}
    };
    return () => { es.close(); };
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  // Une fois vues (ouvertes puis refermées), les notifications ne doivent plus
  // encombrer la cloche — seules celles arrivées depuis (donc encore non lues)
  // doivent rester.
  // Une notification "info" (lue) sort de la liste ; une notification
  // "critical" y reste tant que sa cause n'est pas résolue, même une fois lue —
  // sinon un chef de bureau qui ouvre la cloche par réflexe ferait disparaître
  // une déclaration de stock qu'il n'a pourtant pas encore traitée.
  const pruneReadNotifs = (prev: typeof notifications) =>
    prev.filter(n => !n.read || NOTIF_KIND[n.type] === "critical");

  const toggleNotifs = () => {
    setShowNotifs(v => {
      const next = !v;
      if (next) {
        markAllRead();
        if (user) setLastSeenNotifTime(user.id, Date.now());
      } else {
        setNotifications(pruneReadNotifs);
      }
      return next;
    });
  };
  const closeNotifs = () => {
    setNotifications(pruneReadNotifs);
    setShowNotifs(false);
  };

  // Ferme la cloche dès qu'un clic a lieu en dehors — sans ça elle ne se
  // referme que via la croix ou un second clic sur la cloche elle-même.
  React.useEffect(() => {
    if (!showNotifs) return;
    const onPointerDown = (e: MouseEvent) => {
      if (notifWrapperRef.current && !notifWrapperRef.current.contains(e.target as Node)) {
        closeNotifs();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showNotifs]);

  // ── Init auth + config ─────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const storedUser = sessionStorage.getItem("helios_user");
      if (storedUser) {
        try {
          const check = await fetch("/api/auth/me", { credentials: "include" });
          if (check.ok) {
            const meData = await check.json();
            const cached = JSON.parse(storedUser);
            if (meData.user?.id && meData.user.id !== cached.id) {
              // Un autre onglet de ce navigateur est connecté avec un compte
              // différent — le cookie partagé ne correspond plus à ce qui est
              // affiché ici, ne pas ré-afficher l'ancien utilisateur.
              sessionStorage.removeItem("helios_user");
            } else {
              setUser(cached);
            }
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
          const seen = new Set<string>();
          setCategories((data.categories || []).filter((c: any) => {
            const key = (c.label || "").trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }));
          setDynamicSettings({
            categories: data.categories || [],
            zones:    (data.zones    || []).map((z: any) => ({ id: z.id, label: z.name })),
            stations: (data.stations || []).map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
            roles: [
              { id: "admin",                      label: "Administrateur" },
              { id: "chef_service_administratif", label: "Chef Service Administratif" },
              { id: "chef_bureau",                label: "Chef de Bureau" },
              { id: "chef_ram",                   label: "Chef RAM" },
              { id: "com_zone",                   label: "COM Zone" },
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
        body: JSON.stringify({ username: identifier.trim(), password, browserId: getBrowserId() }),
      });

      if (!res.ok) {
        const err = await res.json();

        // Blocage déclenché côté serveur (15 min)
        if (res.status === 429) {
          setLockUntil(Date.now() + LOCK_DURATION_MS);
          setLoginAttempts(0);
          toast.error(err.error || "Compte temporairement bloqué.");
          return;
        }

        const newAttempts = loginAttempts + 1;
        setLoginAttempts(newAttempts);

        if (newAttempts >= MAX_ATTEMPTS) {
          setLockUntil(Date.now() + LOCK_DURATION_MS);
          setLoginAttempts(0);
          toast.error("Compte temporairement bloqué après trop de tentatives.");
        } else {
          const left = err.attemptsLeft ?? (MAX_ATTEMPTS - newAttempts);
          toast.error(`${err.error || "Identifiants incorrects."} (${left} tentative${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""})`);
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
  // Parité complète avec l'admin sur le volet Configuration (logique métier,
  // comptes utilisateurs, journal global) — le chef de bureau en a besoin au
  // quotidien, en particulier pour le journal d'audit.
  const canSeeSettings  = ["admin", "chef_bureau"].includes(currentRole);
  const isSupervisor    = ["chef_service_administratif", "csph"].includes(currentRole);
  const isComZone       = currentRole === "com_zone";
  const isChefRam       = currentRole === "chef_ram";
  const canActOnAlerts  = ["admin", "chef_bureau", "chef_service_administratif"].includes(currentRole);
  // resupply_fulfilled se traite côté com_zone (confirmer réception) — les
  // autres types actionnables restent réservés aux rôles d'approbation.
  function canActOnNotif(type: string): boolean {
    if (type === "resupply_fulfilled") return isComZone;
    return canActOnAlerts && ACTIONABLE_NOTIF_TYPES.includes(type);
  }

  function openAlertDetail(n: { type: string; payload?: any; created_at?: string }) {
    const isActionable = canActOnNotif(n.type);
    const isReadonly   = READONLY_DETAIL_TYPES.includes(n.type);
    if (!isActionable && !isReadonly) return;
    setAlertNote("");
    setAlertQty("0");
    setAlertDetail({ type: n.type, payload: n.payload, created_at: n.created_at });
  }

  async function handleAlertDecision(action: "approve" | "reject" | "fulfill" | "confirm") {
    if (!alertDetail) return;
    setAlertActionLoading(true);
    try {
      let url: string;
      let body: Record<string, any>;
      if (alertDetail.type === "resupply_needed") {
        url = `/api/resupply-requests/${alertDetail.payload.requestId}/fulfill`;
        body = { note: alertNote.trim() || undefined };
      } else if (alertDetail.type === "resupply_fulfilled") {
        url = `/api/resupply-requests/${alertDetail.payload.requestId}/confirm`;
        body = { quantite_recue: parseInt(alertQty, 10) || 0, note: alertNote.trim() || undefined };
      } else if (alertDetail.type === "movement_transfer_requested") {
        url = `/api/movements/${alertDetail.payload.movementId}/${action}`;
        body = { note: alertNote.trim() || undefined };
      } else {
        url = `/api/stock-declarations/${alertDetail.payload.declarationId}/${action}`;
        body = { note: alertNote.trim() || undefined };
      }
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur serveur"); return; }
      toast.success(
        action === "fulfill" ? "Ravitaillement marqué effectif"
        : action === "confirm" ? "Réception confirmée"
        : action === "approve" ? "Approuvé"
        : "Rejeté"
      );
      setAlertDetail(null);
    } catch (e: any) {
      toast.error(e.message || "Erreur de connexion");
    } finally {
      setAlertActionLoading(false);
    }
  }

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
          const l = cat.label.toLowerCase();
          // Com Zone : catégories gérées via des flux dédiés (Rame/Matériel
          // d'exploitation via ComZoneDashboard) ou non pertinentes pour ce rôle
          // (Cuisine, Outillage) — masquées du menu générique pour ce rôle seulement.
          if (currentRole === "com_zone" && (l.includes("cuisine") || l.includes("exploitation") || l.includes("outillage") || l.includes("rame"))) return false;
          // L'agent logistique ne voit pas la catégorie Armement dans le menu
          if (currentRole === "agent_logistique" && l.includes("armement")) return false;
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

  // Le chef de bureau accède aux approbations (déclarations de stock / ravitaillements)
  // depuis la sidebar standard — la CSA y accède via un onglet dans SupervisionDashboard.
  if (currentRole === "chef_bureau") {
    navItems.push({
      id: "approbations",
      label: "Approbations",
      icon: <ClipboardCheck size={17} />,
    });
  }

  function toggleGroup(id: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Résolution de la vue active ────────────────────────
  function resolveView(): React.ReactNode {
    if (activeMenu === "settings" && canSeeSettings) {
      return <AdminSettings />;
    }
    if (activeMenu === "movements") {
      return (
        <MovementsPage
          activeRole={currentRole as any}
          isBypass={false}
          zones={dynamicSettings?.zones ?? []}
          stations={(dynamicSettings?.stations ?? []) as any}
          userZoneId={user?.zoneId}
        />
      );
    }
    if (activeMenu === "approbations" && currentRole === "chef_bureau") {
      return <ApprobationsPanel />;
    }
    if (activeMenu === "dashboard") {
      if (isComZone) return <ComZoneDashboard />;
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

      {user?.mustChangePassword ? (
        /* ══ CHANGEMENT DE MOT DE PASSE OBLIGATOIRE ══ */
        <div className="flex-1 flex items-center justify-center bg-[#fafbfc] relative overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-amber-500/5 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-accent/5 rounded-full blur-[100px]" />

          <div className="w-full max-w-md z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <Card className="border-none shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)] bg-white rounded-2xl overflow-hidden">
              <div className="h-2 w-full bg-amber-500" />
              <div className="p-10">
                <div className="flex flex-col items-center text-center mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mb-6 shadow-xl shadow-amber-200/40">
                    <KeyRound size={26} className="text-amber-500" />
                  </div>
                  <h2 className="text-2xl font-black text-text-dark tracking-tight mb-2">Mot de passe à changer</h2>
                  <p className="text-sm font-medium text-[#7f8c8d]">
                    Ce compte utilise un mot de passe par défaut. Vous devez en définir un nouveau avant de continuer.
                  </p>
                </div>

                <form onSubmit={handleForcedPasswordChange} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">
                      Mot de passe actuel (par défaut)
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full px-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                      value={forceCurrentPassword}
                      onChange={e => setForceCurrentPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">
                      Nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full px-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                      value={forceNewPassword}
                      onChange={e => setForceNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-[#636e72] uppercase tracking-[1.5px] ml-1">
                      Confirmer le nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full px-4 h-12 bg-[#f8fafc] border border-border-custom rounded-xl focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-medium text-sm"
                      value={forceConfirmPassword}
                      onChange={e => setForceConfirmPassword(e.target.value)}
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm tracking-widest transition-all hover:scale-[1.02] shadow-lg shadow-amber-300/40"
                    disabled={isChangingPassword}
                  >
                    {isChangingPassword ? <Loader2 className="animate-spin" /> : "DÉFINIR LE NOUVEAU MOT DE PASSE"}
                  </Button>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full text-center text-xs font-bold text-[#b2bec3] hover:text-[#636e72] transition-colors"
                  >
                    Déconnexion
                  </button>
                </form>
              </div>
            </Card>
          </div>
        </div>
      ) : user ? (
        <>
          {/* ══ LAYOUT SUPERVISOR (CSA + CSPH) ══ */}
          {isSupervisor ? (
            <div
              className="flex-1 min-w-0 flex flex-col min-h-screen supervisor-layout"
              style={{ background: supervisorBg }}
            >
              <header className="bg-white/80 backdrop-blur border-b border-slate-200/80 px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between flex-wrap gap-y-2 gap-x-4 sticky top-0 z-50 shadow-sm">
                <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                  <img src="/logo.png" alt="Helios Logo" className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shadow-md shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-black tracking-[3px] text-slate-900 uppercase leading-tight">HELIOS</div>
                    <div className="text-[9px] text-slate-400 font-bold tracking-widest uppercase truncate">Système de supervision</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-3">
                  <div className="hidden sm:block text-right">
                    <div className="text-sm font-black text-slate-800 leading-tight">{userDisplayName}</div>
                    <div className="text-[10px] text-slate-400 font-bold">
                      {dynamicSettings?.roles?.find((r: any) => r.id === currentRole)?.label || "Superviseur"}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center text-white font-black text-sm shadow shrink-0">
                    {getInitial(user)}
                  </div>
                  {/* 🔔 Cloche notifications (journal global) */}
                  <div className="relative" ref={notifWrapperRef}>
                    <button
                      onClick={toggleNotifs}
                      className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors relative"
                      title="Notifications"
                    >
                      <Bell size={18} />
                      {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </button>
                    {showNotifs && (
                      <div className="absolute right-0 top-11 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg z-50">
                        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                          <span className="text-xs font-black text-slate-700">Notifications</span>
                          <button onClick={closeNotifs} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                        </div>
                        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                          {notifications.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-6">Aucune notification</p>
                          ) : notifications.map(n => {
                            const clickable = canActOnNotif(n.type) || READONLY_DETAIL_TYPES.includes(n.type);
                            return (
                              <div key={n.id}
                                onClick={() => openAlertDetail(n)}
                                className={`px-4 py-2.5 text-xs ${
                                  NOTIF_KIND[n.type] === "critical"
                                    ? "bg-red-50 text-red-700"
                                    : "text-slate-700"
                                } ${clickable ? "cursor-pointer hover:brightness-95 transition-all" : ""}`}>
                                {n.message}
                                {clickable && <span className="block text-[10px] font-bold opacity-70 mt-0.5">Cliquer pour voir le détail →</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-red-500 px-2 sm:px-3 py-2 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
                  >
                    <LogOut size={14} /><span className="hidden sm:inline">Déconnexion</span>
                  </button>
                </div>
              </header>
              <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
                <ErrorBoundary>
                  <SupervisionDashboard isBypass={false} />
                </ErrorBoundary>
              </main>
              <footer className="py-4 px-4 sm:px-8 border-t border-slate-200/80 bg-white/60 text-center">
                <p className="text-[10px] text-slate-300 font-medium tracking-widest uppercase">
                  HELIOS · Gestion G-Logistique v1.2 · Accès Superviseur — {new Date().getFullYear()}
                </p>
              </footer>
            </div>
          ) : isChefRam ? (
            /* ══ LAYOUT CHEF RAM (véhicules uniquement, sans sidebar) ══ */
            <div
              className="flex-1 flex flex-col min-h-screen supervisor-layout"
              style={{ background: supervisorBg }}
            >
              <header className="bg-white/80 backdrop-blur border-b border-slate-200/80 px-8 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
                <div className="flex items-center gap-4">
                  <img src="/logo.png" alt="Helios Logo" className="w-10 h-10 rounded-xl shadow-md" />
                  <div>
                    <div className="text-sm font-black tracking-[3px] text-slate-900 uppercase leading-tight">HELIOS</div>
                    <div className="text-[9px] text-slate-400 font-bold tracking-widest uppercase">Chef RAM</div>
                  </div>
                  <div className="ml-4 pl-4 border-l border-slate-200">
                    <div className="text-[10px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5">
                      <Car size={12} />
                      Parc véhicules uniquement
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-black text-slate-800 leading-tight">{userDisplayName}</div>
                    <div className="text-[10px] text-slate-400 font-bold">
                      {dynamicSettings?.roles?.find((r: any) => r.id === currentRole)?.label || "Chef RAM"}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center text-white font-black text-sm shadow">
                    {getInitial(user)}
                  </div>
                  {/* 🔔 Cloche notifications */}
                  <div className="relative" ref={notifWrapperRef}>
                    <button
                      onClick={toggleNotifs}
                      className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors relative"
                      title="Notifications"
                    >
                      <Bell size={18} />
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
                          <button onClick={closeNotifs} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                        </div>
                        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                          {notifications.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-6">Aucune notification</p>
                          ) : notifications.map(n => {
                            const clickable = READONLY_DETAIL_TYPES.includes(n.type);
                            return (
                              <div key={n.id}
                                onClick={() => openAlertDetail(n)}
                                className={`px-4 py-2.5 text-xs ${
                                  n.type === "equipment_critical" || n.type === "equipment_repaired"
                                    ? "bg-red-50 text-red-700"
                                    : "text-slate-700"
                                } ${clickable ? "cursor-pointer hover:brightness-95 transition-all" : ""}`}>
                                {n.message}
                                {clickable && <span className="block text-[10px] font-bold opacity-70 mt-0.5">Cliquer pour voir le détail →</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
                  <ChefRamDashboard />
                </ErrorBoundary>
              </main>
              <footer className="py-4 px-8 border-t border-slate-200/80 bg-white/60 text-center">
                <p className="text-[10px] text-slate-300 font-medium tracking-widest uppercase">
                  HELIOS · Gestion G-Logistique v1.2 · Accès Chef RAM — {new Date().getFullYear()}
                </p>
              </footer>
            </div>
          ) : (
            <>
              {/* ══ SIDEBAR ══ */}
              <aside className="w-64 bg-sidebar-bg text-text-light flex flex-col py-8 shrink-0 z-50">
                <div className="px-8 pb-10 mb-4 border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Helios Logo" className="w-10 h-10 rounded-lg shadow-md hover:scale-105 transition-transform duration-300" />
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
                    {canSeeSettings && (
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
                      <div className="relative" ref={notifWrapperRef}>
                        <button
                          onClick={toggleNotifs}
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
                              <button onClick={closeNotifs} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                            </div>
                            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                              {notifications.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-6">Aucune notification</p>
                              ) : notifications.map(n => {
                                const clickable = canActOnNotif(n.type) || READONLY_DETAIL_TYPES.includes(n.type);
                                return (
                                  <div key={n.id}
                                    onClick={() => openAlertDetail(n)}
                                    className={`px-4 py-2.5 text-xs ${
                                      NOTIF_KIND[n.type] === "critical"
                                        ? "bg-red-50 text-red-700"
                                        : "text-slate-700"
                                    } ${clickable ? "cursor-pointer hover:brightness-95 transition-all" : ""}`}>
                                    {n.message}
                                    {clickable && <span className="block text-[10px] font-bold opacity-70 mt-0.5">Cliquer pour voir le détail →</span>}
                                  </div>
                                );
                              })}
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
                  <img src="/logo.png" alt="Helios Logo" className="w-16 h-16 rounded-2xl mb-6 shadow-xl shadow-accent/20 transform -rotate-3 hover:rotate-0 transition-transform duration-500" />
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

      {/* ── Détail d'alerte cliquable (chef_bureau / CSA / admin) : voir + accepter/refuser ── */}
      <Dialog open={!!alertDetail} onOpenChange={open => { if (!open) setAlertDetail(null); }}>
        <DialogContent className="sm:max-w-[420px] p-0 border-none bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          {alertDetail?.type === "stock_declaration_created" && (
            <>
              <div className="bg-gradient-to-br from-amber-600 to-amber-500 text-white px-6 py-5">
                <DialogHeader>
                  <DialogTitle className="text-base font-black text-white">Écart de stock signalé</DialogTitle>
                  <DialogDescription className="text-amber-50 text-xs mt-0.5 font-medium">
                    {alertDetail.payload?.equipmentName}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl border bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                  <span className="text-lg font-black text-slate-400">{alertDetail.payload?.previousQuantity}</span>
                  <span className="text-slate-300">→</span>
                  <span className="text-lg font-black text-amber-600">{alertDetail.payload?.declaredQuantity} {alertDetail.payload?.unite || ""}</span>
                </div>
                <Input
                  placeholder="Note (optionnel)"
                  value={alertNote}
                  onChange={e => setAlertNote(e.target.value)}
                  className="h-9 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <DialogFooter className="px-6 pb-5 flex gap-3">
                <Button variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
                  disabled={alertActionLoading} onClick={() => handleAlertDecision("reject")}>
                  Rejeter
                </Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black"
                  disabled={alertActionLoading} onClick={() => handleAlertDecision("approve")}>
                  {alertActionLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : null}
                  Approuver
                </Button>
              </DialogFooter>
            </>
          )}

          {(alertDetail?.type === "equipment_critical" || alertDetail?.type === "equipment_repaired") && (
            <>
              <div className={`bg-gradient-to-br text-white px-6 py-5 ${
                alertDetail.type === "equipment_repaired" ? "from-emerald-600 to-emerald-500" : "from-red-700 to-red-600"
              }`}>
                <DialogHeader>
                  <DialogTitle className="text-base font-black text-white">
                    {alertDetail.type === "equipment_repaired" ? "Véhicule réparé" : "Alerte équipement"}
                  </DialogTitle>
                  {alertDetail.created_at && (
                    <DialogDescription className="text-white/80 text-xs mt-0.5 font-medium">
                      {new Date(alertDetail.created_at).toLocaleString("fr-FR")}
                    </DialogDescription>
                  )}
                </DialogHeader>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {alertDetail.payload?.message || "Aucun détail supplémentaire."}
                </p>
              </div>
              <DialogFooter className="px-6 pb-5">
                <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setAlertDetail(null)}>
                  Fermer
                </Button>
              </DialogFooter>
            </>
          )}

          {alertDetail?.type === "resupply_needed" && (
            <>
              <div className="bg-gradient-to-br from-orange-600 to-orange-500 text-white px-6 py-5">
                <DialogHeader>
                  <DialogTitle className="text-base font-black text-white">Ravitaillement nécessaire</DialogTitle>
                  <DialogDescription className="text-orange-50 text-xs mt-0.5 font-medium">
                    {alertDetail.payload?.name}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="flex items-center justify-between px-4 py-3 rounded-xl border bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Stock actuel</span>
                  <span className="text-lg font-black text-orange-600">
                    {alertDetail.payload?.quantity} <span className="text-sm font-bold">{alertDetail.payload?.unite || ""}</span>
                  </span>
                </div>
                <Input
                  placeholder="Note (optionnel)"
                  value={alertNote}
                  onChange={e => setAlertNote(e.target.value)}
                  className="h-9 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <DialogFooter className="px-6 pb-5 flex gap-3">
                <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setAlertDetail(null)} disabled={alertActionLoading}>
                  Fermer
                </Button>
                <Button className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-black"
                  disabled={alertActionLoading} onClick={() => handleAlertDecision("fulfill")}>
                  {alertActionLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : null}
                  Marquer ravitaillé
                </Button>
              </DialogFooter>
            </>
          )}

          {alertDetail?.type === "resupply_fulfilled" && (
            <>
              <div className="bg-gradient-to-br from-emerald-700 to-emerald-600 text-white px-6 py-5">
                <DialogHeader>
                  <DialogTitle className="text-base font-black text-white">Confirmer la réception</DialogTitle>
                  <DialogDescription className="text-emerald-100 text-xs mt-0.5 font-medium">
                    {alertDetail.payload?.equipmentName}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                    Quantité reçue <span className="text-red-400">*</span>
                  </span>
                  <Input
                    type="number"
                    min="0"
                    value={alertQty}
                    onChange={e => setAlertQty(e.target.value)}
                    className="h-11 text-lg font-black text-center dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  />
                  <p className="text-[11px] text-slate-400">S'ajoute au stock actuel de la zone.</p>
                </div>
                <Input
                  placeholder="Note (optionnel)"
                  value={alertNote}
                  onChange={e => setAlertNote(e.target.value)}
                  className="h-9 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <DialogFooter className="px-6 pb-5 flex gap-3">
                <Button variant="outline" className="flex-1 dark:border-slate-600 dark:text-slate-300" onClick={() => setAlertDetail(null)} disabled={alertActionLoading}>
                  Fermer
                </Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black"
                  disabled={alertActionLoading} onClick={() => handleAlertDecision("confirm")}>
                  {alertActionLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : null}
                  Confirmer
                </Button>
              </DialogFooter>
            </>
          )}

          {alertDetail?.type === "movement_transfer_requested" && (
            <>
              <div className="bg-gradient-to-br from-blue-700 to-blue-600 text-white px-6 py-5">
                <DialogHeader>
                  <DialogTitle className="text-base font-black text-white">Transfert en attente d'approbation</DialogTitle>
                  <DialogDescription className="text-blue-100 text-xs mt-0.5 font-medium">
                    {alertDetail.payload?.equipmentName}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="px-6 py-5 space-y-4">
                <Input
                  placeholder="Motif (obligatoire pour rejeter)"
                  value={alertNote}
                  onChange={e => setAlertNote(e.target.value)}
                  className="h-9 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <DialogFooter className="px-6 pb-5 flex gap-3">
                <Button variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
                  disabled={alertActionLoading} onClick={() => handleAlertDecision("reject")}>
                  Rejeter
                </Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black"
                  disabled={alertActionLoading} onClick={() => handleAlertDecision("approve")}>
                  {alertActionLoading ? <Loader2 size={15} className="animate-spin mr-2" /> : null}
                  Approuver
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}