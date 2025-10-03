import { DatabaseAdapter, createDatabaseAdapter } from '../../src/database/database-adapter';
import { NodeRepository } from '../../src/database/node-repository';
import * as fs from 'fs';
import * as path from 'path';

export interface TestDatabaseOptions {
  /** Use an in-memory sqlite database (default: true). */
  inMemory?: boolean;
  /** Optional explicit path when creating a file-backed database. */
  dbPath?: string;
  /** Skip schema initialization when fixtures want an empty database. */
  initSchema?: boolean;
}

export interface TestDatabase {
  adapter: DatabaseAdapter;
  nodeRepository: NodeRepository;
  path: string;
  cleanup: () => Promise<void>;
}

export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const { inMemory = true, dbPath, initSchema = true } = options;
  const resolvedPath = inMemory ? ':memory:' : dbPath || path.join(__dirname, '../temp/test-db.sqlite');

  if (!inMemory) {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const adapter = await createDatabaseAdapter(resolvedPath);

  if (initSchema) {
    initializeSchema(adapter);
  }

  const nodeRepository = new NodeRepository(adapter);

  const cleanup = async () => {
    adapter.close();
    if (!inMemory && fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
  };

  return {
    adapter,
    nodeRepository,
    path: resolvedPath,
    cleanup,
  };
}

function initializeSchema(adapter: DatabaseAdapter): void {
  const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  adapter.exec(schema);
}
