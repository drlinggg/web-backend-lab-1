import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = configService.get<string>('GITHUB_CLIENT_SECRET');
    
    if (!clientID || !clientSecret) {
      console.warn('GitHub OAuth credentials not configured. Using dummy values for development.');
    }
    
    // Правильная типизация для StrategyOptions
    super({
      clientID: clientID || 'dummy-client-id',
      clientSecret: clientSecret || 'dummy-client-secret',
      callbackURL: 'http://localhost:3000/api/auth/github/callback',
      scope: ['user:email', 'read:user'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any) {
    const { id, username, emails, photos } = profile;
    
    return {
      githubId: id,
      username: username,
      email: emails?.[0]?.value,
      avatarUrl: photos?.[0]?.value,
      accessToken,
    };
  }
}
