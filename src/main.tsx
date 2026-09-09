import { render } from "@solidjs/web";

import App from "./App";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Manatee could not find its application root.");
}

render(() => <App />, root);
