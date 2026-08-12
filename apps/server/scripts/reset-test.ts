import { setupDb } from '../src/db';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

try {
  console.log('Resetting test database...');
  const dbPath = path.join(process.cwd(), 'data', 'terminal.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  setupDb();
  console.log('Test database reset successfully.');
  process.exit(0);
} catch (error) {
  console.error('Error during reset:', error);
  process.exit(1);
}
