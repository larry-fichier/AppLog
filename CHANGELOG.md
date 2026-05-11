# HELIOS — Patch complet

## 🔴 Bugs corrigés

### `src/server/app.ts`
- **Transfert** : la validation rejetait les transferts valides (zones identiques). Logique corrigée.
- **Token JWT** : le frontend lisait le token depuis `localStorage` alors que le serveur l'envoie en cookie `httpOnly`. Conflit résolu — seul le cookie est utilisé désormais.
- **PUT /equipment** : ajout de la validation Zod (`.partial()`) sur la route de modification, cohérente avec le POST.
- **DELETE /equipment** : ajout du middleware `authorize(['admin','chef_bureau_logistique'])` — n'importe quel utilisateur connecté ne peut plus supprimer.

## 🟡 Sécurité

### `src/server/app.ts`
- **Rate limiter** : suppression du `skip` en développement. Max 20 tentatives en dev, 5 en prod.
- **Route logout** `POST /api/auth/logout` ajoutée — expire proprement le cookie `httpOnly`.
- **Audit log** sur PUT et DELETE équipements.

## 🔵 Nouvelles fonctionnalités

### `src/server/app.ts`
- **`GET /api/equipment/:id/history`** : historique complet des mouvements d'un équipement (zones, stations, statuts, auteur, date).
- **`GET /api/events`** (SSE) : flux Server-Sent Events temps réel. Broadcast automatique sur création d'équipement et événements critiques (sortie, hors_service).

### `src/App.tsx`
- **Mode sombre** 🌙 : toggle dans la navbar, persiste en `localStorage`. La classe `.dark` est déjà configurée dans `index.css`.
- **Notifications temps réel** 🔔 : cloche avec badge rouge (non-lus), panneau déroulant, connexion SSE automatique à la connexion.
- **Session sécurisée** : restauration via cookie uniquement, validation par `/api/health`.

### `src/components/EquipmentDialog.tsx`
- **Historique timeline** : bouton "Historique" dans le footer de la fiche, affiche tous les mouvements en timeline verticale avec couleurs par type.
- **QR Code** : bouton "QR Code" dans le footer, génère un QR encodant l'URL de l'équipement, bouton impression.

### `src/components/SupervisionDashboard.tsx`
- **Export PDF** : bouton "Rapport PDF" dans la toolbar — ouvre une fenêtre imprimable mise en page (stats KPI + tableau complet).
- **Graphique 7 jours** : barres empilées SVG pur (zéro dépendance) des mouvements par type sur les 7 derniers jours, avec tooltip et légende.

## 📋 Installation
Remplacer les 4 fichiers dans votre projet. Aucune nouvelle dépendance npm requise.
