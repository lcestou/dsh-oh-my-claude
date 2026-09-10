// dsh's module loader hands plugins the host's react-dom (its own client bundles require it), and
// the build leaves it external. Only the one export the plugin uses is declared here, so the plugin
// carries no @types/react-dom for a single function.
declare module "react-dom" {
  import type { ReactNode, ReactPortal } from "react";
  export function createPortal(children: ReactNode, container: Element): ReactPortal;
}
