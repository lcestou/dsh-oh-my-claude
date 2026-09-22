// The product icons, resolved against whichever dsh is installed.
//
// dsh 0.1.7-alpha.1 renamed every sized icon export in
// `@deepseek-ai/dsh-client-ui-primitives`: the `14` suffix became `Regular`, the `16` suffix
// became `Medium`, and the set moved under `lib/types/icons/`. The old names are gone there and
// the new ones are absent on 0.1.5 and 0.1.6, so neither name alone imports on both lines. The
// client bundle marks `@deepseek-ai/*` external, which means a name the installed dsh does not
// export arrives as `undefined` and React throws error #130 the moment it is drawn. On 0.1.7
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

/** Every name this plugin draws, under both schemes: the 0.1.7 name first, then the one 0.1.5 and
 *  0.1.6 published. Each is optional because the installed dsh only declares one of the pair. */
type IconExports = Partial<
  Record<
    | "IconAgentPresetOutlineMedium"
    | "IconAgentPresetOutline16"
    | "IconApiOutlineRegular"
    | "IconApiOutline14"
    | "IconBrowseOutlineMedium"
    | "IconBrowseOutline16"
    | "IconChecklistOutlineRegular"
    | "IconChecklistOutline14"
    | "IconCheckOutlineMedium"
    | "IconCheckOutline16"
    | "IconChevronDownOutlineRegular"
    | "IconChevronDownOutline14"
    | "IconChevronRightOutlineRegular"
    | "IconChevronRightOutline14"
    | "IconCodeOutlineMedium"
    | "IconCodeOutline16"
    | "IconEditOutlineMedium"
    | "IconEditOutline16"
    | "IconFolderCloseMedium"
    | "IconFolderClose16"
    | "IconFolderOpenMedium"
    | "IconFolderOpen16"
    | "IconListPenOutlineMedium"
    | "IconListPenOutline16"
    | "IconPlusOutlineMedium"
    | "IconPlusOutline16"
    | "IconSearchOutlineMedium"
    | "IconSearchOutline16"
    | "IconSkillOutlineMedium"
    | "IconSkillOutline16"
    | "IconSparkleMedium"
    | "IconSparkle16",
    IconComponent
  >
>;

/** The package read through the names above. This is an assignment, not an assertion: the module
 *  namespace answers each name through its export binding, and a name this dsh does not publish
 *  reads undefined. */
const exported: IconExports = primitives;

/** A component that draws nothing, for a dsh newer than both naming schemes: one renamed glyph
 *  leaves a gap rather than blanking the slot around it. */
const blank: IconComponent = () => null;

export const IconAgentPresetOutlineMedium =
  exported.IconAgentPresetOutlineMedium ?? exported.IconAgentPresetOutline16 ?? blank;
export const IconApiOutlineRegular =
  exported.IconApiOutlineRegular ?? exported.IconApiOutline14 ?? blank;
export const IconBrowseOutlineMedium =
  exported.IconBrowseOutlineMedium ?? exported.IconBrowseOutline16 ?? blank;
export const IconChecklistOutlineRegular =
  exported.IconChecklistOutlineRegular ?? exported.IconChecklistOutline14 ?? blank;
export const IconCheckOutlineMedium =
  exported.IconCheckOutlineMedium ?? exported.IconCheckOutline16 ?? blank;
export const IconChevronDownOutlineRegular =
  exported.IconChevronDownOutlineRegular ?? exported.IconChevronDownOutline14 ?? blank;
export const IconChevronRightOutlineRegular =
  exported.IconChevronRightOutlineRegular ?? exported.IconChevronRightOutline14 ?? blank;
export const IconCodeOutlineMedium =
  exported.IconCodeOutlineMedium ?? exported.IconCodeOutline16 ?? blank;
export const IconEditOutlineMedium =
  exported.IconEditOutlineMedium ?? exported.IconEditOutline16 ?? blank;
export const IconFolderCloseMedium =
  exported.IconFolderCloseMedium ?? exported.IconFolderClose16 ?? blank;
export const IconFolderOpenMedium =
  exported.IconFolderOpenMedium ?? exported.IconFolderOpen16 ?? blank;
export const IconListPenOutlineMedium =
  exported.IconListPenOutlineMedium ?? exported.IconListPenOutline16 ?? blank;
export const IconPlusOutlineMedium =
  exported.IconPlusOutlineMedium ?? exported.IconPlusOutline16 ?? blank;
export const IconSearchOutlineMedium =
  exported.IconSearchOutlineMedium ?? exported.IconSearchOutline16 ?? blank;
export const IconSkillOutlineMedium =
  exported.IconSkillOutlineMedium ?? exported.IconSkillOutline16 ?? blank;
export const IconSparkleMedium = exported.IconSparkleMedium ?? exported.IconSparkle16 ?? blank;
