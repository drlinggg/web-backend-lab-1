import { Injectable, Inject, OnApplicationShutdown } from '@nestjs/common';
import { Driver, Session, SessionConfig } from 'neo4j-driver';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@Inject('NEO4J') private readonly driver: Driver) {}

  getDriver(): Driver {
    return this.driver;
  }

  getSession(config?: SessionConfig): Session {
    return this.driver.session(config);
  }

  async onApplicationShutdown() {
    await this.driver.close();
  }

  async initDatabase() {
    const session = this.getSession();
    try {
      // Создание индексов
      await session.run(`
        CREATE CONSTRAINT user_id IF NOT EXISTS 
        FOR (u:User) REQUIRE u.id IS UNIQUE
      `);
      
      await session.run(`
        CREATE CONSTRAINT repository_id IF NOT EXISTS 
        FOR (r:Repository) REQUIRE r.id IS UNIQUE
      `);
      
      await session.run(`
        CREATE INDEX repository_fullName IF NOT EXISTS 
        FOR (r:Repository) ON (r.fullName)
      `);
      
      await session.run(`
        CREATE INDEX repository_viewCount IF NOT EXISTS 
        FOR (r:Repository) ON (r.viewCount)
      `);

      console.log('Database indexes created successfully');
    } catch (error) {
      console.error('Error creating database indexes:', error);
    } finally {
      await session.close();
    }
  }

  async query(cypher: string, params: any = {}) {
    const session = this.getSession();
    try {
      console.log('🔍 Cypher Query:', cypher);
      console.log('📦 Params:', JSON.stringify(params, null, 2));
      
      const start = Date.now();
      const result = await session.run(cypher, params);
      const duration = Date.now() - start;
      
      console.log(`✅ Query executed in ${duration}ms`);
      console.log(`📊 Records returned: ${result.records.length}`);
      
      return result;
    } catch (error) {
      console.error('❌ Neo4j Error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }
}
