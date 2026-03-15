import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { User, UserRole } from '../interfaces/user.interface';

@Injectable()
export class UserService {
  constructor(private db: DatabaseService) {}

  async getUserLikedRepositories(userId: string): Promise<any[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (u:User {id: $userId})-[:LIKES]->(r:Repository)
        RETURN r
        ORDER BY r.name
        `,
        { userId }
      );
      
      return result.records.map(record => {
        const props = record.get('r').properties;
        return {
          ...props,
          createdAt: new Date(props.createdAt),
          updatedAt: new Date(props.updatedAt),
        };
      });
    } finally {
      await session.close();
    }
  }

  async getUserRepositories(userId: string): Promise<any[]> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (u:User {id: $userId})-[:OWNS]->(r:Repository)
        RETURN r
        ORDER BY r.viewCount DESC
        `,
        { userId }
      );
      
      return result.records.map(record => {
        const props = record.get('r').properties;
        return {
          ...props,
          createdAt: new Date(props.createdAt),
          updatedAt: new Date(props.updatedAt),
        };
      });
    } finally {
      await session.close();
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      // Проверяем, не является ли пользователь админом
      const userResult = await session.run(
        'MATCH (u:User {id: $userId}) RETURN u.role as role',
        { userId }
      );
      
      if (userResult.records.length > 0) {
        const role = userResult.records[0].get('role');
        if (role === UserRole.ADMIN) {
          throw new HttpException('Cannot delete admin user', HttpStatus.FORBIDDEN);
        }
      }
      
      // Удаляем пользователя и все его связи
      await session.run(
        `
        MATCH (u:User {id: $userId})
        DETACH DELETE u
        `,
        { userId }
      );
    } finally {
      await session.close();
    }
  }

  async deleteRepository(repoId: string): Promise<void> {
    const session = this.db.getSession();
    try {
      // Удаляем репозиторий, все связанные модули и анализы
      await session.run(
        `
        MATCH (r:Repository {id: $repoId})
        OPTIONAL MATCH (r)-[:CONTAINS]->(m:Module)
        OPTIONAL MATCH (a:Analysis {repositoryId: $repoId})
        DETACH DELETE r, m, a
        `,
        { repoId }
      );
    } finally {
      await session.close();
    }
  }
}
