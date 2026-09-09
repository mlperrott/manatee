export interface WorkerTask<Request, Response> {
  readonly name: string;
  run(request: Request, signal?: AbortSignal): Promise<Response>;
}
