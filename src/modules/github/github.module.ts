import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { GithubService } from './services/github.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
