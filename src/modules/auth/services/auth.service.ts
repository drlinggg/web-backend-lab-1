import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../database/database.service';
import { User, UserRole } from '../../user/interfaces/user.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
  ) {}

  async validateOrCreateUser(profile: any): Promise<User> {
    const session = this.db.getSession();
    try {
      // Ищем существующего пользователя
      const result = await session.run(
        'MATCH (u:User {githubId: $githubId}) RETURN u',
        { githubId: profile.githubId }
      );

      if (result.records.length > 0) {
        // Обновляем существующего пользователя
        const user = result.records[0].get('u').properties;
        await session.run(
          `
          MATCH (u:User {githubId: $githubId})
          SET u.lastLoginAt = datetime(),
              u.username = $username,
              u.avatarUrl = $avatarUrl,
              u.email = $email
          `,
          {
            githubId: profile.githubId,
            username: profile.username,
            avatarUrl: profile.avatarUrl,
            email: profile.email,
          }
        );
        return { ...user, ...profile };
      } else {
        // Создаем нового пользователя
        const id = uuidv4();
        const role = profile.username === 'drlinggg' ? UserRole.ADMIN : UserRole.USER;
        
        const createResult = await session.run(
          `
          CREATE (u:User {
            id: $id,
            githubId: $githubId,
            githubUsername: $githubUsername,
            username: $username,
            email: $email,
            avatarUrl: $avatarUrl,
            role: $role,
            createdAt: datetime(),
            updatedAt: datetime(),
            lastLoginAt: datetime()
          })
          RETURN u
          `,
          {
            id,
            githubId: profile.githubId,
            githubUsername: profile.username,
            username: profile.username,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
            role,
          }
        );
        
        return createResult.records[0].get('u').properties;
      }
    } finally {
      await session.close();
    }
  }

  async generateToken(user: User): Promise<string> {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };
    return this.jwtService.sign(payload);
  }

  async register(registerDto: any) {
    // Регистрация через email/пароль (если нужно)
    return { message: 'Register endpoint' };
  }

  async login(loginDto: any) {
    // Логин через email/пароль (если нужно)
    return { message: 'Login endpoint' };
  }

  async validateUser(payload: any): Promise<any> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        'MATCH (u:User {id: $id}) RETURN u',
        { id: payload.sub }
      );
      
      if (result.records.length === 0) return null;
      return result.records[0].get('u').properties;
    } finally {
      await session.close();
    }
  }
}
