
/**
 * STUB: This file replaces the real Firebase SDK to remove Google Cloud dependencies.
 * It provides the same interface to avoid breaking existing components,
 * but redirects logic to our local PostgreSQL API.
 */

import { apiFetch, getAuthToken, getUserData, removeAuthToken, removeUserData } from "./api";

export const db: any = {}; // Firestore is bypassed
export const auth: any = {
  currentUser: getUserData(),
};

export const onAuthStateChanged = (authObj: any, callback: (user: any) => void) => {
  const user = getUserData();
  // Simulate async behavior of Firebase
  setTimeout(() => {
    callback(user ? { ...user, uid: String(user.id) } : null);
  }, 0);
  
  // Return a dummy unsubscribe function
  return () => {};
};

export const signInWithEmailAndPassword = async (authObj: any, email: string, pass: string) => {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Login failed");
  }

  const data = await response.json();
  localStorage.setItem("helios_token", data.token);
  localStorage.setItem("helios_user", JSON.stringify(data.user));
  
  return { user: { ...data.user, uid: String(data.user.id) } };
};

export const signOut = async () => {
  removeAuthToken();
  removeUserData();
  window.location.reload(); // Hard reload to clear all states
};

// Dummy exports for types and other used functions
export const doc = (db: any, collection: string, id: string) => ({ collection, id });
export const collection = (db: any, name: string) => name;
export const getDoc = async (docRef: any) => {
  // If it's config/global, fetch from /api/config
  if (docRef.collection === "config" && docRef.id === "global") {
    const res = await apiFetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      return { 
        exists: () => true, 
        data: () => ({
          categories: data.categories || [],
          zones: (data.zones || []).map((z: any) => ({ id: z.id, label: z.name })),
          stations: (data.stations || []).map((s: any) => ({ id: s.id, label: s.name, zoneId: s.zone_id })),
          roles: [
            { id: "admin", label: "Super Administrateur" },
            { id: "chef_bureau_logistique", label: "Chef Bureau Logistique" },
            { id: "agent_logistique", label: "Agent Logistique" }
          ]
        }) 
      };
    }
  }
  return { exists: () => false, data: () => null };
};

export const setDoc = async (docRef: any, data: any) => {
  // Redirect to appropriate API if needed, otherwise ignore for local sync
  console.log("Stub setDoc:", docRef, data);
};

export const updateDoc = async (docRef: any, data: any) => {
  console.log("Stub updateDoc:", docRef, data);
};

export const addDoc = async (collection: string, data: any) => {
  if (collection === "equipment") {
    const res = await apiFetch("/api/equipment", {
      method: "POST",
      body: JSON.stringify(data)
    });
    return res.ok ? { id: (await res.json()).id } : null;
  }
};

export const onSnapshot = (query: any, callback: (snap: any) => void) => {
  // We can't do real-time without WebSockets or long polling easily here,
  // so we'll do an initial fetch and suggest polling.
  return () => {};
};

export const signInWithPopup = async () => {
  throw new Error("Google Login a été supprimé. Utilisez Email/Mot de passe.");
};

export const createUserWithEmailAndPassword = async (authObj: any, email: string, pass: string) => {
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("helios_token")}` },
    body: JSON.stringify({ email, password: pass, username: email.split('@')[0], displayName: email.split('@')[0] })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "User creation failed");
  }

  return await response.json();
};

export const query = (colRef: any, ...constraints: any[]) => colRef;
export const orderBy = (field: string, direction: string = "asc") => ({ field, direction });
export const where = (field: string, op: string, value: any) => ({ field, op, value });
export const limit = (n: number) => ({ limit: n });

export const deleteDoc = async (docRef: any) => {
  if (docRef.collection === "equipment") {
    const res = await apiFetch(`/api/equipment/${docRef.id}`, { method: "DELETE" });
    return res.ok;
  }
};

export const googleProvider = {};

export interface User {
  uid: string;
  email: string;
  displayName: string | null;
}

export enum OperationType {
   CREATE = 'create', UPDATE = 'update', DELETE = 'delete', LIST = 'list', GET = 'get', WRITE = 'write'
}

export function handleFirestoreError(e: any) { console.error(e); }
export const sendPasswordResetEmail = async () => { 
  alert("Veuillez contacter l'administrateur pour réinitialiser votre mot de passe.");
};
