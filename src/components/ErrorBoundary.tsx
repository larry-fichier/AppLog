import React, { useState, useEffect, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

export function ErrorBoundary({ children }: Props) {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setError(event.error);
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  if (hasError) {
    let errorMessage = "Une erreur inattendue est survenue.";
    
    try {
      if (error?.message) {
        const parsed = JSON.parse(error.message);
        if (parsed.error && parsed.error.includes("permission")) {
          errorMessage = "Vous n'avez pas les permissions nécessaires pour effectuer cette action.";
        }
      }
    } catch (e) {
      // Not a JSON error
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-white rounded-xl border border-border-custom shadow-xl">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-6">
           <AlertTriangle size={32} />
        </div>
        <h2 className="text-xl font-bold text-text-dark mb-2">Erreur Détectée</h2>
        <p className="text-[#7f8c8d] max-w-md mb-8">{errorMessage}</p>
        <div className="flex gap-4">
          <button
            onClick={() => setHasError(false)}
            className="px-6 py-2 border border-border-custom text-text-dark rounded-md hover:bg-zinc-50 transition-colors font-semibold"
          >
            Réessayer
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors font-bold shadow-sm"
          >
            Recharger le Portail
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
