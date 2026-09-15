export interface CloudProjectRow {
  id: string;
  name: string;
  data: unknown;
  schema_version: number;
  updated_at: string;
}
export interface CloudProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}
export interface CloudStore {
  selectProjects(): Promise<Array<Pick<CloudProjectRow, 'id' | 'name' | 'updated_at'>>>;
  selectProject(id: string): Promise<CloudProjectRow | null>;
  insertProject(row: { id: string; name: string; data: unknown; schema_version: number }): Promise<CloudProjectRow>;
  /** CAS: applies only where updated_at === expectedUpdatedAt; null = 0 rows (conflict OR denial). */
  updateProjectIf(
    id: string,
    expectedUpdatedAt: string,
    patch: { name: string; data: unknown; schema_version: number },
  ): Promise<CloudProjectRow | null>;
  deleteProject(id: string): Promise<void>;
  listBinaryIds(projectId: string): Promise<string[]>;
  uploadBinary(projectId: string, assetId: string, bytes: Uint8Array): Promise<void>;
  downloadBinary(projectId: string, assetId: string): Promise<Uint8Array>;
  removeBinaries(projectId: string, assetIds: string[]): Promise<void>;
}
