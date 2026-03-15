import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ForbiddenException,
} from '@nestjs/common';
import { RepositoryService } from '../services/repository.service';
import { RepositoryAnalysisService } from '../services/repository-analysis.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { OptionalJwtGuard } from '../../auth/guards/optional-jwt.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentUser } from '../../../common/decorators/user.decorator';

@Controller('api/repos')
export class RepositoryController {
  constructor(
    private repositoryService: RepositoryService,
    private analysisService: RepositoryAnalysisService,
  ) {}

  @Get('top')
  async getTopRepositories(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.repositoryService.getTopRepositories(limit);
  }

  @Get('graph')
  @UseGuards(OptionalJwtGuard)
  async getRepositoryGraph(
    @Query('url') repoUrl: string,
    @CurrentUser() user: any,
  ) {
    return this.analysisService.analyzeRepository(repoUrl, user?.id);
  }

  @Post(':repoId/like')
  @UseGuards(JwtAuthGuard)
  async likeRepository(
    @Param('repoId') repoId: string,
    @CurrentUser() user: any,
  ) {
    await this.repositoryService.likeRepository(user.id, repoId);
    return { success: true };
  }

  @Delete(':repoId/like')
  @UseGuards(JwtAuthGuard)
  async unlikeRepository(
    @Param('repoId') repoId: string,
    @CurrentUser() user: any,
  ) {
    await this.repositoryService.unlikeRepository(user.id, repoId);
    return { success: true };
  }

  @Post(':repoId/view')
  async incrementViewCount(@Param('repoId') repoId: string) {
    await this.repositoryService.incrementViewCount(repoId);
    return { success: true };
  }

  @Delete(':repoId')
  @UseGuards(JwtAuthGuard)
  async deleteRepository(
    @Param('repoId') repoId: string,
    @CurrentUser() user: any,
  ) {
    const repo = await this.repositoryService.findById(repoId);
    if (!repo) return { success: true };

    const isAdmin = user.role === 'admin';
    const isOwner = repo.ownerId === user.id;

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('Not allowed to delete this repository');
    }

    await this.repositoryService.deleteRepository(repoId);
    return { success: true };
  }
}
