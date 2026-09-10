export interface GeneratedBpmnLayout {
  readonly source: string;
  readonly warnings: readonly {
    readonly code: string | undefined;
    readonly message: string;
  }[];
}

export async function generateBpmnLayout(
  source: string,
): Promise<GeneratedBpmnLayout> {
  const { layoutProcess } = await import("bpmn-auto-layout");
  const result = await layoutProcess(source);
  return {
    source: result.xml,
    warnings: Object.freeze(
      result.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message ?? "BPMN automatic layout reported a warning.",
      })),
    ),
  };
}
