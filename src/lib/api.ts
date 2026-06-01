
/**
 * Utility for making authenticated API requests to the local server
 *
 * sessionStorage (pas localStorage) : les données sont effacées à la fermeture
 * du navigateur, cohérent avec le cookie de session httpOnly sans maxAge.
 */

export const setUserData = (user: any) => sessionStorage.setItem("helios_user", JSON.stringify(user));
export const getUserData = () => {
  const data = sessionStorage.getItem("helios_user");
  return data ? JSON.parse(data) : null;
};
export const removeUserData = () => sessionStorage.removeItem("helios_user");

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const headers = {
    ...options.headers as any,
    "Content-Type": "application/json",
  };

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (response.status === 401) {
    removeUserData();
  }

  return response;
}
