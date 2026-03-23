import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { GithubService } from '../../github/services/github.service';
import { UserRole } from '../interfaces/user.interface';

function toNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  return Number(val);
}

@Injectable()
export class UserService {
  constructor(
    private db: DatabaseService,
    private githubService: GithubService,
  ) {}

  async getUserWithToken(userId: string): Promise<any> {
    const session = this.db.getSession();
    try {
      const result = await session.run('MATCH (u:User {id: $userId}) RETURN u', { userId });
      if (result.records.length === 0) return null;
      return result.records[0].get('u').properties;
    } finally {
      await session.close();
    }
  }

  async getUserLikedRepositories(userId: string): Promise<any[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $userId})-[:LIKES]->(r:Repository)
         RETURN r ORDER BY r.name`,
        { userId },
      );
      return result.records.map((record) => {
        const props = record.get('r').properties;
        return { ...props, createdAt: new Date(props.createdAt), updatedAt: new Date(props.updatedAt) };
      });
    } finally {
      await session.close();
    }
  }

  async getUserRepositories(userId: string): Promise<any[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $userId})-[:OWNS]->(r:Repository)
         RETURN r ORDER BY r.viewCount DESC`,
        { userId },
      );
      return result.records.map((record) => {
        const props = record.get('r').properties;
        return { ...props, createdAt: new Date(props.createdAt), updatedAt: new Date(props.updatedAt) };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Fetch repos from GitHub API, upsert them into Neo4j, create OWNS relationships,
   * and return a merged list enriched with local metadata (viewCount, isAnalyzed).
   */
  async getGithubRepos(userId: string): Promise<any[]> {
    const dbUser = await this.getUserWithToken(userId);
    if (!dbUser?.githubAccessToken) {
      return this.getUserRepositories(userId);
    }

    const ghRepos = await this.githubService.getUserRepositoriesFromGithub(dbUser.githubAccessToken);
    if (!ghRepos.length) return this.getUserRepositories(userId);

    const session = this.db.getSession();
    try {
      const knownResult = await session.run(
        `MATCH (u:User {id: $userId})-[:OWNS]->(r:Repository) RETURN r.fullName as fullName, r`,
        { userId },
      );
      const knownMap = new Map<string, any>();
      for (const rec of knownResult.records) {
        knownMap.set(rec.get('fullName'), rec.get('r').properties);
      }

      const merged: any[] = [];
      for (const gh of ghRepos) {
        const fullName: string = gh.full_name;
        const existing = knownMap.get(fullName);
        merged.push({
          id: existing?.id ?? null,
          name: fullName,
          fullName,
          description: gh.description || '',
          url: gh.html_url,
          ownerId: userId,
          ownerName: dbUser.username,
          viewCount: toNumber(existing?.viewCount),
          stars: gh.stargazers_count || 0,
          forks: gh.forks_count || 0,
          isAnalyzed: !!existing,
          isPrivate: gh.private,
          pushedAt: gh.pushed_at,
        });
      }

      merged.sort((a, b) => (a.isAnalyzed === b.isAnalyzed ? 0 : a.isAnalyzed ? -1 : 1));
      return merged;
    } finally {
      await session.close();
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      const userResult = await session.run(
        'MATCH (u:User {id: $userId}) RETURN u.role as role',
        { userId },
      );
      if (userResult.records.length > 0) {
        const role = userResult.records[0].get('role');
        if (role === UserRole.ADMIN) {
          throw new HttpException('Cannot delete admin user', HttpStatus.FORBIDDEN);
        }
      }
      await session.run('MATCH (u:User {id: $userId}) DETACH DELETE u', { userId });
    } finally {
      await session.close();
    }
  }

  async deleteRepository(repoId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      await session.run(
        `MATCH (r:Repository {id: $repoId})
         OPTIONAL MATCH (r)-[:CONTAINS]->(m:Module)
         OPTIONAL MATCH (a:Analysis {repositoryId: $repoId})
         DETACH DELETE r, m, a`,
        { repoId },
      );
    } finally {
      await session.close();
    }
  }
}
