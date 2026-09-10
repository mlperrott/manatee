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

export interface RasterEnvironment {
  readonly createCanvas: () => HTMLCanvasElement;
  readonly createImage: () => HTMLImageElement;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
}

const browserRasterEnvironment: RasterEnvironment = {
  createCanvas: () => document.createElement("canvas"),
  createImage: () => new Image(),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
};

export function portableFilename(filename: string, extension: string): string {
  const base = filename.replace(/\.[^.]+$/u, "").trim() || "diagram";
  return `${base}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function imageSize(svg: string): { width: number; height: number } {
  const viewBox =
    /viewBox=["']\s*[\d.e+-]+\s+[\d.e+-]+\s+([\d.e+-]+)\s+([\d.e+-]+)\s*["']/iu.exec(
      svg,
    );
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  const width = /\bwidth=["']([\d.e+-]+)/iu.exec(svg);
  const height = /\bheight=["']([\d.e+-]+)/iu.exec(svg);
  return {
    width: Number(width?.[1] ?? 1280),
    height: Number(height?.[1] ?? 720),
  };
}

export async function rasterizeSvg(
  svg: string,
  options: PngExportOptions,
  environment: RasterEnvironment = browserRasterEnvironment,
): Promise<Blob> {
  const size = imageSize(svg);
  const scale = Math.min(6, Math.max(1, options.scale));
  const canvas = environment.createCanvas();
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create PNG images.");
  if (options.background !== "transparent") {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const image = environment.createImage();
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = environment.createObjectUrl(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("The diagram could not be rasterized."));
      image.src = url;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("PNG encoding failed.")),
        "image/png",
      ),
    );
  } finally {
    environment.revokeObjectUrl(url);
  }
}

export async function copyPngOrDownload(
  blob: Blob,
  filename: string,
  fallback: (blob: Blob, filename: string) => void = downloadBlob,
): Promise<"copied" | "downloaded"> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Clipboard images are unavailable.");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    fallback(blob, filename);
    return "downloaded";
  }
}
