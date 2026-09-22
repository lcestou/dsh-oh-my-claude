// The product icons, resolved against whichever dsh is installed.
//
// dsh 0.1.7-alpha.1 renamed every sized icon export in
// `@deepseek-ai/dsh-client-ui-primitives`: the `14` suffix became `Regular`, the `16` suffix
// became `Medium`, and the set moved under `lib/types/icons/`. The old names are gone there and
// the new ones are absent on 0.1.5 and 0.1.6, so neither name alone imports on both lines. The
// client bundle marks `@deepseek-ai/*` external, which means a name the installed dsh does not
// export arrives as `undefined` and React throws error #130 the moment it is drawn — on 0.1.7
// that took out every composer dock entry, the directory browser and the panel's icon rows at
// once.
//
// Each export below is the 0.1.7 name, looked up on the package with the pre-0.1.7 name as the
// fallback. Props match on both lines (`size`, `className`).
//
// When dsh 0.1.5 and 0.1.6 support ends: delete this file and import the same names straight from
// `@deepseek-ai/dsh-client-ui-primitives` in the four modules that import them from here.
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";
import type { CSSProperties, JSX } from "react";

/** What every icon component takes, on both dsh lines. */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined;
  /** Extra class for placement; the colour rides `currentColor`. */
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

type IconComponent = (props: IconProps) => JSX.Element | null;

/** One export of the primitives package by name, or undefined when this dsh has no such name. */
const exported = (name: string): IconComponent | undefined =>
  // SAFETY: both names each export asks for are icon components in every dsh that declares them,
  // and a name the installed dsh does not declare has no descriptor, so this reads undefined and
  // `icon` falls through to the next one.
  Object.getOwnPropertyDescriptor(primitives, name)?.value as IconComponent | undefined;

/** The first name the installed dsh exports. Neither present (a dsh newer than both naming
 *  schemes): a component that draws nothing, so one renamed glyph never blanks a whole slot. */
const icon = (current: string, legacy: string): IconComponent =>
  exported(current) ?? exported(legacy) ?? (() => null);

export const IconAgentPresetOutlineMedium = icon(
  "IconAgentPresetOutlineMedium",
  "IconAgentPresetOutline16",
);
export const IconApiOutlineRegular = icon("IconApiOutlineRegular", "IconApiOutline14");
export const IconBrowseOutlineMedium = icon("IconBrowseOutlineMedium", "IconBrowseOutline16");
export const IconChecklistOutlineRegular = icon(
  "IconChecklistOutlineRegular",
  "IconChecklistOutline14",
);
export const IconCheckOutlineMedium = icon("IconCheckOutlineMedium", "IconCheckOutline16");
export const IconChevronDownOutlineRegular = icon(
  "IconChevronDownOutlineRegular",
  "IconChevronDownOutline14",
);
export const IconChevronRightOutlineRegular = icon(
  "IconChevronRightOutlineRegular",
  "IconChevronRightOutline14",
);
export const IconCodeOutlineMedium = icon("IconCodeOutlineMedium", "IconCodeOutline16");
export const IconEditOutlineMedium = icon("IconEditOutlineMedium", "IconEditOutline16");
export const IconFolderCloseMedium = icon("IconFolderCloseMedium", "IconFolderClose16");
export const IconFolderOpenMedium = icon("IconFolderOpenMedium", "IconFolderOpen16");
export const IconListPenOutlineMedium = icon("IconListPenOutlineMedium", "IconListPenOutline16");
export const IconPlusOutlineMedium = icon("IconPlusOutlineMedium", "IconPlusOutline16");
export const IconSearchOutlineMedium = icon("IconSearchOutlineMedium", "IconSearchOutline16");
export const IconSkillOutlineMedium = icon("IconSkillOutlineMedium", "IconSkillOutline16");
export const IconSparkleMedium = icon("IconSparkleMedium", "IconSparkle16");
