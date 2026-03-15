import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GithubService {
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  private get authHeaders(): Record<string, string> {
    const token = this.configService.get<string>('GITHUB_TOKEN');
    return token ? { Authorization: `token ${token}` } : {};
  }

  async getLatestCommit(owner: string, repo: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
          { headers: this.authHeaders },
        ),
      );
      return response.data[0];
    } catch {
      return { sha: 'unknown' };
    }
  }

  async getRepositoryInfo(owner: string, repo: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.github.com/repos/${owner}/${repo}`,
          { headers: this.authHeaders },
        ),
      );
      return response.data;
    } catch {
      return {
        description: '',
        html_url: `https://github.com/${owner}/${repo}`,
        stargazers_count: 0,
        forks_count: 0,
      };
    }
  }

  async getPythonFiles(owner: string, repo: string) {
    const files =
      (await this.fetchTree(owner, repo, 'main')) ??
      (await this.fetchTree(owner, repo, 'master')) ??
      [];

    if (files.length > 0 && files.length < 100) {
      await this.loadFileContents(files);
    }

    return files;
  }

  private async fetchTree(owner: string, repo: string, branch: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
          { headers: this.authHeaders },
        ),
      );
      return response.data.tree
        .filter((item: any) => item.type === 'blob' && item.path.endsWith('.py'))
        .map((item: any) => ({
          name: item.path.split('/').pop(),
          path: item.path,
          size: item.size,
          url: item.url,
        }));
    } catch {
      return null;
    }
  }

  private async loadFileContents(files: any[]) {
    console.log('Loading contents, token present:', !!this.configService.get('GITHUB_TOKEN'));
    for (const file of files) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(file.url, { headers: this.authHeaders }),
        );
        if (response.data.content) {
          file.content = Buffer.from(response.data.content, 'base64').toString('utf-8');
          console.log('Loaded:', file.path);
        }
      } catch (e) {
        console.error('Failed to load:', file.path, e.message);
      }
    }
  }
}
