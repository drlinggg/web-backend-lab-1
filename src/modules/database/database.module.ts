import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import { DatabaseService } from './database.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'NEO4J',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('neo4j.uri') || 'bolt://localhost:7687';
        const username = configService.get<string>('neo4j.username') || 'neo4j';
        const password = configService.get<string>('neo4j.password') || 'password';
        return neo4j.driver(uri, neo4j.auth.basic(username, password));
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
