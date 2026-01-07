import { executeDemoDataMigration } from './demo-data-migration';

/**
 * Seed demo data using direct SQL migration
 * This is more reliable than individual INSERT statements
 */
export const seedDemoData = async () => {
  console.log('🌱 Seeding demo data using SQL migration...');
  
  try {
    await executeDemoDataMigration();
    console.log('✅ Demo data seeded successfully');
  } catch (error: any) {
    console.error('❌ Failed to seed demo data:', error);
    throw error;
  }
};

