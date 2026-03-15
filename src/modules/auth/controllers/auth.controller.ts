import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Get('github')
  @UseGuards(AuthGuard('github'))
  async githubAuth() {}

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubAuthCallback(@Req() req, @Res() res) {
    const { user } = req;
    const savedUser = await this.authService.validateOrCreateUser(user);
    const token = await this.authService.generateToken(savedUser);
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173/import.me';
    const base = frontendUrl.endsWith('/') ? frontendUrl : frontendUrl + '/';
    res.redirect(`${base}?token=${token}`);
  }

  @Post('register')
  async register(@Body() registerDto: any) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  async login(@Body() loginDto: any) {
    return this.authService.login(loginDto);
  }
}
