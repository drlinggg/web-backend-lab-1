import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UserService } from '../services/user.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../../common/decorators/user.decorator';

@Controller('api/user')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('favorites')
  @UseGuards(JwtAuthGuard)
  async getUserFavorites(@CurrentUser() user: any) {
    return this.userService.getUserLikedRepositories(user.id);
  }

  @Get('my-repositories')
  @UseGuards(JwtAuthGuard)
  async getUserRepositories(@CurrentUser() user: any) {
    return this.userService.getUserRepositories(user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: any) {
    return user;
  }

  @Delete('admin/users/:userId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deleteUser(@Param('userId') userId: string) {
    await this.userService.deleteUser(userId);
    return { success: true };
  }

  @Delete('admin/repositories/:repoId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deleteRepository(@Param('repoId') repoId: string) {
    await this.userService.deleteRepository(repoId);
    return { success: true };
  }
}
