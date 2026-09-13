import type { ParentProps } from "solid-js";
import { HydrationScript } from "@solidjs/web";

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta
          name="description"
          content="A presentation editor for portable Mermaid diagrams with process notation."
        />
        <meta name="theme-color" content="#143d3c" />
        <title>Manatee — Diagram studio</title>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
