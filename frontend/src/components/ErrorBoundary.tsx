import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Red de seguridad para los fallos de render.
 *
 * Sin esto, cualquier excepción durante el render desmonta el árbol entero y
 * deja la pantalla en blanco, sin un mensaje ni forma de salir: el usuario solo
 * ve que "la app no va". Con la frontera, el fallo queda acotado y siempre hay
 * una salida.
 *
 * Tiene que ser una clase: los hooks no pueden capturar errores de render.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Queda en la consola para poder diagnosticarlo desde el móvil.
    console.error("Fallo de render:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-dvh items-center justify-center bg-paper-100 p-6 dark:bg-ink-200">
        <div className="max-w-sm text-center">
          <h1 className="font-ui text-base font-semibold text-ink-900 dark:text-paper-100">
            Algo se ha roto
          </h1>
          <p className="mt-2 font-ui text-sm text-muted-light dark:text-muted-dark">
            La app ha fallado al dibujar esta pantalla. Tus conversaciones y tus
            notas siguen guardadas en este dispositivo.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 min-h-[44px] rounded-lg bg-amber-500 px-5 font-ui text-sm font-medium text-white active:scale-95"
          >
            Recargar
          </button>
          <p className="mt-4 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            {error.message}
          </p>
        </div>
      </div>
    );
  }
}
