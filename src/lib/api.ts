
/**
 * Utility for making authenticated API requests to the local server
 */

export const getAuthToken = () => localStorage.getItem("helios_token");
export const setAuthToken = (token: string) => localStorage.setItem("helios_token", token);
export const removeAuthToken = () => localStorage.removeItem("helios_token");

export const setUserData = (user: any) => localStorage.setItem("helios_user", JSON.stringify(user));
export const getUserData = () => {
  const data = localStorage.getItem("helios_user");
  return data ? JSON.parse(data) : null;
};
export const removeUserData = () => localStorage.removeItem("helios_user");

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const headers = {
    ...options.headers as any,
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {})
  };

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  if (response.status === 401) {
    // Session expired
    removeAuthToken();
    removeUserData();
    // Logic to redirect to login could go here if managed by state
  }

  return response;
}
