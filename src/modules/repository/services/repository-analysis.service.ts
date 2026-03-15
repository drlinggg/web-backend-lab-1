import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { GithubService } from '../../github/services/github.service';
import { RepositoryService } from './repository.service';
import {
  Repository,
  RepositoryAnalysis,
  DependencyGraph,
  GraphNode,
  GraphEdge,
} from '../interfaces/repository.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RepositoryAnalysisService {
  constructor(
    private db: DatabaseService,
    private githubService: GithubService,
    private repositoryService: RepositoryService,
  ) {}

  async analyzeRepository(repoUrl: string, userId?: string): Promise<any> {
    const { owner, repo } = this.parseGithubUrl(repoUrl);
    const existingRepo = await this.findRepositoryByName(`${owner}/${repo}`);

    if (existingRepo) {
      const latestCommit = await this.githubService.getLatestCommit(owner, repo);

      if (existingRepo.lastCommitHash === latestCommit.sha) {
        await this.repositoryService.incrementViewCount(existingRepo.id);
        const analysis = await this.getLatestAnalysis(existingRepo.id);
        return {
          repository: existingRepo,
          graph: analysis?.graphData || null,
          fromCache: true,
          analyzedAt: existingRepo.lastAnalyzedAt,
        };
      }

      return this.performAnalysis(owner, repo, existingRepo, latestCommit.sha, userId);
    }

    const latestCommit = await this.githubService.getLatestCommit(owner, repo);
    return this.performAnalysis(owner, repo, null, latestCommit.sha, userId);
  }

  private async findRepositoryByName(fullName: string): Promise<Repository | null> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        'MATCH (r:Repository {fullName: $fullName}) RETURN r',
        { fullName },
      );

      if (result.records.length === 0) return null;

      const props = result.records[0].get('r').properties;
      return {
        ...props,
        createdAt: new Date(props.createdAt),
        updatedAt: new Date(props.updatedAt),
        lastAnalyzedAt: props.lastAnalyzedAt ? new Date(props.lastAnalyzedAt) : undefined,
      };
    } finally {
      await session.close();
    }
  }

  private async getLatestAnalysis(repositoryId: string): Promise<RepositoryAnalysis | null> {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (a:Analysis {repositoryId: $repositoryId})
        RETURN a
        ORDER BY a.analyzedAt DESC
        LIMIT 1
        `,
        { repositoryId },
      );

      if (result.records.length === 0) return null;

      const props = result.records[0].get('a').properties;
      return {
        ...props,
        analyzedAt: new Date(props.analyzedAt),
        graphData: props.graphData ? JSON.parse(props.graphData) : null,
      };
    } finally {
      await session.close();
    }
  }

  private async performAnalysis(
    owner: string,
    repo: string,
    existingRepo: Repository | null,
    commitHash: string,
    userId?: string,
  ) {
    await this.checkRateLimits(owner, repo);

    let repository = existingRepo;

    try {
      const pythonFiles = await this.githubService.getPythonFiles(owner, repo);

      if (pythonFiles.length > 1000) {
        throw new HttpException(
          'Repository is too large to analyze',
          HttpStatus.I_AM_A_TEAPOT,
        );
      }

      if (!repository) {
        repository = await this.createRepository(owner, repo, userId);
      }

      const graphData = await this.parseDependencies(pythonFiles, repository.id);

      const analysis = await this.saveAnalysis(repository.id, commitHash, graphData);

      await this.updateRepositoryAfterAnalysis(repository.id, commitHash);

      await this.repositoryService.incrementViewCount(repository.id);

      if (userId) {
        await this.checkAndCreateOwnerRelationship(userId, repository.id, owner);
      }

      return {
        repository,
        graph: graphData,
        fromCache: false,
        analyzedAt: new Date(),
      };
    } catch (error) {
      if (repository) {
        await this.updateRepository(repository.id, { isAnalyzing: false });
      }
      throw error;
    }
  }

  private async createRepository(
    owner: string,
    repo: string,
    userId?: string,
  ): Promise<Repository> {
    const session = this.db.getSession();
    try {
      const id = uuidv4();
      const fullName = `${owner}/${repo}`;
      const repoInfo = await this.githubService.getRepositoryInfo(owner, repo);

      const result = await session.run(
        `
        CREATE (r:Repository {
          id: $id,
          name: $repo,
          fullName: $fullName,
          description: $description,
          url: $url,
          ownerId: $ownerId,
          ownerName: $owner,
          viewCount: 0,
          stars: $stars,
          forks: $forks,
          isAnalyzing: true,
          createdAt: datetime(),
          updatedAt: datetime()
        })
        RETURN r
        `,
        {
          id,
          repo,
          fullName,
          owner,
          ownerId: userId || '',
          description: repoInfo.description || '',
          url: repoInfo.html_url,
          stars: repoInfo.stargazers_count || 0,
          forks: repoInfo.forks_count || 0,
        },
      );

      const props = result.records[0].get('r').properties;
      return {
        ...props,
        createdAt: new Date(props.createdAt),
        updatedAt: new Date(props.updatedAt),
      };
    } finally {
      await session.close();
    }
  }

  private async saveAnalysis(
    repositoryId: string,
    commitHash: string,
    graphData: DependencyGraph,
  ): Promise<RepositoryAnalysis> {
    const session = this.db.getSession();
    try {
      const id = uuidv4();

      const result = await session.run(
        `
        CREATE (a:Analysis {
          id: $id,
          repositoryId: $repositoryId,
          analyzedAt: datetime(),
          commitHash: $commitHash,
          graphData: $graphData,
          modulesCount: $modulesCount,
          importsCount: $importsCount
        })
        RETURN a
        `,
        {
          id,
          repositoryId,
          commitHash,
          graphData: JSON.stringify(graphData),
          modulesCount: graphData.nodes.length,
          importsCount: graphData.edges.length,
        },
      );

      const props = result.records[0].get('a').properties;
      return {
        ...props,
        analyzedAt: new Date(props.analyzedAt),
        graphData: JSON.parse(props.graphData),
      };
    } finally {
      await session.close();
    }
  }

  private async updateRepositoryAfterAnalysis(
    repositoryId: string,
    commitHash: string,
  ): Promise<void> {
    const session = this.db.getSession();
    try {
      await session.run(
        `
        MATCH (r:Repository {id: $repositoryId})
        SET r.lastAnalyzedAt = datetime(),
            r.lastCommitHash = $commitHash,
            r.isAnalyzing = false,
            r.updatedAt = datetime()
        `,
        { repositoryId, commitHash },
      );
    } finally {
      await session.close();
    }
  }

  private async updateRepository(repositoryId: string, updates: any): Promise<void> {
    const session = this.db.getSession();
    try {
      const setClause = Object.keys(updates)
        .map((key) => `r.${key} = $${key}`)
        .join(', ');

      await session.run(
        `
        MATCH (r:Repository {id: $repositoryId})
        SET ${setClause}, r.updatedAt = datetime()
        `,
        { repositoryId, ...updates },
      );
    } finally {
      await session.close();
    }
  }

  private async checkRateLimits(owner: string, repo: string) {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        `
        MATCH (r:Repository {fullName: $fullName})
        RETURN r.lastAnalyzedAt as lastAnalyzed, r.isAnalyzing as isAnalyzing
        `,
        { fullName: `${owner}/${repo}` },
      );

      if (result.records.length > 0) {
        const isAnalyzing = result.records[0].get('isAnalyzing');
        if (isAnalyzing) {
          throw new HttpException(
            'Repository is already being analyzed',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const lastAnalyzed = result.records[0].get('lastAnalyzed');
        if (lastAnalyzed) {
          const minutesSinceLast =
            (Date.now() - new Date(lastAnalyzed).getTime()) / 60000;
          if (minutesSinceLast < 5) {
            throw new HttpException(
              'Please wait before analyzing again',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
        }
      }
    } finally {
      await session.close();
    }
  }

  private async checkAndCreateOwnerRelationship(
    userId: string,
    repositoryId: string,
    owner: string,
  ) {
    const session = this.db.getSession();
    try {
      const result = await session.run(
        'MATCH (u:User {id: $userId}) RETURN u',
        { userId },
      );

      if (result.records.length > 0) {
        const userProps = result.records[0].get('u').properties;
        const githubUsername = userProps.githubUsername || userProps.username;

        if (githubUsername === owner) {
          await session.run(
            `
            MATCH (u:User {id: $userId})
            MATCH (r:Repository {id: $repositoryId})
            MERGE (u)-[:OWNS]->(r)
            `,
            { userId, repositoryId },
          );
        }
      }
    } finally {
      await session.close();
    }
  }

  private parseGithubUrl(url: string): { owner: string; repo: string } {
    const match = url.match(/(?:github\.com\/)?([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!match) {
      throw new HttpException('Invalid GitHub URL', HttpStatus.BAD_REQUEST);
    }
    return { owner: match[1], repo: match[2] };
  }

  /**
   * Builds a map from fully-qualified Python module name → file path.
   *
   * Rules:
   *   a/b/c.py         → "a.b.c"
   *   a/b/__init__.py  → "a.b"   (the package, NOT "a.b.__init__")
   *
   * No suffix shortcuts are registered: every lookup uses the full dotted
   * name exactly as written in an import statement.
   */
  private buildModuleMap(files: any[]): Map<string, string> {
    const moduleMap = new Map<string, string>();

    for (const file of files) {
      const withoutExt = file.path.replace(/\.py$/, '');

      if (withoutExt.endsWith('/__init__')) {
        const packagePath = withoutExt.replace(/\/__init__$/, '');
        const packageDotted = packagePath.replace(/\//g, '.');
        moduleMap.set(packageDotted, file.path);
      } else {
        const dotted = withoutExt.replace(/\//g, '.');
        moduleMap.set(dotted, file.path);
      }
    }

    return moduleMap;
  }

  /**
   * Resolves a relative import (leading dots) to its target file path.
   *
   * Examples for file = "myapp/utils/helpers.py":
   *   "."         → "myapp/utils/__init__.py"
   *   ".sibling"  → "myapp/utils/sibling.py"
   *   ".."        → "myapp/__init__.py"
   *   "..models"  → "myapp/models.py"
   */
  private resolveRelativeImport(
    imp: string,
    filePath: string,
    moduleMap: Map<string, string>,
  ): string | null {
    const dotMatch = imp.match(/^(\.+)(.*)/);
    if (!dotMatch) return null;

    const dots = dotMatch[1].length;
    const rest = dotMatch[2];

    // For __init__.py the package IS its own directory.
    // For a regular module the package is its containing directory.
    const isInit = filePath.endsWith('/__init__.py');
    const dir = isInit
      ? filePath.replace(/\/__init__\.py$/, '')
      : filePath.replace(/\/[^/]+\.py$/, '');

    const packageParts = dir ? dir.split('/') : [];

    // Each extra dot beyond the first moves one package level up.
    const levelsUp = dots - 1;
    if (levelsUp > packageParts.length) return null;

    const baseParts = packageParts.slice(0, packageParts.length - levelsUp);
    const baseModule = baseParts.join('.');

    const targetModule = rest
      ? baseModule
        ? `${baseModule}.${rest}`
        : rest
      : baseModule;

    if (!targetModule) return null;
    return moduleMap.has(targetModule) ? targetModule : null;
  }

  private async parseDependencies(
    files: any[],
    repositoryId: string,
  ): Promise<DependencyGraph> {
    const moduleMap = this.buildModuleMap(files);

    const STDLIB = new Set([
      'os', 'sys', 're', 'json', 'math', 'time', 'datetime', 'collections',
      'itertools', 'functools', 'pathlib', 'typing', 'abc', 'io', 'copy', 'random',
      'hashlib', 'base64', 'urllib', 'http', 'logging', 'threading', 'subprocess',
      'argparse', 'enum', 'dataclasses', 'contextlib', 'asyncio', 'inspect',
      'traceback', 'unittest', 'warnings', 'uuid', 'string', 'struct', 'socket',
      'signal', 'shutil', 'builtins', 'types', 'weakref', 'gc', 'platform',
      'tempfile', 'glob', 'fnmatch', 'pickle', 'shelve', 'sqlite3', 'csv',
      'configparser', 'decimal', 'fractions', 'statistics', 'cmath', 'array',
      'queue', 'heapq', 'bisect', 'pprint', 'textwrap', 'unicodedata', 'codecs',
      'html', 'xml', 'email', 'mimetypes', 'ftplib', 'smtplib', 'ssl', 'select',
      'selectors', 'multiprocessing', 'concurrent', 'ctypes', 'zlib', 'gzip',
      'bz2', 'lzma', 'zipfile', 'tarfile', 'tomllib',
    ]);

    const localNodes: GraphNode[] = files.map((file, index) => {
      const withoutExt = file.path.replace(/\.py$/, '');
      const isInit = withoutExt.endsWith('/__init__');
      const name = isInit
        ? withoutExt.replace(/\/__init__$/, '').replace(/\//g, '.')
        : withoutExt.replace(/\//g, '.');

      return {
        id: `${repositoryId}-node-${index}`,
        name,
        path: file.path,
        type: (isInit ? 'package' : 'module') as GraphNode['type'],
        size: file.size,
      };
    });

    const pathToNode = new Map<string, GraphNode>(localNodes.map((n) => [n.path, n]));
    const externalNodeMap = new Map<string, GraphNode>();

    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.content) continue;

      const sourceNode = localNodes[i];
      const imports = this.extractPythonImports(file.content);

      for (const imp of imports) {
        let targetPath: string | undefined;
        let importType: GraphEdge['importType'];

        if (imp.startsWith('.')) {
          // ── Relative import ────────────────────────────────────────────
          importType = 'relative';
          const resolvedModule = this.resolveRelativeImport(imp, file.path, moduleMap);
          if (resolvedModule) {
            targetPath = moduleMap.get(resolvedModule);
          }
        } else {
          // ── Absolute import ────────────────────────────────────────────
          importType = 'absolute';

          // 1. Exact match: "a.b.c" → a/b/c.py
          targetPath = moduleMap.get(imp);

          // 2. Prefix walk: "from a.b.c import Foo" can still bind to
          //    a/b/__init__.py when a/b/c.py does not exist as its own file.
          if (!targetPath) {
            const parts = imp.split('.');
            for (let j = parts.length - 1; j > 0; j--) {
              const prefix = parts.slice(0, j).join('.');
              if (moduleMap.has(prefix)) {
                targetPath = moduleMap.get(prefix);
                break;
              }
            }
          }
        }

        if (targetPath) {
          const targetNode = pathToNode.get(targetPath);
          if (!targetNode || targetNode.id === sourceNode.id) continue;

          const key = `${sourceNode.id}->${targetNode.id}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ source: sourceNode.id, target: targetNode.id, type: 'imports', importType });
          }
        } else if (!imp.startsWith('.')) {
          // External dependency — only unresolved absolute imports
          const topLevel = imp.split('.')[0];
          if (STDLIB.has(topLevel)) continue;

          const extId = `${repositoryId}-ext-${topLevel}`;
          if (!externalNodeMap.has(extId)) {
            externalNodeMap.set(extId, {
              id: extId,
              name: topLevel,
              path: topLevel,
              type: 'external' as const,
            });
          }
          const key = `${sourceNode.id}->${extId}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ source: sourceNode.id, target: extId, type: 'imports', importType: 'external' });
          }
        }
      }
    }

    const nodes = [...localNodes, ...externalNodeMap.values()];
    await this.saveModulesToNeo4j(repositoryId, nodes, edges);
    return { nodes, edges };
  }

  private async saveModulesToNeo4j(
    repositoryId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Promise<void> {
    const session = this.db.getSession();
    try {
      await session.run(
        `MATCH (r:Repository {id: $repositoryId})-[:CONTAINS]->(m:Module) DETACH DELETE m`,
        { repositoryId },
      );

      for (const node of nodes) {
        await session.run(
          `
          MATCH (r:Repository {id: $repositoryId})
          CREATE (m:Module {
            id: $id,
            repositoryId: $repositoryId,
            name: $name,
            path: $path,
            type: $type
          })
          CREATE (r)-[:CONTAINS]->(m)
          `,
          {
            repositoryId,
            id: node.id,
            name: node.name,
            path: node.path,
            type: node.type,
          },
        );
      }

      for (const edge of edges) {
        await session.run(
          `
          MATCH (source:Module {id: $sourceId})
          MATCH (target:Module {id: $targetId})
          MERGE (source)-[:IMPORTS]->(target)
          `,
          { sourceId: edge.source, targetId: edge.target },
        );
      }
    } finally {
      await session.close();
    }
  }

  private extractPythonImports(content: string): string[] {
    const imports: string[] = [];

    for (const rawLine of content.split('\n')) {
      // Strip inline comments (sufficient for import lines).
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;

      // import a, import a.b.c, import a as x, import a as x, b as y
      const importMatch = line.match(/^import\s+(.+)/);
      if (importMatch) {
        for (const part of importMatch[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name) imports.push(name);
        }
        continue;
      }

      // from x import ..., from . import ..., from ..pkg import ...
      const fromMatch = line.match(/^from\s+(\S+)\s+import/);
      if (fromMatch) {
        imports.push(fromMatch[1]);
      }
    }

    return imports;
  }
}
