import { Match, Switch } from "solid-js";

import type { DocumentSessionStatus } from "../core/document/DocumentSession";

interface StatusNoticeProps {
  status: DocumentSessionStatus;
}

export function StatusNotice(props: StatusNoticeProps) {
  return (
    <Switch>
      <Match when={props.status.kind === "loading"}>
        <div class="status-notice status-notice--loading" role="status">
          <span class="status-notice__spinner" aria-hidden="true" />
          {props.status.kind === "loading" ? props.status.message : "Loading"}
        </div>
      </Match>
      <Match when={props.status.kind === "error"}>
        <div class="status-notice status-notice--error" role="alert">
          {props.status.kind === "error"
            ? props.status.message
            : "The editor could not load."}
        </div>
      </Match>
    </Switch>
  );
}
