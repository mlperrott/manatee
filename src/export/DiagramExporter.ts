export interface SvgExport {
  readonly filename: string;
  readonly source: string;
}

export interface PngExportOptions {
  readonly scale: number;
  readonly background: string | "transparent";
}

export interface DiagramExporter {
  svg(): Promise<SvgExport>;
  png(options: PngExportOptions): Promise<Blob>;
}
