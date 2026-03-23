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
      const result = await session.run(
        'MATCH (u:User {githubId: $githubId}) RETURN u',
        { githubId: profile.githubId },
      );

      if (result.records.length > 0) {
        const user = result.records[0].get('u').properties;
        await session.run(
          `MATCH (u:User {githubId: $githubId})
           SET u.lastLoginAt = datetime(),
               u.username = $username,
               u.avatarUrl = $avatarUrl,
               u.email = $email,
               u.githubAccessToken = $githubAccessToken`,
          {
            githubId: profile.githubId,
            username: profile.username,
            avatarUrl: profile.avatarUrl,
            email: profile.email,
            githubAccessToken: profile.githubAccessToken || null,
          },
        );
        return { ...user, ...profile };
      }

      const id = uuidv4();
      const role = profile.username === 'drlinggg' ? UserRole.ADMIN : UserRole.USER;

      const createResult = await session.run(
        `CREATE (u:User {
            id: $id,
            githubId: $githubId,
            githubUsername: $githubUsername,
            username: $username,
            email: $email,
            avatarUrl: $avatarUrl,
            role: $role,
            githubAccessToken: $githubAccessToken,
            createdAt: datetime(),
            updatedAt: datetime(),
            lastLoginAt: datetime()
          }) RETURN u`,
        {
          id,
          githubId: profile.githubId,
          githubUsername: profile.username,
          username: profile.username,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
          role,
          githubAccessToken: profile.githubAccessToken || null,
        },
      );

      return createResult.records[0].get('u').properties;
    } finally {
      await session.close();
    }
  }

  async generateToken(user: User): Promise<string> {
    const payload = { sub: user.id, username: user.username, role: user.role };
    return this.jwtService.sign(payload);
  }

  async register(registerDto: any) {
    return { message: 'Register endpoint' };
  }

  async login(loginDto: any) {
    return { message: 'Login endpoint' };
  }

  async validateUser(payload: any): Promise<any> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        'MATCH (u:User {id: $id}) RETURN u',
        { id: payload.sub },
      );
      if (result.records.length === 0) return null;
      return result.records[0].get('u').properties;
    } finally {
      await session.close();
    }
  }

  /**
   * Find or create a ghost user for a GitHub repo owner who has not registered.
   * Ghost users have no access token and cannot log in.
   */
  async findOrCreateGhostUser(githubUsername: string): Promise<string> {
    const session = this.db.getSession();
    try {
      const existing = await session.run(
        'MATCH (u:User {githubUsername: $githubUsername}) RETURN u',
        { githubUsername },
      );
      if (existing.records.length > 0) {
        return existing.records[0].get('u').properties.id;
      }

      const id = uuidv4();
      await session.run(
        `CREATE (u:User {
            id: $id,
            githubId: $githubId,
            githubUsername: $githubUsername,
            username: $githubUsername,
            email: null,
            avatarUrl: $avatarUrl,
            role: $role,
            githubAccessToken: null,
            createdAt: datetime(),
            updatedAt: datetime(),
            lastLoginAt: null
          }) RETURN u`,
        {
          id,
          githubId: `ghost_${githubUsername}`,
          githubUsername,
          avatarUrl: `https://avatars.githubusercontent.com/${githubUsername}`,
          role: UserRole.USER,
        },
      );
      return id;
    } finally {
      await session.close();
    }
  }
}
