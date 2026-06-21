/**
 * Typed fetch wrappers over the lookmd backend. The request/response shapes
 * come from the shared contract module, so the client and server never drift.
 */

import type {
  ListFoldersResponse,
  GetTreeResponse,
  GetFileResponse,
  PutFileRequest,
  PutFileResponse,
  CreateFileRequest,
  CreateFileResponse,
  DeleteFileRequest,
  DeleteFileResponse,
  MoveRequest,
  MoveResponse,
  ApiError,
  ApiErrorCode,
} from '@lookmd/shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(
      res.status,
      body.code ?? 'IO_ERROR',
      body.error ?? res.statusText,
    );
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiRequestError(0, 'IO_ERROR', 'could not reach the server');
  }
  return unwrap<T>(res);
}

/** JSON request with a body, for the write endpoints. */
async function sendJson<T>(method: string, url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'IO_ERROR', 'could not reach the server');
  }
  return unwrap<T>(res);
}

const q = encodeURIComponent;

export const api = {
  folders: (path = ''): Promise<ListFoldersResponse> =>
    getJson(`/api/folders?path=${q(path)}`),

  tree: (root = ''): Promise<GetTreeResponse> => getJson(`/api/tree?root=${q(root)}`),

  file: (root: string, path: string): Promise<GetFileResponse> =>
    getJson(`/api/file?root=${q(root)}&path=${q(path)}`),

  save: (req: PutFileRequest): Promise<PutFileResponse> =>
    sendJson('PUT', '/api/file', req),

  create: (req: CreateFileRequest): Promise<CreateFileResponse> =>
    sendJson('POST', '/api/file', req),

  remove: (req: DeleteFileRequest): Promise<DeleteFileResponse> =>
    sendJson('DELETE', '/api/file', req),

  move: (req: MoveRequest): Promise<MoveResponse> =>
    sendJson('POST', '/api/move', req),

  /** URL the browser can GET for an image asset's raw bytes. */
  rawUrl: (root: string, path: string): string =>
    `/api/raw?root=${q(root)}&path=${q(path)}`,
};
