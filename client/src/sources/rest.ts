/**
 * FileSource backed by the Node REST backend, scoped to one workspace root.
 * A thin shim: it captures `root` and forwards each call to the typed `api`
 * client, so the rest of the app no longer threads `root` through every call.
 */

import { api } from '../api';
import type { FileSource } from './types';

export function createRestSource(root: string): FileSource {
  return {
    kind: 'rest',
    tree: () => api.tree(root).then((r) => r.tree),
    file: (path) => api.file(root, path),
    save: (path, content, baseHash) => api.save({ root, path, content, baseHash }),
    create: (path, content) => api.create({ root, path, content }),
    mkdir: (path) => api.createFolder({ root, path }),
    remove: (path) => api.remove({ root, path }),
    move: (from, to) => api.move({ root, from, to }),
    assetUrl: (path) => Promise.resolve(api.rawUrl(root, path)),
  };
}
