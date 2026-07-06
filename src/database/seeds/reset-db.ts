import { config } from 'dotenv';
import { execSync } from 'child_process';
import { assertLocalDevOnly } from './guards';

config();

assertLocalDevOnly('database reset');

console.log('Dropping schema...');
execSync('yarn schema:drop', { stdio: 'inherit' });

console.log('Running migrations...');
execSync('yarn migration:run', { stdio: 'inherit' });

console.log('\nDatabase reset complete. Seeding development data...\n');
