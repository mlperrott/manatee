import type { DocumentDiagnostic, SourcePatch } from "../document/types";

export type MetadataPathPart = string | number;
export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly MetadataValue[]
  | { readonly [key: string]: MetadataValue };

export type MetadataEdit =
  | {
      readonly type: "set";
      readonly path: readonly MetadataPathPart[];
      readonly value: MetadataValue;
    }
  | {
      readonly type: "remove";
      readonly path: readonly MetadataPathPart[];
    };

export type ManateeMetadataState =
  "absent" | "valid" | "invalid" | "unknown-version" | "malformed";

export interface ManateeMetadataRead {
  readonly state: ManateeMetadataState;
  readonly sourceMetadata: Readonly<Record<string, unknown>> | undefined;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly visualEditing: boolean;
}

export interface ManateeMetadataPatch extends ManateeMetadataRead {
  readonly source: string;
  readonly patches: readonly SourcePatch[];
}

export interface AuthoredIdentityIndex {
  readonly nodes: ReadonlySet<string>;
  readonly relationships: ReadonlySet<string>;
  readonly relationshipMatchers: ReadonlySet<string>;
  readonly groups: ReadonlySet<string>;
  readonly lanes: ReadonlySet<string>;
}

export interface UnmatchedMetadata {
  readonly edits: readonly MetadataEdit[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}
