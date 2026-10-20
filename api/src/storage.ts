import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { config } from './config';

/**
 * Where attachment files live. On Replit this is Replit Object Storage (backed
 * by Google Cloud Storage); elsewhere it falls back to a local folder.
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Bad storage key');
    return resolved;
  }
  async put(key: string, data: Buffer) {
    const file = this.file(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, data);
  }
  async stream(key: string) {
    const file = this.file(key);
    await fs.promises.access(file);
    return fs.createReadStream(file);
  }
  async delete(key: string) {
    await fs.promises.rm(this.file(key), { force: true });
  }
}

type ReplitResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

class ReplitStorage implements Storage {
  private client: any;
  private getClient() {
    if (!this.client) {
      // Loaded lazily so the package is only needed on Replit.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client } = require('@replit/object-storage');
      this.client = process.env.REPLIT_BUCKET_ID ? new Client({ bucketId: process.env.REPLIT_BUCKET_ID }) : new Client();
    }
    return this.client;
  }
  private check<T>(result: ReplitResult<T>, action: string): T {
    if (!result.ok) {
      throw new Error(
        `Object Storage ${action} failed: ${String((result.error as any)?.message ?? result.error)}. ` +
          'Create a bucket in Replit\'s Object Storage tool.',
      );
    }
    return result.value;
  }
  async put(key: string, data: Buffer) {
    this.check(await this.getClient().uploadFromBytes(key, data), 'upload');
  }
  async stream(key: string): Promise<Readable> {
    return this.getClient().downloadAsStream(key);
  }
  async delete(key: string) {
    const result = await this.getClient().delete(key, { ignoreNotFound: true });
    this.check(result, 'delete');
  }
}

export const storage: Storage =
  config.storageDriver === 'replit' ? new ReplitStorage() : new LocalStorage(config.localStorageDir);
