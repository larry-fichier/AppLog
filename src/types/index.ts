export type EquipmentCategory = "rame" | "cuisine" | "electronique" | "groupe";

export type EquipmentStatus = "fonctionnel" | "en_reparation" | "hors_service";

export interface EquipmentDetails {
  licensePlate?: string;
  mileage?: number;
  serialNumber?: string;
  brand?: string;
  power?: string;
  operatingHours?: number;
  capacity?: string;
}

export interface EquipmentLocation {
  zone: string;
  station: string;
  service: "operation" | "administratif";
  office: string;
}

export interface Equipment {
  id?: string;
  name: string;
  category: EquipmentCategory;
  status: EquipmentStatus;
  arrivalDate?: string;
  departureDate?: string;
  location: EquipmentLocation;
  lastMaintenance?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  details: EquipmentDetails;
}

export type UserRole = "csph" | "chef_service_administratif" | "agent_logistique" | "chef_bureau_logistique" | "admin" | "viewer";

export interface AppUser {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
}
