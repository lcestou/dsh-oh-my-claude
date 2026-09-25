// dsh's module loader hands plugins the host's react-dom (its own client bundles require it), and
// the build leaves it external. Only the exports the plugin uses are declared here, so the plugin
// carries no @types/react-dom for two functions.
declare module "react-dom" {
  import type { ReactNode, ReactPortal } from "react";
  export function createPortal(children: ReactNode, container: Element): ReactPortal;
  export function flushSync(fn: () => void): void;
}
