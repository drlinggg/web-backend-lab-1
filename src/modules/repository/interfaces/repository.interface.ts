export interface GraphNode {
  id: string;
  name: string;
  path: string;
  type: 'module' | 'package' | 'external';
  size?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'imports' | 'uses';
  importType?: 'relative' | 'absolute' | 'external';
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description?: string;
  url: string;
  ownerId: string;
  ownerName: string;
  viewCount: number;
  stars?: number;
  forks?: number;
  lastAnalyzedAt?: Date;
  lastCommitHash?: string;
  analyzedAt?: Date;
  isAnalyzing?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryAnalysis {
  id: string;
  repositoryId: string;
  analyzedAt: Date;
  commitHash: string;
  graphData: DependencyGraph;
  modulesCount: number;
  importsCount: number;
}
