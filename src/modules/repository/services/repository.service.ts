import { Injectable } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { DatabaseService } from '../../database/database.service';
import { Repository } from '../interfaces/repository.interface';

function toNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  return Number(val);
}

function mapRepository(props: any): Repository {
  return {
    id: props.id,
    name: props.name,
    fullName: props.fullName,
    description: props.description ?? null,
    url: props.url,
    ownerId: props.ownerId ?? '',
    ownerName: props.ownerName ?? '',
    viewCount: toNumber(props.viewCount),
    stars: toNumber(props.stars),
    forks: toNumber(props.forks),
    isAnalyzing: props.isAnalyzing ?? false,
    lastCommitHash: props.lastCommitHash ?? null,
    createdAt: new Date(props.createdAt),
    updatedAt: new Date(props.updatedAt),
    lastAnalyzedAt: props.lastAnalyzedAt ? new Date(props.lastAnalyzedAt) : undefined,
  };
}

@Injectable()
export class RepositoryService {
  constructor(private db: DatabaseService) {}

  async getTopRepositories(limit: number = 10): Promise<Repository[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (r:Repository)
        RETURN r
        ORDER BY r.viewCount DESC
        LIMIT $limit
        `,
        { limit: neo4j.int(limit) },
      );
      return result.records.map((record) => mapRepository(record.get('r').properties));
    } finally {
      await session.close();
    }
  }

  async getUserRepositories(userId: string): Promise<Repository[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (u:User {id: $userId})-[:OWNS]->(r:Repository)
        RETURN r
        ORDER BY r.viewCount DESC
        `,
        { userId },
      );
      return result.records.map((record) => mapRepository(record.get('r').properties));
    } finally {
      await session.close();
    }
  }

  async getUserLikedRepositories(userId: string): Promise<Repository[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (u:User {id: $userId})-[:LIKES]->(r:Repository)
        RETURN r
        ORDER BY r.name
        `,
        { userId },
      );
      return result.records.map((record) => mapRepository(record.get('r').properties));
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<Repository | null> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        'MATCH (r:Repository {id: $id}) RETURN r',
        { id },
      );
      if (result.records.length === 0) return null;
      return mapRepository(result.records[0].get('r').properties);
    } finally {
      await session.close();
    }
  }

  async incrementViewCount(repoId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      await session.run(
        'MATCH (r:Repository {id: $repoId}) SET r.viewCount = r.viewCount + 1',
        { repoId },
      );
    } finally {
      await session.close();
    }
  }

  async likeRepository(userId: string, repositoryId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      await session.run(
        `
        MATCH (u:User {id: $userId})
        MATCH (r:Repository {id: $repositoryId})
        MERGE (u)-[:LIKES]->(r)
        `,
        { userId, repositoryId },
      );
    } finally {
      await session.close();
    }
  }

  async unlikeRepository(userId: string, repositoryId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      await session.run(
        `
        MATCH (u:User {id: $userId})-[l:LIKES]->(r:Repository {id: $repositoryId})
        DELETE l
        `,
        { userId, repositoryId },
      );
    } finally {
      await session.close();
    }
  }
  async deleteRepository(repoId: string): Promise<void> {
      const session = this.db.getSession();
      try {
        await session.run(
          `
          MATCH (r:Repository {id: $repoId})
          OPTIONAL MATCH (r)-[:CONTAINS]->(m:Module)
          OPTIONAL MATCH (a:Analysis {repositoryId: $repoId})
          DETACH DELETE r, m, a
          `,
          { repoId },
        );
      } finally {
        await session.close();
      }
    }
}
