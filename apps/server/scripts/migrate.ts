import { setupDb } from '../src/db';

try {
  console.log('Running database migrations...');
  setupDb();
  console.log('Database migrations completed successfully.');
  process.exit(0);
} catch (error) {
  console.error('Error during migrations:', error);
  process.exit(1);
}
