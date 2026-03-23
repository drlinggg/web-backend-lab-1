import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class AdminService {
  constructor(private db: DatabaseService) {}

  /**
   * Return all users ordered by creation date descending.
   */
  async getAllUsers(): Promise<any[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User)
         OPTIONAL MATCH (u)-[:OWNS]->(r:Repository)
         RETURN u, count(r) as repoCount
         ORDER BY u.createdAt DESC`,
      );
      return result.records.map((rec) => {
        const props = rec.get('u').properties;
        return {
          id: props.id,
          username: props.username,
          githubUsername: props.githubUsername,
          email: props.email,
          avatarUrl: props.avatarUrl,
          role: props.role,
          createdAt: props.createdAt,
          lastLoginAt: props.lastLoginAt,
          repoCount: rec.get('repoCount').toNumber ? rec.get('repoCount').toNumber() : Number(rec.get('repoCount')),
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Return aggregated platform statistics.
   */
  async getStats(): Promise<any> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User) WITH count(u) as totalUsers
         MATCH (r:Repository) WITH totalUsers, count(r) as totalRepos, sum(r.viewCount) as totalViews
         MATCH (m:Module) WITH totalUsers, totalRepos, totalViews, count(m) as totalModules
         RETURN totalUsers, totalRepos, totalViews, totalModules`,
      );

      const topResult = await session.run(
        `MATCH (r:Repository)
         RETURN r.fullName as name, r.viewCount as views, r.stars as stars
         ORDER BY r.viewCount DESC LIMIT 5`,
      );

      const roleResult = await session.run(
        `MATCH (u:User) RETURN u.role as role, count(u) as cnt`,
      );

      if (result.records.length === 0) {
        return { totalUsers: 0, totalRepos: 0, totalViews: 0, totalModules: 0, topRepos: [], roleBreakdown: {} };
      }

      const rec = result.records[0];
      const toN = (v: any) => (v?.toNumber ? v.toNumber() : Number(v ?? 0));

      const topRepos = topResult.records.map((r) => ({
        name: r.get('name'),
        views: toN(r.get('views')),
        stars: toN(r.get('stars')),
      }));

      const roleBreakdown: Record<string, number> = {};
      for (const r of roleResult.records) {
        roleBreakdown[r.get('role')] = toN(r.get('cnt'));
      }

      return {
        totalUsers: toN(rec.get('totalUsers')),
        totalRepos: toN(rec.get('totalRepos')),
        totalViews: toN(rec.get('totalViews')),
        totalModules: toN(rec.get('totalModules')),
        topRepos,
        roleBreakdown,
      };
    } finally {
      await session.close();
    }
  }
}
