/** Messages exchanged by the SQLite journal controller and its worker. */
export interface PersistenceOperation {
  operationId: number;
  table: string;
  upserts: [key: string, json: string][];
  deletes: string[];
  state: "pending" | "applied";
  createdAt: number | null;
  appliedAt: number | null;
}

export interface PersistenceWriteMessage {
  type: "write";
  operationId: number;
  table: string;
  upserts: [key: string, json: string][];
  deletes: string[];
}

export type PersistenceWorkerRequest = PersistenceWriteMessage
  | { type: "reconciled"; operationId: number; table: string }
  | { type: "close" };

export type PersistenceWorkerResponse =
  | { type: "write-complete"; operationId: number; table: string; reconciled: boolean }
  | { type: "error"; operationId: number; table: string; error: string }
  | { type: "closed"; error: string | null };

export interface PersistenceWorkerData {
  sharedBuffer: SharedArrayBuffer;
  dbPath: string;
}
