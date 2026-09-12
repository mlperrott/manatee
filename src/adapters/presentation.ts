import type { PresentationCommandType } from "../core/document/DocumentEngine";
import type { PresentationCommandAvailability } from "../core/document/types";

export const presentationCommandTypes = [
  "move",
  "resize",
  "route",
  "set-appearance",
  "set-attribute",
  "create-styling-rule",
  "set-spacing",
  "use-automatic-position",
  "reset-layout",
  "cleanup-unmatched",
] as const satisfies readonly PresentationCommandType[];

export function presentationAvailability(
  values: Partial<
    Record<PresentationCommandType, PresentationCommandAvailability>
  >,
): Readonly<Record<PresentationCommandType, PresentationCommandAvailability>> {
  return Object.freeze(
    Object.fromEntries(
      presentationCommandTypes.map((type) => [
        type,
        values[type] ?? { state: "inapplicable" },
      ]),
    ) as Record<PresentationCommandType, PresentationCommandAvailability>,
  );
}

export const available = Object.freeze({ state: "available" as const });

export function disabled(reason: string): PresentationCommandAvailability {
  return Object.freeze({ state: "disabled", reason });
}
