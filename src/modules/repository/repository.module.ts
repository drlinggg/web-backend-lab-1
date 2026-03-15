import { Module } from '@nestjs/common';
import { RepositoryController } from './controllers/repository.controller';
import { RepositoryService } from './services/repository.service';
import { RepositoryAnalysisService } from './services/repository-analysis.service';
import { DatabaseModule } from '../database/database.module';
import { GithubModule } from '../github/github.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, GithubModule, AuthModule],
  controllers: [RepositoryController],
  providers: [RepositoryService, RepositoryAnalysisService],
  exports: [RepositoryService],
})
export class RepositoryModule {}
