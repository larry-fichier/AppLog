// userId -> jti (JWT ID, fixe pour toute la durée de vie d'une session)
// Ne change pas lors du renouvellement glissant, uniquement au login/logout.
// Un seul jti actif par utilisateur à la fois.
export const activeSessions = new Map<string, string>();
