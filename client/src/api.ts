/**
 * Typed fetch wrappers over the lookmd backend. The request/response shapes
 * come from the shared contract module, so the client and server never drift.
 */

import type {
  ListFoldersResponse,
  GetTreeResponse,
  GetFileResponse,
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

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiRequestError(0, 'IO_ERROR', 'could not reach the server');
  }
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

const q = encodeURIComponent;

export const api = {
  folders: (path = ''): Promise<ListFoldersResponse> =>
    getJson(`/api/folders?path=${q(path)}`),

  tree: (root = ''): Promise<GetTreeResponse> => getJson(`/api/tree?root=${q(root)}`),

  file: (root: string, path: string): Promise<GetFileResponse> =>
    getJson(`/api/file?root=${q(root)}&path=${q(path)}`),
};
