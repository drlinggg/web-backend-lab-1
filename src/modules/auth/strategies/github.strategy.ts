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

    super({
      clientID: clientID || 'dummy-client-id',
      clientSecret: clientSecret || 'dummy-client-secret',
      callbackURL: `${configService.get<string>('BACKEND_URL') || 'http://localhost:3000'}/api/auth/github/callback`,
      scope: ['user:email', 'read:user', 'repo'],
    });
  }

  async validate(accessToken: string, _refreshToken: string, profile: any) {
    const { id, username, emails, photos } = profile;
    return {
      githubId: id,
      username,
      email: emails?.[0]?.value,
      avatarUrl: photos?.[0]?.value,
      githubAccessToken: accessToken,
    };
  }
}
