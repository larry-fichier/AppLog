export type UserRole = 
  | "admin" 
  | "chef_bureau_logistique" 
  | "agent_logistique" 
  | "csph" 
  | "chef_service_administratif";

export interface AppUser {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
}

export type EquipmentCategory = "rame" | "cuisine" | "electronique" | "groupe" | string;
export type EquipmentStatus = "fonctionnel" | "en_reparation" | "hors_service";

export interface EquipmentLocation {
  zone: string; // This was the Secteur but now Secteur is gone, so this is Zone (Service)
  station: string; // This was Station but now Station (Bureau)
  service?: string; // Legacy
  office?: string; // Legacy
}

export interface EquipmentDetails {
  licensePlate?: string;
  mileage?: number;
  brand?: string;
  serialNumber?: string;
  capacity?: string;
  power?: string;
  operatingHours?: number;
  [key: string]: any;
}

export interface Equipment {
  id?: string;
  name: string;
  category: EquipmentCategory;
  status: EquipmentStatus;
  location: EquipmentLocation;
  details: EquipmentDetails;
  arrivalDate?: string | null;
  departureDate?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface GlobalSettings {
  categories: { id: string; label: string; icon: string }[];
  zones: { id: string; label: string }[];
  stations: { id: string; label: string; zoneId?: string }[];
  roles: { id: string; label: string }[];
}
